import { useState } from 'react'
import { Plus, X, Eye, EyeOff, ChevronDown, GripVertical } from 'lucide-react'
import { Card } from '../PageShell'

const GROUP_COLORS = ['#8FB352', '#38bdf8', '#a78bfa', '#f59e0b', '#f87171', '#2dd4bf', '#ec4899']
const COL_TYPES = [
  { id: 'text', label: 'Texto' },
  { id: 'number', label: 'Número' },
  { id: 'date', label: 'Data' },
  { id: 'status', label: 'Status' },
  { id: 'password', label: 'Senha' },
]
const STATUS_OPTIONS = [
  { v: 'Pendente', color: '#f59e0b' },
  { v: 'Em andamento', color: '#38bdf8' },
  { v: 'Concluído', color: '#8FB352' },
  { v: 'Bloqueado', color: '#f87171' },
]

export default function BoardTable({ board, onSave }) {
  const groups = board.groups || []

  function updateGroups(next) { onSave({ ...board, groups: next }) }

  function addGroup() {
    updateGroups([...groups, { id: 'g' + Date.now(), name: 'Novo grupo', color: GROUP_COLORS[groups.length % GROUP_COLORS.length], columns: [{ id: 'c1', name: 'Item', type: 'text' }], rows: [] }])
  }
  function removeGroup(gid) {
    if (!confirm('Excluir este grupo e todas as linhas dentro dele?')) return
    updateGroups(groups.filter((g) => g.id !== gid))
  }
  function renameGroup(gid, name) { updateGroups(groups.map((g) => g.id === gid ? { ...g, name } : g)) }
  function recolorGroup(gid, color) { updateGroups(groups.map((g) => g.id === gid ? { ...g, color } : g)) }

  function addColumn(gid, name, type) {
    updateGroups(groups.map((g) => g.id === gid ? { ...g, columns: [...g.columns, { id: 'c' + Date.now(), name, type }] } : g))
  }
  function removeColumn(gid, cid) {
    updateGroups(groups.map((g) => g.id === gid ? { ...g, columns: g.columns.filter((c) => c.id !== cid) } : g))
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

  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <GroupBlock
          key={g.id}
          group={g}
          onRename={(name) => renameGroup(g.id, name)}
          onRecolor={(c) => recolorGroup(g.id, c)}
          onRemove={() => removeGroup(g.id)}
          onAddColumn={(name, type) => addColumn(g.id, name, type)}
          onRemoveColumn={(cid) => removeColumn(g.id, cid)}
          onAddRow={() => addRow(g.id)}
          onRemoveRow={(rid) => removeRow(g.id, rid)}
          onEditCell={(rid, cid, v) => editCell(g.id, rid, cid, v)}
        />
      ))}
      <button onClick={addGroup} className="flex items-center gap-1.5 text-[12px] border border-[var(--bdr)] rounded-lg px-3 py-1.5 text-[var(--tx2)] hover:bg-[var(--sur2)]">
        <Plus size={13} /> Novo grupo
      </button>
    </div>
  )
}

function GroupBlock({ group, onRename, onRecolor, onRemove, onAddColumn, onRemoveColumn, onAddRow, onRemoveRow, onEditCell }) {
  const [showAddCol, setShowAddCol] = useState(false)
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [newColName, setNewColName] = useState('')
  const [newColType, setNewColType] = useState('text')

  function submitAddCol() {
    if (!newColName.trim()) return
    onAddColumn(newColName.trim(), newColType)
    setNewColName(''); setNewColType('text'); setShowAddCol(false)
  }

  return (
    <Card>
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[var(--bdr)]" style={{ borderLeft: `4px solid ${group.color}` }}>
        <button onClick={() => setShowColorPicker((s) => !s)} className="w-3.5 h-3.5 rounded-full shrink-0" style={{ background: group.color }} />
        {showColorPicker && (
          <div className="flex gap-1 mr-1">
            {GROUP_COLORS.map((c) => (
              <button key={c} onClick={() => { onRecolor(c); setShowColorPicker(false) }} className="w-4 h-4 rounded-full border border-[var(--bdr)]" style={{ background: c }} />
            ))}
          </div>
        )}
        <input defaultValue={group.name} onBlur={(e) => onRename(e.target.value)} className="bg-transparent font-display font-semibold text-[13px] outline-none flex-1 min-w-0" />
        <span className="text-[10.5px] text-[var(--tx3)]">{group.rows.length} item{group.rows.length !== 1 ? 's' : ''}</span>
        <button onClick={onRemove} className="text-[var(--tx3)] hover:text-red-500 ml-1"><X size={14} /></button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="text-[10.5px] uppercase tracking-wider text-[var(--tx3)] border-b border-[var(--bdr)]">
              {group.columns.map((c) => (
                <th key={c.id} className="px-3 py-2 font-medium whitespace-nowrap group/col">
                  <span className="inline-flex items-center gap-1">
                    {c.name}
                    <button onClick={() => onRemoveColumn(c.id)} className="opacity-0 group-hover/col:opacity-100 text-[var(--tx4)] hover:text-red-500"><X size={10} /></button>
                  </span>
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
                  <td key={c.id} className="px-3 py-1.5">
                    <Cell type={c.type} value={r.cells[c.id]} onChange={(v) => onEditCell(r.id, c.id, v)} />
                  </td>
                ))}
                <td className="px-2 py-1.5 text-center">
                  <button onClick={() => onRemoveRow(r.id)} className="opacity-0 group-hover/row:opacity-100 text-[var(--tx4)] hover:text-red-500"><X size={12} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showAddCol && (
        <div className="flex items-center gap-2 px-3 py-2 border-t border-[var(--bdr)] bg-[var(--sur2)]/50">
          <input value={newColName} onChange={(e) => setNewColName(e.target.value)} placeholder="Nome da coluna" className="flex-1 bg-[var(--sur)] border border-[var(--bdr)] rounded-lg px-2 py-1 text-[12px]" />
          <select value={newColType} onChange={(e) => setNewColType(e.target.value)} className="bg-[var(--sur)] border border-[var(--bdr)] rounded-lg px-2 py-1 text-[12px]">
            {COL_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          <button onClick={submitAddCol} className="text-[11px] bg-id-dark hover:bg-id-mid text-white rounded-lg px-2.5 py-1">Adicionar</button>
        </div>
      )}

      <button onClick={onAddRow} className="w-full text-left px-3 py-2 text-[11.5px] text-[var(--tx3)] hover:bg-[var(--sur2)] border-t border-[var(--bdr)]">
        + Adicionar item
      </button>
    </Card>
  )
}

function Cell({ type, value, onChange }) {
  const [showPass, setShowPass] = useState(false)

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
  if (type === 'number') {
    return <input type="number" defaultValue={value || ''} onBlur={(e) => onChange(e.target.value)} className="bg-transparent text-[12px] outline-none w-full" />
  }
  return <input defaultValue={value || ''} onBlur={(e) => onChange(e.target.value)} className="bg-transparent text-[12px] outline-none w-full" />
}
