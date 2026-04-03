import React, { useState, useEffect, useMemo } from 'react';
import { Layout, Menu, Button, Avatar, Tag, Card, message } from 'antd';
import {
  DashboardOutlined,
  BellOutlined,
  UnorderedListOutlined,
  SettingOutlined,
  AppstoreOutlined,
  TeamOutlined,
  LineChartOutlined,
  LockOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  BranchesOutlined,
  HddOutlined,
} from '@ant-design/icons';
import { clearAccessToken, getRbacMe } from './api';
import Profile from './modules/accounts/Profile';
import LoginForm from './components/LoginForm';
import Dashboard from './components/Dashboard';
import AlertList from './components/AlertList';
import TicketList from './components/TicketList';
import AssetList from './modules/cmdb/AssetList'; // CMDB
import Integrations from './modules/integrations/Integrations';
import ModeContext, { ModeType } from './modeContext';
import DashboardList from './modules/dashboards/DashboardList';
import DashboardEditor from './modules/dashboards/DashboardEditor';
import DataSources from './modules/datasource/DataSources';
import Orchestrator from './modules/orchestrator/Orchestrator';
import Correlation from './modules/correlation/Correlation';
import Permissions from './modules/accounts/Permissions';
import Workflows from './modules/workflows/Workflows';
import WorkflowEditor from './modules/workflows/WorkflowEditor';
import WorkflowExecutions from './modules/workflows/WorkflowExecutions';
import AiAssistantSettings from './modules/aiAssistant/AiAssistantSettings';
import { VisualWorkflowEditor } from './components/workflow';
const { Header, Content, Sider } = Layout;

// small, minimal SVG icon for database/datasource menu item
const DatabaseSvg: React.FC<{style?: React.CSSProperties}> = ({ style }) => (
  <svg viewBox="0 0 24 24" width="16" height="16" style={style} xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor">
    <ellipse cx="12" cy="5" rx="8" ry="3" strokeWidth="1.6" />
    <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" strokeWidth="1.6" />
    <path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" strokeWidth="1.6" />
  </svg>
);

const App: React.FC = () => {
  // initialize from localStorage synchronously to avoid flashing the login UI on refresh
  const initialToken = (() => {
    try {
      const t = localStorage.getItem('siem_access_token');
      // Migration safety: old JWT tokens contain dots and won't work with TokenAuth.
      if (t && t.includes('.')) {
        localStorage.removeItem('siem_access_token');
        return null;
      }
      return t;
    } catch (e) {
      return null;
    }
  })();
  const [loggedIn, setLoggedIn] = useState(!!initialToken);
  const [mode, setMode] = useState<ModeType>('auto');
  const [editingDashboardId, setEditingDashboardId] = useState<string | undefined>(undefined);
  const [editingWorkflowId, setEditingWorkflowId] = useState<string | undefined>(undefined);
  const [workflowView, setWorkflowView] = useState<'list' | 'edit' | 'executions' | 'visual'>('list');
  const [selectedKey, setSelectedKey] = useState<string>('dashboard');
  const [openKeys, setOpenKeys] = useState<string[]>(['dashboardGroup']);
  const [currentPath, setCurrentPath] = useState<string>(() => {
    try {
      return window.location.pathname || '/dashboard';
    } catch {
      return '/dashboard';
    }
  });
  const [routeTicketNumber, setRouteTicketNumber] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(() => {
    try { return localStorage.getItem('siem_username'); } catch (e) { return null; }
  });
  const [rbacMe, setRbacMe] = useState<any | null>(null);
  const [effectivePermissions, setEffectivePermissions] = useState<string[]>([]);
  const [siderWidth, setSiderWidth] = useState<number>(() => {
    try {
      const raw = localStorage.getItem('siem_sider_width');
      const val = raw ? Number(raw) : NaN;
      return Number.isFinite(val) && val >= 200 ? val : 260;
    } catch {
      return 260;
    }
  });
  const [siderCollapsed, setSiderCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('siem_sider_collapsed') === '1';
    } catch {
      return false;
    }
  });
  const [siderWidthCustomized, setSiderWidthCustomized] = useState<boolean>(() => {
    try {
      return localStorage.getItem('siem_sider_width') != null;
    } catch {
      return false;
    }
  });
  const [isResizing, setIsResizing] = useState(false);
  const [impersonation, setImpersonation] = useState<{ userId: number; username: string; permissions: string[] } | null>(() => {
    try {
      const raw = localStorage.getItem('siem_impersonation');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  const handleLogout = () => {
    setLoggedIn(false);
    try {
      localStorage.removeItem('siem_access_token');
      localStorage.removeItem('siem_username');
      localStorage.removeItem('siem_impersonation');
    } catch (err) {}
    clearAccessToken();
    setUsername(null);
    setImpersonation(null);
    // user logged out
  };

  const clearImpersonation = () => {
    try {
      localStorage.removeItem('siem_impersonation');
    } catch {}
    setImpersonation(null);
    window.dispatchEvent(new Event('siem_impersonation_changed'));
  };

  useEffect(() => {
    // effect kept for future changes to auth, but initial state is already set synchronously
    try {
      const t = localStorage.getItem('siem_access_token');
      if (t) setLoggedIn(true);
      const u = localStorage.getItem('siem_username');
      if (u) setUsername(u);
    } catch (err) {
      // ignore
    }
  }, []);

  useEffect(() => {
    const syncImpersonation = () => {
      try {
        const raw = localStorage.getItem('siem_impersonation');
        setImpersonation(raw ? JSON.parse(raw) : null);
      } catch {
        setImpersonation(null);
      }
    };
    syncImpersonation();
    window.addEventListener('storage', syncImpersonation);
    window.addEventListener('siem_impersonation_changed', syncImpersonation as EventListener);
    return () => {
      window.removeEventListener('storage', syncImpersonation);
      window.removeEventListener('siem_impersonation_changed', syncImpersonation as EventListener);
    };
  }, []);

  useEffect(() => {
    const loadMe = async () => {
      if (!loggedIn) return;
      try {
        const res = await getRbacMe();
        setRbacMe(res);
      } catch {
        setRbacMe(null);
      }
    };
    loadMe();
  }, [loggedIn]);

  useEffect(() => {
    if (impersonation && Array.isArray(impersonation.permissions)) {
      setEffectivePermissions(impersonation.permissions);
    } else {
      setEffectivePermissions(Array.isArray(rbacMe?.permissions) ? rbacMe.permissions : []);
    }
  }, [rbacMe, impersonation]);

  // when login state changes, make sure username is refreshed from storage
  useEffect(() => {
    try {
      if (loggedIn) {
        const u = localStorage.getItem('siem_username');
        if (u) setUsername(u);
      }
    } catch (err) {}
  }, [loggedIn]);

  const normalizePath = (path: string) => (path === '/' ? '/dashboard' : path);

  const resolveRoute = (path: string) => {
    const p = normalizePath(path);
    if (p === '/dashboard') return { key: 'dashboard' };
    if (p === '/alerts') return { key: 'alerts' };
    if (p === '/tickets') return { key: 'tickets' };
    if (p === '/cmdb/assets') return { key: 'assets' };
    if (p.startsWith('/tickets/')) {
      const parts = p.split('/').filter(Boolean);
      const ticketNumber = parts.length >= 2 ? decodeURIComponent(parts[1]) : '';
      return { key: 'tickets', ticketNumber };
    }
    if (p === '/settings/integrations') return { key: 'integrations' };
    if (p === '/settings/dashboards') return { key: 'dashboards' };
    if (p === '/settings/datasources') return { key: 'datasources' };
    if (p === '/settings/orchestrator') return { key: 'orchestrator' };
    if (p === '/settings/correlation') return { key: 'correlation' };
    if (p === '/settings/permissions') return { key: 'permissions' };
    if (p === '/settings/workflows') return { key: 'workflows' };
    if (p === '/settings/workflows/executions') return { key: 'workflow-executions' };
    if (p === '/settings/ai-assistant') return { key: 'ai-assistant' };
    if (p === '/profile') return { key: 'profile' };
    if (p === '/settings/ticket-policy') return { key: 'correlation', fallback: true, normalizedPath: '/settings/correlation' };
    return { key: 'dashboard', fallback: true, normalizedPath: '/dashboard' };
  };

  const replacePath = (path: string) => {
    try {
      window.history.replaceState({}, '', path);
    } catch {}
    setCurrentPath(path);
  };

  const navigate = (path: string) => {
    const next = normalizePath(path);
    if (next === currentPath) return;
    try {
      window.history.pushState({}, '', next);
    } catch {}
    setCurrentPath(next);
  };

  useEffect(() => {
    const onPopState = () => {
      try {
        setCurrentPath(window.location.pathname || '/dashboard');
      } catch {
        setCurrentPath('/dashboard');
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    const resolved = resolveRoute(currentPath);
    setSelectedKey(resolved.key);
    setRouteTicketNumber(resolved.ticketNumber || null);
    if (resolved.fallback && resolved.normalizedPath) {
      replacePath(resolved.normalizedPath);
    }
  }, [currentPath]);

  const permissionByKey: Record<string, string | undefined> = {
    alerts: 'es_integration.view_alert',
    tickets: 'tickets.view_eventticket',
    assets: 'cmdb.view_asset',
    integrations: 'integrations.view_integration',
    dashboards: 'dashboards.view_dashboard',
    datasources: 'datasource.view_datasource',
    orchestrator: 'orchestrator.view_task',
    correlation: 'correlation.view_correlationpolicy',
    permissions: 'accounts.view_user',
    workflows: 'workflows.view_workflow',
    'workflow-executions': 'workflows.view_workflowexecution',
    profile: undefined,
    'ai-assistant': undefined,
  };

  const canAccess = (perm?: string) => {
    if (!perm) return true;
    if (!rbacMe && !impersonation) return true;
    if (!impersonation && rbacMe?.is_superuser) return true;
    return effectivePermissions.includes(perm);
  };

  const renderDenied = () => (
    <Card title="Access denied">
      <div>This view does not have permission to access this feature.</div>
    </Card>
  );

  const renderContent = (key: string) => {
    if (!canAccess(permissionByKey[key])) return renderDenied();
    switch (key) {
      case 'dashboard': return <Dashboard />;
      case 'alerts': return <AlertList />;
      case 'tickets': return <TicketList initialTicketNumber={routeTicketNumber || undefined} onNavigate={navigate} />;
      case 'assets': return <AssetList />;
      case 'integrations': return <Integrations />;
      case 'dashboards': return editingDashboardId ? (
        <DashboardEditor dashboardId={editingDashboardId} onBack={() => setEditingDashboardId(undefined)} />
      ) : (
        <DashboardList onEdit={(id?:string) => { setEditingDashboardId(id); navigate('/settings/dashboards'); }} />
      );
      case 'datasources': return <DataSources />;
      case 'orchestrator': return <Orchestrator />;
      case 'correlation': return <Correlation onNavigate={navigate} />;
      case 'permissions': return <Permissions />;
      case 'ai-assistant': return <AiAssistantSettings />;
      case 'workflows':
      case 'workflow-executions':
        if (workflowView === 'visual') {
          return (
            <VisualWorkflowEditor
              workflowId={editingWorkflowId}
              onBack={() => {
                setWorkflowView('list');
                setEditingWorkflowId(undefined);
              }}
              onSaved={() => {
                setWorkflowView('list');
                setEditingWorkflowId(undefined);
              }}
            />
          );
        }
        if (workflowView === 'edit') {
          return (
            <WorkflowEditor
              workflowId={editingWorkflowId}
              onBack={() => {
                setWorkflowView('list');
                setEditingWorkflowId(undefined);
              }}
              onSaved={() => {
                setWorkflowView('list');
                setEditingWorkflowId(undefined);
              }}
            />
          );
        }
        if (workflowView === 'executions' || key === 'workflow-executions') {
          return (
            <WorkflowExecutions
              onBack={() => {
                setWorkflowView('list');
                navigate('/settings/workflows');
              }}
            />
          );
        }
        return (
          <Workflows
            onNavigate={navigate}
            onEditWorkflow={(id?: string) => {
              setEditingWorkflowId(id);
              setWorkflowView('edit');
            }}
            onVisualEditWorkflow={(id?: string) => {
              setEditingWorkflowId(id);
              setWorkflowView('visual');
            }}
          />
        );
      case 'profile': return <Profile />;
      default: return <Dashboard />;
    }
  };

  // keep sensible parent open when a child is selected
  useEffect(() => {
    if (['dashboard', 'alerts'].includes(selectedKey)) setOpenKeys(['dashboardGroup']);
    else if (['assets'].includes(selectedKey)) setOpenKeys(['cmdbGroup']);
    else if (['tickets'].includes(selectedKey)) setOpenKeys(['ticketGroup']);
    else if (['integrations', 'dashboards', 'datasources', 'orchestrator', 'correlation', 'permissions', 'workflows', 'workflow-executions', 'ai-assistant'].includes(selectedKey)) setOpenKeys(['settingsGroup']);
  }, [selectedKey]);

  const settingsItems = [
    { key: 'integrations', label: 'Integrations', icon: <AppstoreOutlined /> },
    { key: 'dashboards', label: 'Dashboard List', icon: <DashboardOutlined /> },
    { key: 'datasources', label: 'Data Sources', icon: <DatabaseSvg style={{ marginRight: 8 }} /> },
    { key: 'orchestrator', label: 'Orchestrator', icon: <SettingOutlined /> },
    { key: 'correlation', label: 'Correlation', icon: <LineChartOutlined /> },
    { key: 'workflows', label: 'Workflows', icon: <BranchesOutlined /> },
    { key: 'permissions', label: 'Access Management', icon: <LockOutlined /> },
    { key: 'ai-assistant', label: 'AI Assistant', icon: <SettingOutlined /> },
  ].filter((item) => canAccess(permissionByKey[item.key]));

  const autoSiderWidth = useMemo(() => {
    const baseLabels = ['Dashboard', 'Alerts', 'Tickets', 'Settings', 'Access Management', 'Correlation', 'Orchestrator', 'Data Sources', 'Dashboard List', 'Integrations'];
    const dynamicLabels = settingsItems.map((i) => i.label);
    const labels = [...baseLabels, ...dynamicLabels];
    const longest = labels.reduce((max, label) => Math.max(max, label.length), 0);
    return Math.min(420, Math.max(240, longest * 8 + 96));
  }, [settingsItems]);

  useEffect(() => {
    if (!siderWidthCustomized) setSiderWidth(autoSiderWidth);
  }, [autoSiderWidth, siderWidthCustomized]);

  useEffect(() => {
    try {
      localStorage.setItem('siem_sider_width', String(siderWidth));
    } catch {}
  }, [siderWidth]);

  useEffect(() => {
    try {
      localStorage.setItem('siem_sider_collapsed', siderCollapsed ? '1' : '0');
    } catch {}
  }, [siderCollapsed]);

  useEffect(() => {
    if (!isResizing) return;
    const onMove = (e: MouseEvent) => {
      const next = Math.min(420, Math.max(200, e.clientX));
      setSiderWidth(next);
    };
    const onUp = () => setIsResizing(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing]);

  if (!loggedIn) return <LoginForm onLogin={() => setLoggedIn(true)} />;

  return (
    <ModeContext.Provider value={{ mode, setMode }}>
    <Layout style={{ minHeight: '100vh', background: '#f5faff' }}>
      <style>{` 
        /* Pale column background with darker text for contrast */
        .siem-menu-pale .ant-menu-item, .siem-menu-pale .ant-menu-submenu-title {
          color: #0f3b66;
        }
        .siem-menu-pale .ant-menu-item .anticon, .siem-menu-pale .ant-menu-submenu-title .anticon {
          color: #0f3b66;
        }
        .siem-menu-pale .ant-menu-title-content {
          white-space: nowrap;
        }
        /* subtle hover/active backgrounds to keep readability */
        .siem-menu-pale .ant-menu-item:hover, .siem-menu-pale .ant-menu-item-active, .siem-menu-pale .ant-menu-item-selected, .siem-menu-pale .ant-menu-submenu-title:hover {
          background: rgba(15,59,102,0.06) !important;
          color: #0f3b66 !important;
        }
        .siem-menu-pale .ant-menu-item-selected {
          background: rgba(15,59,102,0.10) !important;
        }
      `}</style>
      <Sider width={siderWidth} collapsedWidth={0} collapsed={siderCollapsed} trigger={null} style={{ background: '#e6f3ff', position: 'relative' }}>
        <div style={{ height: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px', fontWeight: 700 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 48, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1f6fd1', borderRadius: 6 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" style={{ marginRight: 0 }} xmlns="http://www.w3.org/2000/svg" fill="none" stroke="#fff">
                <circle cx="12" cy="12" r="8" strokeWidth="1.2" />
                <path d="M8 12h8" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </div>
            <span style={{ fontWeight: 900, letterSpacing: 0.6, fontSize: 22, color: '#0f3b66' }}>SIEM</span>
          </div>
          <Button
            type="text"
            size="small"
            icon={<MenuFoldOutlined />}
            onClick={() => setSiderCollapsed(true)}
          />
        </div>
        <Menu
          mode="inline"
          className="siem-menu-pale"
          selectedKeys={[selectedKey]}
          openKeys={openKeys}
          onOpenChange={(keys) => setOpenKeys(keys as string[])}
          onClick={({ key }) => {
            const nextKey = String(key);
            const keyToPath: Record<string, string> = {
              dashboard: '/dashboard',
              alerts: '/alerts',
              assets: '/cmdb/assets',
              tickets: '/tickets',
              integrations: '/settings/integrations',
              dashboards: '/settings/dashboards',
              datasources: '/settings/datasources',
              orchestrator: '/settings/orchestrator',
              correlation: '/settings/correlation',
              permissions: '/settings/permissions',
              workflows: '/settings/workflows',
              'workflow-executions': '/settings/workflows/executions',
              'ai-assistant': '/settings/ai-assistant',
            };
            const nextPerm = permissionByKey[nextKey];
            if (nextPerm && !canAccess(nextPerm)) {
              message.warning('No permission to access this feature.');
              return;
            }
            // Reset workflow view when navigating to workflows
            if (nextKey === 'workflows') {
              setWorkflowView('list');
              setEditingWorkflowId(undefined);
            }
            navigate(keyToPath[nextKey] || '/dashboard');
          }}
          style={{ borderRight: 'none', background: 'transparent' }}
        >
          <Menu.SubMenu key="dashboardGroup" icon={<DashboardOutlined />} title="Dashboard">
            <Menu.Item key="dashboard" icon={<DashboardOutlined />}>Overview</Menu.Item>
            <Menu.Item key="alerts" icon={<BellOutlined />}>Alerts</Menu.Item>
          </Menu.SubMenu>

          <Menu.SubMenu key="ticketGroup" icon={<TeamOutlined />} title="Ticket">
            <Menu.Item key="tickets" icon={<UnorderedListOutlined />}>Tickets</Menu.Item>
          </Menu.SubMenu>

          <Menu.SubMenu key="cmdbGroup" icon={<HddOutlined />} title="CMDB">
            <Menu.Item key="assets" icon={<UnorderedListOutlined />}>Assets</Menu.Item>
          </Menu.SubMenu>

          {settingsItems.length ? (
            <Menu.SubMenu key="settingsGroup" icon={<SettingOutlined />} title="Settings">
              {settingsItems.map((item) => (
                <Menu.Item key={item.key} icon={item.icon}>
                  {item.label}
                </Menu.Item>
              ))}
            </Menu.SubMenu>
          ) : null}
        </Menu>
        <div
          onMouseDown={(e) => {
            if (siderCollapsed) return;
            e.preventDefault();
            setIsResizing(true);
            setSiderWidthCustomized(true);
          }}
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            width: 6,
            height: '100%',
            cursor: 'col-resize',
            background: 'rgba(15,59,102,0.06)',
          }}
        />
      </Sider>
      {siderCollapsed ? (
        <Button
          type="primary"
          icon={<MenuUnfoldOutlined />}
          onClick={() => setSiderCollapsed(false)}
          style={{ position: 'fixed', left: 10, top: 12, zIndex: 1000 }}
        />
      ) : null}

        <Layout style={{ background: '#f5faff' }}>
        <Header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#e6f3ff', padding: '0 24px', borderBottom: 'none', color: '#0f3b66' }}>
          <div />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Avatar style={{ background: '#1f6fd1', color: '#fff', fontWeight: 700, cursor: 'pointer' }} onClick={() => navigate('/profile')}>
              {(username && username[0]) ? String(username[0]).toUpperCase() : 'U'}
            </Avatar>
            <div style={{ color: '#0f3b66', fontWeight: 600, cursor: 'pointer' }} onClick={() => navigate('/profile')}>{username || 'User'}</div>
            {impersonation ? (
              <Tag color="orange">Impersonating: {impersonation.username}</Tag>
            ) : null}
            {impersonation ? (
              <Button onClick={clearImpersonation}>Exit impersonation</Button>
            ) : null}
            <Button type="primary" onClick={handleLogout} style={{ background: '#ff4d4f', border: 'none' }}>
              Exit
            </Button>
          </div>
        </Header>
         <Content style={{ padding: 24, background: '#f5faff' }}>
          <div onClick={(e:any) => {
            const key = e?.key || (e?.target && e.target.getAttribute && e.target.getAttribute('data-key'));
            if (key) setSelectedKey(String(key));
          }}>
            {renderContent(selectedKey)}
          </div>
        </Content>
      </Layout>
    </Layout>
    </ModeContext.Provider>
  );
};

export default App;
