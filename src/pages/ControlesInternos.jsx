import { useEffect, useMemo, useState } from 'react'
import { doc, onSnapshot, setDoc } from 'firebase/firestore'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { Plus, X, Search, CheckCircle2, Paperclip, Wallet, Check } from 'lucide-react'
import { db, storage } from '../lib/firebase'
import { PageHeader, Card } from '../components/PageShell'
import KpiCard from '../components/KpiCard'
import { useFundos } from '../hooks/useFundos'
import { COLABORADORES } from '../hooks/useBoard'
import { useToast } from '../components/Toast'

const DOC_REF = () => doc(db, 'controle', 'controles_internos')
const CONTA_ATUAL_KEY = 'ci_conta_atual'

const fmt = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function ControlesInternos() {
  const toast = useToast()
  const { all: fundosAll } = useFundos()
  const [items, setItems] = useState([])
  const [contas, setContas] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [contaAtual, setContaAtual] = useState(() => localStorage.getItem(CONTA_ATUAL_KEY) || '')

  useEffect(() => {
    const unsub = onSnapshot(DOC_REF(), (snap) => {
      const data = snap.exists() ? snap.data() : {}
      setItems(data.items || [])
      setContas(data.contas || [])
      setLoading(false)
    }, (e) => { console.warn('ciLoad err', e); setLoading(false) })
    return () => unsub()
  }, [])

  // Se ainda não tem conta escolhida (primeiro uso, ou a salva não existe
  // mais), cai na primeira conta cadastrada assim que a lista carregar.
  useEffect(() => {
    if (!loading && contas.length && !contas.some((c) => c.id === contaAtual)) {
      setContaAtual(contas[0].id)
    }
  }, [loading, contas])

  function selectConta(id) {
    setContaAtual(id)
    localStorage.setItem(CONTA_ATUAL_KEY, id)
  }

  function persist(nextItems, nextContas) {
    setItems(nextItems)
    if (nextContas) setContas(nextContas)
    setDoc(DOC_REF(), { items: nextItems, contas: nextContas || contas, updatedAt: Date.now() }, { merge: false })
      .catch((e) => { console.warn('ciSave err', e); toast.error('Erro ao salvar: ' + e.message) })
  }

  function addConta(nome) {
    const id = 'conta' + Date.now()
    const nextContas = [...contas, { id, nome }]
    persist(items, nextContas)
    selectConta(id)
    toast.success(`Conta "${nome}" criada!`)
    return id
  }

  function addItem(data) {
    persist([{ id: 'ci' + Date.now(), contaId: contaAtual, recebido: false, createdAt: new Date().toISOString(), ...data }, ...items])
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

  // Tudo abaixo — KPIs e tabela — só considera a conta selecionada, pra
  // nunca misturar números/controles de contas diferentes na mesma tela.
  const itemsDaConta = useMemo(() => items.filter((i) => i.contaId === contaAtual), [items, contaAtual])

  const rows = useMemo(() => itemsDaConta.filter((i) =>
    (i.fundo || '').toLowerCase().includes(q.toLowerCase()) || (i.motivo || '').toLowerCase().includes(q.toLowerCase()) || (i.pagoPor || '').toLowerCase().includes(q.toLowerCase())
  ), [itemsDaConta, q])

  const totalDebito = itemsDaConta.filter((i) => i.tipo !== 'credito').reduce((a, i) => a + Number(i.valor || 0), 0)
  const totalCredito = itemsDaConta.filter((i) => i.tipo === 'credito').reduce((a, i) => a + Number(i.valor || 0), 0)
  const totalPendente = itemsDaConta.filter((i) => !i.recebido).reduce((a, i) => a + Number(i.valor || 0), 0)
  const qtdPendente = itemsDaConta.filter((i) => !i.recebido).length
  const saldo = totalCredito - totalDebito
  const contaAtualNome = contas.find((c) => c.id === contaAtual)?.nome

  if (!loading && !contas.length) {
    return (
      <div>
        <PageHeader eyebrow="Privado" title="Controles Internos" />
        <PrimeiraConta onCreate={(nome) => addConta(nome)} />
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        eyebrow="Privado"
        title="Controles Internos"
        actions={
          <div className="flex items-center gap-2">
            <ContaSwitcher contas={contas} contaAtual={contaAtual} onSelect={selectConta} onCreate={addConta} />
            <button onClick={() => setShowModal(true)} className="flex items-center gap-1.5 bg-id-dark hover:bg-id-mid text-white rounded-lg px-3 py-1.5 text-[12.5px] font-medium">
              <Plus size={14} /> Novo lançamento
            </button>
          </div>
        }
      />
      <p className="text-[11.5px] text-[var(--tx3)] -mt-2 mb-4">Só você vê essa aba. Controla despesas pagas por conta de algo (um fundo, contrato, etc.) — seja pela ID Corretora, seja por alguém que adiantou o pagamento — aguardando o reembolso. Também serve pra créditos/entradas. Cada conta de origem tem seus próprios números, sem misturar.</p>

      <div className="flex flex-wrap gap-3 mb-4">
        <KpiCard label="Total débito" value={fmt(totalDebito)} sub="pago pela ID Corretora" accent="amber" />
        <KpiCard label="Total crédito" value={fmt(totalCredito)} sub="recebido / reembolsado" accent="green" />
        <KpiCard label="Saldo" value={fmt(saldo)} sub={saldo >= 0 ? 'a favor' : 'a descoberto'} accent={saldo >= 0 ? 'green' : 'amber'} />
        <KpiCard label="Pendente de confirmação" value={fmt(totalPendente)} sub={`${qtdPendente} em aberto`} accent={qtdPendente > 0 ? 'blue' : 'neutral'} />
      </div>

      <Card>
        <div className="p-3 border-b border-[var(--bdr)]">
          <div className="relative max-w-[320px]">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--tx3)]" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar referência ou motivo…" className="w-full bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg pl-7 pr-3 py-1.5 text-[12px] outline-none focus:border-id-mid" />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10.5px] uppercase tracking-wider text-[var(--tx3)] border-b border-[var(--bdr)]">
                <th className="px-4 py-2.5 font-medium">Destinatário</th>
                <th className="px-4 py-2.5 font-medium">Pago por</th>
                <th className="px-4 py-2.5 font-medium">Tipo</th>
                <th className="px-4 py-2.5 font-medium">Motivo</th>
                <th className="px-4 py-2.5 font-medium">Valor</th>
                <th className="px-4 py-2.5 font-medium">Data pagamento</th>
                <th className="px-4 py-2.5 font-medium">Recebido?</th>
                <th className="px-4 py-2.5 font-medium">Anexo</th>
                <th className="px-4 py-2.5 font-medium text-right"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="text-center py-10 text-[var(--tx3)]">Carregando…</td></tr>
              ) : !rows.length ? (
                <tr><td colSpan={9} className="text-center py-10 text-[var(--tx3)]">{itemsDaConta.length ? 'Nenhum resultado.' : `Nenhum lançamento ainda em "${contaAtualNome}". Clique em "Novo lançamento" para começar.`}</td></tr>
              ) : rows.map((r) => (
                <tr key={r.id} className="border-b border-[var(--bdr)]/60 hover:bg-[var(--sur2)]/60 text-[12.5px]">
                  <td className="px-4 py-3 font-medium max-w-[200px] truncate" title={r.fundo}>{r.fundo}</td>
                  <td className="px-4 py-3 text-[var(--tx2)] max-w-[140px] truncate" title={r.pagoPor}>{r.pagoPor || '—'}</td>
                  <td className="px-4 py-3">
                    {r.tipo === 'credito' ? (
                      <span className="text-[10.5px] font-semibold bg-id-mid/15 text-id-dark dark:text-id-light px-1.5 py-0.5 rounded-md">Crédito</span>
                    ) : (
                      <span className="text-[10.5px] font-semibold bg-red-500/10 text-red-500 px-1.5 py-0.5 rounded-md">Débito</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[var(--tx2)] max-w-[280px] truncate" title={r.motivo}>{r.motivo || '—'}</td>
                  <td className={`px-4 py-3 font-mono font-medium ${r.tipo === 'credito' ? 'text-id-dark dark:text-id-light' : 'text-red-500'}`}>
                    {r.tipo === 'credito' ? '+ ' : '− '}{fmt(r.valor)}
                  </td>
                  <td className="px-4 py-3 text-[var(--tx3)]">{r.data ? new Date(r.data + 'T00:00:00').toLocaleDateString('pt-BR') : '—'}</td>
                  <td className="px-4 py-3">
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" checked={!!r.recebido} onChange={() => toggleRecebido(r.id)} className="sr-only peer" />
                      <span className="w-9 h-5 bg-[var(--sur2)] border border-[var(--bdr)] rounded-full peer-checked:bg-id-mid transition-colors" />
                      <span className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform peer-checked:translate-x-4" />
                    </label>
                  </td>
                  <td className="px-4 py-3">
                    {r.anexoUrl ? (
                      <a href={r.anexoUrl} target="_blank" rel="noreferrer" title={r.anexoNome} className="inline-flex items-center gap-1 text-[11px] text-id-light hover:underline max-w-[110px] truncate">
                        <Paperclip size={12} className="shrink-0" /> {r.anexoNome || 'Arquivo'}
                      </a>
                    ) : (
                      <span className="text-[var(--tx4)] text-[11px]">—</span>
                    )}
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
        <div className="px-4 py-2.5 text-[11px] text-[var(--tx3)] border-t border-[var(--bdr)]">{itemsDaConta.length} registro{itemsDaConta.length !== 1 ? 's' : ''} · conta "{contaAtualNome}"</div>
      </Card>

      {showModal && <NovoLancamentoModal fundosAll={fundosAll} contaAtualNome={contaAtualNome} onClose={() => setShowModal(false)} onSave={addItem} />}
    </div>
  )
}

function PrimeiraConta({ onCreate }) {
  const [nome, setNome] = useState('')
  return (
    <Card className="p-8 max-w-[400px] mx-auto text-center mt-8">
      <Wallet size={22} className="mx-auto text-[var(--tx4)] mb-2" />
      <p className="text-[12.5px] text-[var(--tx3)] mb-4">Antes de lançar qualquer coisa, dá um nome pra sua primeira conta de origem (ex: "Caixa ID Corretora", "Cartão Corporativo"…). Cada conta tem seus próprios lançamentos e KPIs, sem se misturar.</p>
      <input value={nome} onChange={(e) => setNome(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && nome.trim() && onCreate(nome.trim())} placeholder="Nome da conta…" className="w-full bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-id-mid mb-3" />
      <button onClick={() => nome.trim() && onCreate(nome.trim())} disabled={!nome.trim()} className="w-full bg-id-dark hover:bg-id-mid text-white rounded-lg py-2 text-[13px] font-medium disabled:opacity-50">Criar conta</button>
    </Card>
  )
}

function ContaSwitcher({ contas, contaAtual, onSelect, onCreate }) {
  const [open, setOpen] = useState(false)
  const [novaConta, setNovaConta] = useState('')
  const atual = contas.find((c) => c.id === contaAtual)

  function criar() {
    if (!novaConta.trim()) return
    onCreate(novaConta.trim())
    setNovaConta('')
  }

  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 border border-[var(--bdr)] rounded-lg px-2.5 py-1.5 text-[12px] hover:bg-[var(--sur2)]">
        <Wallet size={13} className="text-[var(--tx3)]" />
        <span className="font-medium">{atual?.nome || 'Escolher conta'}</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1.5 w-64 bg-[var(--sur)] border border-[var(--bdr)] rounded-xl shadow-card z-20 overflow-hidden">
            <div className="max-h-52 overflow-y-auto py-1">
              {contas.map((c) => (
                <button
                  key={c.id}
                  onClick={() => { onSelect(c.id); setOpen(false) }}
                  className="w-full flex items-center justify-between gap-2 text-left px-3 py-2 text-[12.5px] hover:bg-[var(--sur2)]"
                >
                  <span className="truncate">{c.nome}</span>
                  {c.id === contaAtual && <Check size={13} className="text-id-light shrink-0" />}
                </button>
              ))}
            </div>
            <div className="border-t border-[var(--bdr)] p-2 flex gap-1.5">
              <input
                value={novaConta}
                onChange={(e) => setNovaConta(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && criar()}
                placeholder="Nova conta…"
                className="flex-1 bg-[var(--sur2)] border border-[var(--bdr)] rounded-md px-2 py-1 text-[11.5px] outline-none focus:border-id-mid"
              />
              <button onClick={criar} className="text-[var(--tx3)] hover:text-id-light shrink-0"><Plus size={16} /></button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function NovoLancamentoModal({ fundosAll, contaAtualNome, onClose, onSave }) {
  const [fundo, setFundo] = useState('')
  const [pagoPor, setPagoPor] = useState('')
  const [tipo, setTipo] = useState('debito')
  const [motivo, setMotivo] = useState('')
  const [valor, setValor] = useState('')
  const [data, setData] = useState(new Date().toISOString().slice(0, 10))
  const [file, setFile] = useState(null)
  const [showList, setShowList] = useState(false)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)

  const matches = fundo.trim().length >= 2
    ? fundosAll.filter((f) => f.nome.toLowerCase().includes(fundo.toLowerCase())).slice(0, 8)
    : []

  async function submit() {
    if (!fundo.trim()) { setError('Informe a referência.'); return }
    const v = Number(String(valor).replace(',', '.'))
    if (!v || v <= 0) { setError('Informe um valor válido.'); return }
    const payload = { fundo: fundo.trim(), pagoPor: pagoPor.trim(), tipo, motivo: motivo.trim(), valor: v, data }
    if (file) {
      setUploading(true)
      try {
        const path = `controles_internos/${Date.now()}_${file.name}`
        const fileRef = ref(storage, path)
        await uploadBytes(fileRef, file)
        payload.anexoUrl = await getDownloadURL(fileRef)
        payload.anexoNome = file.name
      } catch (e) {
        setError('Erro ao enviar o anexo: ' + e.message)
        setUploading(false)
        return
      }
      setUploading(false)
    }
    onSave(payload)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-[var(--sur)] border border-[var(--bdr)] rounded-xl w-full max-w-[420px] shadow-card max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--bdr)]">
          <div>
            <div className="font-display font-semibold text-[14px]">Novo lançamento</div>
            <div className="text-[11px] text-[var(--tx3)] flex items-center gap-1"><Wallet size={11} /> Conta: {contaAtualNome}</div>
          </div>
          <button onClick={onClose} className="text-[var(--tx3)] hover:text-[var(--tx)]"><X size={18} /></button>
        </div>
        <div className="p-5 flex flex-col gap-3">
          <div>
            <label className="block text-[11px] text-[var(--tx3)] mb-1">Quem pagou</label>
            <input
              value={pagoPor}
              onChange={(e) => setPagoPor(e.target.value)}
              placeholder="Ex: ID Corretora, ou o nome de quem adiantou…"
              list="pagoPorOptions"
              className="w-full bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-id-mid"
            />
            <datalist id="pagoPorOptions">
              <option value="ID Corretora" />
              {COLABORADORES.map((c) => <option key={c.slug} value={c.name} />)}
            </datalist>
          </div>

          <div>
            <label className="block text-[11px] text-[var(--tx3)] mb-1">Tipo</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setTipo('debito')}
                className={`rounded-lg py-2 text-[12.5px] font-medium border transition-colors ${tipo === 'debito' ? 'bg-red-500/10 border-red-500/50 text-red-500' : 'border-[var(--bdr)] text-[var(--tx3)] hover:bg-[var(--sur2)]'}`}
              >
                Débito (saiu)
              </button>
              <button
                type="button"
                onClick={() => setTipo('credito')}
                className={`rounded-lg py-2 text-[12.5px] font-medium border transition-colors ${tipo === 'credito' ? 'bg-id-mid/15 border-id-mid/50 text-id-dark dark:text-id-light' : 'border-[var(--bdr)] text-[var(--tx3)] hover:bg-[var(--sur2)]'}`}
              >
                Crédito (entrou)
              </button>
            </div>
          </div>

          <div className="relative">
            <label className="block text-[11px] text-[var(--tx3)] mb-1">Destinatário do recurso</label>
            <input
              value={fundo}
              onChange={(e) => { setFundo(e.target.value); setShowList(true) }}
              onFocus={() => setShowList(true)}
              placeholder="Nome do fundo, contrato, ou o que for…"
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

          <div>
            <label className="block text-[11px] text-[var(--tx3)] mb-1">Anexo (comprovante, opcional)</label>
            <label className="flex items-center gap-2 border border-dashed border-[var(--bdr)] rounded-lg px-3 py-2.5 text-[12px] text-[var(--tx3)] hover:bg-[var(--sur2)] cursor-pointer">
              <Paperclip size={14} className="shrink-0" />
              <span className="truncate">{file ? file.name : 'Escolher arquivo (PDF, imagem…)'}</span>
              <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} className="hidden" />
            </label>
          </div>

          {error && <p className="text-[11.5px] text-red-400">{error}</p>}

          <button onClick={submit} disabled={uploading} className="w-full bg-id-dark hover:bg-id-mid text-white rounded-lg py-2.5 text-[13px] font-medium mt-1 disabled:opacity-50">
            {uploading ? 'Enviando anexo…' : 'Registrar lançamento'}
          </button>
        </div>
      </div>
    </div>
  )
}
