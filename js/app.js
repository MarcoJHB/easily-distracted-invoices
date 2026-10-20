// App shell: connect screen, navigation, routing, sync status.
import { store } from './store.js';
import { esc, todayISO } from './util.js';
import { icons, modal, toast, confirmDialog } from './ui.js';
import { renderInvoices } from './view-invoices.js';
import { renderEditor } from './view-editor.js';
import { renderClients } from './view-clients.js';
import { renderSettings } from './view-settings.js';
import { getRate } from './rates.js';

const app = document.getElementById('app');
let cleanup = null;
let guard = null;
let lastHash = location.hash;
let ignoreNextHash = false;

function navigate(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

// ---------- connect screen ----------
function renderConnect(error = '') {
  const prev = (() => { try { return JSON.parse(localStorage.getItem('edg.lastRepo') || '{}'); } catch { return {}; } })();
  app.innerHTML = `
    <div class="connect">
      <div class="connect-card">
        <img src="assets/logo.png" alt="" class="connect-logo">
        <h1>Easily Distracted Invoices</h1>
        <p class="sub">Your invoices live in a <b>private GitHub repo</b> that only you can read. This page holds no data of its own.</p>
        <ol class="connect-steps">
          <li><b>Make a private repo</b> on GitHub called <code>invoice-data</code> (tick “Add a README”).</li>
          <li><b>Make a key</b> for it: <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">fine-grained token</a> → only that repo → <i>Contents: Read and write</i>. <a href="#" data-act="howto">Step by step</a></li>
          <li><b>Paste it below.</b> It’s remembered in this browser only.</li>
        </ol>
        ${error ? `<p class="warnbox" role="alert">${esc(error)}</p>` : ''}
        <form class="connect-form" novalidate>
          <div class="grid2">
            <label class="field"><span class="field-label">GitHub username</span><input name="owner" value="${esc(prev.owner || '')}" required autocomplete="username" spellcheck="false" placeholder="your-username"></label>
            <label class="field"><span class="field-label">Private data repo</span><input name="repo" value="${esc(prev.repo || 'invoice-data')}" required spellcheck="false"></label>
            <label class="field full"><span class="field-label">Access token</span><input name="token" type="password" required autocomplete="current-password" spellcheck="false" placeholder="github_pat_…">
              <small class="field-hint">Starts with <code>github_pat_</code>.</small></label>
          </div>
          <details class="advanced"><summary>Advanced</summary>
            <div class="grid2">
              <label class="field"><span class="field-label">Branch</span><input name="branch" value="${esc(prev.branch || '')}" placeholder="default branch"></label>
              <label class="field"><span class="field-label">File path</span><input name="path" value="${esc(prev.path || 'data/ledger.json')}"></label>
            </div>
          </details>
          <label class="check"><input type="file" accept=".json,application/json" name="starter" class="sr-only" data-role="starter"><span class="link-btn" data-role="starterlabel">${icons.upload} Load a starter or backup file (optional)</span></label>
          <button class="btn btn-primary btn-lg" type="submit">${icons.cloud}Connect</button>
        </form>
        <div class="connect-alt">
          <span>or</span>
          <button class="btn btn-ghost" data-act="local">Try it in this browser only</button>
        </div>
        <p class="fineprint center">Browser-only data doesn’t sync and is lost if you clear your browsing data.</p>
      </div>
    </div>`;

  let starter = null;
  try {
    const pending = JSON.parse(sessionStorage.getItem('edg.pendingImport') || 'null');
    if (pending) starter = pending;
  } catch { /* ignore */ }
  const form = app.querySelector('form');
  if (starter) app.querySelector('[data-role=starterlabel]').innerHTML = `${icons.check} Your browser-only invoices will be moved into the repo (if it's empty)`;
  app.querySelector('[data-role=starter]').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      starter = JSON.parse(await f.text());
      app.querySelector('[data-role=starterlabel]').innerHTML = `${icons.check} ${esc(f.name)} will be used if the repo has no invoices yet`;
    } catch {
      toast('That file isn’t valid JSON', { type: 'error' });
    }
  });
  app.querySelector('[data-act=howto]').addEventListener('click', (e) => {
    e.preventDefault();
    modal({
      title: 'Create your private data repo',
      body: `<ol class="steps">
        <li>On GitHub, create a new repository called <code>invoice-data</code> and set it to <b>Private</b>. Tick “Add a README” so it isn’t empty.</li>
        <li>Go to <b>Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token</b>.</li>
        <li>Repository access: <b>Only select repositories</b>, then pick <code>invoice-data</code>.</li>
        <li>Permissions → Repository → <b>Contents: Read and write</b>. Nothing else is needed.</li>
        <li>Pick an expiry (a year is fine), generate it, and paste it here. The token is stored only in this browser.</li>
      </ol>`,
      actions: [{ label: 'Got it', value: true, kind: 'primary', submit: true }],
    });
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(form));
    if (!v.owner.trim() || !v.repo.trim() || !v.token.trim()) {
      toast('Fill in your username, repo and token', { type: 'error' });
      return;
    }
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Connecting…';
    const conn = {
      mode: 'github',
      owner: v.owner.trim(),
      repo: v.repo.trim().replace(/^.*\//, ''),
      token: v.token.trim(),
      branch: v.branch.trim(),
      path: (v.path || 'data/ledger.json').trim().replace(/^\/+/, ''),
    };
    try {
      const res = await store.connect(conn, { firstData: starter });
      if (starter && !res.usedStarter) toast('Your repo already had data, so the starter file wasn’t used', { timeout: 7000 });
      try { sessionStorage.removeItem('edg.pendingImport'); } catch { /* ignore */ }
      try { localStorage.setItem('edg.lastRepo', JSON.stringify({ owner: conn.owner, repo: conn.repo, branch: v.branch.trim(), path: conn.path })); } catch { /* ignore */ }
      if (store.conn.repoIsPrivate === false) {
        await modal({
          title: 'This repo is public',
          body: '<p class="modal-text">Anyone could read your invoices and bank details. Make the repo private on GitHub (Settings → Change visibility) as soon as you can.</p>',
          actions: [{ label: 'I’ll fix it', value: true, kind: 'primary', submit: true }],
        });
      }
      start();
    } catch (err) {
      store.disconnect();
      renderConnect(err.message || String(err));
    }
  });
  app.querySelector('[data-act=local]').addEventListener('click', async () => {
    await store.connect({ mode: 'local' }, { firstData: starter });
    start();
  });
}

// ---------- shell ----------
const NAV = [
  ['#/invoices', 'Invoices', icons.invoice],
  ['#/clients', 'Clients', icons.users],
  ['#/revenue', 'Revenue', icons.chart],
  ['#/settings', 'Settings', icons.gear],
];

function renderShell() {
  app.innerHTML = `
    <div class="shell">
      <aside class="side">
        <a class="brand" href="#/invoices"><img src="assets/logo.png" alt=""><span><b>Easily Distracted</b><small>Invoices</small></span></a>
        <nav class="nav" aria-label="Main">
          ${NAV.map(([h, l, ic]) => `<a href="${h}" data-nav="${h}">${ic}<span>${l}</span>${h === '#/revenue' ? '<em>Soon</em>' : ''}</a>`).join('')}
        </nav>
        <div class="sync" data-role="sync" role="status" aria-live="polite"></div>
      </aside>
      <main class="main" id="main" tabindex="-1"></main>
      <nav class="tabbar" aria-label="Main">
        ${NAV.map(([h, l, ic]) => `<a href="${h}" data-nav="${h}">${ic}<span>${l}</span></a>`).join('')}
      </nav>
    </div>`;

  const syncEl = app.querySelector('[data-role=sync]');
  store.onSync((s) => {
    const cls = { saved: 'ok', local: 'ok', saving: 'busy', pending: 'busy', loading: 'busy', offline: 'warn', error: 'bad', conflict: 'bad', idle: '' }[s.state] || '';
    const label = { saved: 'Synced', local: 'This browser only', saving: 'Saving…', pending: 'Saving…', loading: 'Loading…', offline: 'Offline', error: 'Sync problem', conflict: 'Conflict', idle: '' }[s.state] || '';
    syncEl.className = `sync sync-${cls}`;
    syncEl.innerHTML = `<i></i><span><b>${esc(label)}</b><small>${esc(s.message || '')}</small></span>${s.state === 'error' ? '<a href="#/settings/data">Fix</a>' : ''}`;
    syncEl.title = s.message || '';
  });
}

function renderRevenue(root) {
  root.innerHTML = `
    <div class="page-head"><div><h1>Revenue</h1><p class="sub">Month-to-month income from YouTube, sponsors and everything else.</p></div></div>
    <section class="card soon">
      <h2>Coming next</h2>
      <p>The invoice section comes first. Next up here:</p>
      <ul>
        <li>Enter your AdSense payout and any other income for each month</li>
        <li>Paid sponsor invoices drop in automatically, in the euros you actually received</li>
        <li>A month-by-month chart and a year-to-date total, with your micro-entrepreneur ceiling for reference</li>
      </ul>
      <a href="#/invoices" class="btn btn-soft">${icons.invoice}Go to invoices</a>
    </section>`;
}

function route() {
  const hash = location.hash || '#/invoices';
  const [path, query = ''] = hash.slice(1).split('?');
  const parts = path.split('/').filter(Boolean);
  const params = new URLSearchParams(query);
  const main = document.getElementById('main');
  if (!main) return;

  cleanup?.();
  cleanup = null;
  guard = null;
  main.innerHTML = '';
  const view = document.createElement('div');
  view.className = 'view';
  main.appendChild(view);

  const top = parts[0] || 'invoices';
  app.querySelectorAll('[data-nav]').forEach((a) => {
    const on = a.dataset.nav === `#/${top}`;
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });

  const ctx = { navigate, params, setGuard: (fn) => { guard = fn; } };
  let title = 'Invoices';
  if (top === 'invoices' && parts[1]) {
    cleanup = renderEditor(view, { ...ctx, id: parts[1] });
    title = parts[1] === 'new' ? 'New invoice' : 'Invoice';
  } else if (top === 'clients') {
    renderClients(view, ctx);
    title = 'Clients';
  } else if (top === 'settings') {
    cleanup = renderSettings(view, { ...ctx, section: parts[1] });
    title = 'Settings';
  } else if (top === 'revenue') {
    renderRevenue(view);
    title = 'Revenue';
  } else {
    if (top !== 'invoices') history.replaceState(null, '', '#/invoices');
    cleanup = renderInvoices(view, ctx);
  }
  document.title = `${title} · Easily Distracted Invoices`;
  main.scrollTop = 0;
  window.scrollTo(0, 0);
  lastHash = location.hash;
}

window.addEventListener('hashchange', async () => {
  if (ignoreNextHash) {
    ignoreNextHash = false;
    return;
  }
  if (guard) {
    const msg = guard();
    if (msg) {
      const target = location.hash;
      // put the editor back on top of history (pushState doesn't fire hashchange)
      history.pushState(null, '', lastHash);
      const ok = await confirmDialog(msg, { title: 'Unsaved changes', ok: 'Leave without saving', danger: true });
      if (!ok) return;
      guard = null;
      location.hash = target;
      return;
    }
  }
  route();
});

window.addEventListener('beforeunload', (e) => {
  const msg = guard?.() || (store.dirty && store.conn?.mode === 'github' ? 'unsynced' : null);
  if (msg) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// keyboard shortcuts: N = new invoice, / = search
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest('input, textarea, select, [contenteditable]') || document.querySelector('.modal-wrap')) return;
  if (e.key === '/') {
    const s = document.querySelector('.search input');
    if (s) { e.preventDefault(); s.focus(); }
  }
  if (e.key.toLowerCase() === 'n' && store.data) {
    e.preventDefault();
    navigate('#/invoices/new');
  }
});

window.addEventListener('online', () => store.retry());
setInterval(() => store.retry(), 60000);
// refresh from GitHub when you come back to the tab (e.g. after editing on your phone)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && store.conn?.mode === 'github' && !store.dirty && !guard?.()) store.pull().catch(() => {});
});

store.onMerged = (clashes, renumbered = []) => {
  let msg = 'Merged changes from another device.';
  if (clashes) msg += ` ${clashes} item${clashes === 1 ? ' had' : 's had'} the same field edited on both, so the newer edit was kept (a copy is in Settings → Data).`;
  if (renumbered.length) msg += ` Duplicate invoice number fixed: ${renumbered.join(', ')}.`;
  toast(msg, { timeout: 9000 });
};

// Fill in exchange rates for USD invoices that don't have one yet (e.g. imported ones).
async function backfillRates() {
  const missing = store.data.invoices.filter((i) => i.currency === 'USD' && !i.rateToEur && i.status !== 'paid');
  for (const inv of missing) {
    try {
      const r = await getRate('USD', 'EUR', inv.issueDate);
      store.update((d) => {
        const x = d.invoices.find((y) => y.id === inv.id);
        if (x && !x.rateToEur) Object.assign(x, { rateToEur: Number(r.rate.toFixed(6)), rateDate: r.date, rateSource: 'ecb', updatedAt: new Date().toISOString() });
      });
    } catch {
      return; // offline: try again next time
    }
  }
}

async function start() {
  renderShell();
  route();
  setTimeout(backfillRates, 1500);
}

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

async function boot() {
  app.innerHTML = '<div class="boot"><img src="assets/logo.png" alt=""><p>Loading your invoices…</p></div>';
  try {
    const ok = await store.init();
    if (!ok) {
      renderConnect();
      return;
    }
    start();
    // fresh data from GitHub (another device): redraw, unless you're editing something
    store.on((_, reason) => {
      if (reason !== 'remote') return;
      const editing = /^#\/invoices\/./.test(location.hash) || location.hash.startsWith('#/settings');
      if (!editing && !document.querySelector('.modal-wrap')) route();
    });
  } catch (e) {
    if (e?.kind === 'auth' || e?.kind === 'notfound') {
      store.disconnect();
      renderConnect(`${e.message} Sign in again${e.kind === 'auth' ? ' with a fresh token' : ''}.`);
      return;
    }
    app.innerHTML = `<div class="connect"><div class="connect-card"><img src="assets/logo.png" alt="" class="connect-logo">
      <h1>Can’t load your invoices</h1><p class="warnbox" role="alert">${esc(e.message || String(e))}</p>
      <div class="btn-row"><button class="btn btn-primary" data-act="retry">${icons.refresh}Try again</button>
      <button class="btn btn-ghost" data-act="signout">Sign out on this device</button></div></div></div>`;
    app.querySelector('[data-act=retry]').addEventListener('click', () => boot());
    app.querySelector('[data-act=signout]').addEventListener('click', () => { store.disconnect(); renderConnect(); });
  }
  void todayISO;
}

boot();
