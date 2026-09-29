export interface VariableOption {
  value: string;
  label: string;
  category: string;
}

export interface VariableDeclaration {
  name: string;
  value: string;
  type: 'string' | 'json' | 'secret';
  configuredName?: string;
}

const variableNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const variablesToDeclarations = (
  variables: Record<string, unknown> = {},
  configuredSecrets: string[] = [],
): VariableDeclaration[] => [
  ...Object.entries(variables).map(([name, value]): VariableDeclaration => ({
    name,
    value: typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? 'null',
    type: typeof value === 'string' ? 'string' : 'json',
  })),
  ...configuredSecrets.map((name): VariableDeclaration => ({ name, value: '', type: 'secret', configuredName: name })),
];

export const declarationsToPayload = (rows: VariableDeclaration[] = []) => {
  const names = new Set<string>();
  const variables: [string, unknown][] = [];
  const secrets: [string, string][] = [];
  rows.forEach((row, index) => {
    const name = row?.name;
    if (typeof name !== 'string' || !variableNamePattern.test(name)) {
      throw new Error(`Variable ${index + 1}: use a name starting with a letter or underscore, followed by letters, numbers or underscores.`);
    }
    if (names.has(name)) throw new Error(`Duplicate variable name: ${name}.`);
    names.add(name);
    if (row.type === 'secret') {
      if (!row.value && row.configuredName !== name) throw new Error(`Variable ${name}: enter a secret value.`);
      secrets.push([name, row.value || '']);
      return;
    }
    if (row.type === 'json') {
      try {
        variables.push([name, JSON.parse(row.value)]);
      } catch {
        throw new Error(`Variable ${name}: enter valid JSON.`);
      }
    } else {
      variables.push([name, row.value ?? '']);
    }
  });
  return { variables: Object.fromEntries(variables), secret_variables: Object.fromEntries(secrets) };
};

export const declarationsToVariables = (rows: VariableDeclaration[] = []): Record<string, unknown> =>
  declarationsToPayload(rows).variables;

const ticketFields = [
  ['ticket_number', 'Ticket number'],
  ['title', 'Title'],
  ['status', 'Status'],
  ['priority', 'Priority'],
  ['description', 'Description'],
  ['create_uid', 'Creator'],
  ['event_category', 'Event category'],
  ['event_result', 'Event result'],
  ['labels', 'Labels'],
  ['current_assign_group', 'Assigned group'],
  ['current_assign_owner', 'Assigned owner'],
];

export const getWorkflowVariableOptions = (
  variables: Record<string, unknown>,
  triggerType: string,
  secretNames: string[] = [],
): VariableOption[] => {
  const options = Object.keys(variables)
    .filter(name => variableNamePattern.test(name))
    .map(name => ({ value: `{{variables.${name}}}`, label: name, category: 'variables' }));

  for (const name of secretNames.filter(name => variableNamePattern.test(name))) {
    options.push({ value: `{{variables.${name}}}`, label: `${name} (Secret — credential fields only)`, category: 'secrets' });
  }

  const add = (path: string, label: string, category = 'context') => {
    options.push({ value: `{{${path}}}`, label, category });
  };
  [
    ['workflow_id', 'Workflow ID'],
    ['workflow_name', 'Workflow name'],
    ['workflow_version', 'Published workflow version'],
    ['execution_id', 'Execution ID'],
    ['trigger_source', 'Trigger source'],
    ['trigger_data', 'Trigger data (fields depend on the trigger payload)'],
    ['ticket', 'Ticket context (alias of trigger data)'],
    ['previous_step', 'Previous step (after a step has run)'],
    ['previous_step.step_id', 'Previous step ID (after a step has run)'],
    ['previous_step.success', 'Previous step success (after a step has run)'],
    ['previous_step.output', 'Previous step output (fields depend on the action)'],
  ].forEach(([path, label]) => add(path, label));

  if (['ticket_created', 'ticket_status'].includes(triggerType)) {
    for (const [field, label] of ticketFields) {
      add(`trigger_data.${field}`, label, 'trigger_data');
      add(`ticket.${field}`, label, 'ticket');
    }
  }
  if (['manual', 'event'].includes(triggerType)) {
    add('trigger_data.inputs', 'Bound inputs (ticket invocation only)', 'trigger_data');
    add('trigger_data.ticket', 'Ticket data (ticket invocation only)', 'trigger_data');
    for (const [field, label] of ticketFields) {
      add(`trigger_data.ticket.${field}`, `${label} (if supplied by ticket invocation)`, 'trigger_data');
    }
    add('trigger_data.comment', 'Comment (manual ticket invocation only)', 'trigger_data');
  }
  if (triggerType === 'event') {
    for (const field of ['trigger_event', 'binding_id', 'binding_name']) {
      add(`trigger_data.${field}`, `${field} (ticket binding only)`, 'trigger_data');
    }
  }
  return [...new Map(options.map(option => [option.value, option])).values()];
};
