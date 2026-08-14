import { useRef, useState } from 'react'
import { Plus, Type, X } from 'lucide-react'

const NOTE_COLORS = ['#fde68a', '#a7f3d0', '#bfdbfe', '#fecaca', '#e9d5ff', '#fed7aa']

export default function BoardCanvas({ board, onSave }) {
  const items = board.canvasItems || []
  const areaRef = useRef(null)
  const [dragId, setDragId] = useState(null)
  const dragOffset = useRef({ x: 0, y: 0 })

  function persist(next) { onSave({ ...board, canvasItems: next }) }

  function addNote() {
    const item = { id: 'n' + Date.now(), kind: 'note', x: 40 + Math.random() * 60, y: 40 + Math.random() * 40, color: NOTE_COLORS[items.length % NOTE_COLORS.length], text: '' }
    persist([...items, item])
  }
  function addText() {
    const item = { id: 't' + Date.now(), kind: 'text', x: 60, y: 60, text: 'Texto' }
    persist([...items, item])
  }
  function updateItem(id, patch) {
    persist(items.map((i) => i.id === id ? { ...i, ...patch } : i))
  }
  function removeItem(id) {
    persist(items.filter((i) => i.id !== id))
  }

  function onMouseDownItem(e, item) {
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return
    const rect = areaRef.current.getBoundingClientRect()
    dragOffset.current = { x: e.clientX - rect.left - item.x, y: e.clientY - rect.top - item.y }
    setDragId(item.id)
  }
  function onMouseMove(e) {
    if (!dragId) return
    const rect = areaRef.current.getBoundingClientRect()
    const x = Math.max(0, e.clientX - rect.left - dragOffset.current.x)
    const y = Math.max(0, e.clientY - rect.top - dragOffset.current.y)
    persistLocal(dragId, x, y)
  }
  // Atualiza local sem gravar a cada pixel — só grava no Firestore ao soltar
  const [localItems, setLocalItems] = useState(null)
  function persistLocal(id, x, y) {
    setLocalItems((prev) => (prev || items).map((i) => i.id === id ? { ...i, x, y } : i))
  }
  function onMouseUp() {
    if (dragId && localItems) {
      persist(localItems)
      setLocalItems(null)
    }
    setDragId(null)
  }

  const displayItems = localItems || items

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <button onClick={addNote} className="flex items-center gap-1.5 text-[12px] border border-[var(--bdr)] rounded-lg px-3 py-1.5 text-[var(--tx2)] hover:bg-[var(--sur2)]">
          <Plus size={13} /> Nota
        </button>
        <button onClick={addText} className="flex items-center gap-1.5 text-[12px] border border-[var(--bdr)] rounded-lg px-3 py-1.5 text-[var(--tx2)] hover:bg-[var(--sur2)]">
          <Type size={13} /> Texto livre
        </button>
      </div>

      <div
        ref={areaRef}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        className="relative w-full h-[600px] bg-[var(--sur)] border border-[var(--bdr)] rounded-xl overflow-hidden"
        style={{ backgroundImage: 'radial-gradient(var(--bdr) 1px, transparent 1px)', backgroundSize: '18px 18px' }}
      >
        {!displayItems.length && (
          <div className="absolute inset-0 flex items-center justify-center text-[12.5px] text-[var(--tx3)]">
            Canvas vazio — clique em "Nota" ou "Texto livre" pra começar.
          </div>
        )}
        {displayItems.map((item) => (
          item.kind === 'note' ? (
            <div
              key={item.id}
              onMouseDown={(e) => onMouseDownItem(e, item)}
              className="absolute w-[180px] min-h-[130px] rounded-lg shadow-card p-2.5 cursor-move select-none"
              style={{ left: item.x, top: item.y, background: item.color }}
            >
              <div className="flex justify-end mb-1">
                <button onClick={() => removeItem(item.id)} className="text-black/40 hover:text-black/70"><X size={12} /></button>
              </div>
              <textarea
                defaultValue={item.text}
                onBlur={(e) => updateItem(item.id, { text: e.target.value })}
                placeholder="Escreva aqui…"
                className="w-full h-[80px] bg-transparent text-[12px] text-black/80 outline-none resize-none placeholder:text-black/40"
              />
              <div className="flex gap-1 mt-1">
                {NOTE_COLORS.map((c) => (
                  <button key={c} onClick={() => updateItem(item.id, { color: c })} className="w-3.5 h-3.5 rounded-full border border-black/10" style={{ background: c }} />
                ))}
              </div>
            </div>
          ) : (
            <div
              key={item.id}
              onMouseDown={(e) => onMouseDownItem(e, item)}
              className="absolute cursor-move select-none group"
              style={{ left: item.x, top: item.y }}
            >
              <div className="flex items-center gap-1">
                <input
                  defaultValue={item.text}
                  onBlur={(e) => updateItem(item.id, { text: e.target.value })}
                  className="bg-transparent font-display font-semibold text-[16px] outline-none text-[var(--tx)] min-w-[40px]"
                  style={{ width: Math.max(60, (item.text || '').length * 10) }}
                />
                <button onClick={() => removeItem(item.id)} className="opacity-0 group-hover:opacity-100 text-[var(--tx4)] hover:text-red-500"><X size={12} /></button>
              </div>
            </div>
          )
        ))}
      </div>
    </div>
  )
}
