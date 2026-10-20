// Transfer / Closed: controle dos fundos que saem (transferência) ou encerram.
// Base ao vivo para toda a equipe (um documento em controle/transfer_closed),
// gravação em transação sobre a versão mais recente do servidor.
import { useEffect, useMemo, useRef, useState } from 'react'
import { doc, onSnapshot, runTransaction } from 'firebase/firestore'
import * as XLSX from 'xlsx'
import {
  Plus, Upload, Download, X, Landmark, Lock, Wallet, AlertTriangle, ChevronRight, CheckCircle2, Circle,
  Trash2, RefreshCw, Clock, ArrowRightLeft, Archive, Loader2,
} from 'lucide-react'
import { db } from '../lib/firebase'
import { PageHeader, Card } from '../components/PageShell'
import { useToast } from '../components/Toast'
import { useOptionalAuth } from '../context/AuthContext'
import AnimatedNumber from '../components/AnimatedNumber'
import { StatCard, MiniStat, RankCard, Overlay } from '../components/taxa/Cards'
import { norm, onlyDigits, fmtFull, fmtShort, todayISO, brDate } from '../lib/taxaCore'
import {
  CONTA_NOME, ETAPAS, CANCELADO, ETAPA, ETAPA_TONE, TIPOS, CATEGORIAS, ITENS_RETENCAO, proximaEtapa, checklistDe,
  parseValor, novoId, resumo, carregarBases, fundoPorCnpj, pendenciasDoSistema, parsePlanilha, mergePlanilha,
  novoProcesso, EXPORT_HEADERS, toSheetRow,
} from '../lib/transfer'

const DOC_REF = () => doc(db, 'controle', 'transfer_closed')
const fmtInput = (v) => (Number(v) ? Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '')

function EtapaBadge({ id, className = '' }) {
  const e = ETAPA[id] || ETAPA.solicitado
  return <span className={`inline-flex items-center text-[10.5px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${ETAPA_TONE[e.id]} ${className}`}>{e.label}</span>
}
function TipoBadge({ tipo }) {
  const t = tipo === 'TRANSFER'
  return (
    <span className={`inline-flex items-center gap-1 text-[10.5px] font-semibold px-2 py-0.5 rounded-md whitespace-nowrap ${t ? 'bg-sky-500/10 text-sky-600 dark:text-sky-300' : 'bg-red-500/10 text-red-600 dark:text-red-300'}`}>
      {t ? <ArrowRightLeft size={11} /> : <Archive size={11} />}{TIPOS[tipo] || tipo}
    </span>
  )
}

export default function TransferClosed({ search, onSearch }) {
  const toast = useToast()
  const currentUser = useOptionalAuth()?.currentUser
  const who = currentUser?.name || currentUser?.username || ''
  const [data, setData] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const [live, setLive] = useState('connecting')
  const [saving, setSaving] = useState(0)
  const [fEtapa, setFEtapa] = useState('ativos') // 'ativos' | 'todos' | id da etapa
  const [fTipo, setFTipo] = useState('')
  const [qLocal, setQLocal] = useState('')
  const q = onSearch ? search || '' : qLocal
  const [aberto, setAberto] = useState(null) // id do processo, ou 'novo'
  const [editSaldo, setEditSaldo] = useState(false)
  const fileRef = useRef(null)

  useEffect(() => onSnapshot(DOC_REF(), { includeMetadataChanges: true }, (snap) => {
    setLive(snap.metadata.fromCache ? 'offline' : 'ok')
    setData(snap.exists() ? snap.data() : null)
    setLoaded(true)
  }, (e) => { console.warn('tcLoad err', e); setLive('offline'); setLoaded(true) }), [])

  const processos = useMemo(() => data?.processos || [], [data])
  const conta = data?.conta || {}

  async function mutate(fn, { msg, contaPatch } = {}) {
    setData((d) => ({ ...(d || {}), processos: fn(d?.processos || []), conta: { ...(d?.conta || {}), ...(contaPatch || {}) } }))
    setSaving((s) => s + 1)
    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(DOC_REF())
        const cur = snap.exists() ? snap.data() : {}
        tx.set(DOC_REF(), {
          processos: fn(cur.processos || []),
          conta: { ...(cur.conta || {}), ...(contaPatch || {}) },
          updatedAt: Date.now(), updatedBy: who,
        })
      })
      if (msg) toast.success(msg)
    } catch (e) {
      console.warn('tcSave err', e)
      toast.error('Não foi possível salvar: ' + e.message)
    } finally {
      setSaving((s) => s - 1)
    }
  }

  function salvarProcesso(p) {
    const isNew = !processos.some((x) => x.id === p.id)
    mutate((list) => (isNew ? [p, ...list] : list.map((x) => (x.id === p.id ? p : x))), { msg: isNew ? 'Processo criado.' : 'Processo atualizado.' })
  }
  function excluirProcesso(p) {
    mutate((list) => list.filter((x) => x.id !== p.id), { msg: `${p.fundo || 'Processo'} excluído.` })
  }
  function salvarSaldoConta(v) {
    mutate((l) => l, { contaPatch: { saldoInformado: v, informadoEm: Date.now(), informadoPor: who }, msg: 'Saldo da conta atualizado.' })
    setEditSaldo(false)
  }

  function handleFile(file) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const linhas = parsePlanilha(e.target.result)
        if (!linhas.length) { toast.error('Não encontrei fundos na planilha. Ela precisa das colunas "Fundo" e "CNPJ".'); return }
        const prev = mergePlanilha(processos, linhas, who)
        if (!prev.novos && !prev.atualizados) { toast.success('Planilha conferida: nada novo para atualizar.'); return }
        if (!confirm(`Aplicar a planilha? ${prev.novos} fundo(s) novo(s) e ${prev.atualizados} atualizado(s). Retenções, checklist e histórico de quem já existe ficam como estão.`)) return
        mutate((list) => mergePlanilha(list, linhas, who).processos, { msg: `Planilha aplicada: ${prev.novos} novo(s), ${prev.atualizados} atualizado(s).` })
      } catch (err) { console.error(err); toast.error('Erro ao ler a planilha: ' + err.message) }
    }
    reader.readAsArrayBuffer(file)
    if (fileRef.current) fileRef.current.value = ''
  }

  function exportar() {
    if (!processos.length) { toast.error('Nenhum processo para exportar.'); return }
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([EXPORT_HEADERS, ...processos.map(toSheetRow)])
    ws['!cols'] = EXPORT_HEADERS.map((h) => ({ wch: h === 'Fundo' ? 55 : 16 }))
    XLSX.utils.book_append_sheet(wb, ws, 'Fundos')
    const det = [['Fundo', 'CNPJ', 'Item', 'Valor', 'Status', 'Data de pagamento', 'Observação']]
    processos.forEach((p) => (p.retencoes || []).forEach((r) => det.push([p.fundo, p.cnpj, r.item, Number(r.valor) || 0, r.status === 'PAGO' ? 'Pago' : 'Pendente', brDate(r.dataPagamento), r.obs || ''])))
    const ws2 = XLSX.utils.aoa_to_sheet(det)
    ws2['!cols'] = [{ wch: 55 }, { wch: 20 }, { wch: 24 }, { wch: 14 }, { wch: 10 }, { wch: 14 }, { wch: 50 }]
    XLSX.utils.book_append_sheet(wb, ws2, 'Saldo retido')
    XLSX.writeFile(wb, `transfer_closed_${todayISO()}.xlsx`)
  }

  // ---- números ----
  const comResumo = useMemo(() => processos.map((p) => ({ p, r: resumo(p) })), [processos])
  const ativos = comResumo.filter((x) => x.r.ativo)
  const saldoConta = ativos.reduce((a, x) => a + x.r.saldo, 0)
  const retPend = ativos.reduce((a, x) => a + x.r.pendente, 0)
  const retPago = ativos.reduce((a, x) => a + x.r.pago, 0)
  const liberavel = ativos.reduce((a, x) => a + x.r.liberavel, 0)
  const atrasados = ativos.filter((x) => x.r.atrasado).length
  const insuf = ativos.filter((x) => x.r.insuficiente).length
  const informado = conta.saldoInformado
  const diferenca = informado != null ? informado - saldoConta : null
  const porEtapa = Object.fromEntries([...ETAPAS, CANCELADO].map((e) => [e.id, comResumo.filter((x) => x.p.status === e.id).length]))

  const lista = useMemo(() => {
    const qq = norm(q), qd = /^[\d./\-\s]+$/.test(q) ? onlyDigits(q) : ''
    return comResumo
      .filter(({ p, r }) => {
        if (fEtapa === 'ativos' && !r.ativo) return false
        if (fEtapa !== 'ativos' && fEtapa !== 'todos' && p.status !== fEtapa) return false
        if (fTipo && p.tipo !== fTipo) return false
        if (qq && !norm(p.fundo).includes(qq) && !(qd && onlyDigits(p.cnpj).includes(qd))) return false
        return true
      })
      .sort((a, b) => (b.r.atrasado - a.r.atrasado) || (ETAPA[a.p.status].ordem - ETAPA[b.p.status].ordem) || String(a.p.dataPrevista || '9').localeCompare(String(b.p.dataPrevista || '9')) || a.p.fundo.localeCompare(b.p.fundo))
  }, [comResumo, fEtapa, fTipo, q])

  const header = (
    <>
      <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => handleFile(e.target.files[0])} />
      <button onClick={() => fileRef.current?.click()} className="btn" title="Planilha com as colunas Fundo, CNPJ, Categoria, Situação, Atividade e Data"><Upload size={14} /> Importar planilha</button>
      <button onClick={exportar} className="btn"><Download size={14} /> Exportar</button>
      <button onClick={() => setAberto('novo')} className="btn btn-primary"><Plus size={14} /> Novo fundo</button>
    </>
  )
  const liveMeta = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-[var(--tx3)]">
      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border ${live === 'ok' ? 'border-id-mid/40 text-id-dark dark:text-id-light bg-id-mid/10' : 'border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/10'}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${live === 'ok' ? 'bg-id-light' : 'bg-amber-500'}`} />
        {live === 'ok' ? (saving ? 'Salvando…' : 'Ao vivo') : live === 'offline' ? 'Sem conexão — exibindo cópia local' : 'Conectando…'}
      </span>
      {data?.updatedAt && <span>Última alteração {data.updatedBy ? `por ${data.updatedBy} ` : ''}em {new Date(data.updatedAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>}
    </div>
  )

  if (!loaded) {
    return (
      <div>
        <PageHeader eyebrow="Operacional" title="Transfer / Closed" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-3">{[0, 1, 2].map((i) => <Card key={i} className="h-[150px] animate-pulse" />)}</div>
        <Card className="h-[320px] animate-pulse" />
      </div>
    )
  }

  const procAberto = aberto === 'novo' ? null : processos.find((p) => p.id === aberto)

  return (
    <div>
      <PageHeader eyebrow="Operacional" title="Transfer / Closed" description="Fundos que saem da casa (transferência) ou encerram" meta={liveMeta} actions={header} />

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 mb-3">
        <StatCard icon={Landmark} tone="green" label="Saldo da conta" value={<AnimatedNumber value={saldoConta} format={fmtFull} />}
          details={[
            ['Conta', CONTA_NOME],
            ['Extrato informado', informado != null ? fmtFull(informado) : '— clique para informar'],
            ...(diferenca != null ? [['Diferença', fmtFull(diferenca), Math.abs(diferenca) > 0.005 ? 'text-red-500' : 'text-id-dark dark:text-id-light']] : []),
          ]}
          onClick={() => setEditSaldo(true)} hint="Soma do saldo dos fundos em andamento. Clique para informar o saldo do extrato e conferir." />
        <StatCard icon={Lock} tone="amber" label="Saldo retido a pagar" value={<AnimatedNumber value={retPend} format={fmtFull} />}
          share={retPend + retPago > 0 ? (retPend / (retPend + retPago)) * 100 : null}
          details={[['Já pago', fmtFull(retPago)], ['Fundos com retenção', String(ativos.filter((x) => x.r.pendente > 0).length)]]} />
        <StatCard icon={Wallet} tone="green" label="Saldo liberável" value={<AnimatedNumber value={liberavel} format={fmtFull} />}
          details={[['Após pagar o retido', `${ativos.length} fundo(s)`], ...(insuf ? [['Saldo insuficiente', `${insuf} fundo(s)`, 'text-red-500']] : [])]} />
        <StatCard icon={AlertTriangle} tone={atrasados ? 'red' : 'neutral'} label="Em andamento" value={String(ativos.length)}
          details={[['Atrasados', String(atrasados), atrasados ? 'text-red-500' : ''], ['Concluídos', String(porEtapa.concluido)]]}
          onClick={() => setFEtapa('ativos')} />
      </div>

      {/* esteira de etapas */}
      <Card className="p-3 mb-3">
        <div className="flex flex-wrap items-stretch gap-1.5">
          {[['ativos', 'Em andamento', ativos.length], ...ETAPAS.map((e) => [e.id, e.label, porEtapa[e.id]]), ['cancelado', 'Cancelado', porEtapa.cancelado], ['todos', 'Todos', processos.length]].map(([id, label, n], i) => (
            <button key={id} onClick={() => setFEtapa(id)} title={ETAPA[id]?.desc}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-[12px] transition-colors ${fEtapa === id ? 'border-id-mid/60 bg-id-mid/10 text-[var(--tx)]' : 'border-[var(--bdr)] text-[var(--tx2)] hover:bg-[var(--sur2)]'}`}>
              {ETAPA[id] && i > 0 && <span className={`w-2 h-2 rounded-full border ${ETAPA_TONE[id]}`} />}
              <span>{label}</span>
              <span className="font-mono text-[11px] text-[var(--tx3)]">{n}</span>
            </button>
          ))}
          <div className="flex-1" />
          <select value={fTipo} onChange={(e) => setFTipo(e.target.value)} className="field !w-auto !py-1.5 text-[12px]">
            <option value="">Transferência e encerramento</option>
            <option value="TRANSFER">Só transferências</option>
            <option value="ENCERRAMENTO">Só encerramentos</option>
          </select>
          {!onSearch && <input value={qLocal} onChange={(e) => setQLocal(e.target.value)} placeholder="Buscar fundo ou CNPJ…" className="field !w-[220px] !py-1.5 text-[12px]" />}
        </div>
      </Card>

      <div className="grid grid-cols-1 2xl:grid-cols-[1fr_320px] gap-3">
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[10.5px] uppercase tracking-wider text-[var(--tx3)] border-b border-[var(--bdr)]">
                  <th className="px-4 py-2.5 font-medium min-w-[220px]">Fundo</th>
                                    <th className="px-3 py-2.5 font-medium">Atividade</th>
                  <th className="px-3 py-2.5 font-medium">Situação</th>
                  <th className="px-3 py-2.5 font-medium">Previsão</th>
                  <th className="px-3 py-2.5 font-medium text-right">Saldo na conta</th>
                  <th className="px-3 py-2.5 font-medium text-right">Retido a pagar</th>
                  <th className="px-3 py-2.5 font-medium text-right">Liberável</th>
                  <th className="px-3 py-2.5 font-medium">Checklist</th>
                </tr>
              </thead>
              <tbody>
                {lista.map(({ p, r }) => (
                  <tr key={p.id} onClick={() => setAberto(p.id)} className="border-b border-[var(--bdr)]/60 hover:bg-[var(--sur2)]/60 text-[12.5px] cursor-pointer">
                    <td className="px-4 py-2.5 max-w-[300px]">
                      <div className="font-medium truncate" title={p.fundo}>{p.fundo || '—'}</div>
                      <div className="text-[11px] text-[var(--tx3)] truncate"><span className="font-mono">{p.cnpj || 'sem CNPJ'}</span>{p.categoria ? ` · ${p.categoria}` : ''}{p.responsavel ? ` · ${p.responsavel}` : ''}</div>
                    </td>
                                        <td className="px-3 py-2.5"><TipoBadge tipo={p.tipo} /></td>
                    <td className="px-3 py-2.5"><EtapaBadge id={p.status} /></td>
                    <td className={`px-3 py-2.5 whitespace-nowrap ${r.atrasado ? 'text-red-500 font-medium' : 'text-[var(--tx2)]'}`}>
                      {p.status === 'concluido' ? <span className="text-[var(--tx3)]">{brDate(p.dataConclusao) || '—'}</span> : brDate(p.dataPrevista) || '—'}
                      {r.atrasado && <span className="ml-1 text-[10px]">atrasado</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">{fmtFull(r.saldo)}</td>
                    <td className={`px-3 py-2.5 text-right tabular-nums whitespace-nowrap ${r.pendente > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-[var(--tx3)]'}`}>{fmtFull(r.pendente)}</td>
                    <td className={`px-3 py-2.5 text-right tabular-nums whitespace-nowrap ${r.liberavel < 0 ? 'text-red-500' : ''}`}>{fmtFull(r.liberavel)}</td>
                    <td className="px-3 py-2.5 min-w-[110px]">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 rounded-full bg-[var(--sur2)] overflow-hidden"><div className="h-full rounded-full bg-id-light transition-[width] duration-500" style={{ width: r.progresso * 100 + '%' }} /></div>
                        <span className="text-[10.5px] font-mono text-[var(--tx3)]">{r.feitos}/{r.totalCheck}</span>
                      </div>
                    </td>
                  </tr>
                ))}
                {!lista.length && (
                  <tr><td colSpan={8} className="text-center py-12 text-[12.5px] text-[var(--tx3)]">
                    {processos.length ? 'Nenhum fundo para esse filtro.' : <>Nenhum fundo em transferência ou encerramento ainda.<br /><button onClick={() => setAberto('novo')} className="btn btn-primary btn-sm mt-3"><Plus size={13} /> Incluir o primeiro</button></>}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2.5 text-[11px] text-[var(--tx3)] border-t border-[var(--bdr)]">{lista.length} de {processos.length} fundos</div>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-3 2xl:grid-cols-1 gap-3 content-start">
          <RankCard title="Fundos na conta" tone="green"
            items={ativos.filter((x) => x.r.saldo > 0).map((x) => ({ name: x.p.fundo, value: x.r.saldo, id: x.p.id })).sort((a, b) => b.value - a.value)}
            empty="Nenhum saldo informado nos fundos em andamento."
            onPick={(name) => { const x = ativos.find((y) => y.p.fundo === name); if (x) setAberto(x.p.id) }} />
          <RankCard title="Maior saldo retido a pagar" tone="amber"
            items={ativos.filter((x) => x.r.pendente > 0).map((x) => ({ name: x.p.fundo, value: x.r.pendente })).sort((a, b) => b.value - a.value).slice(0, 6)}
            empty="Nada retido a pagar."
            onPick={(name) => { const x = ativos.find((y) => y.p.fundo === name); if (x) setAberto(x.p.id) }} />
          <div className="grid grid-cols-1 gap-3">
            <MiniStat icon={ArrowRightLeft} label="Transferências" value={String(ativos.filter((x) => x.p.tipo === 'TRANSFER').length)} onClick={() => setFTipo((t) => (t === 'TRANSFER' ? '' : 'TRANSFER'))} />
            <MiniStat icon={Archive} label="Encerramentos" value={String(ativos.filter((x) => x.p.tipo === 'ENCERRAMENTO').length)} onClick={() => setFTipo((t) => (t === 'ENCERRAMENTO' ? '' : 'ENCERRAMENTO'))} />
          </div>
        </div>
      </div>

      {aberto && (
        <ProcessoDrawer key={aberto} proc={procAberto} who={who} toast={toast} existentes={processos}
          onClose={() => setAberto(null)}
          onSave={(p) => { salvarProcesso(p); setAberto(null) }}
          onDelete={procAberto ? () => { excluirProcesso(procAberto); setAberto(null) } : null} />
      )}
      {editSaldo && <SaldoContaModal atual={informado} soma={saldoConta} onClose={() => setEditSaldo(false)} onSave={salvarSaldoConta} />}
    </div>
  )
}

function SaldoContaModal({ atual, soma, onClose, onSave }) {
  const [v, setV] = useState(fmtInput(atual))
  return (
    <Overlay onClose={onClose}>
      <Card className="relative w-full max-w-[400px] p-5 animate-fade-up">
        <div className="font-display font-semibold text-[15px] mb-1">Saldo da conta</div>
        <div className="text-[12px] text-[var(--tx3)] mb-3">{CONTA_NOME} — informe o saldo do extrato para conferir com a soma dos fundos ({fmtFull(soma)}).</div>
        <div className="label">Saldo no extrato (R$)</div>
        <input autoFocus value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onSave(parseValor(v))} inputMode="decimal" className="field text-right font-mono" />
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="btn btn-sm">Cancelar</button>
          <button onClick={() => onSave(parseValor(v))} className="btn btn-sm btn-primary">Salvar</button>
        </div>
      </Card>
    </Overlay>
  )
}

function ProcessoDrawer({ proc, who, toast, existentes, onClose, onSave, onDelete }) {
  const isNew = !proc
  const [f, setF] = useState(() => (proc ? JSON.parse(JSON.stringify(proc)) : novoProcesso({ responsavel: who }, who)))
  const [aba, setAba] = useState('geral')
  const [buscando, setBuscando] = useState(false)
  const [comentario, setComentario] = useState('')
  const [err, setErr] = useState('')
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))
  const r = resumo(f)
  const prox = proximaEtapa(f.status)

  // nome e categoria pelo CNPJ (base da Taxa ADM)
  async function completarPorCnpj() {
    if (onlyDigits(f.cnpj).length < 14 || (f.fundo && f.categoria)) return
    try {
      const achou = fundoPorCnpj(await carregarBases(), f.cnpj)
      if (achou) setF((s) => ({ ...s, fundo: s.fundo || achou.fundo, categoria: s.categoria || achou.categoria }))
    } catch (e) { console.warn('bases err', e) }
  }
  async function puxarPendencias() {
    if (!onlyDigits(f.cnpj)) { toast.error('Informe o CNPJ do fundo para buscar as pendências.'); return }
    setBuscando(true)
    try {
      const sugest = pendenciasDoSistema(await carregarBases(), f.cnpj)
      if (!sugest.length) { toast.success('Nenhuma pendência de Taxa ADM ou ANBIMA para esse CNPJ.'); return }
      setF((s) => {
        const ret = [...(s.retencoes || [])]
        sugest.forEach((x) => {
          const i = ret.findIndex((y) => y.origem === x.origem && y.status !== 'PAGO')
          if (i >= 0) ret[i] = { ...ret[i], valor: x.valor, obs: x.obs }
          else ret.push({ id: novoId(), status: 'PENDENTE', dataPagamento: '', ...x })
        })
        return { ...s, retencoes: ret }
      })
      toast.success(`Pendências trazidas: ${sugest.map((x) => `${x.item} ${fmtFull(x.valor)}`).join(' · ')}`)
    } catch (e) {
      toast.error('Não consegui ler as bases: ' + e.message)
    } finally { setBuscando(false) }
  }
  const setRet = (id, patch) => setF((s) => ({ ...s, retencoes: s.retencoes.map((x) => (x.id === id ? { ...x, ...patch } : x)) }))
  const addRet = (item = '') => setF((s) => ({ ...s, retencoes: [...(s.retencoes || []), { id: novoId(), item, valor: 0, status: 'PENDENTE', dataPagamento: '', obs: '' }] }))
  const delRet = (id) => setF((s) => ({ ...s, retencoes: s.retencoes.filter((x) => x.id !== id) }))
  const toggleCheck = (k) => setF((s) => {
    const cur = s.checklist?.[k]
    return { ...s, checklist: { ...(s.checklist || {}), [k]: cur?.feito ? { feito: false } : { feito: true, por: who, em: Date.now() } } }
  })

  function salvar(extra = {}) {
    const p = { ...f, ...extra }
    if (!p.fundo.trim()) { setErr('Informe o nome do fundo.'); setAba('geral'); return }
    const dup = existentes.find((x) => x.id !== p.id && onlyDigits(x.cnpj) && onlyDigits(x.cnpj) === onlyDigits(p.cnpj) && resumo(x).ativo)
    if (dup && resumo(p).ativo) { setErr(`Já existe um processo em andamento para esse CNPJ (${dup.fundo}).`); return }
    const now = Date.now()
    const hist = [...(p.historico || [])]
    if (proc) {
      if (proc.status !== p.status) hist.push({ ts: now, quem: who, texto: `Etapa: ${ETAPA[proc.status]?.label} → ${ETAPA[p.status]?.label}` })
      const antes = resumo(proc)
      const mud = []
      if (antes.saldo !== r.saldo) mud.push(`saldo na conta ${fmtFull(r.saldo)}`)
      if (antes.retido !== r.retido || antes.pago !== r.pago) mud.push(`retido ${fmtFull(r.retido)} (pago ${fmtFull(r.pago)})`)
      if (antes.feitos !== r.feitos) mud.push(`checklist ${r.feitos}/${r.totalCheck}`)
      if (mud.length) hist.push({ ts: now, quem: who, texto: 'Atualizado: ' + mud.join(', ') })
    }
    if (comentario.trim()) hist.push({ ts: now, quem: who, texto: comentario.trim(), comentario: true })
    if (p.status === 'concluido' && !p.dataConclusao) p.dataConclusao = todayISO()
    if (p.status !== 'concluido') p.dataConclusao = p.status === 'cancelado' ? p.dataConclusao : ''
    p.saldoConta = parseValor(p.saldoConta)
    p.retencoes = (p.retencoes || []).filter((x) => x.item || Number(x.valor)).map((x) => ({ ...x, valor: parseValor(x.valor), dataPagamento: x.status === 'PAGO' ? x.dataPagamento || todayISO() : '' }))
    onSave({ ...p, historico: hist, updatedAt: now, updatedBy: who })
  }

  const check = checklistDe(f.tipo)
  const tabs = [['geral', 'Dados'], ['retido', `Detalhamento do retido${r.pendente > 0 ? ` · ${fmtShort(r.pendente)}` : ''}`], ['checklist', `Checklist ${r.feitos}/${r.totalCheck}`], ['historico', 'Histórico']]

  return (
    <Overlay onClose={onClose} side>
      <div className="relative h-full w-full max-w-[680px] bg-[var(--sur)] border-l border-[var(--bdr)] shadow-[var(--shadow-pop)] flex flex-col animate-slide-in">
        <div className="px-5 pt-4 pb-3 border-b border-[var(--bdr)]">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="font-display font-semibold text-[15px] truncate">{isNew ? 'Novo fundo — Transfer / Closed' : f.fundo}</div>
              <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] text-[var(--tx3)]">
                {f.cnpj && <span className="font-mono">{f.cnpj}</span>}
                <TipoBadge tipo={f.tipo} /><EtapaBadge id={f.status} />
                {r.atrasado && <span className="text-red-500 font-medium">Atrasado (previsto {brDate(f.dataPrevista)})</span>}
              </div>
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--tx3)] hover:bg-[var(--sur2)]"><X size={16} /></button>
          </div>
          {/* etapas */}
          <div className="flex items-center gap-1 mt-3 overflow-x-auto pb-1">
            {ETAPAS.map((e, i) => {
              const atual = ETAPA[f.status]?.ordem ?? 0
              const done = f.status !== 'cancelado' && i < atual, on = f.status === e.id
              return (
                <button key={e.id} onClick={() => setF((s) => ({ ...s, status: e.id }))} title={e.desc}
                  className={`flex items-center gap-1 shrink-0 text-[10.5px] px-2 py-1 rounded-full border transition-colors ${on ? ETAPA_TONE[e.id] + ' font-semibold' : done ? 'border-id-mid/30 text-id-dark dark:text-id-light' : 'border-[var(--bdr)] text-[var(--tx3)] hover:bg-[var(--sur2)]'}`}>
                  {done ? <CheckCircle2 size={11} /> : <Circle size={11} />}{e.label}
                </button>
              )
            })}
            <button onClick={() => setF((s) => ({ ...s, status: s.status === 'cancelado' ? 'solicitado' : 'cancelado' }))} className={`shrink-0 text-[10.5px] px-2 py-1 rounded-full border ${f.status === 'cancelado' ? ETAPA_TONE.cancelado + ' font-semibold' : 'border-[var(--bdr)] text-[var(--tx4)] hover:bg-[var(--sur2)]'}`}>Cancelado</button>
          </div>
          <div className="flex gap-1 mt-2">
            {tabs.map(([id, l]) => <button key={id} onClick={() => setAba(id)} className={`text-[12px] px-3 py-1.5 rounded-lg ${aba === id ? 'bg-[var(--sur2)] text-[var(--tx)] font-medium' : 'text-[var(--tx3)] hover:text-[var(--tx2)]'}`}>{l}</button>)}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {aba === 'geral' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><div className="label">CNPJ</div><input value={f.cnpj} onChange={set('cnpj')} onBlur={completarPorCnpj} className="field font-mono" placeholder="00.000.000/0001-00" /></div>
                <div><div className="label">Categoria</div>
                  <input list="tc-cat" value={f.categoria} onChange={set('categoria')} className="field" />
                  <datalist id="tc-cat">{CATEGORIAS.map((c) => <option key={c} value={c} />)}</datalist>
                </div>
              </div>
              <div><div className="label">Fundo</div><input value={f.fundo} onChange={set('fundo')} className="field" placeholder="Razão social (preenche sozinho pelo CNPJ, se o fundo estiver na Taxa ADM)" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><div className="label">Atividade</div>
                  <div className="grid grid-cols-2 gap-1">
                    {Object.entries(TIPOS).map(([k, l]) => (
                      <button key={k} onClick={() => setF((s) => ({ ...s, tipo: k }))} className={`btn btn-sm justify-center ${f.tipo === k ? 'border-id-mid/60 bg-id-mid/10 text-[var(--tx)]' : ''}`}>{l}</button>
                    ))}
                  </div>
                </div>
                <div><div className="label">Responsável</div><input value={f.responsavel} onChange={set('responsavel')} className="field" /></div>
              </div>
              {f.tipo === 'TRANSFER' && <div><div className="label">Novo administrador (destino)</div><input value={f.destino} onChange={set('destino')} className="field" placeholder="Para quem o fundo vai" /></div>}
              <div className="grid grid-cols-3 gap-3">
                <div><div className="label">Data do pedido</div><input type="date" value={f.dataPedido} onChange={set('dataPedido')} className="field" /></div>
                <div><div className="label">Previsão de conclusão</div><input type="date" value={f.dataPrevista} onChange={set('dataPrevista')} className="field" /></div>
                <div><div className="label">Concluído em</div><input type="date" value={f.dataConclusao} onChange={set('dataConclusao')} disabled={f.status !== 'concluido' && f.status !== 'cancelado'} className="field disabled:opacity-50" /></div>
              </div>
              <div className="rounded-xl border border-[var(--bdr)] p-3">
                <div className="flex items-center gap-2 mb-2"><Landmark size={14} className="text-id-dark dark:text-id-light" /><span className="text-[12px] font-semibold">Saldo do fundo na conta</span><span className="text-[11px] text-[var(--tx3)]">{CONTA_NOME}</span></div>
                <input value={typeof f.saldoConta === 'number' ? fmtInput(f.saldoConta) : f.saldoConta} onChange={set('saldoConta')} onBlur={(e) => setF((s) => ({ ...s, saldoConta: parseValor(e.target.value) }))} inputMode="decimal" className="field text-right font-mono" placeholder="0,00" />
                <Resumo r={r} />
              </div>
              <div><div className="label">Observações</div><textarea value={f.obs} onChange={set('obs')} rows={3} className="field resize-none" /></div>
            </div>
          )}

          {aba === 'retido' && (
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <div className="text-[12px] text-[var(--tx3)] flex-1 min-w-[200px]">Valores que ficam retidos na conta até serem pagos. O que sobra é liberado ({f.tipo === 'TRANSFER' ? 'transferido ao novo administrador' : 'devolvido aos cotistas'}).</div>
                <button onClick={puxarPendencias} disabled={buscando} className="btn btn-sm" title="Soma o que está pendente para esse CNPJ na Taxa ADM e na Taxa Anbima">
                  {buscando ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Puxar pendências do sistema
                </button>
              </div>
              <div className="rounded-xl border border-[var(--bdr)] overflow-hidden">
                <table className="w-full text-[12px]">
                  <thead><tr className="text-[10px] uppercase tracking-wider text-[var(--tx3)] bg-[var(--sur2)]/60">
                    <th className="text-left px-3 py-2 font-medium">Item</th><th className="text-right px-2 py-2 font-medium">Valor (R$)</th><th className="px-2 py-2 font-medium">Status</th><th className="px-2 py-2 font-medium">Pago em</th><th />
                  </tr></thead>
                  <tbody>
                    {(f.retencoes || []).map((x) => (
                      <tr key={x.id} className="border-t border-[var(--bdr)]/60 align-top">
                        <td className="px-3 py-2">
                          <input list="tc-itens" value={x.item} onChange={(e) => setRet(x.id, { item: e.target.value })} className="field !py-1 text-[12px]" placeholder="Item" />
                          <input value={x.obs || ''} onChange={(e) => setRet(x.id, { obs: e.target.value })} className="field !py-1 text-[11px] mt-1 text-[var(--tx3)]" placeholder="Observação" />
                        </td>
                        <td className="px-2 py-2 w-[130px]"><input value={typeof x.valor === 'number' ? fmtInput(x.valor) : x.valor} onChange={(e) => setRet(x.id, { valor: e.target.value })} onBlur={(e) => setRet(x.id, { valor: parseValor(e.target.value) })} inputMode="decimal" className="field !py-1 text-right font-mono text-[12px]" /></td>
                        <td className="px-2 py-2 w-[100px]">
                          <button onClick={() => setRet(x.id, { status: x.status === 'PAGO' ? 'PENDENTE' : 'PAGO', dataPagamento: x.status === 'PAGO' ? '' : x.dataPagamento || todayISO() })}
                            className={`w-full text-[11px] font-semibold px-2 py-1 rounded-md border ${x.status === 'PAGO' ? 'border-id-mid/50 text-id-dark dark:text-id-light bg-id-mid/10' : 'border-amber-500/50 text-amber-600 dark:text-amber-400 bg-amber-500/10'}`}>
                            {x.status === 'PAGO' ? 'Pago' : 'Pendente'}
                          </button>
                        </td>
                        <td className="px-2 py-2 w-[130px]">{x.status === 'PAGO' && <input type="date" value={x.dataPagamento || ''} onChange={(e) => setRet(x.id, { dataPagamento: e.target.value })} className="field !py-1 text-[11.5px]" />}</td>
                        <td className="px-2 py-2 w-[36px]"><button onClick={() => delRet(x.id)} className="w-7 h-7 rounded-md flex items-center justify-center text-[var(--tx3)] hover:text-red-500 hover:bg-red-500/10" title="Remover"><Trash2 size={13} /></button></td>
                      </tr>
                    ))}
                    {!(f.retencoes || []).length && <tr><td colSpan={5} className="px-3 py-6 text-center text-[var(--tx3)]">Nenhum valor retido. Adicione os itens abaixo ou puxe as pendências do sistema.</td></tr>}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-[var(--bdr)] bg-[var(--sur2)]/40 font-semibold">
                      <td className="px-3 py-2">Total retido</td><td className="px-2 py-2 text-right tabular-nums">{fmtFull(r.retido)}</td><td colSpan={3} className="px-2 py-2 text-[11px] font-normal text-[var(--tx3)]">pago {fmtFull(r.pago)} · a pagar <span className="text-amber-600 dark:text-amber-400">{fmtFull(r.pendente)}</span></td>
                    </tr>
                  </tfoot>
                </table>
                <datalist id="tc-itens">{ITENS_RETENCAO.map((c) => <option key={c} value={c} />)}</datalist>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                <button onClick={() => addRet()} className="btn btn-sm"><Plus size={12} /> Adicionar item</button>
                {ITENS_RETENCAO.filter((it) => !(f.retencoes || []).some((x) => x.item === it)).slice(0, 7).map((it) => (
                  <button key={it} onClick={() => addRet(it)} className="text-[11px] px-2 py-1 rounded-full border border-dashed border-[var(--bdr)] text-[var(--tx3)] hover:text-[var(--tx)] hover:bg-[var(--sur2)]">+ {it}</button>
                ))}
              </div>
              <div className="rounded-xl border border-[var(--bdr)] p-3 mt-4"><Resumo r={r} /></div>
            </div>
          )}

          {aba === 'checklist' && (
            <div className="space-y-1.5">
              {check.map(([k, l]) => {
                const c = f.checklist?.[k]
                return (
                  <button key={k} onClick={() => toggleCheck(k)} className={`w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors ${c?.feito ? 'border-id-mid/40 bg-id-mid/5' : 'border-[var(--bdr)] hover:bg-[var(--sur2)]'}`}>
                    {c?.feito ? <CheckCircle2 size={17} className="text-id-dark dark:text-id-light shrink-0" /> : <Circle size={17} className="text-[var(--tx4)] shrink-0" />}
                    <span className={`flex-1 text-[12.5px] ${c?.feito ? 'text-[var(--tx2)]' : ''}`}>{l}</span>
                    {c?.feito && <span className="text-[10.5px] text-[var(--tx3)]">{c.por}{c.em ? ` · ${new Date(c.em).toLocaleDateString('pt-BR')}` : ''}</span>}
                  </button>
                )
              })}
              <div className="text-[11px] text-[var(--tx3)] pt-1">Os itens mudam conforme a atividade ({TIPOS[f.tipo]}).</div>
            </div>
          )}

          {aba === 'historico' && (
            <div>
              <div className="label">Novo comentário</div>
              <textarea value={comentario} onChange={(e) => setComentario(e.target.value)} rows={2} className="field resize-none mb-3" placeholder="Fica registrado com seu nome ao salvar" />
              <div className="space-y-2">
                {[...(f.historico || [])].reverse().map((h, i) => (
                  <div key={i} className="flex gap-2.5 text-[12px]">
                    <Clock size={13} className="text-[var(--tx4)] mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <div className={h.comentario ? 'text-[var(--tx)]' : 'text-[var(--tx2)]'}>{h.texto}</div>
                      <div className="text-[10.5px] text-[var(--tx3)]">{h.quem || '—'} · {new Date(h.ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {err && <p className="text-[12px] text-red-500 mt-3">{err}</p>}
        </div>

        <div className="px-5 py-3 border-t border-[var(--bdr)] flex items-center gap-2">
          {onDelete && <button onClick={() => { if (confirm(`Excluir o processo de ${proc.fundo}? Isso apaga retenções, checklist e histórico.`)) onDelete() }} className="btn btn-sm btn-danger">Excluir</button>}
          <div className="flex-1" />
          <button onClick={onClose} className="btn btn-sm">Cancelar</button>
          {prox && f.status !== 'cancelado' && <button onClick={() => salvar({ status: prox.id })} className="btn btn-sm" title="Salva e passa para a próxima etapa">Salvar e avançar <ChevronRight size={13} /> {prox.label}</button>}
          <button onClick={() => salvar()} className="btn btn-sm btn-primary">Salvar</button>
        </div>
      </div>
    </Overlay>
  )
}

function Resumo({ r }) {
  return (
    <div className="grid grid-cols-3 gap-3 mt-3 text-[11px]">
      <div><div className="text-[var(--tx3)] uppercase tracking-wider text-[10px]">Saldo na conta</div><div className="font-semibold tabular-nums text-[13px]">{fmtFull(r.saldo)}</div></div>
      <div><div className="text-[var(--tx3)] uppercase tracking-wider text-[10px]">Retido a pagar</div><div className="font-semibold tabular-nums text-[13px] text-amber-600 dark:text-amber-400">{fmtFull(r.pendente)}</div></div>
      <div><div className="text-[var(--tx3)] uppercase tracking-wider text-[10px]">Liberável</div><div className={`font-semibold tabular-nums text-[13px] ${r.liberavel < 0 ? 'text-red-500' : 'text-id-dark dark:text-id-light'}`}>{fmtFull(r.liberavel)}</div></div>
      {r.insuficiente && <div className="col-span-3 text-red-500 flex items-center gap-1.5"><AlertTriangle size={12} /> O saldo na conta não cobre o que ainda está retido a pagar.</div>}
    </div>
  )
}
