import { useEffect, useMemo, useState } from 'react'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { PageHeader, Card } from '../components/PageShell'
import { useToast } from '../components/Toast'

const DOC_REF = () => doc(db, 'controle', 'agenda')
const DOWS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
const EVT_TYPES = [
  { id: 'event', label: 'Evento', color: '#38bdf8', bg: 'rgba(56,189,248,0.12)' },
  { id: 'task', label: 'Tarefa', color: '#8FB352', bg: 'rgba(143,179,82,0.12)' },
  { id: 'note', label: 'Nota', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  { id: 'launch', label: 'Lançamento', color: '#a78bfa', bg: 'rgba(167,139,250,0.12)' },
  { id: 'reminder', label: 'Lembrete', color: '#f87171', bg: 'rgba(248,113,113,0.12)' },
]

function expandRecurrDates(startDate, recurrence, endDate) {
  const dates = []
  const start = new Date(startDate + 'T12:00:00')
  const end = endDate ? new Date(endDate + 'T12:00:00') : new Date(start.getTime() + 365 * 86400000)
  let cur = new Date(start)
  while (cur <= end && dates.length < 500) {
    const iso = cur.toISOString().slice(0, 10)
    const dow = cur.getDay()
    if (recurrence === 'daily') dates.push(iso)
    else if (recurrence === 'weekdays' && dow >= 1 && dow <= 5) dates.push(iso)
    else if (recurrence === 'weekly') dates.push(iso)
    else if (recurrence === 'monthly') dates.push(iso)
    if (recurrence === 'weekly') cur.setDate(cur.getDate() + 7)
    else if (recurrence === 'monthly') cur.setMonth(cur.getMonth() + 1)
    else cur.setDate(cur.getDate() + 1)
  }
  return dates
}

export default function Agenda() {
  const toast = useToast()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const now = new Date()
  const [calYear, setCalYear] = useState(now.getFullYear())
  const [calMonth, setCalMonth] = useState(now.getMonth())
  const [selectedDate, setSelectedDate] = useState(null)
  const [type, setType] = useState('event')
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(now.toISOString().slice(0, 10))
  const [time, setTime] = useState('')
  const [note, setNote] = useState('')
  const [recurrence, setRecurrence] = useState('none')
  const [recurrEnd, setRecurrEnd] = useState('')

  useEffect(() => {
    let mounted = true
    getDoc(DOC_REF())
      .then((snap) => { if (mounted && snap.exists()) setItems(snap.data().items || []) })
      .catch((e) => console.warn('agLoad err', e))
      .finally(() => mounted && setLoading(false))
    return () => { mounted = false }
  }, [])

  function persist(next) {
    setItems(next)
    setDoc(DOC_REF(), { items: next }, { merge: false }).catch((e) => { console.warn('agSave err', e); toast.error('Erro ao salvar: ' + e.message) })
  }

  function addItem() {
    if (!title.trim()) { toast.error('Digite um título.'); return }
    if (!date) { toast.error('Selecione uma data.'); return }
    const dates = recurrence === 'none' ? [date] : expandRecurrDates(date, recurrence, recurrEnd)
    const recurGroupId = recurrence !== 'none' ? 'rg' + Date.now() : undefined
    // Firestore rejeita a gravação inteira se algum campo vier `undefined`
    // (era exatamente o caso de recurrence/recurGroupId em itens não
    // recorrentes) — por isso só inclui esses campos quando fazem sentido.
    const newItems = dates.map((d) => {
      const item = {
        id: 'ag' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        type, title: title.trim(), date: d, time, note: note.trim(),
        done: false, createdAt: new Date().toISOString(),
      }
      if (recurrence !== 'none') { item.recurrence = recurrence; item.recurGroupId = recurGroupId }
      return item
    })
    persist([...newItems, ...items])
    setTitle(''); setNote(''); setTime('')
    toast.success('Item adicionado à agenda!')
  }

  function toggleDone(id) {
    persist(items.map((i) => i.id === id ? { ...i, done: !i.done } : i))
  }
  function deleteItem(id) {
    if (!confirm('Excluir este item?')) return
    persist(items.filter((i) => i.id !== id))
    toast.success('Item excluído.')
  }

  function calNav(dir) {
    let m = calMonth + dir, y = calYear
    if (m > 11) { m = 0; y++ }
    if (m < 0) { m = 11; y-- }
    setCalMonth(m); setCalYear(y)
  }

  const dateEvtMap = useMemo(() => {
    const map = {}
    items.filter((i) => !i.done).forEach((i) => { (map[i.date] ||= []).push(i) })
    return map
  }, [items])

  const calCells = useMemo(() => {
    const first = new Date(calYear, calMonth, 1).getDay()
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate()
    const prevDays = new Date(calYear, calMonth, 0).getDate()
    const cells = []
    for (let i = 0; i < first; i++) cells.push({ label: prevDays - first + 1 + i, other: true })
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = calYear + '-' + String(calMonth + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0')
      cells.push({ label: d, dateStr, evts: dateEvtMap[dateStr] || [] })
    }
    const remaining = (7 - (cells.length % 7)) % 7
    for (let i = 1; i <= remaining; i++) cells.push({ label: i, other: true })
    return cells
  }, [calYear, calMonth, dateEvtMap])

  const todayISO = now.toISOString().slice(0, 10)
  const listItems = useMemo(() => {
    let list = selectedDate ? items.filter((i) => i.date === selectedDate) : [...items]
    list.sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''))
    return list
  }, [items, selectedDate])

  if (loading) {
    return (
      <div>
        <PageHeader eyebrow="Equipe" title="Agenda" />
        <Card className="p-10 text-center text-[var(--tx3)]">Carregando…</Card>
      </div>
    )
  }

  return (
    <div>
      <PageHeader eyebrow="Equipe" title="Agenda" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Calendário */}
        <Card className="p-4 lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <button onClick={() => calNav(-1)} className="text-[13px] px-2 py-1 border border-[var(--bdr)] rounded-lg hover:bg-[var(--sur2)]">←</button>
            <span className="font-display font-medium text-[14px]">{MONTHS[calMonth]} {calYear}</span>
            <button onClick={() => calNav(1)} className="text-[13px] px-2 py-1 border border-[var(--bdr)] rounded-lg hover:bg-[var(--sur2)]">→</button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-[var(--tx3)] mb-1">
            {DOWS.map((d) => <div key={d}>{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {calCells.map((c, i) => (
              <div
                key={i}
                onClick={() => c.dateStr && setSelectedDate(selectedDate === c.dateStr ? null : c.dateStr)}
                className={`min-h-[64px] rounded-lg p-1 text-[11px] cursor-pointer border ${c.other ? 'text-[var(--tx4)] border-transparent' : c.dateStr === todayISO ? 'border-id-mid bg-id-dark/10' : selectedDate === c.dateStr ? 'border-sky-500 bg-sky-500/5' : 'border-[var(--bdr)]/60 hover:bg-[var(--sur2)]'}`}
              >
                <div className={c.other ? '' : 'font-medium'}>{c.label}</div>
                {(c.evts || []).slice(0, 2).map((e) => {
                  const t = EVT_TYPES.find((x) => x.id === e.type) || EVT_TYPES[0]
                  return <div key={e.id} className="text-[9.5px] px-1 rounded mt-0.5 truncate" style={{ background: t.bg, color: t.color }}>{e.time ? e.time + ' ' : ''}{e.title}</div>
                })}
                {c.evts?.length > 2 && <div className="text-[9px] text-[var(--tx3)] mt-0.5">+{c.evts.length - 2} mais</div>}
              </div>
            ))}
          </div>
        </Card>

        {/* Formulário + lista */}
        <div className="space-y-4">
          <Card className="p-4">
            <div className="text-[11px] font-semibold uppercase text-[var(--tx3)] mb-2">Novo item</div>
            <div className="flex flex-wrap gap-1 mb-2">
              {EVT_TYPES.map((t) => (
                <button key={t.id} onClick={() => setType(t.id)} className="text-[10.5px] px-2 py-1 rounded-full border" style={{ background: type === t.id ? t.bg : 'transparent', color: t.color, borderColor: type === t.id ? t.color : '#2a2e38' }}>{t.label}</button>
              ))}
            </div>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título" className="w-full bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-2 py-1.5 text-[12px] mb-2" />
            <div className="flex gap-2 mb-2">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="flex-1 bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-2 py-1.5 text-[12px]" />
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-[100px] bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-2 py-1.5 text-[12px]" />
            </div>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nota (opcional)" rows={2} className="w-full bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-2 py-1.5 text-[12px] mb-2 resize-none" />
            <select value={recurrence} onChange={(e) => setRecurrence(e.target.value)} className="w-full bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-2 py-1.5 text-[12px] mb-2">
              <option value="none">Não repetir</option>
              <option value="daily">Diariamente</option>
              <option value="weekdays">Dias úteis</option>
              <option value="weekly">Semanalmente</option>
              <option value="monthly">Mensalmente</option>
            </select>
            {recurrence !== 'none' && (
              <input type="date" value={recurrEnd} onChange={(e) => setRecurrEnd(e.target.value)} placeholder="Repetir até" className="w-full bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-2 py-1.5 text-[12px] mb-2" />
            )}
            <button onClick={addItem} className="w-full bg-id-dark hover:bg-id-mid rounded-lg py-2 text-[12px] font-medium">Adicionar</button>
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[11px] font-semibold uppercase text-[var(--tx3)]">
                {selectedDate ? new Date(selectedDate + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }) : 'Todos os eventos'}
              </div>
              {selectedDate && <button onClick={() => setSelectedDate(null)} className="text-[10.5px] text-[var(--tx3)]">Limpar</button>}
            </div>
            <div className="space-y-1.5 max-h-[280px] overflow-y-auto">
              {!listItems.length ? (
                <div className="text-[12px] text-[var(--tx3)] text-center py-4">Nenhum item{selectedDate ? ' neste dia' : ''}.</div>
              ) : listItems.map((item) => {
                const t = EVT_TYPES.find((x) => x.id === item.type) || EVT_TYPES[0]
                return (
                  <div key={item.id} className={`flex items-start gap-2 rounded-lg px-2.5 py-2 border ${item.done ? 'opacity-50 border-transparent' : 'border-[var(--bdr)]'}`} style={{ background: item.done ? 'transparent' : t.bg }}>
                    <input type="checkbox" checked={item.done} onChange={() => toggleDone(item.id)} className="mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-medium truncate" style={{ color: item.done ? undefined : t.color }}>{item.title}</div>
                      <div className="text-[10.5px] text-[var(--tx3)]">{new Date(item.date + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}{item.time ? ' · ' + item.time : ''}</div>
                      {item.note && <div className="text-[10.5px] text-[var(--tx3)] mt-0.5">{item.note}</div>}
                    </div>
                    <button onClick={() => deleteItem(item.id)} className="text-[var(--tx3)] hover:text-red-400 text-[11px]">✕</button>
                  </div>
                )
              })}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
