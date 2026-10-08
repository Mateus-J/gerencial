// Acesso do servidor (Cloudflare Functions) ao Firebase com a conta de serviço
// do projeto. A conta de serviço fica só no Cloudflare (variável secreta
// FIREBASE_SERVICE_ACCOUNT, o JSON baixado no console do Firebase) e nunca vai
// para o navegador. Com ela o servidor:
//   - lê e grava no Firestore sem passar pelas regras (é "dono" do projeto);
//   - emite os tokens de login (custom tokens) que o navegador troca por uma
//     sessão do Firebase com o perfil (role) da pessoa.
// FIREBASE_EMULATOR (só para testes locais) aponta tudo para os emuladores.

export const API_KEY = 'AIzaSyAUcVEYwdeq1sfo6P8q8JIodgu0J-akJgI'
export const PROJECT_ID = 'id-liquidacao'

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const b64urlStr = (s) => b64url(new TextEncoder().encode(s))

export function serviceAccount(env) {
  if (!env.FIREBASE_SERVICE_ACCOUNT) return null
  try {
    const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT)
    return sa.client_email && sa.private_key ? sa : null
  } catch { return null }
}

const urls = (env) => {
  const emu = env.FIREBASE_EMULATOR // ex.: { "firestore": "http://127.0.0.1:8089", "auth": "http://127.0.0.1:9099" }
  const e = emu ? JSON.parse(emu) : null
  return {
    emu: !!e,
    firestore: `${e ? e.firestore : 'https://firestore.googleapis.com'}/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    identity: e ? `${e.auth}/identitytoolkit.googleapis.com` : 'https://identitytoolkit.googleapis.com',
  }
}

const keyCache = new Map()
async function signingKey(sa) {
  if (keyCache.has(sa.client_email)) return keyCache.get(sa.client_email)
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  keyCache.set(sa.client_email, key)
  return key
}

async function signJwt(sa, payload) {
  const head = b64urlStr(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const body = b64urlStr(JSON.stringify(payload))
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await signingKey(sa), new TextEncoder().encode(head + '.' + body))
  return head + '.' + body + '.' + b64url(sig)
}

// Token de login do Firebase: o navegador chama signInWithCustomToken com ele.
// `claims` vão para request.auth.token nas regras do Firestore.
export async function customToken(env, uid, claims) {
  const sa = serviceAccount(env)
  const now = Math.floor(Date.now() / 1000)
  return signJwt(sa, {
    iss: sa.client_email, sub: sa.client_email,
    aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    iat: now, exp: now + 3600, uid, claims,
  })
}

let access = null
async function accessToken(env) {
  if (urls(env).emu) return 'owner'
  if (access && access.exp > Date.now()) return access.value
  const sa = serviceAccount(env)
  const now = Math.floor(Date.now() / 1000)
  const assertion = await signJwt(sa, { iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + assertion,
  })
  if (!res.ok) throw new Error('oauth ' + res.status)
  const d = await res.json()
  access = { value: d.access_token, exp: Date.now() + (d.expires_in - 300) * 1000 }
  return access.value
}

// ---- Firestore REST --------------------------------------------------------
export function fromFs(v) {
  if (!v || typeof v !== 'object') return null
  if ('stringValue' in v) return v.stringValue
  if ('integerValue' in v) return Number(v.integerValue)
  if ('doubleValue' in v) return Number(v.doubleValue)
  if ('booleanValue' in v) return v.booleanValue
  if ('nullValue' in v) return null
  if ('timestampValue' in v) return v.timestampValue
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromFs)
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, fromFs(x)]))
  return null
}
export function toFs(v) {
  if (v === null || v === undefined) return { nullValue: null }
  if (typeof v === 'boolean') return { booleanValue: v }
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }
  if (typeof v === 'string') return { stringValue: v }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFs) } }
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, toFs(x)])) } }
}
// Caminho de campo com nomes arbitrários (ex.: usuário "joao.silva")
export const fieldPath = (...parts) => parts.map((p) => '`' + String(p).replace(/\\/g, '\\\\').replace(/`/g, '\\`') + '`').join('.')

export async function getDoc(env, path) {
  const res = await fetch(`${urls(env).firestore}/${path}`, { headers: { authorization: 'Bearer ' + (await accessToken(env)) } })
  if (res.status === 404) return null
  if (!res.ok) throw new Error('firestore get ' + res.status)
  const d = await res.json()
  return fromFs({ mapValue: { fields: d.fields || {} } })
}

// Grava só os campos indicados ({ 'caminho': valor }, caminhos já montados com
// fieldPath); valor undefined = apaga o campo. Não mexe no resto do documento.
export async function patchFields(env, path, updates) {
  const mask = Object.keys(updates)
  if (!mask.length) return
  const fields = {}
  for (const [fp, val] of Object.entries(updates)) {
    if (val === undefined) continue
    // monta o objeto aninhado a partir do caminho `a`.`b`
    const parts = [...fp.matchAll(/`((?:[^`\\]|\\.)*)`/g)].map((m) => m[1].replace(/\\(.)/g, '$1'))
    let cur = fields
    parts.forEach((p, i) => {
      if (i === parts.length - 1) cur[p] = toFs(val)
      else { cur[p] = cur[p] || { mapValue: { fields: {} } }; cur = cur[p].mapValue.fields }
    })
  }
  const qs = mask.map((m) => 'updateMask.fieldPaths=' + encodeURIComponent(m)).join('&')
  const res = await fetch(`${urls(env).firestore}/${path}?${qs}`, {
    method: 'PATCH',
    headers: { authorization: 'Bearer ' + (await accessToken(env)), 'content-type': 'application/json' },
    body: JSON.stringify({ fields }),
  })
  if (!res.ok) throw new Error('firestore patch ' + res.status + ' ' + (await res.text()).slice(0, 200))
}

// Confere o token de sessão (ID token) que o navegador manda e devolve o uid.
export async function verifyIdToken(env, idToken) {
  if (!idToken) return null
  const res = await fetch(`${urls(env).identity}/v1/accounts:lookup?key=${API_KEY}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken }),
  })
  if (!res.ok) return null
  const d = await res.json()
  return d.users?.[0]?.localId || null
}

export const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })

export function sameOrigin(request) {
  const origin = request.headers.get('origin')
  if (!origin) return false
  try { return new URL(origin).host === new URL(request.url).host } catch { return false }
}
