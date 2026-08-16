import { useState } from 'react'
import { Table2, PenTool } from 'lucide-react'
import { PageHeader } from '../components/PageShell'
import { useBoard } from '../hooks/useBoard'
import BoardTable from '../components/board/BoardTable'
import BoardCanvas from '../components/board/BoardCanvas'
import TasksCorner from '../components/board/TasksCorner'

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

  if (!board || !board.type) {
    return (
      <ChooseType
        ownerName={ownerName}
        board={board}
        onSaveChecklist={save}
        onChoose={(type) => save(type === 'table'
          ? { ...board, type: 'table', ownerName, groups: board?.groups?.length ? board.groups : [{ id: 'g' + Date.now(), name: 'Geral', color: '#8FB352', columns: [{ id: 'c1', name: 'Item', type: 'text' }, { id: 'c2', name: 'Status', type: 'status' }], rows: [] }] }
          : { ...board, type: 'canvas', ownerName, canvasItems: board?.canvasItems || [] }
        )}
      />
    )
  }

  return (
    <div>
      <PageHeader
        eyebrow="Controle"
        title={ownerName}
        actions={
          <>
            <TasksCorner board={board} onSave={save} />
            <button
              onClick={() => { if (confirm('Trocar o tipo do quadro? Os dados do outro modo continuam salvos.')) save({ ...board, type: null }) }}
              className="text-[11px] text-[var(--tx3)] hover:text-[var(--tx)] border border-[var(--bdr)] rounded-lg px-2.5 py-1"
            >
              Trocar tipo de quadro
            </button>
          </>
        }
      />
      {board.type === 'table' ? <BoardTable board={board} onSave={save} /> : <BoardCanvas board={board} onSave={save} />}
    </div>
  )
}

function ChooseType({ ownerName, board, onSaveChecklist, onChoose }) {
  return (
    <div>
      <PageHeader eyebrow="Controle" title={ownerName} actions={<TasksCorner board={board} onSave={onSaveChecklist} />} />
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
