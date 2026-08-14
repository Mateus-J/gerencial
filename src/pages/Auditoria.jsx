import { useEffect, useState } from 'react'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { Download, Trash2 } from 'lucide-react'
import { db } from '../lib/firebase'
import { PageHeader, Card } from '../components/PageShell'

const DOC_REF = () => doc(db, 'controle', 'audit_log')

const META = {
  login_ok: { icon: '✅', label: 'Login realizado', color: 'text-id-light' },
  login_fail: { icon: '❌', label: 'Tentativa falha', color: 'text-red-400' },
  logout: { icon: '🚪', label: 'Logout', color: 'text-sky-400' },
  register: { icon: '📝', label: 'Cadastro solicitado', color: 'text-sky-400' },
  approved: { icon: '✔️', label: 'Usuário aprovado', color: 'text-id-light' },
  rejected: { icon: '✖️', label: 'Usuário rejeitado', color: 'text-red-400' },
  pass_change: { icon: '🔑', label: 'Senha alterada', color: 'text-sky-400' },
  pass_fail: { icon: '🔒', label: 'Senha incorreta', color: 'text-red-400' },
  admin_access: { icon: '⚙️', label: 'Acesso ao Admin', color: 'text-sky-400' },
}
const getMeta = (type) => META[type] || { icon: 'ℹ️', label: type, color: 'text-[var(--tx3)]' }

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export default function Auditoria() {
  const [log, setLog] = useState([])
  const [loading, setLoading] = useState(true)
  const [proof, setProof] = useState('')

  useEffect(() => {
    let mounted = true
    getDoc(DOC_REF())
      .then((snap) => { if (mounted && snap.exists()) setLog(snap.data().entries || []) })
      .catch((e) => console.warn('auditLoad err', e))
      .finally(() => mounted && setLoading(false))
    sha256('exemplo123').then((hash) => setProof(hash))
    return () => { mounted = false }
  }, [])

  function clearLog() {
    if (!confirm('Limpar todo o histórico de auditoria?')) return
    setLog([])
    setDoc(DOC_REF(), { entries: [] }, { merge: false }).catch((e) => console.warn('auditClear err', e))
  }

  function exportCSV() {
    let csv = '\uFEFFData/Hora,Ação,Usuário,E-mail,Perfil,Hash SHA-256\n'
    log.forEach((e) => {
      const d = new Date(e.ts).toLocaleString('pt-BR')
      csv += `"${d}","${e.type}","${e.user}","${e.details?.email || ''}","${e.details?.role || ''}","${e.details?.passHash || ''}"\n`
    })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    a.download = 'auditoria_seguranca.csv'
    a.click()
  }

  if (loading) {
    return (
      <div>
        <PageHeader eyebrow="Sistema" title="Auditoria" />
        <Card className="p-10 text-center text-[var(--tx3)]">Carregando…</Card>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        eyebrow="Sistema"
        title="Auditoria"
        actions={
          <>
            <button onClick={exportCSV} className="flex items-center gap-1.5 text-[12px] border border-[var(--bdr)] rounded-lg px-3 py-1.5 text-[var(--tx2)] hover:bg-[var(--sur2)]"><Download size={13} /> Exportar CSV</button>
            <button onClick={clearLog} className="flex items-center gap-1.5 text-[12px] border border-red-500/40 text-red-400 rounded-lg px-3 py-1.5"><Trash2 size={13} /> Limpar log</button>
          </>
        }
      />

      <Card className="p-4 mb-4">
        <div className="text-[11px] font-semibold uppercase text-[var(--tx3)] mb-2">Prova de integridade</div>
        <p className="text-[12px] text-[var(--tx3)] leading-relaxed">
          As senhas são convertidas com <strong className="text-[var(--tx)]">SHA-256</strong> (Web Crypto API — nativa do navegador, sem biblioteca externa).
        </p>
        <div className="mt-2 font-mono text-[11px] bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg p-2.5 break-all">
          Senha: "exemplo123"<br />SHA-256: {proof}
        </div>
        <p className="text-[11px] text-[var(--tx3)] mt-2">O hash armazenado é irreversível. Nem administradores podem ver a senha original.</p>
      </Card>

      <Card>
        {!log.length ? (
          <div className="text-center py-10 text-[var(--tx3)] text-[12px]">Nenhum registro ainda. As ações de autenticação aparecerão aqui.</div>
        ) : (
          <div className="divide-y divide-[var(--bdr)]/60">
            {log.map((entry, i) => {
              const m = getMeta(entry.type)
              const d = new Date(entry.ts)
              return (
                <div key={i} className="flex items-start gap-3 px-4 py-3">
                  <div className="w-8 h-8 rounded-lg bg-[var(--sur2)] flex items-center justify-center text-[14px] shrink-0">{m.icon}</div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px]">
                      {m.label} — <strong>@{entry.user}</strong>
                      <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--sur2)] ${m.color}`}>{m.label}</span>
                    </div>
                    <div className="flex gap-3 text-[11px] text-[var(--tx3)] mt-0.5">
                      <span>📅 {d.toLocaleDateString('pt-BR')} {d.toLocaleTimeString('pt-BR')}</span>
                      {entry.details?.role && <span>👤 Perfil: {entry.details.role}</span>}
                      {entry.details?.email && <span>📧 {entry.details.email}</span>}
                    </div>
                    {entry.details?.passHash && <div className="text-[10.5px] font-mono text-[var(--tx4)] mt-1 break-all">SHA-256: {entry.details.passHash}</div>}
                    {entry.details?.reason && <div className="text-[11px] text-red-400 mt-1">⚠ {entry.details.reason}</div>}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}
