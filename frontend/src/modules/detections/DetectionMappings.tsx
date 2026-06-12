import React from "react";
import { Button, Card, Input, Modal, Popconfirm, Space, Table } from "antd";
import type { ColumnsType } from "antd/es/table";

import { guessElasticIndexPatternsFromProfile } from "./utils";

type LocalMapRow = {
  id: string | number;
  sigma: string;
  splunk: string;
  elastic: string;
  mapping_profile?: string;
  category?: string;
  data_source?: string;
  event_category?: string;
};

type MappingDraft = {
  mapping_profile: string;
  sigma: string;
  splunk: string;
  elastic: string;
  category: string;
  data_source: string;
  event_category: string;
};

type Props = {
  rows: LocalMapRow[];
  loading: boolean;
  selectedIds: React.Key[];
  draft: MappingDraft;
  modalOpen: boolean;
  onRefresh: () => void;
  onUpload: (files: File[]) => Promise<void>;
  onExport: () => void;
  onDownloadTemplate: () => void;
  onDeleteSelected: () => void;
  onOpenCreate: () => void;
  onCloseCreate: () => void;
  onSaveCreate: () => void;
  onSetSelectedIds: (value: React.Key[]) => void;
  onSetDraft: (value: MappingDraft) => void;
};

export default function DetectionMappings(props: Props) {
  const [pageSize, setPageSize] = React.useState(10);
  const columns: ColumnsType<LocalMapRow> = [
    { title: "Profile", dataIndex: "mapping_profile", key: "mapping_profile", width: 220 },
    { title: "Sigma", dataIndex: "sigma", key: "sigma" },
    { title: "Splunk", dataIndex: "splunk", key: "splunk" },
    { title: "Elastic ECS", dataIndex: "elastic", key: "elastic" },
    {
      title: "Elastic Index Patterns",
      key: "elastic_index_patterns",
      width: 220,
      render: (_, row) => guessElasticIndexPatternsFromProfile(row.mapping_profile).join(", "),
    },
  ];

  const setField = (key: keyof MappingDraft, value: string) => {
    props.onSetDraft({ ...props.draft, [key]: value });
  };

  return (
    <Card>
      <Space style={{ marginBottom: 12 }} wrap>
        <Button loading={props.loading} onClick={() => document.getElementById("detection-upload-mappings-files")?.click()}>Upload Mapping Files</Button>
        <Button loading={props.loading} onClick={() => document.getElementById("detection-upload-mappings-folder")?.click()}>Upload Mapping Folder</Button>
        <Button onClick={props.onDownloadTemplate}>Download CSV Template</Button>
        <Button onClick={props.onExport}>Export</Button>
        <Popconfirm
          title={`Delete ${props.selectedIds.length} selected mappings?`}
          okText="Delete"
          cancelText="Cancel"
          disabled={!props.selectedIds.length}
          onConfirm={props.onDeleteSelected}
        >
          <Button danger disabled={!props.selectedIds.length}>Delete Selected</Button>
        </Popconfirm>
        <Button type="primary" onClick={props.onOpenCreate}>New Mapping</Button>
        <Button onClick={props.onRefresh}>Refresh</Button>
        <input
          id="detection-upload-mappings-files"
          type="file"
          accept=".json,.csv"
          multiple
          style={{ display: "none" }}
          onChange={async (e) => {
            await props.onUpload(Array.from(e.target.files || []));
            e.currentTarget.value = "";
          }}
        />
        <input
          id="detection-upload-mappings-folder"
          type="file"
          accept=".json,.csv"
          multiple
          style={{ display: "none" }}
          onChange={async (e) => {
            await props.onUpload(Array.from(e.target.files || []));
            e.currentTarget.value = "";
          }}
          {...({ webkitdirectory: "true", directory: "true" } as any)}
        />
      </Space>
      <Table
        rowKey="id"
        dataSource={props.rows}
        columns={columns}
        pagination={{
          pageSize,
          showSizeChanger: true,
          pageSizeOptions: [10, 20, 50, 100],
          onShowSizeChange: (_page, size) => setPageSize(size),
          onChange: (_page, size) => {
            if (size && size !== pageSize) setPageSize(size);
          },
        }}
        rowSelection={{
          selectedRowKeys: props.selectedIds,
          onChange: props.onSetSelectedIds,
        }}
      />
      <Modal title="New Mapping" open={props.modalOpen} onCancel={props.onCloseCreate} onOk={props.onSaveCreate}>
        <Space direction="vertical" style={{ width: "100%" }}>
          <Input placeholder="Mapping Profile" value={props.draft.mapping_profile} onChange={(e) => setField("mapping_profile", e.target.value)} />
          <Input placeholder="Sigma Field" value={props.draft.sigma} onChange={(e) => setField("sigma", e.target.value)} />
          <Input placeholder="Elastic ECS Field" value={props.draft.elastic} onChange={(e) => setField("elastic", e.target.value)} />
          <Input placeholder="Splunk Field" value={props.draft.splunk} onChange={(e) => setField("splunk", e.target.value)} />
          <Input placeholder="Category" value={props.draft.category} onChange={(e) => setField("category", e.target.value)} />
          <Input placeholder="Data Source" value={props.draft.data_source} onChange={(e) => setField("data_source", e.target.value)} />
          <Input placeholder="Event Category" value={props.draft.event_category} onChange={(e) => setField("event_category", e.target.value)} />
        </Space>
      </Modal>
    </Card>
  );
}
