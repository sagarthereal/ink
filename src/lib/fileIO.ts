import { open, save } from '@tauri-apps/plugin-dialog'
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'

function inTauri() {
  return '__TAURI_INTERNALS__' in window
}

export async function openInkText(): Promise<{ path: string | null; text: string } | null> {
  if (inTauri()) {
    const path = await open({ multiple: false, directory: false, filters: [{ name: 'Ink document', extensions: ['ink'] }] })
    if (!path || Array.isArray(path)) return null
    return { path, text: await readTextFile(path) }
  }

  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.ink,application/json'
    input.onchange = async () => {
      const file = input.files?.[0]
      resolve(file ? { path: null, text: await file.text() } : null)
    }
    input.click()
  })
}

export async function saveInkText(text: string, title: string, currentPath: string | null, forceDialog = false): Promise<string | null> {
  if (inTauri()) {
    let path = currentPath
    if (!path || forceDialog) {
      path = await save({ defaultPath: `${title || 'Untitled'}.ink`, filters: [{ name: 'Ink document', extensions: ['ink'] }] })
      if (!path) return currentPath
      if (!path.toLowerCase().endsWith('.ink')) path += '.ink'
    }
    await writeTextFile(path, text)
    return path
  }

  const blob = new Blob([text], { type: 'application/json' })
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href
  a.download = `${title || 'Untitled'}.ink`
  a.click()
  URL.revokeObjectURL(href)
  return currentPath
}
