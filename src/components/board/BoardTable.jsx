import { useEffect, useRef, useState } from 'react'
import { Plus, X, Eye, EyeOff, GripVertical, Palette } from 'lucide-react'
import { Card } from '../PageShell'

// Paleta ampliada — usada tanto pra cor do grupo quanto pra cor do texto na
// formatação de coluna.
const PALETTE = [
  '#8FB352', '#38bdf8', '#a78bfa', '#f59e0b', '#f87171', '#2dd4bf', '#ec4899',
  '#eab308', '#0ea5e9', '#84cc16', '#fb923c', '#c084fc', '#f472b6', '#94a3b8',
]
const COL_TYPES = [
  { id: 'text', label: 'Texto' },
  { id: 'number', label: 'Número' },
  { id: 'valor', label: 'Valor (R$)' },
  { id: 'date', label: 'Data' },
  { id: 'status', label: 'Status' },
  { id: 'password', label: 'Senha' },
  { id: 'rentabilidade', label: 'Rentabilidade (%)' },
]
const STATUS_OPTIONS = [
  { v: 'Pendente', color: '#f59e0b' },
  { v: 'Em andamento', color: '#38bdf8' },
  { v: 'Concluído', color: '#8FB352' },
  { v: 'Bloqueado', color: '#f87171' },
]

function fmtBRL(v) {
  const n = Number(v)
  if (!v || isNaN(n)) return ''
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtNum(v) {
  const n = Number(v)
  if (v === '' || v === undefined || v === null || isNaN(n)) return ''
  return n.toLocaleString('pt-BR')
}

// Botão de exclusão com dupla confirmação: primeiro clique "arma" o botão
// (fica vermelho, pedindo confirmação), só o segundo clique em até 3s de
// fato executa. Evita excluir linha/coluna sem querer, sem precisar de
// popup do navegador pra cada clique.
function DoubleConfirmButton({ onConfirm, icon, className = '', title }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(t)
  }, [armed])
  return (
    <button
      type="button"
      title={armed ? 'Clique de novo pra confirmar' : title}
      onClick={(e) => {
        e.stopPropagation()
        if (armed) { onConfirm(); setArmed(false) } else setArmed(true)
      }}
      className={`${className} ${armed ? 'text-red-500 scale-125' : ''} transition-all`}
    >
      {icon}
    </button>
  )
}

export default function BoardTable({ board, onSave }) {
  const groups = board.groups || []
  const dragGroup = useRef(null)

  function updateGroups(next) { onSave({ ...board, groups: next }) }

  function addGroup() {
    updateGroups([...groups, { id: 'g' + Date.now(), name: 'Novo grupo', color: PALETTE[groups.length % PALETTE.length], columns: [{ id: 'c1', name: 'Item', type: 'text' }], rows: [] }])
  }
  function removeGroup(gid) {
    updateGroups(groups.filter((g) => g.id !== gid))
  }
  function renameGroup(gid, name) { updateGroups(groups.map((g) => g.id === gid ? { ...g, name } : g)) }
  function recolorGroup(gid, color) { updateGroups(groups.map((g) => g.id === gid ? { ...g, color } : g)) }

  function addColumn(gid, name, type, baseColumnId) {
    updateGroups(groups.map((g) => g.id === gid ? { ...g, columns: [...g.columns, { id: 'c' + Date.now(), name, type, ...(baseColumnId ? { baseColumnId } : {}) }] } : g))
  }
  function removeColumn(gid, cid) {
    updateGroups(groups.map((g) => g.id === gid ? { ...g, columns: g.columns.filter((c) => c.id !== cid) } : g))
  }
  function reorderColumns(gid, fromIdx, toIdx) {
    updateGroups(groups.map((g) => {
      if (g.id !== gid) return g
      const cols = [...g.columns]
      const [moved] = cols.splice(fromIdx, 1)
      cols.splice(toIdx, 0, moved)
      return { ...g, columns: cols }
    }))
  }
  function formatColumn(gid, cid, format) {
    updateGroups(groups.map((g) => g.id !== gid ? g : { ...g, columns: g.columns.map((c) => c.id === cid ? { ...c, format: { ...c.format, ...format } } : c) }))
  }
  function addRow(gid) {
    updateGroups(groups.map((g) => g.id === gid ? { ...g, rows: [...g.rows, { id: 'r' + Date.now(), cells: {} }] } : g))
  }
  function removeRow(gid, rid) {
    updateGroups(groups.map((g) => g.id === gid ? { ...g, rows: g.rows.filter((r) => r.id !== rid) } : g))
  }
  function editCell(gid, rid, cid, value) {
    updateGroups(groups.map((g) => g.id !== gid ? g : {
      ...g, rows: g.rows.map((r) => r.id !== rid ? r : { ...r, cells: { ...r.cells, [cid]: value } }),
    }))
  }

  function onGroupDragStart(gid) { dragGroup.current = gid }
  function onGroupDrop(targetGid) {
    if (!dragGroup.current || dragGroup.current === targetGid) return
    const from = groups.findIndex((g) => g.id === dragGroup.current)
    const to = groups.findIndex((g) => g.id === targetGid)
    if (from < 0 || to < 0) return
    const next = [...groups]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    updateGroups(next)
    dragGroup.current = null
  }

  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <div
          key={g.id}
          draggable
          onDragStart={() => onGroupDragStart(g.id)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => onGroupDrop(g.id)}
        >
          <GroupBlock
            group={g}
            onRename={(name) => renameGroup(g.id, name)}
            onRecolor={(c) => recolorGroup(g.id, c)}
            onRemove={() => removeGroup(g.id)}
            onAddColumn={(name, type, baseColumnId) => addColumn(g.id, name, type, baseColumnId)}
            onRemoveColumn={(cid) => removeColumn(g.id, cid)}
            onReorderColumns={(from, to) => reorderColumns(g.id, from, to)}
            onFormatColumn={(cid, fmt) => formatColumn(g.id, cid, fmt)}
            onAddRow={() => addRow(g.id)}
            onRemoveRow={(rid) => removeRow(g.id, rid)}
            onEditCell={(rid, cid, v) => editCell(g.id, rid, cid, v)}
          />
        </div>
      ))}
      <button onClick={addGroup} className="flex items-center gap-1.5 text-[12px] border border-[var(--bdr)] rounded-lg px-3 py-1.5 text-[var(--tx2)] hover:bg-[var(--sur2)]">
        <Plus size={13} /> Novo grupo
      </button>
    </div>
  )
}

function GroupBlock({ group, onRename, onRecolor, onRemove, onAddColumn, onRemoveColumn, onReorderColumns, onFormatColumn, onAddRow, onRemoveRow, onEditCell }) {
  const [showAddCol, setShowAddCol] = useState(false)
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [newColName, setNewColName] = useState('')
  const [newColType, setNewColType] = useState('text')
  const [newColBase, setNewColBase] = useState('')
  const [formatCol, setFormatCol] = useState(null) // id da coluna com o popover de formatação aberto
  const dragCol = useRef(null)

  const valorCols = group.columns.filter((c) => c.type === 'valor' || c.type === 'number')

  function submitAddCol() {
    if (!newColName.trim()) return
    if (newColType === 'rentabilidade' && !newColBase) return
    onAddColumn(newColName.trim(), newColType, newColType === 'rentabilidade' ? newColBase : undefined)
    setNewColName(''); setNewColType('text'); setNewColBase(''); setShowAddCol(false)
  }

  function onColDrop(targetIdx) {
    if (dragCol.current === null || dragCol.current === targetIdx) return
    onReorderColumns(dragCol.current, targetIdx)
    dragCol.current = null
  }

  return (
    <Card>
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[var(--bdr)] cursor-grab active:cursor-grabbing" style={{ borderLeft: `4px solid ${group.color}` }}>
        <GripVertical size={13} className="text-[var(--tx4)] shrink-0" />
        <button onClick={() => setShowColorPicker((s) => !s)} className="w-3.5 h-3.5 rounded-full shrink-0" style={{ background: group.color }} />
        {showColorPicker && (
          <div className="flex gap-1 mr-1 flex-wrap max-w-[180px]">
            {PALETTE.map((c) => (
              <button key={c} onClick={() => { onRecolor(c); setShowColorPicker(false) }} className="w-4 h-4 rounded-full border border-[var(--bdr)]" style={{ background: c }} />
            ))}
          </div>
        )}
        <input defaultValue={group.name} onBlur={(e) => onRename(e.target.value)} className="bg-transparent font-display font-semibold text-[13px] outline-none flex-1 min-w-0" />
        <span className="text-[10.5px] text-[var(--tx3)]">{group.rows.length} item{group.rows.length !== 1 ? 's' : ''}</span>
        <DoubleConfirmButton onConfirm={onRemove} icon={<X size={14} />} className="text-[var(--tx3)] hover:text-red-500 ml-1" title="Excluir grupo (clique 2x)" />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="text-[10.5px] uppercase tracking-wider text-[var(--tx3)] border-b border-[var(--bdr)]">
              {group.columns.map((c, ci) => (
                <th
                  key={c.id}
                  draggable
                  onDragStart={() => { dragCol.current = ci }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => onColDrop(ci)}
                  className="px-3 py-2 font-medium whitespace-nowrap group/col relative cursor-grab active:cursor-grabbing"
                >
                  <span className="inline-flex items-center gap-1">
                    <GripVertical size={10} className="text-[var(--tx4)] opacity-0 group-hover/col:opacity-100 shrink-0" />
                    {c.name}
                    <button onClick={() => setFormatCol(formatCol === c.id ? null : c.id)} className="opacity-0 group-hover/col:opacity-100 text-[var(--tx4)] hover:text-id-light shrink-0" title="Formatar coluna">
                      <Palette size={10} />
                    </button>
                    <DoubleConfirmButton onConfirm={() => onRemoveColumn(c.id)} icon={<X size={10} />} className="opacity-0 group-hover/col:opacity-100 text-[var(--tx4)] hover:text-red-500 shrink-0" title="Excluir coluna (clique 2x)" />
                  </span>
                  {formatCol === c.id && (
                    <ColumnFormatPopover column={c} onChange={(fmt) => onFormatColumn(c.id, fmt)} onClose={() => setFormatCol(null)} />
                  )}
                </th>
              ))}
              <th className="px-2 py-2 w-8">
                <button onClick={() => setShowAddCol((s) => !s)} className="text-[var(--tx3)] hover:text-id-dark dark:hover:text-id-light"><Plus size={13} /></button>
              </th>
            </tr>
          </thead>
          <tbody>
            {group.rows.map((r) => (
              <tr key={r.id} className="border-b border-[var(--bdr)]/60 hover:bg-[var(--sur2)]/50 group/row">
                {group.columns.map((c) => (
                  <td key={c.id} className="px-3 py-1.5" style={cellStyle(c.format)}>
                    <Cell column={c} row={r} value={r.cells[c.id]} onChange={(v) => onEditCell(r.id, c.id, v)} />
                  </td>
                ))}
                <td className="px-2 py-1.5 text-center">
                  <DoubleConfirmButton onConfirm={() => onRemoveRow(r.id)} icon={<X size={12} />} className="opacity-0 group-hover/row:opacity-100 text-[var(--tx4)] hover:text-red-500" title="Excluir linha (clique 2x)" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showAddCol && (
        <div className="flex items-center gap-2 px-3 py-2 border-t border-[var(--bdr)] bg-[var(--sur2)]/50 flex-wrap">
          <input value={newColName} onChange={(e) => setNewColName(e.target.value)} placeholder="Nome da coluna" className="flex-1 min-w-[120px] bg-[var(--sur)] border border-[var(--bdr)] rounded-lg px-2 py-1 text-[12px]" />
          <select value={newColType} onChange={(e) => setNewColType(e.target.value)} className="bg-[var(--sur)] border border-[var(--bdr)] rounded-lg px-2 py-1 text-[12px]">
            {COL_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          {newColType === 'rentabilidade' && (
            <select value={newColBase} onChange={(e) => setNewColBase(e.target.value)} className="bg-[var(--sur)] border border-[var(--bdr)] rounded-lg px-2 py-1 text-[12px]">
              <option value="">Calcular sobre qual coluna?</option>
              {valorCols.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <button onClick={submitAddCol} className="text-[11px] bg-id-dark hover:bg-id-mid text-white rounded-lg px-2.5 py-1">Adicionar</button>
        </div>
      )}

      <button onClick={onAddRow} className="w-full text-left px-3 py-2 text-[11.5px] text-[var(--tx3)] hover:bg-[var(--sur2)] border-t border-[var(--bdr)]">
        + Adicionar item
      </button>
    </Card>
  )
}

function cellStyle(format) {
  if (!format) return undefined
  const style = {}
  if (format.color) style.color = format.color
  if (format.bg) style.backgroundColor = format.bg + '22'
  if (format.bold) style.fontWeight = 700
  if (format.align) style.textAlign = format.align
  return style
}

function ColumnFormatPopover({ column, onChange, onClose }) {
  const format = column.format || {}
  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div className="absolute left-0 top-full mt-1 z-20 bg-[var(--sur)] border border-[var(--bdr)] rounded-lg shadow-card p-3 w-[220px] normal-case">
        <div className="text-[10px] uppercase text-[var(--tx3)] mb-1.5">Cor do texto</div>
        <div className="flex gap-1 flex-wrap mb-3">
          <button onClick={() => onChange({ color: null })} className="w-4 h-4 rounded-full border border-[var(--bdr)] flex items-center justify-center text-[8px]" title="Padrão">×</button>
          {PALETTE.map((c) => (
            <button key={c} onClick={() => onChange({ color: c })} className="w-4 h-4 rounded-full border border-[var(--bdr)]" style={{ background: c }} />
          ))}
        </div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] text-[var(--tx2)] normal-case">Negrito</span>
          <button onClick={() => onChange({ bold: !format.bold })} className={`w-7 h-4 rounded-full transition-colors relative ${format.bold ? 'bg-id-mid' : 'bg-[var(--sur2)] border border-[var(--bdr)]'}`}>
            <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-transform ${format.bold ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
          </button>
        </div>
        <div className="text-[10px] uppercase text-[var(--tx3)] mb-1">Alinhamento</div>
        <div className="flex gap-1">
          {['left', 'center', 'right'].map((a) => (
            <button key={a} onClick={() => onChange({ align: a })} className={`flex-1 text-[10px] py-1 rounded-md border ${format.align === a || (!format.align && a === 'left') ? 'bg-id-mid/20 border-id-mid text-id-light' : 'border-[var(--bdr)] text-[var(--tx3)]'}`}>
              {a === 'left' ? '⬅' : a === 'center' ? '↔' : '➡'}
            </button>
          ))}
        </div>
      </div>
    </>
  )
}

function Cell({ column, row, value, onChange }) {
  const [showPass, setShowPass] = useState(false)
  const type = column.type

  if (type === 'status') {
    const opt = STATUS_OPTIONS.find((o) => o.v === value)
    return (
      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        className="text-[11px] font-medium rounded-md px-2 py-1 border-0 outline-none"
        style={{ background: opt ? opt.color + '22' : 'var(--sur2)', color: opt ? opt.color : 'var(--tx3)' }}
      >
        <option value="">—</option>
        {STATUS_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.v}</option>)}
      </select>
    )
  }
  if (type === 'password') {
    return (
      <div className="flex items-center gap-1.5">
        <input
          type={showPass ? 'text' : 'password'}
          defaultValue={value || ''}
          onBlur={(e) => onChange(e.target.value)}
          className="bg-transparent text-[12px] outline-none w-full font-mono"
        />
        <button onClick={() => setShowPass((s) => !s)} className="text-[var(--tx4)] hover:text-[var(--tx2)] shrink-0">
          {showPass ? <EyeOff size={12} /> : <Eye size={12} />}
        </button>
      </div>
    )
  }
  if (type === 'date') {
    return <input type="date" defaultValue={value || ''} onBlur={(e) => onChange(e.target.value)} className="bg-transparent text-[12px] outline-none" />
  }
  if (type === 'valor') {
    return (
      <div className="flex items-center gap-1">
        <span className="text-[var(--tx4)] text-[11px]">R$</span>
        <input
          type="text"
          inputMode="decimal"
          defaultValue={value !== undefined && value !== '' ? fmtBRL(value) : ''}
          onFocus={(e) => { e.target.value = value || '' }}
          onBlur={(e) => { const n = parseFloat(String(e.target.value).replace(/\./g, '').replace(',', '.')) || 0; onChange(n); e.target.value = fmtBRL(n) }}
          className="bg-transparent text-[12px] outline-none w-full text-right font-mono"
        />
      </div>
    )
  }
  if (type === 'number') {
    return (
      <input
        type="text"
        inputMode="decimal"
        defaultValue={value !== undefined && value !== '' ? fmtNum(value) : ''}
        onFocus={(e) => { e.target.value = value || '' }}
        onBlur={(e) => { const n = parseFloat(String(e.target.value).replace(/\./g, '').replace(',', '.')) || 0; onChange(n); e.target.value = fmtNum(n) }}
        className="bg-transparent text-[12px] outline-none w-full text-right font-mono"
      />
    )
  }
  if (type === 'rentabilidade') {
    const pct = parseFloat(value) || 0
    const base = Number(row.cells[column.baseColumnId]) || 0
    const resultado = base * (pct / 100)
    return (
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          inputMode="decimal"
          defaultValue={value || ''}
          onBlur={(e) => onChange(parseFloat(String(e.target.value).replace(',', '.')) || 0)}
          className="bg-transparent text-[12px] outline-none w-12 text-right font-mono"
        />
        <span className="text-[11px] text-[var(--tx4)]">%</span>
        {!!base && (
          <span className="text-[11px] text-id-light font-mono ml-1">= R$ {fmtBRL(resultado)}</span>
        )}
      </div>
    )
  }
  return <input defaultValue={value || ''} onBlur={(e) => onChange(e.target.value)} className="bg-transparent text-[12px] outline-none w-full" />
}
