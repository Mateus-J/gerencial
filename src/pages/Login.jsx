import { useEffect, useState } from 'react'
import { Eye, EyeOff, ShieldCheck, Clock } from 'lucide-react'
import QRCode from 'qrcode'
import { useAuth, withinAccessWindow, getLastUsername } from '../context/AuthContext'
import { otpAuthUrl } from '../lib/totp'

export default function Login() {
  const { login, register, verifyTwoFactor, users } = useAuth()
  const [mode, setMode] = useState('login') // login | register | twofa-setup | twofa-verify | blocked
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
  const [pending, setPending] = useState(null) // { username, user }
  const [code, setCode] = useState('')
  const [qrUrl, setQrUrl] = useState('')
  const [blockedWindow, setBlockedWindow] = useState(null)

  // Se este navegador já logou como alguém com horário de acesso restrito,
  // e o horário atual está fora da janela, nem mostra o formulário de login.
  useEffect(() => {
    const lastUsername = getLastUsername()
    if (!lastUsername) return
    const u = users[lastUsername]
    if (!u) return
    if (!withinAccessWindow(u)) {
      setBlockedWindow({ inicio: u.acessoInicio, fim: u.acessoFim })
      setMode('blocked')
    }
  }, [users])

  useEffect(() => {
    if (mode === 'twofa-setup' && pending?.user?.totpSecret) {
      const url = otpAuthUrl(pending.user.totpSecret, pending.user.email || pending.username)
      QRCode.toDataURL(url, { margin: 1, width: 200 }).then(setQrUrl).catch(() => setQrUrl(''))
    }
  }, [mode, pending])

  async function handleLogin(e) {
    e.preventDefault()
    if (!user || !pass) { setError('Preencha usuário e senha.'); return }
    setBusy(true); setError('')
    const res = await login(user, pass)
    setBusy(false)
    if (!res.ok) { setError(res.error); return }
    if (res.needs2FA) {
      setPending(res.pending)
      setCode('')
      setMode(res.setup ? 'twofa-setup' : 'twofa-verify')
    }
  }

  async function handleVerify2FA(e) {
    e.preventDefault()
    if (!/^\d{6}$/.test(code.trim())) { setError('Digite os 6 dígitos do app autenticador.'); return }
    setBusy(true); setError('')
    const res = await verifyTwoFactor(pending.username, code.trim())
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
          {mode === 'blocked' ? (
            <div className="text-center py-2">
              <Clock size={26} className="mx-auto text-[var(--tx4)] mb-3" />
              <h1 className="font-display text-[16px] font-semibold mb-1">Fora do horário de acesso</h1>
              <p className="text-[12.5px] text-[var(--tx3)]">O acesso a este sistema está liberado apenas entre <strong>{blockedWindow?.inicio}</strong> e <strong>{blockedWindow?.fim}</strong>.</p>
            </div>
          ) : mode === 'twofa-setup' ? (
            <form onSubmit={handleVerify2FA}>
              <ShieldCheck size={20} className="text-id-dark dark:text-id-light mb-2" />
              <h1 className="font-display text-[16px] font-semibold mb-1">Configure a verificação em duas etapas</h1>
              <p className="text-[12px] text-[var(--tx3)] mb-4">Escaneie o QR code com o Google Authenticator, Microsoft Authenticator ou Authy — depois digite o código de 6 dígitos gerado.</p>
              {qrUrl && <img src={qrUrl} alt="QR code 2FA" className="mx-auto mb-3 rounded-lg border border-[var(--bdr)]" />}
              <p className="text-[10.5px] text-[var(--tx4)] text-center mb-4 break-all">Ou insira manualmente: {pending?.user?.totpSecret}</p>
              <label className="block text-[11px] text-[var(--tx3)] mb-1">Código de 6 dígitos</label>
              <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" className="w-full bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-3 py-2 text-[16px] tracking-[6px] text-center outline-none focus:border-id-mid" autoFocus />
              {error && <p className="text-[11.5px] text-red-400 mt-2">{error}</p>}
              <button disabled={busy} type="submit" className="w-full bg-id-dark hover:bg-id-mid rounded-lg py-2.5 text-[13px] font-medium mt-4 disabled:opacity-50">
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
              <button disabled={busy} type="submit" className="w-full bg-id-dark hover:bg-id-mid rounded-lg py-2.5 text-[13px] font-medium mt-4 disabled:opacity-50">
                {busy ? 'Verificando…' : 'Entrar'}
              </button>
              <p className="text-[10.5px] text-[var(--tx4)] text-center mt-3">Só vai pedir de novo amanhã, neste dispositivo.</p>
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
