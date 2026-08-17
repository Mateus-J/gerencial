import { useEffect, useState, useCallback } from 'react'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'

const DOC_REF = (slug) => doc(db, 'controle', 'board_' + slug)

export function useBoard(slug) {
  const [board, setBoard] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!slug) return
    let mounted = true
    setLoading(true)
    getDoc(DOC_REF(slug))
      .then((snap) => { if (mounted) setBoard(snap.exists() ? snap.data() : null) })
      .catch((e) => console.warn('boardLoad err', e))
      .finally(() => mounted && setLoading(false))
    return () => { mounted = false }
  }, [slug])

  const save = useCallback(async (next) => {
    setBoard(next)
    // merge:true é proposital aqui: o objeto local pode estar desatualizado
    // (ex.: tarefas cadastradas em outra aba/sessão enquanto este quadro já
    // estava aberto) — com merge:false isso apagaria campos que não estão
    // no estado local. merge:true só atualiza as chaves enviadas.
    try { await setDoc(DOC_REF(slug), next, { merge: true }) } catch (e) { console.warn('boardSave err', e) }
  }, [slug])

  return { board, loading, save }
}

export function slugify(name) {
  return (name || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

export const COLABORADORES = [
  { slug: 'andre-castro', name: 'André Castro' },
  { slug: 'samuel-franzon', name: 'Samuel Franzon' },
  { slug: 'jessica-santos', name: 'Jessica Santos' },
  { slug: 'raul-pereira', name: 'Raul Pereira' },
  { slug: 'allan-borges', name: 'Allan Borges' },
]
