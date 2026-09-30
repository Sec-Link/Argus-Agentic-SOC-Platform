import React from 'react';
import { Button, Collapse, Input, Select, Space, Tag, Typography } from 'antd';
import { CheckCircleOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import type { VariableDeclaration, VariableOption } from '../variables';

const { Text } = Typography;

export const VariableReference: React.FC<{ options: VariableOption[] }> = ({ options }) => (
  <Collapse
    size="small"
    items={[{
      key: 'context',
      label: `Available context (${options.length})`,
      children: (
        <div style={{ maxHeight: 240, overflow: 'auto' }}>
          <Text type="secondary" style={{ fontSize: 'calc(var(--workflow-sidebar-font-size, 14px) - 2px)' }}>
            Copy a reference into a supported text field. Event values are filled at runtime;
            previous-step values require a completed step. Append a field path for nested data.
            Secret references are only allowed in credential fields or API parameters marked Sensitive.
          </Text>
          {options.map((option) => (
            <div key={option.value} style={{ marginTop: 8, overflowWrap: 'anywhere' }}>
              <Text type="secondary" style={{ display: 'block', fontSize: 'calc(var(--workflow-sidebar-font-size, 14px) - 2px)' }}>{option.label}</Text>
              <Text code copyable={{ text: option.value }} style={{ fontSize: 'calc(var(--workflow-sidebar-font-size, 14px) - 2px)' }}>{option.value}</Text>
            </div>
          ))}
        </div>
      ),
    }]}
  />
);

const WorkflowVariablesPanel: React.FC<{
  value?: VariableDeclaration[];
  onChange?: (value: VariableDeclaration[]) => void;
  options: VariableOption[];
}> = ({ value = [], onChange, options }) => {
  const update = (index: number, patch: Partial<VariableDeclaration>) => {
    onChange?.(value.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <Text type="secondary" style={{ fontSize: 'calc(var(--workflow-sidebar-font-size, 14px) - 2px)' }}>
        Declare once, reuse with {'{{variables.name}}'}. Saved with this workflow.
        Choose Secret for encrypted, write-only credentials. Other values are stored as plain text;
        step outputs can replace ordinary variables with the same name.
      </Text>
      {value.map((row, index) => (
        <details key={index} style={{ minWidth: 0, border: '1px solid var(--workflow-border, #f0f0f0)', borderRadius: 6 }}>
          <summary
            title={row.name || `Variable ${index + 1}`}
            style={{ cursor: 'pointer', padding: '8px 10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', width: 'calc(100% - 1.25em)', verticalAlign: 'middle' }}>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {row.name || `Variable ${index + 1}`}
              </span>
              {row.type === 'secret' && row.configuredName === row.name ? (
                <Tag color="success" icon={<CheckCircleOutlined />} style={{ flexShrink: 0, marginLeft: 8, marginRight: 0, fontSize: 'calc(var(--workflow-sidebar-font-size, 14px) - 2px)' }}>
                  Secret · Configured
                </Tag>
              ) : (
                <Text type="secondary" style={{ flexShrink: 0, marginLeft: 8, fontSize: 'calc(var(--workflow-sidebar-font-size, 14px) - 2px)' }}>
                  {row.type === 'secret' ? 'Secret' : row.type === 'json' ? 'JSON' : 'Text'}
                </Text>
              )}
            </span>
          </summary>
          <div style={{ padding: '0 10px 10px', minWidth: 0 }}>
            <Space.Compact style={{ width: '100%', marginBottom: 6 }}>
              <Input
                aria-label={`Variable ${index + 1} name`}
                style={{ minWidth: 0 }}
                placeholder="name"
                value={row.name}
                onChange={(event) => update(index, { name: event.target.value })}
              />
              <Button
                danger
                aria-label={`Delete variable ${row.name || index + 1}`}
                icon={<DeleteOutlined />}
                onClick={() => onChange?.(value.filter((_, rowIndex) => rowIndex !== index))}
              />
            </Space.Compact>
            <Select
              aria-label={`Variable ${index + 1} type`}
              value={row.type}
              options={[{ value: 'string', label: 'Text' }, { value: 'json', label: 'JSON' }, { value: 'secret', label: 'Secret' }]}
              onChange={(type) => update(index, { type, ...(row.type === 'secret' ? { value: '' } : {}) })}
              style={{ width: '100%', marginBottom: 6 }}
            />
            {row.type === 'secret' ? (
              <Input.Password
                aria-label={`Variable ${index + 1} secret value`}
                placeholder={row.configuredName === row.name ? 'Configured — leave blank to keep it' : 'Enter secret'}
                autoComplete="new-password"
                visibilityToggle={false}
                value={row.value}
                onChange={(event) => update(index, { value: event.target.value })}
              />
            ) : <Input.TextArea
              aria-label={`Variable ${index + 1} value`}
              placeholder={row.type === 'json' ? '123, true, ["a"], {"key":"value"}' : 'Value'}
              autoSize={{ minRows: 1, maxRows: 4 }}
              value={row.value}
              onChange={(event) => update(index, { value: event.target.value })}
            />}
            {/^[A-Za-z_][A-Za-z0-9_]*$/.test(row.name) && (
              <Text code copyable={{ text: `{{variables.${row.name}}}` }} style={{ display: 'block', fontSize: 'calc(var(--workflow-sidebar-font-size, 14px) - 2px)', overflowWrap: 'anywhere' }}>
                {`{{variables.${row.name}}}`}
              </Text>
            )}
          </div>
        </details>
      ))}
      <Button block type="dashed" icon={<PlusOutlined />} onClick={() => onChange?.([...value, { name: '', value: '', type: 'string' }])}>
        Add variable
      </Button>
      <VariableReference options={options} />
    </div>
  );
};

export default WorkflowVariablesPanel;
