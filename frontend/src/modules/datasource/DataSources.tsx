import React, { useEffect, useState } from 'react'
import { Alert, List, Card, Tag, Typography, Spin, Button, Modal, Form, Input, Select, message } from 'antd'
import { listDatasources, createDatasource, updateDatasource, deleteDatasource, testDatasource } from 'services/datasource'
import { getIsReadonly } from 'lib/auth'

const { Text } = Typography

// DataSources manages available data sources (e.g., Postgres / MySQL / SQLite).
// Core features: list, create, edit, delete, and validate connections via "Test Connection".
// Frontend notes: edit mode writes directly into AntD Form; test applies sensible host/port defaults.
export default function DataSources(){
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [modalVisible, setModalVisible] = useState(false)
  const [editing, setEditing] = useState<any|null>(null)
  const [isReadonly, setIsReadonly] = useState(false)
  const [form] = Form.useForm()
  useEffect(()=>{ setIsReadonly(getIsReadonly()) }, [])

  // Initial load of data sources list
  useEffect(()=>{
    setLoading(true)
    listDatasources().then(d=>{
      setItems(d)
    }).catch(e=>{
      console.error(e)
    }).finally(()=>setLoading(false))
  },[])

  const reload = ()=>{
    setLoading(true)
    listDatasources().then(d=>setItems(d)).catch(()=>{}).finally(()=>setLoading(false))
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
    // Edit existing data source: set editing and open modal
    // eslint-disable-next-line no-console
    console.log('Editing item:', item)
    setEditing(item)
    setModalVisible(true)
  }

  // Ensure form is populated when modal becomes visible for editing
  useEffect(()=>{
    if(modalVisible && editing){
      try{
        // reset then apply editing values to avoid stale state
        form.resetFields()
        // eslint-disable-next-line no-console
        console.log('Applying editing to form (before):', editing)
        form.setFieldsValue(editing)
        // log immediate snapshot
        // eslint-disable-next-line no-console
        console.log('Form snapshot after setFieldsValue:', form.getFieldsValue())
        // delayed snapshot to see if mount timing affects it
        setTimeout(()=>{
          // eslint-disable-next-line no-console
          console.log('Form snapshot (delayed):', form.getFieldsValue())
        },50)
      }catch(e){ console.error('setFieldsValue failed', e) }
    }
  },[modalVisible, editing])

  // debug: log form value changes
  const onFormValuesChange = (changed:any, all:any) => {
    // eslint-disable-next-line no-console
    console.log('Form values changed:', changed, all)
  }

  // helper to set a single field from input change events (write uncontrolled input back to Form)
  const setFieldFromEvent = (fieldName: string) => (e:any) => {
    const value = e && e.target !== undefined ? e.target.value : e
    try{ form.setFieldsValue({ [fieldName]: value }) }catch(_){ }
  }

  const onDelete = async (item:any)=>{
    try{
      await deleteDatasource(item.id)
      message.success('Deleted')
      reload()
    }catch(e){
      message.error('Delete failed')
    }
  }

  const onTest = async (item:any)=>{
    try{
      const r = await testDatasource({ id: item.id })
      if(r.ok) message.success('Connection OK')
      else message.error('Test failed: '+(r.error||'unknown'))
    }catch(e){
      message.error('Test failed')
    }
  }

  const onModalOk = async ()=>{
    try {
      // Debug: log current form values before validation
      // eslint-disable-next-line no-console
      console.log('onModalOk form values:', form.getFieldsValue())
      // Use normal validation now
      const vals = await form.validateFields()
      if(!vals.db_type) vals.db_type = 'postgres'
      if(editing){
        // update existing datasource
        await updateDatasource(editing.id, vals)
        message.success('Updated')
      } else {
        // create new datasource
        await createDatasource(vals)
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
      // Validate the db_type field so the Select shows an inline error if missing
      await form.validateFields(['db_type'])
      const vals = form.getFieldsValue()
      // debug: show exact payload being sent to /api/datasource/test
      // eslint-disable-next-line no-console
      console.log('Test Connection payload:', vals)
      // Apply sensible defaults for postgres/mysql if user left blank (for quick testing)
      if(vals.db_type === 'postgres'){
        if(!vals.host) vals.host = 'localhost'
        if(!vals.port) vals.port = 5432
      }
      if(vals.db_type === 'mysql'){
        if(!vals.host) vals.host = 'localhost'
        if(!vals.port) vals.port = 3306
      }
      const r = await testDatasource(vals)
      if(r && r.ok){
        message.success('Connection OK')
      }else{
        message.error('Test failed: '+(r && r.error ? r.error : 'unknown'))
      }
    }catch(e:any){
      // If validation error, let the Form show inline errors; otherwise show a toast
      if(e && e.errorFields) return
      message.error(e?.message || 'Test failed')
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
    </div>
  )
}
