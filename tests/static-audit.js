/**
 * Daymark static release audit.
 * Read-only: verifies local references, document structure, IDs, script order,
 * and the absence of external network dependencies. Does not modify project files.
 *
 * Run from anywhere: node tests/static-audit.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const HTML = ['index.html', 'tasks.html', 'overview.html', 'settings.html'];
const CSS = ['css/styles.css', 'css/components.css'];
const JS = fs.readdirSync(path.join(ROOT, 'js')).filter(file => file.endsWith('.js')).sort();
const problems = [];
const notes = [];

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function existsExact(absPath) {
  // Windows is case-insensitive; verify each path segment's casing on disk.
  const parsed = path.parse(absPath);
  let current = parsed.root;
  const segments = absPath.slice(parsed.root.length).split(/[\\/]+/).filter(Boolean);

  for (const segment of segments) {
    let entries;
    try { entries = fs.readdirSync(current); } catch (error) { return false; }
    if (!entries.includes(segment)) return false;
    current = path.join(current, segment);
  }

  return fs.existsSync(current);
}

for (const file of HTML) {
  const html = read(file);
  const dir = path.dirname(path.join(ROOT, file));

  if (!/^<!DOCTYPE html>/i.test(html.trimStart())) problems.push(`${file}: missing or malformed doctype`);
  if (!/<html[^>]*\blang="[^"]+"/i.test(html)) problems.push(`${file}: missing html lang`);
  if (!/<meta[^>]*charset=/i.test(html)) problems.push(`${file}: missing charset`);
  if (!/<meta[^>]*name="viewport"/i.test(html)) problems.push(`${file}: missing viewport meta`);
  if (!/<title>[^<]+<\/title>/i.test(html)) problems.push(`${file}: missing title`);

  // Local asset references and external resource references.
  const refs = [];
  const attrRe = /\b(?:src|href)\s*=\s*"([^"]+)"/gi;
  let match;
  while ((match = attrRe.exec(html))) refs.push(match[1]);

  for (const ref of refs) {
    if (/^(https?:)?\/\//i.test(ref)) {
      problems.push(`${file}: external resource reference "${ref}"`);
      continue;
    }
    if (/^(data:|mailto:|tel:|javascript:|#)/i.test(ref)) continue;
    const clean = ref.split('#')[0].split('?')[0];
    if (!clean) continue;
    const abs = path.resolve(dir, clean);
    if (!existsExact(abs)) problems.push(`${file}: broken local reference "${ref}"`);
  }

  // Duplicate IDs.
  const ids = [];
  const idRe = /\bid\s*=\s*"([^"]+)"/g;
  while ((match = idRe.exec(html))) ids.push(match[1]);
  const seen = new Map();
  for (const id of ids) seen.set(id, (seen.get(id) || 0) + 1);
  for (const [id, count] of seen) {
    if (count > 1) problems.push(`${file}: duplicate id "${id}" (${count}x)`);
  }

  // ARIA / label references.
  for (const attr of ['aria-labelledby', 'aria-describedby', 'aria-controls', 'for']) {
    const re = new RegExp(`\\b${attr}\\s*=\\s*"([^"]+)"`, 'gi');
    while ((match = re.exec(html))) {
      for (const token of match[1].split(/\s+/).filter(Boolean)) {
        if (!seen.has(token)) problems.push(`${file}: ${attr} points to missing id "${token}"`);
      }
    }
  }

  const scripts = Array.from(html.matchAll(/<script[^>]*src="([^"]+)"/g)).map(item => item[1]);
  notes.push(`${file}: scripts = ${scripts.join(' -> ')}`);

  const required = {
    'index.html': ['js/theme.js', 'js/storage.js', 'js/ui.js', 'js/task-store.js', 'js/focus-store.js', 'js/dashboard.js'],
    'tasks.html': ['js/theme.js', 'js/storage.js', 'js/ui.js', 'js/task-store.js', 'js/tasks.js'],
    'overview.html': ['js/theme.js', 'js/storage.js', 'js/ui.js', 'js/task-store.js', 'js/overview.js'],
    'settings.html': ['js/theme.js', 'js/storage.js', 'js/ui.js', 'js/task-store.js', 'js/settings.js']
  }[file];
  const missing = required.filter(script => scripts.indexOf(script) === -1);
  if (missing.length) problems.push(`${file}: missing required script(s): ${missing.join(', ')}`);
  const order = required.filter(script => scripts.indexOf(script) !== -1).map(script => scripts.indexOf(script));
  if (order.some((value, index) => index > 0 && value < order[index - 1])) {
    problems.push(`${file}: script dependency order is wrong`);
  }

  if (/\son(click|load|change|submit)\s*=/i.test(html)) problems.push(`${file}: inline event handler found`);
  if (/fonts\.googleapis\.com|fonts\.gstatic\.com/i.test(html)) problems.push(`${file}: Google Fonts reference remains`);
}

// CSS asset references.
for (const file of CSS) {
  const css = read(file);
  const re = /url\(\s*['"]?([^'")]+)['"]?\s*\)/g;
  let match;

  while ((match = re.exec(css))) {
    const ref = match[1];
    if (/^https?:/i.test(ref)) {
      problems.push(`${file}: external url() reference "${ref}"`);
      continue;
    }
    if (/^(data:|\/\/)/i.test(ref)) continue;
    const abs = path.resolve(path.dirname(path.join(ROOT, file)), ref);
    if (!existsExact(abs)) problems.push(`${file}: broken url() reference "${ref}"`);
  }

  if (/@import\s+url\(\s*['"]?https?:/i.test(css)) problems.push(`${file}: external @import found`);
}

// External URLs and network APIs in application code.
const appFiles = [...HTML, ...CSS, ...JS.map(file => 'js/' + file)];
const allowedNamespaceUrls = new Set([
  'http://www.w3.org/2000/svg',
  'http://www.w3.org/1999/xlink'
]);
const externalUrls = new Set();

for (const file of appFiles) {
  const text = read(file);
  const matches = text.match(/https?:\/\/[^\s"'<>)]+/g) || [];
  for (const url of matches) {
    if (!allowedNamespaceUrls.has(url)) {
      externalUrls.add(url);
      problems.push(`${file}: external URL "${url}"`);
    }
  }
}

for (const file of JS) {
  const js = read('js/' + file);
  for (const api of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'navigator.sendBeacon', 'importScripts', 'EventSource']) {
    if (js.indexOf(api) !== -1) problems.push(`js/${file}: network API "${api}" found`);
  }
}

// Storage keys.
const keys = new Set();
for (const file of JS) {
  const js = read('js/' + file);
  for (const match of js.matchAll(/'daymark\.[a-z0-9.]+'/gi)) keys.add(match[0].slice(1, -1));
}
notes.push('storage keys referenced: ' + Array.from(keys).sort().join(', '));
notes.push('external URLs outside SVG namespaces: ' + (externalUrls.size ? Array.from(externalUrls).sort().join(', ') : 'none'));
notes.push('application files checked: ' + appFiles.length);

console.log(JSON.stringify({ problems, notes }, null, 2));
process.exitCode = problems.length ? 1 : 0;
