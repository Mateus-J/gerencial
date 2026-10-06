// Tabela da base no mesmo formato da planilha de controle: todas as colunas,
// taxas segregadas, mais recente primeiro, filtro por coluna (estilo Excel),
// totais do que está filtrado e exportação.
import { useMemo, useState } from 'react'
import { CheckCircle2, Clock, AlertCircle, Download, Trash2, Plus, X, Pencil, ChevronLeft, ChevronRight, Filter, FilterX } from 'lucide-react'
import { brDate, sortKey, norm, fmtMoney, isOverdue } from '../../lib/taxaAdm'

const COLS = [
  { key: 'dataReceita', label: 'Data da receita', type: 'date' },
  { key: 'vencimento', label: 'Data prevista', type: 'date' },
  { key: 'adm', label: 'ADM', type: 'tax' },
  { key: 'custodia', label: 'Custódia', type: 'tax' },
  { key: 'controladoria', label: 'Controladoria', type: 'tax' },
  { key: 'distribuicao', label: 'Distribuição', type: 'tax' },
  { key: 'escrituracao', label: 'Escrituração', type: 'tax' },
  { key: 'fundo', label: 'Fundo', type: 'fundo' },
  { key: 'conta', label: 'Conta', type: 'text' },
  { key: 'gestor', label: 'Gestor', type: 'text' },
  { key: 'classif', label: 'Classificação', type: 'text' },
  { key: 'cnpj', label: 'CNPJ', type: 'text' },
  { key: 'val', label: 'Valor total', type: 'total' },
  { key: 'dataPagamento', label: 'Data de pgto', type: 'date' },
  { key: 'status', label: 'Status', type: 'status' },
  { key: 'mesRef', label: 'Mês referência', type: 'mes' },
]
const NUMERIC = new Set(['tax', 'total', 'money'])
const PAGE_SIZES = [50, 100, 250, 500]

// Texto que o filtro da coluna compara (o mesmo que aparece na célula)
function cellText(r, c) {
  const v = r[c.key]
  if (c.type === 'date') return brDate(v)
  if (NUMERIC.has(c.type)) return fmtMoney(v)
  if (c.type === 'status') return r.status === 'PAGO' ? 'PAGO' : isOverdue(r) ? 'VENCIDO' : 'PENDENTE'
  if (c.type === 'fundo') return (r.fundo || '') + ' ' + (r.ajuste || '')
  return v == null ? '' : String(v)
}

// Ordenação padrão: mês de referência mais recente primeiro, depois data da receita
function compare(a, b, key, asc) {
  const col = COLS.find((c) => c.key === key)
  let va, vb
  if (key === 'mesRef') { va = sortKey(a.mesRef); vb = sortKey(b.mesRef) }
  else if (col && NUMERIC.has(col.type)) { va = Number(a[key]) || 0; vb = Number(b[key]) || 0 }
  else { va = (a[key] || '').toString().toLowerCase(); vb = (b[key] || '').toString().toLowerCase() }
  const d = va > vb ? 1 : va < vb ? -1 : 0
  return asc ? d : -d
}

export default function BaseTable({
  rows, totalBase, onEdit, onNew, onUpdate, onUpdateTaxa, onSetStatus, onDelete, onExport, readOnly = false,
}) {
  const [sort, setSort] = useState({ key: 'mesRef', asc: false })
  const [filters, setFilters] = useState({})
  const [showFilters, setShowFilters] = useState(true)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(100)
  const [selected, setSelected] = useState(() => new Set())

  const activeFilters = Object.entries(filters).filter(([, v]) => v)
  const view = useMemo(() => {
    const fs = Object.entries(filters).filter(([, v]) => v).map(([k, v]) => [COLS.find((c) => c.key === k), norm(v)])
    const out = rows.filter((r) => fs.every(([c, v]) => (c.type === 'status' ? cellText(r, c) === v : norm(cellText(r, c)).includes(v))))
    out.sort((a, b) => compare(a, b, sort.key, sort.asc)
      || compare(a, b, 'mesRef', false) || compare(a, b, 'dataReceita', false) || compare(a, b, 'fundo', true))
    return out
  }, [rows, filters, sort])

  const totals = useMemo(() => {
    const t = {}
    COLS.filter((c) => NUMERIC.has(c.type)).forEach((c) => { t[c.key] = view.reduce((a, r) => a + (Number(r[c.key]) || 0), 0) })
    return t
  }, [view])

  const pageCount = Math.max(1, Math.ceil(view.length / pageSize))
  const curPage = Math.min(page, pageCount - 1)
  const pageRows = view.slice(curPage * pageSize, curPage * pageSize + pageSize)
  const selectable = pageRows.filter((r) => !r._fromFip)
  const allChecked = selectable.length > 0 && selectable.every((r) => selected.has(r.id))
  const selIds = [...selected]

  const setFilter = (k, v) => { setFilters((f) => ({ ...f, [k]: v })); setPage(0) }
  const toggle = (id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const clickSort = (key) => setSort((s) => (s.key === key ? { key, asc: !s.asc } : { key, asc: !(key === 'mesRef' || NUMERIC.has(COLS.find((c) => c.key === key)?.type) || key.startsWith('data') || key === 'vencimento') }))

  return (
    <div className="glass rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-[var(--bdr)] flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <div className="text-[13px] font-semibold font-display">Base de taxas</div>
          <div className="text-[11.5px] text-[var(--tx3)]">
            {view.length.toLocaleString('pt-BR')} de {totalBase.toLocaleString('pt-BR')} lançamento(s)
            {activeFilters.length > 0 && <> · {activeFilters.length} filtro(s) de coluna</>}
          </div>
        </div>
        {selected.size > 0 ? (
          <div className="flex flex-wrap items-center gap-2 animate-fade-up">
            <span className="text-[11.5px] text-[var(--tx3)]">{selected.size} selecionado(s)</span>
            <button onClick={() => { onSetStatus(selIds, 'PAGO'); setSelected(new Set()) }} className="btn btn-sm"><CheckCircle2 size={13} className="text-id-mid" /> Marcar pago</button>
            <button onClick={() => { onSetStatus(selIds, 'PENDENTE'); setSelected(new Set()) }} className="btn btn-sm"><Clock size={13} className="text-amber-500" /> Marcar pendente</button>
            <button onClick={() => onExport(view.filter((r) => selected.has(r.id)), 'taxas_selecao')} className="btn btn-sm"><Download size={13} /> Exportar seleção</button>
            <button onClick={() => { onDelete(selIds); setSelected(new Set()) }} className="btn btn-sm btn-danger"><Trash2 size={13} /> Excluir</button>
            <button onClick={() => setSelected(new Set())} className="btn btn-sm" title="Limpar seleção"><X size={13} /></button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setShowFilters((v) => !v)} className={`btn btn-sm ${showFilters ? 'border-id-mid/40' : ''}`}><Filter size={13} /> Filtros por coluna</button>
            {activeFilters.length > 0 && <button onClick={() => { setFilters({}); setPage(0) }} className="btn btn-sm"><FilterX size={13} /> Limpar</button>}
            <button onClick={() => onExport(view, 'taxas_filtrado')} className="btn btn-sm"><Download size={13} /> Exportar o que está na tela</button>
            <button onClick={() => onExport(null, 'base_taxas_completa')} className="btn btn-sm"><Download size={13} /> Exportar base completa</button>
            {!readOnly && <button onClick={onNew} className="btn btn-sm btn-primary"><Plus size={13} /> Nova linha</button>}
          </div>
        )}
      </div>

      <div className="overflow-auto max-h-[72vh]">
        <table className="w-full text-left min-w-[1820px] border-separate border-spacing-0">
          <thead className="sticky top-0 z-10">
            <tr className="text-[10px] font-mono uppercase tracking-wider text-[var(--tx3)] bg-[var(--sur)]">
              <th className="pl-4 pr-1 py-2.5 w-8 border-b border-[var(--bdr)] bg-[var(--sur)]">
                {!readOnly && <input type="checkbox" checked={allChecked} onChange={() => setSelected((s) => { const n = new Set(s); selectable.forEach((r) => { if (allChecked) n.delete(r.id); else n.add(r.id) }); return n })} className="accent-[#6B9A52]" />}
              </th>
              {COLS.map((c) => (
                <th key={c.key} onClick={() => clickSort(c.key)}
                  className={`px-2 py-2.5 font-medium cursor-pointer select-none whitespace-nowrap border-b border-[var(--bdr)] bg-[var(--sur)] hover:text-[var(--tx)] ${NUMERIC.has(c.type) ? 'text-right' : ''} ${sort.key === c.key ? 'text-id-dark dark:text-id-light' : ''}`}>
                  {c.label}{sort.key === c.key ? (sort.asc ? ' ↑' : ' ↓') : ''}
                </th>
              ))}
              <th className="px-2 py-2.5 w-16 border-b border-[var(--bdr)] bg-[var(--sur)]" />
            </tr>
            {showFilters && (
              <tr className="bg-[var(--sur)]">
                <th className="border-b border-[var(--bdr)] bg-[var(--sur)]" />
                {COLS.map((c) => (
                  <th key={c.key} className="px-1 py-1.5 border-b border-[var(--bdr)] bg-[var(--sur)] font-normal">
                    {c.type === 'status' ? (
                      <select value={filters[c.key] || ''} onChange={(e) => setFilter(c.key, e.target.value)} className="field py-1 px-1.5 text-[11px]">
                        <option value="">Todos</option><option value="PAGO">Pago</option><option value="PENDENTE">Pendente</option><option value="VENCIDO">Vencido</option>
                      </select>
                    ) : (
                      <input value={filters[c.key] || ''} onChange={(e) => setFilter(c.key, e.target.value)} placeholder="Filtrar…"
                        className={`field py-1 px-1.5 text-[11px] ${NUMERIC.has(c.type) ? 'text-right' : ''} ${filters[c.key] ? 'border-id-mid/60' : ''}`} />
                    )}
                  </th>
                ))}
                <th className="border-b border-[var(--bdr)] bg-[var(--sur)]" />
              </tr>
            )}
          </thead>
          <tbody>
            {pageRows.map((r) => {
              const fresh = r.updatedAt && Date.now() - r.updatedAt < 6000
              return (
                <tr key={r.id + (fresh ? ':' + r.updatedAt : '')} className={`group text-[12px] hover:bg-[var(--sur2)]/70 ${selected.has(r.id) ? 'bg-id-mid/8' : ''} ${fresh ? 'row-flash' : ''}`}>
                  <td className="pl-4 pr-1 py-1.5 border-b border-[var(--bdr)]/70">
                    {r._fromFip
                      ? <span title="Vem da Área FIP" className="text-[9px] font-semibold text-id-dark dark:text-id-light border border-id-mid/40 rounded px-1 py-0.5">FIP</span>
                      : !readOnly && <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} className="accent-[#6B9A52]" />}
                  </td>
                  {COLS.map((c) => <Cell key={c.key} r={r} c={c} onEdit={onEdit} onUpdate={onUpdate} onUpdateTaxa={onUpdateTaxa} onSetStatus={onSetStatus} readOnly={readOnly} />)}
                  <td className="px-2 py-1.5 border-b border-[var(--bdr)]/70">
                    {!r._fromFip && !readOnly && (
                      <div className="flex justify-end gap-0.5 opacity-50 group-hover:opacity-100">
                        <button onClick={() => onEdit(r)} title="Editar" className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--tx3)] hover:text-[var(--tx)] hover:bg-[var(--sur2)]"><Pencil size={13} /></button>
                        <button onClick={() => onDelete([r.id])} title="Excluir" className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--tx3)] hover:text-red-500 hover:bg-red-500/10"><Trash2 size={13} /></button>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
            {!pageRows.length && (
              <tr><td colSpan={COLS.length + 2} className="px-4 py-12 text-center text-[12.5px] text-[var(--tx3)]">Nenhum lançamento com esses filtros.</td></tr>
            )}
          </tbody>
          {view.length > 0 && (
            <tfoot className="sticky bottom-0">
              <tr className="text-[11.5px] font-semibold">
                <td className="bg-[var(--sur)] border-t-2 border-[var(--bdr)]" />
                {COLS.map((c) => (
                  <td key={c.key} className={`px-2 py-2.5 bg-[var(--sur)] border-t-2 border-[var(--bdr)] whitespace-nowrap ${NUMERIC.has(c.type) ? 'text-right font-mono' : 'text-[var(--tx3)]'}`}>
                    {NUMERIC.has(c.type) ? fmtMoney(totals[c.key]) : c.key === 'fundo' ? `Total (${view.length.toLocaleString('pt-BR')})` : ''}
                  </td>
                ))}
                <td className="bg-[var(--sur)] border-t-2 border-[var(--bdr)]" />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <div className="px-4 py-2.5 border-t border-[var(--bdr)] flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-[var(--tx3)]">
        <div className="flex items-center gap-2">
          <span>Linhas por página</span>
          <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0) }} className="field py-1 px-1.5 w-auto text-[11.5px]">
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <span>· {view.length ? curPage * pageSize + 1 : 0}–{Math.min(view.length, (curPage + 1) * pageSize)} de {view.length.toLocaleString('pt-BR')}</span>
        </div>
        <div className="flex items-center gap-1">
          <button disabled={curPage === 0} onClick={() => setPage(curPage - 1)} className="btn btn-sm"><ChevronLeft size={13} /></button>
          <span className="px-2">Página {curPage + 1} de {pageCount}</span>
          <button disabled={curPage >= pageCount - 1} onClick={() => setPage(curPage + 1)} className="btn btn-sm"><ChevronRight size={13} /></button>
        </div>
      </div>
    </div>
  )
}

function Cell({ r, c, onEdit, onUpdate, onUpdateTaxa, onSetStatus, readOnly }) {
  const base = 'px-2 py-1.5 border-b border-[var(--bdr)]/70 whitespace-nowrap'
  const ro = r._fromFip || readOnly
  switch (c.type) {
    case 'date':
      return <td className={`${base} font-mono text-[11.5px] ${c.key === 'vencimento' && isOverdue(r) ? 'text-red-500 font-medium' : 'text-[var(--tx2)]'}`}>{brDate(r[c.key]) || '—'}</td>
    case 'tax':
      return <td className={`${base} text-right`}>{ro ? <span className={`font-mono text-[11.5px] ${r[c.key] ? 'text-[var(--tx2)]' : 'text-[var(--tx4)]'}`}>{fmtMoney(r[c.key])}</span> : <MoneyInput value={Number(r[c.key]) || 0} onCommit={(v) => onUpdateTaxa(r, c.key, v)} width="w-[108px]" dim />}</td>
    case 'total':
      return <td className={`${base} text-right`}>{ro ? <span className="font-mono font-semibold text-[11.5px]">{fmtMoney(r.val)}</span> : <MoneyInput value={r.val} onCommit={(v) => onUpdate(r.id, { val: v })} strong />}</td>
    case 'money':
      return <td className={`${base} text-right font-mono text-[11.5px] ${r[c.key] ? 'text-[var(--tx2)]' : 'text-[var(--tx4)]'}`}>{fmtMoney(r[c.key])}</td>
    case 'fundo':
      return (
        <td className={`${base} max-w-[300px]`}>
          <button disabled={ro} onClick={() => onEdit(r)} className="text-left w-full truncate font-medium hover:text-id-dark dark:hover:text-id-light disabled:cursor-default" title={r.fundo}>
            {r.fundo}{r.ajuste && <span className="ml-1.5 text-[9.5px] font-semibold uppercase rounded px-1 py-0.5 bg-sky-500/12 text-sky-600 dark:text-sky-400 align-middle">{r.ajuste}</span>}
          </button>
        </td>
      )
    case 'status':
      return <td className={base}><StatusPill row={r} onToggle={ro ? null : () => onSetStatus([r.id], r.status === 'PAGO' ? 'PENDENTE' : 'PAGO')} /></td>
    case 'mes':
      return <td className={`${base} font-mono text-[11.5px] font-medium`}>{r.mesRef}</td>
    default:
      return <td className={`${base} text-[var(--tx2)] max-w-[220px] truncate`} title={r[c.key] || ''}>{r[c.key] || '—'}</td>
  }
}

// Valor editável direto na tabela: Enter salva, Esc desfaz.
export function MoneyInput({ value, onCommit, width = 'w-[120px]', dim, strong }) {
  return (
    <input
      key={value}
      defaultValue={fmtMoney(value)}
      onFocus={(e) => e.target.select()}
      onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') { e.target.value = fmtMoney(value); e.target.blur() } }}
      onBlur={(e) => {
        const s = e.target.value.replace(/[R$\s]/g, '')
        const n = parseFloat(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s)
        const v = Math.round((isNaN(n) ? 0 : n) * 100) / 100
        if (Math.abs(v - (Number(value) || 0)) > 0.004) onCommit(v)
      }}
      className={`${width} text-right font-mono text-[11.5px] bg-transparent rounded-md px-1.5 py-1 outline-none border border-transparent hover:border-[var(--bdr)] focus:border-id-mid focus:bg-[var(--sur)] ${dim && !value ? 'text-[var(--tx4)]' : ''} ${strong ? 'font-semibold' : ''}`}
      title="Clique para editar"
    />
  )
}

export function StatusPill({ row, onToggle }) {
  const paid = row.status === 'PAGO'
  const overdue = isOverdue(row)
  const cls = paid
    ? 'bg-id-mid/15 text-id-dark dark:text-id-light border-id-mid/30'
    : overdue ? 'bg-red-500/12 text-red-600 dark:text-red-400 border-red-500/30'
      : 'bg-amber-500/12 text-amber-700 dark:text-amber-400 border-amber-500/30'
  const label = paid ? 'Pago' : overdue ? 'Vencido' : row.status === 'PENDENTE' ? 'Pendente' : row.status
  const Icon = paid ? CheckCircle2 : overdue ? AlertCircle : Clock
  const title = onToggle
    ? (paid ? `Pago${row.dataPagamento ? ' em ' + brDate(row.dataPagamento) : ''} — clique para voltar a pendente` : 'Clique para marcar como pago')
    : undefined
  return (
    <button disabled={!onToggle} onClick={onToggle} title={title}
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-full border text-[10.5px] font-semibold transition-transform enabled:hover:scale-105 enabled:active:scale-95 ${cls}`}>
      <Icon size={11} /> {label}
    </button>
  )
}
