// Node 22.18+: node --test src/services/workflows/polling.test.mjs
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import test from 'node:test';
import { startWorkflowPolling } from './polling.ts';

function setup(t, hidden = false) {
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const document = new EventTarget();
  document.hidden = hidden;
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => {
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
    else delete globalThis.document;
  });
  return hidden => {
    document.hidden = hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  };
}

test('waits five seconds, then keeps refreshing completed executions for late logs', async t => {
  setup(t);
  const snapshots = [
    { status: 'completed', logs: '' },
    { status: 'completed', logs: 'Final step output' },
  ];
  let displayed;
  const refresh = t.mock.fn(async () => { displayed = snapshots.shift(); });
  const stop = startWorkflowPolling(refresh);

  assert.equal(refresh.mock.callCount(), 0);
  t.mock.timers.tick(4999);
  assert.equal(refresh.mock.callCount(), 0);
  t.mock.timers.tick(1);
  await Promise.resolve();
  assert.equal(displayed.logs, '');
  t.mock.timers.tick(5000);
  await Promise.resolve();
  assert.equal(refresh.mock.callCount(), 2);
  assert.equal(displayed.logs, 'Final step output');
  stop();
});

test('hidden pages pause timers and becoming visible refreshes immediately', async t => {
  const setHidden = setup(t, true);
  const refresh = t.mock.fn(async () => {});
  const stop = startWorkflowPolling(refresh);

  t.mock.timers.tick(15000);
  assert.equal(refresh.mock.callCount(), 0);
  setHidden(false);
  assert.equal(refresh.mock.callCount(), 1);
  await Promise.resolve();
  t.mock.timers.tick(3000);
  setHidden(true);
  t.mock.timers.tick(15000);
  assert.equal(refresh.mock.callCount(), 1);
  setHidden(false);
  assert.equal(refresh.mock.callCount(), 2);
  await Promise.resolve();
  t.mock.timers.tick(5000);
  assert.equal(refresh.mock.callCount(), 3);
  await Promise.resolve();
  stop();
});

test('visibility changes cannot overlap a pending refresh and cadence starts after completion', async t => {
  const setHidden = setup(t);
  let finish;
  const refresh = t.mock.fn(() => new Promise(resolve => { finish = resolve; }));
  const stop = startWorkflowPolling(refresh);

  t.mock.timers.tick(5000);
  setHidden(true);
  setHidden(false);
  t.mock.timers.tick(20000);
  assert.equal(refresh.mock.callCount(), 1);
  finish();
  await Promise.resolve();
  t.mock.timers.tick(4999);
  assert.equal(refresh.mock.callCount(), 1);
  t.mock.timers.tick(1);
  assert.equal(refresh.mock.callCount(), 2);
  setHidden(true);
  finish();
  await Promise.resolve();
  t.mock.timers.tick(20000);
  assert.equal(refresh.mock.callCount(), 2);
  setHidden(false);
  assert.equal(refresh.mock.callCount(), 3);
  finish();
  await Promise.resolve();
  stop();
});

test('rejected and synchronously thrown refresh errors still allow later attempts', async t => {
  setup(t);
  let attempts = 0;
  const stop = startWorkflowPolling(() => {
    attempts += 1;
    if (attempts === 1) return Promise.reject(new Error('Unavailable'));
    if (attempts === 2) throw new Error('Unavailable');
    return Promise.resolve();
  });

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    t.mock.timers.tick(5000);
    await Promise.resolve();
    assert.equal(attempts, attempt);
  }
  stop();
});

test('disposing during a refresh removes listeners and prevents timer resurrection', async t => {
  const setHidden = setup(t);
  let finish;
  const refresh = t.mock.fn(() => new Promise(resolve => { finish = resolve; }));
  const stop = startWorkflowPolling(refresh);
  assert.equal(getEventListeners(document, 'visibilitychange').length, 1);

  t.mock.timers.tick(5000);
  stop();
  assert.equal(getEventListeners(document, 'visibilitychange').length, 0);
  finish();
  await Promise.resolve();
  setHidden(true);
  setHidden(false);
  t.mock.timers.tick(20000);
  assert.equal(refresh.mock.callCount(), 1);
});

test('disposing before the first refresh cancels the pending timer', t => {
  setup(t);
  const refresh = t.mock.fn(async () => {});
  const stop = startWorkflowPolling(refresh);
  stop();
  t.mock.timers.tick(20000);
  assert.equal(refresh.mock.callCount(), 0);
  assert.equal(getEventListeners(document, 'visibilitychange').length, 0);
});
