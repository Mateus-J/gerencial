// TOTP (RFC 6238) 100% client-side, via Web Crypto (HMAC-SHA1) — compatível
// com Google Authenticator, Microsoft Authenticator, Authy, etc. Não depende
// de nenhum serviço externo (não há backend próprio neste app).
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function genSecret(len = 20) {
  const bytes = new Uint8Array(len)
  crypto.getRandomValues(bytes)
  return base32Encode(bytes)
}

function base32Encode(bytes) {
  let bits = ''
  for (const b of bytes) bits += b.toString(2).padStart(8, '0')
  let out = ''
  for (let i = 0; i + 5 <= bits.length; i += 5) out += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)]
  return out
}

function base32Decode(str) {
  const clean = (str || '').toUpperCase().replace(/[^A-Z2-7]/g, '')
  let bits = ''
  for (const c of clean) {
    const idx = BASE32_ALPHABET.indexOf(c)
    if (idx === -1) continue
    bits += idx.toString(2).padStart(5, '0')
  }
  const bytes = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2))
  return new Uint8Array(bytes)
}

async function hotp(secretBytes, counter) {
  const key = await crypto.subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
  const buf = new ArrayBuffer(8)
  const view = new DataView(buf)
  view.setUint32(0, Math.floor(counter / 2 ** 32))
  view.setUint32(4, counter >>> 0)
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, buf))
  const offset = sig[sig.length - 1] & 0x0f
  const code = ((sig[offset] & 0x7f) << 24) | ((sig[offset + 1] & 0xff) << 16) | ((sig[offset + 2] & 0xff) << 8) | (sig[offset + 3] & 0xff)
  return (code % 1000000).toString().padStart(6, '0')
}

export async function totpNow(secret, step = 30) {
  const counter = Math.floor(Date.now() / 1000 / step)
  return hotp(base32Decode(secret), counter)
}

// Aceita ±1 janela de 30s de tolerância de relógio
export async function totpVerify(secret, code, step = 30, window = 1) {
  const clean = (code || '').replace(/\s/g, '')
  if (!/^\d{6}$/.test(clean)) return false
  const counter = Math.floor(Date.now() / 1000 / step)
  for (let w = -window; w <= window; w++) {
    const c = await hotp(base32Decode(secret), counter + w)
    if (c === clean) return true
  }
  return false
}

export function otpAuthUrl(secret, label, issuer = 'Gerencial ID CTVM') {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`
}
