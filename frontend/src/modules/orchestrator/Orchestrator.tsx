import React, { useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import { Card, Button, List, Modal, Form, Input, Select, message, InputNumber, DatePicker, Table, Popconfirm, Tag } from 'antd'
import client from 'services/client'
import { previewEsIntegration } from 'services/integrations'

// Orchestrator page for scheduled tasks (Task) management.
// - Create/edit/list tasks (schedule, source/dest integration, index, limit, query)
// - Manually trigger a run and view logs
// - Time selection supports absolute and relative ranges (presets and custom)
// Design notes:
// - computeTsRange normalizes mixed time selectors into ES-ready ISO ranges (or 'now')
// - Save attaches the selected time range as an ES range query into task config
// - Frontend keeps backend data model intact and only builds the expected payload

export default function Orchestrator(){
  const [items, setItems] = useState<any[]>([])
  const [integrations, setIntegrations] = useState<any[]>([])
  const [runs, setRuns] = useState<any[]>([])
  const [showModal, setShowModal] = useState(false)
  const [editingTask, setEditingTask] = useState<any | null>(null)
  const [form] = Form.useForm()
  const [runsModalTask, setRunsModalTask] = useState<any | null>(null)
  const [logsModalRun, setLogsModalRun] = useState<any | null>(null)
  const [showPreviewDataModal, setShowPreviewDataModal] = useState(false)
  const [previewData, setPreviewData] = useState<any[] | null>(null)
  const [chartTaskId, setChartTaskId] = useState<string | number | null>(null)
  const DJANGO_DEFAULT_DEST = '__django_default__'
  const DEST_TABLE = 'alerts_alert'
  const visibleItems = useMemo(
    () => items.filter((it:any) => !String(it?.name || '').startsWith('[deleted] ')),
    [items]
  )

  // compute ISO timestamps for lower and upper bounds based on absolute or relative selectors
  // Input may include: timestamp_from, timestamp_to, timestamp_relative, timestamp_relative_custom_value/unit
  // Output: { from: ISOString|null, to: ISOString|'now'|null }
  const computeTsRange = (vals: any): { from: string | null, to: string | null } => {
    let tsFrom: string | null = null
    let tsTo: string | null = null

    // absolute timestamps (single or range)
    if(vals.timestamp_from){
      try{
        if(typeof vals.timestamp_from === 'string') tsFrom = vals.timestamp_from
        else if(typeof vals.timestamp_from.toISOString === 'function') tsFrom = vals.timestamp_from.toISOString()
        else if(vals.timestamp_from instanceof Date) tsFrom = vals.timestamp_from.toISOString()
        else tsFrom = String(vals.timestamp_from)
      }catch(e){ tsFrom = null }
    }
    if(vals.timestamp_to){
      try{
        if(typeof vals.timestamp_to === 'string') tsTo = vals.timestamp_to
        else if(typeof vals.timestamp_to.toISOString === 'function') tsTo = vals.timestamp_to.toISOString()
        else if(vals.timestamp_to instanceof Date) tsTo = vals.timestamp_to.toISOString()
        else tsTo = String(vals.timestamp_to)
      }catch(e){ tsTo = null }
    }

    // if no absolute from, consider relative
    if(!tsFrom){
      // prefer explicit timestamp_relative, fallback to time_selector (which may be 'custom_relative')
      const rel = vals.timestamp_relative || vals.time_selector
      if(rel){
        let value: number | null = null
        let unit: string | null = null
        if(typeof rel === 'string'){
          if(rel === 'custom' || rel === 'custom_relative'){
            if(vals.timestamp_relative_custom_value && vals.timestamp_relative_custom_unit){
              value = Number(vals.timestamp_relative_custom_value)
              unit = vals.timestamp_relative_custom_unit
            }
          }else{
            const m = rel.match(/^(\d+)([mhd])$/)
            if(m){ value = Number(m[1]); unit = m[2] }
          }
        }else if(typeof rel === 'object' && rel !== null){
          value = Number(rel.value)
          unit = rel.unit
        }

        // If relative value + unit is parsed, build an ES relative string like 'now-10h', to='now'
        if(value && unit){
          tsFrom = `now-${value}${unit}`
          tsTo = 'now'
        }
      }
    }

    // If tsFrom is available and tsTo is missing, default tsTo='now' for ES range.gte/lte
    if(tsFrom && !tsTo) tsTo = 'now'
    return { from: tsFrom, to: tsTo }
  }

  const fetch = async ()=>{
    try{ const res = await client.get('/orchestrator/tasks/'); setItems(res.data) }catch(e){ setItems([]) }
  }

  const fetchIntegrations = async ()=>{
    try{ const r = await client.get('/integrations/'); setIntegrations(r.data) }catch(e){ setIntegrations([]) }
  }


  useEffect(()=>{ fetch() }, [])

  useEffect(()=>{ fetchIntegrations() }, [])
  useEffect(()=>{ fetchRuns({ includeDeleted: true }) }, [])
  useEffect(()=>{
    const intervalId = window.setInterval(() => {
      fetch()
      fetchRuns({ includeDeleted: true })
    }, 5000)
    return () => window.clearInterval(intervalId)
  }, [])
  useEffect(()=>{
    if(!chartTaskId && visibleItems.length){
      setChartTaskId(visibleItems[0].id)
    }else if(chartTaskId && visibleItems.length && !visibleItems.some((it:any) => String(it.id) === String(chartTaskId))){
      setChartTaskId(visibleItems[0].id)
    }else if(chartTaskId && visibleItems.length === 0){
      setChartTaskId(null)
    }
  }, [visibleItems, chartTaskId])

  const parsePolicyMetrics = (logs?: string) => {
    if(!logs) return null
    const m = logs.match(/matched=(\d+)\s+created=(\d+)\s+attached=(\d+)\s+skipped=(\d+)/i)
    if(!m) return null
    return {
      matched: Number(m[1]),
      created: Number(m[2]),
      attached: Number(m[3]),
      skipped: Number(m[4]),
    }
  }

  const parseImportedCount = (logs?: string) => {
    if(!logs) return null
    const m = logs.match(/\"imported\"\s*:\s*(\d+)/i)
    if(!m) return null
    return Number(m[1])
  }

  const parseSyncMetrics = (logs?: string) => {
    if(!logs) return null
    const m = logs.match(/fetched=(\d+)\s+inserted=(\d+)\s+updated=(\d+)/i)
    if(!m) return null
    return {
      fetched: Number(m[1]),
      inserted: Number(m[2]),
      updated: Number(m[3]),
    }
  }

  const statusColor = (status?: string) => {
    const s = String(status || '').toLowerCase()
    if(s === 'running' || s === 'pending') return 'processing'
    if(s === 'success' || s === 'completed') return 'success'
    if(s === 'failed' || s === 'error') return 'error'
    return 'default'
  }

  const latestRunByTask = useMemo(() => {
    const byTask: Record<string, any> = {}
    for(const run of runs){
      const taskId = String(run.task || '')
      if(!taskId) continue
      const current = byTask[taskId]
      const runTime = dayjs(run.started_at || run.finished_at || run.created_at || 0).valueOf()
      const currentTime = current ? dayjs(current.started_at || current.finished_at || current.created_at || 0).valueOf() : -1
      if(!current || runTime > currentTime) byTask[taskId] = run
    }
    return byTask
  }, [runs])

  const chartData = useMemo(() => {
    if(!chartTaskId) return []
    const filtered = runs.filter(r => String(r.task || r.task_id || '') === String(chartTaskId))
    const rows = filtered
      .map((r:any) => {
        const metrics = parsePolicyMetrics(r.logs)
        const imported = parseImportedCount(r.logs)
        const syncMetrics = parseSyncMetrics(r.logs)
        const ts = r.finished_at || r.started_at || r.created_at
        if(!ts) return null
        return {
          key: r.id,
          time: dayjs(ts).format('YYYY-MM-DD HH:mm:ss'),
          matched: metrics?.matched ?? syncMetrics?.fetched ?? '-',
          created: metrics?.created ?? syncMetrics?.inserted ?? '-',
          attached: metrics?.attached ?? syncMetrics?.updated ?? '-',
          skipped: metrics?.skipped ?? '-',
          imported: imported ?? syncMetrics?.fetched ?? '-',
          status: r.status,
        }
      })
      .filter((row): row is { key: any; time: string; matched: number | string; created: number | string; attached: number | string; skipped: number | string; imported: number | string; status: any } => row !== null)
    return rows
  }, [runs, chartTaskId])
  const tableColumns = useMemo(() => ([
    { title: 'Time', dataIndex: 'time', key: 'time' },
    { title: 'Matched', dataIndex: 'matched', key: 'matched' },
    { title: 'Created', dataIndex: 'created', key: 'created' },
    { title: 'Appended', dataIndex: 'attached', key: 'attached' },
    { title: 'Skipped', dataIndex: 'skipped', key: 'skipped' },
    { title: 'Imported', dataIndex: 'imported', key: 'imported' },
    { title: 'Status', dataIndex: 'status', key: 'status', render: (value:string) => <Tag color={statusColor(value)}>{value || 'unknown'}</Tag> },
  ]), [])

  const save = async ()=>{
    const v = await form.validateFields()
    // build payload expected by backend: { name, schedule, task_type, config }
    // config includes sync type, source/dest integration, index, limit, query, and time filters
    const payload: any = { name: v.name, schedule: v.schedule, task_type: 'es_to_db', config: {} }
    // assemble sync config
    payload.config.sync = 'es_to_db'
    payload.config.source_integration = v.source_integration
    payload.config.dest_integration = v.dest_integration
    if(v.dest_integration === DJANGO_DEFAULT_DEST){
      payload.config.django_db = 'default'
    }
    payload.config.table = DEST_TABLE
    payload.config.index = v.index
    payload.config.limit = Number(v.limit) || 1000
    // if user supplied a JSON query in config textarea, try parse it
    if(v.config){
      if(typeof v.config === 'string'){
        try{ payload.config.query = JSON.parse(v.config) }catch(e){ /* ignore invalid JSON for query */ }
      }else if(typeof v.config === 'object'){
        payload.config = { ...payload.config, ...v.config }
      }
    }
    // include timestamp selection into config
    if(v.timestamp_field) payload.config.timestamp_field = v.timestamp_field
    if(v.timestamp_from){
      if(typeof v.timestamp_from === 'string') payload.config.timestamp_from = v.timestamp_from
      else if(v.timestamp_from.toISOString) payload.config.timestamp_from = v.timestamp_from.toISOString()
    }
    // persist absolute upper bound if provided
    if(v.timestamp_to){
      if(typeof v.timestamp_to === 'string') payload.config.timestamp_to = v.timestamp_to
      else if(v.timestamp_to.toISOString) payload.config.timestamp_to = v.timestamp_to.toISOString()
    }
    if(v.timestamp_relative){
      // store preset or custom
      if(v.timestamp_relative === 'custom'){
        payload.config.timestamp_relative = { value: v.timestamp_relative_custom_value, unit: v.timestamp_relative_custom_unit }
      }else{
        payload.config.timestamp_relative = v.timestamp_relative
      }
    }

    // compute and attach an ES range query so the task run will use the same filter
    const range = computeTsRange(v)
    // If a time field is provided and computeTsRange returns a start time, attach an ES range query
    if(v.timestamp_field && range.from){
      payload.config.query = { query: { range: { [v.timestamp_field]: { gte: range.from, lte: range.to || 'now' } } } }
    }

    try{
      if(editingTask){
        // update existing task
        await client.put(`/orchestrator/tasks/${editingTask.id}/`, payload)
        message.success('Task updated')
      }else{
        await client.post('/orchestrator/tasks/', payload)
        message.success('Task created')
      }
      setShowModal(false)
      setEditingTask(null)
      fetch()
      fetchRuns({ includeDeleted: true })
    }catch(e:any){ message.error(String(e)) }
  }

  const fetchRuns = async (opts?: { includeDeleted?: boolean })=>{
    try{
      const suffix = opts?.includeDeleted ? '?include_deleted=1' : ''
      const r = await client.get(`/orchestrator/task_runs/${suffix}`)
      setRuns(r.data || [])
    }catch(e){ setRuns([]) }
  }

  const runTask = async (taskId: string) => {
    try{
      const r = await client.post(`/orchestrator/tasks/${taskId}/run/`)
  const run = r.data
  // Run object includes id, status, logs; show in a modal
  Modal.info({ title: `Task run ${run.id} - ${run.status}`, width: 800, content: (<pre style={{ whiteSpace: 'pre-wrap' }}>{run.logs}</pre>) })
      fetch()
      fetchRuns({ includeDeleted: true })
    }catch(e:any){
      const detail = e.response && e.response.data ? JSON.stringify(e.response.data) : String(e)
      Modal.error({ title: 'Run failed', content: detail })
    }
  }

  const deleteTask = async (taskId: string) => {
    try{
      await client.delete(`/orchestrator/tasks/${taskId}/`)
      message.success('Task deleted')
      if(String(chartTaskId) === String(taskId)) setChartTaskId(null)
      if(runsModalTask && String(runsModalTask.id) === String(taskId)) setRunsModalTask(null)
      if(editingTask && String(editingTask.id) === String(taskId)){
        setEditingTask(null)
        setShowModal(false)
      }
      fetch()
      fetchRuns({ includeDeleted: true })
    }catch(e:any){
      const detail = e.response && e.response.data ? JSON.stringify(e.response.data) : String(e)
      Modal.error({ title: 'Delete failed', content: detail })
    }
  }

  const openRunsForTask = (task:any) => {
    setRunsModalTask(task)
    // ensure latest runs
    fetchRuns({ includeDeleted: true })
  }

  const closeRunsModal = ()=> setRunsModalTask(null)

  const clearRunsForTask = async (taskId: string) => {
    try{
      await client.delete(`/orchestrator/task_runs/clear/?task=${encodeURIComponent(taskId)}`)
      setLogsModalRun(null)
      message.success('Task runs cleared')
      fetchRuns({ includeDeleted: true })
    }catch(e:any){
      const detail = e.response && e.response.data ? JSON.stringify(e.response.data) : String(e)
      Modal.error({ title: 'Clear task runs failed', content: detail })
    }
  }

  const openEditTask = (it:any) => {
    setEditingTask(it)
    const cfg = it.config || {}
    const initial: any = { name: it.name, schedule: it.schedule }
    initial.source_integration = cfg.source_integration
    initial.dest_integration = cfg.dest_integration
    initial.index = cfg.index
    initial.limit = cfg.limit || 1000
    if(cfg.query) initial.config = typeof cfg.query === 'string' ? cfg.query : JSON.stringify(cfg.query, null, 2)
    if(cfg.timestamp_field) initial.timestamp_field = cfg.timestamp_field
    if(cfg.timestamp_from) initial.timestamp_from = dayjs(cfg.timestamp_from)
    if(cfg.timestamp_to) initial.timestamp_to = dayjs(cfg.timestamp_to)
    if(cfg.timestamp_relative) initial.timestamp_relative = cfg.timestamp_relative
    if (cfg.timestamp_from || cfg.timestamp_to) {
      initial.time_selector = 'absolute'
    } else if (cfg.timestamp_relative) {
      if (typeof cfg.timestamp_relative === 'string') {
        if (cfg.timestamp_relative === 'custom') {
          initial.time_selector = 'custom_relative'
        } else {
          initial.time_selector = cfg.timestamp_relative
        }
      } else if (typeof cfg.timestamp_relative === 'object') {
        initial.time_selector = 'custom_relative'
        initial.timestamp_relative_custom_value = cfg.timestamp_relative.value
        initial.timestamp_relative_custom_unit = cfg.timestamp_relative.unit
      }
    }
    if (!initial.time_selector && cfg.query && cfg.query.query && cfg.query.query.range) {
      const rangeObj = cfg.query.query.range
      const rangeField = Object.keys(rangeObj || {})[0]
      const rangeVal = rangeField ? rangeObj[rangeField] : null
      const gte = rangeVal && rangeVal.gte
      const lte = rangeVal && rangeVal.lte
      if (!initial.timestamp_field && rangeField) initial.timestamp_field = rangeField
      if (typeof gte === 'string' && typeof lte === 'string' && lte === 'now' && gte.startsWith('now-')) {
        const rel = gte.replace('now-', '')
        if (['1h','6h','24h','7d'].includes(rel)) {
          initial.time_selector = rel
        } else {
          const m = rel.match(/^(\d+)([mhd])$/)
          if (m) {
            initial.time_selector = 'custom_relative'
            initial.timestamp_relative_custom_value = Number(m[1])
            initial.timestamp_relative_custom_unit = m[2]
          }
        }
      } else if (gte || lte) {
        initial.time_selector = 'absolute'
        if (gte && typeof gte === 'string') initial.timestamp_from = dayjs(gte)
        if (lte && typeof lte === 'string' && lte !== 'now') initial.timestamp_to = dayjs(lte)
      }
    }
    form.resetFields()
    form.setFieldsValue(initial)
    setShowModal(true)
  }

  return (
    <div style={{ padding: 12 }}>
      <Card title="Orchestrator">
        <Button type="primary" onClick={()=>{ setEditingTask(null); form.resetFields(); setShowModal(true) }} style={{ marginBottom: 12 }}>New Task</Button>
        <List dataSource={visibleItems} renderItem={(it:any)=>(
          <List.Item actions={[
            <Button key="run" onClick={()=>runTask(it.id)}>Run</Button>,
            <Button key="runs" onClick={()=>openRunsForTask(it)}>View Runs</Button>,
            <Button key="edit" onClick={()=>openEditTask(it)}>Edit</Button>,
            <Popconfirm
              key="delete"
              title="Delete task?"
              description="This will remove the task and its runs."
              okText="Delete"
              okButtonProps={{ danger: true }}
              placement="leftTop"
              onConfirm={()=>deleteTask(it.id)}
            >
              <Button danger>Delete</Button>
            </Popconfirm>
          ]}>
            <List.Item.Meta
              title={<a onClick={()=>openEditTask(it)}>{it.name}</a>}
              description={
                <div>
                  Type: {it.task_type} Schedule: {it.schedule}
                  {latestRunByTask[String(it.id)] && (
                    <span style={{ marginLeft: 12 }}>
                      Latest run: <Tag color={statusColor(latestRunByTask[String(it.id)].status)}>{latestRunByTask[String(it.id)].status}</Tag>
                      {latestRunByTask[String(it.id)].started_at ? dayjs(latestRunByTask[String(it.id)].started_at).format('YYYY-MM-DD HH:mm:ss') : ''}
                    </span>
                  )}
                </div>
              }
            />
          </List.Item>
        )} />
      </Card>

      <Card title="Task Runs" style={{ marginTop: 16 }} extra={
        <Select
          style={{ minWidth: 220 }}
          placeholder="Select task"
          value={chartTaskId ?? undefined}
          onChange={setChartTaskId}
          options={visibleItems.map((it:any) => ({ label: it.name, value: it.id }))}
        />
      }>
        <Table
          size="small"
          columns={tableColumns}
          dataSource={chartData}
          pagination={{ pageSize: 10 }}
          locale={{ emptyText: 'No runs found for this task yet.' }}
        />
      </Card>

      <Modal
        open={!!runsModalTask}
        onCancel={closeRunsModal}
        footer={null}
        title={runsModalTask ? `Runs for ${runsModalTask.name}` : 'Runs'}
      >
        {runsModalTask && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <Popconfirm
              title="Clear task runs?"
              description="This removes all run history for this task."
              okText="Clear"
              okButtonProps={{ danger: true }}
              placement="leftTop"
              onConfirm={()=>clearRunsForTask(runsModalTask.id)}
            >
              <Button danger>Clear Runs</Button>
            </Popconfirm>
          </div>
        )}
        <List dataSource={runs.filter(r => runsModalTask ? String(r.task || r.task_id || '') === String(runsModalTask.id) : true)} renderItem={(r:any)=>(
          <List.Item>
            <List.Item.Meta
              title={<span>{r.task_name ? `${r.task_name} · ` : ''}Run {r.id} - <Tag color={statusColor(r.status)}>{r.status || 'unknown'}</Tag></span>}
              description={r.started_at ? `started: ${dayjs(r.started_at).format('YYYY-MM-DD HH:mm:ss')}` : ''}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <Button onClick={()=>setLogsModalRun(r)}>View Logs</Button>
            </div>
          </List.Item>
        )} />
      </Modal>

      <Modal
        open={!!logsModalRun}
        title={logsModalRun ? `Run ${logsModalRun.id} logs` : 'Run logs'}
        onCancel={()=>setLogsModalRun(null)}
        footer={<Button onClick={()=>setLogsModalRun(null)}>Close</Button>}
        width={800}
      >
        <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 500, overflow: 'auto' }}>
          {logsModalRun?.logs || 'No logs available.'}
        </pre>
      </Modal>

      <Modal
        open={showPreviewDataModal}
        title="Data preview"
        onCancel={()=>{ setShowPreviewDataModal(false); setPreviewData(null) }}
        footer={<Button onClick={()=>{ setShowPreviewDataModal(false); setPreviewData(null) }}>Close</Button>}
        width={800}
      >
        <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 400, overflow: 'auto' }}>
{JSON.stringify(previewData, null, 2)}
        </pre>
      </Modal>

      <Modal open={showModal} onCancel={()=>{ setShowModal(false); setEditingTask(null) }} onOk={save} title={editingTask ? 'Edit Task' : 'New Task'}>
        <Form form={form} layout="vertical" initialValues={{ schedule: '0 0 * * *', dest_integration: DJANGO_DEFAULT_DEST }}>
          <Form.Item name="name" label="Name" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="schedule" label="Cron (e.g. 0 0 * * *)" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="source_integration" label="Source Integration (Elasticsearch)">
            <Select allowClear>
              {integrations.filter(i=>i.type==='elasticsearch').map(it => (<Select.Option key={it.id} value={it.id}>{it.name}</Select.Option>))}
            </Select>
          </Form.Item>
          <Form.Item label="Index (Elasticsearch)">
            <Input.Group compact>
              <Form.Item name="index" noStyle rules={[{ required: true }]}><Input style={{ width: '70%' }} /></Form.Item>
              <Button onClick={async ()=>{
                try{
                  const vals = form.getFieldsValue()
                  let q = null
                  // compute timestamp range from absolute or relative inputs
                  const range = computeTsRange(vals)
                  if(vals.timestamp_field && range.from){
                    q = { "query": { "range": { [vals.timestamp_field]: { "gte": range.from, "lte": range.to || 'now' } } } }
                  } else if(vals.timestamp_field){
                    // fallback: sometimes preset selection lives in time_selector or timestamp_relative
                    const sel = vals.time_selector || vals.timestamp_relative
                    let tsFrom: string | null = null
                    let tsTo: string | null = null
                    if(sel){
                      if(typeof sel === 'string'){
                        if(sel === 'custom' || sel === 'custom_relative' || sel === 'custom-relative'){
                          // read custom fields
                          if(vals.timestamp_relative_custom_value && vals.timestamp_relative_custom_unit){
                            tsFrom = `now-${vals.timestamp_relative_custom_value}${vals.timestamp_relative_custom_unit}`
                            tsTo = 'now'
                          }
                        }else{
                          const m = (''+sel).match(/^(\d+)([mhd])$/)
                          if(m){ tsFrom = `now-${m[1]}${m[2]}`; tsTo = 'now' }
                        }
                      }else if(typeof sel === 'object' && sel !== null){
                        if(sel.value && sel.unit){ tsFrom = `now-${sel.value}${sel.unit}`; tsTo = 'now' }
                      }
                    }
                    if(tsFrom){ q = { "query": { "range": { [vals.timestamp_field]: { "gte": tsFrom, "lte": tsTo || 'now' } } } } }
                  }
                  const res = await previewEsIntegration({ integration_id: vals.source_integration, index: vals.index, size: Number(vals.limit) || 10, query: q })
                  if(res.error) throw new Error(res.error)
                  setPreviewData(res.rows || [])
                  setShowPreviewDataModal(true)
                }catch(e:any){ message.error(String(e)) }
              }} style={{ marginLeft: 8 }}>Preview Data</Button>
            </Input.Group>
          </Form.Item>
          <Form.Item name="timestamp_field" label="Timestamp field (optional)"><Input placeholder="@timestamp or ts_field" /></Form.Item>
          <Form.Item name="time_selector" label="Time range">
            <Select
              onChange={(val:any)=>{
                // keep backward-compatible fields in sync: timestamp_relative or timestamp_from
                if(val === 'absolute'){
                  form.setFieldsValue({ timestamp_relative: undefined, timestamp_from: undefined, timestamp_to: undefined })
                }else if(val === 'custom_relative'){
                  // mark relative as 'custom' and clear absolute
                  form.setFieldsValue({ timestamp_from: undefined, timestamp_to: undefined, timestamp_relative: 'custom' })
                }else{
                  // preset: clear absolute and set preset string like '1h'
                  form.setFieldsValue({ timestamp_from: undefined, timestamp_to: undefined, timestamp_relative: val })
                }
                // time_selector itself is managed by the Form.Item binding; no need to set it here
              }}
            >
              <Select.Option value="1h">Last 1 hour</Select.Option>
              <Select.Option value="6h">Last 6 hours</Select.Option>
              <Select.Option value="24h">Last 24 hours</Select.Option>
              <Select.Option value="7d">Last 7 days</Select.Option>
              <Select.Option value="custom_relative">Custom relative</Select.Option>
              <Select.Option value="absolute">Absolute (pick a timestamp)</Select.Option>
            </Select>
          </Form.Item>

          {/* Render controls for absolute or custom relative depending on selection. The sub-controls write into the
              same form field names used elsewhere so computeTsFromIso continues to work. */}
          <Form.Item shouldUpdate noStyle>
            {()=>{
              const sel = form.getFieldValue('time_selector')
              if(sel === 'absolute'){
                return (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <Form.Item name="timestamp_from" label="From"><DatePicker showTime style={{ width: '100%' }} /></Form.Item>
                    <Form.Item name="timestamp_to" label="To"><DatePicker showTime style={{ width: '100%' }} /></Form.Item>
                  </div>
                )
              }
              if(sel === 'custom_relative'){
                return (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Form.Item name="timestamp_relative_custom_value" noStyle><InputNumber min={1} /></Form.Item>
                    <Form.Item name="timestamp_relative_custom_unit" noStyle><Select style={{ width: 120 }}>
                      <Select.Option value="m">minutes</Select.Option>
                      <Select.Option value="h">hours</Select.Option>
                      <Select.Option value="d">days</Select.Option>
                    </Select></Form.Item>
                  </div>
                )
              }
              // for presets or no selection render nothing (presets stored in timestamp_relative via onChange)
              return null
            }}
          </Form.Item>
          <Form.Item name="dest_integration" label="Destination Integration (Database)">
            <Select allowClear>
              <Select.Option value={DJANGO_DEFAULT_DEST}>Current DB (Django default)</Select.Option>
              {
                integrations
                  .filter(i=>{
                    if(!i) return false
                    const t = (i.type || '').toString().toLowerCase()
                    // accept common type strings as DB integrations
                    if(['postgresql','postgres','mysql'].includes(t)) return true
                    // or heuristics: presence of DB config fields
                    const cfg = i.config || {}
                    if(cfg.conn_str || cfg.dbname || cfg.database || cfg.django_db) return true
                    return false
                  })
                  .map(it => (<Select.Option key={it.id} value={it.id}>{it.name}</Select.Option>))
              }
            </Select>
          </Form.Item>
          <Form.Item label="Destination table">
            <Input value={DEST_TABLE} disabled />
          </Form.Item>
          <Form.Item name="limit" label="Limit"><InputNumber style={{ width: '100%' }} min={1} /></Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
