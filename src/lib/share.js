import { doc } from 'firebase/firestore'
import { db } from './firebase'

// Links de consulta da tela de Taxa de Administração: { links: { token: { label, active, … } } }
export const SHARE_REF = () => doc(db, 'controle', 'taxa_adm_share')
export const consultaUrl = (token) => `${window.location.origin}/consulta/taxa-adm?t=${token}`
