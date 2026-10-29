import test from 'node:test';
import assert from 'node:assert/strict';
import { labelFor, parseListing } from '../js/library.js';

test('labelFor formats the date and time stamp', () => {
  assert.equal(labelFor('EG4-2026-10-29-173436.csv'), '2026-10-29 17:34:36');
  assert.equal(labelFor('Model_2026-01-02_030405.CSV'), '2026-01-02 03:04:05');
  assert.equal(labelFor('EG4-2026-10-29-163642_Demo.csv'), '2026-10-29 16:36:42 - Demo');
  assert.equal(labelFor('EG4-2026-10-29-163642_Slope_Day2.csv'), '2026-10-29 16:36:42 - Slope_Day2');
  assert.equal(labelFor('notes.csv'), 'notes');
});

test('parseListing reads csv links from a directory listing', () => {
  const html = '<ul><li><a href="EG4-2026-10-29-162518.csv">a</a></li><li><a href="my%20log.csv">b</a></li><li><a href="readme.txt">c</a></li><li><a href="index.json">d</a></li></ul>';
  assert.deepEqual(parseListing(html), ['EG4-2026-10-29-162518.csv', 'my log.csv']);
});
