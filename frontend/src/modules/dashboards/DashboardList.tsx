import React, { useEffect, useState } from 'react'
import { listDashboards, createDashboard, deleteDashboard } from 'services/dashboards'
import { Button, Space, Modal } from 'antd'

// DashboardList shows dashboard list with create/edit/delete.
// Design:
// - Load dashboards via listDashboards
// - After create, jump to editor via onEdit for quick setup
export default function DashboardList({ onEdit }:{ onEdit?:(id?:string)=>void }){
  const [list, setList] = useState<any[]>([])
  // Load dashboard list into state
  function reload(){
    listDashboards().then(r=>setList(r)).catch(()=>setList([]))
  }
  useEffect(()=>{ reload() },[])

  function handleCreate(){
    // Create a minimal dashboard and open editor if onEdit is provided
    const payload = { name: 'New Dashboard', description: '', layout: [] }
    createDashboard(payload).then((created)=>{
      // open editor for created dashboard so user can edit name/description immediately
      if(onEdit) onEdit(String(created.id))
      else reload()
    }).catch(()=>reload())
  }

  function handleDelete(id:string){
    // Confirm deletion and refresh list
    Modal.confirm({ title: 'Delete dashboard?', onOk: ()=> deleteDashboard(id).then(()=>reload()) })
  }

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Dashboards</h2>
        <Button type="primary" onClick={handleCreate}>Create New Dashboard</Button>
      </div>
      {list.length === 0 ? (
        <div>No dashboards yet.</div>
      ) : (
        <div>
          {list.map((d:any)=> (
            <div key={d.id} style={{ padding: 12, borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontWeight: 600 }}>{d.name}</div>
                <div style={{ color: '#666', fontSize: 12 }}>{d.description}</div>
              </div>
              <Space>
                <Button onClick={()=> onEdit && onEdit(String(d.id)) }>Edit</Button>
                <Button danger onClick={()=>handleDelete(String(d.id))}>Delete</Button>
              </Space>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
