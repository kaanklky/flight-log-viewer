import { LinkChart } from './charts.js';
import { formatDuration } from './analysis.js';

function esc(v) {
  return String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function card(label, value, unit) {
  return `<div class="stat"><span>${label}</span><b>${value}${unit ? `<small> ${unit}</small>` : ''}</b></div>`;
}

function row(label, value) {
  return `<div class="kv"><span>${label}</span><b>${value}</b></div>`;
}

function fmt(v, d = 0) {
  return v === null || v === undefined ? 'n/a' : v.toFixed(d);
}

export class Summary {
  constructor(root, hooks) {
    this.root = root;
    this.hooks = hooks;
    this.linkChart = null;
  }

  render(log, analysis) {
    const st = analysis.stats;
    const cards = [
      card('Duration', formatDuration(st.duration)),
      card('Max alt', fmt(st.maxAlt, 0), 'm'),
      card('Max speed', fmt(st.maxSpeed, 0), 'km/h'),
      card('Distance', (st.distance / 1000).toFixed(2), 'km'),
      card('From home', fmt(st.maxHome, 0), 'm'),
      card('Max climb', fmt(st.maxClimb, 1), 'm/s'),
      card('Max sink', fmt(st.maxSink, 1), 'm/s'),
      card('Min voltage', st.minVolt === null ? 'n/a' : st.minVolt.toFixed(1), 'V'),
      card('Min RSSI', fmt(st.minRssi, 0), 'dB'),
      card('Min link', fmt(st.minRqly, 0), '%')
    ].join('');
    const blocks = analysis.insights.map((ins, i) => this.block(ins, i, log)).join('');
    this.root.innerHTML = `<div class="stats">${cards}</div>${blocks}`;
    this.bind(analysis);
    const canvas = this.root.querySelector('canvas[data-link]');
    if (canvas) {
      this.linkChart = new LinkChart(canvas);
      const ins = analysis.insights.find(i => i.kind === 'link');
      this.linkChart.setData(ins.data.bins);
    } else {
      this.linkChart = null;
    }
  }

  block(ins, i, log) {
    const level = ins.level === 'warn' ? 'WARNING' : 'INFO';
    const head = `<header><em class="${ins.level}">${level}</em><h3>${esc(ins.title)}</h3></header><p>${esc(ins.body)}</p>`;
    let extra = '';
    const d = ins.data;
    if (ins.kind === 'cutoff') {
      extra = `
        <div class="last-pos">
          <h4>Last known position</h4>
          <p>${Math.round(d.homeDist)} m from launch &middot; bearing ${Math.round(d.bearing)}&deg; &middot; altitude ${Math.round(d.alt)} m</p>
          <div class="btns">
            <button type="button" data-copy="${d.lat.toFixed(6)}, ${d.lon.toFixed(6)}">Copy coordinates</button>
            <a href="https://www.google.com/maps?q=${d.lat.toFixed(6)},${d.lon.toFixed(6)}" target="_blank" rel="noopener noreferrer">Open in Google Maps</a>
          </div>
          <small>Shown locally only. Never leaves this page.</small>
        </div>
        ${row('Altitude at cutoff', `${Math.round(d.alt)} m`)}
        ${row('Ground speed at cutoff', `${Math.round(d.speed)} km/h`)}
        <div class="btns"><button type="button" data-seek="${d.t}">Jump to ${formatDuration(d.t)}</button></div>`;
    } else if (ins.kind === 'link') {
      extra = `
        <div class="link-wrap"><canvas data-link class="link-canvas"></canvas></div>
        <div class="legend-inline"><span><i style="background:var(--series-1)"></i>Worst (min)</span><span><i style="background:var(--series-2)"></i>Average</span><span class="muted">slant distance from launch</span></div>
        ${row('Flight max slant range', `${Math.round(d.maxSlant)} m`)}
        ${row('Worst link at far edge', d.farMin === null ? 'n/a' : `${Math.round(d.farMin)}%`)}
        ${row('Link drop events', d.runs)}`;
    } else if (ins.kind === 'battery') {
      extra = `
        ${row('Duration', formatDuration(d.duration))}
        ${row('Average current', d.avgCurrent === null ? 'n/a (no current sensor)' : `${d.avgCurrent.toFixed(1)} A`)}
        ${row('Landing voltage / cell', d.landing === null ? 'n/a' : `${d.landing.toFixed(2)} V`)}
        ${row('Lowest voltage / cell', d.minVcell === null ? 'n/a' : `${d.minVcell.toFixed(2)} V`)}
        ${row('Cells (estimated)', `${d.cells}S`)}
        ${d.used === null ? '' : row('Capacity used', `${Math.round(d.used)} mAh`)}`;
    } else if (ins.kind === 'rates') {
      extra = `${row('Log interval', `${d.logInterval.toFixed(1)} s`)}${d.rows.map(r => row(r.label, r.hz > 0 ? `${r.hz.toFixed(2)} Hz (every ${(1 / r.hz).toFixed(1)} s)` : 'no changes')).join('')}`;
    } else if (ins.kind === 'coverage') {
      extra = `${row('Checks run', d.ran)}${row('Checks skipped', d.skipped.length)}<ul class="skipped">${d.skipped.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`;
    }
    return `<section class="insight" data-i="${i}">${head}${extra}</section>`;
  }

  bind() {
    this.root.querySelectorAll('[data-seek]').forEach(b => b.addEventListener('click', () => this.hooks.seek(Number(b.dataset.seek))));
    this.root.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(b.dataset.copy);
        b.textContent = 'Copied';
      } catch (err) {
        b.textContent = b.dataset.copy;
      }
    }));
  }

  redraw() {
    if (this.linkChart) this.linkChart.draw();
  }
}
