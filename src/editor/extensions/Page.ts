import { Node, mergeAttributes } from '@tiptap/core'

export const Page = Node.create({
  name: 'page',
  content: 'block*',
  defining: true,
  isolating: true,

  parseHTML() {
    return [{ tag: 'section[data-ink-page]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'section',
      mergeAttributes(HTMLAttributes, { 'data-ink-page': 'true', class: 'ink-page' }),
      ['div', { 'data-ink-page-body': 'true', class: 'ink-page-body' }, 0],
    ]
  },
})
