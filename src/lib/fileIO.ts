import { open, save } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'

function inTauri() {
  return '__TAURI_INTERNALS__' in window
}

export async function openInkText(): Promise<{ path: string | null; text: string } | null> {
  if (inTauri()) {
    const path = await open({ multiple: false, directory: false, filters: [{ name: 'Ink document', extensions: ['ink'] }] })
    if (!path || Array.isArray(path)) return null
    return { path, text: await invoke<string>('read_ink_file', { path }) }
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
    await invoke('write_ink_file', { path, text })
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

export async function readInkTextAtPath(path: string): Promise<{ path: string; text: string }> {
  if (!inTauri()) throw new Error('Opening a path directly is only available in the desktop app.')
  return { path, text: await invoke<string>('read_ink_file', { path }) }
}

export async function getStartupInkPath(): Promise<string | null> {
  if (!inTauri()) return null
  return await invoke<string | null>('startup_ink_path')
}
