const LOG_DIR = 'logs/';

export function labelFor(fileName) {
  const base = fileName.replace(/\.[^.]+$/, '');
  const m = base.match(/(\d{4})-(\d{2})-(\d{2})[-_T ]?(\d{2})(\d{2})(\d{2})(?:_(.+))?$/);
  if (m) {
    const stamp = `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`;
    return m[7] ? `${stamp} - ${m[7]}` : stamp;
  }
  return base;
}

export function parseListing(text) {
  const names = [];
  const re = /href\s*=\s*["']([^"'#?]+\.csv)["']/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    let name = m[1];
    try {
      name = decodeURIComponent(name);
    } catch (err) {
      void err;
    }
    name = name.split('/').pop();
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

function toEntries(names) {
  return names
    .filter(n => typeof n === 'string' && /\.csv$/i.test(n))
    .map(name => ({ name, label: labelFor(name), url: LOG_DIR + encodeURIComponent(name) }))
    .sort((a, b) => (a.label < b.label ? 1 : a.label > b.label ? -1 : 0));
}

async function fetchText(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.text();
}

export async function listLogs() {
  try {
    const list = JSON.parse(await fetchText(`${LOG_DIR}index.json`));
    if (Array.isArray(list)) return toEntries(list.map(x => (typeof x === 'string' ? x : x && x.name)));
  } catch (err) {
    void err;
  }
  try {
    return toEntries(parseListing(await fetchText(LOG_DIR)));
  } catch (err) {
    return [];
  }
}

export async function fetchLog(entry) {
  return fetchText(entry.url);
}
