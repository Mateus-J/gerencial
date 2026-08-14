import { useEffect, useRef, useState, useCallback } from 'react'
import { Stage, Layer, Rect, Ellipse, Arrow, Line, Text, Transformer } from 'react-konva'
import {
  MousePointer2, StickyNote, Square, Circle, Type, MoveUpRight, Pencil,
  Trash2, Copy, ZoomIn, ZoomOut, Maximize2, Eraser,
} from 'lucide-react'

const TOOLS = [
  { id: 'select', label: 'Selecionar', icon: MousePointer2 },
  { id: 'note', label: 'Nota', icon: StickyNote },
  { id: 'rect', label: 'Retângulo', icon: Square },
  { id: 'ellipse', label: 'Elipse', icon: Circle },
  { id: 'arrow', label: 'Seta', icon: MoveUpRight },
  { id: 'text', label: 'Texto', icon: Type },
  { id: 'draw', label: 'Caneta', icon: Pencil },
]
const FILL_COLORS = ['#fde68a', '#a7f3d0', '#bfdbfe', '#fecaca', '#e9d5ff', '#fed7aa', '#e5e7eb']
const STROKE_COLORS = ['#111827', '#dc2626', '#2563eb', '#16a34a', '#9333ea', '#d97706']

function newId(prefix) { return prefix + Date.now() + Math.random().toString(36).slice(2, 6) }

export default function BoardCanvas({ board, onSave }) {
  const savedItems = board.canvasItems || []
  const [draftItems, setDraftItems] = useState(null) // overrides savedItems só durante criação/desenho ativo
  const items = draftItems || savedItems
  const containerRef = useRef(null)
  const stageRef = useRef(null)
  const layerRef = useRef(null)
  const trRef = useRef(null)
  const shapeRefs = useRef({})

  const [size, setSize] = useState({ width: 800, height: 600 })
  const [tool, setTool] = useState('select')
  const [selectedId, setSelectedId] = useState(null)
  const [zoomPct, setZoomPct] = useState(100)
  const [editingText, setEditingText] = useState(null) // {id, x, y, width, fontSize, value}
  const drawing = useRef(null) // shape sendo criada no momento

  // Redimensiona o Stage pro tamanho do container
  useEffect(() => {
    function resize() {
      if (!containerRef.current) return
      setSize({ width: containerRef.current.offsetWidth, height: 600 })
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  // Liga o Transformer no shape selecionado
  useEffect(() => {
    if (!trRef.current) return
    const node = selectedId ? shapeRefs.current[selectedId] : null
    if (node) {
      trRef.current.nodes([node])
      trRef.current.getLayer().batchDraw()
    } else {
      trRef.current.nodes([])
    }
  }, [selectedId, items])

  const persist = useCallback((next) => {
    onSave({ ...board, canvasItems: next })
  }, [board, onSave])

  function updateItem(id, patch, save = true) {
    const next = items.map((i) => i.id === id ? { ...i, ...patch } : i)
    if (save) persist(next)
    return next
  }
  function addItem(item) {
    persist([...items, item])
    setSelectedId(item.id)
  }
  function removeSelected() {
    if (!selectedId) return
    persist(items.filter((i) => i.id !== selectedId))
    setSelectedId(null)
  }
  function duplicateSelected() {
    const it = items.find((i) => i.id === selectedId)
    if (!it) return
    const copy = { ...it, id: newId('c'), x: (it.x || 0) + 24, y: (it.y || 0) + 24 }
    if (copy.points) copy.points = copy.points.map((p, i) => i % 2 === 0 ? p + 24 : p + 24)
    addItem(copy)
  }

  // Atalhos: Delete/Backspace remove, Ctrl/Cmd+D duplica
  useEffect(() => {
    function onKey(e) {
      if (!selectedId) return
      if (document.activeElement?.tagName === 'TEXTAREA') return
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSelected() }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelected() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId, items])

  function relPointer() {
    const stage = stageRef.current
    return stage.getRelativePointerPosition()
  }

  function handleStageMouseDown(e) {
    const stage = stageRef.current
    const clickedEmpty = e.target === stage
    if (tool === 'select') {
      if (clickedEmpty) setSelectedId(null)
      return
    }
    const pos = relPointer()
    if (tool === 'note') {
      addItem({ id: newId('n'), type: 'note', x: pos.x - 90, y: pos.y - 65, width: 180, height: 130, fill: FILL_COLORS[items.length % FILL_COLORS.length], text: '' })
      setTool('select')
      return
    }
    if (tool === 'text') {
      addItem({ id: newId('t'), type: 'text', x: pos.x, y: pos.y, width: 160, fontSize: 18, fill: '#111827', text: 'Texto' })
      setTool('select')
      return
    }
    if (tool === 'rect' || tool === 'ellipse') {
      drawing.current = { id: newId(tool[0]), type: tool, x: pos.x, y: pos.y, startX: pos.x, startY: pos.y, width: 1, height: 1, fill: FILL_COLORS[0], stroke: STROKE_COLORS[0] }
      setDraftItems([...items, drawing.current])
      return
    }
    if (tool === 'arrow') {
      drawing.current = { id: newId('a'), type: 'arrow', points: [pos.x, pos.y, pos.x, pos.y], stroke: STROKE_COLORS[0], strokeWidth: 3 }
      setDraftItems([...items, drawing.current])
      return
    }
    if (tool === 'draw') {
      drawing.current = { id: newId('d'), type: 'draw', points: [pos.x, pos.y], stroke: STROKE_COLORS[0], strokeWidth: 3 }
      setDraftItems([...items, drawing.current])
      return
    }
  }

  function handleStageMouseMove() {
    if (!drawing.current) return
    const pos = relPointer()
    const d = drawing.current
    if (d.type === 'rect' || d.type === 'ellipse') {
      const width = pos.x - d.startX, height = pos.y - d.startY
      d.x = width < 0 ? pos.x : d.startX
      d.y = height < 0 ? pos.y : d.startY
      d.width = Math.max(2, Math.abs(width))
      d.height = Math.max(2, Math.abs(height))
    } else if (d.type === 'arrow') {
      d.points = [d.points[0], d.points[1], pos.x, pos.y]
    } else if (d.type === 'draw') {
      d.points = [...d.points, pos.x, pos.y]
    }
    // Só atualiza a tela (local) durante o movimento — grava no Firestore uma vez só, ao soltar
    setDraftItems((prev) => prev.map((i) => i.id === d.id ? { ...d } : i))
  }

  function handleStageMouseUp() {
    if (drawing.current) {
      const id = drawing.current.id
      const finalItems = draftItems
      drawing.current = null
      setDraftItems(null)
      if (finalItems) persist(finalItems)
      setSelectedId(id)
      setTool('select')
    }
  }

  function handleWheel(e) {
    e.evt.preventDefault()
    const stage = stageRef.current
    const oldScale = stage.scaleX()
    const pointer = stage.getPointerPosition()
    const mousePointTo = { x: (pointer.x - stage.x()) / oldScale, y: (pointer.y - stage.y()) / oldScale }
    const scaleBy = 1.06
    let newScale = e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy
    newScale = Math.max(0.2, Math.min(4, newScale))
    stage.scale({ x: newScale, y: newScale })
    stage.position({ x: pointer.x - mousePointTo.x * newScale, y: pointer.y - mousePointTo.y * newScale })
    stage.batchDraw()
    setZoomPct(Math.round(newScale * 100))
  }

  function zoomBy(factor) {
    const stage = stageRef.current
    const oldScale = stage.scaleX()
    const center = { x: size.width / 2, y: size.height / 2 }
    const mousePointTo = { x: (center.x - stage.x()) / oldScale, y: (center.y - stage.y()) / oldScale }
    const newScale = Math.max(0.2, Math.min(4, oldScale * factor))
    stage.scale({ x: newScale, y: newScale })
    stage.position({ x: center.x - mousePointTo.x * newScale, y: center.y - mousePointTo.y * newScale })
    stage.batchDraw()
    setZoomPct(Math.round(newScale * 100))
  }
  function resetZoom() {
    const stage = stageRef.current
    stage.scale({ x: 1, y: 1 })
    stage.position({ x: 0, y: 0 })
    stage.batchDraw()
    setZoomPct(100)
  }

  // ── Edição de texto (nota / texto livre) via textarea flutuante ──
  function startEditText(item) {
    const stage = stageRef.current
    const scale = stage.scaleX()
    const stageBox = stage.container().getBoundingClientRect()
    const abs = { x: stageBox.left + item.x * scale + stage.x(), y: stageBox.top + item.y * scale + stage.y() }
    setEditingText({
      id: item.id,
      style: {
        left: abs.x, top: abs.y,
        width: (item.width || 160) * scale,
        height: item.type === 'note' ? (item.height - 20) * scale : 30 * scale,
        fontSize: (item.fontSize || 14) * scale,
      },
      value: item.text || '',
    })
  }
  function commitEditText() {
    if (!editingText) return
    updateItem(editingText.id, { text: editingText.value })
    setEditingText(null)
  }

  function setSelectedProp(patch) {
    if (!selectedId) return
    updateItem(selectedId, patch)
  }

  const selectedItem = items.find((i) => i.id === selectedId)

  return (
    <div>
      {/* Toolbar de ferramentas */}
      <div className="flex flex-wrap items-center gap-1.5 mb-2 bg-[var(--sur)] border border-[var(--bdr)] rounded-xl p-1.5 w-fit">
        {TOOLS.map((t) => {
          const Icon = t.icon
          return (
            <button
              key={t.id}
              onClick={() => setTool(t.id)}
              title={t.label}
              className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${tool === t.id ? 'bg-id-dark text-white' : 'text-[var(--tx2)] hover:bg-[var(--sur2)]'}`}
            >
              <Icon size={15} />
            </button>
          )
        })}
        <div className="w-px h-5 bg-[var(--bdr)] mx-1" />
        <button onClick={() => { if (confirm('Limpar o canvas inteiro?')) { persist([]); setSelectedId(null) } }} title="Limpar tudo" className="w-8 h-8 flex items-center justify-center rounded-lg text-[var(--tx2)] hover:bg-[var(--sur2)]">
          <Eraser size={15} />
        </button>
      </div>

      {/* Barra de propriedades do item selecionado */}
      {selectedItem && (
        <div className="flex items-center gap-2 mb-2 bg-[var(--sur)] border border-[var(--bdr)] rounded-xl p-1.5 w-fit">
          {(selectedItem.type === 'note' || selectedItem.type === 'rect' || selectedItem.type === 'ellipse') && (
            <div className="flex gap-1 items-center pr-1.5 border-r border-[var(--bdr)]">
              {FILL_COLORS.map((c) => (
                <button key={c} onClick={() => setSelectedProp({ fill: c })} className="w-4 h-4 rounded-full border border-black/10" style={{ background: c }} />
              ))}
            </div>
          )}
          {(selectedItem.type === 'arrow' || selectedItem.type === 'draw' || selectedItem.type === 'rect' || selectedItem.type === 'ellipse' || selectedItem.type === 'text') && (
            <div className="flex gap-1 items-center pr-1.5 border-r border-[var(--bdr)]">
              {STROKE_COLORS.map((c) => (
                <button key={c} onClick={() => setSelectedProp(selectedItem.type === 'text' ? { fill: c } : { stroke: c })} className="w-4 h-4 rounded-full border border-black/10" style={{ background: c }} />
              ))}
            </div>
          )}
          <button onClick={duplicateSelected} title="Duplicar (Ctrl+D)" className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--tx2)] hover:bg-[var(--sur2)]"><Copy size={13} /></button>
          <button onClick={removeSelected} title="Excluir (Del)" className="w-7 h-7 flex items-center justify-center rounded-lg text-red-500 hover:bg-red-500/10"><Trash2 size={13} /></button>
        </div>
      )}

      <div ref={containerRef} className="relative w-full border border-[var(--bdr)] rounded-xl overflow-hidden bg-[var(--sur)]" style={{ height: 600 }}>
        <Stage
          ref={stageRef}
          width={size.width}
          height={size.height}
          draggable={tool === 'select'}
          onMouseDown={handleStageMouseDown}
          onMouseMove={handleStageMouseMove}
          onMouseUp={handleStageMouseUp}
          onWheel={handleWheel}
          style={{ cursor: tool === 'select' ? 'default' : 'crosshair', background: 'var(--sur)', backgroundImage: 'radial-gradient(var(--bdr) 1px, transparent 1px)', backgroundSize: '20px 20px' }}
        >
          <Layer ref={layerRef}>
            {items.map((item) => (
              <CanvasShape
                key={item.id}
                item={item}
                isSelected={item.id === selectedId}
                tool={tool}
                setRef={(node) => { shapeRefs.current[item.id] = node }}
                onSelect={() => tool === 'select' && setSelectedId(item.id)}
                onDblClick={() => (item.type === 'note' || item.type === 'text') && tool === 'select' && startEditText(item)}
                onDragEnd={(patch) => updateItem(item.id, patch)}
                onTransformEnd={(patch) => updateItem(item.id, patch)}
              />
            ))}
            <Transformer
              ref={trRef}
              rotateEnabled
              flipEnabled={false}
              boundBoxFunc={(oldBox, newBox) => (newBox.width < 10 || newBox.height < 10 ? oldBox : newBox)}
            />
          </Layer>
        </Stage>

        {editingText && (
          <textarea
            autoFocus
            value={editingText.value}
            onChange={(e) => setEditingText({ ...editingText, value: e.target.value })}
            onBlur={commitEditText}
            onKeyDown={(e) => { if (e.key === 'Escape') setEditingText(null) }}
            className="absolute z-20 bg-transparent outline-none resize-none border border-id-mid rounded p-1 font-sans"
            style={{ ...editingText.style, position: 'fixed', color: 'inherit' }}
          />
        )}

        {/* Controles de zoom */}
        <div className="absolute bottom-3 right-3 flex items-center gap-1 bg-[var(--sur)]/90 border border-[var(--bdr)] rounded-lg p-1 backdrop-blur">
          <button onClick={() => zoomBy(0.85)} className="w-7 h-7 flex items-center justify-center rounded-md text-[var(--tx2)] hover:bg-[var(--sur2)]"><ZoomOut size={13} /></button>
          <span className="text-[11px] text-[var(--tx3)] w-10 text-center font-mono">{zoomPct}%</span>
          <button onClick={() => zoomBy(1/0.85)} className="w-7 h-7 flex items-center justify-center rounded-md text-[var(--tx2)] hover:bg-[var(--sur2)]"><ZoomIn size={13} /></button>
          <button onClick={resetZoom} title="Resetar zoom" className="w-7 h-7 flex items-center justify-center rounded-md text-[var(--tx2)] hover:bg-[var(--sur2)]"><Maximize2 size={13} /></button>
        </div>
      </div>
      <p className="text-[10.5px] text-[var(--tx3)] mt-1.5">Scroll pra dar zoom · arraste o fundo pra navegar · duplo clique numa nota/texto pra editar · Delete remove o item selecionado</p>
    </div>
  )
}

function CanvasShape({ item, isSelected, tool, setRef, onSelect, onDblClick, onDragEnd, onTransformEnd }) {
  const common = {
    ref: setRef,
    draggable: tool === 'select',
    onClick: onSelect,
    onTap: onSelect,
    onDblClick,
    onDblTap: onDblClick,
    onDragEnd: (e) => onDragEnd({ x: e.target.x(), y: e.target.y() }),
    onTransformEnd: (e) => {
      const node = e.target
      const scaleX = node.scaleX(), scaleY = node.scaleY()
      node.scaleX(1); node.scaleY(1)
      onTransformEnd({
        x: node.x(), y: node.y(), rotation: node.rotation(),
        width: Math.max(10, (node.width() || item.width) * scaleX),
        height: Math.max(10, (node.height() || item.height) * scaleY),
      })
    },
  }

  if (item.type === 'note') {
    return (
      <>
        <Rect {...common} x={item.x} y={item.y} width={item.width} height={item.height} rotation={item.rotation || 0}
          fill={item.fill} cornerRadius={8} shadowColor="black" shadowBlur={6} shadowOpacity={0.15} shadowOffsetY={2}
          stroke={isSelected ? '#8FB352' : undefined} strokeWidth={isSelected ? 2 : 0} />
        <Text x={item.x + 10} y={item.y + 10} width={item.width - 20} height={item.height - 20}
          text={item.text} fontSize={13} fontFamily="DM Sans" fill="#1f2937" listening={false} />
      </>
    )
  }
  if (item.type === 'rect') {
    return <Rect {...common} x={item.x} y={item.y} width={item.width} height={item.height} rotation={item.rotation || 0}
      fill={item.fill + 'aa'} stroke={isSelected ? '#8FB352' : item.stroke} strokeWidth={isSelected ? 3 : 2} cornerRadius={4} />
  }
  if (item.type === 'ellipse') {
    return <Ellipse {...common}
      x={item.x + item.width / 2} y={item.y + item.height / 2}
      radiusX={item.width / 2} radiusY={item.height / 2} rotation={item.rotation || 0}
      fill={item.fill + 'aa'} stroke={isSelected ? '#8FB352' : item.stroke} strokeWidth={isSelected ? 3 : 2}
      onDragEnd={(e) => onDragEnd({ x: e.target.x() - item.width / 2, y: e.target.y() - item.height / 2 })}
      onTransformEnd={(e) => {
        const node = e.target
        const scaleX = node.scaleX(), scaleY = node.scaleY()
        node.scaleX(1); node.scaleY(1)
        const newW = Math.max(10, item.width * scaleX), newH = Math.max(10, item.height * scaleY)
        onTransformEnd({ x: node.x() - newW / 2, y: node.y() - newH / 2, width: newW, height: newH, rotation: node.rotation() })
      }}
    />
  }
  if (item.type === 'text') {
    return <Text {...common} x={item.x} y={item.y} width={item.width} text={item.text} fontSize={item.fontSize || 18}
      fontFamily="Sora" fill={item.fill || '#111827'} rotation={item.rotation || 0}
      stroke={isSelected ? '#8FB352' : undefined} strokeWidth={isSelected ? 0.6 : 0} />
  }
  if (item.type === 'arrow') {
    return <Arrow ref={setRef} draggable={tool === 'select'} onClick={onSelect} onTap={onSelect}
      points={item.points} stroke={isSelected ? '#8FB352' : item.stroke} fill={isSelected ? '#8FB352' : item.stroke} strokeWidth={item.strokeWidth || 3}
      hitStrokeWidth={16}
      onDragEnd={(e) => {
        const dx = e.target.x(), dy = e.target.y()
        e.target.position({ x: 0, y: 0 })
        onDragEnd({ points: item.points.map((p, i) => i % 2 === 0 ? p + dx : p + dy) })
      }}
    />
  }
  if (item.type === 'draw') {
    return <Line ref={setRef} draggable={tool === 'select'} onClick={onSelect} onTap={onSelect}
      points={item.points} stroke={isSelected ? '#8FB352' : item.stroke} strokeWidth={item.strokeWidth || 3}
      lineCap="round" lineJoin="round" hitStrokeWidth={16}
      onDragEnd={(e) => {
        const dx = e.target.x(), dy = e.target.y()
        e.target.position({ x: 0, y: 0 })
        onDragEnd({ points: item.points.map((p, i) => i % 2 === 0 ? p + dx : p + dy) })
      }}
    />
  }
  return null
}
