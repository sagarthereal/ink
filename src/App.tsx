import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import InkEditor from './editor/InkEditor'
import Toolbar from './editor/Toolbar'
import { DEFAULT_CONTENT, makeInkFile, parseInkFile } from './lib/inkFile'
import { openInkText, saveInkText } from './lib/fileIO'
import type { ThemeMode, ViewMode } from './types'

function inTauri() {
  return '__TAURI_INTERNALS__' in window
}

function titleFromPath(path: string | null) {
  if (!path) return null
  const fileName = path.split(/[\\/]/).pop()
  if (!fileName) return null
  return fileName.replace(/\.ink$/i, '') || null
}

export default function App() {
  const [editor, setEditor] = useState<Editor | null>(null)
  const [title, setTitle] = useState('Untitled')
  const [currentPath, setCurrentPath] = useState<string | null>(null)
  const [createdAt, setCreatedAt] = useState<string | undefined>()
  const [dirty, setDirty] = useState(false)
  const [, setEditorRevision] = useState(0)
  const [viewMode, setViewModeState] = useState<ViewMode>(() => (localStorage.getItem('ink:viewMode') as ViewMode) || 'single')
  const [zoom, setZoomState] = useState(() => Number(localStorage.getItem('ink:zoom') || 0.9))
  const [theme, setThemeState] = useState<ThemeMode>(() => (localStorage.getItem('ink:theme') as ThemeMode) || 'light')
  const [gridPaper, setGridPaper] = useState(false)
  const autosaveTimer = useRef<number | null>(null)

  const setViewMode = (mode: ViewMode) => { setViewModeState(mode); localStorage.setItem('ink:viewMode', mode) }
  const setZoom = (value: number) => { setZoomState(value); localStorage.setItem('ink:zoom', String(value)) }
  const setTheme = (value: ThemeMode) => { setThemeState(value); localStorage.setItem('ink:theme', value) }

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.dispatchEvent(new CustomEvent('ink-theme-change'))
  }, [theme])

  useEffect(() => {
    const windowTitle = title.trim() || 'Untitled'
    document.title = windowTitle
    if (inTauri()) void getCurrentWindow().setTitle(windowTitle)
  }, [title])

  const newDocument = () => {
    if (!editor) return
    if (dirty && !window.confirm('Discard unsaved changes?')) return
    editor.commands.setContent(DEFAULT_CONTENT)
    setTitle('Untitled')
    setCurrentPath(null)
    setCreatedAt(undefined)
    setGridPaper(false)
    setDirty(false)
  }

  const openDocument = async () => {
    if (!editor) return
    if (dirty && !window.confirm('Discard unsaved changes?')) return
    try {
      const result = await openInkText()
      if (!result) return
      const file = parseInkFile(result.text)
      editor.commands.setContent(file.content)
      setTitle(titleFromPath(result.path) || file.title || 'Untitled')
      setCurrentPath(result.path)
      setCreatedAt(file.createdAt)
      setGridPaper(file.page?.background === 'grid')
      setDirty(false)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not open the file.')
    }
  }

  const saveDocument = async (forceDialog = false) => {
    if (!editor) return
    try {
      const file = makeInkFile(editor, title, createdAt, gridPaper)
      const path = await saveInkText(JSON.stringify(file, null, 2), title, currentPath, forceDialog)
      if (path !== null || !inTauri()) {
        const savedTitle = titleFromPath(path) || title || 'Untitled'

        // On the first Save As, make the file name the document title as well.
        // Rewrite once so the title stored inside the .ink file matches what the UI shows.
        if (path && savedTitle !== title) {
          const renamedFile = makeInkFile(editor, savedTitle, file.createdAt, gridPaper)
          await saveInkText(JSON.stringify(renamedFile, null, 2), savedTitle, path, false)
          setTitle(savedTitle)
        }

        setCurrentPath(path)
        setCreatedAt(file.createdAt)
        setDirty(false)
      }
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not save the file.')
    }
  }

  useEffect(() => {
    if (!dirty || !currentPath || !editor) return
    if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current)
    autosaveTimer.current = window.setTimeout(() => void saveDocument(false), 900)
    return () => { if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, currentPath, title, editor, gridPaper])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); void saveDocument(e.shiftKey) }
      if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); void openDocument() }
      if (mod && e.key.toLowerCase() === 'n') { e.preventDefault(); newDocument() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className={`app-shell ${gridPaper ? 'grid-paper' : ''}`}>
      <Toolbar
        editor={editor}
        title={title}
        setTitle={value => { setTitle(value); setDirty(true) }}
        viewMode={viewMode}
        setViewMode={setViewMode}
        zoom={zoom}
        setZoom={setZoom}
        theme={theme}
        setTheme={setTheme}
        gridPaper={gridPaper}
        setGridPaper={value => { setGridPaper(value); setDirty(true) }}
        dirty={dirty}
        onNew={newDocument}
        onOpen={() => void openDocument()}
        onSave={() => void saveDocument(false)}
        onSaveAs={() => void saveDocument(true)}
        onExportPdf={() => window.print()}
      />
      <InkEditor
        viewMode={viewMode}
        zoom={zoom}
        onReady={setEditor}
        onUpdate={() => {
          setDirty(true)
          setEditorRevision(value => value + 1)
        }}
      />
    </div>
  )
}
