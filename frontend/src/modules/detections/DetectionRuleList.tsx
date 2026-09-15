import React from "react";
import { Button, Card, Dropdown, Input, Popconfirm, Select, Space, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { SorterResult } from "antd/es/table/interface";
import {
  DeleteOutlined,
  DownloadOutlined,
  GithubOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { useResizableColumns } from "components/table/resizableColumns";

const SEVERITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, informational: 0 };
const publishRank = (row: { publish_status?: string; kibana_enabled?: boolean }) =>
  row.publish_status === "published" ? (row.kibana_enabled ? 2 : 1) : 0;

const PERSIST_KEY = "siem_detection_rulelist_state_v1";

type SortOrder = "ascend" | "descend" | null;

type PersistShape = {
  search?: string;
  product?: string;
  severity?: string;
  status?: string;
  page?: number;
  pageSize?: number;
  sortField?: string | null;
  sortOrder?: SortOrder;
};

const readPersisted = (): PersistShape => {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.sessionStorage.getItem(PERSIST_KEY) || "{}") as PersistShape;
  } catch {
    return {};
  }
};

const writePersisted = (patch: PersistShape) => {
  if (typeof window === "undefined") return;
  try {
    const next = { ...readPersisted(), ...patch };
    window.sessionStorage.setItem(PERSIST_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota / serialization errors */
  }
};

type RuleRow = {
  id: string;
  name?: string;
  version?: number;
  level?: string;
  status?: string;
  logsource?: string;
  profile?: string;
  tags?: string[];
  publish_status?: string;
  kibana_enabled?: boolean;
};

type Option = { value: string; label: string };

type Props = {
  rules: RuleRow[];
  filteredRules: RuleRow[];
  loading: boolean;
  search: string;
  productFilter: string;
  severityFilter: string;
  statusFilter: string;
  productOptions: Option[];
  severityOptions: Option[];
  statusOptions: Option[];
  selectedRuleIds: React.Key[];
  uploading: boolean;
  githubUrl: string;
  setSearch: (value: string) => void;
  setProductFilter: (value: string) => void;
  setSeverityFilter: (value: string) => void;
  setStatusFilter: (value: string) => void;
  setSelectedRuleIds: (value: React.Key[]) => void;
  setGithubUrl: (value: string) => void;
  onReload: () => void;
  onDeleteSelected: () => void;
  onSelectRule: (id: string) => void;
  onUploadFiles: (files: File[]) => Promise<void>;
  onExportRules: () => void;
  onCreateRule: () => void;
  onImportGithub: () => void;
};

export default function DetectionRuleList(props: Props) {
  const persisted = React.useRef<PersistShape>(readPersisted());
  const [page, setPage] = React.useState<number>(persisted.current.page || 1);
  const [pageSize, setPageSize] = React.useState<number>(persisted.current.pageSize || 10);
  const [sortField, setSortField] = React.useState<string | null>(persisted.current.sortField ?? null);
  const [sortOrder, setSortOrder] = React.useState<SortOrder>(persisted.current.sortOrder ?? null);

  // Restore parent-owned filter state once on mount.
  React.useEffect(() => {
    const p = persisted.current;
    if (p.search != null && p.search !== props.search) props.setSearch(p.search);
    if (p.product != null && p.product !== props.productFilter) props.setProductFilter(p.product);
    if (p.severity != null && p.severity !== props.severityFilter) props.setSeverityFilter(p.severity);
    if (p.status != null && p.status !== props.statusFilter) props.setStatusFilter(p.status);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist filters whenever they change.
  React.useEffect(() => {
    writePersisted({
      search: props.search,
      product: props.productFilter,
      severity: props.severityFilter,
      status: props.statusFilter,
    });
  }, [props.search, props.productFilter, props.severityFilter, props.statusFilter]);

  React.useEffect(() => {
    writePersisted({ page, pageSize, sortField, sortOrder });
  }, [page, pageSize, sortField, sortOrder]);

  const resetAll = () => {
    try {
      window.sessionStorage.removeItem(PERSIST_KEY);
    } catch {
      /* ignore */
    }
    props.setSearch("");
    props.setProductFilter(props.productOptions[0]?.value ?? "");
    props.setSeverityFilter(props.severityOptions[0]?.value ?? "");
    props.setStatusFilter(props.statusOptions[0]?.value ?? "");
    setPage(1);
    setPageSize(10);
    setSortField(null);
    setSortOrder(null);
    props.onReload();
  };

  const orderFor = (key: string): SortOrder => (sortField === key ? sortOrder : null);

  const ruleColumns: ColumnsType<RuleRow> = [
    {
      title: "Rule Name",
      dataIndex: "name",
      key: "name",
      width: 260,
      ellipsis: true,
      sortOrder: orderFor("name"),
      sorter: (a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)),
      render: (_, row) => <span style={{ fontWeight: 700 }}>{row.name || row.id}</span>,
    },
    {
      title: "Severity",
      key: "level",
      width: 112,
      ellipsis: true,
      sortOrder: orderFor("level"),
      sorter: (a, b) =>
        (SEVERITY_RANK[String(a.level || "medium").toLowerCase()] ?? 2) -
        (SEVERITY_RANK[String(b.level || "medium").toLowerCase()] ?? 2),
      render: (_, row) => {
        const level = String(row.level || "medium").toLowerCase();
        const color = level === "critical" ? "red" : level === "high" ? "volcano" : level === "medium" ? "gold" : "blue";
        return <Tag color={color} style={{ whiteSpace: "nowrap" }}>{level}</Tag>;
      },
    },
    {
      title: "Status",
      key: "status",
      width: 112,
      ellipsis: true,
      sortOrder: orderFor("status"),
      sorter: (a, b) => String(a.status || "draft").localeCompare(String(b.status || "draft")),
      render: (_, row) => <Tag color="orange" style={{ whiteSpace: "nowrap" }}>{row.status || "draft"}</Tag>,
    },
    {
      title: "Log Source",
      dataIndex: "logsource",
      key: "logsource",
      width: 144,
      ellipsis: true,
      sortOrder: orderFor("logsource"),
      sorter: (a, b) => String(a.logsource || "").localeCompare(String(b.logsource || "")),
      render: (value) => value || "-",
    },
    {
      title: "Profile",
      dataIndex: "profile",
      key: "profile",
      width: 144,
      ellipsis: true,
      sortOrder: orderFor("profile"),
      sorter: (a, b) => String(a.profile || "").localeCompare(String(b.profile || "")),
      render: (value) => value || "-",
    },
    {
      title: "Tags",
      key: "tags",
      width: 240,
      render: (_, row) =>
        Array.isArray(row.tags) && row.tags.length ? (
          <Space size={[4, 4]} wrap>
            {row.tags.map((t) => (
              <Tag key={t} style={{ marginInlineEnd: 0, whiteSpace: "normal", wordBreak: "break-word" }}>{t}</Tag>
            ))}
          </Space>
        ) : (
          "-"
        ),
    },
    {
      title: "Published",
      key: "publish",
      width: 140,
      align: "right",
      sortOrder: orderFor("publish"),
      sorter: (a, b) => publishRank(a) - publishRank(b),
      render: (_, row) =>
        row.publish_status === "published" ? (
          <Tag color={row.kibana_enabled ? "green" : "gold"} style={{ marginInlineEnd: 0 }}>
            {row.kibana_enabled ? "Kibana Enabled" : "Published"}
          </Tag>
        ) : (
          <Tag style={{ marginInlineEnd: 0 }}>Not Published</Tag>
        ),
    },
  ];

  const { columns: resizableRuleColumns, components: resizableComponents } = useResizableColumns(ruleColumns as any[]);

  const selectStyle: React.CSSProperties = { minWidth: 150 };

  const uploadMenu = {
    items: [
      { key: "files", icon: <UploadOutlined />, label: "Upload Files" },
      { key: "folder", icon: <UploadOutlined />, label: "Upload Folder" },
    ],
    onClick: ({ key }: { key: string }) =>
      document.getElementById(key === "folder" ? "detection-upload-folder" : "detection-upload-files")?.click(),
  };

  return (
    <Card styles={{ body: { paddingInline: 16 } }}>
      {/* Row 1 — Filter bar */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 10,
        }}
      >
        <Input
          allowClear
          prefix={<SearchOutlined style={{ opacity: 0.6 }} />}
          placeholder="Search rules, tags, or data sources"
          value={props.search}
          onChange={(e) => props.setSearch(e.target.value)}
          onPressEnter={props.onReload}
          style={{ width: 360, maxWidth: "100%" }}
        />
        <Space wrap>
          <Select value={props.productFilter} onChange={props.setProductFilter} style={selectStyle} options={props.productOptions} />
          <Select value={props.severityFilter} onChange={props.setSeverityFilter} style={selectStyle} options={props.severityOptions} />
          <Select value={props.statusFilter} onChange={props.setStatusFilter} style={selectStyle} options={props.statusOptions} />
          <Button icon={<ReloadOutlined />} onClick={resetAll}>Reset</Button>
        </Space>
      </div>

      {/* Row 2 — Action & meta bar */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <Tag color="blue" style={{ fontWeight: 600 }}>
          Showing {props.filteredRules.length} / {props.rules.length} rules
        </Tag>
        <Space wrap>
          <Space.Compact>
            <Input
              prefix={<GithubOutlined style={{ opacity: 0.6 }} />}
              placeholder="https://raw.githubusercontent.com/.../rule.yml"
              value={props.githubUrl}
              onChange={(e) => props.setGithubUrl(e.target.value)}
              style={{ width: 300 }}
            />
            <Button onClick={props.onImportGithub}>Import</Button>
          </Space.Compact>
          <Dropdown menu={uploadMenu}>
            <Button icon={<UploadOutlined />} loading={props.uploading}>Upload</Button>
          </Dropdown>
          <Popconfirm
            title={`Delete ${props.selectedRuleIds.length} selected rules?`}
            okText="Delete"
            cancelText="Cancel"
            disabled={!props.selectedRuleIds.length}
            onConfirm={props.onDeleteSelected}
          >
            <Button danger icon={<DeleteOutlined />} disabled={!props.selectedRuleIds.length}>
              Delete{props.selectedRuleIds.length ? ` (${props.selectedRuleIds.length})` : ""}
            </Button>
          </Popconfirm>
          <Button icon={<DownloadOutlined />} onClick={props.onExportRules}>Export</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={props.onCreateRule}>New Rule</Button>
        </Space>
      </div>

      <div style={{ width: "100%", overflowX: "auto" }}>
        <Table
          rowKey="id"
          loading={props.loading}
          dataSource={props.filteredRules}
          columns={resizableRuleColumns as ColumnsType<RuleRow>}
          components={resizableComponents}
          scroll={{ x: 1100 }}
          rowSelection={{
            selectedRowKeys: props.selectedRuleIds,
            onChange: props.setSelectedRuleIds,
            columnWidth: 48,
          }}
          pagination={{
            current: page,
            pageSize,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50, 100],
            showTotal: (total) => `${total} rules`,
          }}
          onChange={(pagination, _filters, sorter) => {
            const s = Array.isArray(sorter) ? sorter[0] : (sorter as SorterResult<RuleRow>);
            setPage(pagination.current || 1);
            if (pagination.pageSize && pagination.pageSize !== pageSize) setPageSize(pagination.pageSize);
            setSortField(s?.order ? String(s.columnKey ?? s.field ?? "") : null);
            setSortOrder((s?.order as SortOrder) ?? null);
          }}
          onRow={(row) => ({ onClick: () => props.onSelectRule(row.id) })}
        />
      </div>

      <input
        id="detection-upload-files"
        type="file"
        accept=".yml,.yaml"
        multiple
        style={{ display: "none" }}
        onChange={async (e) => {
          await props.onUploadFiles(Array.from(e.target.files || []));
          e.currentTarget.value = "";
        }}
      />
      <input
        id="detection-upload-folder"
        type="file"
        accept=".yml,.yaml"
        multiple
        style={{ display: "none" }}
        onChange={async (e) => {
          await props.onUploadFiles(Array.from(e.target.files || []));
          e.currentTarget.value = "";
        }}
        {...({ webkitdirectory: "true", directory: "true" } as any)}
      />
    </Card>
  );
}
