import React, { useEffect, useRef, useState } from 'react'

// ChartContainer is a lightweight wrapper that provides responsive size to charts.
// - Uses ResizeObserver when available to watch container size changes.
// - Falls back to window.resize when ResizeObserver is unavailable.
// - Passes size to children(size) for adaptive rendering.

type Size = { width: number; height: number }

export default function ChartContainer({ children, onSize }: { children: (size: Size)=>React.ReactNode, onSize?: (size: Size)=>void }){
  const ref = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })

  useEffect(()=>{
    const el = ref.current
    if(!el) return

    const update = () => {
      // Read DOM bounding rect and round width/height down to integers
      const r = el.getBoundingClientRect()
      const next = { width: Math.max(0, Math.floor(r.width)), height: Math.max(0, Math.floor(r.height)) }
      setSize(prev => {
        // Avoid unnecessary state updates: only setState when size changes
        if(prev.width === next.width && prev.height === next.height) return prev
        return next
      })
      if(onSize) onSize(next)
    }

    // Sync once immediately so children render with size on first paint
    update()

    // Prefer ResizeObserver; fall back to window.resize for older environments
    let ro: ResizeObserver | null = null
    try{
      ro = new ResizeObserver(()=> update())
      ro.observe(el)
    }catch(e){
      // ResizeObserver unavailable: fall back to window resize listener
      window.addEventListener('resize', update)
    }

    return ()=>{
      // Clean up observer or listener
      if(ro) ro.disconnect()
      else window.removeEventListener('resize', update)
    }
  }, [onSize])

  return (
    <div ref={ref} style={{ width: '100%', height: '100%', boxSizing: 'border-box', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>{children(size)}</div>
    </div>
  )
}
