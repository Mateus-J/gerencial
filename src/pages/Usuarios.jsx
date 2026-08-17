import { useEffect, useState } from 'react'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { UserPlus, ShieldCheck, RotateCcw } from 'lucide-react'
import { db } from '../lib/firebase'
import { PageHeader, Card } from '../components/PageShell'
import { genSecret } from '../lib/totp'
import { clearTwoFAFlag } from '../context/AuthContext'
import { useToast } from '../components/Toast'
import { COLABORADORES, slugify } from '../hooks/useBoard'

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
  const toast = useToast()
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
    setDoc(DOC_REF(), { users: next, updatedAt: Date.now() }, { merge: false }).catch((e) => { console.warn('usersSave err', e); toast.error('Erro ao salvar: ' + e.message) })
  }

  async function addUser() {
    const { user, name, email, pass, role } = nu
    if (!user || !name || !pass) { toast.error('Preencha usuário, nome e senha.'); return }
    if (users[user]) { toast.error('Usuário já existe.'); return }
    const salt = genSalt()
    const passHash = await hashPass(pass, salt)
    // Se o nome bater com um dos colaboradores fixos (André Castro, etc.),
    // já vincula ao quadro dele automaticamente — evita ficar sem "Atividades do dia".
    const matched = COLABORADORES.find((c) => c.slug === slugify(name))
    persist({ ...users, [user]: { pass: passHash, salt, name, email, role, ...(matched ? { boardSlug: matched.slug } : {}) } })
    setNu({ user: '', name: '', email: '', pass: '', role: 'user' })
    toast.success(`Usuário @${user} adicionado com sucesso!${matched ? ` Vinculado ao quadro de ${matched.name}.` : ''}`)
  }
  function removeUser(key) {
    if (!confirm('Remover usuário @' + key + '?')) return
    const next = { ...users }; delete next[key]
    persist(next)
    toast.success(`Usuário @${key} removido.`)
  }
  function updateField(key, field, value) {
    persist({ ...users, [key]: { ...users[key], [field]: value } })
    if (field === 'role' && value !== 'pending') toast.success(`@${key} aprovado como ${ROLE_LABEL[value] || value}.`)
    if (field === 'acessoInicio' || field === 'acessoFim') toast.success('Horário de acesso atualizado.')
    if (field === 'boardSlug') {
      const label = COLABORADORES.find((c) => c.slug === value)?.name
      toast.success(label ? `@${key} vinculado ao quadro de ${label}.` : `@${key} agora usa o quadro próprio.`)
    }
  }
  async function updatePass(key, newPass) {
    if (!newPass) return
    const salt = genSalt()
    const passHash = await hashPass(newPass, salt)
    persist({ ...users, [key]: { ...users[key], pass: passHash, salt } })
    toast.success(`Senha de @${key} atualizada.`)
  }
  function toggle2FA(key, enabled) {
    const u = users[key]
    // Gera o segredo na primeira vez que ativa; ao desativar, mantém o
    // segredo salvo (se reativar sem "resetar", não precisa escanear de novo).
    const secret = u.totpSecret || genSecret()
    persist({ ...users, [key]: { ...u, totpEnabled: enabled, totpSecret: secret } })
    clearTwoFAFlag(key)
    toast.success(enabled ? `2FA ativado para @${key}.` : `2FA desativado para @${key}.`)
  }
  function reset2FA(key) {
    if (!confirm('Resetar 2FA de @' + key + '? A pessoa vai precisar escanear um novo QR code no próximo login.')) return
    const u = users[key]
    persist({ ...users, [key]: { ...u, totpSecret: genSecret(), totpConfirmed: false } })
    clearTwoFAFlag(key)
    toast.success('2FA resetado com sucesso!')
  }

  if (loading) {
    return (
      <div>
        <PageHeader eyebrow="Equipe" title="Usuários" />
        <Card className="p-10 text-center text-[var(--tx3)]">Carregando…</Card>
      </div>
    )
  }

  const pending = Object.entries(users).filter(([, u]) => u.role === 'pending')

  return (
    <div>
      <PageHeader eyebrow="Equipe" title="Usuários" />
      <p className="text-[11.5px] text-[var(--tx3)] -mt-2 mb-4">2FA usa um app autenticador (Google Authenticator, Microsoft Authenticator, Authy…) — a pessoa configura escaneando um QR code no primeiro login e só precisa digitar o código de novo 1x por dia, no mesmo aparelho. Horário permitido em branco = sem restrição. "Quadro vinculado" conecta o login da pessoa ao quadro fixo dela (o mesmo que aparece em Controle na sua sidebar) — sem isso, "Meu Quadro" e as Atividades do dia dela ficam vazios, mesmo que você já tenha cadastrado atividades para ela.</p>

      {pending.length > 0 && (
        <Card className="mb-4 border-amber-500/40">
          <div className="p-3 border-b border-[var(--bdr)]">
            <span className="text-[11px] font-semibold uppercase text-amber-400">Cadastros pendentes ({pending.length})</span>
          </div>
          <div className="divide-y divide-[var(--bdr)]/60">
            {pending.map(([key, u]) => (
              <div key={key} className="flex items-center gap-3 px-4 py-2.5">
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] font-medium">{u.name} <span className="text-[10.5px] text-[var(--tx3)]">@{key}</span></div>
                  <div className="text-[11px] text-[var(--tx3)]">{u.email || '—'}</div>
                </div>
                <button onClick={() => updateField(key, 'role', 'user')} className="text-[11px] bg-id-dark hover:bg-id-mid rounded-lg px-2.5 py-1">Aprovar como Equipe</button>
                <button onClick={() => removeUser(key)} className="text-[11px] border border-red-500/40 text-red-400 rounded-lg px-2.5 py-1">Rejeitar</button>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="mb-4">
        <div className="p-3 border-b border-[var(--bdr)] flex items-center justify-between">
          <span className="text-[12px] text-[var(--tx3)]">{Object.keys(users).length} usuários</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10.5px] uppercase tracking-wider text-[var(--tx3)] border-b border-[var(--bdr)]">
                <th className="px-3 py-2.5 font-medium">Usuário</th>
                <th className="px-3 py-2.5 font-medium">Nome</th>
                <th className="px-3 py-2.5 font-medium">E-mail</th>
                <th className="px-3 py-2.5 font-medium">Perfil</th>
                <th className="px-3 py-2.5 font-medium">Quadro vinculado</th>
                <th className="px-3 py-2.5 font-medium">Senha</th>
                <th className="px-3 py-2.5 font-medium">2FA</th>
                <th className="px-3 py-2.5 font-medium">Horário permitido</th>
                <th className="px-3 py-2.5 font-medium">Lembrete pendências</th>
                <th className="px-3 py-2.5 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {!Object.keys(users).length ? (
                <tr><td colSpan={10} className="text-center py-8 text-[var(--tx3)]">Nenhum usuário cadastrado ainda.</td></tr>
              ) : Object.entries(users).map(([key, u]) => (
                <tr key={key} className="border-b border-[var(--bdr)]/60 text-[12.5px]">
                  <td className="px-3 py-2 font-medium">@{key}</td>
                  <td className="px-3 py-2"><input defaultValue={u.name} onBlur={(e) => updateField(key, 'name', e.target.value)} className="bg-transparent border-b border-transparent focus:border-[var(--bdr)] outline-none w-[130px]" /></td>
                  <td className="px-3 py-2"><input defaultValue={u.email || ''} onBlur={(e) => updateField(key, 'email', e.target.value)} placeholder="email@…" className="bg-transparent border-b border-transparent focus:border-[var(--bdr)] outline-none w-[160px]" /></td>
                  <td className="px-3 py-2">
                    <select defaultValue={u.role} onChange={(e) => updateField(key, 'role', e.target.value)} className="bg-[var(--sur2)] border border-[var(--bdr)] rounded-md px-1.5 py-1 text-[11px]">
                      {u.role === 'pending' && <option value="pending">Pendente</option>}
                      <option value="admin">Administrador</option>
                      <option value="user">Equipe</option>
                      <option value="consulta">Consulta</option>
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      defaultValue={u.boardSlug || ''}
                      onChange={(e) => updateField(key, 'boardSlug', e.target.value)}
                      className="bg-[var(--sur2)] border border-[var(--bdr)] rounded-md px-1.5 py-1 text-[11px] max-w-[150px]"
                    >
                      <option value="">— Quadro próprio —</option>
                      {COLABORADORES.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2"><input type="password" placeholder="Nova senha…" onBlur={(e) => e.target.value && updatePass(key, e.target.value)} className="bg-[var(--sur2)] border border-[var(--bdr)] rounded-md px-1.5 py-1 text-[11px] w-[110px]" /></td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" checked={!!u.totpEnabled} onChange={(e) => toggle2FA(key, e.target.checked)} className="sr-only peer" />
                        <span className="w-8 h-4 bg-[var(--sur2)] border border-[var(--bdr)] rounded-full peer-checked:bg-id-mid transition-colors" />
                        <span className="absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform peer-checked:translate-x-4" />
                      </label>
                      {u.totpEnabled && (
                        <>
                          {u.totpConfirmed ? (
                            <ShieldCheck size={13} className="text-id-light" title="2FA configurado" />
                          ) : (
                            <span className="text-[9.5px] text-amber-400" title="Ainda não configurou no app autenticador">pendente</span>
                          )}
                          <button type="button" onClick={() => reset2FA(key)} title="Resetar 2FA (gera novo QR code)" className="text-[var(--tx4)] hover:text-red-400">
                            <RotateCcw size={12} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      <input type="time" defaultValue={u.acessoInicio || ''} onBlur={(e) => updateField(key, 'acessoInicio', e.target.value)} className="bg-[var(--sur2)] border border-[var(--bdr)] rounded-md px-1 py-1 text-[11px] w-[78px]" />
                      <span className="text-[var(--tx4)] text-[11px]">–</span>
                      <input type="time" defaultValue={u.acessoFim || ''} onBlur={(e) => updateField(key, 'acessoFim', e.target.value)} className="bg-[var(--sur2)] border border-[var(--bdr)] rounded-md px-1 py-1 text-[11px] w-[78px]" />
                    </div>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" checked={!!u.notifPendencias} onChange={(e) => updateField(key, 'notifPendencias', e.target.checked)} className="sr-only peer" />
                      <span className="w-8 h-4 bg-[var(--sur2)] border border-[var(--bdr)] rounded-full peer-checked:bg-id-mid transition-colors" />
                      <span className="absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform peer-checked:translate-x-4" />
                    </label>
                  </td>
                  <td className="px-3 py-2"><button onClick={() => removeUser(key)} className="text-[11px] text-red-400 border border-red-500/30 rounded-md px-2 py-0.5">Remover</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="p-3 border-t border-[var(--bdr)] flex flex-wrap gap-2 items-center">
          <input value={nu.user} onChange={(e) => setNu({ ...nu, user: e.target.value.toLowerCase() })} placeholder="usuário" className="bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-2 py-1.5 text-[12px] w-[110px]" />
          <input value={nu.name} onChange={(e) => setNu({ ...nu, name: e.target.value })} placeholder="nome" className="bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-2 py-1.5 text-[12px] w-[140px]" />
          <input value={nu.email} onChange={(e) => setNu({ ...nu, email: e.target.value })} placeholder="email" className="bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-2 py-1.5 text-[12px] w-[160px]" />
          <input type="password" value={nu.pass} onChange={(e) => setNu({ ...nu, pass: e.target.value })} placeholder="senha" className="bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-2 py-1.5 text-[12px] w-[110px]" />
          <select value={nu.role} onChange={(e) => setNu({ ...nu, role: e.target.value })} className="bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-2 py-1.5 text-[12px]">
            <option value="admin">Administrador</option>
            <option value="user">Equipe</option>
            <option value="consulta">Consulta</option>
          </select>
          <button onClick={addUser} className="flex items-center gap-1.5 bg-id-dark hover:bg-id-mid rounded-lg px-3 py-1.5 text-[12px] font-medium"><UserPlus size={13} /> Adicionar</button>
        </div>
      </Card>

      <Card className="p-4">
        <div className="text-[11px] font-semibold uppercase text-[var(--tx3)] mb-3">Permissões por perfil</div>
        <div className="grid grid-cols-[1fr_1fr_60px_60px_60px] gap-2 text-[10px] uppercase text-[var(--tx3)] mb-1 px-1">
          <div>Ação</div><div>Descrição</div><div className="text-center">Admin</div><div className="text-center">Equipe</div><div className="text-center">Consulta</div>
        </div>
        {PERMS.map((p) => (
          <div key={p.action} className="grid grid-cols-[1fr_1fr_60px_60px_60px] gap-2 text-[12px] py-1.5 border-t border-[var(--bdr)]/60 items-center px-1">
            <div>{p.action}</div>
            <div className="text-[var(--tx3)] text-[11px]">{p.desc}</div>
            <div className="text-center">{p.admin ? <span className="text-id-light">✓</span> : <span className="text-[var(--tx4)]">—</span>}</div>
            <div className="text-center">{p.user ? <span className="text-id-light">✓</span> : <span className="text-[var(--tx4)]">—</span>}</div>
            <div className="text-center">{p.consulta ? <span className="text-id-light">✓</span> : <span className="text-[var(--tx4)]">—</span>}</div>
          </div>
        ))}
      </Card>
    </div>
  )
}
