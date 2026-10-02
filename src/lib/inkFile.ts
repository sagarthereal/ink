import type { Editor } from '@tiptap/core'
import type { InkFileV1 } from '../types'

export const DEFAULT_CONTENT = {
  type: 'doc',
  content: [
    {
      type: 'page',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Untitled note' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Start writing. Type /canvas and press space to draw.' }] },
      ],
    },
  ],
}

export function makeInkFile(editor: Editor, title: string, createdAt?: string, gridPaper = false): InkFileV1 {
  const now = new Date().toISOString()
  return {
    format: 'ink',
    version: 1,
    title: title || 'Untitled',
    createdAt: createdAt || now,
    updatedAt: now,
    page: {
      size: 'A4',
      orientation: 'portrait',
      marginsMm: { top: 18, right: 18, bottom: 18, left: 18 },
      background: gridPaper ? 'grid' : 'plain',
    },
    content: editor.getJSON(),
  }
}

export function parseInkFile(raw: string): InkFileV1 {
  const parsed = JSON.parse(raw)
  if (parsed?.format !== 'ink' || parsed?.version !== 1 || !parsed?.content) {
    throw new Error('This is not a supported Ink v1 document.')
  }
  return parsed as InkFileV1
}
