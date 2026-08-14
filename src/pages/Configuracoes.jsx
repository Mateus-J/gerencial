import { useEffect, useRef, useState } from 'react'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { Download, Upload, Copy, Check } from 'lucide-react'
import { db } from '../lib/firebase'
import { PageHeader, Card } from '../components/PageShell'

// Todas as coleções 'controle/*' que este app usa — usado no backup completo
const COLLECTIONS = ['saldos_v2', 'taxa_adm', 'portal_saldos', 'multas_juros', 'home_office', 'agenda', 'users', 'audit_log']

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
          <div className="text-[11px] font-semibold uppercase text-slate-500 mb-1">Backup e restauração</div>
          <p className="text-[12px] text-slate-500 mb-3">Exporta ou restaura todas as coleções do Firestore usadas por este app ({COLLECTIONS.join(', ')}).</p>
          <div className="flex gap-2">
            <button onClick={exportBackup} disabled={busy} className="flex items-center gap-1.5 text-[12px] bg-id-dark hover:bg-id-mid rounded-lg px-3 py-1.5 font-medium disabled:opacity-50">
              <Download size={13} /> Exportar backup
            </button>
            <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={(e) => importBackup(e.target.files[0])} />
            <button onClick={() => fileRef.current?.click()} disabled={busy} className="flex items-center gap-1.5 text-[12px] border border-bg-border rounded-lg px-3 py-1.5 text-slate-300 hover:bg-bg-panel2 disabled:opacity-50">
              <Upload size={13} /> Restaurar backup
            </button>
          </div>
          {busy && <p className="text-[11px] text-slate-500 mt-2">Processando…</p>}
        </Card>

        <Card className="p-4">
          <div className="text-[11px] font-semibold uppercase text-slate-500 mb-1">Senha da aba Configurações</div>
          <p className="text-[12px] text-slate-500 mb-3">Protege o acesso a esta página com uma senha própria (hash SHA-256 salted).</p>
          <div className="flex gap-2">
            <input type="password" value={newAdminPass} onChange={(e) => setNewAdminPass(e.target.value)} placeholder="Nova senha" className="flex-1 bg-bg-panel2 border border-bg-border rounded-lg px-2.5 py-1.5 text-[12px]" />
            <button onClick={setupAdminPass} className="bg-id-dark hover:bg-id-mid rounded-lg px-3 text-[12px] font-medium">Salvar</button>
          </div>
        </Card>

        <Card className="p-4 lg:col-span-2">
          <div className="flex items-center justify-between mb-1">
            <div className="text-[11px] font-semibold uppercase text-slate-500">Regras de segurança do Firestore</div>
            <button onClick={copyRules} className="flex items-center gap-1.5 text-[11px] border border-bg-border rounded-lg px-2.5 py-1 text-slate-300 hover:bg-bg-panel2">
              {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copiado!' : 'Copiar'}
            </button>
          </div>
          <p className="text-[12px] text-slate-500 mb-2">Cole no console do Firebase em Firestore Database → Regras. Restringe o acesso ao domínio de produção.</p>
          <pre className="bg-bg-panel2 border border-bg-border rounded-lg p-3 text-[11px] font-mono overflow-x-auto whitespace-pre">{FIREBASE_RULES}</pre>
        </Card>
      </div>
    </div>
  )
}
