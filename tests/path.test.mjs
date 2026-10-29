import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { parseFlightLog } from '../js/parser.js';
import { buildPath } from '../js/path.js';
import { toLocal } from '../js/geo.js';

function synthetic() {
  const rows = ['Date,Time,RxBt(V),GPS,GSpd(kmh),Hdg(°),Alt(m),Sats,Rud,Ele,Thr,Ail'];
  for (let i = 0; i <= 12; i++) {
    const fix = Math.floor(i / 3) * 3;
    const lat = 50 + fix * 0.00005;
    const sec = String(i).padStart(2, '0');
    rows.push(`2026-10-29,10:00:${sec}.000,12.0,${lat.toFixed(6)} 5.000000,36,0,${100 + fix},9,0,0,0,0`);
  }
  return parseFlightLog(rows.join('\n') + '\n');
}

test('path passes through every fresh GPS fix', () => {
  const log = synthetic();
  const path = buildPath(log);
  for (const i of [0, 3, 6, 9]) {
    const s = log.samples[i];
    const p = path.at(s.t);
    const want = toLocal(s.lat, s.lon, log.home.lat, log.home.lon);
    assert.ok(Math.abs(p.east - want.east) < 0.01);
    assert.ok(Math.abs(p.north - want.north) < 0.01);
  }
});

test('path moves continuously through stale rows', () => {
  const path = buildPath(synthetic());
  const a = path.at(3.4);
  const b = path.at(3.6);
  assert.ok(Math.hypot(a.north - b.north, a.east - b.east) > 0.5);
});

test('path has no velocity jumps at fixes', () => {
  const path = buildPath(synthetic());
  const v = t => {
    const a = path.at(t - 0.01);
    const b = path.at(t + 0.01);
    return Math.hypot(b.north - a.north, b.east - a.east) / 0.02;
  };
  for (const t of [3, 6, 9]) assert.ok(Math.abs(v(t - 0.02) - v(t + 0.02)) < 1.0);
});

const sampleDir = '/mnt/c/Users/r00t/Desktop/LOGS';
test('real logs produce finite, bounded states', { skip: !existsSync(sampleDir) }, () => {
  for (const f of readdirSync(sampleDir).filter(n => n.endsWith('.csv'))) {
    const log = parseFlightLog(readFileSync(`${sampleDir}/${f}`, 'utf8'), f);
    const path = buildPath(log);
    let maxStep = 0;
    let prev = null;
    for (let t = 0; t <= log.duration; t += 0.1) {
      const s = path.at(t);
      for (const k of ['east', 'north', 'alt', 'speed', 'heading', 'roll', 'pitch', 'vspeed']) assert.ok(Number.isFinite(s[k]), `${f} ${k} at ${t}`);
      assert.ok(Math.abs(s.roll) <= 55 && Math.abs(s.pitch) <= 40);
      if (prev) maxStep = Math.max(maxStep, Math.hypot(s.east - prev.east, s.north - prev.north));
      prev = s;
    }
    assert.ok(maxStep < 15, `${f} max 0.1 s step ${maxStep}`);
  }
});
