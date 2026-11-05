import React from 'react';
import { Button, Popover, Tag, Typography } from 'antd';
import { PushpinFilled, QuestionCircleOutlined } from '@ant-design/icons';
import { STATUS_META, type SourceStatus } from './logSourceStatus';

const Sample: React.FC<{ status?: SourceStatus; className?: string; children: React.ReactNode }> = ({
  status = 'silent',
  className = '',
  children,
}) => <Tag className={`ls-chip ls-chip--${status} ${className}`}>{children}</Tag>;

const Row: React.FC<{ sample: React.ReactNode; text: string }> = ({ sample, text }) => (
  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
    <div style={{ width: 120, flex: 'none' }}>{sample}</div>
    <Typography.Text type="secondary" style={{ fontSize: 12 }}>{text}</Typography.Text>
  </div>
);

const content = (
  <div style={{ width: 400 }}>
    <Typography.Text strong>Colour — alerting status</Typography.Text>
    <div style={{ margin: '8px 0 12px' }}>
      {(Object.keys(STATUS_META) as SourceStatus[]).map((k) => (
        <Row key={k} sample={<Sample status={k}>{STATUS_META[k].label}</Sample>} text={STATUS_META[k].description} />
      ))}
    </div>
    <Typography.Text strong>Border / marker — classification</Typography.Text>
    <div style={{ margin: '8px 0 8px' }}>
      <Row sample={<Sample>auto-source-*</Sample>} text="Classified automatically from the source name / ECS fields." />
      <Row
        sample={<Sample><PushpinFilled className="ls-chip__pin" />manual-*</Sample>}
        text="Manually assigned by an administrator."
      />
      <Row sample={<Sample className="ls-chip--unclassified">unclassified-*</Sample>} text="Not assigned to any category yet (dashed)." />
      <Row sample={<Sample className="ls-chip--ignored">ignored-*</Sample>} text="Ignored; excluded from coverage." />
    </div>
    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
      Rule-to-source matching uses each rule's index patterns. Rules without index patterns, or with very generic
      ones (e.g. logs-*), are not credited to a single source, so “Alerting” is a lower bound.
    </Typography.Text>
  </div>
);

const LogSourceLegend: React.FC = () => (
  <Popover content={content} title="Colour legend" trigger={['hover', 'click']} placement="bottomRight">
    <Button size="small" type="text" icon={<QuestionCircleOutlined />} aria-label="Colour legend" />
  </Popover>
);

export default LogSourceLegend;
