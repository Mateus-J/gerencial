import { PageHeader } from '../components/PageShell'
import { useBoard } from '../hooks/useBoard'
import BoardChecklist from '../components/board/BoardChecklist'

export default function Quadro({ slug, ownerName }) {
  const { board, loading, save } = useBoard(slug)

  if (loading) {
    return (
      <div>
        <PageHeader eyebrow="Controle" title={ownerName} />
        <div className="text-center py-16 text-[var(--tx3)] text-[12.5px]">Carregando…</div>
      </div>
    )
  }

  return (
    <div>
      <PageHeader eyebrow="Controle" title={ownerName} />
      <BoardChecklist board={board || {}} onSave={save} />
    </div>
  )
}
