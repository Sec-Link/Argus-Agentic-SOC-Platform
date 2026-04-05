import React, { useEffect, useRef, useState } from 'react'
import { Button, Input } from 'antd'
import ChartContainer from './ChartContainer'

// Panel wraps each dashboard panel and provides:
// - Title display and inline edit in edit mode
// - Configure / Remove actions in edit mode
// - Responsive sizing for children via ChartContainer

type ChildRenderer = ((size:{width:number,height:number})=>React.ReactNode) | React.ReactNode

export default function Panel({ panel, onConfigure, onRemove, children, isEditMode, onTitleChange }:{ panel:any, onConfigure:Function, onRemove:Function, children?: ChildRenderer, isEditMode?:boolean, onTitleChange?: (newTitle:string)=>void }){
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(panel.config?.title || `Panel ${panel.i}`)
  const inputRef = useRef<any>(null)

  // Keep title in sync with panel config changes
  useEffect(()=>{
    setTitle(panel.config?.title || `Panel ${panel.i}`)
  }, [panel.config?.title, panel.i])

  // Focus input when entering edit mode
  useEffect(()=>{
    if(editing && inputRef.current) inputRef.current.focus()
  }, [editing])

  function finishEdit(){
    setEditing(false)
    // If title changed, call onTitleChange to persist
    if(onTitleChange && title !== (panel.config?.title || `Panel ${panel.i}`)){
      onTitleChange(title)
    }
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid #d6e8ff', background: '#f5faff', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }} className="panel-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Title: inline edit in edit mode. no-drag prevents drag when clicking title */}
          {isEditMode ? (
            editing ? (
              <Input ref={inputRef} size="small" value={title} onChange={e=>setTitle(e.target.value)} onBlur={finishEdit} onPressEnter={finishEdit} className="no-drag" style={{ width: 200 }} />
            ) : (
              <div className="no-drag" onClick={()=>setEditing(true)} style={{ fontWeight: 600, cursor: 'text' }}>{title}</div>
            )
          ) : (
            <div style={{ fontWeight: 600 }}>{title}</div>
          )}
        </div>
        <div>
          {isEditMode ? (
            <>
              {/* Stop propagation to avoid triggering drag on click */}
              <Button size="small" onClick={(e)=>{ e.stopPropagation(); onConfigure(panel) }}>Configure</Button>
              <Button size="small" danger onClick={(e)=>{ e.stopPropagation(); onRemove(panel.i) }} style={{ marginLeft: 8 }}>Remove</Button>
            </>
          ) : null}
        </div>
      </div>

      <div className="panel-content no-drag" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Use ChartContainer to measure size for children renderer.
            If children is a ReactNode, render inside a responsive container. */}
        {typeof children === 'function' ? (
          <ChartContainer>
            {(size)=> (
              <div style={{ width: '100%', height: '100%', overflow: 'auto' }}>
                {children(size)}
              </div>
            )}
          </ChartContainer>
        ) : (
          <div style={{ width: '100%', height: '100%', overflow: 'auto' }}>
            {children}
          </div>
        )}
      </div>
    </div>
  )
}
