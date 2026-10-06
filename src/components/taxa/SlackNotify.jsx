// Aba "Notificações Slack": mensagem padrão com as taxas segregadas de cada
// fundo, enviada por e-mail para o canal do fundo no Slack.
import { useEffect, useMemo, useState } from 'react'
import { doc, onSnapshot, runTransaction } from 'firebase/firestore'
import * as XLSX from 'xlsx'
import { Mail, Copy, Eye, Settings2, ListPlus, Download, Search, CheckCircle2, Clock, X, RotateCcw, Info } from 'lucide-react'
import { db } from '../../lib/firebase'
import { sortKey, fmtFull, fmtShort, TAXAS, todayISO } from '../../lib/taxaAdm'
import { DEFAULT_TEMPLATE, PLACEHOLDERS, groupByFund, renderMessage, mailtoHref, parseChannelList, channelKey } from '../../lib/slackNotify'

const SLACK_REF = () => doc(db, 'controle', 'taxa_adm_slack')

export default function SlackNotify({ rows, who, toast }) {
  const [cfg, setCfg] = useState({ template: DEFAULT_TEMPLATE, canais: {}, enviados: {} })
  const months = useMemo(() => [...new Set(rows.map((r) => r.mesRef).filter(Boolean))].sort((a, b) => sortKey(b) - sortKey(a)), [rows])
  const [mes, setMes] = useState('')
  const [q, setQ] = useState('')
  const [fStatus, setFStatus] = useState('')
  const [fCanal, setFCanal] = useState('')
  const [preview, setPreview] = useState(null)
  const [editTpl, setEditTpl] = useState(false)
  const [bulk, setBulk] = useState(false)

  useEffect(() => onSnapshot(SLACK_REF(), (snap) => {
    const d = snap.exists() ? snap.data() : {}
    setCfg({ template: d.template || DEFAULT_TEMPLATE, canais: d.canais || {}, enviados: d.enviados || {} })
  }, (e) => console.warn('slackLoad err', e)), [])

  const curMes = mes || months[0] || ''
  const sentKey = (f) => f.key + '|' + curMes.replace('.', '_')
  const funds = useMemo(() => groupByFund(rows, curMes), [rows, curMes])
  // Todos os fundos da base (para o cadastro em lote por CNPJ)
  const allFunds = useMemo(() => {
    const m = new Map()
    rows.forEach((r) => { const k = channelKey(r); if (!m.has(k)) m.set(k, { key: k, fundo: r.fundo, cnpj: r.cnpj || '' }) })
    return [...m.values()]
  }, [rows])
  const shown = funds.filter((f) => {
    if (q && !(f.fundo + ' ' + f.cnpj + ' ' + f.gestor).toLowerCase().includes(q.toLowerCase())) return false
    if (fStatus && f.status !== fStatus) return false
    const email = cfg.canais[f.key]
    if (fCanal === 'com' && !email) return false
    if (fCanal === 'sem' && email) return false
    if (fCanal === 'naoenviado' && cfg.enviados[sentKey(f)]) return false
    return true
  })
  const comCanal = funds.filter((f) => cfg.canais[f.key]).length
  const enviados = funds.filter((f) => cfg.enviados[sentKey(f)]).length

  // Grava no doc de configuração em cima da versão mais recente
  async function save(fn, msg) {
    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(SLACK_REF())
        const cur = snap.exists() ? snap.data() : {}
        tx.set(SLACK_REF(), fn({ template: cur.template || DEFAULT_TEMPLATE, canais: cur.canais || {}, enviados: cur.enviados || {} }))
      })
      if (msg) toast.success(msg)
    } catch (e) { toast.error('Não foi possível salvar: ' + e.message) }
  }
  const setCanal = (key, email) => save((c) => {
    const canais = { ...c.canais }
    if (email) canais[key] = email.trim().toLowerCase(); else delete canais[key]
    return { ...c, canais }
  })
  const markSent = (f) => save((c) => ({ ...c, enviados: { ...c.enviados, [sentKey(f)]: { at: Date.now(), by: who } } }))

  const msgOf = (f) => renderMessage(cfg.template, f)
  function send(f) {
    const email = cfg.canais[f.key]
    if (!email) { toast.error('Cadastre o e-mail do canal desse fundo primeiro.'); return }
    window.location.href = mailtoHref(email, msgOf(f))
    markSent(f)
  }
  async function copy(f) {
    const m = msgOf(f)
    try { await navigator.clipboard.writeText(m.body); toast.success('Mensagem copiada.') } catch { toast.error('Não consegui copiar — use a pré-visualização.') }
  }
  // Lista pronta para mala direta (Outlook/Gmail): e-mail, assunto e corpo
  function exportList() {
    const list = shown.filter((f) => cfg.canais[f.key])
    if (!list.length) { toast.error('Nenhum fundo com e-mail de canal nesse filtro.'); return }
    const data = list.map((f) => { const m = msgOf(f); return { Fundo: f.fundo, CNPJ: f.cnpj, 'E-mail do canal': cfg.canais[f.key], Assunto: m.subject, Mensagem: m.body, Total: f.val, Status: f.status } })
    const ws = XLSX.utils.json_to_sheet(data)
    ws['!cols'] = [{ wch: 36 }, { wch: 20 }, { wch: 34 }, { wch: 40 }, { wch: 80 }, { wch: 14 }, { wch: 10 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Envios')
    XLSX.writeFile(wb, `notificacoes_slack_${curMes.replace('.', '_')}_${todayISO()}.xlsx`)
  }

  return (
    <div className="space-y-3 mb-4">
      <div className="glass rounded-2xl p-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-id-mid/15 text-id-dark dark:text-id-light flex items-center justify-center shrink-0"><Mail size={17} /></div>
          <div className="flex-1 min-w-[260px]">
            <div className="font-display font-semibold text-[14px]">Notificação das taxas nos canais do Slack</div>
            <p className="text-[12px] text-[var(--tx3)] mt-0.5 max-w-[760px]">
              Cada fundo recebe a mesma mensagem padrão com as taxas segregadas da competência. O envio é por e-mail para o canal do fundo no Slack —
              no Slack, abra o canal → <b>Configurações</b> → <b>Integrações</b> → <b>Enviar e-mails para este canal</b> e copie o endereço para cá.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setEditTpl(true)} className="btn btn-sm"><Settings2 size={13} /> Modelo da mensagem</button>
            <button onClick={() => setBulk(true)} className="btn btn-sm"><ListPlus size={13} /> Cadastrar canais em lote</button>
            <button onClick={exportList} className="btn btn-sm"><Download size={13} /> Exportar lista de envio</button>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-[200px_1fr_170px_210px] gap-2 mt-4">
          <select value={curMes} onChange={(e) => setMes(e.target.value)} className="field font-mono">
            {months.map((m) => <option key={m} value={m}>Competência {m}</option>)}
          </select>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--tx4)]" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar fundo, CNPJ ou gestor…" className="field pl-9" />
          </div>
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className="field">
            <option value="">Pagos e pendentes</option><option value="PENDENTE">Só pendentes</option><option value="PAGO">Só pagos</option>
          </select>
          <select value={fCanal} onChange={(e) => setFCanal(e.target.value)} className="field">
            <option value="">Todos os fundos</option><option value="com">Com canal cadastrado</option><option value="sem">Sem canal cadastrado</option><option value="naoenviado">Ainda não enviados</option>
          </select>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3 text-[11.5px] text-[var(--tx3)]">
          <span><b className="text-[var(--tx)]">{funds.length}</b> fundos na competência</span>
          <span><b className="text-[var(--tx)]">{comCanal}</b> com canal cadastrado</span>
          <span><b className="text-[var(--tx)]">{enviados}</b> já enviados</span>
        </div>
      </div>

      <div className="glass rounded-2xl overflow-hidden">
        <div className="overflow-auto max-h-[70vh]">
          <table className="w-full text-left min-w-[1100px] border-separate border-spacing-0">
            <thead className="sticky top-0 z-10">
              <tr className="text-[10px] font-mono uppercase tracking-wider text-[var(--tx3)]">
                {['Fundo', 'Taxas segregadas', 'Total', 'Status', 'E-mail do canal no Slack', ''].map((h, i) => (
                  <th key={i} className={`px-3 py-2.5 font-medium border-b border-[var(--bdr)] bg-[var(--sur)] ${h === 'Total' ? 'text-right' : ''}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((f) => {
                const sent = cfg.enviados[sentKey(f)]
                return (
                  <tr key={f.key} className="text-[12px] hover:bg-[var(--sur2)]/60 align-top">
                    <td className="px-3 py-2.5 border-b border-[var(--bdr)]/70 max-w-[280px]">
                      <div className="font-medium truncate" title={f.fundo}>{f.fundo}</div>
                      <div className="text-[10.5px] text-[var(--tx3)] font-mono">{f.cnpj || 'sem CNPJ'}{f.gestor ? ' · ' + f.gestor : ''}</div>
                    </td>
                    <td className="px-3 py-2.5 border-b border-[var(--bdr)]/70">
                      <div className="flex flex-wrap gap-1">
                        {TAXAS.filter((t) => f[t.key] > 0).map((t) => (
                          <span key={t.key} className="inline-flex items-center gap-1 text-[10.5px] rounded-md border border-[var(--bdr)] px-1.5 py-0.5">
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: t.color }} />{t.label} <b className="font-mono font-medium">{fmtShort(f[t.key])}</b>
                          </span>
                        ))}
                        {!TAXAS.some((t) => f[t.key] > 0) && <span className="text-[11px] text-[var(--tx4)]">sem taxas segregadas</span>}
                        {f.ajustes.length > 0 && <span className="text-[10px] rounded px-1.5 py-0.5 bg-sky-500/12 text-sky-600 dark:text-sky-400">{f.ajustes.length} ajuste(s)</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 border-b border-[var(--bdr)]/70 text-right font-mono font-semibold whitespace-nowrap">{fmtFull(f.val)}</td>
                    <td className="px-3 py-2.5 border-b border-[var(--bdr)]/70">
                      <span className={`inline-flex items-center gap-1 text-[10.5px] font-semibold rounded-full border px-2 py-1 ${f.status === 'PAGO' ? 'bg-id-mid/15 text-id-dark dark:text-id-light border-id-mid/30' : 'bg-amber-500/12 text-amber-700 dark:text-amber-400 border-amber-500/30'}`}>
                        {f.status === 'PAGO' ? <CheckCircle2 size={11} /> : <Clock size={11} />}{f.status === 'PAGO' ? 'Pago' : 'Pendente'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 border-b border-[var(--bdr)]/70 w-[300px]">
                      <input key={cfg.canais[f.key] || ''} defaultValue={cfg.canais[f.key] || ''} placeholder="canal-xyz@empresa.slack.com" type="email"
                        onBlur={(e) => { const v = e.target.value.trim(); if (v !== (cfg.canais[f.key] || '')) { if (v && !/^\S+@\S+\.\S+$/.test(v)) { toast.error('E-mail inválido.'); return } setCanal(f.key, v) } }}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur() }}
                        className="field py-1.5 text-[11.5px]" />
                      {sent && <div className="text-[10.5px] text-id-dark dark:text-id-light mt-1">✓ Enviado por {sent.by?.split(' ')[0] || '—'} em {new Date(sent.at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>}
                    </td>
                    <td className="px-3 py-2.5 border-b border-[var(--bdr)]/70">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => setPreview(f)} className="btn btn-sm" title="Pré-visualizar"><Eye size={13} /></button>
                        <button onClick={() => copy(f)} className="btn btn-sm" title="Copiar mensagem"><Copy size={13} /></button>
                        <button onClick={() => send(f)} disabled={!cfg.canais[f.key]} className="btn btn-sm btn-primary" title={cfg.canais[f.key] ? 'Abrir e-mail pronto para o canal' : 'Cadastre o e-mail do canal'}><Mail size={13} /> {sent ? 'Reenviar' : 'Enviar'}</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {!shown.length && <tr><td colSpan={6} className="px-4 py-12 text-center text-[12.5px] text-[var(--tx3)]">Nenhum fundo com esses filtros.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {preview && <PreviewModal f={preview} msg={msgOf(preview)} email={cfg.canais[preview.key]} onClose={() => setPreview(null)} onSend={() => { send(preview); setPreview(null) }} toast={toast} />}
      {editTpl && <TemplateModal tpl={cfg.template} sample={funds[0]} onClose={() => setEditTpl(false)} onSave={(t) => { save((c) => ({ ...c, template: t }), 'Modelo salvo.'); setEditTpl(false) }} />}
      {bulk && <BulkModal funds={allFunds} onClose={() => setBulk(false)} onSave={(map) => { save((c) => ({ ...c, canais: { ...c.canais, ...map } }), `${Object.keys(map).length} canal(is) cadastrado(s).`); setBulk(false) }} />}
    </div>
  )
}

function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={onClose} />
      <div className={`relative w-full ${wide ? 'max-w-[900px]' : 'max-w-[620px]'} max-h-[90vh] bg-[var(--sur)] border border-[var(--bdr)] rounded-2xl shadow-[var(--shadow-pop)] flex flex-col animate-fade-up`}>
        <div className="px-5 py-3.5 border-b border-[var(--bdr)] flex items-center gap-3">
          <div className="font-display font-semibold text-[15px] flex-1">{title}</div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--tx3)] hover:bg-[var(--sur2)]"><X size={16} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-[var(--bdr)] flex items-center gap-2 justify-end">{footer}</div>}
      </div>
    </div>
  )
}

function MessageBox({ msg }) {
  return (
    <div className="rounded-xl border border-[var(--bdr)] bg-[var(--sur2)] p-4">
      <div className="text-[10.5px] font-mono uppercase tracking-wider text-[var(--tx3)]">Assunto</div>
      <div className="text-[13px] font-semibold mb-3">{msg.subject}</div>
      <div className="text-[10.5px] font-mono uppercase tracking-wider text-[var(--tx3)]">Mensagem</div>
      <pre className="text-[12.5px] whitespace-pre-wrap font-sans leading-relaxed mt-1">{msg.body}</pre>
    </div>
  )
}

function PreviewModal({ f, msg, email, onClose, onSend, toast }) {
  return (
    <Modal title={`Mensagem · ${f.fundo}`} onClose={onClose}
      footer={<>
        <span className="text-[11.5px] text-[var(--tx3)] mr-auto truncate">{email ? `Para: ${email}` : 'Sem e-mail de canal cadastrado'}</span>
        <button onClick={async () => { try { await navigator.clipboard.writeText(msg.subject + '\n\n' + msg.body); toast.success('Copiado.') } catch { toast.error('Não consegui copiar.') } }} className="btn btn-sm"><Copy size={13} /> Copiar</button>
        <button disabled={!email} onClick={onSend} className="btn btn-sm btn-primary"><Mail size={13} /> Abrir e-mail</button>
      </>}>
      <MessageBox msg={msg} />
    </Modal>
  )
}

function TemplateModal({ tpl, sample, onClose, onSave }) {
  const [t, setT] = useState(tpl)
  const demo = sample || { fundo: 'FUNDO EXEMPLO FIDC', cnpj: '00.000.000/0001-00', gestor: 'Gestora X', conta: '12345', mesRef: '09.2026', adm: 15000, custodia: 1000, controladoria: 0, escrituracao: 0, distribuicao: 500, val: 16500, dataReceita: '2026-10-01', vencimento: '2026-10-05', status: 'PENDENTE', ajustes: [] }
  return (
    <Modal wide title="Modelo da mensagem" onClose={onClose}
      footer={<>
        <button onClick={() => setT(DEFAULT_TEMPLATE)} className="btn btn-sm mr-auto"><RotateCcw size={13} /> Restaurar padrão</button>
        <button onClick={onClose} className="btn btn-sm">Cancelar</button>
        <button onClick={() => onSave(t)} className="btn btn-sm btn-primary">Salvar modelo</button>
      </>}>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-3">
          <div><label className="label">Assunto</label><input value={t.subject} onChange={(e) => setT({ ...t, subject: e.target.value })} className="field" /></div>
          <div><label className="label">Mensagem</label><textarea value={t.body} onChange={(e) => setT({ ...t, body: e.target.value })} rows={16} className="field font-mono text-[12px] resize-y" /></div>
          <div>
            <div className="label flex items-center gap-1"><Info size={11} /> Campos disponíveis (clique para inserir)</div>
            <div className="flex flex-wrap gap-1">
              {PLACEHOLDERS.map(([p, d]) => <button key={p} type="button" title={d} onClick={() => setT({ ...t, body: t.body + p })} className="text-[10.5px] font-mono rounded-md border border-[var(--bdr)] px-1.5 py-0.5 hover:border-id-mid/50">{p}</button>)}
            </div>
          </div>
        </div>
        <div><div className="label">Pré-visualização ({demo.fundo})</div><MessageBox msg={renderMessage(t, demo)} /></div>
      </div>
    </Modal>
  )
}

function BulkModal({ funds, onClose, onSave }) {
  const [text, setText] = useState('')
  const parsed = parseChannelList(text, funds)
  const n = Object.keys(parsed.map).length
  return (
    <Modal title="Cadastrar canais em lote" onClose={onClose}
      footer={<>
        <span className="text-[11.5px] text-[var(--tx3)] mr-auto">{n} fundo(s) reconhecido(s){parsed.invalid ? ` · ${parsed.invalid} linha(s) inválida(s)` : ''}{parsed.unmatched ? ` · ${parsed.unmatched} CNPJ(s) não encontrado(s)` : ''}</span>
        <button onClick={onClose} className="btn btn-sm">Cancelar</button>
        <button disabled={!n} onClick={() => onSave(parsed.map)} className="btn btn-sm btn-primary">Salvar canais</button>
      </>}>
      <p className="text-[12px] text-[var(--tx3)] mb-2">Cole uma linha por fundo: <b>nome do fundo</b> (ou CNPJ) e o <b>e-mail do canal</b>, separados por ponto e vírgula ou tab — dá para copiar duas colunas direto do Excel. Um CNPJ vale para todos os fundos que aparecem com ele.</p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={12} className="field font-mono text-[12px]" placeholder={'TCN; fundo-tcn-aaaa@idsf.slack.com\nGALAXY FIDC; galaxy-bbbb@idsf.slack.com'} />
    </Modal>
  )
}
