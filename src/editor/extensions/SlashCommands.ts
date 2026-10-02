import { Extension, InputRule } from '@tiptap/core'

export const SlashCommands = Extension.create({
  name: 'inkSlashCommands',

  addInputRules() {
    return [
      new InputRule({
        find: /^\/equation\s$/,
        handler: ({ state, range }) => {
          const latex = window.prompt('Equation (LaTeX)', 'F=ma')
          const tr = state.tr.delete(range.from, range.to)
          if (latex) {
            const type = state.schema.nodes.blockMath
            if (type) tr.insert(range.from, type.create({ latex }))
          }
        },
      }),
    ]
  },
})
