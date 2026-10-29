import { haversine } from './geo.js';

const COLUMN_ALIASES = {
  date: ['Date'],
  time: ['Time'],
  rss1: ['1RSS(dB)'],
  rss2: ['2RSS(dB)'],
  rqly: ['RQly(%)'],
  rsnr: ['RSNR(dB)'],
  ant: ['ANT'],
  rfmd: ['RFMD'],
  tpwr: ['TPWR(mW)'],
  trss: ['TRSS(dB)'],
  tqly: ['TQly(%)'],
  volt: ['RxBt(V)', 'VFAS(V)', 'Cels(V)'],
  curr: ['Curr(A)'],
  capa: ['Capa(mAh)'],
  batPct: ['Bat%(%)'],
  gps: ['GPS'],
  speed: ['GSpd(kmh)', 'GSpd(kts)', 'GSpd(mph)'],
  heading: ['Hdg(°)', 'Hdg(@)', 'Hdg(deg)'],
  alt: ['Alt(m)', 'Alt(ft)'],
  sats: ['Sats'],
  rud: ['Rud'],
  ele: ['Ele'],
  thr: ['Thr'],
  ail: ['Ail'],
  txBat: ['TxBat(V)']
};

const MIN_HOME_SATS = 6;
const STICK_RANGE = 1024;

export function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function resolveColumns(header) {
  const index = {};
  const present = {};
  for (const [key, names] of Object.entries(COLUMN_ALIASES)) {
    for (const name of names) {
      const at = header.indexOf(name);
      if (at >= 0) {
        index[key] = at;
        present[key] = name;
        break;
      }
    }
  }
  return { index, present };
}

function num(cells, at) {
  if (at === undefined) return null;
  const raw = cells[at];
  if (raw === undefined || raw === '') return null;
  const v = Number(raw);
  return Number.isFinite(v) ? v : null;
}

function parseGps(raw) {
  if (!raw) return null;
  const parts = raw.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const lat = Number(parts[0]);
  const lon = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat === 0 && lon === 0) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

function parseTimestamp(date, time) {
  const d = (date || '1970-01-01').split('-').map(Number);
  const tm = (time || '00:00:00.000').split(':');
  const sec = Number(tm[2] || 0);
  const whole = Math.floor(sec);
  return Date.UTC(d[0], (d[1] || 1) - 1, d[2] || 1, Number(tm[0] || 0), Number(tm[1] || 0), whole, Math.round((sec - whole) * 1000));
}

function speedToKmh(v, unitName) {
  if (v === null) return null;
  if (unitName === 'GSpd(kts)') return v * 1.852;
  if (unitName === 'GSpd(mph)') return v * 1.609344;
  return v;
}

function altToMeters(v, unitName) {
  if (v === null) return null;
  return unitName === 'Alt(ft)' ? v * 0.3048 : v;
}

function estimateCells(volt) {
  if (!volt || volt < 3) return 1;
  return Math.max(1, Math.ceil(volt / 4.35));
}

export function parseFlightLog(text, fileName = 'log.csv') {
  const clean = text.replace(/^﻿/, '');
  const lines = clean.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) throw new Error('The file has no data rows.');
  const header = splitCsvLine(lines[0]).map(h => h.trim());
  const { index, present } = resolveColumns(header);
  if (index.time === undefined) throw new Error('Not an EdgeTX telemetry log: no Time column.');
  const hasGps = index.gps !== undefined;
  if (!hasGps) throw new Error('Not a GPS log: no GPS column.');

  const rows = [];
  let dayOffset = 0;
  let prevRaw = null;
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    if (cells.length < 3) continue;
    let ts = parseTimestamp(cells[index.date], cells[index.time]);
    if (!Number.isFinite(ts)) continue;
    if (prevRaw !== null && ts + dayOffset < prevRaw - 12 * 3600 * 1000) dayOffset += 24 * 3600 * 1000;
    ts += dayOffset;
    prevRaw = ts;
    const gps = hasGps ? parseGps(cells[index.gps]) : null;
    rows.push({
      ts,
      gpsValid: gps !== null,
      lat: gps ? gps.lat : null,
      lon: gps ? gps.lon : null,
      altRaw: altToMeters(num(cells, index.alt), present.alt),
      speed: speedToKmh(num(cells, index.speed), present.speed),
      heading: num(cells, index.heading),
      sats: num(cells, index.sats),
      volt: num(cells, index.volt),
      curr: num(cells, index.curr),
      capa: num(cells, index.capa),
      batPct: num(cells, index.batPct),
      rss1: num(cells, index.rss1),
      rss2: num(cells, index.rss2),
      rqly: num(cells, index.rqly),
      rsnr: num(cells, index.rsnr),
      ant: num(cells, index.ant),
      rfmd: num(cells, index.rfmd),
      tpwr: num(cells, index.tpwr),
      trss: num(cells, index.trss),
      tqly: num(cells, index.tqly),
      txBat: num(cells, index.txBat),
      rud: num(cells, index.rud),
      ele: num(cells, index.ele),
      thr: num(cells, index.thr),
      ail: num(cells, index.ail)
    });
  }
  if (rows.length < 2) throw new Error('The file has fewer than two data rows.');
  rows.sort((a, b) => a.ts - b.ts);

  const withGps = rows.filter(r => r.gpsValid);
  if (withGps.length === 0) throw new Error('The log has no valid GPS fixes.');

  const homeRow = withGps.find(r => r.sats !== null && r.sats >= MIN_HOME_SATS) || withGps[0];
  const home = { lat: homeRow.lat, lon: homeRow.lon, ts: homeRow.ts };
  const launchAlt = homeRow.altRaw === null ? 0 : homeRow.altRaw;
  const hasAlt = index.alt !== undefined;

  const t0 = rows[0].ts;
  const firstVolt = rows.find(r => r.volt !== null && r.volt > 0);
  const cells = estimateCells(firstVolt ? firstVolt.volt : null);
  let travelled = 0;
  let lastFix = null;
  const samples = rows.map((r, i) => {
    if (r.gpsValid) {
      if (lastFix) travelled += haversine(lastFix.lat, lastFix.lon, r.lat, r.lon);
      lastFix = r;
    }
    const alt = hasAlt ? r.altRaw : 0;
    const homeDist = r.gpsValid ? haversine(home.lat, home.lon, r.lat, r.lon) : null;
    const volt = r.volt;
    return {
      t: (r.ts - t0) / 1000,
      ts: r.ts,
      lat: r.lat,
      lon: r.lon,
      gpsValid: r.gpsValid,
      alt,
      speed: r.speed,
      heading: r.heading === null ? null : ((r.heading % 360) + 360) % 360,
      sats: r.sats,
      volt,
      vcell: volt === null ? null : volt / cells,
      curr: r.curr,
      capa: r.capa,
      batPct: r.batPct,
      rss1: r.rss1,
      rss2: r.rss2,
      rqly: r.rqly,
      rsnr: r.rsnr,
      ant: r.ant,
      rfmd: r.rfmd,
      tpwr: r.tpwr,
      trss: r.trss,
      tqly: r.tqly,
      txBat: r.txBat,
      thr: r.thr === null ? 0 : r.thr / STICK_RANGE,
      rud: r.rud === null ? 0 : r.rud / STICK_RANGE,
      ele: r.ele === null ? 0 : r.ele / STICK_RANGE,
      ail: r.ail === null ? 0 : r.ail / STICK_RANGE,
      homeDist,
      slant: homeDist === null || alt === null ? null : Math.hypot(homeDist, alt),
      dist: r.gpsValid ? travelled : null,
      vspeed: 0
    };
  });

  const win = 2;
  const withAlt = samples.filter(s => s.alt !== null);
  let lo = 0;
  let hi = 0;
  for (const s of samples) {
    while (lo < withAlt.length - 1 && s.t - withAlt[lo].t > win) lo++;
    if (hi < lo) hi = lo;
    while (hi < withAlt.length - 1 && withAlt[hi + 1].t - s.t <= win) hi++;
    const dt = withAlt.length ? withAlt[hi].t - withAlt[lo].t : 0;
    s.vspeed = dt > 0 ? (withAlt[hi].alt - withAlt[lo].alt) / dt : 0;
  }

  return {
    fileName,
    label: makeLabel(fileName, rows[0].ts),
    startTs: t0,
    duration: samples[samples.length - 1].t,
    cells,
    home,
    launchAlt,
    columns: present,
    hasGps: true,
    hasAlt,
    hasVolt: index.volt !== undefined,
    hasLink: index.rqly !== undefined || index.rss1 !== undefined,
    hasCurrent: samples.some(s => s.curr !== null && s.curr > 0),
    hasSticks: ['thr', 'rud', 'ele', 'ail'].every(k => index[k] !== undefined),
    samples
  };
}

function makeLabel(fileName, ts) {
  const base = fileName.replace(/\.[^.]+$/, '');
  const model = base.split(/[-_ ]/)[0] || 'Log';
  const d = new Date(ts);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${model} ${hh}:${mm}`;
}
