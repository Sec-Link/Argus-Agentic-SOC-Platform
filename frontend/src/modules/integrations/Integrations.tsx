import React, { useEffect, useState } from 'react'
import { Alert, List, Button, Modal, Form, Input, Card, Space, Tag, message, Select } from 'antd'
import {
  testEsIntegration,
  listIntegrations,
  createIntegration,
  updateIntegration,
  deleteIntegration,
} from 'services/integrations'
import { getIsReadonly } from 'lib/auth'
// Integrations page manages Elasticsearch integrations.
// Key features:
// - List existing integrations
// - Create/edit integrations via form
// - Test Elasticsearch connectivity
// - Preview ES index mapping, edit column names/types, and create tables from mapping
// Notes:
// - Edited columns are stored in editedColumns. After table creation, new integrations store columns in pendingMapping,
//   which are persisted to integration.config.columns on save. Existing integrations attempt to update config directly.
// - This file only handles UI-level data collection and backend API calls.
const Integrations: React.FC = () =>{
  const [items, setItems] = useState<any[]>([])
  const [showModal, setShowModal] = useState(false)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [isReadonly, setIsReadonly] = useState(false)
  const [testResult, setTestResult] = useState({
    open: false,
    ok: true,
    title: '',
    detail: '',
  })
  const [form] = Form.useForm()

  const getErrorText = (e: any) => {
    const detail = e?.response?.data?.detail
    const error = e?.response?.data?.error
    const body = e?.response?.data?.body
    const msg = e?.message
    if (typeof detail === 'string' && detail) return detail
    if (typeof error === 'string' && error) return error
    if (typeof body === 'string' && body) return body
    if (body && typeof body === 'object') return JSON.stringify(body, null, 2)
    if (typeof msg === 'string' && msg) return msg
    return String(e)
  }

  useEffect(()=>{ fetchList() }, [])
  useEffect(()=>{ setIsReadonly(getIsReadonly()) }, [])

  const showTestResult = (ok: boolean, detail: unknown) => {
    setTestResult({
      open: true,
      ok,
      title: ok ? 'Connection OK' : 'Connection failed',
      detail: typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2),
    })
  }

  const fetchList = async ()=>{
    try{
      const r = await listIntegrations()
      const list = Array.isArray(r) ? r : []
      setItems(list.filter((item:any)=>item?.type === 'elasticsearch'))
    }catch(e){ setItems([]) }
  }

  const isLikelyUiRouteHost = (value: string) => {
    try {
      const u = new URL(value)
      return u.pathname.startsWith('/settings/') || u.pathname.startsWith('/integrations')
    } catch {
      return false
    }
  }

  const normalizeIntegration = (raw: any) => {
    const config = raw?.config || {}
    let host = raw?.host || raw?.url || config?.host || config?.url || ''
    if (typeof host !== 'string') host = String(host || '')
    if (host && isLikelyUiRouteHost(host)) host = ''

    return {
      ...raw,
      host,
      username: raw?.username || config?.username || '',
      password: raw?.password || config?.password || '',
      index: raw?.index || config?.index || 'alerts',
      path: raw?.path || config?.path || '/_cluster/health',
      config,
    }
  }

  const handleDelete = async (item: any) => {
    const name = item?.name || item?.host || item?.id || 'this integration'
    const ok = window.confirm(`Delete ${name}? This cannot be undone.`)
    if (!ok) return
    try {
      await deleteIntegration(item.id)
      message.success('Deleted')
      fetchList()
    } catch (e: any) {
      message.error('Delete failed: ' + getErrorText(e))
    }
  }

  const testIntegration = async (info: any) => {
    const normalized = normalizeIntegration(info)
    const type = normalized.type || 'elasticsearch'
    if(type === 'elasticsearch'){
      const host = normalized.host || ''
      const username = normalized.username || ''
      const password = normalized.password || ''
      const path = normalized.path || '/_cluster/health'
      if(!host) throw new Error('Elasticsearch host required')
      return testEsIntegration({ host, username, password, path })
    }
    throw new Error('Only Elasticsearch integrations are supported')
  }

  const save = async ()=>{
    const v = await form.validateFields()
    try{
      // Collect form values and build create/update integration payload.
      const host = String(v.host || '').trim()
      const index = String(v.index || 'alerts').trim() || 'alerts'
      const payload: any = {
        name: v.name,
        type: 'elasticsearch',
        config: {
          host,
          index,
          username: v.username || '',
          password: v.password || '',
          path: v.path || '/_cluster/health',
        },
      }

      // Create vs update: editingIndex === null => create new integration; otherwise update existing
      if(editingIndex === null){
        await createIntegration(payload)
      }else{
        const id = items[editingIndex].id
        await updateIntegration(id, payload)
      }

      message.success('Integration saved and activated for Alerts/Dashboard.')
      try{ window.dispatchEvent(new Event('siem_es_connector_switched')) }catch(e){}
      setShowModal(false)
      setEditingIndex(null)
      form.resetFields()
      fetchList()
    }catch(e:any){ message.error(String(e)) }
  }

  const handleTestFromModal = async ()=>{
    try{
      const v = form.getFieldsValue()
      const res = await testIntegration(v)
      showTestResult(true, res)
    }catch(e:any){
      showTestResult(false, getErrorText(e))
    }
  }

  const openNew = ()=>{ setEditingIndex(null); form.resetFields(); setShowModal(true) }

  const openEdit = (it:any, idx:number)=>{
    setEditingIndex(idx)
    const copy = { ...it }
    if(!copy.config) copy.config = {}
    const merged: any = { ...copy }
    merged.type = 'elasticsearch'
    merged.host = copy.config.host || copy.config.url || undefined
    merged.username = copy.config.username
    merged.password = copy.config.password
    merged.index = copy.config.index || 'alerts'
    merged.path = copy.config.path || '/_cluster/health'
    form.setFieldsValue(merged)
    setShowModal(true)
  }

  return (
    <div style={{ padding: 12 }}>
      <Card title="Integrations">
        {isReadonly ? (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="Read-only view"
            description="Guest accounts can view configured integrations but cannot inspect credentials or make changes."
          />
        ) : (
          <Button type="primary" onClick={openNew} style={{ marginBottom: 12 }}>Add Integration</Button>
        )}
        <List dataSource={items} renderItem={(it:any, idx)=> {
          const n = normalizeIntegration(it)
          const actionButtons = isReadonly ? [<Tag key="ro">Read-only</Tag>] : [
            <Button key="test" onClick={async (e)=>{ e.stopPropagation(); try{ const res = await testIntegration(n); showTestResult(true, res) }catch(e:any){ showTestResult(false, getErrorText(e)) } }}>Test</Button>,
            <Button key="edit" onClick={(e)=>{ e.stopPropagation(); openEdit(it, idx) }}>Edit</Button>,
            <Button key="del" danger onClick={(e)=>{ e.stopPropagation(); handleDelete({ ...n, id: n.id || it.id }) }}>Delete</Button>
          ]
          return (
          <List.Item extra={<Space>{actionButtons}</Space>}>
            <List.Item.Meta
              title={isReadonly ? (n.name || n.host) : <a onClick={()=>openEdit(it, idx)}>{n.name || n.host}</a>}
              description={<div><Tag>{n.type}</Tag> {n.host}</div>}
            />
          </List.Item>
        )}} />
      </Card>

      <Modal open={showModal && !isReadonly} onCancel={()=>setShowModal(false)} onOk={save} title="Add Integration">
        <Form form={form} layout="vertical" initialValues={{ type: 'elasticsearch', index: 'alerts' }}>
          <Form.Item name="type" label="Type">
            <Select onChange={(v:any)=>{ form.setFieldsValue({ type: v }) }}>
              <Select.Option value="elasticsearch">Elasticsearch</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="name" label="Name" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="host" label="Host (http://...)" rules={[{ required: true, message: 'Elasticsearch host required' }]}><Input /></Form.Item>
          <Form.Item name="index" label="Index" rules={[{ required: true, message: 'Elasticsearch index required' }]}><Input placeholder="alerts" /></Form.Item>
          <Form.Item name="username" label="Username (optional)"><Input /></Form.Item>
          <Form.Item name="password" label="Password (optional)"><Input.Password /></Form.Item>
          <Form.Item name="path" label="Health Check Path"><Input placeholder="/_cluster/health" /></Form.Item>
          <Form.Item name="notes" label="Notes"><Input.TextArea rows={3} /></Form.Item>
          <Form.Item>
            <Space>
              <Button onClick={handleTestFromModal}>Test Connection</Button>
              <Button type="primary" onClick={save}>Save</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title={testResult.title}
        open={testResult.open}
        footer={null}
        onCancel={()=>setTestResult(prev=>({ ...prev, open: false }))}
      >
        <Alert
          type={testResult.ok ? 'success' : 'error'}
          showIcon
          message={testResult.ok ? 'Connection succeeded' : 'Connection failed'}
          style={{ marginBottom: 12 }}
        />
        <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 360, overflow: 'auto', margin: 0 }}>
          {testResult.detail}
        </pre>
      </Modal>
    </div>
  )
}
export default Integrations;
