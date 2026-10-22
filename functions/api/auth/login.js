// POST /api/auth/login — { user, pass, code? } → { ok, user, token } | { needs2FA, setup, secret? }
import { json, sameOrigin, serviceAccount } from '../../../server/gcp.js'
import { login } from '../../../server/auth.js'

export async function onRequestPost({ request, env }) {
  if (!serviceAccount(env)) return json({ error: 'Login indisponível: falta configurar FIREBASE_SERVICE_ACCOUNT no Cloudflare.' }, 503)
  if (!sameOrigin(request)) return json({ error: 'Origem não permitida.' }, 403)
  let body
  try { body = await request.json() } catch { return json({ error: 'JSON inválido.' }, 400) }
  try {
    const ip = request.headers.get('cf-connecting-ip') || ''
    const r = await login(env, { user: body?.user, pass: body?.pass, code: body?.code }, ip ? { ip } : {})
    return json(r.body, r.status)
  } catch (e) {
    console.error('login', e)
    return json({ error: 'Não foi possível entrar agora. Tente de novo.' }, 502)
  }
}
