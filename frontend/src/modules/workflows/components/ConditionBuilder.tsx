/**
 * Condition Builder Component for SOAR Workflow Editor
 *
 * Provides a visual interface for building conditional expressions
 * used in condition nodes for workflow branching decisions.
 */
import React, { useState, useEffect } from 'react';
import {
  Modal,
  Form,
  Select,
  Input,
  Button,
  Space,
  Card,
  Row,
  Col,
  Divider,
  Typography,
  Tooltip,
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  QuestionCircleOutlined,
} from '@ant-design/icons';
const { Text } = Typography;
const { Option } = Select;

// Available operators for conditions
const operators = [
  { value: 'equals', label: 'Equals (==)', description: 'Value exactly matches' },
  { value: 'not_equals', label: 'Not Equals (!=)', description: 'Value does not match' },
  { value: 'contains', label: 'Contains', description: 'String contains substring' },
  { value: 'not_contains', label: 'Not Contains', description: 'String does not contain substring' },
  { value: 'starts_with', label: 'Starts With', description: 'String starts with value' },
  { value: 'ends_with', label: 'Ends With', description: 'String ends with value' },
  { value: 'greater_than', label: 'Greater Than (>)', description: 'Numeric comparison' },
  { value: 'less_than', label: 'Less Than (<)', description: 'Numeric comparison' },
  { value: 'greater_equal', label: 'Greater or Equal (>=)', description: 'Numeric comparison' },
  { value: 'less_equal', label: 'Less or Equal (<=)', description: 'Numeric comparison' },
  { value: 'in_list', label: 'In List', description: 'Value is one of comma-separated values' },
  { value: 'not_in_list', label: 'Not In List', description: 'Value is not in comma-separated list' },
  { value: 'is_empty', label: 'Is Empty', description: 'Value is null or empty string' },
  { value: 'is_not_empty', label: 'Is Not Empty', description: 'Value exists and is not empty' },
  { value: 'matches_regex', label: 'Matches Regex', description: 'Value matches regular expression' },
];

// Common context variables that can be used in conditions
const contextVariables = [
  { value: '{{trigger_data.severity}}', label: 'Alert Severity', category: 'trigger_data' },
  { value: '{{trigger_data.source_ip}}', label: 'Source IP', category: 'trigger_data' },
  { value: '{{trigger_data.dest_ip}}', label: 'Destination IP', category: 'trigger_data' },
  { value: '{{trigger_data.event_type}}', label: 'Event Type', category: 'trigger_data' },
  { value: '{{trigger_data.ticket_number}}', label: 'Ticket Number', category: 'trigger_data' },
  { value: '{{ticket.status}}', label: 'Ticket Status', category: 'ticket' },
  { value: '{{ticket.priority}}', label: 'Ticket Priority', category: 'ticket' },
  { value: '{{ticket.current_assign_owner}}', label: 'Assigned User', category: 'ticket' },
  { value: '{{previous_step.success}}', label: 'Previous Step Success', category: 'previous_step' },
  { value: '{{previous_step.output.ticket_number}}', label: 'Previous Step Ticket Number', category: 'previous_step' },
  { value: '{{variables.ticket_number}}', label: 'Workflow Variable Ticket Number', category: 'variables' },
  { value: '{{variables.risk_score}}', label: 'Workflow Variable Risk Score', category: 'variables' },
];

const valueOptionsByField: Record<string, { value: string; label: string }[]> = {
  '{{trigger_data.severity}}': [
    { value: 'critical', label: 'Critical' },
    { value: 'high', label: 'High' },
    { value: 'medium', label: 'Medium' },
    { value: 'low', label: 'Low' },
  ],
  '{{trigger_data.event_type}}': [
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
  '{{ticket.status}}': [
    { value: 'new', label: 'New' },
    { value: 'acknowledged', label: 'Acknowledged' },
    { value: 'triaged', label: 'Triaged' },
    { value: 'contained', label: 'Contained' },
    { value: 'resolved', label: 'Resolved' },
    { value: 'closed', label: 'Closed' },
  ],
  '{{ticket.priority}}': [
    { value: 'critical', label: 'Critical' },
    { value: 'high', label: 'High' },
    { value: 'medium', label: 'Medium' },
    { value: 'low', label: 'Low' },
  ],
};

// Logical operators for combining conditions
const logicalOperators = [
  { value: 'AND', label: 'AND', description: 'All conditions must be true' },
  { value: 'OR', label: 'OR', description: 'At least one condition must be true' },
];

interface ConditionRule {
  id: string;
  field: string;
  operator: string;
  value: string;
}

interface ConditionGroup {
  id: string;
  logic: 'AND' | 'OR';
  rules: ConditionRule[];
}

interface ConditionBuilderProps {
  visible: boolean;
  condition?: Record<string, any>;
  onSave: (condition: Record<string, any>) => void;
  onCancel: () => void;
}

const generateId = () => Math.random().toString(36).substr(2, 9);

// Parse existing condition to groups/rules format
const parseCondition = (condition: Record<string, any> | undefined): ConditionGroup[] => {
  if (!condition || Object.keys(condition).length === 0) {
    return [{
      id: generateId(),
      logic: 'AND',
      rules: [{
        id: generateId(),
        field: '',
        operator: 'equals',
        value: '',
      }],
    }];
  }

  // Try to parse the condition object
  if (condition.groups) {
    return condition.groups;
  }

  // Simple condition format
  if (condition.field && condition.operator) {
    return [{
      id: generateId(),
      logic: 'AND',
      rules: [{
        id: generateId(),
        field: condition.field,
        operator: condition.operator,
        value: condition.value || '',
      }],
    }];
  }

  return [{
    id: generateId(),
    logic: 'AND',
    rules: [{
      id: generateId(),
      field: '',
      operator: 'equals',
      value: '',
    }],
  }];
};

// Build condition object from groups/rules
const buildCondition = (groups: ConditionGroup[]): Record<string, any> => {
  const validGroups = groups.map(group => ({
    ...group,
    rules: group.rules.filter(rule => rule.field && rule.operator),
  })).filter(group => group.rules.length > 0);

  if (validGroups.length === 0) {
    return {};
  }

  if (validGroups.length === 1 && validGroups[0].rules.length === 1) {
    const rule = validGroups[0].rules[0];
    return {
      field: rule.field,
      operator: rule.operator,
      value: rule.value,
    };
  }

  return {
    logic: 'AND',
    groups: validGroups,
  };
};

const ConditionBuilder: React.FC<ConditionBuilderProps> = ({
  visible,
  condition,
  onSave,
  onCancel,
}) => {
  const [groups, setGroups] = useState<ConditionGroup[]>([]);
  const [conditionName, setConditionName] = useState('');

  useEffect(() => {
    if (visible) {
      setGroups(parseCondition(condition));
      setConditionName(condition?.name || '');
    }
  }, [visible, condition]);

  const addGroup = () => {
    setGroups([
      ...groups,
      {
        id: generateId(),
        logic: 'AND',
        rules: [{
          id: generateId(),
          field: '',
          operator: 'equals',
          value: '',
        }],
      },
    ]);
  };

  const removeGroup = (groupId: string) => {
    if (groups.length > 1) {
      setGroups(groups.filter(g => g.id !== groupId));
    }
  };

  const updateGroupLogic = (groupId: string, logic: 'AND' | 'OR') => {
    setGroups(groups.map(g =>
      g.id === groupId ? { ...g, logic } : g
    ));
  };

  const addRule = (groupId: string) => {
    setGroups(groups.map(g =>
      g.id === groupId
        ? {
            ...g,
            rules: [
              ...g.rules,
              {
                id: generateId(),
                field: '',
                operator: 'equals',
                value: '',
              },
            ],
          }
        : g
    ));
  };

  const removeRule = (groupId: string, ruleId: string) => {
    setGroups(groups.map(g => {
      if (g.id !== groupId) return g;
      if (g.rules.length <= 1) return g;
      return {
        ...g,
        rules: g.rules.filter(r => r.id !== ruleId),
      };
    }));
  };

  const updateRule = (groupId: string, ruleId: string, field: keyof ConditionRule, value: string) => {
    setGroups(groups.map(g =>
      g.id === groupId
        ? {
            ...g,
            rules: g.rules.map(r =>
              r.id === ruleId ? { ...r, [field]: value } : r
            ),
          }
        : g
    ));
  };

  const handleSave = () => {
    const conditionObj = buildCondition(groups);
    if (conditionName) {
      conditionObj.name = conditionName;
    }
    onSave(conditionObj);
  };

  const getPreviewExpression = (): string => {
    const parts = groups.map((group, gi) => {
      const ruleParts = group.rules.map(rule => {
        if (!rule.field) return null;
        const opInfo = operators.find(o => o.value === rule.operator);
        return `${rule.field} ${opInfo?.label || rule.operator} "${rule.value}"`;
      }).filter(Boolean);

      if (ruleParts.length === 0) return null;
      return `(${ruleParts.join(` ${group.logic} `)})`;
    }).filter(Boolean);

    return parts.join(' AND ') || 'No conditions defined';
  };

  return (
    <Modal
      title="Condition Builder"
      open={visible}
      onOk={handleSave}
      onCancel={onCancel}
      width={800}
      okText="Save Condition"
    >
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <Form.Item label="Condition Name (optional)">
          <Input
            placeholder="e.g., High Severity Alert Check"
            value={conditionName}
            onChange={e => setConditionName(e.target.value)}
          />
        </Form.Item>

        <Divider orientation="left">Condition Rules</Divider>

        {groups.map((group, groupIndex) => (
          <Card
            key={group.id}
            size="small"
            title={
              <Space>
                <Text strong>Rule Group {groupIndex + 1}</Text>
                <Select
                  size="small"
                  value={group.logic}
                  onChange={value => updateGroupLogic(group.id, value)}
                  style={{ width: 80 }}
                >
                  {logicalOperators.map(op => (
                    <Option key={op.value} value={op.value}>
                      {op.label}
                    </Option>
                  ))}
                </Select>
              </Space>
            }
            extra={
              groups.length > 1 && (
                <Button
                  type="text"
                  danger
                  size="small"
                  icon={<DeleteOutlined />}
                  onClick={() => removeGroup(group.id)}
                />
              )
            }
            style={{ background: '#fafafa' }}
          >
            <Space direction="vertical" style={{ width: '100%' }}>
              {group.rules.map((rule, ruleIndex) => (
                <Row key={rule.id} gutter={8} align="middle">
                  <Col span={8}>
                    <Select
                      placeholder="Select field"
                      value={rule.field || undefined}
                      onChange={value => updateRule(group.id, rule.id, 'field', value)}
                      style={{ width: '100%' }}
                      showSearch
                      allowClear
                    >
                      {Object.entries(
                        contextVariables.reduce((acc, v) => {
                          if (!acc[v.category]) acc[v.category] = [];
                          acc[v.category].push(v);
                          return acc;
                        }, {} as Record<string, typeof contextVariables>)
                      ).map(([category, vars]) => (
                        <Select.OptGroup key={category} label={category.toUpperCase()}>
                          {vars.map(v => (
                            <Option key={v.value} value={v.value}>
                              {v.label}
                            </Option>
                          ))}
                        </Select.OptGroup>
                      ))}
                    </Select>
                  </Col>
                  <Col span={6}>
                    <Select
                      placeholder="Operator"
                      value={rule.operator}
                      onChange={value => updateRule(group.id, rule.id, 'operator', value)}
                      style={{ width: '100%' }}
                    >
                      {operators.map(op => (
                        <Option key={op.value} value={op.value}>
                          <Tooltip title={op.description}>
                            {op.label}
                          </Tooltip>
                        </Option>
                      ))}
                    </Select>
                  </Col>
                  <Col span={8}>
                    {!['is_empty', 'is_not_empty'].includes(rule.operator) && (
                      valueOptionsByField[rule.field] ? (
                        <Select
                          placeholder="Select value"
                          value={rule.value || undefined}
                          onChange={value => updateRule(group.id, rule.id, 'value', value)}
                          style={{ width: '100%' }}
                          allowClear
                        >
                          {valueOptionsByField[rule.field].map(option => (
                            <Option key={option.value} value={option.value}>
                              {option.label}
                            </Option>
                          ))}
                        </Select>
                      ) : (
                        <Input
                          placeholder="Value"
                          value={rule.value}
                          onChange={e => updateRule(group.id, rule.id, 'value', e.target.value)}
                        />
                      )
                    )}
                  </Col>
                  <Col span={2}>
                    {group.rules.length > 1 && (
                      <Button
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => removeRule(group.id, rule.id)}
                      />
                    )}
                  </Col>
                </Row>
              ))}
              <Button
                type="dashed"
                size="small"
                icon={<PlusOutlined />}
                onClick={() => addRule(group.id)}
              >
                Add Rule
              </Button>
            </Space>
          </Card>
        ))}

        <Button type="dashed" icon={<PlusOutlined />} onClick={addGroup}>
          Add Rule Group (OR)
        </Button>

        <Divider orientation="left">
          Preview{' '}
          <Tooltip title="This is how the condition will be evaluated">
            <QuestionCircleOutlined />
          </Tooltip>
        </Divider>

        <Card size="small" style={{ background: '#f5f5f5' }}>
          <Text code style={{ fontSize: 12 }}>
            {getPreviewExpression()}
          </Text>
        </Card>
      </Space>
    </Modal>
  );
};

export default ConditionBuilder;

