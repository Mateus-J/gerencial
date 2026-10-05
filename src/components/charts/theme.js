import { useIsDark } from '../../hooks/useIsDark'

// Paleta categórica (validada: faixa de luminosidade, croma, separação para
// daltonismo e contraste contra a superfície de cada tema). A ordem importa.
export const SERIES = {
  dark: ['#6a9f3c', '#3987e5', '#d95926', '#9085e9', '#d55181'],
  light: ['#4f8a2a', '#2a78d6', '#eb6834', '#4a3aa7', '#e87ba4'],
}
// Status (pago / em aberto / vencido) — reservado, sempre com ícone + rótulo.
export const STATUS_COLORS = { good: '#0ca30c', warning: '#fab219', critical: '#d03b3b' }
export const OTHER_COLOR = { dark: '#5b6675', light: '#a3abb5' }

export function useChartTheme() {
  const dark = useIsDark()
  return {
    dark,
    series: dark ? SERIES.dark : SERIES.light,
    other: dark ? OTHER_COLOR.dark : OTHER_COLOR.light,
    surface: dark ? '#0f141b' : '#ffffff',
    grid: dark ? 'rgba(148,180,200,.09)' : 'rgba(15,40,30,.08)',
    axis: dark ? '#7b8796' : '#6b7682',
    cursor: dark ? 'rgba(143,179,82,.55)' : 'rgba(68,114,62,.45)',
    band: dark ? 'rgba(143,179,82,.07)' : 'rgba(68,114,62,.06)',
  }
}

export const toggleIn = (set, key) => { const n = new Set(set); if (n.has(key)) n.delete(key); else n.add(key); return n }
