// PanelConfigModal.tsx
// Panel config modal for editing a single panel: title, type, datasource, SQL, bindings,
// and optional Elasticsearch integration. Comments are for readability only; logic is unchanged.
// Key capabilities:
// - Select from saved datasources or local ES integrations
// - Preview SQL to extract columns for field binding
// - Best-effort ES mapping fetch
// - Show required field bindings based on chart type
import React, { useEffect, useState } from 'react'
import dayjs from 'dayjs'
import { Modal, Form, Select, Input, Spin, Button, Alert } from 'antd'
import { queryPreview } from 'services/dashboards'

export default function PanelConfigModal({ visible, panel, onCancel, onSave, dashboardTimeRange, dashboardTimestampField }:{ visible:boolean, panel:any, onCancel:Function, onSave:Function, dashboardTimeRange?: [any, any] | null, dashboardTimestampField?: string | null }){
  const [form] = Form.useForm()

  // Supported chart types (aligned with common @ant-design/charts types)
  const CHART_TYPES = [
    'column','bar','stacked-bar','line','area','pie','scatter','radar','heatmap','mitre-attack-heatmap','box','histogram','treemap','funnel','waterfall','stock','dual-axis','bidirectional-bar','ring-progress','liquid','gauge','sunburst','sankey','word-cloud'
  ]

  // Field binding requirements by chart type
  const CHART_FIELD_MAP: Record<string, { key: string, label: string }[]> = {
    line: [ { key: 'xField', label: 'X Field' }, { key: 'yField', label: 'Y Field' } ],
    bar: [ { key: 'xField', label: 'Category Field' }, { key: 'yField', label: 'Value Field' } ],
    column: [ { key: 'xField', label: 'Category Field' }, { key: 'yField', label: 'Value Field' } ],
    pie: [ { key: 'angleField', label: 'Angle (value) Field' }, { key: 'colorField', label: 'Color (category) Field' } ],
    scatter: [ { key: 'xField', label: 'X Field' }, { key: 'yField', label: 'Y Field' } ],
    'mitre-attack-heatmap': [ { key: 'techniqueField', label: 'Technique ID Field' }, { key: 'countField', label: 'Count Field' } ],
  }

  // Available fields list (from SQL preview or ES mapping)
  const [availableFields, setAvailableFields] = useState<any[]>([])
  // Loading and error state for UI feedback
  const [loadingFields, setLoadingFields] = useState(false)
  const [sqlLoadError, setSqlLoadError] = useState<string | null>(null)
  const [integrationError, setIntegrationError] = useState<string | null>(null)
  // Locally saved integrations (for quick ES selection)
  const [savedIntegrations, setSavedIntegrations] = useState<any[]>([])

  useEffect(()=>{
    if(visible){
      // Load saved integrations from localStorage for quick selection
      try{ const s = localStorage.getItem('integrations'); setSavedIntegrations(s ? JSON.parse(s) : []) }catch(e){ setSavedIntegrations([]) }
      // Pre-fill form with panel config to preserve behavior
      form.setFieldsValue({ title: panel?.config?.title || '', type: panel?.type || 'chart' })
      form.setFieldsValue({ datasource: panel?.config?.datasource || panel?.config?.datasourceId || panel?.config?.datasource, sql: panel?.config?.sql || panel?.config?.query || '' })
      // Integration type is Elasticsearch only after datasource support was removed.
      if(panel?.config?.esConfig){
        form.setFieldsValue({ integrationType: 'elasticsearch', esHost: panel.config.esConfig.host, esIndex: panel.config.esConfig.index, esQuery: panel.config.esConfig.query || '' })
      } else {
        form.setFieldsValue({ integrationType: 'elasticsearch' })
      }
      // Preload existing field bindings to avoid overwriting
      const bindings = panel?.config?.fieldBindings || {}
      form.setFieldsValue(bindings)
      // If SQL and datasource exist, attempt preview to fetch fields for binding
      const sql = form.getFieldValue('sql') || panel?.config?.sql
      const dsForSql = form.getFieldValue('datasource') || panel?.config?.datasource || panel?.config?.datasourceId
      if(sql && dsForSql){
        setLoadingFields(true)
        setSqlLoadError(null)
        // if dashboardTimeRange provided, send time_range/time_field to backend for safe injection
        // dashboardTimeRange may contain dayjs objects; handle toISOString accordingly
        const time_range = (dashboardTimeRange && dashboardTimeRange[0] && dashboardTimeRange[1]) ? { from: dashboardTimeRange[0].toISOString ? dashboardTimeRange[0].toISOString() : (dashboardTimeRange[0].toString ? String(dashboardTimeRange[0]) : null), to: dashboardTimeRange[1].toISOString ? dashboardTimeRange[1].toISOString() : (dashboardTimeRange[1].toString ? String(dashboardTimeRange[1]) : null) } : undefined
        const time_field = dashboardTimestampField || undefined
        queryPreview({ datasource: dsForSql, sql: sql, limit: 1, time_range, time_field }).then((res:any)=>{
          const cols = res.columns || []
          const norm = cols.map((c:any)=> typeof c === 'string' ? { name: c, type: 'string' } : c)
          setAvailableFields(norm || [])
        }).catch((e)=>{
          // On preview failure, clear fields and store error for UI
          setAvailableFields([])
          setSqlLoadError(String(e))
        }).finally(()=>setLoadingFields(false))
      } else {
        setAvailableFields([])
      }
    }
  },[visible])

  // dataset removed: fields are now loaded from SQL preview only

  // Reload SQL preview fields when datasource or SQL changes
  useEffect(()=>{
    if(!visible) return
    let mounted = true
    const loadFromForm = async ()=>{
      const sql = form.getFieldValue('sql')
      const ds = form.getFieldValue('datasource')
      if(sql && ds){
        setLoadingFields(true)
        setSqlLoadError(null)
        try{
          const time_range = (dashboardTimeRange && dashboardTimeRange[0] && dashboardTimeRange[1]) ? { from: dashboardTimeRange[0].toISOString ? dashboardTimeRange[0].toISOString() : String(dashboardTimeRange[0]), to: dashboardTimeRange[1].toISOString ? dashboardTimeRange[1].toISOString() : String(dashboardTimeRange[1]) } : undefined
          const time_field = dashboardTimestampField || undefined
          const res:any = await queryPreview({ datasource: ds, sql: sql, limit: 1, time_range, time_field })
          if(!mounted) return
          const cols = res.columns || []
          const norm = cols.map((c:any)=> typeof c === 'string' ? { name: c, type: 'string' } : c)
          setAvailableFields(norm || [])
        }catch(e){ if(mounted){ setAvailableFields([]); setSqlLoadError(String(e)) } }
        finally{ if(mounted) setLoadingFields(false) }
      }
    }
    // load once on mount/visible
    loadFromForm()
    return ()=>{ mounted = false }
  },[visible, form])

  // Load fields from Elasticsearch mapping (best-effort). Fetching ES directly may fail due to network/CORS.
  const loadEsFields = async ()=>{
    setIntegrationError(null)
    const esHost = form.getFieldValue('esHost')
    const esIndex = form.getFieldValue('esIndex')
    if(!esHost || !esIndex){
      setIntegrationError('Please enter ES host and index')
      return
    }
    setLoadingFields(true)
    try{
      const url = `${esHost.replace(/\/$/, '')}/${esIndex}/_mapping`
      const resp = await fetch(url, { method: 'GET' })
      if(!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`)
      const data = await resp.json()
      // Extract property names
      const idxEntry = Object.values(data)[0] || {}
      const props = ((idxEntry as any).mappings && (idxEntry as any).mappings.properties) || {}
      const cols = Object.keys(props).map(k=> ({ name: k, type: (props[k].type || 'object') }))
      setAvailableFields(cols)
    }catch(e:any){
      setAvailableFields([])
      setIntegrationError(String(e))
    }finally{
      setLoadingFields(false)
    }
  }

  // On OK, collect form values, build panel config, and pass to onSave
  const handleOk = async ()=>{
    const values = await form.validateFields()
    // Extract field bindings required by the selected chart type
    const bindings: Record<string,string> = {}
    const type = values.type
    const mapping = CHART_FIELD_MAP[type] || []
    mapping.forEach(m=>{ if(values[m.key]) bindings[m.key] = values[m.key] })
    try{
      const newConfig: any = { ...panel.config, title: values.title, datasource: values.datasource, sql: values.sql, fieldBindings: bindings }
      // persist mitre display preference if present
      if(values.mitreDisplay){ newConfig.mitreDisplay = values.mitreDisplay }
      // no demo data helper: panel config should not include demoData
      // If Elasticsearch is selected, persist esConfig into panel config
      if(values.integrationType === 'elasticsearch'){
        newConfig.esConfig = { host: values.esHost, index: values.esIndex, query: values.esQuery }
      } else {
        delete newConfig.esConfig
      }
      // Hand updated panel to parent for save (may persist)
      await onSave({ ...panel, type: values.type, config: newConfig })
    }catch(e){
      // Preserve behavior: log and rethrow for caller handling
      console.error('onSave failed', e)
      throw e
    }
  }

  // Debug: log panel when visible (no functional impact)
  if(visible) console.debug('PanelConfigModal visible, panel=', panel)

  return (
    <Modal open={visible} onCancel={()=>onCancel()} onOk={handleOk} title={`Configure Panel ${panel?.i}`}>
      <Form form={form} layout="vertical" initialValues={{ integrationType: 'elasticsearch' }}>
        <Form.Item name="title" label="Title">
          <Input />
        </Form.Item>
        <Form.Item name="type" label="Type">
          <Select onChange={(v)=>{ form.setFieldsValue({}); /* clear dynamic fields when type changes */ }}>
            <Select.Option value="chart">Generic Chart</Select.Option>
            {CHART_TYPES.map(t=> <Select.Option key={t} value={t}>{t}</Select.Option>)}
            <Select.Option value="table">Table</Select.Option>
            <Select.Option value="text">Text</Select.Option>
            <Select.Option value="image">Image</Select.Option>
          </Select>
        </Form.Item>
        <Form.Item name="datasource" label="Elasticsearch Integration (optional)">
          <Select allowClear onChange={(val)=>{
            // if user selected an ES integration (we store object in option value), auto-fill es fields
            if(val && typeof val === 'object' && val.type === 'elasticsearch'){
              form.setFieldsValue({ integrationType: 'elasticsearch', esHost: val.host, esIndex: form.getFieldValue('esIndex') || '', esQuery: form.getFieldValue('esQuery') || '' })
            }
          }}>
            {savedIntegrations.filter(i=>i.type==='elasticsearch').map((it:any,idx)=> <Select.Option key={`es-${idx}`} value={{ type: 'elasticsearch', name: it.name, host: it.host }}>{`ES: ${it.name || it.host}`}</Select.Option>)}
          </Select>
        </Form.Item>

        <Form.Item name="integrationType" label="Integration">
          <Select>
            <Select.Option value="elasticsearch">Elasticsearch</Select.Option>
          </Select>
        </Form.Item>

          {/* Mitre display mode: show technique name or id */}
          <Form.Item shouldUpdate noStyle>
            {()=>{
              const t = form.getFieldValue('type')
              if(t !== 'mitre-attack-heatmap') return null
              return (
                <Form.Item name="mitreDisplay" label="MITRE Display Mode" initialValue="name">
                  <Select>
                    <Select.Option value="name">Technique name (recommended)</Select.Option>
                    <Select.Option value="id">Technique ID (Txxxx)</Select.Option>
                  </Select>
                </Form.Item>
              )
            }}
          </Form.Item>

        {/* Elasticsearch integration fields */}
        <Form.Item shouldUpdate noStyle>
          {()=>{
            const t = form.getFieldValue('integrationType')
            if(t !== 'elasticsearch') return null
            return (
              <div>
                <h4>Elasticsearch configuration</h4>
                {integrationError ? <Alert type="error" message={integrationError} style={{ marginBottom: 8 }} /> : null}
                <Form.Item name="esHost" label="ES Host (e.g. http://localhost:9200)" rules={[{ required: true, message: 'ES host required' }]}>
                  <Input />
                </Form.Item>
                <Form.Item name="esIndex" label="Index name" rules={[{ required: true, message: 'Index required' }]}>
                  <Input />
                </Form.Item>
                <Form.Item name="esQuery" label="Optional ES query (JSON)">
                  <Input.TextArea rows={4} placeholder='e.g. { "query": { "match_all": {} } }' />
                </Form.Item>
                <Form.Item>
                  <Button onClick={loadEsFields} loading={loadingFields}>Load fields from ES mapping</Button>
                </Form.Item>
              </div>
            )
          }}
        </Form.Item>

        <Form.Item name="sql" label="SQL (optional)">
          <Input.TextArea rows={6} placeholder="Enter SQL to run for this panel (overrides dataset)" />
        </Form.Item>

        

        {/* Dynamic field bindings for selected chart type */}
        <Form.Item shouldUpdate noStyle>
          {()=>{
            const t = form.getFieldValue('type')
            const mapping = CHART_FIELD_MAP[t] || []
            if(mapping.length === 0) return null
            return (
              <div>
                <h4>Field bindings for {t}</h4>
                {loadingFields ? <Spin /> : (
                  mapping.map(m=> (
                    <Form.Item key={m.key} name={m.key} label={m.label} rules={[{ required: true, message: `Select ${m.label}` }]}>
                      <Select allowClear>
                        {availableFields.map((f:any)=> <Select.Option key={f.name} value={f.name}>{f.name} ({f.type})</Select.Option>)}
                      </Select>
                    </Form.Item>
                  ))
                )}
              </div>
            )
          }}
        </Form.Item>
      </Form>
    </Modal>
  )
}
