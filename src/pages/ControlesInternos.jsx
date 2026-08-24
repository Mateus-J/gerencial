import { useEffect, useMemo, useRef, useState } from 'react'
import { doc, onSnapshot, setDoc } from 'firebase/firestore'
import { Plus, X, Search, CheckCircle2, Paperclip, Wallet, Check, Trash2, Info, Download } from 'lucide-react'
import * as XLSX from 'xlsx'
import { db } from '../lib/firebase'
import { PageHeader, Card } from '../components/PageShell'
import KpiCard from '../components/KpiCard'
import { useFundos } from '../hooks/useFundos'
import { COLABORADORES } from '../hooks/useBoard'
import { uploadToLancamentoFolder, isDriveConfigured } from '../lib/googleDrive'
import { useToast } from '../components/Toast'

const DOC_REF = () => doc(db, 'controle', 'controles_internos')
const CONTA_ATUAL_KEY = 'ci_conta_atual'

const fmt = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Se for um link do Google Drive, converte pro formato de download direto
// (uc?export=download&id=...). Fora do Drive, ou se não reconhecer o
// formato, mantém o link como veio. Arquivos grandes no Drive ainda podem
// mostrar uma tela de confirmação do próprio Google antes de baixar —
// isso é uma trava do Drive, não tem como contornar de fora.
function toDownloadLink(url) {
  if (!url) return url
  const m = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/[?&]id=([a-zA-Z0-9_-]+)/)
  if (m && url.includes('drive.google.com')) return `https://drive.google.com/uc?export=download&id=${m[1]}`
  return url
}

export default function ControlesInternos() {
  const toast = useToast()
  const { all: fundosAll } = useFundos()
  const [items, setItems] = useState([])
  const [contas, setContas] = useState([])
  const [proximoNumero, setProximoNumero] = useState(1)
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [detailItem, setDetailItem] = useState(null)
  const [contaAtual, setContaAtual] = useState(() => localStorage.getItem(CONTA_ATUAL_KEY) || '')
  const itemsRef = useRef(items)
  itemsRef.current = items

  useEffect(() => {
    const unsub = onSnapshot(DOC_REF(), (snap) => {
      const data = snap.exists() ? snap.data() : {}
      setItems(data.items || [])
      setContas(data.contas || [])
      setProximoNumero(data.proximoNumero || 1)
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

  function persist(nextItems, nextContas, nextNumero) {
    setItems(nextItems)
    if (nextContas) setContas(nextContas)
    if (nextNumero) setProximoNumero(nextNumero)
    setDoc(DOC_REF(), {
      items: nextItems,
      contas: nextContas || contas,
      proximoNumero: nextNumero || proximoNumero,
      updatedAt: Date.now(),
    }, { merge: false }).catch((e) => { console.warn('ciSave err', e); toast.error('Erro ao salvar: ' + e.message) })
  }

  function addConta(nome) {
    const id = 'conta' + Date.now()
    const nextContas = [...contas, { id, nome }]
    persist(items, nextContas)
    selectConta(id)
    toast.success(`Conta "${nome}" criada!`)
    return id
  }

  function removeConta(id) {
    const conta = contas.find((c) => c.id === id)
    const vinculados = items.filter((i) => i.contaId === id)
    const aviso = vinculados.length
      ? `Excluir a conta "${conta.nome}"? Ela tem ${vinculados.length} lançamento(s) — todos serão excluídos junto. Não dá pra desfazer.`
      : `Excluir a conta "${conta.nome}"? Não dá pra desfazer.`
    if (!confirm(aviso)) return
    const nextContas = contas.filter((c) => c.id !== id)
    const nextItems = items.filter((i) => i.contaId !== id)
    persist(nextItems, nextContas)
    if (contaAtual === id) {
      const proxima = nextContas[0]?.id || ''
      setContaAtual(proxima)
      localStorage.setItem(CONTA_ATUAL_KEY, proxima)
    }
    toast.success(`Conta "${conta.nome}" excluída.`)
  }

  function addItem(data) {
    const numero = proximoNumero
    persist([{ id: 'ci' + Date.now(), numero, contaId: contaAtual, recebido: false, createdAt: new Date().toISOString(), ...data }, ...items], null, numero + 1)
    setShowModal(false)
    toast.success('Lançamento registrado!')
  }
  function toggleReembolsavel(id) {
    const next = items.map((i) => i.id === id ? { ...i, reembolsavel: i.reembolsavel === false } : i)
    persist(next)
    const item = next.find((i) => i.id === id)
    toast.success(item.reembolsavel ? 'Marcado como reembolsável.' : 'Marcado como não reembolsável (custo da ID Corretora).')
  }
  function toggleRecebido(id) {
    const next = items.map((i) => i.id === id ? { ...i, recebido: !i.recebido, recebidoEm: !i.recebido ? new Date().toISOString() : null } : i)
    persist(next)
    const item = next.find((i) => i.id === id)
    toast.success(item.recebido ? 'Marcado como recebido!' : 'Marcado como pendente novamente.')
  }
  function removeItem(id) {
    const item = items.find((i) => i.id === id)
    if (!item) return
    if (!confirm(`Excluir o lançamento ${String(item.numero).padStart(4, '0')} (${item.fundo})?`)) return
    persist(items.filter((i) => i.id !== id))
    toast.success('Lançamento excluído.', {
      label: 'Desfazer',
      onClick: () => {
        persist([item, ...itemsRef.current.filter((i) => i.id !== id)])
        toast.success('Lançamento restaurado!')
      },
    })
  }

  // Tudo abaixo — KPIs e tabela — só considera a conta selecionada, pra
  // nunca misturar números/controles de contas diferentes na mesma tela.
  const itemsDaConta = useMemo(() => items.filter((i) => i.contaId === contaAtual), [items, contaAtual])

  function exportExcel() {
    if (!rows.length) { toast.error('Nenhum dado para exportar.'); return }
    const headers = ['ID', 'Pago por', 'Destinatário', 'Tipo', 'Reembolsável', 'Recebido', 'Motivo', 'Valor', 'Data pagamento', 'Saldo após', 'Anexo']
    const ANEXO_COL = headers.length - 1
    const dataRows = rows.map((r) => [
      r.numero ? String(r.numero).padStart(4, '0') : '',
      r.pagoPor || '',
      r.fundo || '',
      r.tipo === 'credito' ? 'Crédito' : 'Débito',
      r.reembolsavel === false ? 'Não' : 'Sim',
      r.reembolsavel === false ? 'N/A' : (r.recebido ? 'Sim' : 'Não'),
      r.motivo || '',
      (r.tipo === 'credito' ? 1 : -1) * Number(r.valor || 0),
      r.data ? new Date(r.data + 'T00:00:00').toLocaleDateString('pt-BR') : '',
      saldoPorItem.has(r.id) ? saldoPorItem.get(r.id).depois : '',
      r.anexoUrl ? 'Abrir anexo' : '',
    ])
    const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows])
    // Transforma a célula "Abrir anexo" num hyperlink de verdade (com clique
    // já indo pro formato de download direto do Drive, quando aplicável).
    rows.forEach((r, i) => {
      if (r.anexoUrl) {
        const ref = XLSX.utils.encode_cell({ r: i + 1, c: ANEXO_COL })
        ws[ref] = { t: 's', v: 'Abrir anexo', l: { Target: toDownloadLink(r.anexoUrl), Tooltip: r.anexoNome || 'Abrir anexo' } }
      }
    })
    ws['!cols'] = [{ wch: 8 }, { wch: 20 }, { wch: 30 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 36 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 13 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Controles Internos')
    XLSX.writeFile(wb, `controles_internos_${(contaAtualNome || 'conta').replace(/[^\w-]+/g, '_')}_${new Date().toISOString().slice(0, 10)}.xlsx`)
    toast.success('Excel exportado!')
  }

  const rows = useMemo(() => itemsDaConta.filter((i) =>
    (i.fundo || '').toLowerCase().includes(q.toLowerCase()) || (i.motivo || '').toLowerCase().includes(q.toLowerCase()) || (i.pagoPor || '').toLowerCase().includes(q.toLowerCase())
  ), [itemsDaConta, q])

  // Saldo acumulado da conta, andando em ordem cronológica (data de
  // pagamento, com o número sequencial como desempate pra mesma data) —
  // assim cada lançamento mostra como o saldo estava antes e ficou depois
  // dele, tipo um extrato.
  const saldoPorItem = useMemo(() => {
    const ordenado = [...itemsDaConta].sort((a, b) => {
      const d = (a.data || '').localeCompare(b.data || '')
      return d !== 0 ? d : (a.numero || 0) - (b.numero || 0)
    })
    const map = new Map()
    let acumulado = 0
    for (const i of ordenado) {
      const antes = acumulado
      acumulado += i.tipo === 'credito' ? Number(i.valor || 0) : -Number(i.valor || 0)
      map.set(i.id, { antes, depois: acumulado })
    }
    return map
  }, [itemsDaConta])

  const totalDebito = itemsDaConta.filter((i) => i.tipo !== 'credito').reduce((a, i) => a + Number(i.valor || 0), 0)
  const totalCredito = itemsDaConta.filter((i) => i.tipo === 'credito').reduce((a, i) => a + Number(i.valor || 0), 0)
  // Só entra como "pendente de recebimento" o que é reembolsável — um custo
  // que já é da própria ID Corretora (não reembolsável) nunca vai ser
  // "recebido", então não faz sentido contar como pendência.
  const pendentesReembolsaveis = itemsDaConta.filter((i) => i.reembolsavel !== false && !i.recebido)
  const totalPendente = pendentesReembolsaveis.reduce((a, i) => a + Number(i.valor || 0), 0)
  const qtdPendente = pendentesReembolsaveis.length
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
            <ContaSwitcher contas={contas} contaAtual={contaAtual} onSelect={selectConta} onCreate={addConta} onRemove={removeConta} />
            <button onClick={exportExcel} className="flex items-center gap-1.5 border border-[var(--bdr)] rounded-lg px-3 py-1.5 text-[12.5px] text-[var(--tx2)] hover:bg-[var(--sur2)]">
              <Download size={14} /> Exportar Excel
            </button>
            <button onClick={() => setShowModal(true)} className="flex items-center gap-1.5 bg-id-dark hover:bg-id-mid text-white rounded-lg px-3 py-1.5 text-[12.5px] font-medium">
              <Plus size={14} /> Novo lançamento
            </button>
          </div>
        }
      />
      <p className="text-[11.5px] text-[var(--tx3)] -mt-2 mb-4">Fluxo de caixa e reembolsos</p>

      <div className="flex flex-wrap gap-3 mb-4">
        <KpiCard label="Total débito" value={fmt(totalDebito)} sub="pago pela ID Corretora" accent="red" />
        <KpiCard label="Total crédito" value={fmt(totalCredito)} sub="recebido / reembolsado" accent="green" />
        <KpiCard label="Saldo" value={fmt(saldo)} sub={saldo >= 0 ? 'a favor' : 'a descoberto'} accent="blue" />
        <KpiCard label="Pendente de recebimento" value={fmt(totalPendente)} sub={`${qtdPendente} em aberto`} accent={qtdPendente > 0 ? 'amber' : 'neutral'} />
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
                <th className="px-4 py-2.5 font-medium">ID</th>
                <th className="px-4 py-2.5 font-medium">Pago por</th>
                <th className="px-4 py-2.5 font-medium">Destinatário</th>
                <th className="px-4 py-2.5 font-medium">Tipo</th>
                <th className="px-4 py-2.5 font-medium">Valor</th>
                <th className="px-4 py-2.5 font-medium">Saldo</th>
                <th className="px-4 py-2.5 font-medium">Data pagamento</th>
                <th className="px-4 py-2.5 font-medium">Reembolsável?</th>
                <th className="px-4 py-2.5 font-medium">Recebido?</th>
                <th className="px-4 py-2.5 font-medium">Anexo</th>
                <th className="px-4 py-2.5 font-medium text-right"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={11} className="text-center py-10 text-[var(--tx3)]">Carregando…</td></tr>
              ) : !rows.length ? (
                <tr><td colSpan={11} className="text-center py-10 text-[var(--tx3)]">{itemsDaConta.length ? 'Nenhum resultado.' : `Nenhum lançamento ainda em "${contaAtualNome}". Clique em "Novo lançamento" para começar.`}</td></tr>
              ) : rows.map((r) => (
                <tr key={r.id} className="group/row border-b border-[var(--bdr)]/60 hover:bg-[var(--sur2)]/60 text-[12.5px]">
                  <td className="px-4 py-3 text-[var(--tx3)] font-mono">{r.numero ? String(r.numero).padStart(4, '0') : '—'}</td>
                  <td className="px-4 py-3 text-[var(--tx2)] max-w-[200px] truncate" title={r.pagoPor}>{r.pagoPor || '—'}</td>
                  <td className="px-4 py-3 font-medium max-w-[260px] truncate" title={r.fundo}>{r.fundo}</td>
                  <td className="px-4 py-3">
                    {r.tipo === 'credito' ? (
                      <span className="text-[10.5px] font-semibold bg-id-mid/15 text-id-dark dark:text-id-light px-1.5 py-0.5 rounded-md">Crédito</span>
                    ) : (
                      <span className="text-[10.5px] font-semibold bg-red-500/10 text-red-500 px-1.5 py-0.5 rounded-md">Débito</span>
                    )}
                  </td>
                  <td className={`px-4 py-3 font-mono font-medium whitespace-nowrap ${r.tipo === 'credito' ? 'text-id-dark dark:text-id-light' : 'text-red-500'}`}>
                    {r.tipo === 'credito' ? '+ ' : '− '}{fmt(r.valor)}
                  </td>
                  <td className="px-4 py-3 font-mono font-medium whitespace-nowrap text-sky-600 dark:text-sky-400" title={saldoPorItem.has(r.id) ? `Antes: ${fmt(saldoPorItem.get(r.id).antes)}` : ''}>
                    {saldoPorItem.has(r.id) ? fmt(saldoPorItem.get(r.id).depois) : '—'}
                  </td>
                  <td className="px-4 py-3 text-[var(--tx3)] whitespace-nowrap">{r.data ? new Date(r.data + 'T00:00:00').toLocaleDateString('pt-BR') : '—'}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggleReembolsavel(r.id)}
                      title="Clique para alternar"
                      className={`text-[10.5px] font-medium hover:underline ${r.reembolsavel === false ? 'text-red-500' : 'text-id-dark dark:text-id-light'}`}
                    >
                      {r.reembolsavel === false ? 'Não' : 'Sim'}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    {r.reembolsavel === false ? (
                      <span className="text-[var(--tx4)] text-[11px]">N/A</span>
                    ) : (
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" checked={!!r.recebido} onChange={() => toggleRecebido(r.id)} className="sr-only peer" />
                        <span className="w-9 h-5 bg-[var(--sur2)] border border-[var(--bdr)] rounded-full peer-checked:bg-id-mid transition-colors" />
                        <span className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform peer-checked:translate-x-4" />
                      </label>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {r.anexoUrl ? (
                      <a href={toDownloadLink(r.anexoUrl)} target="_blank" rel="noreferrer" title={r.anexoNome || r.anexoUrl} className="inline-flex text-id-light hover:text-id-dark dark:hover:text-white">
                        <Paperclip size={15} />
                      </a>
                    ) : (
                      <span className="text-[var(--tx4)] text-[11px]">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center gap-2 justify-end">
                      {r.recebido && <CheckCircle2 size={14} className="text-id-light" />}
                      <button onClick={() => setDetailItem(r)} title="Ver motivo e detalhes" className="opacity-70 hover:opacity-100 text-[var(--tx3)] hover:text-id-light"><Info size={14} /></button>
                      <button onClick={() => removeItem(r.id)} title="Excluir" className="opacity-0 group-hover/row:opacity-100 text-[var(--tx4)] hover:text-red-500 transition-opacity"><X size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2.5 text-[11px] text-[var(--tx3)] border-t border-[var(--bdr)]">{itemsDaConta.length} registro{itemsDaConta.length !== 1 ? 's' : ''} · conta "{contaAtualNome}"</div>
      </Card>

      {detailItem && <DetailModal item={detailItem} onClose={() => setDetailItem(null)} />}

      {showModal && <NovoLancamentoModal fundosAll={fundosAll} contaAtualNome={contaAtualNome} numeroPrevisto={proximoNumero} onClose={() => setShowModal(false)} onSave={addItem} />}
    </div>
  )
}

function DetailField({ label, value }) {
  if (!value) return null
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-[var(--tx3)] mb-0.5">{label}</div>
      <div className="text-[13px] text-[var(--tx)] whitespace-pre-wrap break-words">{value}</div>
    </div>
  )
}

function DetailModal({ item, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-[var(--sur)] border border-[var(--bdr)] rounded-xl w-full max-w-[440px] shadow-card max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--bdr)]">
          <div>
            <div className="font-display font-semibold text-[15px]">{item.fundo}</div>
            <div className="text-[11px] text-[var(--tx3)] font-mono">{String(item.numero).padStart(4, '0')}</div>
          </div>
          <button onClick={onClose} className="text-[var(--tx3)] hover:text-[var(--tx)]"><X size={18} /></button>
        </div>
        <div className="p-5 flex flex-col gap-3.5">
          <DetailField label="Motivo" value={item.motivo} />
          <div className="grid grid-cols-2 gap-3">
            <DetailField label="Pago por" value={item.pagoPor} />
            <DetailField label="Tipo" value={item.tipo === 'credito' ? 'Crédito' : 'Débito'} />
            <DetailField label="Reembolsável?" value={item.reembolsavel === false ? 'Não' : 'Sim'} />
            <DetailField label="Recebido?" value={item.reembolsavel === false ? 'N/A' : (item.recebido ? 'Sim' : 'Ainda não')} />
          </div>
          {item.createdAt && <DetailField label="Registrado em" value={new Date(item.createdAt).toLocaleString('pt-BR')} />}
        </div>
      </div>
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

function ContaSwitcher({ contas, contaAtual, onSelect, onCreate, onRemove }) {
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
                <div key={c.id} className="group/conta flex items-center hover:bg-[var(--sur2)]">
                  <button
                    onClick={() => { onSelect(c.id); setOpen(false) }}
                    className="flex-1 flex items-center justify-between gap-2 text-left px-3 py-2 text-[12.5px] min-w-0"
                  >
                    <span className="truncate">{c.nome}</span>
                    {c.id === contaAtual && <Check size={13} className="text-id-light shrink-0" />}
                  </button>
                  <button
                    onClick={() => onRemove(c.id)}
                    title="Excluir conta"
                    className="opacity-0 group-hover/conta:opacity-100 text-[var(--tx4)] hover:text-red-500 px-2 shrink-0"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
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

function NovoLancamentoModal({ fundosAll, contaAtualNome, numeroPrevisto, onClose, onSave }) {
  const [fundo, setFundo] = useState('')
  const [pagoPor, setPagoPor] = useState('')
  const [tipo, setTipo] = useState('debito')
  const [reembolsavel, setReembolsavel] = useState(true)
  const [motivo, setMotivo] = useState('')
  const [valor, setValor] = useState('')
  const [data, setData] = useState(new Date().toISOString().slice(0, 10))
  const [anexoMode, setAnexoMode] = useState(isDriveConfigured() ? 'upload' : 'link')
  const [driveFile, setDriveFile] = useState(null)
  const [anexoUrl, setAnexoUrl] = useState('')
  const [anexoNome, setAnexoNome] = useState('')
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
    const payload = { fundo: fundo.trim(), pagoPor: pagoPor.trim(), tipo, reembolsavel, motivo: motivo.trim(), valor: v, data }

    if (anexoMode === 'upload' && driveFile) {
      setUploading(true)
      setError('')
      try {
        const idLabel = String(numeroPrevisto).padStart(4, '0')
        const { url } = await uploadToLancamentoFolder(driveFile, idLabel)
        payload.anexoUrl = url
        payload.anexoNome = driveFile.name
      } catch (e) {
        setUploading(false)
        if (!confirm(`Não consegui enviar pro Drive (${e.message}). Quer salvar o lançamento sem o anexo mesmo assim?`)) return
      }
      setUploading(false)
    } else if (anexoMode === 'link' && anexoUrl.trim()) {
      payload.anexoUrl = anexoUrl.trim()
      payload.anexoNome = anexoNome.trim() || 'Anexo'
    }
    onSave(payload)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
      <div onClick={(e) => e.stopPropagation()} className="bg-[var(--sur)] border border-[var(--bdr)] rounded-xl w-full max-w-[420px] shadow-card max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--bdr)]">
          <div>
            <div className="font-display font-semibold text-[14px]">Novo lançamento <span className="text-[var(--tx3)] font-mono text-[12px]">{String(numeroPrevisto).padStart(4, '0')}</span></div>
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

          {tipo === 'debito' && (
            <div>
              <label className="block text-[11px] text-[var(--tx3)] mb-1">É reembolsável?</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setReembolsavel(true)}
                  className={`rounded-lg py-2 text-[12.5px] font-medium border transition-colors ${reembolsavel ? 'bg-id-mid/15 border-id-mid/50 text-id-dark dark:text-id-light' : 'border-[var(--bdr)] text-[var(--tx3)] hover:bg-[var(--sur2)]'}`}
                >
                  Sim, o fundo reembolsa
                </button>
                <button
                  type="button"
                  onClick={() => setReembolsavel(false)}
                  className={`rounded-lg py-2 text-[12.5px] font-medium border transition-colors ${!reembolsavel ? 'bg-[var(--sur2)] border-[var(--bdr)] text-[var(--tx2)]' : 'border-[var(--bdr)] text-[var(--tx3)] hover:bg-[var(--sur2)]'}`}
                >
                  Não, custo da ID Corretora
                </button>
              </div>
            </div>
          )}

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
            <label className="block text-[11px] text-[var(--tx3)] mb-1.5">Anexo (opcional)</label>
            <div className="flex items-center gap-1 bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg p-0.5 mb-2 w-fit">
              <button
                type="button"
                onClick={() => setAnexoMode('upload')}
                className={`text-[11.5px] px-2.5 py-1 rounded-md transition-colors ${anexoMode === 'upload' ? 'bg-[var(--sur)] shadow-card' : 'text-[var(--tx3)]'}`}
              >
                Enviar arquivo
              </button>
              <button
                type="button"
                onClick={() => setAnexoMode('link')}
                className={`text-[11.5px] px-2.5 py-1 rounded-md transition-colors ${anexoMode === 'link' ? 'bg-[var(--sur)] shadow-card' : 'text-[var(--tx3)]'}`}
              >
                Colar link
              </button>
            </div>

            {anexoMode === 'upload' ? (
              !isDriveConfigured() ? (
                <p className="text-[11.5px] text-amber-500 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">A integração com o Drive ainda não foi configurada (falta o Client ID). Usa "Colar link" por enquanto.</p>
              ) : (
                <>
                  <label className="flex items-center gap-2 border border-dashed border-[var(--bdr)] rounded-lg px-3 py-2.5 text-[12px] text-[var(--tx3)] hover:bg-[var(--sur2)] cursor-pointer">
                    <Paperclip size={14} className="shrink-0" />
                    <span className="truncate">{driveFile ? driveFile.name : 'Escolher arquivo (PDF, imagem…)'}</span>
                    <input type="file" onChange={(e) => setDriveFile(e.target.files?.[0] || null)} className="hidden" />
                  </label>
                </>
              )
            ) : (
              <>
                <div className="flex items-center gap-2 mb-1.5">
                  <Paperclip size={14} className="shrink-0 text-[var(--tx3)]" />
                  <input
                    value={anexoUrl}
                    onChange={(e) => setAnexoUrl(e.target.value)}
                    placeholder="Cole o link de compartilhamento do Drive…"
                    className="flex-1 bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-id-mid"
                  />
                </div>
                {anexoUrl.trim() && (
                  <input
                    value={anexoNome}
                    onChange={(e) => setAnexoNome(e.target.value)}
                    placeholder="Nome pra exibir (ex: nota_fiscal.pdf)"
                    className="w-full bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-3 py-1.5 text-[12px] outline-none focus:border-id-mid"
                  />
                )}
              </>
            )}
          </div>

          {error && <p className="text-[11.5px] text-red-400">{error}</p>}

          <button onClick={submit} disabled={uploading} className="w-full bg-id-dark hover:bg-id-mid text-white rounded-lg py-2.5 text-[13px] font-medium mt-1 disabled:opacity-50">
            {uploading ? 'Enviando pro Drive…' : 'Registrar lançamento'}
          </button>
        </div>
      </div>
    </div>
  )
}
