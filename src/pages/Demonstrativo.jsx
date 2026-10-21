// Demonstrativo de Caixa: preenche cabeçalho e lançamentos, confere o saldo na
// hora e gera o PDF com a identidade da ID. Os demonstrativos salvos ficam em
// controle/demonstrativos para a equipe reabrir, duplicar ou ajustar.
import { useEffect, useMemo, useState } from 'react'
import { doc, onSnapshot, runTransaction } from 'firebase/firestore'
import { FileDown, Plus, Trash2, ArrowUp, ArrowDown, ClipboardPaste, Save, FilePlus2, Copy, FolderOpen, ArrowDownWideNarrow, X } from 'lucide-react'
import { db } from '../lib/firebase'
import { PageHeader, Card } from '../components/PageShell'
import { useToast } from '../components/Toast'
import { useOptionalAuth } from '../context/AuthContext'
import { Overlay } from '../components/taxa/Cards'
import { calcular, gerarPDF, parseColado, parseValor, fmt, br, novoId } from '../lib/demonstrativo'
import { todayISO } from '../lib/taxaCore'

const DOC_REF = () => doc(db, 'controle', 'demonstrativos')
const RASCUNHO = 'demonstrativo_rascunho'
const MODELOS = [
  ['S', 'Aplicação no Fundo '],
  ['E', 'Resgate do Fundo '],
  ['S', 'TARIFA DE TED - REF.'],
  ['E', 'TED recebida - '],
  ['S', 'Pagamento de '],
]

const vazio = () => ({
  id: null, cliente: '', cnpj: '', conta: 'Caixa ADM', agenciaConta: '',
  periodoInicio: todayISO(), periodoFim: todayISO(), dataSaldoAnterior: '', saldoAnterior: '',
  lancamentos: [], observacoes: '',
})
const fmtIn = (v) => (v === '' || v == null ? '' : typeof v === 'number' ? fmt(v) : v)

export default function Demonstrativo() {
  const toast = useToast()
  const currentUser = useOptionalAuth()?.currentUser
  const who = currentUser?.name || currentUser?.username || ''
  const [d, setD] = useState(() => { try { return { ...vazio(), ...JSON.parse(localStorage.getItem(RASCUNHO) || 'null') } } catch { return vazio() } })
  const [salvos, setSalvos] = useState([])
  const [colando, setColando] = useState(false)
  const [abrindo, setAbrindo] = useState(false)
  const [gerando, setGerando] = useState(false)

  useEffect(() => { try { localStorage.setItem(RASCUNHO, JSON.stringify(d)) } catch { /* sem storage */ } }, [d])
  useEffect(() => onSnapshot(DOC_REF(), (s) => setSalvos(s.exists() ? s.data().itens || [] : []), (e) => console.warn('demLoad err', e)), [])

  const set = (k) => (e) => setD((s) => ({ ...s, [k]: e.target.value }))
  const setL = (id, patch) => setD((s) => ({ ...s, lancamentos: s.lancamentos.map((l) => (l.id === id ? { ...l, ...patch } : l)) }))
  const addL = (tipo = 'S', historico = '') => setD((s) => ({ ...s, lancamentos: [...s.lancamentos, { id: novoId(), data: s.periodoFim || todayISO(), historico, tipo, valor: '' }] }))
  const delL = (id) => setD((s) => ({ ...s, lancamentos: s.lancamentos.filter((l) => l.id !== id) }))
  const mover = (i, dir) => setD((s) => {
    const l = [...s.lancamentos], j = i + dir
    if (j < 0 || j >= l.length) return s
    ;[l[i], l[j]] = [l[j], l[i]]
    return { ...s, lancamentos: l }
  })
  const ordenar = () => setD((s) => ({ ...s, lancamentos: [...s.lancamentos].sort((a, b) => String(a.data).localeCompare(String(b.data))) }))

  const calc = useMemo(() => calcular(d), [d])
  const erros = [
    !d.cliente.trim() && 'Informe o cliente.',
    !d.periodoInicio && 'Informe o período.',
    d.periodoFim && d.periodoInicio && d.periodoFim < d.periodoInicio && 'O fim do período é antes do início.',
    !calc.linhas.length && 'Inclua pelo menos um lançamento.',
    calc.linhas.some((l) => !l.v) && 'Há lançamento sem valor.',
    calc.linhas.some((l) => l.data && ((d.periodoInicio && l.data < d.periodoInicio) || (d.periodoFim && l.data > d.periodoFim))) && 'Há lançamento com data fora do período.',
  ].filter(Boolean)

  async function pdf() {
    const bloqueio = erros.filter((e) => !/fora do período/.test(e))
    if (bloqueio.length) { toast.error(bloqueio[0]); return }
    setGerando(true)
    try {
      await gerarPDF({ ...d, emissao: Date.now(), geradoPor: who })
      toast.success('PDF gerado.')
    } catch (e) { console.error(e); toast.error('Não consegui gerar o PDF: ' + e.message) } finally { setGerando(false) }
  }

  async function salvar(copia = false) {
    if (!d.cliente.trim()) { toast.error('Informe o cliente antes de salvar.'); return }
    const item = {
      ...d, id: copia || !d.id ? 'dm' + Date.now().toString(36) : d.id,
      saldoAnterior: parseValor(d.saldoAnterior),
      lancamentos: d.lancamentos.map((l) => ({ ...l, valor: parseValor(l.valor) })),
      saldoFinal: calc.saldoFinal, updatedAt: Date.now(), updatedBy: who,
    }
    try {
      await runTransaction(db, async (tx) => {
        const s = await tx.get(DOC_REF())
        const itens = (s.exists() ? s.data().itens || [] : []).filter((x) => x.id !== item.id)
        tx.set(DOC_REF(), { itens: [item, ...itens].slice(0, 300), updatedAt: Date.now(), updatedBy: who })
      })
      setD(item)
      toast.success(copia ? 'Cópia salva.' : 'Demonstrativo salvo.')
    } catch (e) { toast.error('Não foi possível salvar: ' + e.message) }
  }
  async function excluir(id) {
    try {
      await runTransaction(db, async (tx) => {
        const s = await tx.get(DOC_REF())
        tx.set(DOC_REF(), { itens: (s.exists() ? s.data().itens || [] : []).filter((x) => x.id !== id), updatedAt: Date.now(), updatedBy: who })
      })
      if (d.id === id) setD((s) => ({ ...s, id: null }))
      toast.success('Demonstrativo excluído.')
    } catch (e) { toast.error('Não foi possível excluir: ' + e.message) }
  }
  function novo() {
    if (calc.linhas.length && !confirm('Começar um demonstrativo novo? O que está na tela será descartado (salve antes, se precisar).')) return
    setD(vazio())
  }

  return (
    <div>
      <PageHeader
        eyebrow="Operacional"
        title="Demonstrativo de Caixa"
        description="Preencha os dados e os lançamentos e gere o PDF"
        actions={
          <>
            <button onClick={() => setAbrindo(true)} className="btn"><FolderOpen size={14} /> Salvos{salvos.length ? ` (${salvos.length})` : ''}</button>
            <button onClick={novo} className="btn"><FilePlus2 size={14} /> Novo</button>
            <button onClick={() => salvar(false)} className="btn"><Save size={14} /> Salvar</button>
            <button onClick={pdf} disabled={gerando} className="btn btn-primary"><FileDown size={14} /> {gerando ? 'Gerando…' : 'Gerar PDF'}</button>
          </>
        }
      />

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-3">
        <div className="space-y-3 min-w-0">
          <Card className="p-4">
            <div className="text-[12.5px] font-semibold mb-3">Dados do demonstrativo {d.id && <span className="text-[11px] font-normal text-[var(--tx3)]">· salvo{d.updatedBy ? ` por ${d.updatedBy}` : ''}</span>}</div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-2"><div className="label">Cliente (fundo)</div><input value={d.cliente} onChange={set('cliente')} className="field" placeholder="Ex.: BELLENZIER FIDC" /></div>
              <div><div className="label">CNPJ</div><input value={d.cnpj} onChange={set('cnpj')} className="field font-mono" placeholder="00.000.000/0001-00" /></div>
              <div><div className="label">Caixa / conta</div><input value={d.conta} onChange={set('conta')} className="field" placeholder="Caixa ADM" /></div>
              <div><div className="label">Agência / conta (opcional)</div><input value={d.agenciaConta} onChange={set('agenciaConta')} className="field" placeholder="Ag. 0001 · CC 45330-8" /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><div className="label">Período de</div><input type="date" value={d.periodoInicio} onChange={set('periodoInicio')} className="field" /></div>
                <div><div className="label">até</div><input type="date" value={d.periodoFim} onChange={set('periodoFim')} className="field" /></div>
              </div>
              <div><div className="label">Data do saldo anterior</div><input type="date" value={d.dataSaldoAnterior} onChange={set('dataSaldoAnterior')} className="field" /></div>
              <div><div className="label">Saldo anterior (R$)</div>
                <input value={fmtIn(d.saldoAnterior)} onChange={set('saldoAnterior')} onBlur={(e) => setD((s) => ({ ...s, saldoAnterior: e.target.value === '' ? '' : parseValor(e.target.value) }))} inputMode="decimal" className="field text-right font-mono" placeholder="0,00" />
              </div>
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="px-4 pt-4 pb-2 flex flex-wrap items-center gap-2">
              <div className="text-[12.5px] font-semibold flex-1">Lançamentos <span className="text-[11px] font-normal text-[var(--tx3)]">{calc.linhas.length}</span></div>
              <button onClick={() => setColando(true)} className="btn btn-sm" title="Cole linhas copiadas do Excel ou do extrato"><ClipboardPaste size={13} /> Colar do Excel</button>
              <button onClick={ordenar} className="btn btn-sm" title="Ordena por data de liquidação"><ArrowDownWideNarrow size={13} /> Ordenar por data</button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-[var(--tx3)] border-y border-[var(--bdr)] bg-[var(--sur2)]/40">
                    <th className="text-left px-3 py-2 font-medium w-[140px]">Data liquidação</th>
                    <th className="text-left px-2 py-2 font-medium">Histórico</th>
                    <th className="px-2 py-2 font-medium w-[150px]">Tipo</th>
                    <th className="text-right px-2 py-2 font-medium w-[140px]">Valor (R$)</th>
                    <th className="text-right px-2 py-2 font-medium w-[120px]">Saldo</th>
                    <th className="w-[84px]" />
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-[var(--bdr)]/60 text-[var(--tx3)]">
                    <td className="px-3 py-2">{br(d.dataSaldoAnterior) || '—'}</td>
                    <td className="px-2 py-2 font-medium text-[var(--tx2)]">Saldo anterior</td>
                    <td /><td />
                    <td className="px-2 py-2 text-right tabular-nums font-semibold text-[var(--tx)]">{fmt(calc.saldoInicial)}</td>
                    <td />
                  </tr>
                  {calc.linhas.map((l, i) => {
                    const fora = l.data && ((d.periodoInicio && l.data < d.periodoInicio) || (d.periodoFim && l.data > d.periodoFim))
                    return (
                      <tr key={l.id} className="border-b border-[var(--bdr)]/60">
                        <td className="px-3 py-1.5"><input type="date" value={l.data} onChange={(e) => setL(l.id, { data: e.target.value })} className={`field !py-1 text-[12px] ${fora ? '!border-amber-500/70' : ''}`} title={fora ? 'Fora do período' : ''} /></td>
                        <td className="px-2 py-1.5"><input value={l.historico} onChange={(e) => setL(l.id, { historico: e.target.value })} className="field !py-1 text-[12px]" placeholder="Ex.: Aplicação no Fundo GV CASH RF DI LP FI" /></td>
                        <td className="px-2 py-1.5">
                          <div className="grid grid-cols-2 gap-1">
                            {[['E', 'Entrada'], ['S', 'Saída']].map(([k, lab]) => (
                              <button key={k} onClick={() => setL(l.id, { tipo: k })} className={`text-[11px] font-semibold py-1 rounded-md border ${l.tipo === k ? (k === 'E' ? 'border-id-mid/60 text-id-dark dark:text-id-light bg-id-mid/10' : 'border-red-500/50 text-red-600 dark:text-red-400 bg-red-500/10') : 'border-[var(--bdr)] text-[var(--tx3)]'}`}>{lab}</button>
                            ))}
                          </div>
                        </td>
                        <td className="px-2 py-1.5"><input value={fmtIn(l.valor)} onChange={(e) => setL(l.id, { valor: e.target.value })} onBlur={(e) => setL(l.id, { valor: e.target.value === '' ? '' : parseValor(e.target.value) })} inputMode="decimal" className={`field !py-1 text-right font-mono text-[12px] ${l.tipo === 'E' ? 'text-id-dark dark:text-id-light' : 'text-red-600 dark:text-red-400'}`} placeholder="0,00" /></td>
                        <td className={`px-2 py-1.5 text-right tabular-nums ${l.saldo < 0 ? 'text-red-500' : 'text-[var(--tx2)]'}`}>{fmt(l.saldo)}</td>
                        <td className="px-1 py-1.5 whitespace-nowrap text-right">
                          <button onClick={() => mover(i, -1)} disabled={i === 0} className="w-6 h-6 inline-flex items-center justify-center rounded text-[var(--tx3)] hover:bg-[var(--sur2)] disabled:opacity-30"><ArrowUp size={12} /></button>
                          <button onClick={() => mover(i, 1)} disabled={i === calc.linhas.length - 1} className="w-6 h-6 inline-flex items-center justify-center rounded text-[var(--tx3)] hover:bg-[var(--sur2)] disabled:opacity-30"><ArrowDown size={12} /></button>
                          <button onClick={() => delL(l.id)} className="w-6 h-6 inline-flex items-center justify-center rounded text-[var(--tx3)] hover:text-red-500 hover:bg-red-500/10"><Trash2 size={12} /></button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-[var(--sur2)]/40 font-semibold">
                    <td className="px-3 py-2" /><td className="px-2 py-2">Saldo final</td>
                    <td className="px-2 py-2 text-[11px] font-normal text-[var(--tx3)] text-center">+{fmt(calc.entradas)} / −{fmt(calc.saidas)}</td>
                    <td />
                    <td className={`px-2 py-2 text-right tabular-nums ${calc.saldoFinal < 0 ? 'text-red-500' : 'text-id-dark dark:text-id-light'}`}>{fmt(calc.saldoFinal)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="px-4 py-3 flex flex-wrap gap-1.5 border-t border-[var(--bdr)]">
              <button onClick={() => addL('S')} className="btn btn-sm"><Plus size={12} /> Lançamento</button>
              {MODELOS.map(([t, h]) => (
                <button key={h} onClick={() => addL(t, h)} className="text-[11px] px-2 py-1 rounded-full border border-dashed border-[var(--bdr)] text-[var(--tx3)] hover:text-[var(--tx)] hover:bg-[var(--sur2)]">+ {h.trim()}</button>
              ))}
            </div>
          </Card>

          <Card className="p-4">
            <div className="label">Observações (saem no PDF)</div>
            <textarea value={d.observacoes} onChange={set('observacoes')} rows={3} className="field resize-none" placeholder="Opcional" />
          </Card>
        </div>

        <div className="space-y-3">
          <Card className="p-4">
            <div className="text-[12.5px] font-semibold mb-3">Resumo</div>
            {[
              ['Saldo anterior', calc.saldoInicial, ''],
              ['Entradas', calc.entradas, 'text-id-dark dark:text-id-light'],
              ['Saídas', -calc.saidas, 'text-red-600 dark:text-red-400'],
            ].map(([k, v, c]) => (
              <div key={k} className="flex items-center justify-between py-1.5 border-b border-[var(--bdr)]/60 text-[12.5px]">
                <span className="text-[var(--tx3)]">{k}</span><span className={`tabular-nums font-medium ${c}`}>{v < 0 ? '− ' : ''}R$ {fmt(Math.abs(v))}</span>
              </div>
            ))}
            <div className="flex items-center justify-between pt-3">
              <span className="text-[12px] font-semibold">Saldo final</span>
              <span className={`font-display text-[20px] font-semibold tabular-nums ${calc.saldoFinal < 0 ? 'text-red-500' : 'text-id-dark dark:text-id-light'}`}>R$ {fmt(calc.saldoFinal)}</span>
            </div>
            {erros.length > 0 && (
              <div className="mt-3 space-y-1">
                {erros.map((e) => <div key={e} className="text-[11.5px] text-amber-600 dark:text-amber-400">• {e}</div>)}
              </div>
            )}
            <button onClick={pdf} disabled={gerando} className="btn btn-primary w-full justify-center mt-4"><FileDown size={14} /> {gerando ? 'Gerando…' : 'Gerar PDF'}</button>
            {d.id && <button onClick={() => salvar(true)} className="btn btn-sm w-full justify-center mt-2"><Copy size={12} /> Salvar como cópia</button>}
          </Card>
          <Card className="p-4 text-[11.5px] text-[var(--tx3)] leading-relaxed">
            <div className="text-[12px] font-semibold text-[var(--tx2)] mb-1">Dica</div>
            Copie as linhas do extrato no Excel (data, histórico, entrada, saída) e use <b>Colar do Excel</b> — os lançamentos entram de uma vez. O rascunho fica guardado neste navegador até você salvar.
          </Card>
        </div>
      </div>

      {colando && <ColarModal dataPadrao={d.periodoFim} onClose={() => setColando(false)} onAdd={(ls) => { setD((s) => ({ ...s, lancamentos: [...s.lancamentos, ...ls] })); setColando(false); toast.success(`${ls.length} lançamento(s) incluído(s).`) }} />}
      {abrindo && (
        <Overlay onClose={() => setAbrindo(false)}>
          <Card className="relative w-full max-w-[640px] max-h-[80vh] flex flex-col animate-fade-up">
            <div className="px-5 py-4 border-b border-[var(--bdr)] flex items-center"><div className="font-display font-semibold text-[15px] flex-1">Demonstrativos salvos</div><button onClick={() => setAbrindo(false)} className="text-[var(--tx3)]"><X size={16} /></button></div>
            <div className="overflow-y-auto p-2">
              {!salvos.length && <div className="text-center text-[12.5px] text-[var(--tx3)] py-8">Nenhum demonstrativo salvo ainda.</div>}
              {salvos.map((s) => (
                <div key={s.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-[var(--sur2)]">
                  <div className="flex-1 min-w-0">
                    <div className="text-[12.5px] font-medium truncate">{s.cliente}</div>
                    <div className="text-[11px] text-[var(--tx3)]">{s.conta} · {br(s.periodoInicio)}{s.periodoFim !== s.periodoInicio ? ` a ${br(s.periodoFim)}` : ''} · {s.lancamentos?.length || 0} lanç. · saldo R$ {fmt(s.saldoFinal)}{s.updatedBy ? ` · ${s.updatedBy}` : ''}</div>
                  </div>
                  <button onClick={() => { setD({ ...vazio(), ...s }); setAbrindo(false) }} className="btn btn-sm">Abrir</button>
                  <button onClick={() => { if (confirm(`Excluir o demonstrativo de ${s.cliente}?`)) excluir(s.id) }} className="w-7 h-7 rounded-md flex items-center justify-center text-[var(--tx3)] hover:text-red-500 hover:bg-red-500/10"><Trash2 size={13} /></button>
                </div>
              ))}
            </div>
          </Card>
        </Overlay>
      )}
    </div>
  )
}

function ColarModal({ dataPadrao, onClose, onAdd }) {
  const [txt, setTxt] = useState('')
  const prev = useMemo(() => parseColado(txt, dataPadrao), [txt, dataPadrao])
  return (
    <Overlay onClose={onClose}>
      <Card className="relative w-full max-w-[680px] p-5 animate-fade-up">
        <div className="font-display font-semibold text-[15px] mb-1">Colar lançamentos</div>
        <div className="text-[12px] text-[var(--tx3)] mb-3">Uma linha por lançamento, como vem do Excel: <span className="font-mono">data · histórico · entrada · saída</span>. A linha de saldo anterior é ignorada.</div>
        <textarea autoFocus value={txt} onChange={(e) => setTxt(e.target.value)} rows={8} className="field font-mono text-[11.5px] resize-none" placeholder={'12/05/2025\tAplicação no Fundo BELLENZIER A VENCER\t\t149.914,46\n12/05/2025\tResgate do Fundo BELLENZIER A VENCER\t1.025.047,78'} />
        {prev.length > 0 && (
          <div className="mt-3 max-h-[180px] overflow-y-auto text-[11.5px] border border-[var(--bdr)] rounded-lg">
            {prev.map((l) => (
              <div key={l.id} className="flex gap-3 px-3 py-1.5 border-b border-[var(--bdr)]/50 last:border-0">
                <span className="text-[var(--tx3)] w-[74px] shrink-0">{br(l.data)}</span>
                <span className="flex-1 truncate">{l.historico}</span>
                <span className={`tabular-nums ${l.tipo === 'E' ? 'text-id-dark dark:text-id-light' : 'text-red-500'}`}>{l.tipo === 'E' ? '+' : '−'}{fmt(l.valor)}</span>
              </div>
            ))}
          </div>
        )}
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="btn btn-sm">Cancelar</button>
          <button onClick={() => onAdd(prev)} disabled={!prev.length} className="btn btn-sm btn-primary">Incluir {prev.length || ''} lançamento(s)</button>
        </div>
      </Card>
    </Overlay>
  )
}
