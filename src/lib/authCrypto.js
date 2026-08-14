// Mesma estratégia de hash do app antigo: SHA-256 salted, via Web Crypto API nativa
export async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}
export async function hashPass(pass, salt) { return salt ? sha256(salt + ':' + pass) : sha256(pass) }
export function genSalt() {
  const arr = new Uint8Array(16); crypto.getRandomValues(arr)
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('')
}
export const isHashed = (pass) => /^[a-f0-9]{64}$/.test(pass || '')
