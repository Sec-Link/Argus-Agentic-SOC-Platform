// Node 22.18+: node --test src/modules/workflows/variables.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { declarationsToPayload, declarationsToVariables, getWorkflowVariableOptions, variablesToDeclarations } from './variables.ts';

test('workflow declarations preserve JSON types, validate names and reject invalid JSON', () => {
  const variables = JSON.parse('{"empty":"","literal":"false","enabled":false,"limit":0,"unset":null,"config":{"items":[1,"two"]},"__proto__":"safe"}');
  const rows = variablesToDeclarations(variables);
  assert.deepEqual(declarationsToVariables(rows), variables);
  assert.equal(rows.find(row => row.name === 'literal').type, 'string');
  assert.equal(rows.find(row => row.name === 'enabled').type, 'json');
  assert.deepEqual(declarationsToVariables(), {});
  for (const name of ['', '1name', 'two words', 'a.b', 'a-b', '{{name}}', ' name']) {
    assert.throws(() => declarationsToVariables([{ name, value: '', type: 'string' }]), /Variable 1/);
  }
  assert.throws(() => declarationsToVariables([
    { name: 'limit', value: '1', type: 'json' },
    { name: 'limit', value: '2', type: 'json' },
  ]), /Duplicate variable name/);
  assert.throws(() => declarationsToVariables([{ name: 'config', value: '{', type: 'json' }]), /valid JSON/);
});

test('context suggestions expose declared names and scope fields to real trigger payloads', () => {
  const declared = { recipient: '', _limit2: 0, 'bad-name': '', 'nested.path': '' };
  const manual = getWorkflowVariableOptions(declared, 'manual');
  const values = options => options.map(option => option.value);
  assert.deepEqual(values(manual.filter(option => option.category === 'variables')), [
    '{{variables.recipient}}', '{{variables._limit2}}',
  ]);
  assert.ok(values(manual).includes('{{workflow_version}}'));
  assert.ok(values(manual).includes('{{previous_step.output}}'));
  assert.ok(values(manual).includes('{{trigger_data.ticket.ticket_number}}'));
  assert.match(manual.find(option => option.value === '{{trigger_data.ticket}}').label, /invocation only/);
  assert.ok(!values(manual).includes('{{trigger_data.ticket_number}}'));
  const ticket = values(getWorkflowVariableOptions({}, 'ticket_created'));
  assert.ok(ticket.includes('{{trigger_data.ticket_number}}'));
  assert.ok(ticket.includes('{{ticket.priority}}'));
  assert.ok(!ticket.includes('{{trigger_data.severity}}'));
  const webhook = values(getWorkflowVariableOptions({}, 'webhook'));
  assert.ok(webhook.includes('{{trigger_data}}'));
  assert.ok(!webhook.includes('{{trigger_data.ticket_number}}'));
  assert.ok(!webhook.some(value => value.startsWith('{{step_results.')));
});

test('secret declarations stay separate from public values and reopen without their plaintext', () => {
  const rows = [
    { name: 'recipient', value: 'soc@example.test', type: 'string' },
    { name: 'api_key', value: 'private-key', type: 'secret' },
  ];
  assert.deepEqual(declarationsToPayload(rows), {
    variables: { recipient: 'soc@example.test' },
    secret_variables: { api_key: 'private-key' },
  });
  const loaded = variablesToDeclarations({ recipient: 'soc@example.test' }, ['api_key']);
  assert.deepEqual(loaded[1], { name: 'api_key', value: '', type: 'secret', configuredName: 'api_key' });
  assert.deepEqual(declarationsToPayload(loaded).secret_variables, { api_key: '' });
  loaded[1].name = 'renamed_key';
  assert.throws(() => declarationsToPayload(loaded), /enter a secret/);
  loaded[1].name = 'api_key';
  assert.deepEqual(declarationsToPayload(loaded).secret_variables, { api_key: '' });
  assert.deepEqual(declarationsToPayload([]), { variables: {}, secret_variables: {} });
  assert.throws(() => declarationsToPayload([{ name: 'api_key', value: '', type: 'secret' }]), /enter a secret/);
  assert.throws(() => declarationsToPayload([...rows, { name: 'api_key', value: 'public', type: 'string' }]), /Duplicate/);
  const options = getWorkflowVariableOptions({ recipient: 'soc@example.test' }, 'manual', ['api_key']);
  assert.deepEqual(options.find(option => option.category === 'secrets'), {
    value: '{{variables.api_key}}', label: 'api_key (Secret — credential fields only)', category: 'secrets',
  });
  assert.ok(!JSON.stringify(options).includes('private-key'));
  const duplicates = getWorkflowVariableOptions({ api_key: '' }, 'manual', ['api_key', 'api_key']);
  assert.equal(duplicates.filter(option => option.value === '{{variables.api_key}}').length, 1);
  assert.equal(duplicates.find(option => option.value === '{{variables.api_key}}').category, 'secrets');
});
