import React from "react";
import { Button, Card, Input, Popconfirm, Select, Space, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";

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
  const [pageSize, setPageSize] = React.useState(12);

  const ruleColumns: ColumnsType<RuleRow> = [
    { title: "Rule Name", dataIndex: "name", key: "name", render: (_, row) => <span style={{ fontWeight: 700 }}>{row.name || row.id}</span> },
    {
      title: "Severity",
      key: "level",
      width: 100,
      render: (_, row) => {
        const level = String(row.level || "medium").toLowerCase();
        const color = level === "critical" ? "red" : level === "high" ? "volcano" : level === "medium" ? "gold" : "blue";
        return <Tag color={color}>{level}</Tag>;
      },
    },
    { title: "Status", key: "status", width: 100, render: (_, row) => <Tag color="orange">{row.status || "draft"}</Tag> },
    { title: "Log Source", dataIndex: "logsource", key: "logsource", width: 220, render: (value) => value || "-" },
    { title: "Profile", dataIndex: "profile", key: "profile", width: 200, render: (value) => value || "-" },
    { title: "Tags", key: "tags", render: (_, row) => (Array.isArray(row.tags) && row.tags.length ? row.tags.join(", ") : "-") },
    {
      title: "Published",
      key: "publish",
      width: 140,
      render: (_, row) =>
        row.publish_status === "published" ? (
          <Tag color={row.kibana_enabled ? "green" : "gold"}>{row.kibana_enabled ? "Kibana Enabled" : "Published to Kibana"}</Tag>
        ) : (
          <Tag>Not Published</Tag>
        ),
    },
  ];

  return (
    <Card>
      <Space style={{ marginBottom: 12, width: "100%", justifyContent: "space-between" }} wrap>
        <Space>
          <Input.Search
            placeholder="Search rules, tags, or data sources"
            value={props.search}
            onChange={(e) => props.setSearch(e.target.value)}
            onSearch={props.onReload}
            style={{ width: 420 }}
          />
          <Select value={props.productFilter} onChange={props.setProductFilter} style={{ width: 160 }} options={props.productOptions} />
          <Select value={props.severityFilter} onChange={props.setSeverityFilter} style={{ width: 140 }} options={props.severityOptions} />
          <Select value={props.statusFilter} onChange={props.setStatusFilter} style={{ width: 140 }} options={props.statusOptions} />
        </Space>
        <Space wrap>
          <Typography.Text type="secondary">Showing {props.filteredRules.length} / {props.rules.length} rules</Typography.Text>
          <Input
            placeholder="https://raw.githubusercontent.com/.../rule.yml"
            value={props.githubUrl}
            onChange={(e) => props.setGithubUrl(e.target.value)}
            style={{ width: 320 }}
          />
          <Button onClick={props.onImportGithub}>Import GitHub Rule</Button>
          <Popconfirm
            title={`Delete ${props.selectedRuleIds.length} selected rules?`}
            okText="Delete"
            cancelText="Cancel"
            disabled={!props.selectedRuleIds.length}
            onConfirm={props.onDeleteSelected}
          >
            <Button danger disabled={!props.selectedRuleIds.length}>Delete Selected</Button>
          </Popconfirm>
          <Button loading={props.uploading} onClick={() => document.getElementById("detection-upload-files")?.click()}>Upload Files</Button>
          <Button loading={props.uploading} onClick={() => document.getElementById("detection-upload-folder")?.click()}>Upload Folder</Button>
          <Button onClick={props.onExportRules}>Export</Button>
          <Button type="primary" onClick={props.onCreateRule}>New Rule</Button>
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
        </Space>
      </Space>
      <Table
        rowKey="id"
        loading={props.loading}
        dataSource={props.filteredRules}
        columns={ruleColumns}
        rowSelection={{
          selectedRowKeys: props.selectedRuleIds,
          onChange: props.setSelectedRuleIds,
        }}
        pagination={{
          pageSize,
          showSizeChanger: true,
          pageSizeOptions: [10, 20, 50, 100],
          onShowSizeChange: (_page, size) => setPageSize(size),
          onChange: (_page, size) => {
            if (size && size !== pageSize) setPageSize(size);
          },
        }}
        onRow={(row) => ({ onClick: () => props.onSelectRule(row.id) })}
      />
    </Card>
  );
}
