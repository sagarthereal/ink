import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection, type Transaction } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'

interface PaginationState {
  externalRevision: number
}

const key = new PluginKey<PaginationState>('inkPaginationFlow')

const REFLOW_META = 'reflow'
const OVERFLOW_EPSILON = 2
const PULL_SAFETY = 24
const MAX_MUTATIONS_PER_FRAME = 80

type PageInfo = { node: PMNode; pos: number }
type ReflowResult =
  | { kind: 'mutated'; boundary: number; signature?: string }
  | { kind: 'stable' }
  | { kind: 'retry' }

function pagesIn(doc: PMNode): PageInfo[] {
  const pages: PageInfo[] = []
  doc.forEach((node, offset) => {
    if (node.type.name === 'page') pages.push({ node, pos: offset })
  })
  return pages
}

function pageBodies(view: EditorView) {
  return Array.from(
    view.dom.querySelectorAll<HTMLElement>('[data-ink-page-body]'),
  )
}

function resetInternalScroll(body: HTMLElement) {
  if (body.scrollTop !== 0) body.scrollTop = 0
  if (body.scrollLeft !== 0) body.scrollLeft = 0
}

function contentBottom(body: HTMLElement) {
  const children = Array.from(body.children) as HTMLElement[]
  if (!children.length) return 0

  const bodyRect = body.getBoundingClientRect()
  const scale = body.clientHeight > 0
    ? bodyRect.height / body.clientHeight
    : 1

  let bottom = 0
  for (const child of children) {
    const rect = child.getBoundingClientRect()
    const style = getComputedStyle(child)
    const marginBottom = parseFloat(style.marginBottom || '0') * scale
    bottom = Math.max(bottom, rect.bottom - bodyRect.top + marginBottom)
  }

  return scale > 0 ? bottom / scale : bottom
}

function isOverflowing(body: HTMLElement) {
  resetInternalScroll(body)

  // Both values are layout CSS pixels, so zoom cannot create a false fit.
  if (body.scrollHeight > body.clientHeight + OVERFLOW_EPSILON) return true

  // Floats can occasionally be rounded out of scrollHeight by WebView.
  return contentBottom(body) > body.clientHeight + OVERFLOW_EPSILON
}

function visualScale(body: HTMLElement) {
  const rect = body.getBoundingClientRect()
  return body.clientHeight > 0 ? rect.height / body.clientHeight : 1
}

function outerHeightInLayoutPixels(el: HTMLElement, scale: number) {
  const rect = el.getBoundingClientRect()
  const style = getComputedStyle(el)
  const marginTop = parseFloat(style.marginTop || '0')
  const marginBottom = parseFloat(style.marginBottom || '0')
  const visualHeight = scale > 0 ? rect.height / scale : rect.height
  return visualHeight + marginTop + marginBottom
}

function nodeElement(view: EditorView, pos: number) {
  const dom = view.nodeDOM(pos)
  if (dom instanceof HTMLElement) return dom
  if (dom instanceof Text) return dom.parentElement
  return null
}

function caretOffsetInsideNode(
  selection: EditorView['state']['selection'],
  nodeStart: number,
  nodeSize: number,
) {
  if (!selection.empty) return null

  const caret = selection.from
  const firstInside = nodeStart + 1
  const lastInside = nodeStart + nodeSize - 1
  if (caret < firstInside || caret > lastInside) return null

  return caret - nodeStart
}

function setCaret(
  tr: Transaction,
  target: number | null,
) {
  if (target === null) return
  const safe = Math.max(1, Math.min(tr.doc.content.size - 1, target))
  tr.setSelection(TextSelection.create(tr.doc, safe))
  tr.scrollIntoView()
}

function dispatchReflow(view: EditorView, tr: Transaction) {
  tr.setMeta(key, REFLOW_META)
  tr.setMeta('addToHistory', false)
  view.dispatch(tr)
}

function nodeSignature(node: PMNode, boundary: number) {
  const text = node.textContent.replace(/\s+/g, ' ').slice(0, 48)
  return `${boundary}:${node.type.name}:${node.nodeSize}:${text}`
}

/**
 * Find the last inline offset in a paragraph whose rendered line still fits.
 * getBoundingClientRect/coordsAtPos are both visual coordinates, so this test
 * remains correct under Ink's CSS zoom.
 */
function paragraphSplitOffset(
  view: EditorView,
  node: PMNode,
  nodePos: number,
  pageBottom: number,
) {
  if (node.type.name !== 'paragraph' || node.content.size < 2) return null

  let low = nodePos + 2
  let high = nodePos + node.nodeSize - 2
  let best: number | null = null

  try {
    while (low <= high) {
      const mid = Math.floor((low + high) / 2)
      const coords = view.coordsAtPos(mid)

      if (coords.bottom <= pageBottom - OVERFLOW_EPSILON) {
        best = mid
        low = mid + 1
      } else {
        high = mid - 1
      }
    }
  } catch {
    return null
  }

  if (best === null) return null
  const offset = best - (nodePos + 1)
  return offset > 0 && offset < node.content.size ? offset : null
}

/**
 * Split a top-level list only between list items. This covers the common case
 * of a pasted bullet/numbered list crossing a page without ever cutting an
 * individual list item in half.
 */
function listSplitOffset(
  node: PMNode,
  el: HTMLElement,
  pageBottom: number,
) {
  if (node.type.name !== 'bulletList' && node.type.name !== 'orderedList') {
    return null
  }

  const itemElements = Array.from(el.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement,
  )

  const count = Math.min(node.childCount, itemElements.length)
  if (count < 2) return null

  let splitIndex = 0
  for (let i = 0; i < count; i += 1) {
    if (itemElements[i].getBoundingClientRect().bottom <= pageBottom - OVERFLOW_EPSILON) {
      splitIndex = i + 1
    } else {
      break
    }
  }

  if (splitIndex <= 0 || splitIndex >= node.childCount) return null

  let offset = 0
  for (let i = 0; i < splitIndex; i += 1) offset += node.child(i).nodeSize
  return { offset, splitIndex }
}

function moveSplitTailForward(
  view: EditorView,
  pageIndex: number,
  page: PageInfo,
  block: PMNode,
  blockStart: number,
  splitOffset: number,
  head: PMNode,
  tail: PMNode,
) {
  const state = view.state
  const pages = pagesIn(state.doc)
  if (!pages[pageIndex] || pages[pageIndex].pos !== page.pos) return false

  const relativeCaret = caretOffsetInsideNode(
    state.selection,
    blockStart,
    block.nodeSize,
  )

  const tr = state.tr.replaceWith(
    blockStart,
    blockStart + block.nodeSize,
    head,
  )

  const delta = head.nodeSize - block.nodeSize
  let tailStart: number

  if (pageIndex + 1 < pages.length) {
    const nextPagePos = pages[pageIndex + 1].pos + delta
    tailStart = nextPagePos + 1
    tr.insert(tailStart, tail)
  } else {
    const pageType = state.schema.nodes.page
    const currentPageEnd = page.pos + page.node.nodeSize + delta
    tr.insert(currentPageEnd, pageType.create(null, tail))
    tailStart = currentPageEnd + 1
  }

  if (relativeCaret !== null) {
    const contentOffset = Math.max(
      0,
      Math.min(block.content.size, relativeCaret - 1),
    )

    if (contentOffset <= splitOffset) {
      setCaret(
        tr,
        blockStart + 1 + Math.min(contentOffset, head.content.size),
      )
    } else {
      setCaret(
        tr,
        tailStart + 1 + Math.min(contentOffset - splitOffset, tail.content.size),
      )
    }
  }

  dispatchReflow(view, tr)
  return true
}

function trySplitOverflowingLastBlock(
  view: EditorView,
  pageIndex: number,
  page: PageInfo,
  body: HTMLElement,
  block: PMNode,
  blockStart: number,
) {
  const el = nodeElement(view, blockStart)
  if (!el) return false

  const bodyRect = body.getBoundingClientRect()
  const blockRect = el.getBoundingClientRect()

  // If the whole block starts below the bottom, moving it is preferable to
  // splitting it. Splitting is only for a block that actually crosses the edge.
  if (
    blockRect.top >= bodyRect.bottom - OVERFLOW_EPSILON ||
    blockRect.bottom <= bodyRect.bottom + OVERFLOW_EPSILON
  ) {
    return false
  }

  if (block.type.name === 'paragraph') {
    const offset = paragraphSplitOffset(view, block, blockStart, bodyRect.bottom)
    if (offset === null) return false

    const head = block.copy(block.content.cut(0, offset))
    const tail = block.copy(block.content.cut(offset))
    return moveSplitTailForward(
      view,
      pageIndex,
      page,
      block,
      blockStart,
      offset,
      head,
      tail,
    )
  }

  const listSplit = listSplitOffset(block, el, bodyRect.bottom)
  if (!listSplit) return false

  const headContent = block.content.cut(0, listSplit.offset)
  const tailContent = block.content.cut(listSplit.offset)
  const head = block.copy(headContent)

  let tail = block.copy(tailContent)
  if (block.type.name === 'orderedList' && typeof block.attrs.start === 'number') {
    tail = block.type.create(
      { ...block.attrs, start: block.attrs.start + listSplit.splitIndex },
      tailContent,
      block.marks,
    )
  }

  return moveSplitTailForward(
    view,
    pageIndex,
    page,
    block,
    blockStart,
    listSplit.offset,
    head,
    tail,
  )
}

function moveWholeLastBlockForward(
  view: EditorView,
  pageIndex: number,
  page: PageInfo,
  block: PMNode,
  blockStart: number,
) {
  const state = view.state
  const pages = pagesIn(state.doc)
  if (!pages[pageIndex] || pages[pageIndex].pos !== page.pos) return false

  const relativeCaret = caretOffsetInsideNode(
    state.selection,
    blockStart,
    block.nodeSize,
  )

  const tr = state.tr.delete(blockStart, blockStart + block.nodeSize)
  let movedStart: number

  if (pageIndex + 1 < pages.length) {
    const nextPageStart = pages[pageIndex + 1].pos - block.nodeSize + 1
    tr.insert(nextPageStart, block)
    movedStart = nextPageStart
  } else {
    const pageType = state.schema.nodes.page
    const currentPageEnd = page.pos + page.node.nodeSize - block.nodeSize
    tr.insert(currentPageEnd, pageType.create(null, block))
    movedStart = currentPageEnd + 1
  }

  if (relativeCaret !== null) {
    const target = movedStart + Math.max(
      1,
      Math.min(block.nodeSize - 1, relativeCaret),
    )
    setCaret(tr, target)
  }

  dispatchReflow(view, tr)
  return true
}

function pushOneOverflow(view: EditorView): ReflowResult {
  const state = view.state
  const pages = pagesIn(state.doc)
  const bodies = pageBodies(view)

  if (!pages.length || pages.length !== bodies.length) return { kind: 'retry' }

  for (const body of bodies) resetInternalScroll(body)

  for (let i = 0; i < pages.length; i += 1) {
    const body = bodies[i]
    const page = pages[i]
    if (!isOverflowing(body)) continue

    const last = page.node.lastChild
    if (!last) continue

    const lastStart = page.pos + 1 + page.node.content.size - last.nodeSize
    const signature = nodeSignature(last, i)

    if (trySplitOverflowingLastBlock(view, i, page, body, last, lastStart)) {
      return { kind: 'mutated', boundary: i, signature }
    }

    // Never empty a page just to move an unsplittable block forward. A single
    // atomic block that is taller than a page is a defined exceptional case;
    // leaving it clipped is safer than endlessly creating empty pages.
    if (page.node.childCount <= 1) continue

    if (moveWholeLastBlockForward(view, i, page, last, lastStart)) {
      return { kind: 'mutated', boundary: i, signature }
    }

    return { kind: 'retry' }
  }

  return { kind: 'stable' }
}

function pullOneBackward(
  view: EditorView,
  blockedPulls: Set<string>,
): ReflowResult {
  const state = view.state
  const pages = pagesIn(state.doc)
  const bodies = pageBodies(view)

  if (!pages.length || pages.length !== bodies.length) return { kind: 'retry' }

  for (let i = 0; i < pages.length - 1; i += 1) {
    const body = bodies[i]
    const nextBody = bodies[i + 1]
    const page = pages[i]
    const next = pages[i + 1]

    if (isOverflowing(body)) continue

    // Wrapping around floats can radically change a text block's height after
    // a pull. Keep pull-back conservative in those layouts; push-forward still
    // handles them normally.
    if (body.querySelector('.pen-canvas-node.align-left, .pen-canvas-node.align-right')) {
      continue
    }

    const first = next.node.firstChild
    const firstEl = nextBody.firstElementChild as HTMLElement | null
    if (!first || !firstEl) continue

    if (firstEl.matches('.pen-canvas-node.align-left, .pen-canvas-node.align-right')) {
      continue
    }

    const signature = nodeSignature(first, i)
    if (blockedPulls.has(signature)) continue

    const used = contentBottom(body)
    const spare = body.clientHeight - used
    const needed = outerHeightInLayoutPixels(firstEl, visualScale(nextBody))

    // One whole text line of safety prevents 1–2 px layout rounding from
    // bouncing the same node back and forth between pages.
    if (spare < needed + PULL_SAFETY) continue

    const nextFirstStart = next.pos + 1
    const relativeCaret = caretOffsetInsideNode(
      state.selection,
      nextFirstStart,
      first.nodeSize,
    )

    const insertPos = page.pos + 1 + page.node.content.size
    const tr = state.tr

    if (next.node.childCount === 1) {
      tr.delete(next.pos, next.pos + next.node.nodeSize)
    } else {
      tr.delete(nextFirstStart, nextFirstStart + first.nodeSize)
    }

    tr.insert(insertPos, first)

    if (relativeCaret !== null) {
      const target = insertPos + Math.max(
        1,
        Math.min(first.nodeSize - 1, relativeCaret),
      )
      setCaret(tr, target)
    }

    dispatchReflow(view, tr)
    return { kind: 'mutated', boundary: i, signature }
  }

  return { kind: 'stable' }
}

export const PaginationFlow = Extension.create({
  name: 'inkPaginationFlow',

  addProseMirrorPlugins() {
    return [
      new Plugin<PaginationState>({
        key,

        state: {
          init: () => ({ externalRevision: 0 }),
          apply(tr, value) {
            if (tr.docChanged && tr.getMeta(key) !== REFLOW_META) {
              return { externalRevision: value.externalRevision + 1 }
            }
            return value
          },
        },

        view(view) {
          let raf = 0
          let running = false
          let rerunRequested = false
          let destroyed = false
          let lastExternalRevision = key.getState(view.state)?.externalRevision ?? 0
          const blockedPulls = new Set<string>()

          const schedule = () => {
            if (destroyed) return
            if (running) {
              rerunRequested = true
              return
            }
            if (raf) return
            raf = requestAnimationFrame(run)
          }

          const run = () => {
            raf = 0
            if (destroyed || running) return

            running = true
            rerunRequested = false

            const revision = key.getState(view.state)?.externalRevision ?? 0
            if (revision !== lastExternalRevision) {
              blockedPulls.clear()
              lastExternalRevision = revision
            }

            let mutations = 0
            let needsAnotherFrame = false
            let lastPull: { boundary: number; signature?: string } | null = null

            // All mutations in this loop happen inside one animation frame,
            // before the browser paints. Large pastes therefore settle across
            // several pages without visibly cascading block-by-block.
            while (mutations < MAX_MUTATIONS_PER_FRAME) {
              const push = pushOneOverflow(view)

              if (push.kind === 'retry') {
                needsAnotherFrame = true
                break
              }

              if (push.kind === 'mutated') {
                mutations += 1

                // If a conservative pull still caused the exact same block to
                // overflow back across the same boundary, remember that pair
                // until the next real user edit. This prevents oscillation.
                if (
                  lastPull &&
                  push.boundary === lastPull.boundary &&
                  push.signature &&
                  push.signature === lastPull.signature
                ) {
                  blockedPulls.add(push.signature)
                }

                lastPull = null
                continue
              }

              // Forward flow is now stable. Only then try to reclaim clearly
              // available space from the following page.
              const pull = pullOneBackward(view, blockedPulls)

              if (pull.kind === 'retry') {
                needsAnotherFrame = true
                break
              }

              if (pull.kind === 'mutated') {
                mutations += 1
                lastPull = {
                  boundary: pull.boundary,
                  signature: pull.signature,
                }
                continue
              }

              // Neither push nor pull changed anything: layout is stable.
              break
            }

            if (mutations >= MAX_MUTATIONS_PER_FRAME) {
              needsAnotherFrame = true
            }

            running = false

            if (rerunRequested || needsAnotherFrame) schedule()
          }

          schedule()

          // Font metrics can settle after the initial DOM render without a
          // ProseMirror transaction. Reflow once more when fonts are ready.
          void document.fonts?.ready.then(() => schedule())

          return {
            update(updatedView, previousState) {
              const before = key.getState(previousState)?.externalRevision ?? 0
              const after = key.getState(updatedView.state)?.externalRevision ?? 0

              // Ignore our own pagination transactions. The running loop
              // already continues synchronously after dispatching them.
              if (after !== before) schedule()
            },
            destroy() {
              destroyed = true
              if (raf) cancelAnimationFrame(raf)
            },
          }
        },
      }),
    ]
  },
})
