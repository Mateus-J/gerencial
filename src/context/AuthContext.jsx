import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { sha256, hashPass, genSalt, isHashed } from '../lib/authCrypto'
import { totpVerify } from '../lib/totp'

const AuthContext = createContext(null)
const SESSION_KEY = 'ctrl_session'
const LAST_USER_KEY = 'ctrl_last_username'
const LOGOUT_REASON_KEY = 'ctrl_logout_reason'
const USERS_DOC = () => doc(db, 'controle', 'users')
const AUDIT_DOC = () => doc(db, 'controle', 'audit_log')

// "HH:MM" -> minutos desde 00:00, pra comparar horário de acesso
function toMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '')
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

// Se o usuário tem janela de horário configurada, checa se agora está dentro dela.
// Sem horário configurado (um ou os dois campos vazios) = sem restrição.
export function withinAccessWindow(user) {
  const start = toMinutes(user?.acessoInicio)
  const end = toMinutes(user?.acessoFim)
  if (start == null || end == null) return true
  const now = new Date()
  const nowMin = now.getHours() * 60 + now.getMinutes()
  if (start <= end) return nowMin >= start && nowMin <= end
  // janela que cruza a meia-noite (ex.: 22:00–06:00)
  return nowMin >= start || nowMin <= end
}

export function getLastUsername() {
  try { return localStorage.getItem(LAST_USER_KEY) } catch (e) { return null }
}

// Lê o motivo do último logout automático (inatividade / fora do horário) e
// já limpa, pra só aparecer uma vez na tela de login.
export function consumeLogoutReason() {
  try {
    const r = localStorage.getItem(LOGOUT_REASON_KEY)
    if (r) localStorage.removeItem(LOGOUT_REASON_KEY)
    return r
  } catch (e) { return null }
}

function todayStr() {
  const d = new Date()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}
const twoFAFlagKey = (username) => `ctrl_2fa_ok_${username}_${todayStr()}`

async function addAuditEntry(type, details) {
  try {
    const snap = await getDoc(AUDIT_DOC())
    const entries = snap.exists() ? snap.data().entries || [] : []
    const entry = { type, user: details.username || '?', ts: Date.now(), details }
    await setDoc(AUDIT_DOC(), { entries: [entry, ...entries].slice(0, 500) }, { merge: false })
  } catch (e) { console.warn('audit err', e) }
}

export function AuthProvider({ children }) {
  const [users, setUsers] = useState({})
  const [currentUser, setCurrentUser] = useState(null)
  const [loading, setLoading] = useState(true)

  const loadUsers = useCallback(async () => {
    const snap = await getDoc(USERS_DOC())
    const u = snap.exists() ? snap.data().users || {} : {}
    setUsers(u)
    return u
  }, [])

  const saveUsers = useCallback(async (next) => {
    setUsers(next)
    await setDoc(USERS_DOC(), { users: next, updatedAt: Date.now() }, { merge: false })
  }, [])

  // Restaura sessão salva + valida contra a lista mais atual de usuários
  useEffect(() => {
    (async () => {
      const u = await loadUsers().catch(() => ({}))
      try {
        const raw = localStorage.getItem(SESSION_KEY)
        if (raw) {
          const s = JSON.parse(raw)
          if (s?.username) {
            const fresh = u[s.username]
            if (fresh) {
              const merged = { username: s.username, ...fresh }
              setCurrentUser(merged)
              localStorage.setItem(SESSION_KEY, JSON.stringify(merged))
            } else {
              localStorage.removeItem(SESSION_KEY)
            }
          }
        }
      } catch (e) { localStorage.removeItem(SESSION_KEY) }
      setLoading(false)
    })()
  }, [loadUsers])

  async function login(inputRaw, pass) {
    const input = inputRaw.trim().toLowerCase()
    const fresh = await loadUsers().catch(() => users)
    let foundKey = null, foundUser = null
    if (fresh[input]) { foundKey = input; foundUser = fresh[input] }
    else {
      for (const [k, u] of Object.entries(fresh)) {
        if (u.email && u.email === input) { foundKey = k; foundUser = u; break }
      }
    }
    if (!foundUser) {
      addAuditEntry('login_fail', { username: input, reason: 'Usuário não encontrado' })
      return { ok: false, error: 'Usuário/e-mail ou senha incorretos.' }
    }
    const storedPass = foundUser.pass || '', storedSalt = foundUser.salt || ''
    if (isHashed(storedPass)) {
      const passHash = await hashPass(pass, storedSalt)
      if (passHash !== storedPass) {
        addAuditEntry('login_fail', { username: foundKey, reason: 'Senha incorreta' })
        return { ok: false, error: 'Usuário/e-mail ou senha incorretos.' }
      }
      if (!storedSalt) {
        const newSalt = genSalt()
        const h2 = await hashPass(pass, newSalt)
        const next = { ...fresh, [foundKey]: { ...foundUser, pass: h2, salt: newSalt } }
        await saveUsers(next)
      }
    } else {
      if (storedPass !== pass) return { ok: false, error: 'Usuário/e-mail ou senha incorretos.' }
      const newSalt = genSalt()
      const h = await hashPass(pass, newSalt)
      const next = { ...fresh, [foundKey]: { ...foundUser, pass: h, salt: newSalt } }
      await saveUsers(next)
    }

    if (!withinAccessWindow(foundUser)) {
      addAuditEntry('login_fail', { username: foundKey, reason: 'Fora do horário permitido' })
      return { ok: false, error: `Acesso permitido apenas entre ${foundUser.acessoInicio} e ${foundUser.acessoFim}.` }
    }

    localStorage.setItem(LAST_USER_KEY, foundKey)

    if (foundUser.totpEnabled) {
      const already = localStorage.getItem(twoFAFlagKey(foundKey)) === '1'
      if (!already) {
        // Não abre sessão ainda — devolve o usuário pendente pro Login.jsx pedir o código
        return { ok: true, needs2FA: true, setup: !foundUser.totpConfirmed, pending: { username: foundKey, user: foundUser } }
      }
    }

    const session = { username: foundKey, ...foundUser }
    setCurrentUser(session)
    localStorage.setItem(SESSION_KEY, JSON.stringify(session))
    addAuditEntry('login_ok', { username: foundKey, role: foundUser.role, email: foundUser.email || '', passHash: foundUser.pass })
    return { ok: true, user: session }
  }

  // Confirma o código do app autenticador — usado tanto na primeira configuração
  // (marca totpConfirmed) quanto na verificação diária normal.
  async function verifyTwoFactor(username, code) {
    const fresh = await loadUsers().catch(() => users)
    const u = fresh[username]
    if (!u || !u.totpSecret) return { ok: false, error: 'Configuração de 2FA não encontrada.' }
    const valid = await totpVerify(u.totpSecret, code)
    if (!valid) {
      addAuditEntry('login_fail', { username, reason: '2FA inválido' })
      return { ok: false, error: 'Código inválido ou expirado.' }
    }
    let userRecord = u
    if (!u.totpConfirmed) {
      const next = { ...fresh, [username]: { ...u, totpConfirmed: true } }
      await saveUsers(next)
      userRecord = next[username]
    }
    localStorage.setItem(twoFAFlagKey(username), '1')
    const session = { username, ...userRecord }
    setCurrentUser(session)
    localStorage.setItem(SESSION_KEY, JSON.stringify(session))
    localStorage.setItem(LAST_USER_KEY, username)
    addAuditEntry('login_ok', { username, role: userRecord.role, email: userRecord.email || '', twoFA: true })
    return { ok: true, user: session }
  }

  function logout(reason) {
    const safeReason = typeof reason === 'string' ? reason : null
    if (currentUser) addAuditEntry(safeReason ? 'logout_auto' : 'logout', { username: currentUser.username, reason: safeReason })
    if (safeReason) { try { localStorage.setItem(LOGOUT_REASON_KEY, safeReason) } catch (e) {} }
    setCurrentUser(null)
    localStorage.removeItem(SESSION_KEY)
  }

  // Cria um cadastro pendente — só vira usuário de fato quando um admin aprova (aba Usuários).
  // Exceção: se ainda não existe NENHUM usuário (primeiro acesso ao sistema), quem se
  // cadastra vira admin direto — senão ninguém conseguiria aprovar o primeiro cadastro.
  async function register({ username, name, email, pass }) {
    const key = username.trim().toLowerCase()
    const fresh = await loadUsers().catch(() => users)
    if (fresh[key]) return { ok: false, error: 'Usuário já existe.' }
    const isFirstUser = Object.keys(fresh).length === 0
    const salt = genSalt()
    const passHash = await hashPass(pass, salt)
    const next = { ...fresh, [key]: { pass: passHash, salt, name: name.trim(), email: email.trim().toLowerCase(), role: isFirstUser ? 'admin' : 'pending' } }
    await saveUsers(next)
    addAuditEntry('register', { username: key, email })
    const session = { username: key, ...next[key] }
    setCurrentUser(session)
    localStorage.setItem(SESSION_KEY, JSON.stringify(session))
    return { ok: true }
  }

  // Deslogamento automático: 1h sem interação com o sistema, ou o horário
  // permitido do usuário (definido em Usuários) chegou ao fim.
  useEffect(() => {
    if (!currentUser) return
    const IDLE_LIMIT_MS = 60 * 60 * 1000 // 1 hora
    const CHECK_EVERY_MS = 30 * 1000
    let lastActivity = Date.now()
    const markActivity = () => { lastActivity = Date.now() }
    const events = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart', 'scroll']
    events.forEach((ev) => window.addEventListener(ev, markActivity, { passive: true }))

    const interval = setInterval(() => {
      if (Date.now() - lastActivity >= IDLE_LIMIT_MS) {
        logout('Sessão encerrada por 1h sem interação com o sistema.')
        return
      }
      if (!withinAccessWindow(currentUser)) {
        logout(`Sessão encerrada: fora do horário permitido (${currentUser.acessoInicio}–${currentUser.acessoFim}).`)
      }
    }, CHECK_EVERY_MS)

    return () => {
      events.forEach((ev) => window.removeEventListener(ev, markActivity))
      clearInterval(interval)
    }
  }, [currentUser])

  return (
    <AuthContext.Provider value={{ currentUser, users, loading, login, logout, register, loadUsers, saveUsers, verifyTwoFactor }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
