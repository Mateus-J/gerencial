import { useState } from 'react'
import { Table2, PenTool, Activity, ChevronDown } from 'lucide-react'
import { PageHeader, Card } from '../components/PageShell'
import { useBoard } from '../hooks/useBoard'
import { useAuth } from '../context/AuthContext'
import BoardTable from '../components/board/BoardTable'
import BoardCanvas from '../components/board/BoardCanvas'

function timeAgo(ts) {
  if (!ts) return '—'
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return min + 'min atrás'
  const h = Math.floor(min / 60)
  if (h < 24) return h + 'h atrás'
  const d = Math.floor(h / 24)
  return d + 'd atrás'
}

// Descreve a mudança comparando o quadro antes/depois — dá pra saber o que
// rolou (grupo, item, coluna, elemento do canvas) sem instrumentar cada botão.
function describeChange(prev, next) {
  if (!prev) return `criou o quadro (${next.type === 'table' ? 'Tabela' : 'Canvas'})`
  if (prev.type !== next.type) return `trocou o tipo do quadro para ${next.type === 'table' ? 'Tabela' : 'Canvas'}`
  if (next.type === 'table') {
    const pg = prev.groups || [], ng = next.groups || []
    if (ng.length > pg.length) return 'adicionou um grupo'
    if (ng.length < pg.length) return 'removeu um grupo'
    const prows = pg.reduce((a, g) => a + (g.rows?.length || 0), 0)
    const nrows = ng.reduce((a, g) => a + (g.rows?.length || 0), 0)
    if (nrows > prows) return 'adicionou um item'
    if (nrows < prows) return 'removeu um item'
    const pcols = pg.reduce((a, g) => a + (g.columns?.length || 0), 0)
    const ncols = ng.reduce((a, g) => a + (g.columns?.length || 0), 0)
    if (ncols > pcols) return 'adicionou uma coluna'
    if (ncols < pcols) return 'removeu uma coluna'
    return 'editou o quadro'
  }
  const pi = prev.canvasItems || [], ni = next.canvasItems || []
  if (ni.length > pi.length) return 'adicionou um elemento ao canvas'
  if (ni.length < pi.length) return 'removeu um elemento do canvas'
  return 'editou o canvas'
}

export default function Quadro({ slug, ownerName }) {
  const { currentUser } = useAuth()
  const { board, loading, save } = useBoard(slug)
  const [showActivity, setShowActivity] = useState(true)

  async function saveWithLog(next) {
    const entry = { ts: Date.now(), user: currentUser?.name || currentUser?.username, action: describeChange(board, next) }
    const activityLog = [entry, ...(board?.activityLog || [])].slice(0, 100)
    await save({ ...next, activityLog })
  }

  if (loading) {
    return (
      <div>
        <PageHeader eyebrow="Controle" title={ownerName} />
        <div className="text-center py-16 text-[var(--tx3)] text-[12.5px]">Carregando…</div>
      </div>
    )
  }

  if (!board || !board.type) {
    return <ChooseType ownerName={ownerName} onChoose={(type) => saveWithLog(type === 'table'
      ? { type: 'table', ownerName, groups: [{ id: 'g' + Date.now(), name: 'Geral', color: '#8FB352', columns: [{ id: 'c1', name: 'Item', type: 'text' }, { id: 'c2', name: 'Status', type: 'status' }], rows: [] }] }
      : { type: 'canvas', ownerName, canvasItems: [] }
    )} />
  }

  const activityLog = board.activityLog || []

  return (
    <div>
      <PageHeader
        eyebrow="Controle"
        title={ownerName}
        actions={
          <button
            onClick={() => { if (confirm('Trocar o tipo do quadro? Os dados do outro modo continuam salvos.')) saveWithLog({ ...board, type: null }) }}
            className="text-[11px] text-[var(--tx3)] hover:text-[var(--tx)] border border-[var(--bdr)] rounded-lg px-2.5 py-1"
          >
            Trocar tipo de quadro
          </button>
        }
      />
      {board.type === 'table' ? <BoardTable board={board} onSave={saveWithLog} /> : <BoardCanvas board={board} onSave={saveWithLog} />}

      <Card className="mt-4">
        <button onClick={() => setShowActivity((s) => !s)} className="w-full flex items-center justify-between px-4 py-2.5">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase text-[var(--tx3)]">
            <Activity size={13} /> Atividades {activityLog.length > 0 && `(${activityLog.length})`}
          </span>
          <ChevronDown size={14} className={`text-[var(--tx3)] transition-transform ${showActivity ? 'rotate-180' : ''}`} />
        </button>
        {showActivity && (
          <div className="border-t border-[var(--bdr)] max-h-[240px] overflow-y-auto">
            {!activityLog.length ? (
              <div className="px-4 py-4 text-[12px] text-[var(--tx3)] text-center">Nenhuma atividade registrada ainda.</div>
            ) : (
              <div className="divide-y divide-[var(--bdr)]/60">
                {activityLog.map((a, i) => (
                  <div key={i} className="flex items-center gap-2.5 px-4 py-2">
                    <div className="w-6 h-6 rounded-full bg-[var(--sur2)] flex items-center justify-center text-[10px] font-semibold text-[var(--tx2)] shrink-0">
                      {(a.user || '?').split(' ').slice(0, 2).map((w) => w[0] || '').join('').toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1 text-[12px]">
                      <span className="font-medium">{a.user}</span> <span className="text-[var(--tx3)]">{a.action}</span>
                    </div>
                    <div className="text-[10.5px] text-[var(--tx3)] shrink-0">{timeAgo(a.ts)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  )
}

function ChooseType({ ownerName, onChoose }) {
  return (
    <div>
      <PageHeader eyebrow="Controle" title={ownerName} />
      <p className="text-[12.5px] text-[var(--tx3)] mb-4">Escolha como você quer organizar o seu quadro.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-[560px]">
        <button onClick={() => onChoose('table')} className="text-left bg-[var(--sur)] border border-[var(--bdr)] hover:border-id-mid rounded-xl p-5 shadow-card transition-colors">
          <Table2 size={22} className="text-id-dark dark:text-id-light mb-2" />
          <div className="font-display font-semibold text-[14px] mb-1">Tabela</div>
          <p className="text-[11.5px] text-[var(--tx3)]">Grupos, linhas e colunas — tipo planilha/Monday. Bom pra listas, controles e checklists.</p>
        </button>
        <button onClick={() => onChoose('canvas')} className="text-left bg-[var(--sur)] border border-[var(--bdr)] hover:border-id-mid rounded-xl p-5 shadow-card transition-colors">
          <PenTool size={22} className="text-id-dark dark:text-id-light mb-2" />
          <div className="font-display font-semibold text-[14px] mb-1">Canvas livre</div>
          <p className="text-[11.5px] text-[var(--tx3)]">Notas soltas que você arrasta pela tela. Bom pra fluxos, mapas mentais, rascunhos.</p>
        </button>
      </div>
    </div>
  )
}
