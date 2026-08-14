import { useMemo, useState } from 'react'
import { Download, Plus, MessageCircle } from 'lucide-react'
import { PageHeader, Card } from '../components/PageShell'
import KpiCard from '../components/KpiCard'
import StatusBadge from '../components/StatusBadge'

// TODO: substituir por dados reais do Firestore (coleção equivalente a
// 'pendencias' no app atual). Estrutura mantida igual à do app antigo para
// facilitar o replace direto do onSnapshot.
const MOCK_ROWS = [
  { fundo: 'SQUID UNO FUNDO DE I…', ocorrencia: 'Pagamento de Nota', responsavel: 'Allan Borges', alcada: 'Liquidação', status: 'Pendente', criadoEm: '13/08/2026' },
  { fundo: 'FIDC PLURIS FUNDO DE I…', ocorrencia: 'Taxa de Administração', responsavel: 'Mateus Jesus', alcada: 'Liquidação', status: 'Pendente', criadoEm: '12/08/2026' },
  { fundo: 'CESSIONÁRIO 1 FUNDO D…', ocorrencia: 'Pagamento de Nota', responsavel: 'Allan Borges', alcada: 'Liquidação', status: 'Pendente', criadoEm: '12/08/2026' },
  { fundo: 'PFC FUNDO DE INVESTI…', ocorrencia: 'Pagamento de Nota', responsavel: 'Allan Borges', alcada: 'Liquidação', status: 'Concluída', criadoEm: '11/08/2026' },
]

export default function Dashboard() {
  const [q, setQ] = useState('')

  const rows = useMemo(
    () => MOCK_ROWS.filter((r) => r.fundo.toLowerCase().includes(q.toLowerCase())),
    [q]
  )
  const pendentes = rows.filter((r) => r.status === 'Pendente').length
  const concluidas = rows.filter((r) => r.status === 'Concluída').length

  return (
    <div>
      <PageHeader
        eyebrow="Área Liquidação · Em aberto"
        title="Pendências Liquidação"
        actions={
          <>
            <button className="flex items-center gap-1.5 text-[12px] border border-bg-border rounded-lg px-3 py-1.5 text-slate-300 hover:bg-bg-panel2">
              <Download size={13} /> Exportar Excel
            </button>
            <button className="flex items-center gap-1.5 text-[12px] bg-id-dark hover:bg-id-mid rounded-lg px-3 py-1.5 font-medium">
              <Plus size={13} /> Nova pendência
            </button>
          </>
        }
      />

      <div className="flex flex-wrap gap-3 mb-4">
        <KpiCard label="Pendentes" value={pendentes} sub="em aberto" accent="amber" />
        <KpiCard label="Concluídas" value={concluidas} sub={`${Math.round((concluidas / (rows.length || 1)) * 100)}% do total`} accent="green" />
        <KpiCard label="Total" value={rows.length} sub="registros" accent="blue" />
      </div>

      <Card>
        <div className="p-3 border-b border-bg-border">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar fundo, ocorrência ou detalhamento…"
            className="w-full bg-bg-panel2 border border-bg-border rounded-lg px-3 py-2 text-[12px] outline-none focus:border-id-mid placeholder:text-slate-500"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10.5px] uppercase tracking-wider text-slate-500 border-b border-bg-border">
                <th className="px-4 py-2.5 font-medium">Fundo</th>
                <th className="px-4 py-2.5 font-medium">Ocorrência</th>
                <th className="px-4 py-2.5 font-medium">Responsável</th>
                <th className="px-4 py-2.5 font-medium">Alçada</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Criado em</th>
                <th className="px-4 py-2.5 font-medium text-right"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-bg-border/60 hover:bg-bg-panel2/60 text-[12.5px]">
                  <td className="px-4 py-3 font-medium">{r.fundo}</td>
                  <td className="px-4 py-3">
                    <span className="text-[10.5px] font-mono bg-sky-500/10 text-sky-300 px-1.5 py-0.5 rounded-md">
                      {r.ocorrencia}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-300">{r.responsavel}</td>
                  <td className="px-4 py-3">
                    <span className="text-[10.5px] font-mono bg-bg-panel2 border border-bg-border px-1.5 py-0.5 rounded-md text-slate-400">
                      {r.alcada}
                    </span>
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                  <td className="px-4 py-3 text-slate-400">{r.criadoEm}</td>
                  <td className="px-4 py-3 text-right">
                    {r.status === 'Pendente' && (
                      <button className="text-[11px] bg-id-mid/20 text-id-light border border-id-mid/40 rounded-md px-2.5 py-1 hover:bg-id-mid/30">
                        Concluir
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between px-4 py-2.5 text-[11px] text-slate-500 border-t border-bg-border">
          <span className="flex items-center gap-1.5">
            <MessageCircle size={12} /> Abrir chamado no Slack
          </span>
          <span>{rows.length} registros · exibindo só abertas</span>
        </div>
      </Card>
    </div>
  )
}
