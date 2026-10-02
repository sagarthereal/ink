import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Node, mergeAttributes, nodeInputRule } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'

interface Point { x: number; y: number; pressure: number }
interface Stroke { id: string; color: string; width: number; points: Point[] }
type Tool = 'pen' | 'eraser' | 'lasso'
type CanvasAlignment = 'left' | 'center' | 'right'

const PEN_COLORS = [
  { name: 'ink', label: 'Ink', dark: '#010101', light: '#E7E4DA' },
  { name: 'blue', label: 'Blue', dark: '#303364', light: '#A9B9E6' },
  { name: 'red', label: 'Red', dark: '#973251', light: '#F09E97' },
  { name: 'green', label: 'Green', dark: '#1E6460', light: '#8EDDCF' },
  { name: 'orange', label: 'Orange', dark: '#892300', light: '#F7B98F' },
  { name: 'grey', label: 'Grey', dark: '#6D6958', light: '#B8C3C1' },
] as const

const LIGHT_EQUIVALENT = new Map<string, string>(
  PEN_COLORS.map(entry => [entry.dark.toUpperCase(), entry.light] as const),
)

function themedStrokeColor(color: string, dark: boolean) {
  if (!dark) return color
  return LIGHT_EQUIVALENT.get(String(color).toUpperCase()) || color
}
const MIN_HEIGHT = 120
const MAX_HEIGHT = 720

function id() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function strokeBounds(stroke: Stroke) {
  const xs = stroke.points.map(p => p.x)
  const ys = stroke.points.map(p => p.y)
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) }
}

function PenCanvasView({ node, updateAttributes, selected }: NodeViewProps) {
  const savedHeight = Number(node.attrs.height || 280)
  const alignment = (node.attrs.alignment || 'center') as CanvasAlignment
  const [canvasHeight, setCanvasHeight] = useState(savedHeight)
  const [tool, setTool] = useState<Tool>('pen')
  const [color, setColor] = useState(PEN_COLORS[0].dark)
  const [width, setWidth] = useState(2)
  const [strokes, setStrokes] = useState<Stroke[]>(() => node.attrs.strokes || [])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [lasso, setLasso] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const currentStroke = useRef<Stroke | null>(null)
  const drag = useRef<{ startX: number; startY: number; original: Stroke[] } | null>(null)
  const resize = useRef<{ startY: number; startHeight: number; currentHeight: number } | null>(null)
  const [active, setActive] = useState(false)

  useEffect(() => setStrokes(node.attrs.strokes || []), [node.attrs.strokes])
  useEffect(() => {
    if (!resize.current) setCanvasHeight(savedHeight)
  }, [savedHeight])

  const selectedBounds = useMemo(() => {
    const chosen = strokes.filter(s => selectedIds.includes(s.id))
    if (!chosen.length) return null
    const boxes = chosen.map(strokeBounds)
    return {
      left: Math.min(...boxes.map(b => b.left)), right: Math.max(...boxes.map(b => b.right)),
      top: Math.min(...boxes.map(b => b.top)), bottom: Math.max(...boxes.map(b => b.bottom)),
    }
  }, [strokes, selectedIds])

  const render = (forceLight = false) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const w = Math.max(1, rect.width)
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(canvasHeight * dpr)) {
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(canvasHeight * dpr)
    }
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, canvasHeight)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    const dark = !forceLight && document.documentElement.dataset.theme === 'dark'

    for (const stroke of strokes) {
      if (stroke.points.length < 2) continue
      const selectedStroke = selectedIds.includes(stroke.id)
      for (let i = 1; i < stroke.points.length; i += 1) {
        const a = stroke.points[i - 1]
        const b = stroke.points[i]
        ctx.beginPath()
        ctx.moveTo(a.x * w, a.y * canvasHeight)
        ctx.lineTo(b.x * w, b.y * canvasHeight)
        ctx.strokeStyle = selectedStroke ? (dark ? '#8EDDCF' : '#137F7B') : themedStrokeColor(stroke.color, dark)
        ctx.lineWidth = stroke.width * (0.75 + Math.max(0.15, b.pressure) * 0.45)
        ctx.stroke()
      }
    }
  }

  useEffect(() => {
    render()
    const observer = new ResizeObserver(() => render())
    if (canvasRef.current) observer.observe(canvasRef.current)
    const onTheme = () => render()
    const onBeforePrint = () => render(true)
    const onAfterPrint = () => render(false)
    window.addEventListener('ink-theme-change', onTheme)
    window.addEventListener('beforeprint', onBeforePrint)
    window.addEventListener('afterprint', onAfterPrint)
    return () => {
      observer.disconnect()
      window.removeEventListener('ink-theme-change', onTheme)
      window.removeEventListener('beforeprint', onBeforePrint)
      window.removeEventListener('afterprint', onAfterPrint)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strokes, selectedIds, canvasHeight])

  const pointFromEvent = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
      pressure: e.pointerType === 'pen' ? (e.pressure || 0.5) : 0.5,
    }
  }

  const commit = (next: Stroke[]) => {
    setStrokes(next)
    updateAttributes({ strokes: next })
  }

  const eraseAt = (p: Point) => {
    const radius = 0.018
    const next = strokes.filter(stroke => !stroke.points.some(pt => Math.hypot(pt.x - p.x, pt.y - p.y) < radius))
    if (next.length !== strokes.length) commit(next)
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    setActive(true)
    const p = pointFromEvent(e)

    if (tool === 'pen') {
      setSelectedIds([])
      const stroke: Stroke = { id: id(), color, width, points: [p] }
      currentStroke.current = stroke
      setStrokes(prev => [...prev, stroke])
      return
    }

    if (tool === 'eraser') {
      setSelectedIds([])
      eraseAt(p)
      return
    }

    if (selectedBounds && p.x >= selectedBounds.left && p.x <= selectedBounds.right && p.y >= selectedBounds.top && p.y <= selectedBounds.bottom) {
      drag.current = { startX: p.x, startY: p.y, original: strokes }
    } else {
      setSelectedIds([])
      setLasso({ x1: p.x, y1: p.y, x2: p.x, y2: p.y })
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    const p = pointFromEvent(e)

    if (tool === 'pen' && currentStroke.current) {
      currentStroke.current = { ...currentStroke.current, points: [...currentStroke.current.points, p] }
      const current = currentStroke.current
      setStrokes(prev => [...prev.filter(s => s.id !== current.id), current])
      return
    }

    if (tool === 'eraser') {
      eraseAt(p)
      return
    }

    if (drag.current) {
      const dx = p.x - drag.current.startX
      const dy = p.y - drag.current.startY
      const next = drag.current.original.map(stroke => selectedIds.includes(stroke.id)
        ? { ...stroke, points: stroke.points.map(pt => ({ ...pt, x: pt.x + dx, y: pt.y + dy })) }
        : stroke)
      setStrokes(next)
      return
    }

    if (lasso) setLasso({ ...lasso, x2: p.x, y2: p.y })
  }

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = pointFromEvent(e)
    if (tool === 'pen' && currentStroke.current) {
      const final = { ...currentStroke.current, points: [...currentStroke.current.points, p] }
      currentStroke.current = null
      commit([...strokes.filter(s => s.id !== final.id), final])
    } else if (tool === 'lasso' && drag.current) {
      drag.current = null
      commit(strokes)
    } else if (tool === 'lasso' && lasso) {
      const left = Math.min(lasso.x1, lasso.x2), right = Math.max(lasso.x1, lasso.x2)
      const top = Math.min(lasso.y1, lasso.y2), bottom = Math.max(lasso.y1, lasso.y2)
      const ids = strokes.filter(stroke => {
        const b = strokeBounds(stroke)
        return b.right >= left && b.left <= right && b.bottom >= top && b.top <= bottom
      }).map(s => s.id)
      setSelectedIds(ids)
      setLasso(null)
    }
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* already released */ }
  }

  const stopToolbarPointer = (e: React.PointerEvent | React.MouseEvent) => e.stopPropagation()

  const onResizePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    resize.current = { startY: e.clientY, startHeight: canvasHeight, currentHeight: canvasHeight }
    setActive(true)
  }

  const onResizePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!resize.current || !e.currentTarget.hasPointerCapture(e.pointerId)) return
    e.preventDefault()
    const next = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, resize.current.startHeight + (e.clientY - resize.current.startY)))
    resize.current.currentHeight = Math.round(next)
    setCanvasHeight(Math.round(next))
  }

  const onResizePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!resize.current) return
    e.preventDefault()
    e.stopPropagation()
    const nextHeight = resize.current.currentHeight
    resize.current = null
    updateAttributes({ height: nextHeight })
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* already released */ }
  }

  return (
    <NodeViewWrapper className={`pen-canvas-node align-${alignment} ${(selected || active) ? 'is-active' : ''}`} contentEditable={false}>
      <div
        className="canvas-toolbar no-print"
        onPointerDown={stopToolbarPointer}
        onMouseDown={stopToolbarPointer}
        onDragStart={e => e.preventDefault()}
      >
        <button type="button" className={tool === 'pen' ? 'active' : ''} onClick={() => setTool('pen')} title="Pen" aria-label="Pen">✎</button>
        <button type="button" className={tool === 'eraser' ? 'active' : ''} onClick={() => setTool('eraser')} title="Eraser" aria-label="Eraser">⌫</button>
        <button type="button" className={tool === 'lasso' ? 'active' : ''} onClick={() => setTool('lasso')} title="Lasso" aria-label="Lasso">⌗</button>
        <span className="toolbar-sep" />
        {PEN_COLORS.map(entry => <button key={entry.name} type="button" aria-label={`Pen ${entry.label}`} className={`color-dot ${color === entry.dark ? 'selected' : ''}`} style={{ background: entry.dark }} onClick={() => { setColor(entry.dark); setTool('pen') }} />)}
        <span className="toolbar-sep" />
        <input
          aria-label="Pen thickness"
          title="Pen thickness"
          type="range"
          min="1"
          max="8"
          step="0.5"
          value={width}
          onPointerDown={e => e.stopPropagation()}
          onMouseDown={e => e.stopPropagation()}
          onChange={e => setWidth(Number(e.target.value))}
        />
        <span className="toolbar-sep" />
        <div className="canvas-align-group" aria-label="Canvas alignment">
          <button type="button" className={alignment === 'left' ? 'active' : ''} onClick={() => updateAttributes({ alignment: 'left' })} title="Align canvas left">L</button>
          <button type="button" className={alignment === 'center' ? 'active' : ''} onClick={() => updateAttributes({ alignment: 'center' })} title="Center canvas">C</button>
          <button type="button" className={alignment === 'right' ? 'active' : ''} onClick={() => updateAttributes({ alignment: 'right' })} title="Align canvas right">R</button>
        </div>
        <button type="button" onClick={() => { commit([]); setSelectedIds([]) }} title="Clear canvas" aria-label="Clear canvas">×</button>
      </div>
      <div className="canvas-surface" style={{ height: canvasHeight }} onPointerLeave={() => { if (!resize.current) setActive(false) }}>
        <canvas ref={canvasRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} />
        {lasso && <div className="lasso-box" style={{ left: `${Math.min(lasso.x1, lasso.x2) * 100}%`, top: `${Math.min(lasso.y1, lasso.y2) * 100}%`, width: `${Math.abs(lasso.x2 - lasso.x1) * 100}%`, height: `${Math.abs(lasso.y2 - lasso.y1) * 100}%` }} />}
        <div
          className="canvas-resize-handle no-print"
          title="Drag to change canvas height"
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerUp}
        ><span /></div>
      </div>
    </NodeViewWrapper>
  )
}

export const PenCanvas = Node.create({
  name: 'penCanvas',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      strokes: { default: [] },
      height: { default: 280 },
      alignment: { default: 'center' },
    }
  },

  parseHTML() { return [{ tag: 'div[data-ink-canvas]' }] },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-ink-canvas': 'true' })]
  },

  addNodeView() { return ReactNodeViewRenderer(PenCanvasView) },

  addInputRules() {
    return [nodeInputRule({ find: /^\/canvas\s$/, type: this.type })]
  },
})
