'use client';

// Module Management (Administration).
//
// Shows which Argus modules the backend has loaded and lets a superuser choose
// which optional modules should be loaded after the next backend restart.
// The backend (accounts/module_views.py) validates and authorizes every
// change; this page only keeps the draft selection consistent before saving.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, App, Button, Card, Space, Switch, Table, Tag, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { getModuleManagement, updateModuleManagement } from 'services/accounts';
import { toggleModule, type ModuleInfo } from './moduleState';

type ModuleManagementState = {
  modules: ModuleInfo[];
  restart_required: boolean;
  state_loaded_at_startup: boolean;
  can_manage: boolean;
};

// DRF returns field errors as a list; show them as readable text.
function errorText(error: any, fallback: string): string {
  const data = error?.response?.data;
  const detail = data?.disabled_modules ?? data?.detail;
  if (Array.isArray(detail)) return detail.map(String).join(' ');
  return typeof detail === 'string' && detail ? detail : fallback;
}

const ModuleManagement: React.FC = () => {
  // Use the context-bound APIs: the static Modal/message functions do not render under the React 19 runtime Next uses.
  const { message, modal } = App.useApp();
  const [state, setState] = useState<ModuleManagementState | null>(null);
  // Draft list of module keys the user wants disabled; saved explicitly.
  const [draft, setDraft] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const applyServerState = (next: ModuleManagementState) => {
    setState(next);
    setDraft(next.modules.filter((m) => !m.desired_enabled).map((m) => m.key));
  };

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      applyServerState(await getModuleManagement());
    } catch (error: any) {
      setLoadError(
        error?.response?.status === 403
          ? 'You do not have permission to view module management.'
          : errorText(error, 'Failed to load modules.'),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const modules = state?.modules || [];
  const labelOf = useCallback(
    (key: string) => modules.find((m) => m.key === key)?.label || key,
    [modules],
  );

  const saved = useMemo(() => modules.filter((m) => !m.desired_enabled).map((m) => m.key), [modules]);
  const toDisable = draft.filter((key) => !saved.includes(key));
  const toEnable = saved.filter((key) => !draft.includes(key));
  const dirty = toDisable.length > 0 || toEnable.length > 0;

  const onToggle = (key: string, enable: boolean) => {
    const result = toggleModule(modules, draft, key, enable);
    setDraft(result.disabled);
    if (result.alsoChanged.length > 0) {
      const names = result.alsoChanged.map(labelOf).join(', ');
      message.info(
        enable
          ? `Also enabled (required by ${labelOf(key)}): ${names}`
          : `Also disabled (requires ${labelOf(key)}): ${names}`,
      );
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      applyServerState(await updateModuleManagement({ disabled_modules: draft }));
      message.success('Module selection saved. Restart the backend to apply it.');
    } catch (error: any) {
      message.error(errorText(error, 'Failed to save module selection.'));
    } finally {
      setSaving(false);
    }
  };

  // Disabling modules removes features for every user, so confirm first.
  const confirmSave = () => {
    modal.confirm({
      title: 'Save module selection?',
      width: 520,
      content: (
        <Space direction="vertical" size={8}>
          {toDisable.length > 0 && (
            <div>
              <Typography.Text strong>Disable: </Typography.Text>
              {toDisable.map(labelOf).join(', ')}
            </div>
          )}
          {toEnable.length > 0 && (
            <div>
              <Typography.Text strong>Enable: </Typography.Text>
              {toEnable.map(labelOf).join(', ')}
            </div>
          )}
          <Typography.Text type="secondary">
            Nothing changes until the backend is restarted. After the restart, disabled modules are not loaded:
            their pages, APIs, and background jobs stop. Their data is kept and is available again when the
            module is re-enabled.
          </Typography.Text>
        </Space>
      ),
      okText: 'Save',
      onOk: save,
    });
  };

  const statusTag = (m: ModuleInfo) => {
    if (m.pending_restart) {
      return (
        <Tooltip title="Applies after the backend restarts.">
          <Tag color="orange">{m.effective_enabled ? 'Enabled after restart' : 'Disabled after restart'}</Tag>
        </Tooltip>
      );
    }
    if (m.active) return <Tag color="green">Active</Tag>;
    if (m.disabled_reason === 'environment') {
      return (
        <Tooltip title="Disabled by the ARGUS_DISABLED_MODULES deployment setting.">
          <Tag>Disabled by deployment</Tag>
        </Tooltip>
      );
    }
    if (m.disabled_reason === 'dependency') {
      return (
        <Tooltip title="A module it requires is disabled.">
          <Tag>Disabled (dependency)</Tag>
        </Tooltip>
      );
    }
    return <Tag>Disabled</Tag>;
  };

  const columns: ColumnsType<ModuleInfo> = [
    {
      title: 'Module',
      key: 'module',
      render: (_, m) => (
        <Space direction="vertical" size={0}>
          <Space size={8}>
            <Typography.Text strong>{m.label}</Typography.Text>
            {m.core && <Tag color="blue">Core</Tag>}
          </Space>
          <Typography.Text type="secondary">{m.description}</Typography.Text>
        </Space>
      ),
    },
    {
      title: 'Requires',
      key: 'requires',
      width: 220,
      render: (_, m) => (m.requires.length > 0 ? m.requires.map(labelOf).join(', ') : '—'),
    },
    { title: 'Status', key: 'status', width: 200, render: (_, m) => statusTag(m) },
    {
      title: 'Enabled',
      key: 'enabled',
      width: 110,
      render: (_, m) => {
        const reason = m.core
          ? 'Core modules are always enabled.'
          : m.env_disabled
            ? 'Disabled by the ARGUS_DISABLED_MODULES deployment setting.'
            : !state?.can_manage
              ? 'Only superusers can change modules.'
              : '';
        return (
          <Tooltip title={reason}>
            <Switch
              checked={m.core || !draft.includes(m.key)}
              disabled={Boolean(reason) || saving}
              onChange={(checked) => onToggle(m.key, checked)}
              aria-label={`${m.label} enabled`}
            />
          </Tooltip>
        );
      },
    },
  ];

  if (loadError) {
    return (
      <Card title="Module Management">
        <Alert type="error" showIcon message={loadError} action={<Button onClick={load}>Retry</Button>} />
      </Card>
    );
  }

  return (
    <Card
      title="Module Management"
      loading={loading}
      extra={
        state?.can_manage ? (
          <Space>
            <Button disabled={!dirty || saving} onClick={() => setDraft(saved)}>
              Reset
            </Button>
            <Button type="primary" disabled={!dirty} loading={saving} onClick={confirmSave}>
              Save
            </Button>
          </Space>
        ) : null
      }
    >
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Typography.Text type="secondary">
          Optional modules that you do not need can be turned off so the backend does not load them. Changes
          apply when the backend restarts. Module data is never deleted.
        </Typography.Text>
        {state?.restart_required && (
          <Alert
            type="warning"
            showIcon
            message="Restart required"
            description="The saved selection differs from the modules that are currently running. Restart the backend to apply it."
          />
        )}
        {state && !state.state_loaded_at_startup && (
          <Alert
            type="info"
            showIcon
            message="The backend started without reading the saved module selection."
            description="The database was unavailable at startup or loading it was turned off, so only the deployment setting is applied."
          />
        )}
        <Table<ModuleInfo>
          rowKey="key"
          size="middle"
          pagination={false}
          columns={columns}
          dataSource={modules}
          locale={{ emptyText: 'No modules found.' }}
        />
      </Space>
    </Card>
  );
};

export default ModuleManagement;
