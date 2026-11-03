import React from 'react';

/** A metric value that opens its detail view when clicked (inherits the Statistic's colour). */
const ClickValue: React.FC<{ onClick: () => void; children: React.ReactNode }> = ({ onClick, children }) => (
  <span
    role="button"
    tabIndex={0}
    title="Click for details"
    style={{ cursor: 'pointer', borderBottom: '1px dashed currentColor' }}
    onClick={onClick}
    onKeyDown={(e) => e.key === 'Enter' && onClick()}
  >
    {children}
  </span>
);

export default ClickValue;
