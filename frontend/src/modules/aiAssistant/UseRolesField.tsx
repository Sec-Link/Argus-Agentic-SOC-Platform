import React from 'react';
import { Form, Select } from 'antd';
import type { ToolAccessRole } from '../../api';

export type ConfigActions = { add: boolean; change: boolean; remove: boolean };

export function allowedRoleNames(row: { use_group_ids?: number[]; use_roles?: ToolAccessRole[] }, directory: ToolAccessRole[]) {
  if (!Array.isArray(row.use_group_ids)) return 'Unavailable';
  if (!row.use_group_ids.length) return 'Superusers only';
  const names = new Map([...directory, ...(row.use_roles || [])].map((role) => [role.id, role.name]));
  return row.use_group_ids.map((id) => names.get(id) || `Role #${id}`).join(', ');
}

export function changedRoleFields(authorized: boolean, selected?: number[], original?: number[]) {
  if (!authorized || !Array.isArray(selected)) return {};
  if (original && original.length === selected.length && original.every((id) => selected.includes(id))) return {};
  return { use_group_ids: selected };
}

export default function UseRolesField({ roles, resource }: { roles: ToolAccessRole[]; resource: string }) {
  return (
    <Form.Item name="use_group_ids" label={`Roles allowed to use this ${resource}`}
      extra="Leave empty to allow only superusers.">
      <Select mode="multiple" allowClear optionFilterProp="label" placeholder="Select allowed roles"
        options={roles.map((role) => ({ value: role.id, label: role.name }))} />
    </Form.Item>
  );
}
