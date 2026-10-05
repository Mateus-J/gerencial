import { useEffect, useRef, useState } from 'react'

const reduceMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// Número que "conta" até o valor novo sempre que ele muda (ease-out ~0,8s).
export default function AnimatedNumber({ value, format = (v) => Math.round(v).toLocaleString('pt-BR'), duration = 800 }) {
  const target = Number(value) || 0
  const [shown, setShown] = useState(target)
  const from = useRef(target)
  const raf = useRef(0)

  useEffect(() => {
    if (reduceMotion()) { from.current = target; setShown(target); return }
    const start = performance.now()
    const a = from.current
    const step = (t) => {
      const p = Math.min(1, (t - start) / duration)
      const e = 1 - Math.pow(1 - p, 3)
      const v = a + (target - a) * e
      setShown(v)
      from.current = v
      if (p < 1) raf.current = requestAnimationFrame(step)
    }
    raf.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf.current)
  }, [target, duration])

  return <>{format(shown)}</>
}
