// POST /api/auth/admin — ações de administrador que mexem em senha/2FA (o resto
// do perfil o admin edita direto na base, liberado pelas regras só para admin).
// Exige o token de sessão de um admin no cabeçalho Authorization.
import { json, sameOrigin, serviceAccount, patchFields, fieldPath } from '../../../server/gcp.js'
import { requireAdmin, newHash, checkPass, audit, validUsername, USERS, SECRETS } from '../../../server/auth.js'
import { genSecret } from '../../../src/lib/totp.js'

const PROFILE_FIELDS = ['name', 'email', 'role', 'boardSlug', 'acessoInicio', 'acessoFim', 'notifPendencias']
const ROLES = ['admin', 'user', 'consulta', 'pending']

export async function onRequestPost({ request, env }) {
  if (!serviceAccount(env)) return json({ error: 'Indisponível: falta configurar o servidor.' }, 503)
  if (!sameOrigin(request)) return json({ error: 'Origem não permitida.' }, 403)
  let b
  try { b = await request.json() } catch { return json({ error: 'JSON inválido.' }, 400) }
  try {
    const me = await requireAdmin(env, request)
    if (!me) return json({ error: 'Somente administradores.' }, 403)
    const { users, secrets } = me
    const target = String(b?.username || '').trim().toLowerCase()
    const exists = !!users[target]
    const done = async (type, extra = {}) => { await audit(env, type, { username: me.username, alvo: target, ...extra }); return json({ ok: true, ...extra.resp }) }

    switch (b?.action) {
      case 'verifyPassword': { // confirma a senha do próprio admin (ações sensíveis na tela)
        const ok = await checkPass(secrets[me.username], String(b?.pass || ''))
        if (!ok) await audit(env, 'confirm_fail', { username: me.username })
        return json({ ok })
      }
      case 'createUser': {
        if (!validUsername(target)) return json({ error: 'Usuário inválido: use 3 a 32 letras minúsculas, números, ponto, hífen ou _.' }, 400)
        if (exists) return json({ error: 'Usuário já existe.' }, 409)
        const pass = String(b?.pass || '')
        if (pass.length < 8) return json({ error: 'A senha precisa ter pelo menos 8 caracteres.' }, 400)
        const p = Object.fromEntries(PROFILE_FIELDS.map((f) => [f, b?.profile?.[f]]).filter(([, v]) => v !== undefined && v !== ''))
        if (!ROLES.includes(p.role)) p.role = 'user'
        await patchFields(env, SECRETS, { [fieldPath(target)]: await newHash(pass) })
        await patchFields(env, USERS, { [fieldPath('users', target)]: p, [fieldPath('updatedAt')]: Date.now() })
        return done('user_create', { role: p.role })
      }
      case 'setPassword': {
        if (!exists) return json({ error: 'Usuário não encontrado.' }, 404)
        const pass = String(b?.pass || '')
        if (pass.length < 8) return json({ error: 'A senha precisa ter pelo menos 8 caracteres.' }, 400)
        const h = await newHash(pass)
        await patchFields(env, SECRETS, { ...Object.fromEntries(Object.entries(h).map(([f, v]) => [fieldPath(target, f), v])), [fieldPath(target, 'fails')]: 0, [fieldPath(target, 'lockedUntil')]: 0 })
        return done('user_password')
      }
      case 'set2FA': {
        if (!exists) return json({ error: 'Usuário não encontrado.' }, 404)
        const on = !!b?.enabled
        if (on && !secrets[target]?.totpSecret) await patchFields(env, SECRETS, { [fieldPath(target, 'totpSecret')]: genSecret() })
        await patchFields(env, USERS, { [fieldPath('users', target, 'totpEnabled')]: on })
        return done(on ? 'user_2fa_on' : 'user_2fa_off')
      }
      case 'reset2FA': {
        if (!exists) return json({ error: 'Usuário não encontrado.' }, 404)
        await patchFields(env, SECRETS, { [fieldPath(target, 'totpSecret')]: genSecret() })
        await patchFields(env, USERS, { [fieldPath('users', target, 'totpConfirmed')]: false })
        return done('user_2fa_reset')
      }
      case 'removeUser': {
        if (!exists) return json({ error: 'Usuário não encontrado.' }, 404)
        if (target === me.username) return json({ error: 'Você não pode remover o próprio usuário.' }, 400)
        await patchFields(env, USERS, { [fieldPath('users', target)]: undefined, [fieldPath('updatedAt')]: Date.now() })
        await patchFields(env, SECRETS, { [fieldPath(target)]: undefined })
        return done('user_remove')
      }
      default:
        return json({ error: 'Ação inválida.' }, 400)
    }
  } catch (e) {
    console.error('admin', e)
    return json({ error: 'Não foi possível concluir agora.' }, 502)
  }
}
