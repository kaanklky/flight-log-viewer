import { compassLetter, clamp } from './geo.js';

const SPARK_WINDOW = 30;

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function fit(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

function drawSpark(canvas, samples, t, get, color) {
  const { ctx, w, h } = fit(canvas);
  if (w === 0) return;
  const from = t - SPARK_WINDOW;
  const pts = samples.filter(s => s.t >= from - 1 && s.t <= t + 1);
  if (pts.length < 2) return;
  const vals = pts.map(get);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (hi - lo < 1) {
    hi += 0.5;
    lo -= 0.5;
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  pts.forEach((s, i) => {
    const x = ((s.t - from) / SPARK_WINDOW) * w;
    const y = h - 2 - ((get(s) - lo) / (hi - lo)) * (h - 4);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function drawGimbal(canvas, x, y) {
  const { ctx, w, h } = fit(canvas);
  if (w === 0) return;
  ctx.strokeStyle = cssVar('--grid');
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  ctx.beginPath();
  ctx.moveTo(w / 2, 0);
  ctx.lineTo(w / 2, h);
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();
  const px = w / 2 + clamp(x, -1, 1) * (w / 2 - 5);
  const py = h / 2 - clamp(y, -1, 1) * (h / 2 - 5);
  ctx.fillStyle = cssVar('--surface-1');
  ctx.beginPath();
  ctx.arc(px, py, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = cssVar('--series-1');
  ctx.beginPath();
  ctx.arc(px, py, 4, 0, Math.PI * 2);
  ctx.fill();
}

export class Hud {
  constructor(root) {
    this.root = root;
    this.log = null;
    this.state = null;
    const q = id => root.querySelector(id);
    this.el = {
      cells: q('[data-k="cells"]'),
      vcell: q('[data-k="vcell"]'),
      pack: q('[data-k="pack"]'),
      bar: q('[data-k="bar"]'),
      alt: q('[data-k="alt"]'),
      vs: q('[data-k="vs"]'),
      altSpark: q('[data-k="altSpark"]'),
      spd: q('[data-k="spd"]'),
      spdSpark: q('[data-k="spdSpark"]'),
      hdg: q('[data-k="hdg"]'),
      hdgLetter: q('[data-k="hdgLetter"]'),
      home: q('[data-k="home"]'),
      homeArrow: q('[data-k="homeArrow"]'),
      lq: q('[data-k="lq"]'),
      rssi: q('[data-k="rssi"]'),
      sats: q('[data-k="sats"]'),
      gimL: q('[data-k="gimL"]'),
      gimR: q('[data-k="gimR"]'),
      sT: q('[data-k="sT"]'),
      sY: q('[data-k="sY"]'),
      sP: q('[data-k="sP"]'),
      sR: q('[data-k="sR"]')
    };
  }

  setLog(log) {
    this.log = log;
    this.el.cells.textContent = `BATT · ${log.cells}S LIPO`;
    this.root.classList.toggle('no-sticks', !log.hasSticks);
    this.root.classList.toggle('no-link', !log.hasLink);
  }

  redraw() {
    if (this.state) this.update(this.state);
  }

  update(s) {
    this.state = s;
    const e = this.el;
    if (s.vcell !== null) {
      e.vcell.textContent = s.vcell.toFixed(2);
      e.pack.textContent = `${s.volt.toFixed(1)}V`;
      const f = clamp((s.vcell - 3.3) / (4.2 - 3.3), 0, 1);
      e.bar.style.setProperty('--fill', `${Math.round(f * 100)}%`);
      e.vcell.dataset.level = s.vcell < 3.5 ? 'crit' : s.vcell < 3.7 ? 'warn' : 'ok';
      e.bar.dataset.level = e.vcell.dataset.level;
    } else {
      e.vcell.textContent = '--';
      e.pack.textContent = '';
    }
    e.alt.textContent = s.alt.toFixed(1);
    e.vs.textContent = `${s.vspeed >= 0 ? '+' : ''}${s.vspeed.toFixed(1)} m/s`;
    e.spd.textContent = s.speed.toFixed(1);
    e.hdg.textContent = `${Math.round(s.heading) % 360}°`;
    e.hdgLetter.textContent = compassLetter(s.heading);
    e.home.textContent = Math.round(s.homeDist);
    e.sats.textContent = s.sats === null ? '' : `${Math.round(s.sats)} sats`;
    if (s.rqly !== null) e.lq.textContent = `${Math.round(s.rqly)}`;
    else e.lq.textContent = '--';
    const rs = [s.rss1, s.rss2].filter(v => v !== null);
    e.rssi.textContent = rs.length ? `${Math.round(Math.max(...rs))} dB` : '';
    const dx = this.log.home.lon - s.lon;
    const dy = this.log.home.lat - s.lat;
    const toHome = (Math.atan2(dx * Math.cos((s.lat * Math.PI) / 180), dy) * 180) / Math.PI;
    e.homeArrow.style.transform = `rotate(${toHome - s.heading}deg)`;
    const samples = this.log.samples;
    drawSpark(e.altSpark, samples, s.t, x => x.alt, cssVar('--series-1'));
    drawSpark(e.spdSpark, samples, s.t, x => x.speed, cssVar('--series-2'));
    e.sT.textContent = Math.round(s.thr * 100);
    e.sY.textContent = Math.round(s.rud * 100);
    e.sP.textContent = Math.round(s.ele * 100);
    e.sR.textContent = Math.round(s.ail * 100);
    drawGimbal(e.gimL, s.rud, s.thr);
    drawGimbal(e.gimR, s.ail, s.ele);
  }
}
