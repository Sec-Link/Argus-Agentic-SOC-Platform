import React from 'react';
import { Modal, Table, Tag, Typography } from 'antd';
import { useRouter } from 'next/navigation';
import type { AttackCoverage } from 'types';
import { detectionLinkForTechnique, openDetectionsWithSearch } from './detectionLinks';

/** Lists the ATT&CK techniques that currently have at least one enabled rule; each links to the matching rules. */
const AttackTechniquesModal: React.FC<{ open: boolean; data: AttackCoverage; onClose: () => void }> = ({ open, data, onClose }) => {
  const router = useRouter();
  const byTechnique = new Map<string, { id: string; name: string; rules: number; tactics: string[] }>();
  data.tactics.forEach((t) =>
    t.techniques
      .filter((x) => x.rule_count > 0)
      .forEach((x) => {
        const cur = byTechnique.get(x.technique_id) || { id: x.technique_id, name: x.name, rules: x.rule_count, tactics: [] };
        cur.tactics.push(t.name);
        byTechnique.set(x.technique_id, cur);
      }),
  );
  const rows = Array.from(byTechnique.values()).sort((a, b) => a.id.localeCompare(b.id));
  return (
    <Modal open={open} centered width={760} title={`Covered techniques (${rows.length} / ${data.total_techniques ?? '?'})`} footer={null} onCancel={onClose}>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        Source: techniques mapped from Sigma attack.* tags and Kibana threat fields of enabled rules, matched against the synced ATT&CK catalog.
        Click a technique to open its rules.
      </Typography.Paragraph>
      <Table
        size="small"
        rowKey="id"
        dataSource={rows}
        pagination={{ pageSize: 10, hideOnSinglePage: true }}
        columns={[
          {
            title: 'Technique',
            dataIndex: 'id',
            width: 110,
            render: (id: string) => (
              <a onClick={() => { onClose(); openDetectionsWithSearch(router.push, detectionLinkForTechnique(id)); }}>{id}</a>
            ),
          },
          { title: 'Name', dataIndex: 'name' },
          { title: 'Tactics', dataIndex: 'tactics', render: (t: string[]) => t.map((n) => <Tag key={n}>{n}</Tag>) },
          { title: 'Rules', dataIndex: 'rules', width: 80 },
        ]}
      />
    </Modal>
  );
};

export default AttackTechniquesModal;
