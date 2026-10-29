import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { parseFlightLog, splitCsvLine } from '../js/parser.js';

const HEADER = 'Date,Time,1RSS(dB),2RSS(dB),RQly(%),RxBt(V),Curr(A),GPS,GSpd(kmh),Hdg(°),Alt(m),Sats,Rud,Ele,Thr,Ail';

function makeCsv(rows) {
  return [HEADER, ...rows].join('\n') + '\n';
}

test('splitCsvLine handles quotes', () => {
  assert.deepEqual(splitCsvLine('a,"b,c",d'), ['a', 'b,c', 'd']);
});

test('parses a minimal log and keeps logged values unmodified', () => {
  const log = parseFlightLog(makeCsv([
    '2026-10-29,10:00:00.000,-30,-31,100,12.6,0.0,50.0000 5.0000,0.0,90,100.0,9,0,0,-1024,0',
    '2026-10-29,10:00:01.000,-30,-31,100,12.5,0.0,50.0001 5.0000,20.0,90,110.0,9,512,0,0,-512',
    '2026-10-29,10:00:02.000,-30,-31,100,12.4,0.0,50.0002 5.0000,30.0,180,120.0,9,0,1024,1024,1024'
  ]), 'EG4-2026-10-29-100000.csv');
  assert.equal(log.cells, 3);
  assert.equal(log.label, 'EG4 10:00');
  assert.equal(log.samples.length, 3);
  assert.equal(log.samples[0].alt, 100);
  assert.equal(log.samples[2].alt, 120);
  assert.equal(log.samples[2].thr, 1);
  assert.equal(log.samples[0].thr, -1);
  assert.equal(log.samples[1].rud, 0.5);
  assert.ok(Math.abs(log.samples[2].homeDist - 22.24) < 0.2);
  assert.ok(log.samples[1].vspeed > 0);
  assert.equal(log.duration, 2);
});

test('never fills, holds or backfills GPS data', () => {
  const log = parseFlightLog(makeCsv([
    '2026-10-29,10:00:00.000,-30,-31,100,12.6,0.0,0.000000 0.000000,0.0,0,0.0,0,0,0,0,0',
    '2026-10-29,10:00:01.000,-30,-31,100,12.6,0.0,50.0000 5.0000,0.0,0,0.0,8,0,0,0,0',
    '2026-10-29,10:00:02.000,-30,-31,100,12.6,0.0,,0.0,0,0.0,0,0,0,0,0'
  ]));
  assert.equal(log.samples[0].lat, null);
  assert.equal(log.samples[1].lat, 50);
  assert.equal(log.samples[2].lat, null);
  assert.equal(log.samples[0].gpsValid, false);
  assert.equal(log.samples[2].homeDist, null);
});

test('altitude is exactly the logged value and zero is not replaced', () => {
  const log = parseFlightLog(makeCsv([
    '2026-10-29,10:00:00.000,-30,-31,100,12.6,0.0,50.0 5.0,0.0,0,271.5,9,0,0,0,0',
    '2026-10-29,10:00:01.000,-30,-31,100,12.6,0.0,,0.0,0,0.0,0,0,0,0,0',
    '2026-10-29,10:00:02.000,-30,-31,100,12.6,0.0,50.0 5.0,0.0,0,-3.25,9,0,0,0,0'
  ]));
  assert.deepEqual(log.samples.map(s => s.alt), [271.5, 0, -3.25]);
});

test('handles midnight rollover', () => {
  const log = parseFlightLog(makeCsv([
    '2026-10-29,23:59:59.000,-30,-31,100,12.6,0.0,50.0 5.0,0.0,0,0.0,8,0,0,0,0',
    '2026-10-30,00:00:01.000,-30,-31,100,12.6,0.0,50.0 5.0,0.0,0,0.0,8,0,0,0,0'
  ]));
  assert.equal(log.duration, 2);
});

test('rejects files that are not EdgeTX logs', () => {
  assert.throws(() => parseFlightLog('a,b\n1,2\n'));
});

const sampleDir = '/mnt/c/Users/r00t/Desktop/LOGS';
test('parses real sample logs when present', { skip: !existsSync(sampleDir) }, () => {
  for (const f of readdirSync(sampleDir).filter(n => n.endsWith('.csv'))) {
    const log = parseFlightLog(readFileSync(`${sampleDir}/${f}`, 'utf8'), f);
    assert.ok(log.samples.length > 100);
    assert.ok(log.samples.filter(s => s.gpsValid).every(s => Number.isFinite(s.lat) && Number.isFinite(s.alt) && Number.isFinite(s.homeDist)));
    assert.ok(log.samples.every((s, i) => i === 0 || s.t > log.samples[i - 1].t));
    assert.ok(log.hasSticks && log.hasGps);
  }
});
