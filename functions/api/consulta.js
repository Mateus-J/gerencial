// POST /api/consulta — { t } → token de sessão só de leitura da Taxa ADM.
// O link precisa existir e estar ativo; as regras do Firestore conferem isso
// de novo a cada leitura, então revogar corta o acesso na hora.
import { json, sameOrigin, serviceAccount, getDoc, customToken } from '../../server/gcp.js'

export async function onRequestPost({ request, env }) {
  if (!serviceAccount(env)) return json({ error: 'Indisponível no momento.' }, 503)
  if (!sameOrigin(request)) return json({ error: 'Origem não permitida.' }, 403)
  let b
  try { b = await request.json() } catch { return json({ error: 'JSON inválido.' }, 400) }
  const t = String(b?.t || '')
  if (!/^[a-f0-9]{24,64}$/.test(t)) return json({ error: 'Link inválido.' }, 404)
  try {
    const link = (await getDoc(env, 'controle/taxa_adm_share'))?.links?.[t]
    if (!link?.active) return json({ error: 'Link inválido ou revogado.' }, 404)
    return json({ ok: true, label: link.label || '', token: await customToken(env, 'link:' + t.slice(0, 16), { role: 'link', st: t }) })
  } catch (e) {
    console.error('consulta', e)
    return json({ error: 'Não foi possível abrir a consulta agora.' }, 502)
  }
}
