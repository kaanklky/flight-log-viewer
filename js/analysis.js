import { bearing } from './geo.js';

const LINK_LOW_RQLY = 70;
const LINK_BIN_METERS = 50;
const MID_AIR_ALT = 5;
const MID_AIR_SPEED = 10;

function finite(v) {
  return v === null || v === undefined ? -Infinity : v;
}

function argMax(samples, fn) {
  let best = 0;
  for (let i = 1; i < samples.length; i++) if (fn(samples[i]) > fn(samples[best])) best = i;
  return best;
}

function argMin(samples, fn) {
  return argMax(samples, s => -fn(s));
}

function linkRuns(samples) {
  const runs = [];
  let start = null;
  for (let i = 0; i < samples.length; i++) {
    const low = samples[i].rqly !== null && samples[i].rqly < LINK_LOW_RQLY;
    if (low && start === null) start = i;
    if (!low && start !== null) {
      runs.push({ from: samples[start].t, to: samples[i - 1].t });
      start = null;
    }
  }
  if (start !== null) runs.push({ from: samples[start].t, to: samples[samples.length - 1].t });
  return runs;
}

function linkBins(samples) {
  const bins = new Map();
  for (const s of samples) {
    const q = s.rqly;
    if (q === null || s.slant === null) continue;
    const key = Math.floor(s.slant / LINK_BIN_METERS) * LINK_BIN_METERS;
    if (!bins.has(key)) bins.set(key, { from: key, min: q, sum: 0, count: 0 });
    const b = bins.get(key);
    b.min = Math.min(b.min, q);
    b.sum += q;
    b.count += 1;
  }
  return [...bins.values()].sort((a, b) => a.from - b.from).map(b => ({ from: b.from, min: b.min, avg: b.sum / b.count, count: b.count }));
}

function formatDuration(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function changeRate(samples, get) {
  let changes = 0;
  for (let i = 1; i < samples.length; i++) if (get(samples[i]) !== get(samples[i - 1])) changes++;
  const span = samples[samples.length - 1].t - samples[0].t;
  return span > 0 ? changes / span : 0;
}

function medianInterval(samples) {
  const d = [];
  for (let i = 1; i < samples.length; i++) d.push(samples[i].t - samples[i - 1].t);
  d.sort((a, b) => a - b);
  return d[Math.floor(d.length / 2)] || 1;
}

export function analyze(log) {
  const s = log.samples;
  const last = s[s.length - 1];
  const lastFix = [...s].reverse().find(x => x.gpsValid);
  const iAlt = argMax(s, x => finite(x.alt));
  const iSpeed = argMax(s, x => finite(x.speed));
  const iFar = argMax(s, x => finite(x.homeDist));
  const iClimb = argMax(s, x => x.vspeed);
  const iSink = argMin(s, x => x.vspeed);
  const withVolt = s.filter(x => x.volt !== null);
  const iVolt = withVolt.length ? argMin(s.map(x => ({ ...x, volt: x.volt === null ? Infinity : x.volt })), x => x.volt) : -1;
  const rssiValues = s.flatMap(x => [x.rss1, x.rss2]).filter(v => v !== null);
  const rqlyValues = s.map(x => x.rqly).filter(v => v !== null);

  const stats = {
    duration: log.duration,
    maxAlt: finite(s[iAlt].alt) === -Infinity ? 0 : s[iAlt].alt,
    maxSpeed: finite(s[iSpeed].speed) === -Infinity ? 0 : s[iSpeed].speed,
    distance: lastFix.dist,
    maxHome: finite(s[iFar].homeDist) === -Infinity ? 0 : s[iFar].homeDist,
    maxClimb: Math.max(0, s[iClimb].vspeed),
    maxSink: Math.max(0, -s[iSink].vspeed),
    minVolt: iVolt >= 0 ? s[iVolt].volt : null,
    minVcell: iVolt >= 0 ? s[iVolt].vcell : null,
    minRssi: rssiValues.length ? Math.min(...rssiValues) : null,
    minRqly: rqlyValues.length ? Math.min(...rqlyValues) : null
  };

  const launchIdx = s.findIndex(x => finite(x.speed) > MID_AIR_SPEED);
  const midAir = finite(lastFix.alt) - (log.launchAlt || 0) > MID_AIR_ALT || finite(lastFix.speed) > MID_AIR_SPEED;
  const runs = linkRuns(s);

  const events = [];
  if (launchIdx >= 0) events.push({ t: s[launchIdx].t, type: 'launch', label: 'Launch', desc: `Ground speed first rose above ${MID_AIR_SPEED} km/h.` });
  events.push({ t: s[iAlt].t, type: 'highest', label: `Highest ${Math.round(stats.maxAlt)} m`, desc: `Highest point of the flight, ${stats.maxAlt.toFixed(1)} m above the launch altitude.` });
  events.push({ t: s[iSpeed].t, type: 'fastest', label: `Fastest ${Math.round(stats.maxSpeed)} km/h`, desc: `Top ground speed of the flight, ${stats.maxSpeed.toFixed(1)} km/h.` });
  events.push({ t: s[iFar].t, type: 'farthest', label: `Farthest ${Math.round(stats.maxHome)} m`, desc: `Farthest distance from the home point, ${Math.round(stats.maxHome)} m.` });
  if (iVolt >= 0) events.push({ t: s[iVolt].t, type: 'lowvolt', label: `Lowest battery ${stats.minVolt.toFixed(1)} V`, desc: `Lowest battery voltage of the flight, ${stats.minVolt.toFixed(1)} V (${stats.minVcell.toFixed(2)} V per cell).` });
  for (const r of runs) events.push({ t: r.from, type: 'linkdrop', label: 'Link quality drop', desc: `Link quality fell below ${LINK_LOW_RQLY}% for ${Math.max(1, Math.round(r.to - r.from + 1))} s.` });
  events.push({
    t: last.t,
    type: midAir ? 'cutoff' : 'landing',
    label: midAir ? 'Recording ends' : 'Landing',
    desc: midAir ? 'The log stops while the aircraft is still flying. There is no landing in the data.' : 'The log ends with the aircraft on the ground.'
  });
  events.sort((a, b) => a.t - b.t);

  const insights = [];
  const skipped = [];
  let ran = 0;

  if (midAir) {
    ran++;
    const dir = bearing(log.home.lat, log.home.lon, lastFix.lat, lastFix.lon);
    const altNow = lastFix.alt === null ? 0 : lastFix.alt;
    const speedNow = lastFix.speed === null ? 0 : lastFix.speed;
    insights.push({
      kind: 'cutoff',
      level: 'warn',
      title: 'Recording ends mid-air',
      body: `The log stops at ${Math.round(altNow)} m altitude doing ${Math.round(speedNow)} km/h. There is no landing in the data.`,
      data: {
        homeDist: lastFix.homeDist,
        bearing: dir,
        alt: altNow,
        speed: speedNow,
        lat: lastFix.lat,
        lon: lastFix.lon,
        t: Math.max(0, last.t - 5)
      }
    });
  } else {
    ran++;
  }

  if (log.hasLink) {
    ran++;
    const bins = linkBins(s);
    const far = bins.length ? bins[bins.length - 1] : null;
    insights.push({
      kind: 'link',
      level: stats.minRqly !== null && stats.minRqly < LINK_LOW_RQLY ? 'warn' : 'info',
      title: 'Link health vs distance',
      body: far
        ? `Worst link quality near the far edge (${Math.round(stats.maxHome)} m from launch) was ${Math.round(far.min)}%. The chart shows the worst and average reading in each ${LINK_BIN_METERS} m distance band.`
        : 'No link quality data in this log.',
      data: { bins, maxSlant: Math.max(...s.map(x => finite(x.slant))), farMin: far ? far.min : null, runs: runs.length }
    });
  } else {
    skipped.push('Link health (no link columns)');
  }

  if (log.hasVolt) {
    ran++;
    const tail = s.slice(-3).filter(x => x.vcell !== null);
    const landing = tail.length ? tail.reduce((a, x) => a + x.vcell, 0) / tail.length : null;
    const used = last.capa !== null && last.capa > 0 ? last.capa : null;
    const currents = s.map(x => x.curr).filter(v => v !== null && v > 0);
    insights.push({
      kind: 'battery',
      level: landing !== null && landing < 3.5 ? 'warn' : 'info',
      title: 'Battery summary',
      body: landing !== null ? `${formatDuration(log.duration)} flight, ${midAir ? 'ended' : 'landed'} at ${landing.toFixed(2)} V/cell.` : 'No battery voltage data.',
      data: {
        duration: log.duration,
        avgCurrent: currents.length ? currents.reduce((a, v) => a + v, 0) / currents.length : null,
        landing,
        minVcell: stats.minVcell,
        cells: log.cells,
        used
      }
    });
  } else {
    skipped.push('Battery (no voltage column)');
  }

  const logInterval = medianInterval(s);
  const gpsRate = changeRate(s, x => `${x.lat},${x.lon}`);
  const rateRows = [
    { label: 'GPS position and speed', hz: gpsRate },
    { label: 'Altitude', hz: changeRate(s, x => x.altRaw) },
    { label: 'Battery voltage', hz: changeRate(s, x => x.volt) },
    { label: 'Link quality', hz: changeRate(s, x => x.rqly) },
    { label: 'RSSI', hz: changeRate(s, x => `${x.rss1},${x.rss2}`) },
    { label: 'Stick positions', hz: changeRate(s, x => `${x.thr},${x.rud},${x.ele},${x.ail}`) }
  ];
  ran++;
  insights.push({
    kind: 'rates',
    level: gpsRate > 0 && 1 / gpsRate > 2 * logInterval ? 'warn' : 'info',
    title: 'Telemetry update rates',
    body: gpsRate > 0
      ? `The radio wrote one row every ${logInterval.toFixed(1)} s, but the GPS position only refreshed every ${(1 / gpsRate).toFixed(1)} s. Between refreshes the log repeats the old value. Playback interpolates smoothly between real fixes.`
      : 'No GPS position changes found.',
    data: { logInterval, rows: rateRows }
  });

  if (!log.hasCurrent) skipped.push('Current draw and power (no current sensor)');
  skipped.push('Attitude (no pitch or roll in EdgeTX CSV)');
  skipped.push('Power-loss signatures (needs blackbox)');

  insights.push({
    kind: 'coverage',
    level: 'info',
    title: 'About coverage',
    body: 'Radio logs carry link, GPS, altitude and battery telemetry plus stick positions at 1 Hz. For electrical forensics or attitude analysis, enable blackbox logging on the flight controller.',
    data: { ran, skipped }
  });

  return { stats, events, insights, linkRuns: runs, indexes: { alt: iAlt, speed: iSpeed, far: iFar, volt: iVolt } };
}

export { formatDuration };
