import { useEffect, useState } from 'react'

// Acompanha a classe .dark do <html> — os gráficos (SVG do Recharts) não
// resolvem var(--...) em atributos, então precisam das cores concretas.
export function useIsDark() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  useEffect(() => {
    const obs = new MutationObserver(() => setDark(document.documentElement.classList.contains('dark')))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])
  return dark
}

export function chartTheme(dark) {
  return dark
    ? { grid: '#262b35', axis: '#7b8594', tipBg: '#171a21', tipBdr: '#2a2e38', tipTx: '#f1f5f9' }
    : { grid: '#e7eaef', axis: '#7a8491', tipBg: '#ffffff', tipBdr: '#e2e5eb', tipTx: '#14171c' }
}
