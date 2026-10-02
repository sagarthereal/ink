import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'

const key = new PluginKey('inkPaginationFlow')
const EPSILON = 2

type PageInfo = { node: PMNode; pos: number }

function pagesIn(doc: PMNode): PageInfo[] {
  const pages: PageInfo[] = []
  doc.forEach((node, offset) => {
    if (node.type.name === 'page') pages.push({ node, pos: offset })
  })
  return pages
}

function usedHeight(body: HTMLElement) {
  const children = Array.from(body.children) as HTMLElement[]
  if (!children.length) return 0
  const root = body.getBoundingClientRect()
  return Math.max(...children.map(child => child.getBoundingClientRect().bottom - root.top))
}

function outerHeight(el: HTMLElement) {
  const rect = el.getBoundingClientRect()
  const style = getComputedStyle(el)
  return rect.height + parseFloat(style.marginTop || '0') + parseFloat(style.marginBottom || '0')
}

export const PaginationFlow = Extension.create({
  name: 'inkPaginationFlow',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key,
        view(view) {
          let raf = 0

          const schedule = () => {
            cancelAnimationFrame(raf)
            raf = requestAnimationFrame(() => {
              const state = view.state
              const pages = pagesIn(state.doc)
              const bodies = Array.from(view.dom.querySelectorAll<HTMLElement>('[data-ink-page-body]'))
              if (!pages.length || pages.length !== bodies.length) return

              // Overflow: move one complete top-level block forward at a time.
              // Bounding rectangles are used instead of scrollHeight so floated
              // left/right drawing canvases are counted correctly.
              for (let i = 0; i < pages.length; i += 1) {
                const body = bodies[i]
                const page = pages[i]
                if (usedHeight(body) <= body.clientHeight + EPSILON || page.node.childCount <= 1) continue

                const last = page.node.lastChild
                if (!last) continue
                const lastStart = page.pos + 1 + page.node.content.size - last.nodeSize
                const tr = state.tr.delete(lastStart, lastStart + last.nodeSize)

                if (i + 1 < pages.length) {
                  const next = pages[i + 1]
                  const adjustedNextStart = next.pos - last.nodeSize + 1
                  tr.insert(adjustedNextStart, last)
                } else {
                  const pageType = state.schema.nodes.page
                  const newPage = pageType.create(null, last)
                  const afterCurrent = page.pos + page.node.nodeSize - last.nodeSize
                  tr.insert(afterCurrent, newPage)
                }

                tr.setMeta(key, 'reflow')
                view.dispatch(tr)
                return
              }

              // Pull a complete block back when the previous page has enough room.
              for (let i = 0; i < pages.length - 1; i += 1) {
                const body = bodies[i]
                const nextBody = bodies[i + 1]
                const page = pages[i]
                const next = pages[i + 1]
                const first = next.node.firstChild
                const firstEl = nextBody.firstElementChild as HTMLElement | null
                if (!first || !firstEl) continue

                const spare = body.clientHeight - usedHeight(body)
                if (spare < outerHeight(firstEl) + 6) continue

                const insertPos = page.pos + 1 + page.node.content.size
                const tr = state.tr
                if (next.node.childCount === 1) {
                  tr.delete(next.pos, next.pos + next.node.nodeSize)
                } else {
                  tr.delete(next.pos + 1, next.pos + 1 + first.nodeSize)
                }
                tr.insert(insertPos, first)
                tr.setMeta(key, 'reflow')
                view.dispatch(tr)
                return
              }
            })
          }

          schedule()
          return {
            update() { schedule() },
            destroy() { cancelAnimationFrame(raf) },
          }
        },
      }),
    ]
  },
})
