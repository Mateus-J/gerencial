import { useState } from 'react'
import { Card } from '../PageShell'

function todayStr() {
  const d = new Date()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

// Checklist fixo de atividades diárias. As tarefas em si (o quê) são
// cadastradas em Configurações → Tarefas por colaborador; aqui só se marca
// o que já foi feito hoje. A marcação reinicia sozinha à meia-noite: não
// existe um job de "zerar", o dia salvo (daily.date) é comparado com o dia
// atual a cada carregamento/toggle e, se for diferente, trata como vazio.
export default function BoardChecklist({ board, onSave }) {
  const tasks = board?.tasks || []
  const today = todayStr()
  const isStale = board?.daily?.date !== today
  const done = isStale ? [] : (board?.daily?.done || [])
  const [busy, setBusy] = useState(false)

  async function toggle(taskId) {
    const base = isStale ? [] : done
    const next = base.includes(taskId) ? base.filter((id) => id !== taskId) : [...base, taskId]
    setBusy(true)
    try {
      await onSave({ ...board, tasks, daily: { date: today, done: next } })
    } finally {
      setBusy(false)
    }
  }

  if (!tasks.length) {
    return (
      <Card className="p-10 text-center">
        <p className="text-[12.5px] text-[var(--tx3)]">Nenhuma atividade cadastrada para esta pessoa ainda.</p>
        <p className="text-[11.5px] text-[var(--tx4)] mt-1">Peça a um administrador para adicionar em Configurações → Tarefas por colaborador.</p>
      </Card>
    )
  }

  const pct = Math.round((done.length / tasks.length) * 100)

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[12.5px] text-[var(--tx2)] font-medium">{done.length} de {tasks.length} concluídas hoje</div>
        <div className="text-[11px] text-[var(--tx4)]">Reinicia à meia-noite</div>
      </div>
      <div className="h-1.5 w-full bg-[var(--sur2)] rounded-full overflow-hidden mb-4">
        <div className="h-full bg-id-dark dark:bg-id-light transition-all" style={{ width: pct + '%' }} />
      </div>
      <Card className="divide-y divide-[var(--bdr)] overflow-hidden">
        {tasks.map((t) => {
          const checked = done.includes(t.id)
          return (
            <label key={t.id} className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer hover:bg-[var(--sur2)] transition-colors">
              <span className={`text-[13px] ${checked ? 'text-[var(--tx3)] line-through' : 'text-[var(--tx)]'}`}>{t.text}</span>
              <input
                type="checkbox"
                checked={checked}
                disabled={busy}
                onChange={() => toggle(t.id)}
                className="w-[18px] h-[18px] shrink-0 accent-id-dark cursor-pointer disabled:opacity-50"
              />
            </label>
          )
        })}
      </Card>
    </div>
  )
}
