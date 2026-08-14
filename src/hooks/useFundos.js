import { useEffect, useState, useCallback } from 'react'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import FUNDOS_BASE from '../data/fundos.json'

const DOC_REF = () => doc(db, 'controle', 'fundos_extra')

// Combina a base estática (592 fundos, vem embutida no app) com os fundos
// incluídos manualmente ou importados via CSV da CVM (ficam no Firestore).
export function useFundos() {
  const [extra, setExtra] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true
    getDoc(DOC_REF())
      .then((snap) => { if (mounted && snap.exists()) setExtra(snap.data().items || []) })
      .catch((e) => console.warn('fundosExtraLoad err', e))
      .finally(() => mounted && setLoading(false))
    return () => { mounted = false }
  }, [])

  const persist = useCallback(async (nextExtra) => {
    setExtra(nextExtra)
    await setDoc(DOC_REF(), { items: nextExtra, updatedAt: Date.now() }, { merge: false })
  }, [])

  // extra tem prioridade sobre a base estática quando o CNPJ bate (permite corrigir/atualizar)
  const byCnpj = new Map()
  FUNDOS_BASE.forEach((f) => byCnpj.set(f.cnpj, f))
  extra.forEach((f) => byCnpj.set(f.cnpj, f))
  const all = Array.from(byCnpj.values())

  return { all, extra, loading, persist }
}
