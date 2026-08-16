import { Clock, LogOut } from 'lucide-react'
import { useAuth } from '../context/AuthContext'

export default function PendingApproval() {
  const { currentUser, logout } = useAuth()
  return (
    <div className="h-screen w-screen flex items-center justify-center bg-[var(--bg)]">
      <div className="w-full max-w-[360px] px-6 text-center">
        <div className="w-14 h-14 rounded-full bg-amber-500/15 flex items-center justify-center mx-auto mb-4">
          <Clock size={22} className="text-amber-400" />
        </div>
        <h1 className="font-display text-[16px] font-semibold mb-1">Cadastro em análise</h1>
        <p className="text-[12.5px] text-[var(--tx3)] mb-1">Olá, {currentUser?.name}. Sua solicitação de acesso foi enviada.</p>
        <p className="text-[12.5px] text-[var(--tx3)] mb-6">Assim que um administrador aprovar, você poderá entrar normalmente.</p>
        <button onClick={() => logout()} className="flex items-center gap-1.5 justify-center w-full border border-[var(--bdr)] rounded-lg py-2 text-[12.5px] text-[var(--tx2)] hover:bg-[var(--sur2)] mx-auto">
          <LogOut size={13} /> Sair
        </button>
      </div>
    </div>
  )
}
