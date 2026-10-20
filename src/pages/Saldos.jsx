import { useEffect, useMemo, useRef, useState } from 'react'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { Upload, FileSpreadsheet, Download, X } from 'lucide-react'
import { db } from '../lib/firebase'
import { PageHeader, Card } from '../components/PageShell'
import { useToast } from '../components/Toast'
import { FUNDOS, IGNORAR, FORA, parseLiquidez, parseExtrato, calcular, migrar } from '../lib/saldos'

const DOC_REF = () => doc(db, 'controle', 'saldos_v2')

const sdFmt = (v) =>
  v === null || v === undefined ? '—' : 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const emptySD = () => ({ v: 3, cotistas: [], dataBase: null, extratos: {}, depara: {}, extras: {} })

const STATUS = {
  ok: ['✅ OK', 'bg-id-mid/15 text-id-light'],
  semsaldo: ['Sem saldo', 'bg-[var(--sur2)] text-[var(--tx3)]'],
  maior: ['⚠ Resgate a maior', 'bg-red-500/15 text-red-400'],
  incorreto: ['⚠ Fundo incorreto', 'bg-purple-500/15 text-purple-300'],
  regularizado: ['✅ Regularizado', 'bg-id-mid/15 text-id-light'],
  fora: ['⚠ Fora da liquidez', 'bg-amber-500/15 text-amber-300'],
  foraok: ['Fora da liquidez', 'bg-[var(--sur2)] text-[var(--tx2)]'],
}
const ALERTA = new Set(['maior', 'incorreto', 'fora'])

export default function Saldos() {
  const toast = useToast()
  const [SD, setSD] = useState(emptySD())
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filtro, setFiltro] = useState('todos')
  const [sort, setSort] = useState({ col: null, asc: true })
  const [bloqKey, setBloqKey] = useState(null)
  const [bloqVal, setBloqVal] = useState('')
  const [bloqDesc, setBloqDesc] = useState('')
  const [detKey, setDetKey] = useState(null)
  const liqInputRef = useRef(null)
  const extInputRef = useRef(null)

  useEffect(() => {
    let mounted = true
    getDoc(DOC_REF())
      .then((snap) => {
        if (!mounted) return
        if (snap.exists()) setSD({ ...emptySD(), ...migrar(snap.data()) })
      })
      .catch((e) => console.warn('sdLoad err', e))
      .finally(() => mounted && setLoading(false))
    return () => { mounted = false }
  }, [])

  function save(next) {
    setSD(next)
    setDoc(DOC_REF(), JSON.parse(JSON.stringify(next)), { merge: false }).catch((e) => {
      console.warn('sdSave err', e)
      toast.error('Não consegui salvar no servidor: ' + e.message)
    })
  }

  function importLiquidez(file) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const { cotistas, dataBase } = parseLiquidez(e.target.result)
        if (!cotistas.length) { toast.error('Nenhum cotista encontrado. Verifique o arquivo.'); return }
        // extratos de outro dia não valem para essa posição
        const extratos = Object.fromEntries(Object.entries(SD.extratos || {}).filter(([, x]) => dataBase && x.dataMov === dataBase))
        // bloqueios ficam; "regularizado" vale só para o dia
        const extras = Object.fromEntries(Object.entries(SD.extras || {}).filter(([, x]) => x.bloqueios?.length).map(([k, x]) => [k, { bloqueios: x.bloqueios }]))
        save({ ...SD, v: 3, cotistas, dataBase, liquidezArquivo: file.name, importadoEm: new Date().toLocaleString('pt-BR'), extratos, extras })
        toast.success(`Liquidez de ${dataBase || '?'} importada — ${cotistas.length} cotistas.`)
      } catch (err) {
        console.error(err)
        toast.error('Erro ao ler planilha: ' + err.message)
      }
    }
    reader.readAsArrayBuffer(file)
  }

  // Aceita os dois extratos (RF e Soberano) de uma vez; cada um vai para o seu fundo
  async function importExtratos(files) {
    if (!files.length) return
    try {
      const lidos = await Promise.all(files.map((f) => new Promise((res, rej) => {
        const reader = new FileReader()
        reader.onload = (e) => { try { res({ ...parseExtrato(e.target.result, f.name), arquivo: f.name }) } catch (err) { rej(new Error(`${f.name}: ${err.message}`)) } }
        reader.onerror = () => rej(new Error(`${f.name}: não consegui ler o arquivo`))
        reader.readAsText(f, 'iso-8859-1')
      })))
      const extratos = { ...SD.extratos }
      lidos.forEach((x) => { extratos[x.fundo] = x })
      const next = { ...SD, extratos }
      save(next)
      const vs = calcular(next).vinculos
      lidos.forEach((x) => {
        const nao = vs.filter((v) => v.fundo === x.fundo && v.como === 'nenhum').length
        const aviso = SD.dataBase && x.dataMov && x.dataMov !== SD.dataBase ? ` Atenção: extrato de ${x.dataMov} e liquidez de ${SD.dataBase}.` : ''
        toast.success(`Extrato ${x.fundo} importado — ${x.movs.length} fundos movimentaram${nao ? `, ${nao} fora da liquidez` : ''}.${aviso}`)
      })
    } catch (err) {
      console.error(err)
      toast.error('Erro: ' + err.message)
    }
  }

  const { rows: todas, vinculos } = useMemo(() => calcular(SD), [SD])
  const byKey = useMemo(() => new Map(todas.map((r) => [r.key, r])), [todas])
  const nomesCotistas = useMemo(() => SD.cotistas.map((c) => c.nome).sort((a, b) => a.localeCompare(b, 'pt-BR')), [SD.cotistas])

  function setExtra(key, patch) {
    const cur = SD.extras?.[key] || {}
    save({ ...SD, extras: { ...SD.extras, [key]: { ...cur, ...patch } } })
  }
  function setVinculo(nomeExt, valor) {
    const depara = { ...SD.depara }
    if (!valor) delete depara[nomeExt]; else depara[nomeExt] = valor
    save({ ...SD, depara })
    toast.success('Vínculo salvo — vale também para os próximos extratos.')
  }

  function addBloqueio() {
    const r = byKey.get(bloqKey)
    if (!r) return
    const v = parseFloat(String(bloqVal).replace(/\./g, '').replace(',', '.')) || 0
    if (!v) { toast.error('Digite um valor.'); return }
    setExtra(r.key, { bloqueios: [...r.bloqueios, { valor: v, desc: bloqDesc.trim(), data: new Date().toLocaleDateString('pt-BR') }] })
    setBloqVal(''); setBloqDesc('')
    toast.success('Saldo bloqueado registrado!')
  }
  function removeBloqueio(i) {
    const r = byKey.get(bloqKey)
    if (r) setExtra(r.key, { bloqueios: r.bloqueios.filter((_, j) => j !== i) })
  }

  function exportCSV() {
    if (!todas.length) { toast.error('Nenhum dado para exportar.'); return }
    const h = 'Cotista;Fundo;Saldo Inicial;Resgates;Aplicações;Movimentação;Saldo Atualizado;Saldo Bloqueado;Status;Observação;Nomes no extrato'
    const fmt = (v) => Number(v || 0).toFixed(2).replace('.', ',')
    const lines = todas.map((r) => [r.nome, r.fundo, fmt(r.saldoInicial), fmt(r.debitos), fmt(r.creditos), fmt(r.mov), fmt(r.saldoAtualizado), fmt(r.bloqueado), STATUS[r.status][0].replace(/[⚠✅]\s?/g, ''), r.obs, r.movs.map((m) => m.nome).join(' | ')].join(';'))
    const csv = '﻿' + h + '\n' + lines.join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    a.download = 'saldos_' + new Date().toISOString().slice(0, 10) + '.csv'
    a.click()
    toast.success('CSV exportado!')
  }

  const rows = useMemo(() => {
    let list = [...todas]
    if (search) { const q = search.toLowerCase(); list = list.filter((r) => r.nome.toLowerCase().includes(q) || r.movs.some((m) => m.nome.toLowerCase().includes(q))) }
    if (filtro === 'rf') list = list.filter((r) => r.fundo === 'ID RF')
    if (filtro === 'sob') list = list.filter((r) => r.fundo === 'ID Soberano')
    if (filtro === 'mov') list = list.filter((r) => r.movs.length)
    if (filtro === 'alerta') list = list.filter((r) => ALERTA.has(r.status))
    if (filtro === 'fora') list = list.filter((r) => r.fora)
    if (filtro === 'incorreto') list = list.filter((r) => r.status === 'incorreto')
    if (filtro === 'semsaldo') list = list.filter((r) => r.status === 'semsaldo')
    if (sort.col) {
      list.sort((a, b) => {
        if (sort.col === 'nome' || sort.col === 'fundo') return sort.asc ? a[sort.col].localeCompare(b[sort.col], 'pt-BR') : b[sort.col].localeCompare(a[sort.col], 'pt-BR')
        return sort.asc ? a[sort.col] - b[sort.col] : b[sort.col] - a[sort.col]
      })
    } else {
      // alertas primeiro, depois quem movimentou
      const peso = (r) => (ALERTA.has(r.status) ? 0 : r.movs.length ? 1 : r.status === 'semsaldo' ? 3 : 2)
      list.sort((a, b) => peso(a) - peso(b))
    }
    return list
  }, [todas, search, filtro, sort])

  const soma = (f, k) => todas.filter((r) => r.fundo === f).reduce((a, r) => a + r[k], 0)
  const alertas = todas.filter((r) => ALERTA.has(r.status)).length
  const foraLiq = todas.filter((r) => r.status === 'fora').length
  const semSaldo = todas.filter((r) => r.status === 'semsaldo').length
  const temExtrato = (f) => !!SD.extratos?.[f]

  function toggleSort(col) {
    setSort((s) => (s.col === col ? { col, asc: !s.asc } : { col, asc: true }))
  }

  const bloq = bloqKey ? byKey.get(bloqKey) : null
  const det = detKey ? byKey.get(detKey) : null

  return (
    <div>
      <PageHeader
        eyebrow="Operacional"
        title="Saldos"
        actions={
          <>
            <input ref={liqInputRef} type="file" accept=".xls,.xlsx" className="hidden" onChange={(e) => { importLiquidez(e.target.files[0]); e.target.value = '' }} />
            <button onClick={() => liqInputRef.current?.click()} className="flex items-center gap-1.5 text-[12px] border border-[var(--bdr)] rounded-lg px-3 py-1.5 text-[var(--tx2)] hover:bg-[var(--sur2)]">
              <FileSpreadsheet size={13} /> Importar Liquidez
            </button>
            <input ref={extInputRef} type="file" accept=".csv" multiple className="hidden" onChange={(e) => { importExtratos([...e.target.files]); e.target.value = '' }} />
            <button onClick={() => extInputRef.current?.click()} className="flex items-center gap-1.5 text-[12px] border border-[var(--bdr)] rounded-lg px-3 py-1.5 text-[var(--tx2)] hover:bg-[var(--sur2)]">
              <Upload size={13} /> Importar Extrato
            </button>
            <button onClick={exportCSV} className="flex items-center gap-1.5 text-[12px] bg-id-dark hover:bg-id-mid rounded-lg px-3 py-1.5 font-medium">
              <Download size={13} /> Exportar CSV
            </button>
          </>
        }
      />
      <p className="text-[11px] text-[var(--tx3)] -mt-3 mb-4">
        Liquidez: {SD.dataBase || '—'}
        {FUNDOS.map((f) => (
          <span key={f}> · Extrato {f}: {SD.extratos?.[f] ? <span className={SD.dataBase && SD.extratos[f].dataMov !== SD.dataBase ? 'text-amber-400' : ''}>{SD.extratos[f].dataMov || '?'}</span> : 'não importado'}</span>
        ))}
      </p>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
        <Card className="p-3">
          <div className="text-[10px] uppercase text-[var(--tx3)]">ID RF · Inicial</div>
          <div className="font-display text-lg font-semibold text-sky-400">{sdFmt(soma('ID RF', 'saldoInicial'))}</div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] uppercase text-[var(--tx3)]">ID RF · Atualizado</div>
          <div className="font-display text-lg font-semibold text-id-light">{temExtrato('ID RF') ? sdFmt(soma('ID RF', 'saldoAtualizado')) : 'Aguardando extrato'}</div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] uppercase text-[var(--tx3)]">ID Soberano · Inicial</div>
          <div className="font-display text-lg font-semibold text-purple-400">{sdFmt(soma('ID Soberano', 'saldoInicial'))}</div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] uppercase text-[var(--tx3)]">ID Soberano · Atualizado</div>
          <div className="font-display text-lg font-semibold text-id-light">{temExtrato('ID Soberano') ? sdFmt(soma('ID Soberano', 'saldoAtualizado')) : 'Aguardando extrato'}</div>
        </Card>
        <Card className={`p-3 cursor-pointer ${alertas > 0 ? 'border-red-500/40' : ''}`} onClick={() => setFiltro((f) => (f === 'alerta' ? 'todos' : 'alerta'))}>
          <div className="text-[10px] uppercase text-[var(--tx3)]">Alertas</div>
          <div className={`font-display text-lg font-semibold ${alertas > 0 ? 'text-red-400' : 'text-id-light'}`}>{alertas > 0 ? `⚠ ${alertas}` : '✅ Todos OK'}</div>
        </Card>
        <Card className={`p-3 cursor-pointer ${foraLiq > 0 ? 'border-amber-500/40' : ''}`} onClick={() => setFiltro((f) => (f === 'fora' ? 'todos' : 'fora'))}>
          <div className="text-[10px] uppercase text-[var(--tx3)]">Fora da liquidez</div>
          <div className={`font-display text-lg font-semibold ${foraLiq > 0 ? 'text-amber-400' : 'text-[var(--tx3)]'}`}>{foraLiq > 0 ? `⚠ ${foraLiq}` : '—'}</div>
        </Card>
      </div>

      <Card>
        <div className="p-3 border-b border-[var(--bdr)] flex gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar cotista ou nome do extrato…"
            className="flex-1 bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-3 py-2 text-[12px] outline-none focus:border-id-mid placeholder:text-[var(--tx3)]"
          />
          <select value={filtro} onChange={(e) => setFiltro(e.target.value)} className="bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-2 text-[12px]">
            <option value="todos">Todos</option>
            <option value="rf">ID RF</option>
            <option value="sob">ID Soberano</option>
            <option value="mov">Com movimentação</option>
            <option value="alerta">Alertas</option>
            <option value="fora">Fora da liquidez</option>
            <option value="incorreto">Fundo incorreto</option>
            <option value="semsaldo">Sem saldo ({semSaldo})</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10.5px] uppercase tracking-wider text-[var(--tx3)] border-b border-[var(--bdr)]">
                {[['nome', 'Cotista'], ['fundo', 'Fundo'], ['saldoInicial', 'Saldo inicial'], ['mov', 'Movimentação'], ['saldoAtualizado', 'Saldo atualizado']].map(([col, label]) => (
                  <th key={col} className="px-3 py-2.5 font-medium cursor-pointer select-none" onClick={() => toggleSort(col)}>
                    {label}{sort.col === col ? (sort.asc ? ' ↑' : ' ↓') : ''}
                  </th>
                ))}
                <th className="px-3 py-2.5 font-medium">Bloqueado</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 font-medium">Obs.</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="text-center py-10 text-[var(--tx3)]">Carregando…</td></tr>
              ) : !rows.length ? (
                <tr><td colSpan={8} className="text-center py-10 text-[var(--tx3)]">{todas.length ? 'Nenhum resultado para o filtro.' : 'Nenhum cotista. Clique em Importar Liquidez para começar.'}</td></tr>
              ) : rows.map((r) => {
                const [label, cls] = STATUS[r.status]
                return (
                  <tr key={r.key} className="border-b border-[var(--bdr)]/60 hover:bg-[var(--sur2)]/60 text-[12.5px]">
                    <td className="px-3 py-2.5 font-medium max-w-[260px] truncate" title={r.nome}>{r.nome}</td>
                    <td className="px-3 py-2.5">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${r.fundo === 'ID RF' ? 'bg-sky-500/15 text-sky-300' : r.fundo === 'ID Soberano' ? 'bg-purple-500/15 text-purple-300' : 'bg-[var(--sur2)] text-[var(--tx3)]'}`}>{r.fundo}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{sdFmt(r.saldoInicial)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {r.movs.length ? (
                        <button onClick={() => setDetKey(r.key)} className={`underline decoration-dotted underline-offset-2 ${r.mov < 0 ? 'text-red-300' : 'text-id-light'}`} title="Ver lançamentos do extrato">
                          {r.mov > 0 ? '+' : ''}{sdFmt(r.mov)}
                        </button>
                      ) : <span className="text-[var(--tx4)]">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{sdFmt(r.saldoAtualizado)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums cursor-pointer text-id-light" onClick={() => r.fundo !== '—' && setBloqKey(r.key)}>
                      {r.bloqueios.length ? sdFmt(r.bloqueado) : r.fundo !== '—' ? <span className="text-[var(--tx3)] text-[11px]">+ Adicionar</span> : null}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="flex items-center gap-1.5 whitespace-nowrap">
                        <span className={`text-[10.5px] px-2 py-0.5 rounded-md ${cls}`}>{label}</span>
                        {r.status === 'incorreto' && (
                          <button onClick={() => setExtra(r.key, { regularizado: true })} className="text-[10px] border border-purple-400/40 text-purple-300 rounded-full px-2 py-0.5">Regularizar</button>
                        )}
                        {r.status === 'fora' && (
                          <button onClick={() => setDetKey(r.key)} className="text-[10px] border border-amber-400/40 text-amber-300 rounded-full px-2 py-0.5">Vincular</button>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-[11px] text-amber-400/90 max-w-[240px] truncate" title={r.obs}>{r.obs || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2.5 text-[11px] text-[var(--tx3)] border-t border-[var(--bdr)]">{rows.length} de {todas.length} linhas · {SD.cotistas.length} cotistas na liquidez · {vinculos.length} nomes nos extratos</div>
      </Card>

      {det && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setDetKey(null)}>
          <div className="bg-[var(--sur)] border border-[var(--bdr)] rounded-xl w-full max-w-[640px] max-h-[85vh] overflow-y-auto p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-3 gap-3">
              <div className="min-w-0">
                <div className="font-medium text-[13px]">{det.nome}</div>
                <div className="text-[11px] text-[var(--tx3)]">{det.fundo} · saldo inicial {sdFmt(det.saldoInicial)} · resgates {sdFmt(det.debitos)} · aplicações {sdFmt(det.creditos)}</div>
              </div>
              <button onClick={() => setDetKey(null)} className="text-[var(--tx3)] hover:text-white shrink-0"><X size={16} /></button>
            </div>
            {det.movs.map((m) => (
              <div key={m.nome} className="border border-[var(--bdr)] rounded-lg p-3 mb-2">
                <div className="text-[11px] text-[var(--tx3)] mb-1">Nome no extrato</div>
                <div className="text-[12px] font-medium mb-2">{m.nome}</div>
                <table className="w-full text-[11.5px] mb-2">
                  <tbody>
                    {m.detalhes.map((d, i) => (
                      <tr key={i} className="border-t border-[var(--bdr)]/50">
                        <td className="py-1 pr-2 text-[var(--tx3)]">{d.dt}</td>
                        <td className="py-1 pr-2 text-[var(--tx3)] truncate max-w-[260px]">{d.hist}</td>
                        <td className={`py-1 text-right tabular-nums ${d.dc === 'D' ? 'text-red-300' : 'text-id-light'}`}>{d.dc === 'D' ? '−' : '+'}{sdFmt(d.v)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <label className="text-[11px] text-[var(--tx3)] block mb-1">
                  Vínculo {m.como === 'manual' ? '(escolhido manualmente)' : m.como === 'auto' ? '(automático)' : ''}
                </label>
                <select
                  value={SD.depara?.[m.nome] || ''}
                  onChange={(e) => setVinculo(m.nome, e.target.value)}
                  className="w-full bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-2 py-1.5 text-[12px]"
                >
                  <option value="">Automático{m.como === 'auto' ? ` → ${det.nome}` : ' (não encontrado)'}</option>
                  <option value={FORA}>Não está na liquidez (manter separado)</option>
                  <option value={IGNORAR}>Ignorar (não é cotista)</option>
                  <optgroup label="Cotistas da liquidez">
                    {nomesCotistas.map((n) => <option key={n} value={n}>{n}</option>)}
                  </optgroup>
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {bloq && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setBloqKey(null)}>
          <div className="bg-[var(--sur)] border border-[var(--bdr)] rounded-xl w-full max-w-[380px] p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="font-medium text-[13px]">{bloq.nome}</div>
                <div className="text-[11px] text-[var(--tx3)]">{bloq.fundo}</div>
              </div>
              <button onClick={() => setBloqKey(null)} className="text-[var(--tx3)] hover:text-white"><X size={16} /></button>
            </div>
            <div className="flex gap-2 mb-2">
              <input value={bloqVal} onChange={(e) => setBloqVal(e.target.value)} placeholder="Valor" className="w-[110px] bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-2 py-1.5 text-[12px]" />
              <input value={bloqDesc} onChange={(e) => setBloqDesc(e.target.value)} placeholder="Descrição" className="flex-1 bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-2 py-1.5 text-[12px]" />
              <button onClick={addBloqueio} className="bg-id-dark hover:bg-id-mid rounded-lg px-3 text-[12px]">+</button>
            </div>
            <div className="space-y-1.5 max-h-[220px] overflow-y-auto">
              {!bloq.bloqueios.length ? (
                <div className="text-[12px] text-[var(--tx3)] text-center py-3">Nenhum bloqueio cadastrado</div>
              ) : bloq.bloqueios.map((b, i) => (
                <div key={i} className="flex items-center gap-2 bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-2.5 py-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-medium tabular-nums">{sdFmt(b.valor)}</div>
                    <div className="text-[11px] text-[var(--tx3)] truncate">{b.desc || 'Sem descrição'} · {b.data}</div>
                  </div>
                  <button onClick={() => removeBloqueio(i)} className="text-red-400 text-[13px]">✕</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
