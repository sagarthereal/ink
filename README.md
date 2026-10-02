# Ink v0.2

Desktop-first WYSIWYG engineering notebook built with React/Vite and a Tauri shell.

## v0.2 interaction model

- `.ink` is the editable source format.
- PDF is the only export format.
- Text supports bold, italic, underline, H1/H2 and lists.
- One compact math button inserts a LaTeX equation.
- Inline freehand drawing canvases use pen, eraser, lasso, colours and stroke width.
- Drawing canvases have a fixed width of two-thirds of the page text area.
- Canvas height can be changed by dragging the bottom handle.
- Left/right canvas alignment lets following text occupy the remaining one-third beside it; centered canvases do not wrap text on either side.
- Single-page and two-page book views are workspace-only choices.
- Page numbers are shown at the bottom of every page.
- Night mode is a display preference and does not make exported PDFs dark.
- Engineering grid paper is a document property and is retained in the `.ink` file / PDF output.

## Browser development

```bash
npm install
npm run dev
```

The browser adapter is intended for most editor development. Tauri can be built separately when native file dialogs/desktop packaging are required.
