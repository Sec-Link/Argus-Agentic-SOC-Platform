import React from 'react';
import { Tooltip, Typography } from 'antd';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

const STALE_SECONDS = 24 * 3600;

const ScanAge: React.FC<{ scannedAt: string | null | undefined; ageSeconds: number | null | undefined }> = ({
  scannedAt,
  ageSeconds,
}) => {
  if (!scannedAt) return <Typography.Text type="secondary">Never scanned</Typography.Text>;
  const stale = (ageSeconds ?? 0) > STALE_SECONDS;
  return (
    <Tooltip title={`${dayjs(scannedAt).format('YYYY-MM-DD HH:mm:ss')}${stale ? ' — may be out of date, consider re-scanning' : ''}`}>
      <Typography.Text type={stale ? 'warning' : 'secondary'} style={{ fontSize: 12 }}>
        Last scanned {dayjs(scannedAt).fromNow()}
      </Typography.Text>
    </Tooltip>
  );
};

export default ScanAge;
