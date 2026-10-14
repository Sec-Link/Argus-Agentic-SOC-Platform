import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Divider,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Switch,
  Typography,
  message,
} from 'antd';
import {
  createIntegration,
  deleteIntegration,
  fetchSplunkIntegrationData,
  listIntegrations,
  testIntegrationConnection,
  updateIntegration,
} from 'services/integrations';
import { getIsReadonly } from 'lib/auth';

const { Title, Text } = Typography;

type AuthType = 'none' | 'basic' | 'api_key';
type ProtocolType = 'https' | 'http';
type ConnectorKind = 'elasticsearch' | 'kibana' | 'splunk_search' | 'splunk_rule_publisher';
type SplunkRuleTarget = 'enterprise' | 'enterprise_security';

type BaseFormData = {
  name: string;
  protocol: ProtocolType;
  host: string;
  port: number;
  verifyCerts: boolean;
  authType: AuthType;
  username: string;
  password: string;
  apiKey: string;
  index: string;
  path: string;
};

type SplunkRulePublisherFields = {
  splunkRuleTarget: SplunkRuleTarget;
  splunkApp: string;
  splunkOwner: string;
};

type ElasticFormData = BaseFormData & Partial<SplunkRulePublisherFields>;

const parseBool = (value: any, fallback: boolean) => {
  if (typeof value === 'boolean') return value;
  if (value == null || value === '') return fallback;
  return !['0', 'false', 'no', 'off'].includes(String(value).trim().toLowerCase());
};

const CONNECTOR_DEFAULTS: Record<ConnectorKind, ElasticFormData> = {
  elasticsearch: {
    name: 'Elastic Stack (ELK)',
    protocol: 'https',
    host: '',
    port: 9200,
    verifyCerts: true,
    authType: 'none',
    username: '',
    password: '',
    apiKey: '',
    index: 'alerts',
    path: '/_cluster/health',
  },
  kibana: {
    name: 'Kibana',
    protocol: 'https',
    host: '',
    port: 5601,
    verifyCerts: true,
    authType: 'none',
    username: '',
    password: '',
    apiKey: '',
    index: '',
    path: '/api/status',
  },
  splunk_search: {
    name: 'Splunk Data Source',
    protocol: 'https',
    host: '',
    port: 8089,
    verifyCerts: false,
    authType: 'basic',
    username: '',
    password: '',
    apiKey: '',
    index: 'main',
    path: '/services/server/info?output_mode=json',
  },
  splunk_rule_publisher: {
    name: 'Splunk Rule Publisher',
    protocol: 'https',
    host: '',
    port: 8089,
    verifyCerts: false,
    splunkRuleTarget: 'enterprise',
    splunkApp: 'search',
    splunkOwner: 'nobody',
    authType: 'basic',
    username: '',
    password: '',
    apiKey: '',
    index: '',
    path: '/services/server/info?output_mode=json',
  },
};

const HOST_PATTERN = /^(localhost|(([a-zA-Z0-9-]+\.)*[a-zA-Z0-9-]+)|(\d{1,3}(\.\d{1,3}){3}))$/;

const Integrations: React.FC = () => {
  const [items, setItems] = useState<any[]>([]);
  const [isReadonly, setIsReadonly] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [connectorKind, setConnectorKind] = useState<ConnectorKind>('elasticsearch');
  const [editingItem, setEditingItem] = useState<any | null>(null);
  const [formData, setFormData] = useState<ElasticFormData>(CONNECTOR_DEFAULTS.elasticsearch);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fetchingData, setFetchingData] = useState(false);
  const [hostTouched, setHostTouched] = useState(false);
  // Dynamic index fetching lifecycle states:
  // - indicesLoading: async in-flight state for "Fetch Indices"
  // - indicesList: fetched index options to populate combobox
  const [indicesLoading, setIndicesLoading] = useState(false);
  const [indicesList, setIndicesList] = useState<string[]>([]);
  const [testResult, setTestResult] = useState({
    open: false,
    ok: true,
    title: '',
    detail: '',
  });

  useEffect(() => {
    setIsReadonly(getIsReadonly());
    fetchList();
  }, []);

  const elkItems = useMemo(
    () => (Array.isArray(items) ? items.filter((item: any) => item?.type === 'elasticsearch') : []),
    [items]
  );
  const kibanaItems = useMemo(
    () => (Array.isArray(items) ? items.filter((item: any) => item?.type === 'kibana') : []),
    [items]
  );
  const splunkSearchItems = useMemo(
    () => (Array.isArray(items) ? items.filter((item: any) => item?.type === 'splunk_search' || item?.type === 'splunk') : []),
    [items]
  );
  const splunkRulePublisherItems = useMemo(
    () => (Array.isArray(items) ? items.filter((item: any) => item?.type === 'splunk_rule_publisher') : []),
    [items]
  );

  const getErrorText = (e: any) => {
    const detail = e?.response?.data?.detail;
    const error = e?.response?.data?.error;
    const body = e?.response?.data?.body;
    const msg = e?.message;
    if (typeof detail === 'string' && detail) return detail;
    if (typeof error === 'string' && error) return error;
    if (typeof body === 'string' && body) return body;
    if (body && typeof body === 'object') return JSON.stringify(body, null, 2);
    if (typeof msg === 'string' && msg) return msg;
    return String(e);
  };

  const fetchList = async () => {
    try {
      const r = await listIntegrations();
      setItems(Array.isArray(r) ? r : []);
    } catch {
      setItems([]);
    }
  };

  // Parse persisted integration config into UI-friendly fields.
  const normalizeFromItem = (item: any, kind: ConnectorKind): ElasticFormData => {
    const defaults = CONNECTOR_DEFAULTS[kind];
    const cfg = item?.config || {};
    const hostRaw = String(cfg.host || item?.host || '').trim();
    let protocol: ProtocolType = defaults.protocol;
    let host = '';
    let port = defaults.port;
    try {
      const parsed = new URL(hostRaw);
      protocol = parsed.protocol === 'http:' ? 'http' : 'https';
      host = parsed.hostname;
      port = parsed.port ? Number(parsed.port) : defaults.port;
    } catch {
      host = hostRaw.replace(/^https?:\/\//, '').split(':')[0] || '';
      const maybePort = Number(hostRaw.split(':').pop());
      port = Number.isFinite(maybePort) && maybePort > 0 ? maybePort : defaults.port;
    }

    const authType: AuthType = cfg.auth_type === 'basic' || cfg.auth_type === 'api_key' ? cfg.auth_type : 'none';
    const splunkRuleTarget: SplunkRuleTarget =
      cfg.rule_target === 'enterprise_security' || cfg.splunk_rule_target === 'enterprise_security'
        ? 'enterprise_security'
        : 'enterprise';

    return {
      name: item?.name || defaults.name,
      protocol,
      host,
      port: port >= 1 && port <= 65535 ? port : defaults.port,
      verifyCerts: parseBool(cfg.verify_certs, defaults.verifyCerts),
      splunkRuleTarget,
      splunkApp: String(cfg.splunk_app || defaults.splunkApp || 'search'),
      splunkOwner: String(cfg.splunk_owner || defaults.splunkOwner || 'nobody'),
      authType,
      username: String(cfg.username || ''),
      password: String(cfg.password || ''),
      apiKey: String(cfg.api_key || cfg.token || ''),
      index: String(cfg.index || defaults.index),
      path: String(cfg.path || defaults.path),
    };
  };

  const resetModalState = () => {
    setEditingItem(null);
    setConnectorKind('elasticsearch');
    setFormData(CONNECTOR_DEFAULTS.elasticsearch);
    setHostTouched(false);
    setTesting(false);
    setSaving(false);
    setFetchingData(false);
  };

  // Clicking a connector card opens modal with existing values if available.
  const openFromCard = (kind: ConnectorKind, item?: any) => {
    const defaults = CONNECTOR_DEFAULTS[kind];
    setConnectorKind(kind);
    setHostTouched(false);
    if (item) {
      setEditingItem(item);
      const normalized = normalizeFromItem(item, kind);
      setFormData(normalized);
      setIndicesList(normalized.index ? [normalized.index] : []);
    } else {
      setEditingItem(null);
      setFormData(defaults);
      setIndicesList(defaults.index ? [defaults.index] : []);
    }
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    resetModalState();
  };

  const setField = <K extends keyof ElasticFormData>(key: K, value: ElasticFormData[K]) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const buildHostUrl = () => `${formData.protocol}://${formData.host.trim()}:${formData.port}`;
  const hostValid = HOST_PATTERN.test(formData.host.trim());
  const portValid = Number.isFinite(formData.port) && formData.port >= 1 && formData.port <= 65535;
  const isSplunkConnector = connectorKind === 'splunk_search' || connectorKind === 'splunk_rule_publisher';
  const isSplunkSearch = connectorKind === 'splunk_search';
  const isSplunkRulePublisher = connectorKind === 'splunk_rule_publisher';

  const validateForm = (forTesting = false) => {
    const host = formData.host.trim();
    if (!host) {
      message.warning('Host is required.');
      return false;
    }
    if (!HOST_PATTERN.test(host)) {
      message.warning('Host format is invalid.');
      return false;
    }
    if (!portValid) {
      message.warning('Port must be between 1 and 65535.');
      return false;
    }
    if (!forTesting) {
      if ((connectorKind === 'elasticsearch' || isSplunkSearch) && !formData.index.trim()) {
        message.warning('Target index is required.');
        return false;
      }
      if (isSplunkRulePublisher && !(formData.splunkApp || '').trim()) {
        message.warning('Splunk app is required.');
        return false;
      }
      if (isSplunkRulePublisher && !(formData.splunkOwner || '').trim()) {
        message.warning('Splunk owner is required.');
        return false;
      }
      // Conditional auth validation is driven by selected authType.
      if (formData.authType === 'basic') {
        if (!formData.username.trim()) {
          message.warning('Username is required for Basic Authentication.');
          return false;
        }
        if (!formData.password.trim()) {
          message.warning('Password is required for Basic Authentication.');
          return false;
        }
      }
      if (formData.authType === 'api_key' && !formData.apiKey.trim()) {
        message.warning('API Key token is required for API Key authentication.');
        return false;
      }
    }
    return true;
  };

  // Serialize form into backend payload contract.
  const toIntegrationPayload = () => {
    const defaults = CONNECTOR_DEFAULTS[connectorKind];
    const host = buildHostUrl();
    const cfg: any = {
      host,
      path: formData.path.trim() || defaults.path,
      protocol: formData.protocol,
      port: formData.port,
      auth_type: formData.authType,
      verify_certs: formData.protocol === 'https' && formData.verifyCerts,
    };
    if (isSplunkSearch) {
      cfg.capability = 'search';
    }
    if (isSplunkRulePublisher) {
      const splunkApp = (formData.splunkApp || defaults.splunkApp || 'search').trim();
      const splunkOwner = (formData.splunkOwner || defaults.splunkOwner || 'nobody').trim();
      cfg.capability = 'rule_publisher';
      cfg.rule_target = formData.splunkRuleTarget || defaults.splunkRuleTarget || 'enterprise';
      cfg.splunk_app = splunkApp || 'search';
      cfg.splunk_owner = splunkOwner || 'nobody';
      cfg.saved_searches_path = `/servicesNS/${encodeURIComponent(cfg.splunk_owner)}/${encodeURIComponent(cfg.splunk_app)}/saved/searches`;
    }
    if (connectorKind === 'elasticsearch' || isSplunkSearch) {
      cfg.index = formData.index.trim() || defaults.index;
    }

    if (formData.authType === 'basic') {
      cfg.username = formData.username.trim();
      cfg.password = formData.password;
      cfg.api_key = '';
      cfg.token = '';
    } else if (formData.authType === 'api_key') {
      cfg.username = '';
      cfg.password = '';
      cfg.api_key = formData.apiKey.trim();
      cfg.token = isSplunkConnector ? formData.apiKey.trim() : '';
    } else {
      cfg.username = '';
      cfg.password = '';
      cfg.api_key = '';
      cfg.token = '';
    }

    return {
      name: formData.name.trim() || defaults.name,
      type: connectorKind,
      config: cfg,
    };
  };

  // Test endpoint call without persisting configuration.
  const handleTestConnection = async () => {
    if (!validateForm(true)) return;
    setTesting(true);
    try {
      const payload = toIntegrationPayload();
      const testPayload: any = {
        integration_type: connectorKind,
        host: payload.config.host,
        path: payload.config.path,
        auth_type: payload.config.auth_type,
        api_key: payload.config.api_key,
        token: payload.config.token,
        connection_mode: payload.config.connection_mode,
        verify_certs: payload.config.verify_certs,
      };
      if (formData.authType === 'basic') {
        testPayload.username = payload.config.username;
        testPayload.password = payload.config.password;
      }
      const res = await testIntegrationConnection(testPayload);
      setTestResult({
        open: true,
        ok: true,
        title: 'Connection OK',
        detail: typeof res === 'string' ? res : JSON.stringify(res, null, 2),
      });
    } catch (e: any) {
      setTestResult({
        open: true,
        ok: false,
        title: 'Connection failed',
        detail: getErrorText(e),
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!validateForm(false)) return;
    setSaving(true);
    try {
      const payload = toIntegrationPayload();
      let savedItem: any;
      if (editingItem?.id) {
        savedItem = await updateIntegration(editingItem.id, payload);
      } else {
        savedItem = await createIntegration(payload);
      }
      message.success('Integration saved.');
      try {
        window.dispatchEvent(new Event('siem_es_connector_switched'));
      } catch {}
      if (isSplunkSearch && savedItem?.id) {
        setEditingItem(savedItem);
        await fetchList();
      } else {
        closeModal();
        fetchList();
      }
    } catch (e: any) {
      message.error(`Save failed: ${getErrorText(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleFetchData = async () => {
    if (!editingItem?.id) {
      message.warning('Save configuration before fetching data.');
      return;
    }
    setFetchingData(true);
    try {
      const res = await fetchSplunkIntegrationData(editingItem.id, { size: 1000 });
      const inserted = Number(res?.inserted || 0);
      const updated = Number(res?.updated || 0);
      const skipped = Number(res?.skipped || 0);
      const errors = Array.isArray(res?.errors) ? res.errors : [];
      setTestResult({
        open: true,
        ok: errors.length === 0,
        title: errors.length === 0 ? 'Fetch data completed' : 'Fetch data completed with warnings',
        detail: JSON.stringify(res, null, 2),
      });
      message.success(`Splunk data fetched. Inserted ${inserted}, updated ${updated}, skipped ${skipped}.`);
    } catch (e: any) {
      setTestResult({
        open: true,
        ok: false,
        title: 'Fetch data failed',
        detail: getErrorText(e),
      });
    } finally {
      setFetchingData(false);
    }
  };

  // Fetch live indices using current protocol/host/port/auth form state.
  // Uses existing backend ES test proxy with _cat endpoint and maps response into dropdown options.
  const handleFetchIndices = async () => {
    if (!validateForm(true)) return;
    setIndicesLoading(true);
    try {
      const payload = toIntegrationPayload();
      const testPayload: any = {
        host: payload.config.host,
        path: '/_cat/indices?format=json&h=index',
      };
      if (formData.authType === 'basic') {
        testPayload.username = payload.config.username;
        testPayload.password = payload.config.password;
      }
      if (formData.authType === 'api_key') {
        testPayload.api_key = payload.config.api_key;
      }

      const res = await testIntegrationConnection(testPayload);
      let parsed: any = res?.body ?? res;
      if (typeof parsed === 'string') {
        try {
          parsed = JSON.parse(parsed);
        } catch {
          parsed = [];
        }
      }
      const extracted = Array.isArray(parsed)
        ? parsed.map((row: any) => String(row?.index || '').trim()).filter(Boolean)
        : [];
      const unique = Array.from(new Set(extracted));
      setIndicesList(unique);
      if (unique.length > 0 && !unique.includes(formData.index)) {
        setField('index', unique[0]);
      }
      if (unique.length === 0) {
        message.info('No indices returned from the current endpoint.');
      }
    } catch (e: any) {
      message.error(`Failed to fetch indices: ${getErrorText(e)}`);
    } finally {
      setIndicesLoading(false);
    }
  };

  const handleDelete = async (item: any) => {
    const name = item?.name || item?.id || 'this integration';
    const ok = window.confirm(`Delete ${name}? This cannot be undone.`);
    if (!ok) return;
    try {
      await deleteIntegration(item.id);
      message.success('Deleted');
      fetchList();
    } catch (e: any) {
      message.error(`Delete failed: ${getErrorText(e)}`);
    }
  };

  type IntegrationCardConfig = {
    key: 'elastic' | 'kibana' | 'splunk_search' | 'splunk_rule_publisher';
    title: string;
    subtitle: string;
    description: string;
    logo: string;
    isInstalled: boolean;
    onConfigure: () => void;
    onUninstall?: () => void;
  };

  const elasticInstalled = Boolean(elkItems[0]?.id && elkItems[0]?.config?.host);
  const kibanaInstalled = Boolean(kibanaItems[0]?.id && kibanaItems[0]?.config?.host);
  const splunkSearchInstalled = Boolean(splunkSearchItems[0]?.id && splunkSearchItems[0]?.config?.host);
  const splunkRulePublisherInstalled = Boolean(splunkRulePublisherItems[0]?.id && splunkRulePublisherItems[0]?.config?.host);
  const connectorTitle =
    connectorKind === 'kibana'
      ? 'Kibana'
      : connectorKind === 'splunk_search'
        ? 'Splunk Data Source'
        : connectorKind === 'splunk_rule_publisher'
          ? 'Splunk Rule Publisher'
          : 'Elasticsearch';
  const connectorLogo = isSplunkConnector ? '/splunk-logo.svg' : '/elastic-logo.png';
  const integrationCards: IntegrationCardConfig[] = [
    {
      key: 'elastic',
      title: 'Elastic Stack',
      subtitle: 'ELK Connector',
      description: 'Ingest and analyze security event logs and system metrics via automated cluster pipelines.',
      logo: '/elastic-logo.png',
      isInstalled: elasticInstalled,
      onConfigure: () => openFromCard('elasticsearch', elkItems[0]),
      onUninstall: elkItems[0]?.id ? () => handleDelete(elkItems[0]) : undefined,
    },
    {
      key: 'kibana',
      title: 'Kibana',
      subtitle: 'Kibana Connector',
      description: 'Publish detection rules and actions through Kibana APIs without configuring an ingestion target mapping.',
      logo: '/elastic-logo.png',
      isInstalled: kibanaInstalled,
      onConfigure: () => openFromCard('kibana', kibanaItems[0]),
      onUninstall: kibanaItems[0]?.id ? () => handleDelete(kibanaItems[0]) : undefined,
    },
    {
      key: 'splunk_search',
      title: 'Splunk Data Source',
      subtitle: 'Search API Connector',
      description: 'Pull raw events, notable events, and security search results from Splunk through the Search API.',
      logo: '/splunk-logo.svg',
      isInstalled: splunkSearchInstalled,
      onConfigure: () => openFromCard('splunk_search', splunkSearchItems[0]),
      onUninstall: splunkSearchItems[0]?.id ? () => handleDelete(splunkSearchItems[0]) : undefined,
    },
    {
      key: 'splunk_rule_publisher',
      title: 'Splunk Rule Publisher',
      subtitle: 'Saved Search / ES Correlation',
      description: 'Publish Sigma-converted SPL as Splunk saved searches or Enterprise Security correlation searches.',
      logo: '/splunk-logo.svg',
      isInstalled: splunkRulePublisherInstalled,
      onConfigure: () => openFromCard('splunk_rule_publisher', splunkRulePublisherItems[0]),
      onUninstall: splunkRulePublisherItems[0]?.id ? () => handleDelete(splunkRulePublisherItems[0]) : undefined,
    },
  ];

  const renderIntegrationCard = (card: IntegrationCardConfig) => {
    const badgeStyle: React.CSSProperties = card.isInstalled
      ? {
          background: '#ecfdf3',
          border: '1px solid #86efac',
          color: '#166534',
        }
      : {
          background: '#f8fafc',
          border: '1px solid #cbd5e1',
          color: '#475569',
        };

    return (
      <Card
        key={card.key}
        hoverable
        onClick={card.onConfigure}
        style={{
          width: '100%',
          maxWidth: 440,
          minHeight: 276,
          position: 'relative',
          borderRadius: 8,
          border: '1px solid rgba(100,116,139,0.58)',
          background: 'rgba(15,23,42,0.46)',
          boxShadow: '0 1px 0 rgba(148,163,184,0.12) inset',
          transition: 'border-color 180ms ease, box-shadow 180ms ease, transform 180ms ease',
        }}
        styles={{
          body: {
            height: '100%',
            padding: 24,
            display: 'flex',
            flexDirection: 'column',
          },
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = 'rgba(148,163,184,0.9)';
          e.currentTarget.style.boxShadow = '0 0 0 1px rgba(59,130,246,0.22), 0 18px 38px rgba(2,6,23,0.34)';
          e.currentTarget.style.transform = 'translateY(-2px)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = 'rgba(100,116,139,0.58)';
          e.currentTarget.style.boxShadow = '0 1px 0 rgba(148,163,184,0.12) inset';
          e.currentTarget.style.transform = 'translateY(0)';
        }}
      >
        {/* Pill badge is absolutely positioned so Ant Design card layout cannot stretch it into a distorted circle. */}
        <span
          style={{
            ...badgeStyle,
            position: 'absolute',
            top: 18,
            right: 18,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 24,
            padding: '2px 10px',
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 600,
            lineHeight: 1,
            whiteSpace: 'nowrap',
          }}
        >
          {card.isInstalled ? 'Installed' : 'Available'}
        </span>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, paddingRight: 96 }}>
          <div
            style={{
              width: 78,
              height: 78,
              borderRadius: 8,
              border: '1px solid rgba(148,163,184,0.34)',
              background: 'rgba(2,6,23,0.32)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <img src={card.logo} alt={`${card.title} logo`} style={{ width: 54, height: 54, objectFit: 'contain' }} />
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <Title level={4} style={{ margin: 0, fontSize: 22, lineHeight: 1.2 }}>
            {card.title}
          </Title>
          <Text type="secondary" style={{ display: 'block', marginTop: 4 }}>
            {card.subtitle}
          </Text>
        </div>

        <Text style={{ display: 'block', marginTop: 12, lineHeight: 1.55, color: 'var(--text-secondary)' }}>
          {card.description}
        </Text>

        <div style={{ flex: 1 }} />

        {/* Conditional lifecycle actions: installed cards can be configured and uninstalled; available cards only start setup. */}
        <Space style={{ marginTop: 18 }}>
          <Button type="primary" onClick={(e) => { e.stopPropagation(); card.onConfigure(); }}>
            {card.isInstalled ? 'Configure' : 'Setup Integration'}
          </Button>
          {card.isInstalled && card.onUninstall && !isReadonly ? (
            <Button danger onClick={(e) => { e.stopPropagation(); card.onUninstall?.(); }}>
              Delete
            </Button>
          ) : null}
        </Space>
      </Card>
    );
  };

  return (
    <div style={{ padding: 12 }}>
      <Card title="Integrations">
        {isReadonly && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="Read-only view"
            description="Guest accounts can view configured integrations but cannot edit credentials."
          />
        )}

        <Text type="secondary">
          Manage and configure your SIEM data ingestion pipelines and connectors.
        </Text>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 440px))',
            gap: 20,
            marginTop: 10,
            alignItems: 'stretch',
            justifyContent: 'start',
          }}
        >
          {integrationCards.map(renderIntegrationCard)}
        </div>
      </Card>

      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src={connectorLogo} alt={`${connectorTitle} logo`} style={{ width: 22, height: 22, objectFit: 'contain' }} />
            <span>{`Configure ${connectorTitle}`}</span>
          </div>
        }
        open={modalOpen && !isReadonly}
        onCancel={closeModal}
        footer={[
          <Button key="cancel" onClick={closeModal} disabled={testing || saving || fetchingData}>
            Cancel
          </Button>,
          <Button key="test" onClick={handleTestConnection} loading={testing} disabled={saving || fetchingData}>
            Test Connection
          </Button>,
          isSplunkSearch ? (
            <Button
              key="fetch-data"
              onClick={handleFetchData}
              loading={fetchingData}
              disabled={testing || saving || !editingItem?.id}
            >
              Fetch Data
            </Button>
          ) : null,
          <Button key="save" type="primary" onClick={handleSave} loading={saving} disabled={testing || fetchingData}>
            Save Configuration
          </Button>,
        ]}
        width={820}
        styles={{
          body: {
            paddingTop: 10,
          },
        }}
      >
        {/* Controlled form state (formData) keeps all values parameterized and reactive. */}
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div style={{ maxWidth: 420 }}>
            <Text strong>Integration Name</Text>
            <Input
              value={formData.name}
              onChange={(e) => setField('name', e.target.value)}
              placeholder="e.g., production-logs"
              disabled={testing || saving}
              style={{ marginTop: 6, borderRadius: 10 }}
            />
          </div>

          {isSplunkRulePublisher && (
            <Row gutter={12}>
              <Col xs={24} md={12}>
                <Text strong>Splunk Target</Text>
                <Select
                  value={formData.splunkRuleTarget || 'enterprise'}
                  onChange={(target) => {
                    const nextTarget = target as SplunkRuleTarget;
                    setFormData((prev) => ({
                      ...prev,
                      splunkRuleTarget: nextTarget,
                      splunkApp: nextTarget === 'enterprise_security' ? 'SplunkEnterpriseSecuritySuite' : 'search',
                    }));
                  }}
                  options={[
                    { label: 'Splunk Enterprise', value: 'enterprise' },
                    { label: 'Splunk Enterprise Security', value: 'enterprise_security' },
                  ]}
                  disabled={testing || saving}
                  style={{ width: '100%', marginTop: 6 }}
                />
              </Col>
              <Col xs={24} md={6}>
                <Text strong>App</Text>
                <Input
                  value={formData.splunkApp || ''}
                  onChange={(e) => setField('splunkApp', e.target.value)}
                  disabled={testing || saving}
                  style={{ marginTop: 6, borderRadius: 10 }}
                />
              </Col>
              <Col xs={24} md={6}>
                <Text strong>Owner</Text>
                <Input
                  value={formData.splunkOwner || ''}
                  onChange={(e) => setField('splunkOwner', e.target.value)}
                  disabled={testing || saving}
                  style={{ marginTop: 6, borderRadius: 10 }}
                />
              </Col>
            </Row>
          )}

          <Row gutter={12}>
            <Col xs={24} md={8}>
              <Text strong>Connection Protocol</Text>
              <Select
                value={formData.protocol}
                onChange={(v) => {
                  const nextProtocol = v as ProtocolType;
                  setFormData((prev) => ({
                    ...prev,
                    protocol: nextProtocol,
                    verifyCerts: nextProtocol === 'https' ? prev.verifyCerts : false,
                  }));
                }}
                options={[
                  { label: 'HTTPS', value: 'https' },
                  { label: 'HTTP', value: 'http' },
                ]}
                disabled={testing || saving}
                style={{ width: '100%', marginTop: 6 }}
              />
            </Col>
            <Col xs={24} md={10}>
              <Text strong>Host</Text>
              <Input
                value={formData.host}
                onChange={(e) => setField('host', e.target.value)}
                onBlur={() => setHostTouched(true)}
                placeholder="e.g., localhost or 10.0.0.1"
                disabled={testing || saving}
                status={hostTouched && !hostValid ? 'error' : ''}
                style={{ marginTop: 6, borderRadius: 10 }}
              />
              {hostTouched && !hostValid && (
                <Text type="danger" style={{ fontSize: 12 }}>
                  Enter a valid hostname or IPv4 address.
                </Text>
              )}
            </Col>
            <Col xs={24} md={6}>
              <Text strong>Port</Text>
              <InputNumber
                min={1}
                max={65535}
                value={formData.port}
                onChange={(v) => setField('port', Number(v || CONNECTOR_DEFAULTS[connectorKind].port))}
                disabled={testing || saving}
                style={{ width: '100%', marginTop: 6, borderRadius: 10 }}
              />
            </Col>
          </Row>

          {formData.protocol === 'https' && (
            <Row gutter={12}>
              <Col xs={24} md={12}>
                <Space align="center">
                  <Switch
                    checked={formData.verifyCerts}
                    onChange={(checked) => setField('verifyCerts', checked)}
                    disabled={testing || saving}
                  />
                  <Text strong>Verify TLS Certificate</Text>
                </Space>
              </Col>
            </Row>
          )}

          <Divider style={{ margin: '2px 0' }}>Authentication</Divider>

          <Row gutter={12}>
            <Col xs={24} md={12}>
              <Text strong>Authentication Type</Text>
              <Select
                value={formData.authType}
                onChange={(v) => setField('authType', v as AuthType)}
                disabled={testing || saving}
                style={{ width: '100%', marginTop: 6 }}
                options={[
                  { label: 'No Authentication', value: 'none' },
                  { label: 'Basic Authentication', value: 'basic' },
                  { label: isSplunkConnector ? 'Splunk Token' : 'API Key', value: 'api_key' },
                ]}
              />
            </Col>
          </Row>

          {/* Conditional rendering: credentials shown only for selected auth mode. */}
          {formData.authType === 'basic' && (
            <Row gutter={12}>
              <Col xs={24} md={12}>
                <Text strong>Username</Text>
                <Input
                  value={formData.username}
                  onChange={(e) => setField('username', e.target.value)}
                  disabled={testing || saving}
                  style={{ marginTop: 6, borderRadius: 10 }}
                />
              </Col>
              <Col xs={24} md={12}>
                <Text strong>Password</Text>
                <Input.Password
                  value={formData.password}
                  onChange={(e) => setField('password', e.target.value)}
                  disabled={testing || saving}
                  style={{ marginTop: 6, borderRadius: 10 }}
                />
              </Col>
            </Row>
          )}

          {formData.authType === 'api_key' && (
            <div>
              <Text strong>{isSplunkConnector ? 'Splunk Token' : 'API Key Token'}</Text>
              <Input.Password
                value={formData.apiKey}
                onChange={(e) => setField('apiKey', e.target.value)}
                disabled={testing || saving}
                placeholder={isSplunkConnector ? 'Paste Splunk token' : 'Paste API key token'}
                style={{ marginTop: 6, borderRadius: 10 }}
              />
            </div>
          )}

          {(connectorKind === 'elasticsearch' || isSplunkSearch) && (
            <>
              <Divider style={{ margin: '2px 0' }}>
                {isSplunkSearch ? 'Splunk Search Target' : 'Target Mapping'}
              </Divider>

              <div style={{ maxWidth: 560 }}>
                <Text strong>{isSplunkSearch ? 'Default Splunk Index' : 'Target Index / Index Pattern'}</Text>
                {connectorKind === 'elasticsearch' ? (
                  <Space.Compact style={{ width: '100%', marginTop: 6 }}>
                    <Select
                      showSearch
                      allowClear
                      value={formData.index || undefined}
                      placeholder="e.g., alerts-linux-*"
                      disabled={testing || saving}
                      loading={indicesLoading}
                      style={{ width: '100%' }}
                      options={indicesList.map((idx) => ({ label: idx, value: idx }))}
                      onChange={(v) => setField('index', String(v || ''))}
                      onSearch={(v) => setField('index', v)}
                      filterOption={(input, option) =>
                        String(option?.label || '')
                          .toLowerCase()
                          .includes(input.toLowerCase())
                      }
                    />
                    <Button onClick={handleFetchIndices} loading={indicesLoading} disabled={testing || saving}>
                      Fetch Indices
                    </Button>
                  </Space.Compact>
                ) : (
                  <Input
                    value={formData.index}
                    onChange={(e) => setField('index', e.target.value)}
                    placeholder="e.g., main"
                    disabled={testing || saving}
                    style={{ marginTop: 6, borderRadius: 10 }}
                  />
                )}
              </div>
            </>
          )}

          <div>
            <Text type="secondary" style={{ fontSize: 12, opacity: 0.8 }}>
              Preview endpoint
            </Text>
            <div style={{ marginTop: 6, opacity: 0.9 }}>
              <Text code style={{ fontSize: 12, fontWeight: 500 }}>
                {`${buildHostUrl()}${formData.path}`}
              </Text>
            </div>
          </div>
        </Space>
      </Modal>

      <Modal
        title={testResult.title}
        open={testResult.open}
        footer={null}
        onCancel={() => setTestResult((prev) => ({ ...prev, open: false }))}
      >
        <Alert
          type={testResult.ok ? 'success' : 'error'}
          showIcon
          message={testResult.ok ? 'Connection succeeded' : 'Connection failed'}
          style={{ marginBottom: 12 }}
        />
        <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 320, overflow: 'auto', margin: 0 }}>{testResult.detail}</pre>
      </Modal>
    </div>
  );
};

export default Integrations;
