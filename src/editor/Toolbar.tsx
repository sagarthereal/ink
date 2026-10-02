import { useEffect, useRef, useState, type MouseEvent } from 'react'
import type { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import type { ThemeMode, ViewMode } from '../types'

interface Props {
  editor: Editor | null
  title: string
  setTitle: (value: string) => void
  viewMode: ViewMode
  setViewMode: (value: ViewMode) => void
  zoom: number
  setZoom: (value: number) => void
  theme: ThemeMode
  setTheme: (value: ThemeMode) => void
  gridPaper: boolean
  setGridPaper: (value: boolean) => void
  dirty: boolean
  onNew: () => void
  onOpen: () => void
  onSave: () => void
  onSaveAs: () => void
  onExportPdf: () => void
}

export default function Toolbar(props: Props) {
  const editor = props.editor && !props.editor.isDestroyed ? props.editor : null
  const [fileMenuOpen, setFileMenuOpen] = useState(false)
  const fileMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!fileMenuOpen) return
    const close = (event: PointerEvent) => {
      if (!fileMenuRef.current?.contains(event.target as Node)) setFileMenuOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [fileMenuOpen])

  const runEditorCommand = (fn: (editor: Editor) => void) => (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    if (!editor) return
    fn(editor)
  }

  const insertCanvas = runEditorCommand(currentEditor => {
    const inserted = currentEditor
      .chain()
      .focus()
      .insertContent([{ type: 'penCanvas' }, { type: 'paragraph' }])
      .run()

    if (!inserted) return

    // After insertion the caret sits in the paragraph following the canvas.
    // Select the nearest canvas before that caret so the new drawing surface
    // becomes active immediately.
    const cursorPos = currentEditor.state.selection.from
    let canvasPos: number | null = null

    currentEditor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'penCanvas' && pos < cursorPos) {
        canvasPos = pos
      }
    })

    if (canvasPos === null) return

    currentEditor
      .chain()
      .setNodeSelection(canvasPos)
      .scrollIntoView()
      .run()

    requestAnimationFrame(() => {
      const nodeDom = currentEditor.view.nodeDOM(canvasPos as number)
      const canvas = nodeDom instanceof HTMLElement
        ? nodeDom.querySelector('canvas')
        : null

      if (canvas instanceof HTMLCanvasElement) {
        canvas.focus({ preventScroll: true })
        canvas.scrollIntoView({
          block: 'center',
          inline: 'nearest',
          behavior: 'smooth',
        })
      }
    })
  })

  const insertMath = (block = false) => {
    if (!editor) return

    const { from, to } = editor.state.selection
    const selectedText = from !== to ? editor.state.doc.textBetween(from, to, ' ') : ''
    const latex = window.prompt(block ? 'Display math (LaTeX)' : 'Inline math (LaTeX)', selectedText || 'F=ma')
    if (!latex) return

    if (!block) {
      editor.chain().focus().insertInlineMath({ latex }).run()
      return
    }

    const insertionAnchor = editor.state.selection.from
    const inserted = editor.chain().focus().insertBlockMath({ latex }).run()
    if (!inserted) return

    // Find the display equation we just inserted. Tiptap's block-math command
    // creates an atomic block node, so we explicitly put a normal paragraph
    // after it (when needed) and place a visible text caret there.
    let equationPos: number | null = null
    let bestDistance = Number.POSITIVE_INFINITY

    editor.state.doc.descendants((node, pos) => {
      if (node.type.name !== 'blockMath') return

      const distance = Math.abs(pos - insertionAnchor)
      if (distance < bestDistance) {
        bestDistance = distance
        equationPos = pos
      }
    })

    if (equationPos === null) return

    const equation = editor.state.doc.nodeAt(equationPos)
    if (!equation) return

    let paragraphPos = equationPos + equation.nodeSize
    let nextNode = editor.state.doc.nodeAt(paragraphPos)

    if (!nextNode?.isTextblock) {
      const paragraph = editor.schema.nodes.paragraph.create()
      const tr = editor.state.tr.insert(paragraphPos, paragraph)
      editor.view.dispatch(tr)
      nextNode = editor.state.doc.nodeAt(paragraphPos)
    }

    if (!nextNode?.isTextblock) return

    const caretPos = paragraphPos + 1
    const tr = editor.state.tr
      .setSelection(TextSelection.create(editor.state.doc, caretPos))
      .scrollIntoView()

    editor.view.dispatch(tr)
    editor.view.focus()
  }

  const editorDisabled = !editor
  const fileAction = (action: () => void) => () => {
    setFileMenuOpen(false)
    action()
  }

  return (
    <header className="app-toolbar no-print">
      <div className="toolbar-row compact-row">
        <div className="file-menu" ref={fileMenuRef}>
          <button
            type="button"
            className={`compact-button file-button ${fileMenuOpen ? 'active' : ''}`}
            onClick={() => setFileMenuOpen(value => !value)}
            aria-expanded={fileMenuOpen}
          >File <span className="caret">▾</span></button>
          {fileMenuOpen && (
            <div className="dropdown-menu">
              <button type="button" onClick={fileAction(props.onNew)}>New <kbd>Ctrl+N</kbd></button>
              <button type="button" onClick={fileAction(props.onOpen)}>Open <kbd>Ctrl+O</kbd></button>
              <div className="dropdown-sep" />
              <button type="button" onClick={fileAction(props.onSave)}>Save <kbd>Ctrl+S</kbd></button>
              <button type="button" onClick={fileAction(props.onSaveAs)}>Save As <kbd>Ctrl+Shift+S</kbd></button>
              <div className="dropdown-sep" />
              <button type="button" onClick={fileAction(props.onExportPdf)}>Export PDF</button>
            </div>
          )}
        </div>

        <input
          className="document-title"
          value={props.title}
          onChange={e => props.setTitle(e.target.value)}
          aria-label="Document title"
        />
        {props.dirty && <span className="save-state dirty">Unsaved</span>}

        <span className="toolbar-sep section-sep" />

        <div className="tool-group format-tools" aria-label="Text formatting">
          <button type="button" disabled={editorDisabled} className={editor?.isActive('bold') ? 'active' : ''} onMouseDown={runEditorCommand(e => e.chain().focus().toggleBold().run())} title="Bold"><strong>B</strong></button>
          <button type="button" disabled={editorDisabled} className={editor?.isActive('italic') ? 'active' : ''} onMouseDown={runEditorCommand(e => e.chain().focus().toggleItalic().run())} title="Italic"><em>I</em></button>
          <button type="button" disabled={editorDisabled} className={editor?.isActive('underline') ? 'active' : ''} onMouseDown={runEditorCommand(e => e.chain().focus().toggleUnderline().run())} title="Underline"><u>U</u></button>
          <button type="button" disabled={editorDisabled} className={editor?.isActive('heading', { level: 1 }) ? 'active' : ''} onMouseDown={runEditorCommand(e => e.chain().focus().toggleHeading({ level: 1 }).run())} title="Heading 1">H1</button>
          <button type="button" disabled={editorDisabled} className={editor?.isActive('heading', { level: 2 }) ? 'active' : ''} onMouseDown={runEditorCommand(e => e.chain().focus().toggleHeading({ level: 2 }).run())} title="Heading 2">H2</button>
          <button type="button" disabled={editorDisabled} className={editor?.isActive('bulletList') ? 'active' : ''} onMouseDown={runEditorCommand(e => e.chain().focus().toggleBulletList().run())} title="Bullet list">•</button>
          <button type="button" disabled={editorDisabled} className={editor?.isActive('orderedList') ? 'active' : ''} onMouseDown={runEditorCommand(e => e.chain().focus().toggleOrderedList().run())} title="Numbered list">1.</button>
        </div>

        <div className="tool-group insert-tools" aria-label="Insert">
          <button type="button" disabled={editorDisabled} onMouseDown={insertCanvas} title="Add drawing canvas">✎</button>
          <button type="button" disabled={editorDisabled} onMouseDown={event => { event.preventDefault(); insertMath(event.shiftKey) }} title="Inline math (Shift+click for display equation)">∑</button>
        </div>

        <span className="toolbar-spacer" />

        <div className="tool-group display-tools" aria-label="Display">
          <button type="button" className={props.gridPaper ? 'active' : ''} onClick={() => props.setGridPaper(!props.gridPaper)} title="Engineering grid paper">▦</button>
          <button type="button" className={props.theme === 'dark' ? 'active' : ''} onClick={() => props.setTheme(props.theme === 'dark' ? 'light' : 'dark')} title="Night mode">{props.theme === 'dark' ? '☀' : '☾'}</button>
        </div>

        <div className="tool-group view-tools" aria-label="Page view">
          <button type="button" className={props.viewMode === 'single' ? 'active' : ''} onClick={() => props.setViewMode('single')} title="Single page">▯</button>
          <button type="button" className={props.viewMode === 'spread' ? 'active' : ''} onClick={() => props.setViewMode('spread')} title="Two-page view">▯▯</button>
        </div>

        <div className="zoom-tools">
          <button type="button" className="compact-button" onClick={() => props.setZoom(Math.max(0.55, +(props.zoom - 0.1).toFixed(2)))} title="Zoom out">−</button>
          <span className="zoom-label">{Math.round(props.zoom * 100)}%</span>
          <button type="button" className="compact-button" onClick={() => props.setZoom(Math.min(1.4, +(props.zoom + 0.1).toFixed(2)))} title="Zoom in">+</button>
        </div>
      </div>
    </header>
  )
}
