import React, { useEffect, useState } from 'react';
import { Col, Row } from 'antd';
import { getRbacMe } from 'services/accounts';
import AttackCoverageCard from './AttackCoverageCard';
import LogSourceCoverageCard from './LogSourceCoverageCard';

const CoverageTab: React.FC = () => {
  const [isStaff, setIsStaff] = useState(false);

  useEffect(() => {
    getRbacMe()
      .then((me) => setIsStaff(Boolean(me?.is_staff)))
      .catch(() => setIsStaff(false));
  }, []);

  return (
    <Row gutter={[16, 16]}>
      <Col span={24}>
        <LogSourceCoverageCard isStaff={isStaff} />
      </Col>
      <Col span={24}>
        <AttackCoverageCard isStaff={isStaff} />
      </Col>
    </Row>
  );
};

export default CoverageTab;
