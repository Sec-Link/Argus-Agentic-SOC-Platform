import React, { useEffect, useState } from 'react';
import { Input, Modal, Popover, Typography, message } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';
import { syncAttackCatalog } from 'services/dashboards';

const DEFAULT_URL =
  'https://raw.githubusercontent.com/mitre-attack/attack-stix-data/master/enterprise-attack/enterprise-attack.json';
const URL_STORAGE_KEY = 'siem_attack_catalog_url';

const readStoredUrl = () => {
  try {
    return localStorage.getItem(URL_STORAGE_KEY) || '';
  } catch {
    return '';
  }
};

const TemplateHelp: React.FC = () => (
  <div style={{ maxWidth: 420, fontSize: 12, lineHeight: 1.6 }}>
    <div>The link must return a <b>STIX 2.1 bundle (JSON)</b> of the MITRE ATT&CK Enterprise matrix, containing:</div>
    <ul style={{ margin: '6px 0', paddingLeft: 18 }}>
      <li>
        <code>x-mitre-tactic</code> objects with <code>x_mitre_shortname</code> and an <code>external_references</code>{' '}
        entry (<code>source_name: &quot;mitre-attack&quot;</code>) holding the <code>TA####</code> id
      </li>
      <li>
        <code>attack-pattern</code> objects with a <code>T####</code> / <code>T####.###</code> id in{' '}
        <code>external_references</code> and <code>kill_chain_phases</code> whose{' '}
        <code>kill_chain_name</code> is <code>mitre-attack</code>
      </li>
    </ul>
    <div>Examples:</div>
    <ul style={{ margin: '6px 0', paddingLeft: 18 }}>
      <li>Latest (default): <code style={{ wordBreak: 'break-all' }}>{DEFAULT_URL}</code></li>
      <li>
        Pinned version:{' '}
        <code style={{ wordBreak: 'break-all' }}>
          https://raw.githubusercontent.com/mitre-attack/attack-stix-data/master/enterprise-attack/enterprise-attack-&lt;version&gt;.json
        </code>
      </li>
      <li>An internal mirror of the same file (must be https and publicly resolvable; private addresses are rejected).</li>
    </ul>
    <div>Syncing replaces the whole ATT&CK catalog and rebuilds every rule&apos;s ATT&CK mapping. Do not mix Mobile / ICS bundles.</div>
  </div>
);

interface Props {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}

const AttackCatalogSyncModal: React.FC<Props> = ({ open, onClose, onDone }) => {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) setUrl(readStoredUrl());
  }, [open]);

  const handleOk = async () => {
    setLoading(true);
    try {
      const custom = url.trim();
      const res = await syncAttackCatalog(custom || undefined);
      try {
        if (custom) localStorage.setItem(URL_STORAGE_KEY, custom);
        else localStorage.removeItem(URL_STORAGE_KEY);
      } catch {}
      message.success(
        `Synced ATT&CK ${res.version}: ${res.techniques} techniques, ${res.rules_rebuilt} rules re-mapped`,
      );
      onDone();
      onClose();
    } catch (err: any) {
      message.error(err?.response?.data?.detail || 'Failed to sync ATT&CK catalog');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title="Sync MITRE ATT&CK catalog"
      open={open}
      onCancel={onClose}
      onOk={handleOk}
      okText="Sync"
      confirmLoading={loading}
      destroyOnClose
    >
      <Typography.Paragraph type="secondary">
        Leave empty to use the official latest ATT&CK Enterprise data from MITRE, or provide your own link.
      </Typography.Paragraph>
      <Input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder={DEFAULT_URL}
        allowClear
        suffix={
          <Popover title="Data source link template" content={<TemplateHelp />} trigger="click" placement="bottomRight">
            <QuestionCircleOutlined style={{ cursor: 'pointer' }} />
          </Popover>
        }
      />
    </Modal>
  );
};

export default AttackCatalogSyncModal;
