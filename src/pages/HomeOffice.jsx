import { useEffect, useMemo, useState } from 'react'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { Plus, X, Check } from 'lucide-react'
import { db } from '../lib/firebase'
import { PageHeader, Card } from '../components/PageShell'

const DOC_REF = () => doc(db, 'controle', 'home_office')
const DOWS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const TYPE_LABEL = { dia_completo: 'Dia completo', meio_periodo: 'Meio período' }

function toISO(d) { return d.toISOString().slice(0, 10) }
function getWeekDates(offset) {
  const now = new Date()
  const day = now.getDay()
  const monday = new Date(now)
  monday.setDate(now.getDate() - ((day + 6) % 7) + offset * 7)
  return Array.from({ length: 5 }, (_, i) => { const d = new Date(monday); d.setDate(monday.getDate() + i); return d })
}
function ptShortDate(d) { return d.getDate().toString().padStart(2, '0') + '/' + (d.getMonth() + 1).toString().padStart(2, '0') }
function strToColor(s) { let h = 0; for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h); return `hsl(${h % 360},55%,45%)` }

// NOTA: o sistema de login/roles (admin vs colaborador) do app antigo ainda
// não foi portado — por ora todo mundo tem controle de admin aqui. Quando a
// aba Usuários/Auth for portada, isso pode ser restringido por role.
const CURRENT_USER = { username: 'mateus.jesus', name: 'Mateus Jesus' }

export default function HomeOffice() {
  const [requests, setRequests] = useState([])
  const [collabs, setCollabs] = useState([])
  const [loading, setLoading] = useState(true)
  const [weekOffset, setWeekOffset] = useState(0)
  const [reqDate, setReqDate] = useState('')
  const [reqType, setReqType] = useState('dia_completo')
  const [reqObs, setReqObs] = useState('')
  const [showAddCollab, setShowAddCollab] = useState(false)
  const [newCollabName, setNewCollabName] = useState('')
  const [newCollabRole, setNewCollabRole] = useState('')

  useEffect(() => {
    let mounted = true
    getDoc(DOC_REF())
      .then((snap) => {
        if (!mounted || !snap.exists()) return
        const d = snap.data()
        setRequests(d.requests || [])
        setCollabs(d.collaborators || [])
      })
      .catch((e) => console.warn('hoLoad err', e))
      .finally(() => mounted && setLoading(false))
    return () => { mounted = false }
  }, [])

  function persist(nextRequests, nextCollabs) {
    setRequests(nextRequests)
    setCollabs(nextCollabs)
    setDoc(DOC_REF(), { requests: nextRequests, collaborators: nextCollabs }, { merge: false }).catch((e) => console.warn('hoSave err', e))
  }

  function submitRequest() {
    if (!reqDate) { alert('⚠ Selecione uma data'); return }
    const dup = requests.find((r) => r.username === CURRENT_USER.username && r.date === reqDate && r.status !== 'rejected')
    if (dup) { alert('⚠ Você já tem uma solicitação para esta data'); return }
    const req = { id: 'ho_' + Date.now(), username: CURRENT_USER.username, name: CURRENT_USER.name, date: reqDate, type: reqType, obs: reqObs.trim(), status: 'pending', requestedAt: new Date().toISOString(), adminNote: '' }
    persist([...requests, req], collabs)
    setReqDate(''); setReqObs('')
  }
  function cancelRequest(id) {
    if (!confirm('Cancelar esta solicitação?')) return
    persist(requests.filter((r) => r.id !== id), collabs)
  }
  function approveRequest(id, note) {
    const next = requests.map((r) => r.id === id ? { ...r, status: 'approved', adminNote: note || '', approvedAt: new Date().toISOString(), approvedBy: CURRENT_USER.username } : r)
    persist(next, collabs)
  }
  function rejectRequest(id, note) {
    const next = requests.map((r) => r.id === id ? { ...r, status: 'rejected', adminNote: note || '', rejectedAt: new Date().toISOString(), rejectedBy: CURRENT_USER.username } : r)
    persist(next, collabs)
  }
  function toggleCell(collab, iso) {
    const uname = collab.username
    let next
    if (uname) {
      const idx = requests.findIndex((r) => r.username === uname && r.date === iso && r.status === 'approved')
      if (idx >= 0) next = requests.filter((_, i) => i !== idx)
      else {
        const filtered = requests.filter((r) => !(r.username === uname && r.date === iso))
        next = [...filtered, { id: 'ho_adm_' + Date.now(), username: uname, name: collab.name, date: iso, type: 'dia_completo', obs: '', status: 'approved', requestedAt: new Date().toISOString(), adminNote: 'Definido pelo administrador', approvedAt: new Date().toISOString(), approvedBy: CURRENT_USER.username }]
      }
    } else {
      const idx = requests.findIndex((r) => r.collabId === collab.id && r.date === iso && r.status === 'approved')
      if (idx >= 0) next = requests.filter((_, i) => i !== idx)
      else {
        const filtered = requests.filter((r) => !(r.collabId === collab.id && r.date === iso))
        next = [...filtered, { id: 'ho_adm_' + Date.now(), collabId: collab.id, name: collab.name, date: iso, type: 'dia_completo', obs: '', status: 'approved', requestedAt: new Date().toISOString(), adminNote: 'Definido pelo administrador', approvedAt: new Date().toISOString(), approvedBy: CURRENT_USER.username }]
      }
    }
    persist(next, collabs)
  }
  function addCollab() {
    if (!newCollabName.trim()) return
    const c = { id: 'collab_' + Date.now(), name: newCollabName.trim(), role: newCollabRole.trim(), username: null, color: strToColor(newCollabName) }
    persist(requests, [...collabs, c])
    setNewCollabName(''); setNewCollabRole(''); setShowAddCollab(false)
  }
  function removeCollab(id) {
    if (!confirm('Remover este colaborador da escala?')) return
    persist(requests, collabs.filter((c) => c.id !== id))
  }

  const days = useMemo(() => getWeekDates(weekOffset), [weekOffset])
  const todayISO = toISO(new Date())

  const mine = requests.filter((r) => r.username === CURRENT_USER.username).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
  const pending = requests.filter((r) => r.status === 'pending').sort((a, b) => a.requestedAt.localeCompare(b.requestedAt))
  const approved = requests.filter((r) => r.status === 'approved').length
  const rejected = requests.filter((r) => r.status === 'rejected').length
  const weekDates = new Set(days.map(toISO))
  const thisWeekApproved = requests.filter((r) => r.status === 'approved' && weekDates.has(r.date)).length

  if (loading) {
    return (
      <div>
        <PageHeader eyebrow="Equipe" title="Home Office" />
        <Card className="p-10 text-center text-slate-500">Carregando…</Card>
      </div>
    )
  }

  return (
    <div>
      <PageHeader eyebrow="Equipe" title="Home Office" subtitle="Escala da equipe" />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <Card className="p-3"><div className="text-[10px] uppercase text-slate-500">Total geral</div><div className="font-display text-lg font-semibold">{requests.length}</div></Card>
        <Card className="p-3"><div className="text-[10px] uppercase text-slate-500">HO esta semana</div><div className="font-display text-lg font-semibold text-id-light">{thisWeekApproved}</div></Card>
        <Card className="p-3"><div className="text-[10px] uppercase text-slate-500">Pendentes</div><div className="font-display text-lg font-semibold text-amber-400">{pending.length}</div></Card>
        <Card className="p-3"><div className="text-[10px] uppercase text-slate-500">Aprovados</div><div className="font-display text-lg font-semibold text-id-light">{approved}</div></Card>
        <Card className="p-3"><div className="text-[10px] uppercase text-slate-500">Reprovados</div><div className="font-display text-lg font-semibold text-red-400">{rejected}</div></Card>
      </div>

      {/* Escala semanal */}
      <Card className="mb-4">
        <div className="p-3 border-b border-bg-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button onClick={() => setWeekOffset((w) => w - 1)} className="text-[12px] border border-bg-border rounded-lg px-2 py-1 hover:bg-bg-panel2">←</button>
            <span className="text-[12px] font-medium">{ptShortDate(days[0])} – {ptShortDate(days[4])}</span>
            <button onClick={() => setWeekOffset((w) => w + 1)} className="text-[12px] border border-bg-border rounded-lg px-2 py-1 hover:bg-bg-panel2">→</button>
            {weekOffset !== 0 && <button onClick={() => setWeekOffset(0)} className="text-[11px] text-id-light">Hoje</button>}
          </div>
          <button onClick={() => setShowAddCollab(true)} className="flex items-center gap-1 text-[11px] border border-bg-border rounded-lg px-2.5 py-1 text-slate-300 hover:bg-bg-panel2"><Plus size={12} /> Adicionar</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-bg-border">
                <th className="px-3 py-2 font-medium">Colaborador</th>
                {days.map((d) => {
                  const iso = toISO(d)
                  return <th key={iso} className={`px-3 py-2 font-medium text-center ${iso === todayISO ? 'text-id-light' : ''}`}>{DOWS[d.getDay()]} {d.getDate().toString().padStart(2, '0')}</th>
                })}
              </tr>
            </thead>
            <tbody>
              {!collabs.length ? (
                <tr><td colSpan={6} className="text-center py-8 text-slate-500">Nenhum colaborador cadastrado. Clique em "Adicionar" para incluir na escala.</td></tr>
              ) : collabs.map((collab) => {
                const initials = (collab.name || '?').split(' ').slice(0, 2).map((w) => w[0] || '').join('').toUpperCase()
                return (
                  <tr key={collab.id} className="border-b border-bg-border/60">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-semibold shrink-0" style={{ background: collab.color || strToColor(collab.name) }}>{initials}</div>
                        <div className="min-w-0">
                          <div className="text-[12px] font-medium truncate">{collab.name}</div>
                          {collab.role && <div className="text-[10px] text-slate-500">{collab.role}</div>}
                        </div>
                        <button onClick={() => removeCollab(collab.id)} className="text-slate-600 hover:text-red-400 text-[11px] ml-1">✕</button>
                      </div>
                    </td>
                    {days.map((d) => {
                      const iso = toISO(d)
                      const uname = collab.username
                      const req = uname
                        ? requests.filter((r) => r.username === uname && r.date === iso).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))[0]
                        : requests.find((r) => r.collabId === collab.id && r.date === iso)
                      const status = req?.status
                      return (
                        <td key={iso} className={`px-3 py-2 text-center cursor-pointer ${iso === todayISO ? 'bg-id-dark/5' : ''}`} onClick={() => toggleCell(collab, iso)}>
                          {status === 'approved' ? (
                            <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-id-mid/15 text-id-light">🏠 Home</span>
                          ) : status === 'pending' ? (
                            <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400">⏳ Pendente</span>
                          ) : (
                            <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-bg-panel2 text-slate-500">🏢 Escritório</span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Formulário + minhas solicitações */}
        <Card className="p-4">
          <div className="text-[11px] font-semibold uppercase text-slate-500 mb-3">Solicitar Home Office</div>
          <div className="flex flex-wrap gap-2 mb-4">
            <input type="date" value={reqDate} onChange={(e) => setReqDate(e.target.value)} className="bg-bg-panel2 border border-bg-border rounded-lg px-2 py-1.5 text-[12px]" />
            <select value={reqType} onChange={(e) => setReqType(e.target.value)} className="bg-bg-panel2 border border-bg-border rounded-lg px-2 py-1.5 text-[12px]">
              <option value="dia_completo">Dia completo</option>
              <option value="meio_periodo">Meio período</option>
            </select>
            <input value={reqObs} onChange={(e) => setReqObs(e.target.value)} placeholder="Observação (opcional)" className="flex-1 min-w-[140px] bg-bg-panel2 border border-bg-border rounded-lg px-2 py-1.5 text-[12px]" />
            <button onClick={submitRequest} className="bg-id-dark hover:bg-id-mid rounded-lg px-3 text-[12px]">Enviar</button>
          </div>
          <div className="space-y-2 max-h-[320px] overflow-y-auto">
            {!mine.length ? (
              <div className="text-[12px] text-slate-500 text-center py-6">Nenhuma solicitação ainda.</div>
            ) : mine.map((r) => (
              <div key={r.id} className="flex items-start gap-2 bg-bg-panel2 border border-bg-border rounded-lg px-3 py-2">
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-medium flex items-center gap-1.5">
                    {r.date}
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${r.status === 'approved' ? 'bg-id-mid/15 text-id-light' : r.status === 'rejected' ? 'bg-red-500/15 text-red-400' : 'bg-amber-500/15 text-amber-400'}`}>{r.status}</span>
                  </div>
                  <div className="text-[11px] text-slate-500">{TYPE_LABEL[r.type] || r.type}</div>
                  {r.obs && <div className="text-[11px] text-slate-400 mt-0.5">💬 {r.obs}</div>}
                  {r.adminNote && <div className={`text-[11px] mt-0.5 ${r.status === 'rejected' ? 'text-red-400' : 'text-id-light'}`}>👤 Admin: {r.adminNote}</div>}
                </div>
                {r.status === 'pending' && <button onClick={() => cancelRequest(r.id)} className="text-[11px] text-slate-500 hover:text-red-400">🗑</button>}
              </div>
            ))}
          </div>
        </Card>

        {/* Pendências admin */}
        <Card className="p-4">
          <div className="text-[11px] font-semibold uppercase text-slate-500 mb-3">Aprovações pendentes {pending.length > 0 && `(${pending.length})`}</div>
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {!pending.length ? (
              <div className="text-[12px] text-id-light text-center py-6">🎉 Nenhuma solicitação pendente!</div>
            ) : pending.map((r) => (
              <PendingCard key={r.id} r={r} onApprove={approveRequest} onReject={rejectRequest} />
            ))}
          </div>
        </Card>
      </div>

      {showAddCollab && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowAddCollab(false)}>
          <div className="bg-bg-panel border border-bg-border rounded-xl w-full max-w-[340px] p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div className="font-medium text-[13px]">Adicionar colaborador</div>
              <button onClick={() => setShowAddCollab(false)} className="text-slate-500 hover:text-white"><X size={16} /></button>
            </div>
            <input value={newCollabName} onChange={(e) => setNewCollabName(e.target.value)} placeholder="Nome" className="w-full bg-bg-panel2 border border-bg-border rounded-lg px-2 py-1.5 text-[12px] mb-2" />
            <input value={newCollabRole} onChange={(e) => setNewCollabRole(e.target.value)} placeholder="Cargo (opcional)" className="w-full bg-bg-panel2 border border-bg-border rounded-lg px-2 py-1.5 text-[12px] mb-3" />
            <button onClick={addCollab} className="w-full bg-id-dark hover:bg-id-mid rounded-lg py-2 text-[12px] font-medium">Adicionar</button>
          </div>
        </div>
      )}
    </div>
  )
}

function PendingCard({ r, onApprove, onReject }) {
  const [note, setNote] = useState('')
  return (
    <div className="bg-bg-panel2 border border-bg-border rounded-lg px-3 py-2.5">
      <div className="text-[12px] font-medium">{r.name} <span className="text-[10.5px] text-slate-500">@{r.username}</span></div>
      <div className="text-[11px] text-slate-500 mt-0.5">📅 {r.date} · 📋 {TYPE_LABEL[r.type] || r.type}</div>
      {r.obs && <div className="text-[11px] text-slate-400 mt-1">💬 {r.obs}</div>}
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nota para o colaborador (opcional)" className="w-full bg-bg-panel border border-bg-border rounded-lg px-2 py-1 text-[11px] mt-2" />
      <div className="flex gap-2 mt-2">
        <button onClick={() => onApprove(r.id, note)} className="flex items-center gap-1 text-[11px] bg-id-dark hover:bg-id-mid rounded-lg px-2.5 py-1"><Check size={11} /> Aprovar</button>
        <button onClick={() => onReject(r.id, note)} className="flex items-center gap-1 text-[11px] border border-red-500/40 text-red-400 rounded-lg px-2.5 py-1"><X size={11} /> Reprovar</button>
      </div>
    </div>
  )
}
