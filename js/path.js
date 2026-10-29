import { toLocal, fromLocal, angleDiff } from './geo.js';

const GRAVITY = 9.81;
const MAX_ROLL = 55;
const MAX_PITCH = 40;
const MIN_TURN_SPEED = 1.5;
const TANGENT_LIMIT = 2.2;
const RAD = Math.PI / 180;

function changeKeys(samples, same) {
  const keys = [0];
  for (let i = 1; i < samples.length - 1; i++) if (!same(samples[i], samples[i - 1])) keys.push(i);
  if (samples.length > 1) keys.push(samples.length - 1);
  return keys;
}

function monotoneTangents(t, v) {
  const n = t.length;
  const m = new Array(n).fill(0);
  if (n < 2) return m;
  const h = [];
  const d = [];
  for (let k = 0; k < n - 1; k++) {
    h.push(t[k + 1] - t[k]);
    d.push((v[k + 1] - v[k]) / h[k]);
  }
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let k = 1; k < n - 1; k++) {
    if (d[k - 1] * d[k] <= 0) m[k] = 0;
    else m[k] = (h[k] * d[k - 1] + h[k - 1] * d[k]) / (h[k] + h[k - 1]);
  }
  for (let k = 0; k < n - 1; k++) {
    if (d[k] === 0) {
      m[k] = 0;
      m[k + 1] = 0;
      continue;
    }
    const a = m[k] / d[k];
    const b = m[k + 1] / d[k];
    const s = a * a + b * b;
    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      m[k] = tau * a * d[k];
      m[k + 1] = tau * b * d[k];
    }
  }
  return m;
}

function hermite(p0, p1, m0, m1, h, s) {
  const s2 = s * s;
  const s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * p0 + (s3 - 2 * s2 + s) * h * m0 + (-2 * s3 + 3 * s2) * p1 + (s3 - s2) * h * m1;
}

function findSegment(times, t) {
  let lo = 0;
  let hi = times.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid;
  }
  return lo;
}

class Series {
  constructor(all, get, options = {}) {
    const samples = all.filter(s => get(s) !== null && get(s) !== undefined);
    if (!samples.length) samples.push({ t: 0, zero: 0 });
    const read = samples[0].zero === 0 ? () => 0 : get;
    const same = options.every ? () => false : (a, b) => read(a) === read(b);
    const idx = changeKeys(samples, same);
    this.t = idx.map(i => samples[i].t);
    let v = idx.map(i => read(samples[i]));
    this.circular = Boolean(options.circular);
    if (this.circular) {
      const un = [v[0]];
      for (let k = 1; k < v.length; k++) un.push(un[k - 1] + angleDiff(un[k - 1], v[k]));
      v = un;
    }
    this.v = v;
    this.linear = Boolean(options.linear);
    this.m = this.linear ? null : monotoneTangents(this.t, v);
  }

  at(t) {
    const n = this.t.length;
    let r;
    if (n === 1 || t <= this.t[0]) r = this.v[0];
    else if (t >= this.t[n - 1]) r = this.v[n - 1];
    else {
      const k = findSegment(this.t, t);
      const h = this.t[k + 1] - this.t[k];
      const s = (t - this.t[k]) / h;
      if (this.linear) r = this.v[k] + (this.v[k + 1] - this.v[k]) * s;
      else r = hermite(this.v[k], this.v[k + 1], this.m[k], this.m[k + 1], h, s);
    }
    return this.circular ? ((r % 360) + 360) % 360 : r;
  }
}

class Route {
  constructor(all, home) {
    const samples = all.filter(s => s.gpsValid);
    const idx = changeKeys(samples, (a, b) => a.lat === b.lat && a.lon === b.lon);
    this.t = [];
    this.e = [];
    this.n = [];
    this.ve = [];
    this.vn = [];
    for (const i of idx) {
      const s = samples[i];
      const p = toLocal(s.lat, s.lon, home.lat, home.lon);
      this.t.push(s.t);
      this.e.push(p.east);
      this.n.push(p.north);
      const v = (s.speed === null ? 0 : s.speed) / 3.6;
      const h = (s.heading === null ? 0 : s.heading) * RAD;
      this.ve.push(v * Math.sin(h));
      this.vn.push(v * Math.cos(h));
    }
    this.fixTangents();
  }

  fixTangents() {
    const k = this.t.length;
    for (let i = 0; i < k; i++) {
      const prev = i > 0 ? i - 1 : null;
      const next = i < k - 1 ? i + 1 : null;
      const chord = this.chordVelocity(prev !== null ? prev : i, next !== null ? next : i);
      const speed = Math.hypot(this.ve[i], this.vn[i]);
      const cs = Math.hypot(chord.e, chord.n);
      if (speed < MIN_TURN_SPEED || cs < 0.01) {
        this.ve[i] = chord.e;
        this.vn[i] = chord.n;
        continue;
      }
      const dot = (this.ve[i] * chord.e + this.vn[i] * chord.n) / (speed * cs);
      if (dot < -0.17) {
        this.ve[i] = chord.e;
        this.vn[i] = chord.n;
      } else if (speed > cs * TANGENT_LIMIT) {
        const f = (cs * TANGENT_LIMIT) / speed;
        this.ve[i] *= f;
        this.vn[i] *= f;
      }
    }
  }

  chordVelocity(a, b) {
    if (a === b) return { e: 0, n: 0 };
    const h = this.t[b] - this.t[a];
    return { e: (this.e[b] - this.e[a]) / h, n: (this.n[b] - this.n[a]) / h };
  }

  at(t) {
    const k = this.t.length;
    if (k === 1 || t <= this.t[0]) return { e: this.e[0], n: this.n[0] };
    if (t >= this.t[k - 1]) return { e: this.e[k - 1], n: this.n[k - 1] };
    const i = findSegment(this.t, t);
    const h = this.t[i + 1] - this.t[i];
    const s = (t - this.t[i]) / h;
    return {
      e: hermite(this.e[i], this.e[i + 1], this.ve[i], this.ve[i + 1], h, s),
      n: hermite(this.n[i], this.n[i + 1], this.vn[i], this.vn[i + 1], h, s)
    };
  }
}

export function buildPath(log) {
  const samples = log.samples;
  const home = log.home;
  const route = new Route(samples, home);
  const alt = new Series(samples, s => s.alt);
  const speed = new Series(samples, s => s.speed);
  const heading = new Series(samples, s => s.heading, { circular: true });
  const dist = new Series(samples, s => s.dist);
  const volt = new Series(samples, s => s.volt);
  const linearFields = ['rss1', 'rss2', 'rqly', 'rsnr', 'thr', 'rud', 'ele', 'ail', 'sats', 'curr', 'capa'];
  const linear = {};
  for (const k of linearFields) linear[k] = new Series(samples, s => s[k], { linear: true, every: true });
  const hasVolt = samples.some(s => s.volt !== null);
  const nulls = {};
  for (const k of linearFields) nulls[k] = samples.every(s => s[k] === null);
  const duration = log.duration;
  const lastIndexAt = t => {
    let lo = 0;
    let hi = samples.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (samples[mid].t <= t) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  function course(t) {
    const a = route.at(t - 0.15);
    const b = route.at(t + 0.15);
    const de = b.e - a.e;
    const dn = b.n - a.n;
    const sp = Math.hypot(de, dn) / 0.3;
    return { heading: ((Math.atan2(de, dn) / RAD) + 360) % 360, speed: sp };
  }

  function at(tIn) {
    const t = Math.min(duration, Math.max(0, tIn));
    const p = route.at(t);
    const ll = fromLocal(p.e, p.n, home.lat, home.lon);
    const a = alt.at(t);
    const vs = (alt.at(Math.min(duration, t + 0.5)) - alt.at(Math.max(0, t - 0.5))) / (Math.min(duration, t + 0.5) - Math.max(0, t - 0.5) || 1);
    const c0 = course(t);
    const ca = course(Math.max(0, t - 0.6));
    const cb = course(Math.min(duration, t + 0.6));
    const span = Math.min(duration, t + 0.6) - Math.max(0, t - 0.6);
    const yawRate = span > 0 ? angleDiff(ca.heading, cb.heading) / span : 0;
    let roll = 0;
    let pitch = 0;
    let pathHeading = heading.at(t);
    if (c0.speed >= MIN_TURN_SPEED) {
      pathHeading = c0.heading;
      roll = Math.atan((c0.speed * yawRate * RAD) / GRAVITY) / RAD;
      roll = Math.max(-MAX_ROLL, Math.min(MAX_ROLL, roll));
      pitch = Math.atan2(vs, c0.speed) / RAD;
      pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch));
    }
    const i = lastIndexAt(t);
    const cells = log.cells;
    const v = hasVolt ? volt.at(t) : null;
    const out = {
      t,
      index: i,
      east: p.e,
      north: p.n,
      lat: ll.lat,
      lon: ll.lon,
      alt: a,
      vspeed: vs,
      speed: speed.at(t),
      heading: heading.at(t),
      pathHeading,
      roll,
      pitch,
      volt: v,
      vcell: v === null ? null : v / cells,
      dist: dist.at(t),
      homeDist: Math.hypot(p.e, p.n),
      slant: Math.hypot(Math.hypot(p.e, p.n), a)
    };
    for (const k of linearFields) out[k] = nulls[k] ? null : linear[k].at(t);
    return out;
  }

  function track(step) {
    const n = Math.ceil(duration / step) + 1;
    const pts = [];
    for (let i = 0; i < n; i++) pts.push(at(Math.min(duration, i * step)));
    return pts;
  }

  return { at, track, duration };
}
