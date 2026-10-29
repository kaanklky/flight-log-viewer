import { parseFlightLog } from './parser.js';
import { analyze, formatDuration } from './analysis.js';
import { Player, SPEEDS } from './player.js';
import { FlightMap } from './map.js';
import { Hud } from './hud.js';
import { Summary } from './summary.js';
import { TimeChart } from './charts.js';
import { CHART_SPECS } from './chart-specs.js';
import { icon, EVENT_STYLE } from './icons.js';
import { listLogs, fetchLog } from './library.js';

const $ = id => document.getElementById(id);

const entries = [];
let active = -1;
let charts = [];
let analysis = null;

const player = new Player();
const hud = new Hud($('hud'));
const summary = new Summary($('paneSummary'), { seek: t => player.seek(t) });

const flightMap = new FlightMap($('map'), {
  onUserMove: () => setCameraMode('manual')
});

function showError(msg) {
  $('dropError').textContent = msg;
}

function setCameraMode(mode) {
  flightMap.setMode(mode);
  player.setKeepAlive(mode === 'orbit' || mode === 'cinematic');
  player.kick(1500);
  document.querySelectorAll('#camModes button').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
}

function redrawAll() {
  charts.forEach(c => c.draw());
  summary.redraw();
  hud.redraw();
}

function buildCharts(log) {
  charts.forEach(c => c.destroy());
  charts = [];
  const host = $('paneCharts');
  host.innerHTML = '';
  for (const spec of CHART_SPECS) {
    if (!spec.when(log)) continue;
    const chart = new TimeChart(host, {
      title: spec.title,
      series: spec.series,
      min: spec.min,
      max: spec.max,
      step: spec.step,
      wrap: spec.wrap,
      onSeek: t => player.seek(t)
    });
    chart.setData(log.samples, log.duration);
    charts.push(chart);
  }
}

const tlTip = $('tlTip');

function showTip(target, html) {
  tlTip.innerHTML = html;
  tlTip.hidden = false;
  const r = target.getBoundingClientRect();
  const w = tlTip.offsetWidth;
  const left = Math.min(window.innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2));
  tlTip.style.left = `${left}px`;
  tlTip.style.top = `${r.top - tlTip.offsetHeight - 10}px`;
}

function hideTip() {
  tlTip.hidden = true;
}

function attachTip(el, html) {
  el.addEventListener('pointerenter', () => showTip(el, html));
  el.addEventListener('focus', () => showTip(el, html));
  el.addEventListener('pointerleave', hideTip);
  el.addEventListener('blur', hideTip);
}

function buildTimeline(log, result) {
  const track = $('track');
  track.innerHTML = '';
  const dur = Math.max(log.duration, 1);
  const pct = t => `${(t / dur) * 100}%`;
  for (const r of result.linkRuns) {
    const el = document.createElement('div');
    el.className = 'low';
    el.style.left = pct(r.from);
    el.style.width = `${((r.to - r.from) / dur) * 100}%`;
    attachTip(el, `<b>Link quality below 70%</b><span>${formatDuration(r.from)} to ${formatDuration(r.to)}. The red part of the bar marks where the receiver reported a weak link.</span>`);
    track.appendChild(el);
  }
  for (const ev of result.events) {
    const style = EVENT_STYLE[ev.type];
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ev';
    b.style.left = pct(ev.t);
    b.style.setProperty('--ev', style.color);
    b.setAttribute('aria-label', `${ev.label} at ${formatDuration(ev.t)}`);
    b.innerHTML = icon(ev.type, 12);
    attachTip(b, `<b>${style.name} at ${formatDuration(ev.t)}</b><span>${ev.desc}</span><em>Click to jump here</em>`);
    b.addEventListener('click', () => player.seek(ev.t));
    track.appendChild(b);
  }
  const used = [...new Set(result.events.map(e => e.type))];
  $('legend').innerHTML = `<h4>Timeline markers</h4>${used.map(type => `<div><span class="ev static" style="--ev:${EVENT_STYLE[type].color}">${icon(type, 12)}</span>${EVENT_STYLE[type].name}</div>`).join('')}${result.linkRuns.length ? '<div><span class="swatch"></span>Link quality below 70%</div>' : ''}`;
  const scrub = $('scrub');
  scrub.max = String(log.duration);
  scrub.value = '0';
}

function buildBadges(result) {
  const box = $('badges');
  box.innerHTML = '';
  for (const type of ['highest', 'fastest', 'farthest']) {
    const ev = result.events.find(e => e.type === type);
    if (!ev) continue;
    const b = document.createElement('button');
    b.type = 'button';
    b.style.setProperty('--ev', EVENT_STYLE[type].color);
    b.innerHTML = `<span class="bi">${icon(type, 14)}</span>${ev.label}`;
    b.title = `${ev.desc} Click to jump there.`;
    b.addEventListener('click', () => player.seek(ev.t));
    box.appendChild(b);
  }
}

function renderChips() {
  const box = $('chips');
  box.innerHTML = '';
  entries.forEach((e, i) => {
    const chip = document.createElement('div');
    chip.className = `chip${i === active ? ' on' : ''}`;
    chip.title = e.log.fileName;
    const name = document.createElement('span');
    name.textContent = e.log.label;
    const close = document.createElement('button');
    close.type = 'button';
    close.setAttribute('aria-label', `Close ${e.log.label}`);
    close.innerHTML = '&times;';
    close.addEventListener('click', ev => {
      ev.stopPropagation();
      removeEntry(i);
    });
    chip.append(name, close);
    chip.addEventListener('click', () => activate(i));
    box.appendChild(chip);
  });
}

async function activate(i) {
  active = i;
  const { log, result } = entries[i];
  analysis = result;
  renderChips();
  $('drop').hidden = true;
  player.load(log);
  hud.setLog(log);
  summary.render(log, result);
  buildCharts(log);
  buildTimeline(log, result);
  buildBadges(result);
  await flightMap.setLog(log, player.path);
  setCameraMode('topdown');
  player.seek(0);
}

function removeEntry(i) {
  entries.splice(i, 1);
  if (!entries.length) {
    active = -1;
    player.pause();
    flightMap.clear();
    charts.forEach(c => c.destroy());
    charts = [];
    $('paneSummary').innerHTML = '';
    $('chips').innerHTML = '';
    $('badges').innerHTML = '';
    $('track').innerHTML = '';
    $('drop').hidden = false;
    return;
  }
  activate(Math.min(i, entries.length - 1));
}

async function loadFiles(files) {
  showError('');
  let last = -1;
  for (const file of files) {
    try {
      const text = await file.text();
      const log = parseFlightLog(text, file.name);
      entries.push({ log, result: analyze(log) });
      last = entries.length - 1;
    } catch (err) {
      showError(`${file.name}: ${err.message}`);
    }
  }
  if (last >= 0) await activate(last);
}

async function loadSaved(entry) {
  showError('');
  const known = entries.findIndex(e => e.source === entry.name);
  if (known >= 0) {
    await activate(known);
    return;
  }
  try {
    const log = parseFlightLog(await fetchLog(entry), entry.name);
    entries.push({ log, result: analyze(log), source: entry.name });
    await activate(entries.length - 1);
  } catch (err) {
    showError(`${entry.name}: ${err.message}`);
    $('drop').hidden = false;
  }
}

async function initLibrary() {
  const list = await listLogs();
  if (!list.length) return;
  const sel = $('library');
  const first = document.createElement('option');
  first.value = '';
  first.textContent = 'Select...';
  sel.appendChild(first);
  list.forEach((entry, i) => {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = entry.label;
    o.title = entry.name;
    sel.appendChild(o);
  });
  sel.addEventListener('change', async () => {
    const entry = list[Number(sel.value)];
    sel.value = '';
    if (entry) await loadSaved(entry);
  });
  $('libWrap').hidden = false;
}

function onFrame(state, dt, moved) {
  flightMap.update(state, dt);
  if (!moved) return;
  hud.update(state);
  charts.forEach(c => c.setTime(state.t));
  const dur = player.duration;
  $('scrub').value = String(state.t);
  $('readout').textContent = `T+${formatDuration(state.t)} / ${formatDuration(dur)}`;
}

player.onUpdate(onFrame);
player.onState = p => {
  $('iconPlay').toggleAttribute('hidden', p.playing);
  $('iconPause').toggleAttribute('hidden', !p.playing);
  $('btnPlay').setAttribute('aria-label', p.playing ? 'Pause' : 'Play');
  document.querySelectorAll('#speeds button').forEach(b => b.classList.toggle('on', Number(b.dataset.speed) === p.speed));
};

SPEEDS.forEach(v => {
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.speed = String(v);
  b.textContent = `${v}x`;
  b.addEventListener('click', () => player.setSpeed(v));
  $('speeds').appendChild(b);
});
player.setSpeed(1);

$('btnPlay').addEventListener('click', () => player.toggle());
$('btnStart').addEventListener('click', () => player.seek(0));
$('btnEnd').addEventListener('click', () => player.seek(player.duration));
$('btnNext').addEventListener('click', () => {
  if (!analysis) return;
  const next = analysis.events.find(e => e.t > player.t + 0.01) || analysis.events[0];
  if (next) player.seek(next.t);
});
$('legendBtn').addEventListener('click', () => {
  const open = $('legend').hidden;
  $('legend').hidden = !open;
  $('legendBtn').setAttribute('aria-expanded', String(open));
});
$('scrub').addEventListener('input', e => player.seek(Number(e.target.value)));

document.querySelectorAll('#camModes button').forEach(b => b.addEventListener('click', () => setCameraMode(b.dataset.mode)));

document.querySelectorAll('#mapCtl button').forEach(b => b.addEventListener('click', () => {
  const [kind, value] = b.dataset.n.split(':');
  if (kind === 'north') flightMap.resetNorth();
  else flightMap.nudge(kind, Number(value));
  player.kick(1200);
}));

document.querySelectorAll('#viewToggle button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('#viewToggle button').forEach(x => x.classList.toggle('on', x === b));
  flightMap.setTerrainEnabled(b.dataset.view === 'terrain');
  player.kick(1200);
}));

$('altMode').addEventListener('change', e => {
  flightMap.setAltMode(e.target.value);
  player.kick(1200);
});

$('trailColor').addEventListener('change', e => flightMap.setColorMode(e.target.value));

document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b));
  $('paneSummary').classList.toggle('on', b.dataset.tab === 'summary');
  $('paneCharts').classList.toggle('on', b.dataset.tab === 'charts');
  redrawAll();
}));

$('openBtn').addEventListener('click', () => $('fileInput').click());
initLibrary();
$('dropBtn').addEventListener('click', () => $('fileInput').click());
$('fileInput').addEventListener('change', e => {
  loadFiles([...e.target.files]);
  e.target.value = '';
});

$('fsBtn').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else $('stage').requestFullscreen();
});

let dragDepth = 0;
window.addEventListener('dragenter', e => {
  e.preventDefault();
  dragDepth++;
  $('drop').hidden = false;
  $('drop').classList.add('over');
});
window.addEventListener('dragleave', e => {
  e.preventDefault();
  dragDepth--;
  if (dragDepth <= 0) {
    dragDepth = 0;
    $('drop').classList.remove('over');
    if (entries.length) $('drop').hidden = true;
  }
});
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => {
  e.preventDefault();
  dragDepth = 0;
  $('drop').classList.remove('over');
  if (entries.length) $('drop').hidden = true;
  loadFiles([...e.dataTransfer.files]);
});

window.addEventListener('keydown', e => {
  if (e.target.matches('input[type="range"], select') && e.key !== ' ') return;
  if (e.key === ' ') {
    e.preventDefault();
    player.toggle();
  } else if (e.key === 'ArrowRight') player.seek(player.t + 5);
  else if (e.key === 'ArrowLeft') player.seek(player.t - 5);
  else if (e.key === ']') player.setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(player.speed) + 1)]);
  else if (e.key === '[') player.setSpeed(SPEEDS[Math.max(0, SPEEDS.indexOf(player.speed) - 1)]);
});

function applyTheme(theme) {
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  redrawAll();
}

try {
  const saved = localStorage.getItem('flv-theme');
  if (saved) document.documentElement.dataset.theme = saved;
} catch (err) {
  void err;
}

$('themeBtn').addEventListener('click', () => {
  const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  const next = cur === 'dark' ? 'light' : 'dark';
  try {
    localStorage.setItem('flv-theme', next);
  } catch (err) {
    void err;
  }
  applyTheme(next);
});

document.addEventListener('fullscreenchange', () => {
  $('fsBtn').setAttribute('aria-pressed', document.fullscreenElement ? 'true' : 'false');
});

window.addEventListener('resize', redrawAll);
