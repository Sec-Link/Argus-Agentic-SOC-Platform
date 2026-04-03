'use client';

import React from 'react';
import { Modal as AntModal } from 'antd';
import type { ModalProps as AntModalProps } from 'antd';

export type ModalProps = AntModalProps;

export default function Modal(props: ModalProps) {
  return <AntModal {...props} />;
}
