import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'

const key = new PluginKey('inkPaginationFlow')
const EPSILON = 2
const PULL_GAP = 8

type PageInfo = { node: PMNode; pos: number }

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

function resetLegacyInternalScroll(body: HTMLElement) {
  // Older Ink CSS used overflow:hidden. That makes the page body a scroll
  // container even though no scrollbar is shown, and the browser can change
  // scrollTop while following the caret. Never let that hidden scroll offset
  // influence pagination measurements.
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
  resetLegacyInternalScroll(body)

  // scrollHeight/clientHeight are measured in the same unzoomed CSS-pixel
  // coordinate system, so CSS zoom cannot create false fits.
  if (body.scrollHeight > body.clientHeight + EPSILON) return true

  // WebView/browser layout around floats can occasionally round scrollHeight.
  // Keep a geometry fallback so drawing canvases are still accounted for.
  return contentBottom(body) > body.clientHeight + EPSILON
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

function restoreCaretInMovedNode(
  tr: EditorView['state']['tr'],
  newNodeStart: number,
  nodeSize: number,
  relativeOffset: number | null,
) {
  if (relativeOffset === null) return

  const firstInside = newNodeStart + 1
  const lastInside = newNodeStart + nodeSize - 1
  const target = Math.max(
    firstInside,
    Math.min(lastInside, newNodeStart + relativeOffset),
  )

  tr.setSelection(TextSelection.create(tr.doc, target))
  tr.scrollIntoView()
}

function textblockSplitPos(
  view: EditorView,
  node: PMNode,
  nodePos: number,
  pageBottom: number,
) {
  if (node.type.name !== 'paragraph' || node.content.size < 2) return null

  // Do not allow an empty paragraph on either side of the split.
  let low = nodePos + 2
  let high = nodePos + node.nodeSize - 2
  let best: number | null = null

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const coords = view.coordsAtPos(mid)

    if (coords.bottom <= pageBottom - EPSILON) {
      best = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  return best
}

export const PaginationFlow = Extension.create({
  name: 'inkPaginationFlow',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key,
        view(view) {
          let raf = 0
          let destroyed = false

          const schedule = () => {
            cancelAnimationFrame(raf)
            raf = requestAnimationFrame(() => {
              if (destroyed) return

              const state = view.state
              const pages = pagesIn(state.doc)
              const bodies = pageBodies(view)
              if (!pages.length || pages.length !== bodies.length) return

              for (const body of bodies) resetLegacyInternalScroll(body)

              // ------------------------------------------------------------
              // 1. Push overflow forward.
              // ------------------------------------------------------------
              for (let i = 0; i < pages.length; i += 1) {
                const body = bodies[i]
                const page = pages[i]
                if (!isOverflowing(body)) continue

                const last = page.node.lastChild
                if (!last) continue

                const lastStart = page.pos + 1 + page.node.content.size - last.nodeSize
                const lastEl = nodeElement(view, lastStart)

                // A long pasted paragraph may itself cross the page boundary.
                // Split it at the last rendered line that fits. The following
                // animation frame will move the newly-created tail paragraph
                // onto the next page.
                if (lastEl && last.type.name === 'paragraph') {
                  const bodyRect = body.getBoundingClientRect()
                  const lastRect = lastEl.getBoundingClientRect()

                  if (
                    lastRect.top < bodyRect.bottom - EPSILON &&
                    lastRect.bottom > bodyRect.bottom + EPSILON
                  ) {
                    const splitPos = textblockSplitPos(
                      view,
                      last,
                      lastStart,
                      bodyRect.bottom,
                    )

                    if (splitPos !== null) {
                      try {
                        const tr = state.tr.split(splitPos)
                        tr.setMeta(key, 'reflow')
                        view.dispatch(tr)
                        return
                      } catch {
                        // If this particular text structure cannot split here,
                        // continue with whole-block movement below.
                      }
                    }
                  }
                }

                // If this is the only top-level block, it must be splittable to
                // paginate. Atomic canvases intentionally remain on one page.
                if (page.node.childCount <= 1) continue

                // A delete+insert move does not preserve a text selection that
                // lives inside the moved node: ProseMirror maps that caret to
                // the deleted source position. Remember its offset inside the
                // block and restore it at the block's destination. This is
                // especially important after a large paste, where the caret is
                // expected to follow the final pasted paragraph across pages.
                const caretOffset = caretOffsetInsideNode(
                  state.selection,
                  lastStart,
                  last.nodeSize,
                )

                const tr = state.tr.delete(lastStart, lastStart + last.nodeSize)
                let movedNodeStart: number

                if (i + 1 < pages.length) {
                  const next = pages[i + 1]
                  // The deletion occurs before the next page, so its old
                  // position shifts backwards by the deleted node size.
                  const nextContentStart = next.pos - last.nodeSize + 1
                  tr.insert(nextContentStart, last)
                  movedNodeStart = nextContentStart
                } else {
                  const pageType = state.schema.nodes.page
                  const newPage = pageType.create(null, last)
                  const newCurrentPageEnd = page.pos + page.node.nodeSize - last.nodeSize
                  tr.insert(newCurrentPageEnd, newPage)
                  movedNodeStart = newCurrentPageEnd + 1
                }

                restoreCaretInMovedNode(
                  tr,
                  movedNodeStart,
                  last.nodeSize,
                  caretOffset,
                )

                tr.setMeta(key, 'reflow')
                view.dispatch(tr)
                return
              }

              // ------------------------------------------------------------
              // 2. Pull content back after deletion/editing when it definitely
              //    fits. Skip pages containing floated canvases because moving
              //    text into a float can change its wrapped height substantially.
              // ------------------------------------------------------------
              for (let i = 0; i < pages.length - 1; i += 1) {
                const body = bodies[i]
                const nextBody = bodies[i + 1]
                const page = pages[i]
                const next = pages[i + 1]

                if (body.querySelector('.pen-canvas-node.align-left, .pen-canvas-node.align-right')) {
                  continue
                }

                const first = next.node.firstChild
                const firstEl = nextBody.firstElementChild as HTMLElement | null
                if (!first || !firstEl) continue

                const used = contentBottom(body)
                const spare = body.clientHeight - used
                const scale = visualScale(nextBody)
                const needed = outerHeightInLayoutPixels(firstEl, scale)

                if (spare < needed + PULL_GAP) continue

                const nextFirstStart = next.pos + 1
                const caretOffset = caretOffsetInsideNode(
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
                restoreCaretInMovedNode(
                  tr,
                  insertPos,
                  first.nodeSize,
                  caretOffset,
                )
                tr.setMeta(key, 'reflow')
                view.dispatch(tr)
                return
              }
            })
          }

          schedule()

          // Fonts can finish loading after the editor has rendered, changing
          // line wraps without producing an editor transaction.
          void document.fonts?.ready.then(() => schedule())

          return {
            update() { schedule() },
            destroy() {
              destroyed = true
              cancelAnimationFrame(raf)
            },
          }
        },
      }),
    ]
  },
})
