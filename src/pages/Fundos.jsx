import { useMemo, useRef, useState } from 'react'
import { Plus, Upload, X, Trash2, Database } from 'lucide-react'
import { PageHeader, Card } from '../components/PageShell'
import { useFundos } from '../hooks/useFundos'
import { useToast } from '../components/Toast'
import FUNDOS_BASE from '../data/fundos.json'

// Localiza colunas do CSV da CVM (registro_fundo.csv, dentro de
// registro_fundo_classe.zip em dados.cvm.gov.br) por palavra-chave, já que o
// layout exato pode variar entre exportações.
function findCol(headerRow, ...keywords) {
  for (let i = 0; i < headerRow.length; i++) {
    const h = headerRow[i].toLowerCase()
    if (keywords.some((k) => h === k || h.includes(k))) return i
  }
  return -1
}

export default function Fundos() {
  const toast = useToast()
  const { all, extra, loading, persist } = useFundos()
  const [q, setQ] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [importing, setImporting] = useState(false)
  const fileRef = useRef(null)

  const rows = useMemo(() => {
    const list = [...extra]
    if (!q) return list
    return list.filter((f) => f.nome.toLowerCase().includes(q.toLowerCase()) || f.cnpj.includes(q))
  }, [extra, q])

  function addFundo(f) {
    persist([{ ...f, addedAt: Date.now() }, ...extra])
    setShowModal(false)
    toast.success('Fundo adicionado!')
  }
  function removeFundo(cnpj) {
    if (!confirm('Remover este fundo da base?')) return
    persist(extra.filter((f) => f.cnpj !== cnpj))
    toast.success('Fundo removido.')
  }

  function handleImportCSV(file) {
    if (!file) return
    setImporting(true)
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const text = e.target.result
        const lines = text.split('\n').filter((l) => l.trim())
        const sep = lines[0].includes(';') ? ';' : ','
        const rowsRaw = lines.map((l) => l.split(sep).map((c) => c.replace(/"/g, '').trim()))
        const header = rowsRaw[0].map((h) => h.toLowerCase())
        const idxCnpj = findCol(header, 'cnpj_fundo', 'cnpj fundo', 'cnpj')
        const idxNome = findCol(header, 'denom_social', 'denominacao social', 'nome')
        const idxTipo = findCol(header, 'tp_fundo', 'classe', 'tipo')
        const idxGestor = findCol(header, 'gestor')
        const idxAdmin = findCol(header, 'admin', 'administrador')
        if (idxCnpj < 0 || idxNome < 0) { toast.error('Não encontrei as colunas de CNPJ/Nome nesse CSV. Confira se é o registro_fundo.csv da CVM.'); setImporting(false); return }

        const existingMap = {}
        extra.forEach((f, i) => { existingMap[f.cnpj] = i })
        const merged = [...extra]
        let countNew = 0, countUpdated = 0
        rowsRaw.slice(1).forEach((r) => {
          const cnpj = (r[idxCnpj] || '').trim()
          const nome = (r[idxNome] || '').trim()
          if (!cnpj || !nome) return
          const item = {
            cnpj, nome,
            tipo: idxTipo >= 0 ? (r[idxTipo] || '').trim() : '',
            gestor: idxGestor >= 0 ? (r[idxGestor] || '').trim() : '',
            administrador: idxAdmin >= 0 ? (r[idxAdmin] || '').trim() : '',
          }
          if (cnpj in existingMap) { merged[existingMap[cnpj]] = item; countUpdated++ }
          else { merged.push(item); existingMap[cnpj] = merged.length - 1; countNew++ }
        })
        persist(merged)
        toast.success(`Importado: ${countNew} novo(s), ${countUpdated} atualizado(s).`)
      } catch (err) {
        console.error(err)
        toast.error('Erro ao ler CSV: ' + err.message)
      } finally {
        setImporting(false)
      }
    }
    reader.readAsText(file, 'iso-8859-1')
  }

  return (
    <div>
      <PageHeader
        eyebrow="Operacional"
        title="Fundos"
        actions={
          <>
            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={(e) => handleImportCSV(e.target.files[0])} />
            <button onClick={() => fileRef.current?.click()} disabled={importing} className="flex items-center gap-1.5 text-[12px] border border-[var(--bdr)] rounded-lg px-3 py-1.5 text-[var(--tx2)] hover:bg-[var(--sur2)] disabled:opacity-50">
              <Upload size={13} /> {importing ? 'Importando…' : 'Importar CSV da CVM'}
            </button>
            <button onClick={() => setShowModal(true)} className="flex items-center gap-1.5 text-[12px] bg-id-dark hover:bg-id-mid rounded-lg px-3 py-1.5 font-medium text-white">
              <Plus size={13} /> Incluir fundo
            </button>
          </>
        }
      />
      <p className="text-[11px] text-[var(--tx3)] -mt-3 mb-4">
        Base de referência para o autocomplete de "Fundo" nas pendências — {FUNDOS_BASE.length} fundos fixos + {extra.length} incluídos/importados aqui.
        Baixe o <code className="text-[var(--tx2)]">registro_fundo.csv</code> em <span className="text-[var(--tx2)]">dados.cvm.gov.br</span> (dentro de registro_fundo_classe.zip) e importe pra atualizar.
      </p>

      <Card>
        <div className="p-3 border-b border-[var(--bdr)] flex items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar fundo incluído/importado…" className="flex-1 bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-3 py-2 text-[12px] outline-none focus:border-id-mid" />
          <span className="flex items-center gap-1 text-[11px] text-[var(--tx3)]"><Database size={12} /> {extra.length} nesta base</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10.5px] uppercase tracking-wider text-[var(--tx3)] border-b border-[var(--bdr)]">
                <th className="px-3 py-2.5 font-medium">Fundo</th>
                <th className="px-3 py-2.5 font-medium">CNPJ</th>
                <th className="px-3 py-2.5 font-medium">Tipo</th>
                <th className="px-3 py-2.5 font-medium">Gestor</th>
                <th className="px-3 py-2.5 font-medium">Administrador</th>
                <th className="px-3 py-2.5 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="text-center py-8 text-[var(--tx3)]">Carregando…</td></tr>
              ) : !rows.length ? (
                <tr><td colSpan={6} className="text-center py-8 text-[var(--tx3)]">{extra.length ? 'Nenhum resultado.' : 'Nenhum fundo incluído/importado ainda — a base fixa de 592 fundos continua disponível no autocomplete normalmente.'}</td></tr>
              ) : rows.map((f) => (
                <tr key={f.cnpj} className="border-b border-[var(--bdr)]/60 hover:bg-[var(--sur2)]/60 text-[12.5px]">
                  <td className="px-3 py-2 font-medium max-w-[260px] truncate" title={f.nome}>{f.nome}</td>
                  <td className="px-3 py-2 text-[var(--tx3)] font-mono text-[11px] whitespace-nowrap">{f.cnpj}</td>
                  <td className="px-3 py-2 text-[var(--tx3)]">{f.tipo || '—'}</td>
                  <td className="px-3 py-2 text-[var(--tx2)] max-w-[180px] truncate" title={f.gestor}>{f.gestor || '—'}</td>
                  <td className="px-3 py-2 text-[var(--tx3)] max-w-[180px] truncate" title={f.administrador}>{f.administrador || '—'}</td>
                  <td className="px-3 py-2 text-center"><button onClick={() => removeFundo(f.cnpj)} className="text-[var(--tx3)] hover:text-red-500"><Trash2 size={13} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {showModal && <IncluirFundoModal onClose={() => setShowModal(false)} onSave={addFundo} />}
    </div>
  )
}

function IncluirFundoModal({ onClose, onSave }) {
  const [nome, setNome] = useState('')
  const [cnpj, setCnpj] = useState('')
  const [tipo, setTipo] = useState('')
  const [gestor, setGestor] = useState('')
  const [administrador, setAdministrador] = useState('')
  const [error, setError] = useState('')

  function save() {
    if (!nome.trim() || !cnpj.trim()) { setError('Informe pelo menos o nome e o CNPJ.'); return }
    onSave({ nome: nome.trim(), cnpj: cnpj.trim(), tipo: tipo.trim(), gestor: gestor.trim(), administrador: administrador.trim() })
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-[var(--sur)] border border-[var(--bdr)] rounded-xl w-full max-w-[440px] p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-[15px] font-semibold">Incluir fundo</h2>
          <button onClick={onClose} className="text-[var(--tx3)] hover:text-[var(--tx)]"><X size={18} /></button>
        </div>
        <label className="block text-[10.5px] uppercase text-[var(--tx3)] mb-1">Nome do fundo</label>
        <input value={nome} onChange={(e) => setNome(e.target.value)} className="w-full bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-3 py-2 text-[12.5px] mb-3 outline-none focus:border-id-mid" />
        <label className="block text-[10.5px] uppercase text-[var(--tx3)] mb-1">CNPJ</label>
        <input value={cnpj} onChange={(e) => setCnpj(e.target.value)} placeholder="00.000.000/0000-00" className="w-full bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-3 py-2 text-[12.5px] mb-3 outline-none focus:border-id-mid" />
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-[10.5px] uppercase text-[var(--tx3)] mb-1">Tipo</label>
            <input value={tipo} onChange={(e) => setTipo(e.target.value)} placeholder="FIDC, FI, FII…" className="w-full bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-3 py-2 text-[12.5px] outline-none focus:border-id-mid" />
          </div>
          <div>
            <label className="block text-[10.5px] uppercase text-[var(--tx3)] mb-1">Gestor</label>
            <input value={gestor} onChange={(e) => setGestor(e.target.value)} className="w-full bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-3 py-2 text-[12.5px] outline-none focus:border-id-mid" />
          </div>
        </div>
        <label className="block text-[10.5px] uppercase text-[var(--tx3)] mb-1">Administrador</label>
        <input value={administrador} onChange={(e) => setAdministrador(e.target.value)} className="w-full bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-3 py-2 text-[12.5px] mb-1 outline-none focus:border-id-mid" />
        {error && <p className="text-[11.5px] text-red-500 mt-2">{error}</p>}
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="text-[12.5px] border border-[var(--bdr)] rounded-lg px-4 py-2 text-[var(--tx2)] hover:bg-[var(--sur2)]">Cancelar</button>
          <button onClick={save} className="text-[12.5px] bg-id-dark hover:bg-id-mid text-white rounded-lg px-4 py-2 font-medium">Salvar</button>
        </div>
      </div>
    </div>
  )
}
