import { useEffect, useMemo, useState } from 'react'
import { doc, onSnapshot, setDoc } from 'firebase/firestore'
import { Plus, X, Search, CheckCircle2 } from 'lucide-react'
import { db } from '../lib/firebase'
import { PageHeader, Card } from '../components/PageShell'
import KpiCard from '../components/KpiCard'
import { useFundos } from '../hooks/useFundos'
import { useToast } from '../components/Toast'

const DOC_REF = () => doc(db, 'controle', 'controles_internos')

const fmt = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function ControlesInternos() {
  const toast = useToast()
  const { all: fundosAll } = useFundos()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [showModal, setShowModal] = useState(false)

  useEffect(() => {
    const unsub = onSnapshot(DOC_REF(), (snap) => {
      setItems(snap.exists() ? (snap.data().items || []) : [])
      setLoading(false)
    }, (e) => { console.warn('ciLoad err', e); setLoading(false) })
    return () => unsub()
  }, [])

  function persist(next) {
    setItems(next)
    setDoc(DOC_REF(), { items: next, updatedAt: Date.now() }, { merge: false }).catch((e) => { console.warn('ciSave err', e); toast.error('Erro ao salvar: ' + e.message) })
  }

  function addItem(data) {
    persist([{ id: 'ci' + Date.now(), recebido: false, createdAt: new Date().toISOString(), ...data }, ...items])
    setShowModal(false)
    toast.success('Lançamento registrado!')
  }
  function toggleRecebido(id) {
    const next = items.map((i) => i.id === id ? { ...i, recebido: !i.recebido, recebidoEm: !i.recebido ? new Date().toISOString() : null } : i)
    persist(next)
    const item = next.find((i) => i.id === id)
    toast.success(item.recebido ? 'Marcado como recebido!' : 'Marcado como pendente novamente.')
  }
  function removeItem(id) {
    if (!confirm('Excluir este lançamento?')) return
    persist(items.filter((i) => i.id !== id))
    toast.success('Lançamento excluído.')
  }

  const rows = useMemo(() => items.filter((i) =>
    (i.fundo || '').toLowerCase().includes(q.toLowerCase()) || (i.motivo || '').toLowerCase().includes(q.toLowerCase())
  ), [items, q])

  const totalPago = items.reduce((a, i) => a + Number(i.valor || 0), 0)
  const totalPendente = items.filter((i) => !i.recebido).reduce((a, i) => a + Number(i.valor || 0), 0)
  const totalRecebido = items.filter((i) => i.recebido).reduce((a, i) => a + Number(i.valor || 0), 0)
  const qtdPendente = items.filter((i) => !i.recebido).length

  return (
    <div>
      <PageHeader
        eyebrow="Privado"
        title="Controles Internos"
        actions={
          <button onClick={() => setShowModal(true)} className="flex items-center gap-1.5 bg-id-dark hover:bg-id-mid text-white rounded-lg px-3 py-1.5 text-[12.5px] font-medium">
            <Plus size={14} /> Novo lançamento
          </button>
        }
      />
      <p className="text-[11.5px] text-[var(--tx3)] -mt-2 mb-4">Só você vê essa aba. Controla despesas que a ID Corretora pagou por conta de um fundo — aguardando a contrapartida (reembolso) do fundo.</p>

      <div className="flex flex-wrap gap-3 mb-4">
        <KpiCard label="Total pago" value={fmt(totalPago)} sub={`${items.length} lançamento${items.length !== 1 ? 's' : ''}`} accent="blue" />
        <KpiCard label="Pendente de recebimento" value={fmt(totalPendente)} sub={`${qtdPendente} em aberto`} accent={qtdPendente > 0 ? 'amber' : 'neutral'} />
        <KpiCard label="Recebido" value={fmt(totalRecebido)} sub={`${items.length - qtdPendente} confirmado(s)`} accent="green" />
      </div>

      <Card>
        <div className="p-3 border-b border-[var(--bdr)]">
          <div className="relative max-w-[320px]">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--tx3)]" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar fundo ou motivo…" className="w-full bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg pl-7 pr-3 py-1.5 text-[12px] outline-none focus:border-id-mid" />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10.5px] uppercase tracking-wider text-[var(--tx3)] border-b border-[var(--bdr)]">
                <th className="px-4 py-2.5 font-medium">Nome</th>
                <th className="px-4 py-2.5 font-medium">Motivo</th>
                <th className="px-4 py-2.5 font-medium">Valor</th>
                <th className="px-4 py-2.5 font-medium">Data pagamento</th>
                <th className="px-4 py-2.5 font-medium">Recebido?</th>
                <th className="px-4 py-2.5 font-medium text-right"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="text-center py-10 text-[var(--tx3)]">Carregando…</td></tr>
              ) : !rows.length ? (
                <tr><td colSpan={6} className="text-center py-10 text-[var(--tx3)]">{items.length ? 'Nenhum resultado.' : 'Nenhum lançamento ainda. Clique em "Novo lançamento" para começar.'}</td></tr>
              ) : rows.map((r) => (
                <tr key={r.id} className="border-b border-[var(--bdr)]/60 hover:bg-[var(--sur2)]/60 text-[12.5px]">
                  <td className="px-4 py-3 font-medium max-w-[240px] truncate" title={r.fundo}>{r.fundo}</td>
                  <td className="px-4 py-3 text-[var(--tx2)] max-w-[280px] truncate" title={r.motivo}>{r.motivo || '—'}</td>
                  <td className="px-4 py-3 font-mono">{fmt(r.valor)}</td>
                  <td className="px-4 py-3 text-[var(--tx3)]">{r.data ? new Date(r.data + 'T00:00:00').toLocaleDateString('pt-BR') : '—'}</td>
                  <td className="px-4 py-3">
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" checked={!!r.recebido} onChange={() => toggleRecebido(r.id)} className="sr-only peer" />
                      <span className="w-9 h-5 bg-[var(--sur2)] border border-[var(--bdr)] rounded-full peer-checked:bg-id-mid transition-colors" />
                      <span className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform peer-checked:translate-x-4" />
                    </label>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center gap-2 justify-end">
                      {r.recebido && <CheckCircle2 size={14} className="text-id-light" />}
                      <button onClick={() => removeItem(r.id)} className="text-[var(--tx4)] hover:text-red-500"><X size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2.5 text-[11px] text-[var(--tx3)] border-t border-[var(--bdr)]">{items.length} registro{items.length !== 1 ? 's' : ''}</div>
      </Card>

      {showModal && <NovoLancamentoModal fundosAll={fundosAll} onClose={() => setShowModal(false)} onSave={addItem} />}
    </div>
  )
}

function NovoLancamentoModal({ fundosAll, onClose, onSave }) {
  const [fundo, setFundo] = useState('')
  const [motivo, setMotivo] = useState('')
  const [valor, setValor] = useState('')
  const [data, setData] = useState(new Date().toISOString().slice(0, 10))
  const [showList, setShowList] = useState(false)
  const [error, setError] = useState('')

  const matches = fundo.trim().length >= 2
    ? fundosAll.filter((f) => f.nome.toLowerCase().includes(fundo.toLowerCase())).slice(0, 8)
    : []

  function submit() {
    if (!fundo.trim()) { setError('Informe o fundo.'); return }
    const v = Number(String(valor).replace(',', '.'))
    if (!v || v <= 0) { setError('Informe um valor válido.'); return }
    onSave({ fundo: fundo.trim(), motivo: motivo.trim(), valor: v, data })
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-[var(--sur)] border border-[var(--bdr)] rounded-xl w-full max-w-[420px] shadow-card">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--bdr)]">
          <div className="font-display font-semibold text-[14px]">Novo lançamento</div>
          <button onClick={onClose} className="text-[var(--tx3)] hover:text-[var(--tx)]"><X size={18} /></button>
        </div>
        <div className="p-5 flex flex-col gap-3">
          <div className="relative">
            <label className="block text-[11px] text-[var(--tx3)] mb-1">Fundo</label>
            <input
              value={fundo}
              onChange={(e) => { setFundo(e.target.value); setShowList(true) }}
              onFocus={() => setShowList(true)}
              placeholder="Nome do fundo…"
              className="w-full bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-id-mid"
            />
            {showList && matches.length > 0 && (
              <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-[var(--sur)] border border-[var(--bdr)] rounded-lg shadow-card max-h-[180px] overflow-y-auto">
                {matches.map((f) => (
                  <button
                    key={f.cnpj}
                    type="button"
                    onClick={() => { setFundo(f.nome); setShowList(false) }}
                    className="w-full text-left px-3 py-2 text-[12px] hover:bg-[var(--sur2)] truncate"
                  >
                    {f.nome}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-[11px] text-[var(--tx3)] mb-1">Motivo da despesa</label>
            <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex: Pagamento de taxa cartorial referente ao fundo…" rows={3} className="w-full bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-id-mid resize-none" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-[var(--tx3)] mb-1">Valor pago</label>
              <input value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" inputMode="decimal" className="w-full bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-id-mid" />
            </div>
            <div>
              <label className="block text-[11px] text-[var(--tx3)] mb-1">Data do pagamento</label>
              <input type="date" value={data} onChange={(e) => setData(e.target.value)} className="w-full bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-id-mid" />
            </div>
          </div>

          {error && <p className="text-[11.5px] text-red-400">{error}</p>}

          <button onClick={submit} className="w-full bg-id-dark hover:bg-id-mid text-white rounded-lg py-2.5 text-[13px] font-medium mt-1">
            Registrar lançamento
          </button>
        </div>
      </div>
    </div>
  )
}
