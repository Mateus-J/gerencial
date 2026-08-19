import { createContext, useCallback, useContext, useRef, useState } from 'react'
import { CheckCircle2, XCircle, Info, X } from 'lucide-react'

const ToastContext = createContext(null)

const ICONS = { success: CheckCircle2, error: XCircle, info: Info }
const STYLES = {
  success: 'border-id-mid/40 text-id-light',
  error: 'border-red-500/40 text-red-400',
  info: 'border-sky-500/40 text-sky-400',
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const counter = useRef(0)

  const remove = useCallback((id) => {
    setToasts((t) => t.filter((x) => x.id !== id))
  }, [])

  const push = useCallback((type, message, action) => {
    const id = ++counter.current
    setToasts((t) => [...t, { id, type, message, action }])
    setTimeout(() => remove(id), action ? 7000 : 4000)
  }, [remove])

  const api = {
    success: (msg, action) => push('success', msg, action),
    error: (msg, action) => push('error', msg, action),
    info: (msg, action) => push('info', msg, action),
  }

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-[320px] max-w-[calc(100vw-2rem)]">
        {toasts.map((t) => {
          const Icon = ICONS[t.type]
          return (
            <div
              key={t.id}
              className={`flex items-start gap-2.5 bg-[var(--sur)] border ${STYLES[t.type]} rounded-xl px-3.5 py-3 shadow-card animate-toast-in`}
            >
              <Icon size={17} className="shrink-0 mt-0.5" />
              <span className="text-[12.5px] text-[var(--tx)] leading-snug flex-1">{t.message}</span>
              {t.action && (
                <button
                  onClick={() => { t.action.onClick(); remove(t.id) }}
                  className="shrink-0 text-[12px] font-semibold text-id-light hover:underline"
                >
                  {t.action.label}
                </button>
              )}
              <button onClick={() => remove(t.id)} className="shrink-0 mt-0.5 text-[var(--tx4)] hover:text-[var(--tx2)]">
                <X size={13} />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
