// App state: the ledger (settings, clients, invoices), the device connection,
// and syncing to GitHub with an offline cache in localStorage.

import { loadFile, saveFile, checkRepo, GitHubError } from './github.js';
import { clone, round2, todayISO, uid, debounce, splitCampaignMonth } from './util.js';
import { defaultTaxSettings, normalizeRevenue } from './revenue.js';

const CONN_KEY = 'edg.connection.v1';
const CACHE_KEY = 'edg.ledger.cache.v1';

export const SCHEMA_VERSION = 1;

// Defaults hold no personal data on purpose: the code may live in a public repo.
// Your real details live only in the private data file.
export function defaultLedger() {
  return {
    version: SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    settings: {
      business: {
        name: '',
        tradeName: 'Easily Distracted Games',
        legalForm: 'EI',
        addressLines: '',
        country: 'France',
        email: '',
        phone: '',
        siret: '',
        vatNumber: '', // your intra-EU VAT number (FR..), needed to bill EU businesses
      },
      bank: { accountName: '', accountNumber: '', routingNumber: '', iban: '', swift: '', bank: '', wisetag: '' },
      invoice: {
        prefix: 'A',
        padding: 5,
        nextNumber: 1,
        defaultCurrency: 'USD',
        defaultTermsDays: 30,
        reminderOffsetDays: 0,
        showLegal: true,
        natureOfOperation: 'Provision of services (prestation de services)',
        vatMention: 'VAT not applicable, art. L. 223-3 CIBS (TVA non applicable, art. L. 223-3 du CIBS)',
        reverseChargeMention:
          'Reverse charge: VAT to be accounted for by the customer (Autoliquidation de la TVA par le preneur – art. 283-2 du CGI, art. 44 & 196 Directive 2006/112/CE).',
        latePenalty: '', // left off at your request; add wording in Settings if you ever want it
        extraTerms: '',
        fileNameTemplate: 'invoice-{number}-{business}-{client}-{campaign}',
        fileNameSlug: true,
        signatureLabel: 'Authorised Signatory',
      },
      signature: null, // data URL (transparent PNG)
      tax: defaultTaxSettings(),
      savedItems: [
        { id: 'item_integrated', title: 'Integrated Video (60-90s)', rate: 0, currency: 'USD' },
        { id: 'item_dedicated', title: 'Dedicated Video', rate: 0, currency: 'USD' },
        { id: 'item_short', title: 'YouTube Short', rate: 0, currency: 'USD' },
      ],
    },
    clients: [],
    invoices: [],
    revenue: [], // month-to-month income entries (next phase)
  };
}

// Fill in anything missing so older files keep working as fields are added.
export function isLedgerShape(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  for (const k of ['clients', 'invoices', 'revenue']) if (k in data && !Array.isArray(data[k])) return false;
  if ('settings' in data && (typeof data.settings !== 'object' || Array.isArray(data.settings) || data.settings === null)) return false;
  return true;
}

// One AdSense entry per earned month: a real paid amount beats an estimate, then the newest edit.
export function dedupeAdsense(list) {
  const best = new Map();
  for (const e of list) {
    if (e.type !== 'adsense') continue;
    const cur = best.get(e.earnedMonth);
    const better = !cur
      || (cur.estimated && !e.estimated)
      || (cur.estimated === e.estimated && (e.updatedAt || '') > (cur.updatedAt || ''));
    if (better) best.set(e.earnedMonth, e);
  }
  return list.filter((e) => e.type !== 'adsense' || best.get(e.earnedMonth) === e);
}

export function migrate(data) {
  const base = defaultLedger();
  const out = { ...base, ...(data || {}) };
  out.settings = { ...base.settings, ...(data?.settings || {}) };
  out.settings.business = { ...base.settings.business, ...(data?.settings?.business || {}) };
  out.settings.bank = { ...base.settings.bank, ...(data?.settings?.bank || {}) };
  out.settings.invoice = { ...base.settings.invoice, ...(data?.settings?.invoice || {}) };
  out.settings.tax = { ...base.settings.tax, ...(data?.settings?.tax || {}) };
  if (!Array.isArray(out.settings.tax.declared)) out.settings.tax.declared = [];
  const objs = (arr) => (Array.isArray(arr) ? arr.filter((x) => x && typeof x === 'object' && !Array.isArray(x)) : []);
  out.settings.savedItems = Array.isArray(data?.settings?.savedItems)
    ? objs(data.settings.savedItems).map((it) => ({ id: it.id || uid('item'), title: String(it.title ?? ''), rate: Number(it.rate) || 0, currency: it.currency === 'EUR' ? 'EUR' : 'USD' }))
    : base.settings.savedItems;
  out.clients = objs(out.clients).map((c) => ({ ...c, id: c.id || uid('cli'), name: String(c.name ?? 'Unnamed client') }));
  out.invoices = objs(out.invoices).map(normalizeInvoice);
  out.revenue = dedupeAdsense(objs(out.revenue).map(normalizeRevenue));
  out.version = SCHEMA_VERSION;
  return out;
}

export function normalizeInvoice(inv) {
  let campaign = inv.campaign || '';
  let campaignMonth = /^\d{4}-\d{2}$/.test(inv.campaignMonth || '') ? inv.campaignMonth : '';
  if (!campaignMonth && inv.campaignMonth === undefined) {
    const split = splitCampaignMonth(campaign); // older invoices kept the month inside the name
    if (split) { campaign = split.name; campaignMonth = split.month; }
  }
  return {
    id: inv.id || uid('inv'),
    number: inv.number || '',
    status: ['new', 'waiting', 'paid'].includes(inv.status) ? inv.status : 'new',
    clientId: inv.clientId || '',
    client: inv.client || null, // snapshot of client details at the time of invoicing
    campaign,
    campaignMonth, // "2026-08": the month the campaign ran
    reference: inv.reference || '',
    issueDate: inv.issueDate || todayISO(),
    serviceDate: inv.serviceDate || '',
    termsDays: Number.isFinite(Number(inv.termsDays)) ? Number(inv.termsDays) : 30,
    dueDate: inv.dueDate || '',
    reminderDate: inv.reminderDate || '',
    currency: inv.currency === 'EUR' ? 'EUR' : 'USD',
    items: Array.isArray(inv.items) && inv.items.length ? inv.items : [{ title: '', description: '', qty: 1, rate: 0 }],
    rateToEur: Number(inv.rateToEur) || (inv.currency === 'EUR' ? 1 : 0),
    rateDate: inv.rateDate || '',
    rateSource: inv.rateSource || '',
    usdRate: Number(inv.usdRate) || 0, // USD->EUR rate kept on EUR invoices, for switching back
    notes: inv.notes || '',
    paidDate: inv.paidDate || '',
    paidAmountEur: inv.paidAmountEur ?? null,
    paidFees: Number(inv.paidFees) || 0, // bank fees taken off this payment (EUR)
    bankRef: inv.bankRef || '',
    remindersSent: Array.isArray(inv.remindersSent) ? inv.remindersSent : [],
    createdAt: inv.createdAt || new Date().toISOString(),
    updatedAt: inv.updatedAt || new Date().toISOString(),
  };
}

// ---------- computed values ----------
export function lineAmount(item) {
  return round2((Number(item.qty) || 0) * (Number(item.rate) || 0));
}
export function invoiceTotal(inv) {
  return round2((inv.items || []).reduce((sum, it) => sum + lineAmount(it), 0));
}
// EUR value: what you actually received once paid, otherwise the invoice-date estimate
export function invoiceEur(inv) {
  if (inv.status === 'paid' && inv.paidAmountEur != null && inv.paidAmountEur !== '') return round2(inv.paidAmountEur);
  if (inv.currency === 'EUR') return invoiceTotal(inv);
  return inv.rateToEur ? round2(invoiceTotal(inv) * inv.rateToEur) : null;
}
export function invoiceIn(inv, target, usdToEur) {
  const total = invoiceTotal(inv);
  if (target === inv.currency) return total;
  const eur = invoiceEur(inv);
  if (target === 'EUR') return eur;
  // target USD from EUR
  const rate = inv.currency === 'USD' && inv.rateToEur ? inv.rateToEur : usdToEur;
  if (!rate || eur == null) return null;
  return round2(eur / rate);
}

export function effectiveStatus(inv, today = todayISO()) {
  if (inv.status === 'paid') return 'paid';
  if (inv.status === 'waiting' && inv.dueDate && inv.dueDate < today) return 'overdue';
  return inv.status;
}
export function reminderDue(inv, today = todayISO()) {
  return inv.status === 'waiting' && !!inv.reminderDate && inv.reminderDate <= today;
}

export function formatNumber(settings, n) {
  const s = settings.invoice;
  return `${s.prefix || ''}${String(n).padStart(Number(s.padding) || 0, '0')}`;
}
export function numericPart(number, prefix) {
  const str = String(number || '');
  const rest = prefix && str.startsWith(prefix) ? str.slice(prefix.length) : str;
  const m = rest.match(/(\d+)\s*$/);
  return m ? Number(m[1]) : null;
}
export function nextInvoiceNumber(data) {
  const prefix = data.settings.invoice.prefix || '';
  let max = 0;
  for (const inv of data.invoices) {
    if (prefix && !String(inv.number).startsWith(prefix)) continue;
    const n = numericPart(inv.number, prefix);
    if (n && n > max) max = n;
  }
  const n = Math.max(max + 1, Number(data.settings.invoice.nextNumber) || 1);
  return formatNumber(data.settings, n);
}

export function clientSnapshot(client) {
  if (!client) return null;
  const { id, name, addressLines, country, vatNumber, siren, email, contactName, vatRule } = client;
  return { id, name, addressLines, country, vatNumber, siren, email, contactName, vatRule: vatRule || 'auto' };
}

const EU_VAT_PREFIX = /^(AT|BE|BG|CY|CZ|DE|DK|EE|EL|GR|ES|FI|HR|HU|IE|IT|LT|LU|LV|MT|NL|PL|PT|RO|SE|SI|SK)\s?[0-9A-Z]/i;

// Which VAT wording applies: 'reverse' for businesses in another EU country, else 'franchise'.
export function vatRuleFor(client) {
  if (!client) return 'franchise';
  if (client.vatRule && client.vatRule !== 'auto') return client.vatRule;
  return EU_VAT_PREFIX.test((client.vatNumber || '').trim()) ? 'reverse' : 'franchise';
}

// ---------- connection (per device) ----------
export function getConnection() {
  try {
    return JSON.parse(localStorage.getItem(CONN_KEY) || 'null');
  } catch {
    return null;
  }
}
export function setConnection(conn) {
  try {
    if (conn) localStorage.setItem(CONN_KEY, JSON.stringify(conn));
    else localStorage.removeItem(CONN_KEY);
  } catch { /* storage blocked */ }
}

function readCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
  } catch {
    return null;
  }
}
function writeCache(cache) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    return true;
  } catch {
    return false;
  }
}
export function clearCache() {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch { /* ignore */ }
}

// ---------- three-way merge ----------
// base = the version both devices last agreed on; local = this device; remote = GitHub now.
// Records are matched by id: whoever changed a record wins; if both did, the newest edit wins.
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function mergeList(base = [], local = [], remote = []) {
  const toMap = (arr) => new Map((arr || []).filter((x) => x && x.id).map((x) => [x.id, x]));
  const B = toMap(base), L = toMap(local), R = toMap(remote);
  const out = [];
  let clashes = 0;
  const order = [...L.keys(), ...[...R.keys()].filter((k) => !L.has(k))];
  for (const id of order) {
    const b = B.get(id), l = L.get(id), r = R.get(id);
    if (l && r) {
      if (same(l, r) || same(r, b)) out.push(l);
      else if (same(l, b)) out.push(r);
      else {
        // both edited the same record: combine field by field, newest edit wins a shared field
        const localNewer = (l.updatedAt || '') >= (r.updatedAt || '');
        const rec = {};
        let clash = false;
        for (const f of new Set([...Object.keys(l), ...Object.keys(r)])) {
          if (f === 'updatedAt') continue;
          const bv = b?.[f], lv = l[f], rv = r[f];
          if (same(lv, rv) || same(rv, bv)) rec[f] = lv;
          else if (same(lv, bv)) rec[f] = rv;
          else { clash = true; rec[f] = localNewer ? lv : rv; }
        }
        rec.updatedAt = localNewer ? l.updatedAt : r.updatedAt;
        if (clash) clashes++;
        out.push(rec);
      }
    } else if (l) {
      if (b && same(l, b)) continue; // deleted on the other device, untouched here
      out.push(l); // new here, or edited here (an edit beats a delete)
    } else if (r) {
      if (b && same(r, b)) continue; // deleted here, untouched there
      out.push(r);
    }
  }
  return { list: out, clashes };
}

function mergeValue(base, local, remote) {
  if (same(local, remote) || same(remote, base)) return local;
  if (same(local, base)) return remote;
  return local; // both changed the same setting: this device wins
}

export function mergeLedgers(base, local, remote) {
  base = base ? migrate(base) : { settings: {}, clients: [], invoices: [], revenue: [] };
  local = migrate(local);
  remote = migrate(remote);
  const out = migrate(local);
  let clashes = 0;
  for (const key of ['clients', 'invoices', 'revenue']) {
    const m = mergeList(base[key], local[key], remote[key]);
    out[key] = m.list;
    clashes += m.clashes;
  }
  const st = {};
  for (const key of new Set([...Object.keys(local.settings), ...Object.keys(remote.settings)])) {
    if (key === 'savedItems') {
      const m = mergeList(base.settings.savedItems, local.settings.savedItems, remote.settings.savedItems);
      st.savedItems = m.list;
    } else if (local.settings[key] && typeof local.settings[key] === 'object' && !Array.isArray(local.settings[key])) {
      // merge field by field (business, bank, invoice)
      const b = base.settings[key] || {}, l = local.settings[key] || {}, r = remote.settings[key] || {};
      st[key] = {};
      for (const f of new Set([...Object.keys(l), ...Object.keys(r)])) st[key][f] = mergeValue(b[f], l[f], r[f]);
    } else {
      st[key] = mergeValue(base.settings[key], local.settings[key], remote.settings[key]);
    }
  }
  out.settings = migrate({ settings: st }).settings;
  out.updatedAt = new Date().toISOString();
  return { data: out, clashes };
}

// Two devices can both create "A00021" offline. Renumber this device's unsent copy.
function fixDuplicateNumbers(data, remote) {
  const remoteIds = new Set((remote.invoices || []).map((i) => i.id));
  const changes = [];
  const seen = new Map();
  for (const inv of data.invoices) {
    const key = String(inv.number).trim().toLowerCase();
    if (!seen.has(key)) { seen.set(key, inv); continue; }
    // keep the one GitHub already has; move the local-only one
    const other = seen.get(key);
    const loser = remoteIds.has(inv.id) && !remoteIds.has(other.id) ? other : inv;
    const winner = loser === inv ? other : inv;
    seen.set(key, winner);
    const old = loser.number;
    loser.number = nextInvoiceNumber(data);
    loser.updatedAt = new Date().toISOString();
    changes.push(`${old} → ${loser.number}`);
  }
  return changes;
}

// Keeps the last few pre-merge copies on this device, just in case.
function backupLocal(data, reason) {
  try {
    const key = 'edg.backups.v1';
    const list = JSON.parse(localStorage.getItem(key) || '[]');
    const slim = clone(data);
    if (slim.settings) slim.settings.signature = null; // keep backups small
    list.unshift({ at: new Date().toISOString(), reason, data: slim });
    localStorage.setItem(key, JSON.stringify(list.slice(0, 3)));
  } catch { /* storage full: skip */ }
}
export function localBackups() {
  try { return JSON.parse(localStorage.getItem('edg.backups.v1') || '[]'); } catch { return []; }
}

// ---------- the store ----------
class Store {
  constructor() {
    this.data = null;
    this.base = null; // last version known to be on GitHub (for merging)
    this.conn = null;
    this.sha = null; // sha of the GitHub version our data is based on
    this.dirty = false; // local changes not yet on GitHub
    this.sync = { state: 'idle', message: '' };
    this.listeners = new Set();
    this.syncListeners = new Set();
    this.onMerged = null; // (clashes) => void
    this.pushPromise = null;
    this.pullPromise = null;
    this.conflictRetries = 0;
    this.scheduleSync = debounce(() => this.pushNow(), 1200);
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  onSync(fn) {
    this.syncListeners.add(fn);
    fn(this.sync);
    return () => this.syncListeners.delete(fn);
  }
  emit(reason = 'local') {
    for (const fn of this.listeners) fn(this.data, reason);
  }
  setSync(state, message = '') {
    this.sync = { state, message, at: Date.now() };
    for (const fn of this.syncListeners) fn(this.sync);
  }

  persistCache() {
    const ok = writeCache({ data: this.data, base: this.dirty ? this.base : null, sha: this.sha, dirty: this.dirty, mode: this.conn?.mode, repo: this.repoKey() });
    if (!ok) this.setSync('error', 'This browser blocked local storage, so changes only live until you close the tab.');
  }
  repoKey() {
    const c = this.conn;
    return c && c.mode === 'github' ? `${c.owner}/${c.repo}@${c.branch}:${c.path}` : 'local';
  }

  // Start up. Returns false when the device still needs connecting.
  async init() {
    this.conn = getConnection();
    if (!this.conn) return false;
    const cache = readCache();
    const cacheMatches = cache && cache.repo === this.repoKey() && cache.data;
    if (cacheMatches) {
      this.data = migrate(cache.data);
      this.base = cache.base || null;
      this.sha = cache.sha || null;
      this.dirty = !!cache.dirty;
    }
    if (this.conn.mode === 'local') {
      if (!this.data) this.data = defaultLedger();
      this.setSync('local', 'Saved in this browser only');
      return true;
    }
    if (this.data) {
      // show cached data straight away, then refresh from GitHub
      this.pull().catch(() => {});
      return true;
    }
    await this.pull();
    return true;
  }

  // One pull at a time; later callers share the running one.
  pull(opts) {
    if (this.conn?.mode !== 'github') return Promise.resolve();
    if (!this.pullPromise) {
      this.pullPromise = this.doPull(opts).finally(() => { this.pullPromise = null; });
    }
    return this.pullPromise;
  }

  async doPull({ firstData = null } = {}) {
    if (this.pushPromise) await this.pushPromise.catch(() => {});
    this.setSync('loading', 'Loading from GitHub…');
    try {
      const remote = await loadFile(this.conn);
      if (!remote) {
        // brand-new data file: create it in one go (with the starter if given)
        this.data = firstData ? migrate(firstData) : (this.data || defaultLedger());
        this.createdWithStarter = !!firstData;
        this.sha = null;
        this.base = null;
        this.dirty = true;
        this.persistCache();
        this.emit('remote');
        await this.pushNow('Create invoice data file');
        return;
      }
      const remoteData = migrate(remote.data);
      if (remote.sha === this.sha) {
        if (this.dirty) await this.pushNow();
        else this.setSync('saved', 'Synced with GitHub');
        return;
      }
      if (this.dirty && this.data) {
        // both sides changed since we last synced: merge instead of picking one
        backupLocal(this.data, 'before merging changes from another device');
        const { data, clashes } = mergeLedgers(this.base, this.data, remoteData);
        const renumbered = fixDuplicateNumbers(data, remoteData);
        this.data = data;
        this.base = remote.data;
        this.sha = remote.sha;
        this.persistCache();
        this.emit('remote');
        this.onMerged?.(clashes, renumbered);
        await this.pushNow('Merge changes from two devices');
        return;
      }
      this.data = remoteData;
      this.base = remote.data;
      this.sha = remote.sha;
      this.dirty = false;
      this.conflictRetries = 0;
      this.persistCache();
      this.setSync('saved', 'Synced with GitHub');
      this.emit('remote');
    } catch (e) {
      this.handleError(e);
      if (!this.data) throw e;
    }
  }

  handleError(e) {
    if (e instanceof GitHubError) {
      if (e.kind === 'network') this.setSync('offline', 'Offline – changes are kept on this device and will sync later');
      else this.setSync('error', e.message);
    } else {
      this.setSync('error', String(e?.message || e));
    }
  }

  pushNow(message) {
    if (this.pushPromise) {
      this.pushAgain = true;
      return this.pushPromise;
    }
    this.pushPromise = this.doPush(message).finally(() => {
      this.pushPromise = null;
      if (this.pushAgain) {
        this.pushAgain = false;
        if (this.dirty && this.sync.state !== 'error') this.scheduleSync();
      }
    });
    return this.pushPromise;
  }

  async doPush(message) {
    if (!this.dirty || !this.data) return;
    if (this.conn?.mode !== 'github') {
      this.dirty = false;
      this.persistCache();
      this.setSync('local', 'Saved in this browser only');
      return;
    }
    this.setSync('saving', 'Saving to GitHub…');
    let conflict = false;
    try {
      const snapshot = clone(this.data);
      const { sha } = await saveFile(this.conn, snapshot, this.sha, message);
      this.sha = sha;
      this.base = snapshot;
      this.conflictRetries = 0;
      // only clear dirty if nothing changed while we were saving
      if (same(snapshot, this.data)) this.dirty = false;
      this.persistCache();
      if (this.dirty) {
        this.setSync('pending', 'Unsaved changes…');
        this.scheduleSync();
      } else {
        this.setSync('saved', 'All changes saved to GitHub');
      }
    } catch (e) {
      if (e instanceof GitHubError && e.kind === 'conflict') conflict = true;
      else this.handleError(e);
    }
    if (conflict) {
      this.conflictRetries++;
      if (this.conflictRetries > 3) {
        this.setSync('error', 'GitHub keeps rejecting the save. Your changes are safe on this device. Try “Sync now” in a minute.');
        this.conflictRetries = 0;
        return;
      }
      await new Promise((r) => setTimeout(r, 400 * this.conflictRetries));
      this.pushPromise = null; // let the pull merge, then push again
      await this.doPull();
    }
  }

  // Called when the browser comes back online or on a timer.
  retry() {
    if (this.conn?.mode === 'github' && this.dirty && ['offline', 'error'].includes(this.sync.state)) this.pushNow();
  }

  // All changes go through here.
  update(mutator) {
    // remember the last-synced version before the first unsynced edit (needed for merging)
    if (!this.dirty && this.conn?.mode === 'github') this.base = clone(this.data);
    const draft = this.data;
    mutator(draft);
    draft.updatedAt = new Date().toISOString();
    this.dirty = true;
    if (this.conn?.mode === 'github') {
      this.persistCache();
      this.setSync('pending', 'Unsaved changes…');
      this.scheduleSync();
    } else {
      this.dirty = false;
      this.persistCache();
      this.setSync('local', 'Saved in this browser only');
    }
    this.emit();
  }

  replaceAll(newData) {
    this.update((d) => {
      const m = migrate(newData);
      for (const k of Object.keys(d)) delete d[k];
      Object.assign(d, m);
    });
  }

  // Returns { usedStarter: bool }
  async connect(conn, { firstData } = {}) {
    if (conn.mode === 'github') {
      const info = await checkRepo(conn);
      conn.branch = conn.branch || info.defaultBranch || 'main';
      conn.repoIsPrivate = info.private;
    }
    const cache = readCache();
    setConnection(conn);
    this.conn = conn;
    if (cache && cache.repo !== this.repoKey()) clearCache();
    this.data = null;
    this.base = null;
    this.sha = null;
    this.dirty = false;
    if (conn.mode === 'local') {
      this.data = firstData ? migrate(firstData) : (cache?.repo === 'local' && cache.data ? migrate(cache.data) : defaultLedger());
      this.persistCache();
      this.setSync('local', 'Saved in this browser only');
      this.emit();
      return { usedStarter: !!firstData };
    }
    this.createdWithStarter = false;
    await this.pull({ firstData });
    if (this.createdWithStarter) return { usedStarter: true };
    const empty = this.data && !this.data.invoices.length && !this.data.clients.length && !this.data.settings.business.name;
    if (firstData && empty) {
      this.replaceAll(firstData);
      return { usedStarter: true };
    }
    return { usedStarter: false };
  }

  // Swap in a new token without touching data or unsynced edits.
  async updateToken(token) {
    const next = { ...this.conn, token };
    const info = await checkRepo(next);
    next.repoIsPrivate = info.private;
    this.conn = next;
    setConnection(next);
    await this.pushNow();
    await this.pull();
  }

  disconnect() {
    setConnection(null);
    clearCache();
    this.conn = null;
    this.data = null;
    this.base = null;
    this.sha = null;
    this.dirty = false;
  }

  // ---------- convenience accessors ----------
  get settings() {
    return this.data.settings;
  }
  client(id) {
    return this.data.clients.find((c) => c.id === id) || null;
  }
  invoice(id) {
    return this.data.invoices.find((i) => i.id === id) || null;
  }
}

export const store = new Store();
