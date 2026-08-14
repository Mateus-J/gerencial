import { useEffect, useState } from 'react'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { UserPlus } from 'lucide-react'
import { db } from '../lib/firebase'
import { PageHeader, Card } from '../components/PageShell'

const DOC_REF = () => doc(db, 'controle', 'users')
const ROLE_LABEL = { admin: 'Administrador', user: 'Equipe', consulta: 'Consulta' }
const PERMS = [
  { action: 'Visualizar dados', desc: 'Ver grupos, linhas e colunas', admin: true, user: true, consulta: true },
  { action: 'Editar células', desc: 'Modificar valores nas linhas', admin: true, user: true, consulta: false },
  { action: 'Adicionar linhas', desc: 'Criar novas linhas nos grupos', admin: true, user: true, consulta: false },
  { action: 'Remover linhas', desc: 'Excluir linhas existentes', admin: true, user: true, consulta: false },
  { action: 'Adicionar grupos', desc: 'Criar novos grupos', admin: true, user: true, consulta: false },
  { action: 'Remover grupos', desc: 'Excluir grupos', admin: true, user: false, consulta: false },
  { action: 'Gerenciar colunas', desc: 'Adicionar/remover/reordenar colunas', admin: true, user: false, consulta: false },
  { action: 'Criar/remover abas', desc: 'Adicionar ou excluir abas', admin: true, user: false, consulta: false },
  { action: 'Exportar relatório', desc: 'Baixar CSV dos dados', admin: true, user: true, consulta: true },
  { action: 'Painel de usuários', desc: 'Gerenciar usuários e permissões', admin: true, user: false, consulta: false },
]

// Mesma estratégia de hash do app antigo: SHA-256 com salt aleatório por usuário
async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}
async function hashPass(pass, salt) { return salt ? sha256(salt + ':' + pass) : sha256(pass) }
function genSalt() {
  const arr = new Uint8Array(16); crypto.getRandomValues(arr)
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export default function Usuarios() {
  const [users, setUsers] = useState({})
  const [loading, setLoading] = useState(true)
  const [nu, setNu] = useState({ user: '', name: '', email: '', pass: '', role: 'user' })

  useEffect(() => {
    let mounted = true
    getDoc(DOC_REF())
      .then((snap) => { if (mounted && snap.exists()) setUsers(snap.data().users || {}) })
      .catch((e) => console.warn('usersLoad err', e))
      .finally(() => mounted && setLoading(false))
    return () => { mounted = false }
  }, [])

  function persist(next) {
    setUsers(next)
    setDoc(DOC_REF(), { users: next, updatedAt: Date.now() }, { merge: false }).catch((e) => console.warn('usersSave err', e))
  }

  async function addUser() {
    const { user, name, email, pass, role } = nu
    if (!user || !name || !pass) { alert('⚠️ Preencha usuário, nome e senha'); return }
    if (users[user]) { alert('⚠️ Usuário já existe'); return }
    const salt = genSalt()
    const passHash = await hashPass(pass, salt)
    persist({ ...users, [user]: { pass: passHash, salt, name, email, role } })
    setNu({ user: '', name: '', email: '', pass: '', role: 'user' })
  }
  function removeUser(key) {
    if (!confirm('Remover usuário @' + key + '?')) return
    const next = { ...users }; delete next[key]
    persist(next)
  }
  function updateField(key, field, value) {
    persist({ ...users, [key]: { ...users[key], [field]: value } })
  }
  async function updatePass(key, newPass) {
    if (!newPass) return
    const salt = genSalt()
    const passHash = await hashPass(newPass, salt)
    persist({ ...users, [key]: { ...users[key], pass: passHash, salt } })
  }

  if (loading) {
    return (
      <div>
        <PageHeader eyebrow="Equipe" title="Usuários" />
        <Card className="p-10 text-center text-slate-500">Carregando…</Card>
      </div>
    )
  }

  return (
    <div>
      <PageHeader eyebrow="Equipe" title="Usuários" />

      <Card className="mb-4">
        <div className="p-3 border-b border-bg-border flex items-center justify-between">
          <span className="text-[12px] text-slate-400">{Object.keys(users).length} usuários</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10.5px] uppercase tracking-wider text-slate-500 border-b border-bg-border">
                <th className="px-3 py-2.5 font-medium">Usuário</th>
                <th className="px-3 py-2.5 font-medium">Nome</th>
                <th className="px-3 py-2.5 font-medium">E-mail</th>
                <th className="px-3 py-2.5 font-medium">Perfil</th>
                <th className="px-3 py-2.5 font-medium">Senha</th>
                <th className="px-3 py-2.5 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {!Object.keys(users).length ? (
                <tr><td colSpan={6} className="text-center py-8 text-slate-500">Nenhum usuário cadastrado ainda.</td></tr>
              ) : Object.entries(users).map(([key, u]) => (
                <tr key={key} className="border-b border-bg-border/60 text-[12.5px]">
                  <td className="px-3 py-2 font-medium">@{key}</td>
                  <td className="px-3 py-2"><input defaultValue={u.name} onBlur={(e) => updateField(key, 'name', e.target.value)} className="bg-transparent border-b border-transparent focus:border-bg-border outline-none w-[130px]" /></td>
                  <td className="px-3 py-2"><input defaultValue={u.email || ''} onBlur={(e) => updateField(key, 'email', e.target.value)} placeholder="email@…" className="bg-transparent border-b border-transparent focus:border-bg-border outline-none w-[160px]" /></td>
                  <td className="px-3 py-2">
                    <select defaultValue={u.role} onChange={(e) => updateField(key, 'role', e.target.value)} className="bg-bg-panel2 border border-bg-border rounded-md px-1.5 py-1 text-[11px]">
                      <option value="admin">Administrador</option>
                      <option value="user">Equipe</option>
                      <option value="consulta">Consulta</option>
                    </select>
                  </td>
                  <td className="px-3 py-2"><input type="password" placeholder="Nova senha…" onBlur={(e) => e.target.value && updatePass(key, e.target.value)} className="bg-bg-panel2 border border-bg-border rounded-md px-1.5 py-1 text-[11px] w-[110px]" /></td>
                  <td className="px-3 py-2"><button onClick={() => removeUser(key)} className="text-[11px] text-red-400 border border-red-500/30 rounded-md px-2 py-0.5">Remover</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="p-3 border-t border-bg-border flex flex-wrap gap-2 items-center">
          <input value={nu.user} onChange={(e) => setNu({ ...nu, user: e.target.value.toLowerCase() })} placeholder="usuário" className="bg-bg-panel2 border border-bg-border rounded-lg px-2 py-1.5 text-[12px] w-[110px]" />
          <input value={nu.name} onChange={(e) => setNu({ ...nu, name: e.target.value })} placeholder="nome" className="bg-bg-panel2 border border-bg-border rounded-lg px-2 py-1.5 text-[12px] w-[140px]" />
          <input value={nu.email} onChange={(e) => setNu({ ...nu, email: e.target.value })} placeholder="email" className="bg-bg-panel2 border border-bg-border rounded-lg px-2 py-1.5 text-[12px] w-[160px]" />
          <input type="password" value={nu.pass} onChange={(e) => setNu({ ...nu, pass: e.target.value })} placeholder="senha" className="bg-bg-panel2 border border-bg-border rounded-lg px-2 py-1.5 text-[12px] w-[110px]" />
          <select value={nu.role} onChange={(e) => setNu({ ...nu, role: e.target.value })} className="bg-bg-panel2 border border-bg-border rounded-lg px-2 py-1.5 text-[12px]">
            <option value="admin">Administrador</option>
            <option value="user">Equipe</option>
            <option value="consulta">Consulta</option>
          </select>
          <button onClick={addUser} className="flex items-center gap-1.5 bg-id-dark hover:bg-id-mid rounded-lg px-3 py-1.5 text-[12px] font-medium"><UserPlus size={13} /> Adicionar</button>
        </div>
      </Card>

      <Card className="p-4">
        <div className="text-[11px] font-semibold uppercase text-slate-500 mb-3">Permissões por perfil</div>
        <div className="grid grid-cols-[1fr_1fr_60px_60px_60px] gap-2 text-[10px] uppercase text-slate-500 mb-1 px-1">
          <div>Ação</div><div>Descrição</div><div className="text-center">Admin</div><div className="text-center">Equipe</div><div className="text-center">Consulta</div>
        </div>
        {PERMS.map((p) => (
          <div key={p.action} className="grid grid-cols-[1fr_1fr_60px_60px_60px] gap-2 text-[12px] py-1.5 border-t border-bg-border/60 items-center px-1">
            <div>{p.action}</div>
            <div className="text-slate-500 text-[11px]">{p.desc}</div>
            <div className="text-center">{p.admin ? <span className="text-id-light">✓</span> : <span className="text-slate-600">—</span>}</div>
            <div className="text-center">{p.user ? <span className="text-id-light">✓</span> : <span className="text-slate-600">—</span>}</div>
            <div className="text-center">{p.consulta ? <span className="text-id-light">✓</span> : <span className="text-slate-600">—</span>}</div>
          </div>
        ))}
      </Card>
    </div>
  )
}
