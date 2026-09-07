// Node 22.18+: node --test src/modules/workflows/sidebar.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { clampSidebarWidth, getSidebarFontSize } from './sidebar.ts';

test('sidebar dragging and keyboard resizing stay usable at wide and narrow viewport sizes', () => {
  assert.equal(clampSidebarWidth(280, 1200), 280);
  assert.equal(clampSidebarWidth(296, 1200), 296);
  assert.equal(clampSidebarWidth(-500, 1200), 240);
  assert.equal(clampSidebarWidth(2000, 1200), 600);
  assert.equal(clampSidebarWidth(600, 400), 240);
  assert.equal(clampSidebarWidth(0, 400), 160);
  assert.equal(clampSidebarWidth(280, 0), 0);
});

test('sidebar text grows with width and keeps readable minimum and maximum sizes', () => {
  assert.equal(getSidebarFontSize(160), 14);
  assert.equal(getSidebarFontSize(280), 14);
  assert.equal(getSidebarFontSize(360), 15);
  assert.equal(getSidebarFontSize(440), 16);
  assert.equal(getSidebarFontSize(520), 17);
  assert.equal(getSidebarFontSize(600), 18);
  assert.equal(getSidebarFontSize(1200), 18);
});
