/**
 * Action Config Builder Component
 *
 * Provides a visual form-based configuration for workflow actions,
 * with the option to switch to raw JSON editing mode.
 *
 * Supported action types:
 *   Control Flow  : (handled as node types – no config builder needed)
 *   Enrichment    : ip_lookup, hash_lookup
 *   Containment   : block_ip, disable_user
 *   Release       : release_ip, enable_user
 *   Notification  : send_email, send_webhook
 *   Integration   : create_ticket, update_ticket
 *   Utility       : log, delay
 */
import React, { useState, useEffect } from 'react';
import {
  Form,
  Input,
  Select,
  Switch,
  InputNumber,
  Button,
  Space,
  Tabs,
  Card,
  Tag,
  Divider,
  Typography,
  Tooltip,
  Alert,
} from 'antd';
import {
  CodeOutlined,
  FormOutlined,
  PlusOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';

const { TextArea } = Input;
const { Text } = Typography;

interface ActionConfigBuilderProps {
  actionType: string;
  config: Record<string, any>;
  onChange: (config: Record<string, any>) => void;
}

// ── Schema definitions ────────────────────────────────────────────────────
// Each entry describes what visual fields the form should render.
// Fields not listed here are still editable in JSON mode.

type FieldDef = {
  name: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'select' | 'textarea' | 'array' | 'password' | 'keyvalue';
  required?: boolean;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
  default?: any;
  description?: string;
};

type SchemaDef = { name: string; description: string; fields: FieldDef[] };

const actionSchemas: Record<string, SchemaDef> = {
  // ── Utility ──────────────────────────────────────────────────────────────
  log: {
    name: 'Log Message',
    description: 'Log a message for debugging purposes',
    fields: [
      {
        name: 'message', label: 'Message', type: 'textarea', required: true,
        placeholder: 'Enter log message…',
        description: 'Supports variables like {{trigger_data.field}}',
      },
      {
        name: 'level', label: 'Log Level', type: 'select',
        options: [
          { value: 'info', label: 'Info' },
          { value: 'warning', label: 'Warning' },
          { value: 'error', label: 'Error' },
        ],
        default: 'info',
      },
    ],
  },
  delay: {
    name: 'Delay',
    description: 'Wait for a specified number of seconds',
    fields: [
      {
        name: 'seconds', label: 'Seconds', type: 'number', required: true,
        default: 5, description: 'Wait time (1–3600 seconds)',
      },
    ],
  },

  // ── Notification ─────────────────────────────────────────────────────────
  send_email: {
    name: 'Send Email',
    description: 'Send an email notification',
    fields: [
      {
        name: 'to', label: 'Recipients', type: 'array', required: true,
        placeholder: 'email@example.com',
        description: 'Add one or more email addresses',
      },
      {
        name: 'subject', label: 'Subject', type: 'string', required: true,
        placeholder: 'Alert: {{trigger_data.alert_name}}',
      },
      {
        name: 'body', label: 'Email Body', type: 'textarea', required: true,
        placeholder: 'Alert details:\nSeverity: {{trigger_data.severity}}\nSource IP: {{trigger_data.source_ip}}',
      },
      { name: 'is_html', label: 'HTML Email', type: 'boolean', default: false },
    ],
  },
  send_webhook: {
    name: 'Send Webhook',
    description: 'Send an HTTP request to a webhook URL with a configurable JSON body',
    fields: [
      {
        name: 'url', label: 'Webhook URL', type: 'string', required: true,
        placeholder: 'https://api.example.com/webhook',
      },
      {
        name: 'method', label: 'HTTP Method', type: 'select',
        options: [
          { value: 'GET', label: 'GET' },
          { value: 'POST', label: 'POST' },
          { value: 'PUT', label: 'PUT' },
          { value: 'PATCH', label: 'PATCH' },
        ],
        default: 'POST',
      },
      {
        name: 'headers', label: 'Headers', type: 'keyvalue',
        description: 'Optional HTTP headers sent with the request',
      },
      {
        name: 'body_template', label: 'Request Body (JSON)', type: 'textarea',
        placeholder: '{\n  "alert": "{{trigger_data.alert_name}}",\n  "severity": "{{trigger_data.severity}}"\n}',
        description: (
          'JSON string.  Use {{variable.path}} for dynamic values.  ' +
          'The system validates this is valid JSON before sending.'
        ),
      },
      { name: 'timeout', label: 'Timeout (seconds)', type: 'number', default: 30 },
    ],
  },

  // ── Enrichment ───────────────────────────────────────────────────────────
  ip_lookup: {
    name: 'IP Lookup',
    description: 'Check IP reputation via a configurable threat-intel platform (e.g. AbuseIPDB, VirusTotal)',
    fields: [
      {
        name: 'ip_address', label: 'IP Address', type: 'string', required: true,
        placeholder: '{{trigger_data.source_ip}}',
        description: 'Supports dynamic values extracted from the triggering case or alert',
      },
      {
        name: 'api_url', label: 'Threat-Intel API URL', type: 'string', required: true,
        placeholder: 'https://api.abuseipdb.com/api/v2/check',
        description: 'Full API endpoint of the threat-intelligence platform',
      },
      {
        name: 'api_key', label: 'API Key', type: 'password', required: true,
        placeholder: 'Your API key',
        description: 'API key / token for the threat-intelligence platform',
      },
      { name: 'timeout', label: 'Timeout (seconds)', type: 'number', default: 15 },
    ],
  },
  hash_lookup: {
    name: 'Hash Lookup',
    description: 'Check file-hash reputation via a configurable threat-intel platform (e.g. VirusTotal)',
    fields: [
      {
        name: 'hash_value', label: 'File Hash', type: 'string', required: true,
        placeholder: '{{trigger_data.file_hash}}',
        description: 'Supports dynamic values extracted from the triggering case or alert',
      },
      {
        name: 'hash_type', label: 'Hash Type', type: 'select',
        options: [
          { value: 'md5', label: 'MD5' },
          { value: 'sha1', label: 'SHA-1' },
          { value: 'sha256', label: 'SHA-256' },
        ],
        default: 'sha256',
      },
      {
        name: 'api_url', label: 'Threat-Intel API URL', type: 'string', required: true,
        placeholder: 'https://www.virustotal.com/api/v3/files/{hash}',
        description: 'Use {hash} as a placeholder – it will be replaced with the resolved hash value',
      },
      {
        name: 'api_key', label: 'API Key', type: 'password', required: true,
        placeholder: 'Your API key',
      },
      { name: 'timeout', label: 'Timeout (seconds)', type: 'number', default: 15 },
    ],
  },

  // ── Containment ──────────────────────────────────────────────────────────
  block_ip: {
    name: 'Block IP',
    description: 'Block an IP address via a security-device API (firewall / EDR)',
    fields: [
      {
        name: 'ip_address', label: 'IP Address', type: 'string', required: true,
        placeholder: '{{trigger_data.source_ip}}',
        description: 'Supports dynamic values extracted from the triggering case or alert',
      },
      {
        name: 'api_url', label: 'Security Device API URL', type: 'string', required: true,
        placeholder: 'https://firewall.example.com/api/v1/block',
      },
      {
        name: 'api_key', label: 'API Key', type: 'password', required: true,
        placeholder: 'Your API key / token',
      },
      {
        name: 'duration_hours', label: 'Block Duration (hours)', type: 'number',
        default: 24, description: '0 = permanent block',
      },
      {
        name: 'reason', label: 'Reason', type: 'string',
        placeholder: 'Blocked by SOAR workflow – {{trigger_data.alert_name}}',
      },
      { name: 'timeout', label: 'Timeout (seconds)', type: 'number', default: 15 },
    ],
  },
  disable_user: {
    name: 'Disable User',
    description: 'Disable a user account via a security-device or AD API',
    fields: [
      {
        name: 'username', label: 'Username / UPN', type: 'string', required: true,
        placeholder: '{{trigger_data.username}}',
        description: 'AD username or UPN – supports dynamic values from the triggering case or alert',
      },
      {
        name: 'api_url', label: 'Security Device / AD API URL', type: 'string', required: true,
        placeholder: 'https://ad.example.com/api/v1/users/disable',
      },
      {
        name: 'api_key', label: 'API Key', type: 'password', required: true,
        placeholder: 'Your API key / token',
      },
      {
        name: 'reason', label: 'Reason', type: 'string',
        placeholder: 'Disabled by SOAR workflow – {{trigger_data.alert_name}}',
      },
      { name: 'timeout', label: 'Timeout (seconds)', type: 'number', default: 15 },
    ],
  },

  // ── Release ───────────────────────────────────────────────────────────────
  release_ip: {
    name: 'Release IP',
    description: 'Release (unblock) an IP address via a security-device API',
    fields: [
      {
        name: 'ip_address', label: 'IP Address', type: 'string', required: true,
        placeholder: '{{trigger_data.source_ip}}',
        description: 'Supports dynamic values extracted from the triggering case or alert',
      },
      {
        name: 'api_url', label: 'Security Device API URL', type: 'string', required: true,
        placeholder: 'https://firewall.example.com/api/v1/release',
      },
      {
        name: 'api_key', label: 'API Key', type: 'password', required: true,
        placeholder: 'Your API key / token',
      },
      {
        name: 'reason', label: 'Reason', type: 'string',
        placeholder: 'Released by SOAR workflow',
      },
      { name: 'timeout', label: 'Timeout (seconds)', type: 'number', default: 15 },
    ],
  },
  enable_user: {
    name: 'Enable User',
    description: 'Enable (re-activate) a user account via a security-device or AD API',
    fields: [
      {
        name: 'username', label: 'Username / UPN', type: 'string', required: true,
        placeholder: '{{trigger_data.username}}',
        description: 'AD username or UPN – supports dynamic values from the triggering case or alert',
      },
      {
        name: 'api_url', label: 'Security Device / AD API URL', type: 'string', required: true,
        placeholder: 'https://ad.example.com/api/v1/users/enable',
      },
      {
        name: 'api_key', label: 'API Key', type: 'password', required: true,
        placeholder: 'Your API key / token',
      },
      {
        name: 'reason', label: 'Reason', type: 'string',
        placeholder: 'Enabled by SOAR workflow',
      },
      { name: 'timeout', label: 'Timeout (seconds)', type: 'number', default: 15 },
    ],
  },

  // ── Integration ───────────────────────────────────────────────────────────
  create_ticket: {
    name: 'Create Ticket',
    description: 'Create a new incident ticket in the SIEM',
    fields: [
      {
        name: 'title', label: 'Ticket Title', type: 'string', required: true,
        placeholder: 'Security Alert: {{trigger_data.alert_name}}',
        description: 'Maps to EventTicket.title (max 255 chars)',
      },
      {
        name: 'description', label: 'Description', type: 'textarea',
        placeholder: 'Ticket description…',
      },
      {
        name: 'status', label: 'Initial Status', type: 'select',
        options: [
          { value: 'new', label: 'New' },
          { value: 'acknowledged', label: 'Acknowledged' },
          { value: 'triaged', label: 'Triaged' },
          { value: 'contained', label: 'Contained' },
          { value: 'resolved', label: 'Resolved' },
          { value: 'closed', label: 'Closed' },
        ],
        default: 'new',
      },
      {
        name: 'priority', label: 'Priority', type: 'select',
        options: [
          { value: 'critical', label: 'Critical' },
          { value: 'high', label: 'High' },
          { value: 'medium', label: 'Medium' },
          { value: 'low', label: 'Low' },
        ],
        default: 'medium',
      },
      {
        name: 'event_category', label: 'Event Category', type: 'select',
        options: [
          { value: 'account_anomalies', label: 'Account Anomalies' },
          { value: 'denial_of_service', label: 'Denial of Service' },
          { value: 'malware', label: 'Malware' },
          { value: 'system_anomalies', label: 'System Anomalies' },
          { value: 'network_anomalies', label: 'Network Anomalies' },
          { value: 'application_anomalies', label: 'Application Anomalies' },
          { value: 'policy', label: 'Policy' },
          { value: 'social_engineering', label: 'Social Engineering' },
          { value: 'others', label: 'Others' },
        ],
        description: 'Incident category classification',
      },
      { name: 'current_assign_group', label: 'Assign Group', type: 'string', placeholder: 'SOC L1' },
      { name: 'current_assign_owner', label: 'Assign Owner', type: 'string', placeholder: 'username' },
      {
        name: 'alert_message', label: 'Alert Message', type: 'textarea',
        placeholder: '{{trigger_data.raw_message}}',
        description: 'Raw alert message content',
      },
    ],
  },
  update_ticket: {
    name: 'Update Ticket',
    description: 'Update tickets selected by upstream context, then apply new field values',
    fields: [
      {
        name: 'ticket_number', label: 'Ticket Number', type: 'string',
        placeholder: '{{trigger_data.ticket_number}}',
        description: 'Optional exact ticket number match',
      },
      {
        name: 'title', label: 'Ticket Title', type: 'string',
        placeholder: '{{trigger_data.title}}',
        description: 'Optional exact ticket title match, e.g. {{trigger_data.title}}',
      },
      {
        name: 'match_status', label: 'Match Current Status', type: 'select',
        options: [
          { value: 'new', label: 'New' },
          { value: 'acknowledged', label: 'Acknowledged' },
          { value: 'triaged', label: 'Triaged' },
          { value: 'contained', label: 'Contained' },
          { value: 'resolved', label: 'Resolved' },
          { value: 'closed', label: 'Closed' },
        ],
      },
      {
        name: 'match_priority', label: 'Match Current Priority', type: 'select',
        options: [
          { value: 'critical', label: 'Critical' },
          { value: 'high', label: 'High' },
          { value: 'medium', label: 'Medium' },
          { value: 'low', label: 'Low' },
        ],
      },
      {
        name: 'match_assign_group', label: 'Match Assign Group', type: 'string',
        placeholder: 'SOC L1',
      },
      {
        name: 'match_assign_owner', label: 'Match Assign Owner', type: 'string',
        placeholder: 'username',
      },
      {
        name: 'status', label: 'New Status', type: 'select',
        options: [
          { value: 'new', label: 'New' },
          { value: 'acknowledged', label: 'Acknowledged' },
          { value: 'triaged', label: 'Triaged' },
          { value: 'contained', label: 'Contained' },
          { value: 'resolved', label: 'Resolved' },
          { value: 'closed', label: 'Closed' },
        ],
      },
      {
        name: 'priority', label: 'Priority', type: 'select',
        options: [
          { value: 'critical', label: 'Critical' },
          { value: 'high', label: 'High' },
          { value: 'medium', label: 'Medium' },
          { value: 'low', label: 'Low' },
        ],
      },
      {
        name: 'current_assign_group', label: 'Assign Group', type: 'string',
        placeholder: 'SOC L2',
      },
      {
        name: 'current_assign_owner', label: 'Reassign To', type: 'string',
        placeholder: 'new_owner',
      },
      {
        name: 'event_result', label: 'Event Result', type: 'select',
        options: [
          { value: 'true_positive', label: 'True Positive' },
          { value: 'false_positive', label: 'False Positive' },
          { value: 'true_positive_benign', label: 'True Positive – Benign' },
        ],
        description: 'Classification result (used when resolving)',
      },
      {
        name: 'event_category', label: 'Event Category', type: 'select',
        options: [
          { value: 'account_anomalies', label: 'Account Anomalies' },
          { value: 'denial_of_service', label: 'Denial of Service' },
          { value: 'malware', label: 'Malware' },
          { value: 'system_anomalies', label: 'System Anomalies' },
          { value: 'network_anomalies', label: 'Network Anomalies' },
          { value: 'application_anomalies', label: 'Application Anomalies' },
          { value: 'policy', label: 'Policy' },
          { value: 'social_engineering', label: 'Social Engineering' },
          { value: 'others', label: 'Others' },
        ],
      },
      {
        name: 'ticket_records', label: 'Handling Notes', type: 'textarea',
        placeholder: 'Update notes…',
        description: 'Detailed handling results and notes',
      },
      {
        name: 'add_comment', label: 'Comment', type: 'textarea',
        placeholder: 'Short comment…',
        description: 'Compatibility field mapped to ticket records when provided',
      },
    ],
  },
};

// ── Array input helper ────────────────────────────────────────────────────
const ArrayInput: React.FC<{
  value?: string[];
  onChange?: (value: string[]) => void;
  placeholder?: string;
}> = ({ value = [], onChange, placeholder }) => {
  const [inputValue, setInputValue] = useState('');

  const handleAdd = () => {
    if (inputValue.trim() && !value.includes(inputValue.trim())) {
      onChange?.([...value, inputValue.trim()]);
      setInputValue('');
    }
  };

  return (
    <div>
      <Space style={{ marginBottom: 8 }}>
        <Input
          placeholder={placeholder}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onPressEnter={handleAdd}
          style={{ width: 220 }}
        />
        <Button type="primary" size="small" icon={<PlusOutlined />} onClick={handleAdd}>
          Add
        </Button>
      </Space>
      <div>
        {value.map((item, index) => (
          <Tag
            key={index}
            closable
            onClose={() => onChange?.(value.filter((_, i) => i !== index))}
            style={{ marginBottom: 4 }}
          >
            {item}
          </Tag>
        ))}
      </div>
    </div>
  );
};

const KeyValueInput: React.FC<{
  value?: Record<string, string>;
  onChange?: (value: Record<string, string>) => void;
}> = ({ value = {}, onChange }) => {
  const [keyInput, setKeyInput] = useState('');
  const [valueInput, setValueInput] = useState('');

  const entries = Object.entries(value || {});

  const handleAdd = () => {
    const key = keyInput.trim();
    if (!key) return;
    onChange?.({ ...value, [key]: valueInput });
    setKeyInput('');
    setValueInput('');
  };

  const handleRemove = (key: string) => {
    const next = { ...value };
    delete next[key];
    onChange?.(next);
  };

  return (
    <div>
      <Space style={{ marginBottom: 8, width: '100%' }} wrap>
        <Input
          placeholder="Header name"
          value={keyInput}
          onChange={(e) => setKeyInput(e.target.value)}
          style={{ width: 180 }}
        />
        <Input
          placeholder="Header value"
          value={valueInput}
          onChange={(e) => setValueInput(e.target.value)}
          style={{ width: 220 }}
        />
        <Button type="primary" size="small" icon={<PlusOutlined />} onClick={handleAdd}>
          Add
        </Button>
      </Space>
      <div>
        {entries.map(([key, itemValue]) => (
          <Tag
            key={key}
            closable
            onClose={() => handleRemove(key)}
            style={{ marginBottom: 4 }}
          >
            {key}: {itemValue}
          </Tag>
        ))}
      </div>
    </div>
  );
};

// ── Main component ────────────────────────────────────────────────────────
const ActionConfigBuilder: React.FC<ActionConfigBuilderProps> = ({
  actionType,
  config,
  onChange,
}) => {
  const [mode, setMode] = useState<'form' | 'json'>('form');
  const [jsonValue, setJsonValue] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [form] = Form.useForm();

  const schema = actionSchemas[actionType];

  useEffect(() => {
    if (config) {
      form.setFieldsValue(config);
      setJsonValue(JSON.stringify(config, null, 2));
    }
  }, [config, form]);

  const handleFormChange = () => {
    const values = form.getFieldsValue();
    onChange(values);
    setJsonValue(JSON.stringify(values, null, 2));
  };

  const handleJsonChange = (value: string) => {
    setJsonValue(value);
    try {
      const parsed = JSON.parse(value);
      setJsonError(null);
      onChange(parsed);
      form.setFieldsValue(parsed);
    } catch {
      setJsonError('Invalid JSON format');
    }
  };

  const renderField = (field: FieldDef) => {
    switch (field.type) {
      case 'string':
        return <Input placeholder={field.placeholder} />;
      case 'password':
        return <Input.Password placeholder={field.placeholder} />;
      case 'number':
        return <InputNumber style={{ width: '100%' }} min={0} />;
      case 'boolean':
        return <Switch />;
      case 'select':
        return <Select options={field.options} placeholder="Select…" allowClear />;
      case 'textarea':
        return <TextArea rows={4} placeholder={field.placeholder} style={{ fontFamily: 'monospace', fontSize: 12 }} />;
      case 'array':
        return <ArrayInput placeholder={field.placeholder} />;
      case 'keyvalue':
        return <KeyValueInput />;
      default:
        return <Input placeholder={field.placeholder} />;
    }
  };

  // If no schema is defined, fall back to raw JSON
  if (!schema) {
    return (
      <div>
        <Alert
          message="Custom Action"
          description="No visual editor available for this action type. Configure using JSON below."
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />
        <TextArea
          rows={10}
          style={{ fontFamily: 'monospace' }}
          value={jsonValue}
          onChange={(e) => handleJsonChange(e.target.value)}
        />
        {jsonError && <Text type="danger">{jsonError}</Text>}
      </div>
    );
  }

  return (
    <div>
      <Tabs
        activeKey={mode}
        onChange={(key) => setMode(key as 'form' | 'json')}
        items={[
          { key: 'form', label: <span><FormOutlined /> Visual Editor</span> },
          { key: 'json', label: <span><CodeOutlined /> JSON</span> },
        ]}
        style={{ marginBottom: 16 }}
      />

      {mode === 'form' ? (
        <Form
          form={form}
          layout="vertical"
          onValuesChange={handleFormChange}
          initialValues={config}
        >
          <Card size="small" style={{ marginBottom: 16, background: '#f5f5f5' }}>
            <Text strong>{schema.name}</Text>
            <br />
            <Text type="secondary" style={{ fontSize: 12 }}>{schema.description}</Text>
          </Card>

          {schema.fields.map((field) => (
            <Form.Item
              key={field.name}
              name={field.name}
              label={
                <Space>
                  {field.label}
                  {field.required && <Text type="danger">*</Text>}
                  {field.description && (
                    <Tooltip title={field.description}>
                      <InfoCircleOutlined style={{ color: '#999' }} />
                    </Tooltip>
                  )}
                </Space>
              }
              rules={
                field.required
                  ? [{ required: true, message: `${field.label} is required` }]
                  : []
              }
              valuePropName={field.type === 'boolean' ? 'checked' : 'value'}
              initialValue={field.default}
            >
              {renderField(field)}
            </Form.Item>
          ))}

          <Divider />
          <Alert
            message="Variable Syntax"
            description={
              <div>
                <Text>
                  Use <code>{'{{variable.path}}'}</code> to insert dynamic values from the
                  triggering event:
                </Text>
                <ul style={{ marginBottom: 0, paddingLeft: 20, fontSize: 12 }}>
                  <li><code>{'{{trigger_data.severity}}'}</code> – Alert / ticket severity</li>
                  <li><code>{'{{trigger_data.source_ip}}'}</code> – Source IP address</li>
                  <li><code>{'{{trigger_data.username}}'}</code> – Associated username</li>
                  <li><code>{'{{trigger_data.file_hash}}'}</code> – File hash</li>
                  <li><code>{'{{trigger_data.alert_name}}'}</code> – Alert name</li>
                  <li><code>{'{{trigger_data.ticket_number}}'}</code> – Ticket number</li>
                </ul>
                <Text style={{ fontSize: 11 }}>
                  See the <strong>Variable Reference Guide</strong> for the full list.
                </Text>
              </div>
            }
            type="info"
            showIcon
          />
        </Form>
      ) : (
        <div>
          <TextArea
            rows={15}
            style={{ fontFamily: 'monospace' }}
            value={jsonValue}
            onChange={(e) => handleJsonChange(e.target.value)}
          />
          {jsonError && (
            <Text type="danger" style={{ display: 'block', marginTop: 8 }}>
              {jsonError}
            </Text>
          )}
        </div>
      )}
    </div>
  );
};

export default ActionConfigBuilder;

