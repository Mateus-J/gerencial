// Links de consulta (somente leitura) da tela de Taxa de Administração.
// Cada link tem um token próprio, pode ser revogado a qualquer momento e
// mostra sempre os dados ao vivo da base.
import { useEffect, useState } from 'react'
import { onSnapshot, runTransaction } from 'firebase/firestore'
import { Link2, Copy, X, Plus, Ban, ExternalLink } from 'lucide-react'
import { db } from '../../lib/firebase'
import { SHARE_REF, consultaUrl } from '../../lib/share'

function newToken() {
  const a = new Uint8Array(18)
  crypto.getRandomValues(a)
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('')
}

export default function ShareLinks({ who, toast, onClose }) {
  const [links, setLinks] = useState({})
  const [label, setLabel] = useState('')

  useEffect(() => onSnapshot(SHARE_REF(), (s) => setLinks(s.exists() ? s.data().links || {} : {}), (e) => console.warn('shareLoad err', e)), [])
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [onClose])

  async function update(fn, msg) {
    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(SHARE_REF())
        const cur = snap.exists() ? snap.data().links || {} : {}
        tx.set(SHARE_REF(), { links: fn(cur) })
      })
      if (msg) toast.success(msg)
    } catch (e) { toast.error('Não foi possível salvar: ' + e.message) }
  }
  async function copy(token) {
    try { await navigator.clipboard.writeText(consultaUrl(token)); toast.success('Link copiado.') } catch { toast.error('Não consegui copiar — selecione o link e copie.') }
  }
  async function create() {
    const token = newToken()
    await update((cur) => ({ ...cur, [token]: { label: label.trim() || 'Consulta', createdAt: Date.now(), createdBy: who, active: true } }), 'Link criado.')
    setLabel('')
    copy(token)
  }
  const list = Object.entries(links).sort((a, b) => b[1].createdAt - a[1].createdAt)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative w-full max-w-[680px] max-h-[88vh] bg-[var(--sur)] border border-[var(--bdr)] rounded-2xl shadow-[var(--shadow-pop)] flex flex-col animate-fade-up">
        <div className="px-5 py-4 border-b border-[var(--bdr)] flex items-center gap-3">
          <span className="w-9 h-9 rounded-xl bg-id-mid/15 text-id-dark dark:text-id-light flex items-center justify-center"><Link2 size={17} /></span>
          <div className="flex-1">
            <div className="font-display font-semibold text-[15px]">Link de consulta</div>
            <div className="text-[11.5px] text-[var(--tx3)]">Só leitura da tela de Taxa de Administração, sempre com os dados ao vivo. Não precisa de login.</div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--tx3)] hover:bg-[var(--sur2)]"><X size={16} /></button>
        </div>
        <div className="p-5 border-b border-[var(--bdr)]">
          <label className="label">Para quem é o link</label>
          <div className="flex gap-2">
            <input value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') create() }} placeholder="Ex.: Diretoria" className="field" />
            <button onClick={create} className="btn btn-primary shrink-0"><Plus size={14} /> Criar e copiar link</button>
          </div>
          <p className="text-[11px] text-[var(--tx3)] mt-2">Quem tiver o link vê os números e pode exportar a base, mas não altera nada. Revogue quando não precisar mais.</p>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-2">
          {!list.length && <div className="text-center text-[12.5px] text-[var(--tx3)] py-6">Nenhum link criado ainda.</div>}
          {list.map(([token, l]) => (
            <div key={token} className={`rounded-xl border px-3 py-2.5 ${l.active ? 'border-[var(--bdr)]' : 'border-[var(--bdr)] opacity-50'}`}>
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] font-semibold">{l.label} {!l.active && <span className="text-[10.5px] font-normal text-red-500">· revogado</span>}</div>
                  <div className="text-[10.5px] text-[var(--tx3)]">Criado por {l.createdBy || '—'} em {new Date(l.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
                </div>
                {l.active ? (
                  <>
                    <button onClick={() => copy(token)} className="btn btn-sm"><Copy size={13} /> Copiar</button>
                    <a href={consultaUrl(token)} target="_blank" rel="noreferrer" className="btn btn-sm" title="Abrir"><ExternalLink size={13} /></a>
                    <button onClick={() => { if (confirm(`Revogar o link "${l.label}"? Quem tiver esse link perde o acesso na hora.`)) update((cur) => ({ ...cur, [token]: { ...cur[token], active: false, revokedAt: Date.now(), revokedBy: who } }), 'Link revogado.') }} className="btn btn-sm btn-danger"><Ban size={13} /> Revogar</button>
                  </>
                ) : null}
              </div>
              {l.active && <input readOnly value={consultaUrl(token)} onFocus={(e) => e.target.select()} className="field mt-2 py-1 font-mono text-[11px]" />}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
