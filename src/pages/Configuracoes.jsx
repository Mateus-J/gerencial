import { useEffect, useRef, useState } from 'react'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { Download, Upload, Copy, Check, Plus, X } from 'lucide-react'
import { db } from '../lib/firebase'
import { PageHeader, Card } from '../components/PageShell'
import { COLABORADORES } from '../hooks/useBoard'

// Todas as coleções 'controle/*' que este app usa — usado no backup completo
const COLLECTIONS = ['saldos_v2', 'taxa_adm', 'portal_saldos', 'multas_juros', 'home_office', 'agenda', 'users', 'audit_log', 'pendencias', 'pendencias_historico', 'fundos_extra']

const FIREBASE_RULES = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Só permite acesso a partir do seu domínio
    match /controle/{document} {
      allow read, write: if request.auth != null
        || request.headers.get("Origin") == "https://gerencial.pages.dev";
    }
    match /{document=**} {
      allow read, write: if true; // temporário — restrinja após configurar Firebase Auth
    }
  }
}`

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}
function genSalt() {
  const arr = new Uint8Array(16); crypto.getRandomValues(arr)
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export default function Configuracoes() {
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [newAdminPass, setNewAdminPass] = useState('')
  const fileRef = useRef(null)

  async function exportBackup() {
    setBusy(true)
    try {
      const bundle = {}
      for (const col of COLLECTIONS) {
        const snap = await getDoc(doc(db, 'controle', col))
        bundle[col] = snap.exists() ? snap.data() : null
      }
      const date = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-')
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `gerencial_backup_${date}.json`
      a.click()
    } catch (e) {
      alert('⚠ Erro ao gerar backup: ' + e.message)
    } finally {
      setBusy(false)
    }
  }

  function importBackup(file) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = async (e) => {
      try {
        const parsed = JSON.parse(e.target.result)
        const keys = Object.keys(parsed).filter((k) => COLLECTIONS.includes(k))
        if (!keys.length) { alert('⚠ Arquivo inválido — nenhuma coleção reconhecida.'); return }
        if (!confirm(`Restaurar backup com ${keys.length} coleções (${keys.join(', ')})? O estado atual será sobrescrito.`)) return
        setBusy(true)
        for (const k of keys) {
          if (parsed[k] != null) await setDoc(doc(db, 'controle', k), parsed[k], { merge: false })
        }
        alert(`✅ ${keys.length} coleções restauradas com sucesso!`)
      } catch (err) {
        alert('⚠ Erro ao ler arquivo: ' + err.message)
      } finally {
        setBusy(false)
      }
    }
    reader.readAsText(file)
  }

  async function setupAdminPass() {
    if (!newAdminPass || newAdminPass.length < 4) { alert('⚠ Senha muito curta (mín. 4 caracteres)'); return }
    const salt = genSalt()
    const hash = await sha256(salt + ':' + newAdminPass)
    await setDoc(doc(db, 'controle', 'admin_tab_pass'), { hash, salt }, { merge: false })
    setNewAdminPass('')
    alert('✅ Senha da aba Configurações atualizada!')
  }

  function copyRules() {
    navigator.clipboard.writeText(FIREBASE_RULES).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div>
      <PageHeader eyebrow="Sistema" title="Configurações" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <div className="text-[11px] font-semibold uppercase text-[var(--tx3)] mb-1">Backup e restauração</div>
          <p className="text-[12px] text-[var(--tx3)] mb-3">Exporta ou restaura todas as coleções do Firestore usadas por este app ({COLLECTIONS.join(', ')}).</p>
          <div className="flex gap-2">
            <button onClick={exportBackup} disabled={busy} className="flex items-center gap-1.5 text-[12px] bg-id-dark hover:bg-id-mid rounded-lg px-3 py-1.5 font-medium disabled:opacity-50">
              <Download size={13} /> Exportar backup
            </button>
            <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={(e) => importBackup(e.target.files[0])} />
            <button onClick={() => fileRef.current?.click()} disabled={busy} className="flex items-center gap-1.5 text-[12px] border border-[var(--bdr)] rounded-lg px-3 py-1.5 text-[var(--tx2)] hover:bg-[var(--sur2)] disabled:opacity-50">
              <Upload size={13} /> Restaurar backup
            </button>
          </div>
          {busy && <p className="text-[11px] text-[var(--tx3)] mt-2">Processando…</p>}
        </Card>

        <Card className="p-4">
          <div className="text-[11px] font-semibold uppercase text-[var(--tx3)] mb-1">Senha da aba Configurações</div>
          <p className="text-[12px] text-[var(--tx3)] mb-3">Protege o acesso a esta página com uma senha própria (hash SHA-256 salted).</p>
          <div className="flex gap-2">
            <input type="password" value={newAdminPass} onChange={(e) => setNewAdminPass(e.target.value)} placeholder="Nova senha" className="flex-1 bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-2.5 py-1.5 text-[12px]" />
            <button onClick={setupAdminPass} className="bg-id-dark hover:bg-id-mid rounded-lg px-3 text-[12px] font-medium">Salvar</button>
          </div>
        </Card>

        <Card className="p-4 lg:col-span-2">
          <div className="flex items-center justify-between mb-1">
            <div className="text-[11px] font-semibold uppercase text-[var(--tx3)]">Regras de segurança do Firestore</div>
            <button onClick={copyRules} className="flex items-center gap-1.5 text-[11px] border border-[var(--bdr)] rounded-lg px-2.5 py-1 text-[var(--tx2)] hover:bg-[var(--sur2)]">
              {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copiado!' : 'Copiar'}
            </button>
          </div>
          <p className="text-[12px] text-[var(--tx3)] mb-2">Cole no console do Firebase em Firestore Database → Regras. Restringe o acesso ao domínio de produção.</p>
          <pre className="bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg p-3 text-[11px] font-mono overflow-x-auto whitespace-pre">{FIREBASE_RULES}</pre>
        </Card>

        <ListManager
          title="Responsáveis (Pendências)"
          description="Lista de nomes disponível no campo Responsável ao criar uma pendência."
          field="responsaveis"
        />
        <ListManager
          title="Ocorrências (Pendências)"
          description="Lista de opções disponível no campo Ocorrência ao criar uma pendência."
          field="ocorrencias"
        />
        <AlertaAtrasoConfig />
        <TarefasColaboradorConfig />
      </div>
    </div>
  )
}

// Cadastra as atividades fixas de cada colaborador — elas viram o checklist
// diário na aba Controle daquela pessoa (marcação reinicia à meia-noite).
function TarefasColaboradorConfig() {
  const [slug, setSlug] = useState(COLABORADORES[0].slug)
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [novo, setNovo] = useState('')

  useEffect(() => {
    let mounted = true
    setLoading(true)
    getDoc(doc(db, 'controle', 'board_' + slug))
      .then((snap) => { if (mounted) setTasks(snap.exists() ? (snap.data().tasks || []) : []) })
      .catch((e) => console.warn('tasksLoad err', e))
      .finally(() => mounted && setLoading(false))
    return () => { mounted = false }
  }, [slug])

  async function persist(next) {
    setTasks(next)
    try {
      const snap = await getDoc(doc(db, 'controle', 'board_' + slug))
      const current = snap.exists() ? snap.data() : {}
      await setDoc(doc(db, 'controle', 'board_' + slug), { ...current, tasks: next }, { merge: false })
    } catch (e) { console.warn('tasksSave err', e) }
  }

  function add() {
    const v = novo.trim()
    if (!v) return
    persist([...tasks, { id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text: v }])
    setNovo('')
  }
  function remove(id) {
    persist(tasks.filter((t) => t.id !== id))
  }

  return (
    <Card className="p-4 lg:col-span-2">
      <div className="text-[11px] font-semibold uppercase text-[var(--tx3)] mb-1">Tarefas por colaborador</div>
      <p className="text-[12px] text-[var(--tx3)] mb-3">Cadastra as atividades fixas de cada pessoa. Elas aparecem como checklist na aba Controle dela, com marcação diária que reinicia à meia-noite.</p>
      <select value={slug} onChange={(e) => setSlug(e.target.value)} className="w-full sm:w-64 bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-2.5 py-1.5 text-[12px] mb-3">
        {COLABORADORES.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
      </select>
      <div className="flex gap-2 mb-3">
        <input value={novo} onChange={(e) => setNovo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="Adicionar atividade…" className="flex-1 bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-2.5 py-1.5 text-[12px]" />
        <button onClick={add} className="flex items-center gap-1 bg-id-dark hover:bg-id-mid rounded-lg px-3 text-[12px]"><Plus size={13} /></button>
      </div>
      {loading ? (
        <p className="text-[11.5px] text-[var(--tx3)]">Carregando…</p>
      ) : !tasks.length ? (
        <p className="text-[11.5px] text-[var(--tx3)]">Nenhuma atividade cadastrada ainda.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {tasks.map((t) => (
            <div key={t.id} className="flex items-center justify-between text-[12px] bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-3 py-1.5">
              {t.text}
              <button onClick={() => remove(t.id)} className="text-[var(--tx4)] hover:text-red-500"><X size={13} /></button>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

// Configura a partir de quantos dias em aberto uma pendência é considerada
// atrasada (destaque vermelho na tabela + KPI de atrasadas no Dashboard).
function AlertaAtrasoConfig() {
  const [dias, setDias] = useState(3)
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let mounted = true
    getDoc(doc(db, 'controle', 'pendencias'))
      .then((snap) => { if (mounted && snap.exists() && snap.data().alertaDias) setDias(snap.data().alertaDias) })
      .catch((e) => console.warn('alertaLoad err', e))
      .finally(() => mounted && setLoading(false))
    return () => { mounted = false }
  }, [])

  async function salvar() {
    try {
      const snap = await getDoc(doc(db, 'controle', 'pendencias'))
      const current = snap.exists() ? snap.data() : {}
      await setDoc(doc(db, 'controle', 'pendencias'), { ...current, alertaDias: Number(dias) || 3 }, { merge: false })
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    } catch (e) { console.warn('alertaSave err', e) }
  }

  return (
    <Card className="p-4">
      <div className="text-[11px] font-semibold uppercase text-[var(--tx3)] mb-1">Alerta de pendência atrasada</div>
      <p className="text-[12px] text-[var(--tx3)] mb-3">A partir de quantos dias em aberto uma pendência é destacada em vermelho na tabela e contada no KPI "Atrasadas".</p>
      <div className="flex items-center gap-2">
        <input type="number" min="1" disabled={loading} value={dias} onChange={(e) => setDias(e.target.value)} className="w-20 bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-2.5 py-1.5 text-[12px]" />
        <span className="text-[12px] text-[var(--tx3)]">dias</span>
        <button onClick={salvar} className="text-[12px] bg-id-dark hover:bg-id-mid text-white rounded-lg px-3 py-1.5 font-medium ml-2">{saved ? 'Salvo!' : 'Salvar'}</button>
      </div>
    </Card>
  )
}

// Gerencia uma lista simples (array de strings) dentro do doc controle/pendencias,
// sem mexer nos outros campos do documento (items, etc.)
function ListManager({ title, description, field }) {
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const [novo, setNovo] = useState('')

  useEffect(() => {
    let mounted = true
    getDoc(doc(db, 'controle', 'pendencias'))
      .then((snap) => { if (mounted && snap.exists()) setList(snap.data()[field] || []) })
      .catch((e) => console.warn('listLoad err', e))
      .finally(() => mounted && setLoading(false))
    return () => { mounted = false }
  }, [field])

  async function persist(next) {
    setList(next)
    try {
      const snap = await getDoc(doc(db, 'controle', 'pendencias'))
      const current = snap.exists() ? snap.data() : {}
      await setDoc(doc(db, 'controle', 'pendencias'), { ...current, [field]: next }, { merge: false })
    } catch (e) { console.warn('listSave err', e) }
  }

  function add() {
    const v = novo.trim()
    if (!v || list.includes(v)) return
    persist([...list, v])
    setNovo('')
  }
  function remove(v) {
    persist(list.filter((x) => x !== v))
  }

  return (
    <Card className="p-4">
      <div className="text-[11px] font-semibold uppercase text-[var(--tx3)] mb-1">{title}</div>
      <p className="text-[12px] text-[var(--tx3)] mb-3">{description}</p>
      <div className="flex gap-2 mb-3">
        <input value={novo} onChange={(e) => setNovo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="Adicionar novo item…" className="flex-1 bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-2.5 py-1.5 text-[12px]" />
        <button onClick={add} className="flex items-center gap-1 bg-id-dark hover:bg-id-mid rounded-lg px-3 text-[12px]"><Plus size={13} /></button>
      </div>
      {loading ? (
        <p className="text-[11.5px] text-[var(--tx3)]">Carregando…</p>
      ) : !list.length ? (
        <p className="text-[11.5px] text-[var(--tx3)]">Nenhum item cadastrado ainda.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {list.map((v) => (
            <span key={v} className="flex items-center gap-1 text-[11.5px] bg-[var(--sur2)] border border-[var(--bdr)] rounded-full pl-2.5 pr-1.5 py-1">
              {v}
              <button onClick={() => remove(v)} className="text-[var(--tx4)] hover:text-red-500"><X size={11} /></button>
            </span>
          ))}
        </div>
      )}
    </Card>
  )
}
