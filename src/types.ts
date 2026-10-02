import type { JSONContent } from '@tiptap/core'

export type ViewMode = 'single' | 'spread'
export type ThemeMode = 'light' | 'dark'

export interface InkFileV1 {
  format: 'ink'
  version: 1
  title: string
  createdAt: string
  updatedAt: string
  page: {
    size: 'A4'
    orientation: 'portrait'
    marginsMm: { top: number; right: number; bottom: number; left: number }
    background?: 'plain' | 'grid'
  }
  content: JSONContent
}
