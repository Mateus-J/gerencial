// POST /api/auth/register — pedido de acesso; fica "pendente" até um admin aprovar
import { json, sameOrigin, serviceAccount, patchFields, fieldPath } from '../../../server/gcp.js'
import { loadUsers, newHash, audit, validUsername, USERS, SECRETS } from '../../../server/auth.js'

const MAX_PENDING = 20

export async function onRequestPost({ request, env }) {
  if (!serviceAccount(env)) return json({ error: 'Cadastro indisponível no momento.' }, 503)
  if (!sameOrigin(request)) return json({ error: 'Origem não permitida.' }, 403)
  let b
  try { b = await request.json() } catch { return json({ error: 'JSON inválido.' }, 400) }
  const username = String(b?.username || '').trim().toLowerCase()
  const name = String(b?.name || '').trim().slice(0, 80)
  const email = String(b?.email || '').trim().toLowerCase().slice(0, 120)
  const pass = String(b?.pass || '')
  if (!validUsername(username)) return json({ error: 'Usuário inválido: use 3 a 32 letras minúsculas, números, ponto, hífen ou _.' }, 400)
  if (!name) return json({ error: 'Informe o nome.' }, 400)
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'E-mail inválido.' }, 400)
  if (pass.length < 8) return json({ error: 'A senha precisa ter pelo menos 8 caracteres.' }, 400)
  try {
    const { users } = await loadUsers(env)
    if (users[username] || (email && Object.values(users).some((u) => (u.email || '').toLowerCase() === email))) return json({ error: 'Usuário ou e-mail já cadastrado.' }, 409)
    if (Object.values(users).filter((u) => u.role === 'pending').length >= MAX_PENDING) return json({ error: 'Muitos pedidos aguardando aprovação. Fale com um administrador.' }, 429)
    await patchFields(env, SECRETS, { [fieldPath(username)]: await newHash(pass) })
    await patchFields(env, USERS, { [fieldPath('users', username)]: { name, email, role: 'pending' }, [fieldPath('updatedAt')]: Date.now() })
    await audit(env, 'register', { username, email })
    return json({ ok: true, user: { username, name, email, role: 'pending' } })
  } catch (e) {
    console.error('register', e)
    return json({ error: 'Não foi possível cadastrar agora.' }, 502)
  }
}
