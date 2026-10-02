import { useEffect } from 'react'
import type { CSSProperties } from 'react'
import type { Editor } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Mathematics } from '@tiptap/extension-mathematics'
import { InkDocument } from './extensions/InkDocument'
import { Page } from './extensions/Page'
import { PenCanvas } from './extensions/PenCanvas'
import { PaginationFlow } from './extensions/PaginationFlow'
import { SlashCommands } from './extensions/SlashCommands'
import { DEFAULT_CONTENT } from '../lib/inkFile'

interface Props {
  viewMode: 'single' | 'spread'
  zoom: number
  onReady: (editor: Editor | null) => void
  onUpdate: () => void
}

export default function InkEditor({ viewMode, zoom, onReady, onUpdate }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ document: false }),
      InkDocument,
      Page,
      PenCanvas,
      PaginationFlow,
      SlashCommands,
      Mathematics.configure({
        inlineOptions: {
          onClick: (node, pos) => {
            const latex = window.prompt('Inline equation (LaTeX)', node.attrs.latex)
            if (latex && editor && !editor.isDestroyed) {
              editor.chain().setNodeSelection(pos).updateInlineMath({ latex }).focus().run()
            }
          },
        },
        blockOptions: {
          onClick: (node, pos) => {
            const latex = window.prompt('Equation (LaTeX)', node.attrs.latex)
            if (latex && editor && !editor.isDestroyed) {
              editor.chain().setNodeSelection(pos).updateBlockMath({ latex }).focus().run()
            }
          },
        },
        katexOptions: { throwOnError: false },
      }),
    ],
    content: DEFAULT_CONTENT,
    autofocus: 'end',
    immediatelyRender: true,
    onUpdate,
    editorProps: {
      attributes: {
        class: 'ink-prosemirror',
        spellcheck: 'true',
      },
    },
  })

  // Keep the parent toolbar synchronized with the editor instance that is
  // actually mounted. This avoids stale/destroyed editor references during
  // React development lifecycles and hot reloads.
  useEffect(() => {
    onReady(editor)
    return () => onReady(null)
  }, [editor, onReady])

  return (
    <main className={`workspace view-${viewMode}`} style={{ '--ink-zoom': zoom } as CSSProperties}>
      <EditorContent editor={editor} />
    </main>
  )
}
