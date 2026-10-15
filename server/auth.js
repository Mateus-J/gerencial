// Núcleo do login no servidor. Os perfis ficam em controle/users (nome, perfil,
// horário, 2FA ligado…), legíveis pela equipe; senhas e segredos de 2FA ficam
// em segredos/usuarios, que as regras do Firestore bloqueiam para o navegador —
// só o servidor (conta de serviço) lê.
import { getDoc, patchFields, fieldPath, customToken, verifyIdToken } from './gcp.js'
import { totpVerify, genSecret } from '../src/lib/totp.js'

export const USERS = 'controle/users'
export const SECRETS = 'segredos/usuarios'
const AUDIT = 'controle/audit_log'
const LEGACY = ['pass', 'salt', 'totpSecret'] // campos que não podem mais ficar no perfil
const MAX_FAILS = 5
const LOCK_MS = 15 * 60 * 1000
const PBKDF2_ITER = 100000 // teto do Cloudflare Workers

const hex = (buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
export const genSalt = () => hex(crypto.getRandomValues(new Uint8Array(16)))

async function sha256(str) { return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))) }
async function pbkdf2(pass, salt, iter = PBKDF2_ITER) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveBits'])
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: iter }, key, 256))
}
export async function newHash(pass) {
  const salt = genSalt()
  return { algo: 'pbkdf2', iter: PBKDF2_ITER, salt, hash: await pbkdf2(pass, salt) }
}
// Comparação em tempo constante
function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}
export async function checkPass(sec, pass) {
  if (!sec?.hash) return false
  if (sec.algo === 'pbkdf2') return same(await pbkdf2(pass, sec.salt, sec.iter || PBKDF2_ITER), sec.hash)
  // formato antigo do app: sha256(salt:senha) ou sha256(senha)
  return same(await sha256(sec.salt ? sec.salt + ':' + pass : pass), sec.hash)
}

// Horário de acesso (definido em Usuários), sempre no horário de Brasília
function toMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '')
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}
export function withinWindow(u, now = Date.now()) {
  const start = toMinutes(u?.acessoInicio), end = toMinutes(u?.acessoFim)
  if (start == null || end == null) return true
  const d = new Date(now)
  const nowMin = (((d.getUTCHours() * 60 + d.getUTCMinutes()) - 180) % 1440 + 1440) % 1440 // UTC−3
  return start <= end ? nowMin >= start && nowMin <= end : nowMin >= start || nowMin <= end
}

export async function audit(env, type, details) {
  try {
    const cur = (await getDoc(env, AUDIT))?.entries || []
    const entry = { type, user: details.username || '?', ts: Date.now(), details }
    await patchFields(env, AUDIT, { [fieldPath('entries')]: [entry, ...cur].slice(0, 500) })
  } catch (e) { console.warn('audit', e) }
}

// Migração automática: tira senha/sal/2FA do perfil (legível) e põe em
// segredos/usuarios; limpa o hash de senha que o registro antigo gravava na
// auditoria. Idempotente — roda a cada login e não faz nada se já estiver ok.
export async function loadUsers(env) {
  const users = (await getDoc(env, USERS))?.users || {}
  const secrets = (await getDoc(env, SECRETS)) || {}
  const moveSec = {}, strip = {}
  for (const [k, u] of Object.entries(users)) {
    if (!LEGACY.some((f) => u[f] !== undefined)) continue
    if (!secrets[k] && u.pass) {
      secrets[k] = { algo: 'sha256', salt: u.salt || '', hash: u.pass, ...(u.totpSecret ? { totpSecret: u.totpSecret } : {}) }
      moveSec[fieldPath(k)] = secrets[k]
    } else if (secrets[k] && u.totpSecret && !secrets[k].totpSecret) {
      secrets[k].totpSecret = u.totpSecret
      moveSec[fieldPath(k, 'totpSecret')] = u.totpSecret
    }
    LEGACY.forEach((f) => { if (u[f] !== undefined) { strip[fieldPath('users', k, f)] = undefined; delete u[f] } })
  }
  if (Object.keys(moveSec).length) await patchFields(env, SECRETS, moveSec) // grava o segredo ANTES de apagar do perfil
  if (Object.keys(strip).length) {
    await patchFields(env, USERS, strip)
    const a = await getDoc(env, AUDIT)
    if (a?.entries?.some((e) => e?.details?.passHash)) {
      const entries = a.entries.map((e) => (e?.details?.passHash ? { ...e, details: Object.fromEntries(Object.entries(e.details).filter(([f]) => f !== 'passHash')) } : e))
      await patchFields(env, AUDIT, { [fieldPath('entries')]: entries })
    }
  }
  return { users, secrets }
}

export const uidOf = (username) => 'u:' + username
export const usernameOfUid = (uid) => (uid && uid.startsWith('u:') ? uid.slice(2) : null)

// Login completo: usuário/e-mail + senha (+ código 2FA quando ligado)
export async function login(env, { user, pass, code }, meta = {}) {
  const input = String(user || '').trim().toLowerCase()
  if (!input || !pass) return { status: 400, body: { error: 'Preencha usuário e senha.' } }
  const { users, secrets } = await loadUsers(env)
  let key = users[input] ? input : Object.keys(users).find((k) => (users[k].email || '').toLowerCase() === input)
  const fail = { status: 401, body: { error: 'Usuário/e-mail ou senha incorretos.' } }
  if (!key) { await audit(env, 'login_fail', { username: input, reason: 'Usuário não encontrado', ...meta }); return fail }
  const u = users[key], sec = secrets[key] || {}
  const now = Date.now()
  if (sec.lockedUntil && sec.lockedUntil > now) {
    const min = Math.ceil((sec.lockedUntil - now) / 60000)
    return { status: 429, body: { error: `Muitas tentativas erradas. Tente de novo em ${min} min.` } }
  }
  const bad = async (reason, resp = fail) => {
    const fails = (sec.fails || 0) + 1
    await patchFields(env, SECRETS, { [fieldPath(key, 'fails')]: fails >= MAX_FAILS ? 0 : fails, [fieldPath(key, 'lockedUntil')]: fails >= MAX_FAILS ? now + LOCK_MS : 0 })
    await audit(env, 'login_fail', { username: key, reason, ...meta })
    return fails >= MAX_FAILS ? { status: 429, body: { error: 'Muitas tentativas erradas. Acesso bloqueado por 15 min.' } } : resp
  }
  if (!(await checkPass(sec, pass))) return bad('Senha incorreta')
  if (!withinWindow(u, now)) {
    await audit(env, 'login_fail', { username: key, reason: 'Fora do horário permitido', ...meta })
    return { status: 403, body: { error: `Acesso permitido apenas entre ${u.acessoInicio} e ${u.acessoFim}.` } }
  }
  const updates = {}
  if (sec.algo !== 'pbkdf2') Object.entries(await newHash(pass)).forEach(([f, v]) => { updates[fieldPath(key, f)] = v }) // atualiza hash antigo
  if (u.totpEnabled) {
    let secret = sec.totpSecret
    if (!secret) { secret = genSecret(); updates[fieldPath(key, 'totpSecret')] = secret }
    if (!code) {
      if (Object.keys(updates).length) await patchFields(env, SECRETS, updates)
      return { status: 200, body: { needs2FA: true, setup: !u.totpConfirmed, ...(u.totpConfirmed ? {} : { secret, label: u.email || key }) } }
    }
    if (!(await totpVerify(secret, String(code)))) {
      if (Object.keys(updates).length) await patchFields(env, SECRETS, updates)
      return bad('2FA inválido', { status: 401, body: { error: 'Código inválido ou expirado.', needs2FA: true } })
    }
    if (!u.totpConfirmed) await patchFields(env, USERS, { [fieldPath('users', key, 'totpConfirmed')]: true })
  }
  updates[fieldPath(key, 'fails')] = 0
  updates[fieldPath(key, 'lockedUntil')] = 0
  await patchFields(env, SECRETS, updates)
  await audit(env, 'login_ok', { username: key, role: u.role, email: u.email || '', ...(u.totpEnabled ? { twoFA: true } : {}), ...meta })
  const profile = { username: key, ...u, ...(u.totpEnabled ? { totpConfirmed: true } : {}) }
  if (u.role === 'pending') return { status: 200, body: { ok: true, user: profile } } // aguardando aprovação: sem acesso à base
  return { status: 200, body: { ok: true, user: profile, token: await customToken(env, uidOf(key), { role: u.role, username: key }) } }
}

// Quem chama precisa ser admin (confere o token de sessão e o perfil atual)
export async function requireAdmin(env, request) {
  const idToken = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  const username = usernameOfUid(await verifyIdToken(env, idToken))
  if (!username) return null
  const { users, secrets } = await loadUsers(env)
  return users[username]?.role === 'admin' ? { username, users, secrets } : null
}

// Quem chama precisa estar logado (qualquer perfil da equipe)
export async function requireStaff(env, request, roles = ['admin', 'user', 'consulta']) {
  const idToken = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  const username = usernameOfUid(await verifyIdToken(env, idToken))
  if (!username) return null
  const users = (await getDoc(env, USERS))?.users || {}
  return roles.includes(users[username]?.role) ? { username, user: users[username] } : null
}

export const validUsername = (s) => /^[a-z0-9._-]{3,32}$/.test(s || '')
