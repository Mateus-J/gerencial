import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const { login, register } = useAuth()
  const [mode, setMode] = useState('login') // login | register
  const [showPass, setShowPass] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // login
  const [user, setUser] = useState('')
  const [pass, setPass] = useState('')

  // register
  const [rName, setRName] = useState('')
  const [rUser, setRUser] = useState('')
  const [rEmail, setREmail] = useState('')
  const [rPass, setRPass] = useState('')

  async function handleLogin(e) {
    e.preventDefault()
    if (!user || !pass) { setError('Preencha usuário e senha.'); return }
    setBusy(true); setError('')
    const res = await login(user, pass)
    setBusy(false)
    if (!res.ok) setError(res.error)
  }

  async function handleRegister(e) {
    e.preventDefault()
    if (!rUser || !rName || !rPass) { setError('Preencha todos os campos.'); return }
    setBusy(true); setError('')
    const res = await register({ username: rUser, name: rName, email: rEmail, pass: rPass })
    setBusy(false)
    if (!res.ok) setError(res.error)
  }

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-[var(--bg)]">
      <div className="w-full max-w-[380px] px-6">
        <div className="flex items-center gap-2.5 justify-center mb-8">
          <div className="w-9 h-9 rounded-lg bg-id-dark flex items-center justify-center text-white text-[13px] font-bold">ID</div>
          <span className="font-display font-semibold text-[17px]">Gerencial</span>
        </div>

        <div className="bg-[var(--sur)] border border-[var(--bdr)] rounded-xl p-6 shadow-card">
          {mode === 'login' ? (
            <form onSubmit={handleLogin}>
              <h1 className="font-display text-[16px] font-semibold mb-1">Entrar</h1>
              <p className="text-[12px] text-[var(--tx3)] mb-5">Acesse com seu usuário ou e-mail cadastrado.</p>

              <label className="block text-[11px] text-[var(--tx3)] mb-1">Usuário ou e-mail</label>
              <input value={user} onChange={(e) => setUser(e.target.value)} className="w-full bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-3 py-2 text-[13px] mb-3 outline-none focus:border-id-mid" autoFocus />

              <label className="block text-[11px] text-[var(--tx3)] mb-1">Senha</label>
              <div className="relative mb-1">
                <input type={showPass ? 'text' : 'password'} value={pass} onChange={(e) => setPass(e.target.value)} className="w-full bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-id-mid pr-9" />
                <button type="button" onClick={() => setShowPass((s) => !s)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--tx3)]">
                  {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>

              {error && <p className="text-[11.5px] text-red-400 mt-2">{error}</p>}

              <button disabled={busy} type="submit" className="w-full bg-id-dark hover:bg-id-mid rounded-lg py-2.5 text-[13px] font-medium mt-4 disabled:opacity-50">
                {busy ? 'Entrando…' : 'Entrar'}
              </button>

              <button type="button" onClick={() => { setMode('register'); setError('') }} className="w-full text-[12px] text-[var(--tx3)] hover:text-[var(--tx2)] mt-3">
                Não tem conta? <span className="text-id-light">Cadastre-se</span>
              </button>
            </form>
          ) : (
            <form onSubmit={handleRegister}>
              <h1 className="font-display text-[16px] font-semibold mb-1">Solicitar acesso</h1>
              <p className="text-[12px] text-[var(--tx3)] mb-5">Seu cadastro fica pendente até um administrador aprovar.</p>

              <label className="block text-[11px] text-[var(--tx3)] mb-1">Nome completo</label>
              <input value={rName} onChange={(e) => setRName(e.target.value)} className="w-full bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-3 py-2 text-[13px] mb-3 outline-none focus:border-id-mid" />

              <label className="block text-[11px] text-[var(--tx3)] mb-1">Usuário</label>
              <input value={rUser} onChange={(e) => setRUser(e.target.value.toLowerCase())} className="w-full bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-3 py-2 text-[13px] mb-3 outline-none focus:border-id-mid" />

              <label className="block text-[11px] text-[var(--tx3)] mb-1">E-mail</label>
              <input type="email" value={rEmail} onChange={(e) => setREmail(e.target.value)} className="w-full bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-3 py-2 text-[13px] mb-3 outline-none focus:border-id-mid" />

              <label className="block text-[11px] text-[var(--tx3)] mb-1">Senha</label>
              <input type="password" value={rPass} onChange={(e) => setRPass(e.target.value)} className="w-full bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-3 py-2 text-[13px] mb-1 outline-none focus:border-id-mid" />

              {error && <p className="text-[11.5px] text-red-400 mt-2">{error}</p>}

              <button disabled={busy} type="submit" className="w-full bg-id-dark hover:bg-id-mid rounded-lg py-2.5 text-[13px] font-medium mt-4 disabled:opacity-50">
                {busy ? 'Enviando…' : 'Solicitar acesso'}
              </button>

              <button type="button" onClick={() => { setMode('login'); setError('') }} className="w-full text-[12px] text-[var(--tx3)] hover:text-[var(--tx2)] mt-3">
                Já tem conta? <span className="text-id-light">Entrar</span>
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
