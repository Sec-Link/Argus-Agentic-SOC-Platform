import React from "react";
import { Button, Card, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";

import type { DetectionDeploymentRecord } from "services/detections";

type Props = {
  rows: DetectionDeploymentRecord[];
  onRefresh: () => void;
};

export default function DetectionDeployments(props: Props) {
  const [pageSize, setPageSize] = React.useState(10);
  const columns: ColumnsType<DetectionDeploymentRecord> = [
    { title: "Rule", dataIndex: "rule_name", key: "rule_name", render: (_, row) => row.rule_name || row.rule_id },
    { title: "Target", dataIndex: "target", key: "target" },
    { title: "Action", dataIndex: "action", key: "action" },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      render: (value) => (value === "success" ? <Tag color="green">success</Tag> : <Tag color="red">{value}</Tag>),
    },
    { title: "Message", dataIndex: "message", key: "message", render: (value) => value || "-" },
    { title: "Time", dataIndex: "created_at", key: "created_at" },
  ];

  return (
    <Card>
      <Space style={{ marginBottom: 12 }}>
        <Button onClick={props.onRefresh}>Refresh</Button>
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
      />
    </Card>
  );
}
