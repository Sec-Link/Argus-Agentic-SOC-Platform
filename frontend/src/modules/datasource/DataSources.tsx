import React, { useEffect, useState } from 'react'
import { Alert, List, Card, Tag, Typography, Spin, Button, Modal, Form, Input, Select, message } from 'antd'
import { listIntegrations, createIntegration, updateIntegration, deleteIntegration } from 'services/integrations'
import { testDbConnection } from 'api'
import { getIsReadonly } from 'lib/auth'

const { Text } = Typography

type TestResultState = {
  open: boolean
  ok: boolean
  title: string
  detail: string
}

const toDatasource = (item: any) => {
  const cfg = item?.config || {}
  return {
    id: item?.id,
    name: item?.name || '',
    db_type: item?.type === 'postgresql' ? 'postgres' : (item?.type === 'mysql' ? 'mysql' : (item?.type || 'postgres')),
    host: cfg?.host || '',
    port: cfg?.port || '',
    database: cfg?.dbname || cfg?.database || '',
    user: cfg?.user || cfg?.username || '',
    password: cfg?.password || '',
    django_db: cfg?.django_db || '',
    conn_str: cfg?.conn_str || '',
    raw: item,
  }
}

const toIntegrationPayload = (vals: any) => {
  const dbType = vals?.db_type === 'mysql' ? 'mysql' : 'postgresql'
  return {
    name: vals?.name,
    type: dbType,
    config: {
      host: vals?.host || undefined,
      port: vals?.port || undefined,
      user: vals?.user || undefined,
      password: vals?.password || undefined,
      dbname: vals?.database || undefined,
      django_db: vals?.django_db || undefined,
      conn_str: vals?.conn_str || undefined,
    }
  }
}

const testDbIntegration = async (item: any) => {
  const vals = item?.raw ? toDatasource(item.raw) : item
  const payload: any = {
    db_type: vals?.db_type === 'mysql' ? 'mysql' : 'postgres',
    host: vals?.host || '',
    port: vals?.port || '',
    database: vals?.database || '',
    user: vals?.user || '',
    password: vals?.password || '',
    conn_str: vals?.conn_str || '',
  }
  return testDbConnection(payload)
}

// DataSources manages available data sources (e.g., Postgres / MySQL / SQLite).
// Core features: list, create, edit, delete, and validate connections via "Test Connection".
// Frontend notes: edit mode writes directly into AntD Form; test applies sensible host/port defaults.
export default function DataSources(){
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [modalVisible, setModalVisible] = useState(false)
  const [editing, setEditing] = useState<any|null>(null)
  const [isReadonly, setIsReadonly] = useState(false)
  const [testResult, setTestResult] = useState<TestResultState>({
    open: false,
    ok: true,
    title: '',
    detail: '',
  })
  const [form] = Form.useForm()
  useEffect(()=>{ setIsReadonly(getIsReadonly()) }, [])

  const showTestResult = (ok: boolean, detail: unknown) => {
    setTestResult({
      open: true,
      ok,
      title: ok ? 'Connection OK' : 'Connection failed',
      detail: typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2),
    })
  }

  // Initial load of data sources list
  useEffect(()=>{
    setLoading(true)
    listIntegrations().then(d=>{
      const list = Array.isArray(d) ? d : []
      setItems(list.filter((x:any)=>x?.type === 'postgresql' || x?.type === 'mysql').map(toDatasource))
    }).catch(e=>{
      console.error(e)
    }).finally(()=>setLoading(false))
  },[])

  const reload = ()=>{
    setLoading(true)
    listIntegrations()
      .then(d=>{
        const list = Array.isArray(d) ? d : []
        setItems(list.filter((x:any)=>x?.type === 'postgresql' || x?.type === 'mysql').map(toDatasource))
      })
      .catch(()=>{})
      .finally(()=>setLoading(false))
  }

  const openNew = ()=>{
    // Clear editing state and reset form, prefill a db_type default to avoid validation blocking
    setEditing(null)
    form.resetFields()
    // pre-fill a sensible default for db_type so the form validation won't block on new
    try{ form.setFieldsValue({ db_type: 'postgres' }) }catch(e){}
    setModalVisible(true)
  }

  const onEdit = (item:any)=>{
    setEditing(item)
    setModalVisible(true)
  }

  // Ensure form is populated when modal becomes visible for editing
  useEffect(()=>{
    if(modalVisible && editing){
      try{
        // reset then apply editing values to avoid stale state
        form.resetFields()
        form.setFieldsValue(editing)
      }catch(e){ console.error('setFieldsValue failed', e) }
    }
  },[modalVisible, editing])

  const onFormValuesChange = (changed:any, all:any) => {
  }

  // helper to set a single field from input change events (write uncontrolled input back to Form)
  const setFieldFromEvent = (fieldName: string) => (e:any) => {
    const value = e && e.target !== undefined ? e.target.value : e
    try{ form.setFieldsValue({ [fieldName]: value }) }catch(_){ }
  }

  const onDelete = async (item:any)=>{
    try{
      await deleteIntegration(item.id)
      message.success('Deleted')
      reload()
    }catch(e){
      message.error('Delete failed')
    }
  }

  const onTest = async (item:any)=>{
    try{
      const res = await testDbIntegration(item)
      showTestResult(true, res)
    }catch(e:any){
      const detail = e?.response?.data?.error || e?.response?.data?.detail || e?.message || 'Test failed'
      showTestResult(false, detail)
    }
  }

  const onModalOk = async ()=>{
    try {
      const vals = await form.validateFields()
      if(!vals.db_type) vals.db_type = 'postgres'
      const payload = toIntegrationPayload(vals)
      if(editing){
        // update existing datasource-backed integration
        await updateIntegration(editing.id, payload)
        message.success('Updated')
      } else {
        // create new datasource-backed integration
        await createIntegration(payload)
        message.success('Created')
      }
      setModalVisible(false)
      reload()
    } catch(e:any){
      if(e && e.errorFields){
        // AntD validation errors already displayed
        return
      }
      const resp = e?.response
      if(resp && resp.data && typeof resp.data === 'object'){
        const fldErrs = resp.data
        if(fldErrs.missing){
          message.error('Missing: '+ fldErrs.missing.join(', '))
        } else if(fldErrs.error){
          message.error(String(fldErrs.error))
        } else {
          message.error('Save failed')
        }
        return
      }
      message.error(e?.message || 'Save failed')
    }
  }

  const onModalTest = async ()=>{
    try{
      await form.validateFields(['db_type'])
      const vals = form.getFieldsValue()
      const res = await testDbIntegration(vals)
      showTestResult(true, res)
    }catch(e:any){
      // If validation error, let the Form show inline errors; otherwise show a toast
      if(e && e.errorFields) return
      const detail = e?.response?.data?.error || e?.response?.data?.detail || e?.message || 'Test failed'
      showTestResult(false, detail)
    }
  }

  if(loading) return <div style={{padding:40,textAlign:'center'}}><Spin /></div>

  return (
    <div style={{padding:20}}>
      <h2>Data Sources</h2>
      {isReadonly ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="Read-only view"
          description="Guest accounts can view configured data sources but cannot inspect credentials or make changes."
        />
      ) : (
        <div style={{marginBottom:12}}>
          <Button type="primary" onClick={openNew}>New Data Source</Button>
        </div>
      )}
      <List
        grid={{ gutter: 16, column: 2 }}
        dataSource={items}
        renderItem={item=> (
          <List.Item>
            <Card title={item.name} size="small" extra={
              isReadonly ? <Tag>Read-only</Tag> : (
                <div>
                  <Button size="small" onClick={()=>onTest(item)} style={{marginRight:8}}>Test</Button>
                  <Button size="small" onClick={()=>onEdit(item)} style={{marginRight:8}}>Edit</Button>
                  <Button size="small" danger onClick={()=>onDelete(item)}>Delete</Button>
                </div>
              )
            }>
              <div><Text type="secondary">Type:</Text> {item.db_type}</div>
              <div><Text type="secondary">Host:</Text> {item.host || '—'}</div>
              <div><Text type="secondary">Database:</Text> {item.database || '—'}</div>
              <div style={{marginTop:8}}><Text type="secondary">ID:</Text> {item.id}</div>
            </Card>
          </List.Item>
        )}
      />

      <Modal title={editing ? 'Edit Data Source' : 'New Data Source'} open={modalVisible && !isReadonly} onOk={onModalOk} onCancel={()=>setModalVisible(false)}>
        <Form form={form} layout="vertical" onValuesChange={onFormValuesChange} initialValues={{ db_type: 'postgres' }}>
          <Form.Item name="name" label="Name" rules={[{required:true}]}> 
            <Input onChange={setFieldFromEvent('name')} /> 
          </Form.Item>
          <Form.Item name="db_type" label="DB Type" rules={[{required:true}]}> 
            <Select 
              options={[{label:'Postgres',value:'postgres'},{label:'MySQL',value:'mysql'},{label:'SQLite',value:'sqlite'}]} 
              onChange={(v)=>{ try{ form.setFieldsValue({ db_type: v }) }catch(_){ } }} 
            />
          </Form.Item>
          <Form.Item name="host" label="Host"> 
            <Input onChange={setFieldFromEvent('host')} /> 
          </Form.Item>
          <Form.Item name="port" label="Port"> 
            <Input onChange={setFieldFromEvent('port')} /> 
          </Form.Item>
          <Form.Item name="database" label="Database / File"> 
            <Input onChange={setFieldFromEvent('database')} /> 
          </Form.Item>
          <Form.Item name="user" label="User"> 
            <Input onChange={setFieldFromEvent('user')} /> 
          </Form.Item>
          <Form.Item name="password" label="Password"> 
            <Input.Password onChange={setFieldFromEvent('password')} /> 
          </Form.Item>
        </Form>
        <div style={{textAlign:'right', marginTop: 12}}>
          <Button onClick={onModalTest} style={{marginRight:8}}>Test Connection</Button>
        </div>
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
          message={testResult.ok ? 'Database connection succeeded' : 'Database connection failed'}
          style={{ marginBottom: 12 }}
        />
        <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 360, overflow: 'auto', margin: 0 }}>
          {testResult.detail}
        </pre>
      </Modal>
    </div>
  )
}
