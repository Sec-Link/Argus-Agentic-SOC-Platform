import React, { useEffect, useMemo, useState } from 'react'
import { Tooltip } from 'antd'

export type AggRow = { technique_id?: string, count: number }

const MITRE_URL = 'https://raw.githubusercontent.com/mitre/cti/master/enterprise-attack/enterprise-attack.json'

function normalizePhase(name: string){
  return (name || '').toLowerCase().replace(/\s+/g,'-')
}

function colorForFraction(t: number){
  // if zero, use a subtle gray so zero-count techniques are visible
  if(!t || t <= 0) return '#f3f4f6'
  // white -> orange -> red
  const a = [255,255,255]
  const b = [215,48,39]
  const mix = a.map((v,i)=> Math.round(v + (b[i]-v)*t))
  return `rgb(${mix.join(',')})`
}

export default function MitreAttackHeatmap({ aggRows, displayMode }:{ aggRows: AggRow[], displayMode?: 'name' | 'id' }){
  const [matrix, setMatrix] = useState<any|null>(null)
  const [loadingMap, setLoadingMap] = useState<boolean>(false)
  const rows = Array.isArray(aggRows) ? aggRows : []

  useEffect(()=>{
    let mounted = true
    setLoadingMap(true)
    fetch(MITRE_URL).then(r=>r.json()).then((bundle:any) => {
      if(!mounted) return
      let objs = bundle.objects || []
      // filter out revoked or deprecated objects
      objs = objs.filter((o:any)=> !o.revoked && !o.x_mitre_deprecated)
      const tacticsById: Record<string, any> = {}
      objs.filter((o:any)=> o.type === 'x-mitre-tactic').forEach((t:any)=> tacticsById[t.id] = t)
      // find matrix and its ordered tactic refs
      const matrixObj = objs.find((o:any)=> o.type === 'x-mitre-matrix' && (o.external_references || []).some((er:any)=> er.external_id === 'enterprise-attack'))
      const tacticOrder = (matrixObj && matrixObj.tactic_refs) ? matrixObj.tactic_refs.map((id:string)=> tacticsById[id]).filter(Boolean) : Object.values(tacticsById)
      // normalize tactic names and map to short keys used by kill_chain_phases (phase_name)
      const tactics = tacticOrder.map((t:any)=> ({ id: t.id, name: t.name, key: normalizePhase(t.name) }))

      // collect attack-pattern (techniques)
      const techniques = objs.filter((o:any)=> o.type === 'attack-pattern')
      const techMap: Record<string, any> = {}
      techniques.forEach((tech:any)=>{
        const refs = tech.external_references || []
        const ext = refs.find((r:any)=> r.source_name === 'mitre-attack' && r.external_id && r.external_id.startsWith('T'))
        if(!ext) return
        const tid = ext.external_id
        const name = tech.name
        const phases = (tech.kill_chain_phases || []).map((p:any)=> p.phase_name)
        techMap[tid] = { id: tid, name, phases }
      })

      // group techniques by tactic key using kill_chain_phases phase_name
      const grouped: Record<string, any[]> = {}
      Object.values(techMap).forEach((t:any)=>{
        const phase = (t.phases && t.phases[0]) ? normalizePhase(t.phases[0]) : null
        const key = phase || 'other'
        if(!grouped[key]) grouped[key] = []
        grouped[key].push(t)
      })

      // ensure consistent ordering for each tactic
      tactics.forEach((tk:any)=> grouped[tk.key] = (grouped[tk.key] || []).sort((a:any,b:any)=> a.id.localeCompare(b.id)))

      setMatrix({ tactics, grouped })
    }).catch((e)=>{
      console.error('Failed to load MITRE mapping', e)
    }).finally(()=> setLoadingMap(false))
    return ()=>{ mounted = false }
  }, [])

  const { tactics, cells, maxCount, countsMap, detailsMap } = useMemo(()=>{
    // build counts map from aggRows, and also aggregate sub-techniques into parent techniques
    const counts = new Map<string, number>()
    const details = new Map<string, Set<string>>()
    let max = 0
    function parentOf(tid: string){
      // T1078.001 -> T1078
      const m = tid.match(/^(T\d+)(?:\.|$)/i)
      return m ? m[1].toUpperCase() : tid.toUpperCase()
    }
    for(const r of rows){
      const raw = (r.technique_id || '').toString().trim()
      if(!raw) continue
      const id = raw.toUpperCase()
      const parent = parentOf(id)
      const c = Number(r.count) || 0
      counts.set(parent, (counts.get(parent) || 0) + c)
      max = Math.max(max, counts.get(parent) || 0)
      // track details: which specific sub-ids contributed to this parent
      if(!details.has(parent)) details.set(parent, new Set())
      details.get(parent)!.add(id)
    }

    if(!matrix) return { tactics: [], cells: [], maxCount: max, countsMap: counts, detailsMap: details }

    const tacticsList = matrix.tactics as any[]
    // compute rows per tactic = max techniques length
    const perTactic: Record<string, any[]> = {}
    // collapse sub-techniques into parent technique entries
    tacticsList.forEach((t:any)=>{
      const raw = matrix.grouped[t.key] || []
      const parentMap = new Map<string, { id:string, name:string, children: Set<string> }>()
      raw.forEach((tech:any)=>{
        const p = parentOf(tech.id)
        if(!parentMap.has(p)){
          // prefer explicit parent entry name if present in the raw list, otherwise use this tech's name
          const parentEntry = raw.find((x:any)=> x.id === p)
          const name = parentEntry ? parentEntry.name : tech.name
          parentMap.set(p, { id: p, name, children: new Set([tech.id]) })
        } else {
          parentMap.get(p)!.children.add(tech.id)
        }
      })
      // convert to array of parent entries
      perTactic[t.key] = Array.from(parentMap.values()).map(v=> ({ id: v.id, name: v.name, children: Array.from(v.children) }))
    })
    const rowsCount = Math.max(...Object.values(perTactic).map(arr=> arr.length || 1))

    const cellsOut: Array<{ tacticIdx:number, rowIdx:number, tid:string|null, name?:string, count:number }>=[]
    tacticsList.forEach((t:any, ti:number)=>{
      const arr = perTactic[t.key] || []
      for(let ri=0; ri<rowsCount; ri++){
        const parent = arr[ri]
        const tid = parent ? parent.id : null
        const name = parent ? parent.name : null
        const count = tid ? (counts.get(tid) || 0) : 0
        cellsOut.push({ tacticIdx: ti, rowIdx: ri, tid, name, count })
      }
    })
    return { tactics: tacticsList, cells: cellsOut, maxCount: max, countsMap: counts, detailsMap: details }
  }, [matrix, rows])

  if(loadingMap) return <div style={{ padding: 12 }}>Loading MITRE mapping...</div>

  if(!matrix) return (
    <div style={{ padding: 12 }}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>MITRE ATT&CK Heatmap</div>
      <div style={{ color: '#666' }}>Mapping not available</div>
    </div>
  )

  const cols = tactics.length
  const rowsCount = cells.length / Math.max(1, cols)

  // build legend buckets (5 steps) based on maxCount
  const legendBuckets = [] as { count:number, color:string }[]
  if(maxCount > 0){
    const steps = 4
    for(let i=0;i<=steps;i++){
      const frac = i/steps
      const count = Math.round(frac * maxCount)
      legendBuckets.push({ count, color: colorForFraction(frac) })
    }
  }

  return (
    <div style={{ width: '100%', height: '100%', padding: 8, boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontWeight: 600 }}>MITRE ATT&CK Heatmap</div>
        {legendBuckets.length > 0 ? (
          (() => {
            // build CSS linear-gradient from same color ramp
            const stops = legendBuckets.map((b, i) => `${b.color} ${Math.round((i/(legendBuckets.length-1))*100)}%`)
            const gradient = `linear-gradient(90deg, ${stops.join(', ')})`
            const minLabel = legendBuckets[0]?.count ?? 0
            const maxLabel = legendBuckets[legendBuckets.length-1]?.count ?? 0
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ fontSize: 12, color: '#333' }}>{minLabel}</div>
                <div style={{ width: 160, height: 12, background: gradient, borderRadius: 6, border: '1px solid #ddd' }} />
                <div style={{ fontSize: 12, color: '#333' }}>{maxLabel}</div>
              </div>
            )
          })()
        ) : null}
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(90px, 1fr))`, gridAutoRows: 'minmax(36px, auto)', gap: 0, width: '100%', alignContent: 'start' }}>
        {tactics.map((t:any, i:number)=> (
          <div key={t.key} style={{ fontWeight: 700, padding: '4px 6px', textAlign: 'center', fontSize: 12 }}>{t.name}</div>
        ))}

        {/* render rows */}
        {Array.from({ length: rowsCount }).map((_, ri)=> (
          <React.Fragment key={`row-${ri}`}>
            {tactics.map((t:any, ti:number)=>{
              const cell = cells.find(c=> c.tacticIdx === ti && c.rowIdx === ri)
              const parentTid = cell && cell.tid ? cell.tid : null
              const cnt = parentTid ? (countsMap!.get(parentTid) || 0) : 0
              const tfrac = maxCount > 0 ? Math.min(1, cnt / maxCount) : 0
              const bg = colorForFraction(tfrac)
              // build hover showing only the top-level technique id and name (no sub-technique list)
              const title = parentTid ? `${cell?.name || parentTid} — ${parentTid}: ${cnt}` : ''
              // displayMode: 'name' shows technique name in cell; 'id' shows technique id
              const displayName = (displayMode === 'id') ? (parentTid || '') : (cell?.name || parentTid || '')
              const shortName = displayName.length > 36 ? displayName.slice(0,36).trim() + '…' : displayName
              const outerStyle: React.CSSProperties = parentTid ? {
                minHeight: 36,
                maxHeight: 120,
                borderRadius: 0,
                border: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: bg,
                color: tfrac>0.5 ? '#fff' : '#111',
                fontSize: 11,
                padding: '4px 6px',
                boxSizing: 'border-box',
                overflow: 'hidden'
              } : {
                // empty slot: keep sizing but invisible
                minHeight: 36,
                maxHeight: 120,
                borderRadius: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'transparent',
                border: 'none',
                padding: '4px 6px',
                boxSizing: 'border-box'
              }

              if(parentTid){
                return (
                  <Tooltip key={`${ti}-${ri}`} title={<div style={{ whiteSpace: 'pre-line' }}>{title}</div>}>
                    <div style={outerStyle}>
                      <div style={{ fontWeight: 700, textAlign: 'center', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', width: '100%', fontSize: 11 }}>{shortName}</div>
                    </div>
                  </Tooltip>
                )
              }

              // empty cell (no technique at this position) - render blank outer container
              return (
                <div key={`${ti}-${ri}`} style={outerStyle} />
              )
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
    </div>
  )
}
