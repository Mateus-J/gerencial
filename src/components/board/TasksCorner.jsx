import { useEffect, useRef, useState } from 'react'
import { CheckSquare } from 'lucide-react'

function todayStr() {
  const d = new Date()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

// Widget compacto de "tarefas do dia" — fica no canto superior direito da
// página do quadro (ao lado dos outros botões de ação), sem substituir o
// quadro em si (Tabela/Canvas). As tarefas em si são cadastradas em
// Configurações → Tarefas por colaborador; aqui só se marca o que já foi
// feito hoje. A marcação reinicia sozinha à meia-noite.
export default function TasksCorner({ board, onSave }) {
  const tasks = board?.tasks || []
  const today = todayStr()
  const isStale = board?.daily?.date !== today
  const done = isStale ? [] : (board?.daily?.done || [])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    function onClickOutside(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  async function toggle(taskId) {
    const base = isStale ? [] : done
    const next = base.includes(taskId) ? base.filter((id) => id !== taskId) : [...base, taskId]
    setBusy(true)
    try { await onSave({ ...board, tasks, daily: { date: today, done: next } }) } finally { setBusy(false) }
  }

  if (!tasks.length) return null

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-[11px] border border-[var(--bdr)] rounded-lg px-2.5 py-1 text-[var(--tx2)] hover:bg-[var(--sur2)]"
      >
        <CheckSquare size={13} /> Tarefas do dia · {done.length}/{tasks.length}
      </button>
      {open && (
        <div className="absolute right-0 mt-1.5 w-72 bg-[var(--sur)] border border-[var(--bdr)] rounded-xl shadow-card z-20 overflow-hidden">
          <div className="max-h-80 overflow-y-auto divide-y divide-[var(--bdr)]">
            {tasks.map((t) => {
              const checked = done.includes(t.id)
              return (
                <label key={t.id} className="flex items-center justify-between gap-3 px-3 py-2 cursor-pointer hover:bg-[var(--sur2)] transition-colors">
                  <span className={`text-[12px] ${checked ? 'text-[var(--tx3)] line-through' : 'text-[var(--tx)]'}`}>{t.text}</span>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={busy}
                    onChange={() => toggle(t.id)}
                    className="w-[16px] h-[16px] shrink-0 accent-id-dark cursor-pointer disabled:opacity-50"
                  />
                </label>
              )
            })}
          </div>
          <div className="px-3 py-1.5 text-[10.5px] text-[var(--tx4)] border-t border-[var(--bdr)]">Reinicia à meia-noite</div>
        </div>
      )}
    </div>
  )
}
