const SERIES_VARS = ['--series-1', '--series-2', '--series-3', '--series-4'];

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function niceStep(range, ticks) {
  const raw = range / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const nice = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return nice * mag;
}

function formatClock(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export class TimeChart {
  constructor(host, options) {
    this.options = options;
    this.samples = [];
    this.duration = 1;
    this.time = 0;
    this.hoverT = null;
    this.dragging = false;
    this.box = document.createElement('section');
    this.box.className = 'chart';
    const head = document.createElement('div');
    head.className = 'chart-head';
    const title = document.createElement('h3');
    title.textContent = options.title;
    head.appendChild(title);
    if (options.series.length > 1) {
      const legend = document.createElement('div');
      legend.className = 'chart-legend';
      options.series.forEach((s, i) => {
        const item = document.createElement('span');
        const dot = document.createElement('i');
        dot.style.background = `var(${SERIES_VARS[i]})`;
        item.appendChild(dot);
        item.appendChild(document.createTextNode(s.label));
        legend.appendChild(item);
      });
      head.appendChild(legend);
    }
    this.box.appendChild(head);
    this.canvas = document.createElement('canvas');
    this.box.appendChild(this.canvas);
    this.tip = document.createElement('div');
    this.tip.className = 'chart-tip';
    this.tip.hidden = true;
    this.box.appendChild(this.tip);
    host.appendChild(this.box);
    this.ctx = this.canvas.getContext('2d');
    this.canvas.addEventListener('pointerdown', e => this.onDown(e));
    this.canvas.addEventListener('pointermove', e => this.onMove(e));
    this.canvas.addEventListener('pointerup', e => this.onUp(e));
    this.canvas.addEventListener('pointerleave', () => this.onLeave());
    this.resizer = new ResizeObserver(() => this.draw());
    this.resizer.observe(this.canvas);
  }

  setData(samples, duration) {
    this.samples = samples;
    this.duration = Math.max(duration, 1);
    this.computeRange();
    this.draw();
  }

  setTime(t) {
    this.time = t;
    this.draw();
  }

  destroy() {
    this.resizer.disconnect();
    this.box.remove();
  }

  computeRange() {
    const o = this.options;
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of this.samples) {
      for (const ser of o.series) {
        const v = ser.get(s);
        if (v === null || v === undefined || !Number.isFinite(v)) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    if (!Number.isFinite(lo)) {
      lo = 0;
      hi = 1;
    }
    if (o.min !== undefined) lo = o.min;
    if (o.max !== undefined) hi = o.max;
    if (hi - lo < 1e-9) {
      hi += 1;
      lo -= 1;
    }
    const step = o.step || niceStep(hi - lo, 4);
    this.range = {
      lo: o.min !== undefined ? lo : Math.floor(lo / step) * step,
      hi: o.max !== undefined ? hi : Math.ceil(hi / step) * step,
      step
    };
  }

  layout() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    return { w, h, left: 40, right: 10, top: 6, bottom: 20 };
  }

  xOf(t, L) {
    return L.left + (t / this.duration) * (L.w - L.left - L.right);
  }

  yOf(v, L) {
    const { lo, hi } = this.range;
    return L.top + (1 - (v - lo) / (hi - lo)) * (L.h - L.top - L.bottom);
  }

  draw() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0 || !this.range) return;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const L = this.layout();
    const grid = cssVar('--grid');
    const muted = cssVar('--text-muted');
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    ctx.lineWidth = 1;
    const { lo, hi, step } = this.range;
    for (let v = lo; v <= hi + step / 2; v += step) {
      const y = Math.round(this.yOf(v, L)) + 0.5;
      ctx.strokeStyle = grid;
      ctx.beginPath();
      ctx.moveTo(L.left, y);
      ctx.lineTo(w - L.right, y);
      ctx.stroke();
      ctx.fillStyle = muted;
      const label = Math.abs(step) < 1 ? v.toFixed(1) : String(Math.round(v));
      ctx.fillText(label, L.left - 6, y);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const tickStep = niceStep(this.duration, Math.max(2, Math.floor((w - L.left - L.right) / 70)));
    for (let t = 0; t <= this.duration + 1e-6; t += tickStep) {
      const x = this.xOf(t, L);
      ctx.fillStyle = muted;
      ctx.fillText(formatClock(t), Math.min(w - 12, Math.max(L.left, x)), h - L.bottom + 6);
    }
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = 2;
    this.options.series.forEach((ser, i) => {
      ctx.strokeStyle = cssVar(SERIES_VARS[i]);
      ctx.beginPath();
      let pen = false;
      let prev = null;
      for (const s of this.samples) {
        const v = ser.get(s);
        if (v === null || v === undefined || !Number.isFinite(v)) {
          pen = false;
          continue;
        }
        if (this.options.wrap && prev !== null && Math.abs(v - prev) > this.options.wrap / 2) pen = false;
        prev = v;
        const x = this.xOf(s.t, L);
        const y = this.yOf(v, L);
        if (!pen) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        pen = true;
      }
      ctx.stroke();
    });
    const cursor = cssVar('--text-secondary');
    ctx.lineWidth = 1;
    ctx.strokeStyle = cursor;
    ctx.setLineDash([3, 3]);
    const px = Math.round(this.xOf(this.time, L)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(px, L.top);
    ctx.lineTo(px, h - L.bottom);
    ctx.stroke();
    ctx.setLineDash([]);
    if (this.hoverT !== null) {
      const hx = Math.round(this.xOf(this.hoverT, L)) + 0.5;
      ctx.strokeStyle = muted;
      ctx.beginPath();
      ctx.moveTo(hx, L.top);
      ctx.lineTo(hx, h - L.bottom);
      ctx.stroke();
      const s = this.nearest(this.hoverT);
      const surface = cssVar('--surface-1');
      this.options.series.forEach((ser, i) => {
        const v = ser.get(s);
        if (v === null || v === undefined || !Number.isFinite(v)) return;
        const x = this.xOf(s.t, L);
        const y = this.yOf(v, L);
        ctx.fillStyle = surface;
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = cssVar(SERIES_VARS[i]);
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  }

  nearest(t) {
    const a = this.samples;
    let lo = 0;
    let hi = a.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (a[mid].t < t) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0 && Math.abs(a[lo - 1].t - t) < Math.abs(a[lo].t - t)) lo--;
    return a[lo];
  }

  timeAt(e) {
    const rect = this.canvas.getBoundingClientRect();
    const L = this.layout();
    const x = e.clientX - rect.left;
    const f = (x - L.left) / (L.w - L.left - L.right);
    return Math.min(this.duration, Math.max(0, f * this.duration));
  }

  onDown(e) {
    this.dragging = true;
    this.canvas.setPointerCapture(e.pointerId);
    if (this.options.onSeek) this.options.onSeek(this.timeAt(e));
  }

  onUp(e) {
    this.dragging = false;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
  }

  onLeave() {
    if (this.dragging) return;
    this.hoverT = null;
    this.tip.hidden = true;
    this.draw();
  }

  onMove(e) {
    const t = this.timeAt(e);
    if (this.dragging) {
      if (this.options.onSeek) this.options.onSeek(t);
      return;
    }
    this.hoverT = t;
    const s = this.nearest(t);
    const rows = this.options.series.map((ser, i) => {
      const v = ser.get(s);
      const txt = v === null || v === undefined || !Number.isFinite(v) ? 'n/a' : `${v.toFixed(ser.digits === undefined ? 1 : ser.digits)}${ser.unit || ''}`;
      return `<div><i style="background:var(${SERIES_VARS[i]})"></i><span>${ser.label}</span><b>${txt}</b></div>`;
    });
    this.tip.innerHTML = `<div class="tip-time">${formatClock(s.t)}</div>${rows.join('')}`;
    this.tip.hidden = false;
    const rect = this.canvas.getBoundingClientRect();
    const host = this.box.getBoundingClientRect();
    const x = e.clientX - host.left;
    const flip = x > host.width * 0.6;
    this.tip.style.left = flip ? 'auto' : `${x + 12}px`;
    this.tip.style.right = flip ? `${host.width - x + 12}px` : 'auto';
    this.tip.style.top = `${rect.top - host.top + 8}px`;
    this.draw();
  }
}

export class LinkChart {
  constructor(canvas) {
    this.canvas = canvas;
    this.bins = [];
    this.hover = null;
    this.geom = null;
    this.tip = document.createElement('div');
    this.tip.className = 'chart-tip';
    this.tip.hidden = true;
    canvas.parentElement.appendChild(this.tip);
    this.resizer = new ResizeObserver(() => this.draw());
    this.resizer.observe(canvas);
    canvas.addEventListener('pointermove', e => this.onMove(e));
    canvas.addEventListener('pointerleave', () => {
      this.hover = null;
      this.tip.hidden = true;
      this.draw();
    });
  }

  setData(bins) {
    this.bins = bins;
    this.draw();
  }

  onMove(e) {
    if (!this.geom || !this.bins.length) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    let best = 0;
    this.bins.forEach((b, i) => {
      if (Math.abs(this.geom.xOf(b.from) - x) < Math.abs(this.geom.xOf(this.bins[best].from) - x)) best = i;
    });
    this.hover = best;
    const b = this.bins[best];
    const width = this.bins.length > 1 ? this.bins[1].from - this.bins[0].from : 50;
    this.tip.innerHTML = `<div class="tip-time">${b.from}-${b.from + width} m from launch</div>
      <div><i style="background:var(--series-1)"></i><span>Worst</span><b>${b.min.toFixed(0)}%</b></div>
      <div><i style="background:var(--series-2)"></i><span>Average</span><b>${b.avg.toFixed(1)}%</b></div>
      <div><span>Samples</span><b>${b.count}</b></div>`;
    this.tip.hidden = false;
    const flip = this.geom.xOf(b.from) > this.geom.w * 0.6;
    const px = this.geom.xOf(b.from);
    this.tip.style.left = flip ? 'auto' : `${px + 12}px`;
    this.tip.style.right = flip ? `${this.geom.w - px + 12}px` : 'auto';
    this.tip.style.top = '8px';
    this.draw();
  }

  draw() {
    const canvas = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const bins = this.bins;
    if (!bins.length) return;
    const left = 34;
    const right = 10;
    const top = 8;
    const bottom = 22;
    const lo = Math.min(...bins.map(b => b.min));
    const floor = Math.max(0, Math.min(lo, 90) - 5);
    const yOf = v => top + (1 - (v - floor) / (100 - floor)) * (h - top - bottom);
    const xs = bins.map(b => b.from);
    const x0 = xs[0];
    const x1 = xs[xs.length - 1] === x0 ? x0 + 50 : xs[xs.length - 1];
    const xOf = x => left + ((x - x0) / (x1 - x0)) * (w - left - right);
    this.geom = { xOf, w };
    const grid = cssVar('--grid');
    const muted = cssVar('--text-muted');
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.lineWidth = 1;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const step = niceStep(100 - floor, 3);
    for (let v = Math.ceil(floor / step) * step; v <= 100 + 1e-6; v += step) {
      const y = Math.round(yOf(v)) + 0.5;
      ctx.strokeStyle = grid;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(w - right, y);
      ctx.stroke();
      ctx.fillStyle = muted;
      ctx.fillText(`${Math.round(v)}%`, left - 6, y);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const b of bins) {
      ctx.fillStyle = muted;
      ctx.fillText(`${b.from} m`, xOf(b.from), h - bottom + 6);
    }
    if (this.hover !== null) {
      const hx = Math.round(xOf(bins[this.hover].from)) + 0.5;
      ctx.strokeStyle = muted;
      ctx.beginPath();
      ctx.moveTo(hx, top);
      ctx.lineTo(hx, h - bottom);
      ctx.stroke();
    }
    const surface = cssVar('--surface-1');
    const line = (key, color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      bins.forEach((b, i) => {
        const x = xOf(b.from);
        const y = yOf(b[key]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      bins.forEach((b, i) => {
        const r = i === this.hover ? 4 : 3;
        ctx.fillStyle = surface;
        ctx.beginPath();
        ctx.arc(xOf(b.from), yOf(b[key]), r + 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(xOf(b.from), yOf(b[key]), r, 0, Math.PI * 2);
        ctx.fill();
      });
    };
    line('avg', cssVar('--series-2'));
    line('min', cssVar('--series-1'));
  }
}
