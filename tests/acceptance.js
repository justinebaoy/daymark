/**
 * Daymark acceptance suite
 * - 17 Daily Focus functional tests
 * - 10 regression tests for existing pages and data
 * - 1 reduced-motion accessibility check
 * - 1 zero-external-request release check
 * - 48 page x viewport x theme checks (4 pages, 4 viewports, light/dark/system)
 *
 * Prerequisites: Node.js 22.4+ and a Chromium-based browser (Microsoft Edge or
 * Google Chrome). Runs headless with an isolated profile over raw CDP.
 *
 * Run from anywhere: node tests/acceptance.js
 *
 * Optional environment variables:
 *   DAYMARK_BROWSER   Browser executable or command (default: auto-detect)
 *   DAYMARK_CDP_PORT  DevTools port (default: 9417)
 *   DAYMARK_SKIP      Comma-separated test IDs to skip
 *   DAYMARK_NO_MATRIX Set to 1 to skip the 48-cell visual matrix
 *
 * Artifacts (screenshots and acceptance-results.json) are written to the
 * operating system temp directory, never into the project.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(os.tmpdir(), 'daymark-acceptance');
const PROFILE = path.join(OUT, 'browser-profile');
const DOWNLOADS = path.join(OUT, 'downloads');
const PORT = Number(process.env.DAYMARK_CDP_PORT || 9417);
const BASE = pathToFileURL(ROOT).href.replace(/\/?$/, '/');
const BROWSER = resolveBrowser();
const sleep = ms => new Promise(r => setTimeout(r, ms));

function resolveBrowser() {
  const explicit = process.env.DAYMARK_BROWSER;
  if (explicit) {
    if (path.isAbsolute(explicit) && !fs.existsSync(explicit)) {
      throw new Error('Browser not found at DAYMARK_BROWSER: ' + explicit);
    }
    return explicit;
  }

  const candidates = [];

  if (process.platform === 'win32') {
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    candidates.push(path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    candidates.push(path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    candidates.push(path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    candidates.push(path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
    candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  } else {
    candidates.push('/usr/bin/microsoft-edge');
    candidates.push('/usr/bin/microsoft-edge-stable');
    candidates.push('/usr/bin/google-chrome');
    candidates.push('/usr/bin/google-chrome-stable');
    candidates.push('/usr/bin/chromium');
    candidates.push('/usr/bin/chromium-browser');
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return process.platform === 'win32' ? 'msedge' : 'chromium';
}

const SCHEMA = ['id', 'title', 'description', 'dueDate', 'priority', 'category', 'completed', 'createdAt', 'completedAt'];
const VIEWPORTS = [
  { name: 'mobile', w: 390, h: 844, mobile: true },
  { name: 'tablet', w: 768, h: 1024, mobile: false },
  { name: 'laptop', w: 1024, h: 900, mobile: false },
  { name: 'desktop', w: 1440, h: 1100, mobile: false }
];
const PAGES = ['index.html', 'tasks.html', 'overview.html', 'settings.html'];
const THEMES = ['light', 'dark', 'system'];
const SKIP_IDS = (process.env.DAYMARK_SKIP || '').split(',').map(s => s.trim()).filter(Boolean);
const SKIP_MATRIX = process.env.DAYMARK_NO_MATRIX === '1';

const results = {
  startedAt: new Date().toISOString(),
  environment: { browser: BROWSER, projectRoot: ROOT, profile: PROFILE, node: process.version, port: PORT },
  functional: [],
  regression: [],
  accessibility: [],
  release: [],
  matrix: [],
  skipped: [],
  externalRequests: [],
  consoleErrors: []
};

/* ------------------------------------------------------------------------ */
/* CDP plumbing                                                             */
/* ------------------------------------------------------------------------ */

async function waitForEndpoint(getSpawnError) {
  for (let i = 0; i < 120; i += 1) {
    if (getSpawnError && getSpawnError()) {
      throw new Error('Browser failed to launch: ' + getSpawnError().message);
    }
    try {
      const res = await fetch('http://127.0.0.1:' + PORT + '/json/version');
      if (res.ok) return;
    } catch (error) { /* retry */ }
    await sleep(250);
  }
  throw new Error('DevTools endpoint did not start');
}

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout: ' + label)), ms); })
  ]).finally(() => clearTimeout(timer));
}

async function main() {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  fs.rmSync(DOWNLOADS, { recursive: true, force: true });
  fs.mkdirSync(DOWNLOADS, { recursive: true });

  const child = spawn(BROWSER, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
    '--disable-features=Translate,MediaRouter',
    '--user-data-dir=' + PROFILE,
    '--remote-debugging-port=' + PORT,
    'about:blank'
  ], { stdio: 'ignore' });

  let spawnError = null;
  child.once('error', error => { spawnError = error; });

  let ws;
  try {
    await waitForEndpoint(() => spawnError);
    const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
    const target = list.find(t => t.type === 'page');
    ws = new WebSocket(target.webSocketDebuggerUrl);

    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });

    let nextId = 0;
    const pending = new Map();
    let errors = [];
    let downloadsEnabledVia = '';
    const externalRequests = [];
    const failedRequests = [];

    ws.addEventListener('message', event => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        errors.push('exception: ' + (d.exception && d.exception.description ? d.exception.description : d.text));
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        errors.push('console: ' + msg.params.args.map(a => a.value || a.description || '').join(' '));
      }
      if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
        errors.push('log: ' + msg.params.entry.text + (msg.params.entry.url ? ' @ ' + msg.params.entry.url : ''));
      }
      if (msg.method === 'Network.requestWillBeSent') {
        const url = msg.params.request.url;
        if (/^https?:/i.test(url)) {
          externalRequests.push(url);
        }
      }
      if (msg.method === 'Network.loadingFailed') {
        failedRequests.push({ error: msg.params.errorText, requestId: msg.params.requestId });
      }
    });

    const send = (method, params, ms) => {
      const id = ++nextId;
      ws.send(JSON.stringify({ id, method, params: params || {} }));
      return withTimeout(
        new Promise((resolve, reject) => pending.set(id, { resolve, reject })),
        ms || 20000,
        method
      );
    };

    const evaluate = async expression => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) {
        const detail = r.exceptionDetails;
        const message = detail.exception && detail.exception.description
          ? detail.exception.description
          : (detail.text || 'evaluation failed');
        throw new Error(message);
      }
      return r.result.value;
    };

    /* -------------------------------------------------------------------- */
    /* Navigation and input helpers                                         */
    /* -------------------------------------------------------------------- */

    async function waitReady(file) {
      await sleep(180);
      for (let i = 0; i < 120; i += 1) {
        try {
          const s = await evaluate('({ ready: document.readyState, href: location.href })');
          if (s.ready === 'complete' && (!file || s.href.endsWith('/' + file))) break;
        } catch (error) { /* navigating */ }
        await sleep(100);
      }
      try { await evaluate('document.fonts.ready.then(() => true)'); } catch (error) { /* ignore */ }
      await sleep(280);
    }

    async function open(file) {
      errors = [];
      await send('Page.navigate', { url: BASE + file });
      await waitReady(file);
      try { await send('Page.bringToFront', {}, 5000); } catch (error) { /* not fatal */ }
      try { await send('Page.setWebLifecycleState', { state: 'active' }, 5000); } catch (error) { /* not fatal */ }
      await evaluate('window.scrollTo(0, 0)');
    }

    async function reload(file) {
      errors = [];
      await send('Page.reload', { ignoreCache: true });
      await waitReady(file);
      try { await send('Page.bringToFront', {}, 5000); } catch (error) { /* not fatal */ }
      try { await send('Page.setWebLifecycleState', { state: 'active' }, 5000); } catch (error) { /* not fatal */ }
      await evaluate('window.scrollTo(0, 0)');
    }

    async function setViewport(vp) {
      await send('Emulation.setDeviceMetricsOverride', {
        width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: Boolean(vp.mobile)
      });
    }

    async function emulateScheme(value) {
      await send('Emulation.setEmulatedMedia', {
        media: 'screen',
        features: value ? [{ name: 'prefers-color-scheme', value }] : []
      });
    }

    async function emulateReducedMotion(reduce) {
      await send('Emulation.setEmulatedMedia', {
        media: 'screen',
        features: reduce ? [{ name: 'prefers-reduced-motion', value: 'reduce' }] : []
      });
    }

    async function screenshot(name) {
      let lastError;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true }, 30000);
          fs.writeFileSync(path.join(OUT, name), Buffer.from(shot.data, 'base64'));
          return true;
        } catch (error) {
          lastError = error;
          await sleep(300);
        }
      }
      throw lastError;
    }

    async function centerOf(selector) {
      return evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
      })()`);
    }

    async function click(selector) {
      await evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (el) el.scrollIntoView({ block: 'center', inline: 'center' });
      })()`);
      await sleep(80);
      const box = await centerOf(selector);
      if (!box) throw new Error('cannot click missing element: ' + selector);
      const x = box.x;
      const y = box.y;
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
      await sleep(170);
    }

    async function press(key, code, vk, modifiers, text) {
      const mods = modifiers || 0;
      const down = {
        type: text ? 'keyDown' : 'rawKeyDown',
        key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: mods
      };
      if (text) {
        down.text = text;
        down.unmodifiedText = text;
      }
      await send('Input.dispatchKeyEvent', down);
      await send('Input.dispatchKeyEvent', {
        type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: mods
      });
      await sleep(90);
    }

    const tab = () => press('Tab', 'Tab', 9);
    const shiftTab = () => press('Tab', 'Tab', 9, 8);
    const enter = () => press('Enter', 'Enter', 13, 0, '\r');
    const escape = () => press('Escape', 'Escape', 27);
    const backspace = () => press('Backspace', 'Backspace', 8);

    async function typeText(text) {
      await send('Input.insertText', { text });
      await sleep(100);
    }

    async function setValueAndInput(selector, value) {
      await evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        el.value = ${JSON.stringify(value)};
        el.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await sleep(80);
    }

    async function enableDownloads() {
      const params = { behavior: 'allow', downloadPath: DOWNLOADS };
      try {
        await send('Page.setDownloadBehavior', params, 5000);
        downloadsEnabledVia = 'Page.setDownloadBehavior';
        return;
      } catch (error) { /* try Browser */ }

      try {
        await send('Browser.setDownloadBehavior', Object.assign({ eventsEnabled: true }, params), 5000);
        downloadsEnabledVia = 'Browser.setDownloadBehavior';
        return;
      } catch (error) { /* fall through */ }

      downloadsEnabledVia = 'unavailable';
    }

    /* -------------------------------------------------------------------- */
    /* Fixtures and page state                                              */
    /* -------------------------------------------------------------------- */

    const TASK_FIXTURE = `(() => {
      const now = new Date();
      const at = (offset, hour) => {
        const d = new Date(now);
        d.setDate(d.getDate() + offset);
        d.setHours(hour, 0, 0, 0);
        return d.toISOString();
      };
      return [
        { id: 't1', title: 'Draft the launch note', description: 'One clear message.', dueDate: at(0, 9), priority: 'high', category: 'work', completed: false, createdAt: at(-2, 8), completedAt: null },
        { id: 't2', title: 'Review accessibility pass', description: '', dueDate: at(0, 11), priority: 'medium', category: 'work', completed: false, createdAt: at(-1, 8), completedAt: null },
        { id: 't3', title: 'Walk at lunch', description: '', dueDate: at(0, 13), priority: 'low', category: 'personal', completed: false, createdAt: at(-1, 9), completedAt: null },
        { id: 't4', title: 'Plan tomorrow', description: '', dueDate: at(1, 10), priority: 'medium', category: 'study', completed: false, createdAt: at(-1, 10), completedAt: null },
        { id: 't5', title: 'Finished reading', description: '', dueDate: at(0, 8), priority: 'low', category: 'personal', completed: true, createdAt: at(-3, 8), completedAt: at(0, 8) },
        { id: 't6', title: 'Old overdue task', description: '', dueDate: at(-2, 10), priority: 'high', category: 'other', completed: false, createdAt: at(-4, 8), completedAt: null }
      ];
    })()`;

    async function seedTasks() {
      await evaluate(`localStorage.setItem('daymark.tasks.v1', JSON.stringify(${TASK_FIXTURE}))`);
    }

    async function resetStorage() {
      await evaluate(`(() => {
        ['daymark.tasks.v1', 'daymark.tasks.v1.unreadable', 'daymark.focus.v1',
         'daymark.focus.v1.unreadable', 'daymark.theme.v1'].forEach(k => localStorage.removeItem(k));
      })()`);
    }

    async function setTheme(theme) {
      if (theme) {
        await evaluate(`localStorage.setItem('daymark.theme.v1', ${JSON.stringify(theme)})`);
      } else {
        await evaluate(`localStorage.removeItem('daymark.theme.v1')`);
      }
    }

    async function setFocus(offsetPlans, theme) {
      await evaluate(`(() => {
        const base = new Date();
        const keyFor = offset => {
          const d = new Date(base);
          d.setDate(d.getDate() + offset);
          return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        };
        const input = ${JSON.stringify(offsetPlans)};
        const plans = {};
        Object.keys(input).forEach(offset => {
          plans[keyFor(Number(offset))] = input[offset];
        });
        localStorage.setItem('daymark.focus.v1', JSON.stringify({ version: 1, plans }));
      })()`);

      if (theme) {
        await setTheme(theme);
      }
    }

    const FOCUS_STATE = `(() => {
      const $ = id => document.getElementById(id);
      const raw = localStorage.getItem('daymark.focus.v1');
      let parsed = null;
      try { parsed = JSON.parse(raw); } catch (error) { parsed = null; }
      const d = new Date();
      const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      const plan = parsed && parsed.plans ? (parsed.plans[key] || null) : null;
      const input = $('focusIntentionInput');
      return {
        key, raw, parsed, plan,
        items: Array.from(document.querySelectorAll('#focusTaskList .focus-task')).map(n => n.dataset.taskId),
        empty: !!$('focusEmpty') && !$('focusEmpty').hidden,
        emptyTitle: $('focusEmptyTitle') ? $('focusEmptyTitle').textContent : '',
        emptyText: $('focusEmptyText') ? $('focusEmptyText').textContent : '',
        emptyLinkHidden: $('focusEmptyLink') ? $('focusEmptyLink').hidden : null,
        emptyButtonHidden: $('focusEmptyButton') ? $('focusEmptyButton').hidden : null,
        progressHidden: $('focusProgress').hidden,
        count: $('focusProgressText').textContent,
        percent: $('focusProgressPercent').textContent,
        valueNow: $('focusProgressBar').getAttribute('aria-valuenow'),
        valueText: $('focusProgressBar').getAttribute('aria-valuetext'),
        barRole: $('focusProgressBar').getAttribute('role'),
        barLabel: $('focusProgressBar').getAttribute('aria-label'),
        summary: $('focusSummary').textContent,
        summaryHidden: $('focusSummary').hidden,
        completeHidden: $('focusComplete').hidden,
        completeText: $('focusCompleteText').textContent,
        manageHidden: $('focusManageButton').hidden,
        dialogOpen: $('focusDialog').open,
        dialogCount: $('focusDialogCount').textContent,
        dialogError: $('focusDialogError').hidden ? '' : $('focusDialogError').textContent,
        checked: Array.from(document.querySelectorAll('.focus-candidate-checkbox:checked')).map(c => c.value),
        candidates: Array.from(document.querySelectorAll('.focus-candidate')).map(n => ({ id: n.dataset.taskId, completed: n.classList.contains('is-completed') })),
        groups: Array.from(document.querySelectorAll('.focus-candidate-group legend')).map(n => n.textContent),
        intention: $('focusIntentionText').textContent,
        intentionPlaceholder: $('focusIntentionText').classList.contains('is-placeholder'),
        intentionButton: $('focusIntentionEditButton').textContent,
        formOpen: !$('focusIntentionForm').hidden,
        formValue: input ? input.value : '',
        intentionError: $('focusIntentionError').hidden ? '' : $('focusIntentionError').textContent,
        intentionErrorRole: $('focusIntentionError').getAttribute('role'),
        intentionDescribedBy: input ? (input.getAttribute('aria-describedby') || '') : '',
        intentionAriaInvalid: input ? input.getAttribute('aria-invalid') : null,
        note: $('focusStorageNote').hidden ? '' : $('focusStorageNote').textContent,
        noteError: $('focusStorageNote').classList.contains('is-error'),
        toast: document.querySelector('.toast .toast-message') ? document.querySelector('.toast .toast-message').textContent : '',
        toastTone: document.querySelector('.toast') ? document.querySelector('.toast').className : '',
        active: document.activeElement ? (document.activeElement.id || document.activeElement.className || document.activeElement.tagName) : '',
        activeInDialog: !!$('focusDialog') && $('focusDialog').contains(document.activeElement),
        focusStatus: window.DaymarkFocusStore ? window.DaymarkFocusStore.getStatus() : 'missing',
        tasks: window.DaymarkTaskStore ? window.DaymarkTaskStore.getAll() : []
      };
    })()`;

    const focusState = () => evaluate(FOCUS_STATE);

    function assert(condition, message) {
      if (!condition) {
        throw new Error(message);
      }
    }

    function detail(state, keys) {
      const out = {};
      (keys || Object.keys(state)).forEach(k => { out[k] = state[k]; });
      if (out.raw && out.raw.length > 400) out.raw = out.raw.slice(0, 400) + '…';
      if (out.parsed) out.parsed = out.parsed;
      return out;
    }

    async function test(group, id, name, fn) {
      if (SKIP_IDS.indexOf(id) !== -1) {
        console.log('SKIP', id, name);
        return;
      }
      errors = [];
      const started = Date.now();
      try {
        const details = await fn();
        results[group].push({
          id, name, status: 'pass', ms: Date.now() - started,
          details: details || null,
          consoleErrors: errors.slice()
        });
        console.log('PASS', id, name);
      } catch (error) {
        results[group].push({
          id, name, status: 'fail', ms: Date.now() - started,
          error: String((error && error.message) || error),
          consoleErrors: errors.slice()
        });
        console.log('FAIL', id, name, '::', String((error && error.message) || error));
      }
      if (errors.length) {
        results.consoleErrors.push({ id, errors: errors.slice() });
      }
    }

    /* -------------------------------------------------------------------- */
    /* Functional tests                                                     */
    /* -------------------------------------------------------------------- */

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Log.enable');
    await send('Network.enable');
    await setViewport(VIEWPORTS[3]);
    await emulateScheme(null);

    await open('index.html');
    await resetStorage();
    await seedTasks();
    await setTheme('light');
    await open('index.html');
    await test('functional', 'F1', 'Daily Focus empty state appears with no saved plan', async () => {
      const s = await focusState();
      assert(s.focusStatus === 'empty', 'expected empty focus storage status, got ' + s.focusStatus);
      assert(s.empty === true, 'empty state should be visible');
      assert(s.emptyTitle === 'What matters most today?', 'unexpected empty title: ' + s.emptyTitle);
      assert(s.manageHidden === true, 'Edit focus should be hidden with no plan');
      assert(s.progressHidden === true, 'progress should be hidden with no plan');
      assert(s.completeHidden === true, 'completion block should be hidden');
      assert(s.intentionPlaceholder === true, 'placeholder intention should show');
      assert(s.raw === null, 'no focus key should be written before a save');
      assert(s.barRole === 'progressbar' && s.barLabel === 'Daily Focus progress', 'progressbar semantics missing');
      assert(errors.length === 0, 'console errors: ' + errors.join(' | '));
      await screenshot('acceptance-f1-empty.png');
      return detail(s, ['key', 'emptyTitle', 'manageHidden', 'progressHidden', 'intention', 'focusStatus']);
    });

    await test('functional', 'F2', 'Selection dialog lists incomplete tasks before completed ones', async () => {
      await click('#focusEmptyButton');
      const s = await focusState();
      assert(s.dialogOpen === true, 'dialog should be open');
      assert(s.dialogCount === '0 of 3 selected.', 'unexpected dialog count: ' + s.dialogCount);
      assert(s.groups[0] === 'To do (5)', 'active group should be first, got ' + JSON.stringify(s.groups));
      assert(s.groups[1] === 'Completed (1)', 'completed group should be second, got ' + JSON.stringify(s.groups));
      assert(s.candidates.slice(0, 5).every(c => c.completed === false), 'first five candidates should be incomplete');
      assert(s.candidates[5] && s.candidates[5].completed === true, 'completed candidate should be last');
      assert(s.activeInDialog === true, 'focus should enter the dialog');
      await screenshot('acceptance-f2-dialog.png');
      return detail(s, ['dialogCount', 'groups', 'candidates', 'active']);
    });

    await test('functional', 'F3', 'Three priorities can be selected and persist', async () => {
      for (const id of ['t1', 't2', 't3']) {
        await click(`.focus-candidate[data-task-id="${id}"] input`);
      }
      let s = await focusState();
      assert(s.dialogCount === '3 of 3 selected. Limit reached.', 'limit text wrong: ' + s.dialogCount);
      assert(s.checked.join(',') === 't1,t2,t3', 'checked ids wrong: ' + s.checked.join(','));

      await click('#focusDialogSave');
      s = await focusState();
      assert(s.dialogOpen === false, 'dialog should close after save');
      assert(s.items.join(',') === 't1,t2,t3', 'focus list wrong: ' + s.items.join(','));
      assert(s.plan && s.plan.taskIds.join(',') === 't1,t2,t3', 'saved plan wrong');
      assert(s.plan.intention === '', 'new plan intention should be empty');
      assert(s.parsed.version === 1, 'payload version should be 1');
      assert(s.count === '0 of 3 completed' && s.percent === '0%', 'unexpected initial progress');
      assert(s.manageHidden === false, 'Edit focus should show');
      assert(s.toast.indexOf('Daily Focus updated. 3 of 3') === 0, 'success toast missing: ' + s.toast);

      await reload('index.html');
      s = await focusState();
      assert(s.items.join(',') === 't1,t2,t3', 'selection did not persist across reload');
      assert(s.plan.taskIds.join(',') === 't1,t2,t3', 'stored plan changed after reload');
      await screenshot('acceptance-f3-selected.png');
      return detail(s, ['plan', 'items', 'count', 'percent', 'manageHidden', 'toast']);
    });

    await test('functional', 'F4', 'A fourth selection is rejected with a clear limit message', async () => {
      await click('#focusManageButton');
      await click('.focus-candidate[data-task-id="t4"] input');
      const s = await focusState();
      assert(s.checked.indexOf('t4') === -1, 'fourth task should not stay checked');
      assert(s.checked.length === 3, 'should still have three checked');
      assert(s.dialogCount === '3 of 3 selected. Limit reached.', 'limit count wrong: ' + s.dialogCount);
      assert(s.dialogError.indexOf('up to three') !== -1, 'limit error missing: ' + s.dialogError);
      const errorRole = await evaluate(`document.getElementById('focusDialogError').getAttribute('role')`);
      assert(errorRole === 'alert', 'dialog limit error should use role=alert');
      assert(s.plan.taskIds.join(',') === 't1,t2,t3', 'rejected choice must not change storage');
      await click('[data-close-focus]');
      return detail(s, ['checked', 'dialogCount', 'dialogError', 'plan']);
    });

    await test('functional', 'F5', 'Saved focus IDs stay unique and capped at three', async () => {
      const s = await focusState();
      const ids = s.plan.taskIds;
      assert(ids.length <= 3, 'more than three ids saved');
      assert(new Set(ids).size === ids.length, 'duplicate ids saved');
      const checkboxValues = await evaluate(`Array.from(document.querySelectorAll('.focus-candidate-checkbox')).map(c => c.value)`);
      assert(new Set(checkboxValues).size === checkboxValues.length, 'duplicate candidate values');
      return { ids, unique: new Set(ids).size, candidateCount: checkboxValues.length };
    });

    await test('functional', 'F6', 'Completing a priority updates live progress', async () => {
      await click('#focusTaskList [data-task-id="t2"] .focus-task-checkbox');
      const s = await focusState();
      assert(s.count === '1 of 3 completed', 'progress count wrong: ' + s.count);
      assert(s.percent === '33%', 'percent wrong: ' + s.percent);
      assert(s.valueNow === '33', 'aria-valuenow wrong: ' + s.valueNow);
      assert(s.valueText === '1 of 3 priorities complete, 33 percent', 'aria-valuetext wrong: ' + s.valueText);
      assert(s.summary === '2 priorities remaining.', 'summary wrong: ' + s.summary);
      assert(s.completeHidden === true, 'completion block should stay hidden');
      const task = s.tasks.find(t => t.id === 't2');
      assert(task && task.completed === true && task.completedAt, 't2 should be completed with a timestamp');
      assert(s.plan.taskIds.join(',') === 't1,t2,t3', 'focus membership should not change on toggle');
      await screenshot('acceptance-f6-progress.png');
      return detail(s, ['count', 'percent', 'valueNow', 'valueText', 'summary', 'toast']);
    });

    await test('functional', 'F7', 'Reopening a priority restores the unfinished count', async () => {
      await click('#focusTaskList [data-task-id="t2"] .focus-task-checkbox');
      const s = await focusState();
      assert(s.count === '0 of 3 completed', 'progress count wrong: ' + s.count);
      assert(s.percent === '0%', 'percent wrong: ' + s.percent);
      assert(s.summary === '3 priorities remaining.', 'summary wrong: ' + s.summary);
      assert(s.completeHidden === true, 'completion block should be hidden');
      const task = s.tasks.find(t => t.id === 't2');
      assert(task && task.completed === false && task.completedAt === null, 't2 should be reopened without completedAt');
      return detail(s, ['count', 'percent', 'summary']);
    });

    await test('functional', 'F8', 'Completing every priority shows a completion summary', async () => {
      for (const id of ['t1', 't2', 't3']) {
        await click(`#focusTaskList [data-task-id="${id}"] .focus-task-checkbox`);
      }
      const s = await focusState();
      assert(s.count === '3 of 3 completed', 'progress count wrong: ' + s.count);
      assert(s.percent === '100%', 'percent wrong: ' + s.percent);
      assert(s.valueNow === '100', 'aria-valuenow wrong: ' + s.valueNow);
      assert(s.completeHidden === false, 'completion summary should be visible');
      assert(s.completeText === '3 of 3 priorities completed.', 'completion text wrong: ' + s.completeText);
      assert(s.summaryHidden === true, 'remaining summary should hide when complete');
      assert(s.toast.indexOf('Today\'s focus is complete.') !== -1, 'completion toast missing: ' + s.toast);
      await screenshot('acceptance-f8-complete.png');
      return detail(s, ['count', 'percent', 'completeText', 'toast']);
    });

    await test('functional', 'F9', 'The daily intention saves, displays, and survives reload', async () => {
      const text = 'Finish the launch note before anything else.';
      await click('#focusIntentionEditButton');
      let s = await focusState();
      assert(s.formOpen === true, 'intention form should open');
      assert(s.active === 'focusIntentionInput', 'textarea should receive focus, active=' + s.active);
      await typeText(text);
      const typed = await focusState();
      assert(typed.formValue === text, 'typed text missing');
      assert(typed.formValue.length + ' / 160' === await evaluate(`document.getElementById('focusIntentionCount').textContent`), 'character count wrong');

      await click('#focusIntentionSave');
      s = await focusState();
      assert(s.formOpen === false, 'form should close after save');
      assert(s.intention === text, 'intention display wrong: ' + s.intention);
      assert(s.intentionPlaceholder === false, 'placeholder class should be removed');
      assert(s.intentionButton === 'Edit intention', 'edit label wrong: ' + s.intentionButton);
      assert(s.plan.intention === text, 'intention not persisted');
      assert(s.active === 'focusIntentionEditButton', 'focus should return to the edit button, active=' + s.active);

      await reload('index.html');
      s = await focusState();
      assert(s.intention === text, 'intention did not survive reload');
      assert(s.plan.intention === text, 'stored intention changed after reload');
      return detail(s, ['intention', 'intentionButton', 'plan', 'active']);
    });

    await test('functional', 'F10', 'Clearing the intention is saved honestly', async () => {
      await click('#focusIntentionEditButton');
      await evaluate(`document.getElementById('focusIntentionInput').select()`);
      await backspace();
      let s = await focusState();
      if (s.formValue !== '') {
        await setValueAndInput('#focusIntentionInput', '');
        s = await focusState();
      }
      assert(s.formValue === '', 'textarea should be empty, got ' + JSON.stringify(s.formValue));
      await click('#focusIntentionSave');
      s = await focusState();
      assert(s.intention === 'A short intention can anchor the day.', 'placeholder should return');
      assert(s.intentionPlaceholder === true, 'placeholder class should return');
      assert(s.intentionButton === 'Add intention', 'button should read Add intention');
      assert(s.plan.intention === '', 'stored intention should be empty');
      assert(s.toast === 'Intention cleared.', 'clear toast wrong: ' + s.toast);
      assert(s.toastTone.indexOf('toast-success') !== -1, 'clear should not be an error toast');
      return detail(s, ['intention', 'intentionButton', 'plan', 'toast']);
    });

    await test('functional', 'F11', 'Cancelling an intention edit keeps the saved value', async () => {
      const saved = 'Protect the morning.';

      await click('#focusIntentionEditButton');
      await typeText(saved);
      await click('#focusIntentionSave');

      await click('#focusIntentionEditButton');
      await setValueAndInput('#focusIntentionInput', 'Throw this draft away.');
      await click('#focusIntentionCancel');
      const s = await focusState();
      assert(s.formOpen === false, 'form should close on cancel');
      assert(s.intention === saved, 'display should keep saved intention: ' + s.intention);
      assert(s.plan.intention === saved, 'storage should keep saved intention: ' + s.plan.intention);
      assert(s.active === 'focusIntentionEditButton', 'focus should return to the edit button');
      assert(s.intentionError === '', 'cancel should not leave an error');
      return detail(s, ['intention', 'formOpen', 'active', 'plan']);
    });

    await test('functional', 'F12', 'Removing a priority keeps the underlying task', async () => {
      await click('#focusTaskList [data-task-id="t1"] .focus-task-remove');
      const s = await focusState();
      assert(s.items.join(',') === 't2,t3', 'focus list wrong after removal: ' + s.items.join(','));
      assert(s.plan.taskIds.join(',') === 't2,t3', 'stored plan wrong after removal');
      assert(s.tasks.some(t => t.id === 't1'), 't1 should still exist in the task store');
      assert(s.toast === 'Removed from today\'s focus. The task itself is unchanged.', 'removal toast wrong: ' + s.toast);
      assert(s.count === '2 of 2 completed', 'completed count should reflect the remaining two (both complete): ' + s.count);
      const activeIsRemove = await evaluate(`document.activeElement.classList.contains('focus-task-remove')`);
      assert(activeIsRemove === true, 'focus should move to a remaining remove button');
      return detail(s, ['items', 'plan', 'count', 'toast']);
    });

    await test('functional', 'F13', 'Deleted task IDs are hidden and cleaned safely', async () => {
      await seedTasks();
      await setFocus({ '0': { taskIds: ['t1', 'missing-task', 't2'], intention: 'Keep the valid ones.' } }, 'light');
      await reload('index.html');
      const s = await focusState();
      assert(s.items.join(',') === 't1,t2', 'stale id should not render: ' + s.items.join(','));
      assert(s.plan.taskIds.join(',') === 't1,t2', 'stale id should be removed from the saved plan: ' + JSON.stringify(s.plan.taskIds));
      assert(s.plan.intention === 'Keep the valid ones.', 'intention should be preserved');
      assert(s.count === '0 of 2 completed', 'count should exclude stale id: ' + s.count);
      assert(s.focusStatus === 'ok', 'focus store should be healthy');
      assert(errors.length === 0, 'console errors: ' + errors.join(' | '));
      return detail(s, ['plan', 'items', 'count']);
    });

    await test('functional', 'F14', 'A new local day starts empty with no carry-over', async () => {
      await seedTasks();
      await setFocus({ '-1': { taskIds: ['t1', 't2'], intention: 'Yesterday only.' } }, 'light');
      await reload('index.html');
      let s = await focusState();
      assert(s.items.length === 0, 'yesterday plan must not carry into today');
      assert(s.plan === null, 'today should have no plan');
      assert(s.empty === true, 'today should show the empty state');
      assert(s.parsed.plans && Object.keys(s.parsed.plans).length === 1, 'yesterday plan should still be retained until retention prunes it');
      const beforeDate = await evaluate(`document.getElementById('focusDate').textContent`);

      await evaluate(`(() => {
        window.__RealDate = Date;
        window.Date = class extends window.__RealDate {
          constructor(...args) {
            if (args.length === 0) { super(window.__RealDate.now() + 86400000); }
            else { super(...args); }
          }
          static now() { return window.__RealDate.now() + 86400000; }
        };
        window.dispatchEvent(new Event('focus'));
      })()`);
      await sleep(400);
      s = await focusState();
      const afterDate = await evaluate(`document.getElementById('focusDate').textContent`);
      assert(afterDate !== beforeDate, 'focus date heading should change on rollover');
      assert(s.items.length === 0, 'new day must not show yesterday priorities');
      assert(s.plan === null, 'new day should have no saved plan');
      assert(s.empty === true, 'new day should show the empty state');
      assert(s.toast.indexOf('A new day has started') !== -1, 'rollover announcement missing: ' + JSON.stringify({ toast: s.toast, hidden: await evaluate('document.hidden'), visibility: await evaluate('document.visibilityState') }));
      assert(s.tasks.length === 6, 'tasks must be unaffected by rollover');

      await evaluate(`(() => { window.Date = window.__RealDate; delete window.__RealDate; window.dispatchEvent(new Event('focus')); })()`);
      await sleep(350);
      await screenshot('acceptance-f14-rollover.png');
      return { beforeDate, afterDate, key: s.key, items: s.items, plan: s.plan, toast: s.toast };
    });

    await test('functional', 'F15', 'Malformed focus data leaves tasks intact and is backed up', async () => {
      await seedTasks();
      const rawBefore = await evaluate(`localStorage.getItem('daymark.tasks.v1')`);
      await evaluate(`localStorage.setItem('daymark.focus.v1', '{not valid json'); localStorage.removeItem('daymark.focus.v1.unreadable')`);
      await reload('index.html');
      let s = await focusState();
      assert(s.raw === '{not valid json', 'corrupt payload should be left in place until a save');
      assert(await evaluate(`localStorage.getItem('daymark.focus.v1.unreadable')`) === '{not valid json', 'corrupt payload should be backed up');
      assert(s.note.indexOf('could not be read') !== -1, 'corrupt note missing: ' + s.note);
      assert(s.noteError === false, 'corrupt note should be a warning, not an error');
      assert(s.empty === true, 'corrupt focus should start empty');
      assert(s.tasks.length === 6, 'tasks should not be affected');
      assert(await evaluate(`localStorage.getItem('daymark.tasks.v1')`) === rawBefore, 'task payload changed');
      assert(errors.length === 0, 'console errors: ' + errors.join(' | '));

      await click('#focusEmptyButton');
      await click('.focus-candidate[data-task-id="t1"] input');
      await click('#focusDialogSave');
      s = await focusState();
      assert(s.plan && s.plan.taskIds.join(',') === 't1', 'new plan should save after corruption');
      assert(await evaluate(`localStorage.getItem('daymark.focus.v1.unreadable')`) === '{not valid json', 'backup should be preserved');
      assert(s.note === '', 'corrupt note should clear after a successful save');
      assert(s.tasks.length === 6, 'tasks should still be intact');
      await screenshot('acceptance-f15-corrupt.png');
      return detail(s, ['plan', 'note', 'tasks.length']);
    });

    await test('functional', 'F16', 'Failed focus writes never claim success', async () => {
      await seedTasks();
      await setFocus({ '0': { taskIds: ['t1', 't2'], intention: 'Keep it simple.' } }, 'light');
      await reload('index.html');

      await click('#focusManageButton');
      await click('.focus-candidate[data-task-id="t3"] input');
      await click('#focusDialogSave');
      let s = await focusState();
      const successToast = s.toast;
      assert(successToast.indexOf('Daily Focus updated') === 0, 'expected a success toast before failure');
      assert(s.plan.taskIds.join(',') === 't1,t2,t3', 'setup save failed');

      const rawBefore = await evaluate(`localStorage.getItem('daymark.focus.v1')`);
      await evaluate(`(() => {
        window.__origSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function () { throw new DOMException('Quota exceeded', 'QuotaExceededError'); };
      })()`);

      try {
        await click('#focusManageButton');
        await click('.focus-candidate[data-task-id="t1"] input');
        await click('.focus-candidate[data-task-id="t4"] input');
        await click('#focusDialogSave');
        await sleep(350);
        s = await focusState();
        assert(s.dialogOpen === true, 'dialog should stay open after a failed save');
        assert(s.dialogError.indexOf('could not be saved') !== -1, 'dialog error missing: ' + s.dialogError);
        assert(s.plan.taskIds.join(',') === 't1,t2,t3', 'failed save changed the plan: ' + JSON.stringify(s.plan));
        assert(await evaluate(`localStorage.getItem('daymark.focus.v1')`) === rawBefore, 'failed save changed stored data');
        assert(s.toast === '', 'stale success toast must be cleared after a failed save: ' + s.toast);
        assert(s.note.indexOf('could not be saved') !== -1 && s.noteError === true, 'storage note should be an error: ' + s.note);

        await escape();
        await click('#focusIntentionEditButton');
        await evaluate(`document.getElementById('focusIntentionInput').select()`);
        await typeText('This must not claim to save.');
        await click('#focusIntentionSave');
        s = await focusState();
        assert(s.formOpen === true, 'intention form should stay open after failure');
        assert(s.formValue === 'This must not claim to save.', 'typed intention should be retained for retry, got ' + JSON.stringify(s.formValue));
        assert(s.intentionError.indexOf('could not be saved') !== -1, 'intention error missing: ' + s.intentionError);
        assert(s.intentionAriaInvalid === 'true', 'textarea should be marked aria-invalid');
        assert(s.intentionErrorRole === null, 'inline intention error should not duplicate a role=alert announcement');
        assert(s.intentionDescribedBy.indexOf('focusIntentionError') !== -1, 'error should be linked with aria-describedby');
        assert(s.active === 'focusIntentionInput', 'focus should stay in the textarea, active=' + s.active);
        assert(s.plan.intention === 'Keep it simple.', 'failed intention changed the plan');
        assert(s.toast === '', 'no success toast may remain after a failed intention save');
        await screenshot('acceptance-f16-failure.png');
      } finally {
        await evaluate(`(() => { if (window.__origSetItem) { Storage.prototype.setItem = window.__origSetItem; delete window.__origSetItem; } })()`);
      }

      await click('#focusIntentionSave');
      await sleep(250);
      s = await focusState();
      assert(s.formOpen === false, 'successful retry should close the form');
      assert(s.plan.intention === 'This must not claim to save.', 'successful retry did not save');
      assert(s.intentionError === '', 'error should clear after success');
      assert(s.note === '', 'storage note should clear after success');
      assert(s.toast === 'Intention saved.', 'success toast wrong after retry: ' + s.toast);
      return detail(s, ['plan', 'dialogError', 'intentionError', 'note', 'toast', 'active']);
    });

    await test('functional', 'F17', 'Retention keeps today plus 30 prior days and future plans', async () => {
      const plan = intention => ({ taskIds: [], intention });
      await seedTasks();
      await setFocus({
        '0': plan('Today plan.'),
        '-29': plan('29 days ago.'),
        '-30': plan('30 days ago.'),
        '-31': plan('31 days ago.'),
        '-45': plan('45 days ago.'),
        '2': plan('Future plan.')
      }, 'light');
      await reload('index.html');

      const beforeKeys = await evaluate(`Object.keys(JSON.parse(localStorage.getItem('daymark.focus.v1')).plans).length`);
      assert(beforeKeys === 6, 'fixture should start with six plans, got ' + beforeKeys);

      await click('#focusEmptyButton');
      await click('.focus-candidate[data-task-id="t1"] input');
      await click('#focusDialogSave');
      const s = await focusState();
      const keys = Object.keys(s.parsed.plans);
      const expected = await evaluate(`(() => {
        const base = new Date();
        const key = offset => { const d = new Date(base); d.setDate(d.getDate() + offset); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
        return { today: key(0), d29: key(-29), d30: key(-30), d31: key(-31), d45: key(-45), future: key(2) };
      })()`);
      assert(keys.indexOf(expected.d31) === -1, '31 days ago should be pruned');
      assert(keys.indexOf(expected.d45) === -1, '45 days ago should be pruned');
      assert(keys.indexOf(expected.d30) !== -1, '30 days ago should be kept');
      assert(keys.indexOf(expected.d29) !== -1, '29 days ago should be kept');
      assert(keys.indexOf(expected.today) !== -1, 'today should be kept');
      assert(keys.indexOf(expected.future) !== -1, 'future plans should be kept');
      assert(keys.length === 4, 'expected four retained plans, got ' + keys.length);
      assert(s.plan.taskIds.join(',') === 't1', 'today plan not updated');
      assert(s.plan.intention === 'Today plan.', 'today intention should be preserved');
      return { keys, expected, plan: s.plan };
    });

    /* -------------------------------------------------------------------- */
    /* Regression tests                                                     */
    /* -------------------------------------------------------------------- */

    await test('regression', 'R1', 'Dashboard summary metrics stay correct with focus data', async () => {
      await seedTasks();
      await setFocus({ '0': { taskIds: ['t1', 't2', 't5'], intention: 'Stable metrics.' } }, 'light');
      await open('index.html');
      const s = await focusState();
      const metrics = await evaluate(`(() => ({
        dueToday: document.getElementById('dashboardDueToday').textContent,
        completed: document.getElementById('dashboardCompleted').textContent,
        remaining: document.getElementById('dashboardRemaining').textContent,
        weeklyLabel: document.querySelector('.weekly-chart').getAttribute('aria-label')
      }))()`);
      assert(metrics.dueToday === '3', 'due today wrong: ' + metrics.dueToday);
      assert(metrics.completed === '1', 'completed wrong: ' + metrics.completed);
      assert(metrics.remaining === '5', 'remaining wrong: ' + metrics.remaining);
      assert(metrics.weeklyLabel.indexOf('1 task completed this week') !== -1, 'weekly total wrong: ' + metrics.weeklyLabel);
      assert(s.count === '1 of 3 completed', 'focus progress should reflect completed selection: ' + s.count);
      return { metrics, focusCount: s.count };
    });

    await test('regression', 'R2', 'Today task toggles still update metrics and focus progress', async () => {
      await click('#dashboardTodayList [data-task-id="t1"] .task-checkbox');
      const metrics = await evaluate(`(() => ({
        dueToday: document.getElementById('dashboardDueToday').textContent,
        completed: document.getElementById('dashboardCompleted').textContent,
        remaining: document.getElementById('dashboardRemaining').textContent
      }))()`);
      const s = await focusState();
      assert(metrics.dueToday === '2', 'due today wrong after toggle: ' + metrics.dueToday);
      assert(metrics.completed === '2', 'completed wrong after toggle: ' + metrics.completed);
      assert(metrics.remaining === '4', 'remaining wrong after toggle: ' + metrics.remaining);
      assert(s.count === '2 of 3 completed', 'focus progress wrong after dashboard toggle: ' + s.count);
      return { metrics, focusCount: s.count };
    });

    await test('regression', 'R3', 'Upcoming deadlines still filter completed tasks', async () => {
      const deadlines = await evaluate(`Array.from(document.querySelectorAll('#dashboardDeadlineList .deadline-item')).map(n => ({ id: n.dataset.taskId, title: n.querySelector('.deadline-title').textContent }))`);
      assert(deadlines.length === 1, 'expected one upcoming deadline, got ' + deadlines.length);
      assert(deadlines[0].id === 't4' && deadlines[0].title === 'Plan tomorrow', 'wrong deadline: ' + JSON.stringify(deadlines));
      return { deadlines };
    });

    await test('regression', 'R4', 'Tasks page add, edit, and delete still work', async () => {
      await seedTasks();
      await setFocus({ '0': { taskIds: ['t1', 't2'], intention: 'Tasks regression.' } }, 'light');
      await open('tasks.html');
      await click('#addTaskButton');
      assert(await evaluate(`document.getElementById('taskDialog').open`) === true, 'add dialog should open');
      assert(await evaluate(`document.activeElement.id`) === 'taskTitle', 'title should be focused');
      await typeText('Buy milk');
      await click('#taskSubmitButton');
      await sleep(200);
      let count = await evaluate(`window.DaymarkTaskStore.getAll().length`);
      assert(count === 7, 'add did not persist, count=' + count);

      const index = await evaluate(`Array.from(document.querySelectorAll('#taskList .task-item')).findIndex(n => n.querySelector('.task-title').textContent === 'Buy milk')`);
      assert(index >= 0, 'new task row not found');
      await click(`#taskList .task-item:nth-child(${index + 1}) .task-edit`);
      assert(await evaluate(`document.getElementById('taskTitle').value`) === 'Buy milk', 'edit dialog value wrong');
      await evaluate(`document.getElementById('taskTitle').select()`);
      await typeText('Buy oat milk');
      await click('#taskSubmitButton');
      await sleep(200);
      const edited = await evaluate(`window.DaymarkTaskStore.getAll().filter(t => t.title === 'Buy oat milk').length`);
      assert(edited === 1, 'edit did not persist');

      const editedIndex = await evaluate(`Array.from(document.querySelectorAll('#taskList .task-item')).findIndex(n => n.querySelector('.task-title').textContent === 'Buy oat milk')`);
      await click(`#taskList .task-item:nth-child(${editedIndex + 1}) .task-delete`);
      assert(await evaluate(`document.getElementById('deleteDialog').open`) === true, 'delete dialog should open');
      await click('#confirmDeleteButton');
      await sleep(200);
      count = await evaluate(`window.DaymarkTaskStore.getAll().length`);
      assert(count === 6, 'delete did not persist, count=' + count);
      const stillThere = await evaluate(`window.DaymarkTaskStore.getAll().some(t => t.title === 'Buy oat milk')`);
      assert(stillThere === false, 'deleted task is still present');
      return { count, activeAfter: await evaluate(`document.activeElement.id`) };
    });

    await test('regression', 'R5', 'Task schema, order, and focus separation are preserved', async () => {
      const raw = await evaluate(`JSON.parse(localStorage.getItem('daymark.tasks.v1'))`);
      assert(Array.isArray(raw) && raw.length === 6, 'expected six stored tasks');
      raw.forEach((task, index) => {
        const keys = Object.keys(task);
        assert(JSON.stringify(keys) === JSON.stringify(SCHEMA), 'task ' + index + ' schema/order changed: ' + keys.join(','));
        keys.forEach(key => assert(key.indexOf('focus') === -1, 'focus field leaked into task: ' + key));
      });
      const focus = await evaluate(`JSON.parse(localStorage.getItem('daymark.focus.v1'))`);
      assert(focus.version === 1 && focus.plans, 'focus payload shape changed');
      const todayKey = await evaluate(`(() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })()`);
      const todayPlan = focus.plans[todayKey] || null;
      assert(todayPlan && todayPlan.taskIds.join(',') === 't1,t2', 'focus plan was not kept separate: ' + JSON.stringify(todayPlan));
      return { taskCount: raw.length, schema: SCHEMA, focusPlan: todayPlan };
    });

    await test('regression', 'R6', 'Light, dark, and system theme settings still work', async () => {
      await open('settings.html');
      await evaluate(`(() => { window.__mqChanges = 0; window.__mq = matchMedia('(prefers-color-scheme: dark)'); window.__mq.addEventListener('change', () => { window.__mqChanges += 1; }); })()`);
      const read = () => evaluate(`({ theme: document.documentElement.getAttribute('data-theme'), pref: document.documentElement.getAttribute('data-theme-preference'), stored: localStorage.getItem('daymark.theme.v1'), checked: (document.querySelector('input[name="theme"]:checked') || {}).value, mq: matchMedia('(prefers-color-scheme: dark)').matches, changes: window.__mqChanges, visibility: document.visibilityState, hasFocus: document.hasFocus(), resolved: window.DaymarkTheme ? window.DaymarkTheme.getResolvedTheme() : null, preference: window.DaymarkTheme ? window.DaymarkTheme.getPreference() : null })`);

      await click('label[for="themeDark"]');
      let t = await read();
      assert(t.theme === 'dark' && t.pref === 'dark' && t.stored === 'dark' && t.checked === 'dark', 'dark theme failed: ' + JSON.stringify(t));

      await click('label[for="themeLight"]');
      t = await read();
      assert(t.theme === 'light' && t.pref === 'light' && t.stored === 'light' && t.checked === 'light', 'light theme failed: ' + JSON.stringify(t));

      await emulateScheme('dark');
      await click('label[for="themeSystem"]');
      await sleep(400);
      t = await read();
      assert(t.theme === 'dark' && t.pref === 'system' && t.stored === 'system', 'system/dark failed: ' + JSON.stringify(t));

      await emulateScheme('light');
      let liveTheme = '';
      for (let i = 0; i < 30; i += 1) {
        await sleep(100);
        liveTheme = await evaluate(`document.documentElement.getAttribute('data-theme')`);
        if (liveTheme === 'light') break;
      }
      t = await read();
      assert(t.theme === 'light' && t.pref === 'system', 'system/light did not follow OS: ' + JSON.stringify(t) + ' liveTheme=' + liveTheme);

      await open('index.html');
      const dash = await evaluate(`document.documentElement.getAttribute('data-theme')`);
      assert(dash === 'light', 'dashboard did not apply saved system light theme: ' + dash);
      await emulateScheme(null);
      return { last: t, dashboard: dash };
    });

    await test('regression', 'R7', 'Task export still produces the unchanged JSON payload', async () => {
      await seedTasks();
      await setFocus({ '0': { taskIds: ['t1'], intention: 'Export regression.' } }, 'light');
      await open('settings.html');
      await enableDownloads();
      const expected = await evaluate(`JSON.stringify(window.DaymarkTaskStore.getAll(), null, 2)`);
      const stamp = await evaluate(`(() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })()`);

      for (const f of fs.readdirSync(DOWNLOADS)) fs.rmSync(path.join(DOWNLOADS, f), { force: true });
      await click('#exportTasksButton');
      await sleep(300);

      let file = null;
      for (let i = 0; i < 60; i += 1) {
        const files = fs.readdirSync(DOWNLOADS).filter(f => f.endsWith('.json'));
        if (files.length > 0) { file = path.join(DOWNLOADS, files[0]); break; }
        await sleep(150);
      }
      assert(file, 'export file did not appear (download behavior: ' + downloadsEnabledVia + ')');
      const text = fs.readFileSync(file, 'utf8');
      assert(text === expected, 'export payload differs from stored tasks');
      const parsed = JSON.parse(text);
      assert(parsed.length === 6, 'exported task count wrong');
      parsed.forEach(task => Object.keys(task).forEach(key => assert(key.indexOf('focus') === -1, 'focus field in export')));
      assert(path.basename(file).indexOf('daymark-tasks-' + stamp) === 0, 'unexpected export filename: ' + path.basename(file));
      const status = await evaluate(`document.getElementById('dataStatus').textContent`);
      assert(status === 'Exported 6 tasks as JSON.', 'export status wrong: ' + status);
      return { file: path.basename(file), via: downloadsEnabledVia, status, bytes: text.length };
    });

    await test('regression', 'R8', 'Clearing tasks leaves focus storage independent and the dashboard stable', async () => {
      const focusBefore = await evaluate(`localStorage.getItem('daymark.focus.v1')`);
      await click('#clearTasksButton');
      assert(await evaluate(`document.getElementById('clearTasksDialog').open`) === true, 'clear dialog should open');
      await click('#confirmClearTasks');
      await sleep(250);
      const tasksRaw = await evaluate(`localStorage.getItem('daymark.tasks.v1')`);
      const focusAfter = await evaluate(`localStorage.getItem('daymark.focus.v1')`);
      assert(tasksRaw === '[]', 'tasks should be cleared to an empty array, got ' + tasksRaw);
      assert(focusAfter === focusBefore, 'clear tasks must not modify focus storage');
      assert(await evaluate(`document.getElementById('settingsTaskCount').textContent`) === 'No tasks', 'settings count wrong');

      await open('index.html');
      const s = await focusState();
      assert(s.tasks.length === 0, 'dashboard should load no tasks');
      assert(await evaluate(`document.getElementById('dashboardDueToday').textContent`) === '0', 'due today should be 0');
      assert(await evaluate(`document.getElementById('dashboardCompleted').textContent`) === '0', 'completed should be 0');
      assert(await evaluate(`document.getElementById('dashboardRemaining').textContent`) === '0', 'remaining should be 0');
      assert(s.empty === true, 'focus card should show an empty state');
      assert(s.emptyTitle === 'A clear slate.', 'focus empty title wrong: ' + s.emptyTitle);
      assert(s.emptyLinkHidden === false, 'My Tasks link should be offered when no tasks exist');
      assert(s.emptyButtonHidden === true, 'Choose priorities should be hidden with no tasks');
      assert(s.plan && s.plan.taskIds.length === 0, 'stale focus ids should be cleaned after tasks are cleared');
      assert(s.plan.intention === 'Export regression.', 'intention should survive task clearing');
      assert(errors.length === 0, 'console errors: ' + errors.join(' | '));
      return detail(s, ['emptyTitle', 'plan', 'tasks.length']);
    });

    await test('regression', 'R9', 'Keyboard navigation, dialog trap, and focus return still work', async () => {
      await seedTasks();
      await setFocus({ '0': { taskIds: ['t1', 't2', 't3'], intention: 'Keyboard only.' } }, 'light');
      await open('index.html');

      await evaluate(`document.activeElement && document.activeElement.blur()`);
      let reached = false;
      let tabs = 0;
      for (; tabs < 80; tabs += 1) {
        await tab();
        const active = await evaluate(`document.activeElement.id`);
        if (active === 'focusManageButton') { reached = true; break; }
      }
      assert(reached, 'could not reach Edit focus with keyboard in 80 tabs');

      await enter();
      let s = await focusState();
      assert(s.dialogOpen === true, 'Enter on Edit focus should open the dialog');
      assert(s.activeInDialog === true, 'focus should be inside the dialog');

      let allInside = true;
      for (let i = 0; i < 30; i += 1) {
        await tab();
        if (!(await focusState()).activeInDialog) allInside = false;
      }
      assert(allInside, 'Tab escaped the focus dialog');

      await escape();
      s = await focusState();
      assert(s.dialogOpen === false, 'Escape should close the dialog');
      assert(s.active === 'focusManageButton', 'focus should return to Edit focus, active=' + s.active);
      assert(s.activeInDialog === false, 'focus should leave the closed dialog');

      await tab();
      const nextActive = await evaluate(`document.activeElement.id`);
      assert(nextActive === 'focusIntentionEditButton', 'Tab from Edit focus should reach the intention button, got ' + nextActive);
      const outline = await evaluate(`(() => { const cs = getComputedStyle(document.activeElement); return { style: cs.outlineStyle, width: cs.outlineWidth, shadow: cs.boxShadow }; })()`);
      assert(outline.style !== 'none' && outline.width !== '0px', 'focused control should show a visible outline: ' + JSON.stringify(outline));

      await enter();
      s = await focusState();
      assert(s.formOpen === true, 'Enter on the intention button should open the editor');
      assert(s.active === 'focusIntentionInput', 'textarea should be focused, active=' + s.active);
      await escape();
      s = await focusState();
      assert(s.formOpen === false, 'Escape should close the intention editor');
      assert(s.active === 'focusIntentionEditButton', 'focus should return to the intention button');
      return { tabsToManage: tabs, dialogTabs: 30, outline, finalActive: s.active };
    });

    await test('regression', 'R10', 'Mobile navigation and focus target sizes still work', async () => {
      await seedTasks();
      await setFocus({ '0': { taskIds: ['t1', 't2'], intention: 'Mobile regression.' } }, 'light');
      await setViewport(VIEWPORTS[0]);
      await open('index.html');

      const sizes = await evaluate(`(() => {
        const rect = sel => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; };
        return {
          menu: rect('#mobileMenuButton'),
          manage: rect('#focusManageButton'),
          check: rect('#focusTaskList .focus-task-check'),
          remove: rect('#focusTaskList .focus-task-remove'),
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
        };
      })()`);
      await evaluate(`(() => {
        window.__menuClicks = 0;
        window.__resizes = 0;
        document.getElementById('mobileMenuButton').addEventListener('click', () => { window.__menuClicks += 1; });
        window.addEventListener('resize', () => { window.__resizes += 1; });
      })()`);
      assert(sizes.overflow <= 0, 'mobile page overflows horizontally: ' + sizes.overflow);
      assert(sizes.manage && sizes.manage.h >= 44, 'Edit focus target too small: ' + JSON.stringify(sizes.manage));
      assert(sizes.check && sizes.check.w >= 44 && sizes.check.h >= 44, 'checkbox target too small: ' + JSON.stringify(sizes.check));
      assert(sizes.remove && sizes.remove.w >= 44 && sizes.remove.h >= 44, 'remove target too small: ' + JSON.stringify(sizes.remove));

      await click('#mobileMenuButton');
      const timeline = [];
      for (const wait of [0, 250, 450, 700]) {
        if (wait) await sleep(wait);
        timeline.push(await evaluate(`(() => {
          const sb = document.getElementById('sidebarNav');
          const r = sb.getBoundingClientRect();
          return {
            open: sb.classList.contains('is-open'),
            x: Math.round(r.x),
            expanded: document.getElementById('mobileMenuButton').getAttribute('aria-expanded'),
            clicks: window.__menuClicks,
            resizes: window.__resizes,
            innerWidth,
            visibility: document.visibilityState,
            hasFocus: document.hasFocus(),
            transform: getComputedStyle(sb).transform,
            mq768: matchMedia('(max-width: 768px)').matches
          };
        })()`));
      }
      const nav = await evaluate(`(() => ({
        expanded: document.getElementById('mobileMenuButton').getAttribute('aria-expanded'),
        open: document.getElementById('sidebarNav').classList.contains('is-open'),
        inert: document.getElementById('sidebarNav').inert,
        links: Array.from(document.querySelectorAll('.sidebar .nav-link')).map(a => a.getAttribute('href'))
      }))()`);
      assert(nav.expanded === 'true' && nav.open === true && nav.inert === false, 'mobile menu did not open: ' + JSON.stringify(nav));
      assert(['index.html', 'tasks.html', 'overview.html', 'settings.html'].every(href => nav.links.indexOf(href) !== -1), 'navigation links missing: ' + nav.links.join(','));

      await sleep(650);
      const hit = await evaluate(`(() => {
        const link = document.querySelector('.sidebar .nav-link[href="tasks.html"]');
        const r = link.getBoundingClientRect();
        const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { tag: el ? el.tagName : null, href: el && el.closest ? (el.closest('a') ? el.closest('a').getAttribute('href') : null) : null, rect: { x: r.x, y: r.y, w: r.width, h: r.height } };
      })()`);
      assert(hit.href === 'tasks.html', 'nav link is not the pointer target: ' + JSON.stringify(hit) + ' timeline=' + JSON.stringify(timeline) + ' nav=' + JSON.stringify(nav));
      await click('.sidebar .nav-link[href="tasks.html"]');
      await waitReady('tasks.html');
      const tasksPage = await evaluate(`({ title: document.title, rows: document.querySelectorAll('#taskList .task-item').length })`);
      assert(tasksPage.rows === 6, 'tasks page did not load from mobile nav, rows=' + tasksPage.rows);
      await setViewport(VIEWPORTS[3]);
      return { sizes, nav, tasksPage };
    });

    /* -------------------------------------------------------------------- */
    /* 48-cell page / viewport / theme matrix                               */
    /* -------------------------------------------------------------------- */

    for (const file of PAGES) {
      if (SKIP_MATRIX) break;
      for (const theme of THEMES) {
        for (const vp of VIEWPORTS) {
          const label = file + ' / ' + vp.name + ' / ' + theme;
          errors = [];
          await setViewport(vp);
          if (theme === 'system') {
            await emulateScheme('dark');
          } else {
            await emulateScheme(null);
          }
          await seedTasks();
          await setFocus({ '0': { taskIds: ['t1', 't2'], intention: 'A calm day, one priority at a time.' } });
          await setTheme(theme);
          await open(file);

          let metrics = null;
          try {
            metrics = await evaluate(`(() => {
              const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
              const theme = document.documentElement.getAttribute('data-theme');
              const pref = document.documentElement.getAttribute('data-theme-preference');
              const main = document.getElementById('main-content');
              const visible = el => !!el && el.getClientRects().length > 0;
              let pageOk = true;
              let extra = {};
              if (${JSON.stringify(file)} === 'index.html') {
                const card = document.getElementById('focusCard');
                pageOk = visible(card) && visible(document.getElementById('focusTaskList'));
                extra = { focusItems: document.querySelectorAll('#focusTaskList .focus-task').length, dueToday: document.getElementById('dashboardDueToday').textContent };
              } else if (${JSON.stringify(file)} === 'tasks.html') {
                pageOk = visible(document.getElementById('taskList')) && document.querySelectorAll('#taskList .task-item').length === 6;
                extra = { rows: document.querySelectorAll('#taskList .task-item').length };
              } else if (${JSON.stringify(file)} === 'overview.html') {
                pageOk = visible(document.getElementById('overviewWeekRange')) && document.getElementById('overviewWeekRange').textContent.length > 0;
                extra = { range: document.getElementById('overviewWeekRange').textContent };
              } else {
                pageOk = visible(document.getElementById('themeOptions')) && visible(document.getElementById('settingsTaskCount'));
                extra = { count: document.getElementById('settingsTaskCount').textContent, themeStatus: document.getElementById('themeStatus').hidden };
              }
              return { overflow, theme, pref, main: visible(main), pageOk, extra };
            })()`);
          } catch (error) {
            metrics = { error: String(error.message || error), overflow: 999, pageOk: false };
          }

          if (file === 'index.html') {
            await evaluate(`document.getElementById('focusCard').scrollIntoView({ block: 'start' })`);
            await sleep(120);
          }
          const shotName = 'acceptance-matrix-' + file.replace('.html', '') + '-' + vp.name + '-' + theme + '.png';
          try {
            await screenshot(shotName);
          } catch (shotError) {
            errors.push('screenshot: ' + String(shotError.message || shotError));
          }

          const ok = metrics && metrics.overflow <= 0 && metrics.pageOk && metrics.main && errors.length === 0;
          results.matrix.push({
            page: file, viewport: vp.name, width: vp.w, height: vp.h, theme,
            status: ok ? 'pass' : 'fail',
            metrics, consoleErrors: errors.slice(), screenshot: shotName
          });
          if (!ok) {
            console.log('FAIL matrix', label, JSON.stringify(metrics), errors.join(' | '));
          } else {
            console.log('PASS matrix', label);
          }
        }
      }
    }

    await emulateScheme(null);
    await emulateReducedMotion(false);

    /* -------------------------------------------------------------------- */
    /* Reduced motion check (part of the functional evidence)               */
    /* -------------------------------------------------------------------- */

    errors = [];
    let reduced = null;
    try {
      await seedTasks();
      await setFocus({ '0': { taskIds: ['t1', 't2'], intention: 'Reduced motion check.' } }, 'light');
      await emulateReducedMotion(true);
      await setViewport(VIEWPORTS[3]);
      await open('index.html');
      reduced = await evaluate(`(() => {
        const fill = document.getElementById('focusProgressFill');
        const task = document.querySelector('#focusTaskList .focus-task');
        const cs = getComputedStyle(fill);
        const cs2 = task ? getComputedStyle(task) : null;
        return { fillTransition: cs.transitionDuration, taskTransition: cs2 ? cs2.transitionDuration : null };
      })()`);
      const isReduced = value => {
        if (!value) return false;
        return value.split(',').every(part => parseFloat(part) <= 0.001);
      };
      assert(isReduced(reduced.fillTransition), 'focus progress transition not reduced: ' + reduced.fillTransition);
      assert(isReduced(reduced.taskTransition), 'focus task transition not reduced: ' + reduced.taskTransition);
      results.accessibility.push({
        id: 'A1', name: 'Reduced motion disables Daily Focus transitions',
        status: 'pass', details: reduced, consoleErrors: errors.slice()
      });
      console.log('PASS A1 reduced motion');
    } catch (error) {
      results.accessibility.push({
        id: 'A1', name: 'Reduced motion disables Daily Focus transitions',
        status: 'fail', error: String(error.message || error), consoleErrors: errors.slice()
      });
      console.log('FAIL A1 reduced motion', String(error.message || error));
    } finally {
      await emulateReducedMotion(false);
    }

    results.externalRequests = Array.from(new Set(externalRequests));
    results.failedRequests = failedRequests;
    results.release.push({
      id: 'N1',
      name: 'No external network requests',
      status: results.externalRequests.length === 0 ? 'pass' : 'fail',
      details: { externalRequests: results.externalRequests, failedRequestCount: failedRequests.length },
      consoleErrors: []
    });
    if (results.externalRequests.length) {
      console.log('FAIL N1 external requests ::', results.externalRequests.join(' | '));
    } else {
      console.log('PASS N1 no external network requests');
    }

    results.finishedAt = new Date().toISOString();

    const counts = {
      functional: results.functional.reduce((acc, t) => { acc[t.status] = (acc[t.status] || 0) + 1; return acc; }, {}),
      regression: results.regression.reduce((acc, t) => { acc[t.status] = (acc[t.status] || 0) + 1; return acc; }, {}),
      accessibility: results.accessibility.reduce((acc, t) => { acc[t.status] = (acc[t.status] || 0) + 1; return acc; }, {}),
      release: results.release.reduce((acc, t) => { acc[t.status] = (acc[t.status] || 0) + 1; return acc; }, {}),
      matrix: results.matrix.reduce((acc, t) => { acc[t.status] = (acc[t.status] || 0) + 1; return acc; }, {})
    };
    results.counts = counts;

    fs.writeFileSync(path.join(OUT, 'acceptance-results.json'), JSON.stringify(results, null, 2));

    console.log('\nSUMMARY', JSON.stringify(counts));
    const failures = [...results.functional, ...results.regression, ...results.accessibility, ...results.release, ...results.matrix].filter(t => t.status === 'fail');
    if (failures.length) {
      console.log('FAILURES:');
      failures.forEach(f => console.log(' -', f.id || (f.page + '/' + f.viewport + '/' + f.theme), f.error || JSON.stringify(f.metrics) || ''));
      process.exitCode = 1;
    }

    ws.close();
    child.kill();
  } catch (error) {
    try { if (ws) ws.close(); } catch (e) { /* ignore */ }
    child.kill();
    console.error('AUDIT ABORTED', error);
    process.exitCode = 1;
  }
}

main();
