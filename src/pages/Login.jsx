import { useEffect, useState } from 'react'
import { Eye, EyeOff, ShieldCheck } from 'lucide-react'
import QRCode from 'qrcode'
import { useAuth, consumeLogoutReason } from '../context/AuthContext'
import { otpAuthUrl } from '../lib/totp'
import logoId from '../assets/logo-id.png'

export default function Login() {
  const { login, register } = useAuth()
  const [mode, setMode] = useState('login') // login | register | twofa-setup | twofa-verify
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

  // 2FA
  const [pending, setPending] = useState(null) // { secret, label } — só na primeira configuração do 2FA
  const [code, setCode] = useState('')
  const [qrUrl, setQrUrl] = useState('')
  const [logoutReason, setLogoutReason] = useState(null)

  useEffect(() => {
    const r = consumeLogoutReason()
    if (r) setLogoutReason(r)
  }, [])

  useEffect(() => {
    if (mode === 'twofa-setup' && pending?.secret) {
      const url = otpAuthUrl(pending.secret, pending.label || user)
      QRCode.toDataURL(url, { margin: 1, width: 200 }).then(setQrUrl).catch(() => setQrUrl(''))
    }
  }, [mode, pending, user])

  async function handleLogin(e) {
    e.preventDefault()
    if (!user || !pass) { setError('Preencha usuário e senha.'); return }
    setBusy(true); setError('')
    const res = await login(user, pass)
    setBusy(false)
    if (!res.ok) { setError(res.error); return }
    if (res.needs2FA) {
      setPending(res.setup ? { secret: res.secret, label: res.label } : null)
      setCode('')
      setMode(res.setup ? 'twofa-setup' : 'twofa-verify')
    }
  }

  async function handleVerify2FA(e) {
    e.preventDefault()
    if (!/^\d{6}$/.test(code.trim())) { setError('Digite os 6 dígitos do app autenticador.'); return }
    setBusy(true); setError('')
    const res = await login(user, pass, code.trim())
    setBusy(false)
    if (!res.ok) { setError(res.error); if (!res.needs2FA) { setMode('login'); setCode('') } }
  }

  async function handleRegister(e) {
    e.preventDefault()
    if (!rUser || !rName || !rPass) { setError('Preencha todos os campos.'); return }
    if (rPass.length < 8) { setError('A senha precisa ter pelo menos 8 caracteres.'); return }
    setBusy(true); setError('')
    const res = await register({ username: rUser, name: rName, email: rEmail, pass: rPass })
    setBusy(false)
    if (!res.ok) setError(res.error)
  }

  return (
    <div className="h-screen w-screen flex items-center justify-center">
      <div className="w-full max-w-[380px] px-6">
        <div className="flex flex-col items-center gap-3 mb-8">
          <div className="relative w-14 h-14 rounded-2xl glass flex items-center justify-center">
            <div className="absolute inset-0 rounded-2xl bg-id-light/20 blur-xl" />
            <img src={logoId} alt="ID" className="relative w-8 h-8 object-contain" />
          </div>
          <div className="text-center">
            <div className="font-display font-semibold text-[19px] tracking-tight">Gerencial Liquidação</div>
            <div className="text-[10.5px] font-mono uppercase tracking-[.25em] text-[var(--tx3)] mt-1">ID · Serviços Financeiros</div>
          </div>
        </div>

        {logoutReason && (
          <p className="text-[11.5px] text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 mb-3 text-center">{logoutReason}</p>
        )}

        <div className="glass rounded-2xl p-6">
          {mode === 'twofa-setup' ? (
            <form onSubmit={handleVerify2FA}>
              <ShieldCheck size={20} className="text-id-dark dark:text-id-light mb-2" />
              <h1 className="font-display text-[16px] font-semibold mb-1">Configure a verificação em duas etapas</h1>
              <p className="text-[12px] text-[var(--tx3)] mb-4">Escaneie o QR code com o Google Authenticator, Microsoft Authenticator ou Authy — depois digite o código de 6 dígitos gerado.</p>
              {qrUrl && <img src={qrUrl} alt="QR code 2FA" className="mx-auto mb-3 rounded-lg border border-[var(--bdr)]" />}
              <p className="text-[10.5px] text-[var(--tx4)] text-center mb-4 break-all">Ou insira manualmente: {pending?.secret}</p>
              <label className="block text-[11px] text-[var(--tx3)] mb-1">Código de 6 dígitos</label>
              <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" className="w-full bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-3 py-2 text-[16px] tracking-[6px] text-center outline-none focus:border-id-mid" autoFocus />
              {error && <p className="text-[11.5px] text-red-400 mt-2">{error}</p>}
              <button disabled={busy} type="submit" className="btn btn-primary w-full justify-center py-2.5 text-[13px] mt-4 disabled:opacity-50">
                {busy ? 'Confirmando…' : 'Confirmar e entrar'}
              </button>
            </form>
          ) : mode === 'twofa-verify' ? (
            <form onSubmit={handleVerify2FA}>
              <ShieldCheck size={20} className="text-id-dark dark:text-id-light mb-2" />
              <h1 className="font-display text-[16px] font-semibold mb-1">Verificação em duas etapas</h1>
              <p className="text-[12px] text-[var(--tx3)] mb-4">Digite o código de 6 dígitos do seu app autenticador.</p>
              <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" className="w-full bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-3 py-2 text-[16px] tracking-[6px] text-center outline-none focus:border-id-mid" autoFocus />
              {error && <p className="text-[11.5px] text-red-400 mt-2">{error}</p>}
              <button disabled={busy} type="submit" className="btn btn-primary w-full justify-center py-2.5 text-[13px] mt-4 disabled:opacity-50">
                {busy ? 'Verificando…' : 'Entrar'}
              </button>
            </form>
          ) : mode === 'login' ? (
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

              <button disabled={busy} type="submit" className="btn btn-primary w-full justify-center py-2.5 text-[13px] mt-4 disabled:opacity-50">
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
              <input type="password" value={rPass} onChange={(e) => setRPass(e.target.value)} placeholder="mínimo 8 caracteres" className="w-full bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-3 py-2 text-[13px] mb-1 outline-none focus:border-id-mid" />

              {error && <p className="text-[11.5px] text-red-400 mt-2">{error}</p>}

              <button disabled={busy} type="submit" className="btn btn-primary w-full justify-center py-2.5 text-[13px] mt-4 disabled:opacity-50">
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
