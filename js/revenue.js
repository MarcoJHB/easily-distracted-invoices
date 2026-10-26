// Revenue maths: monthly totals, URSSAF contributions, declaration periods,
// thresholds, and reading bank statements. No DOM in here.

import { round2, todayISO, parseNumber, uid, slugify } from './util.js';
import { invoiceEur, effectiveStatus } from './store.js';

export const SOURCES = {
  adsense: { label: 'AdSense', color: 'var(--c-adsense)' },
  sponsor: { label: 'Sponsors', color: 'var(--c-sponsor)' },
};

// 2026 micro-entrepreneur rates (URSSAF), all editable in Settings → Tax & URSSAF.
export function defaultTaxSettings() {
  return {
    ratesYear: 2026,
    adsenseCategory: 'bnc', // AdSense → BNC
    sponsorCategory: 'bic', // sponsorships → BIC prestations de services
    bncRate: 25.6, // BNC (SSI, non-regulated liberal), 2026 (décret 2025-943)
    bicRate: 21.2, // BIC prestations de services
    bncCfp: 0.2, // formation professionnelle
    bicCfp: 0.1,
    versementLiberatoire: false,
    bncVl: 2.2,
    bicVl: 1.7,
    period: 'quarterly', // 'monthly' | 'quarterly'
    vatThreshold: 37500, // franchise en base, services
    vatThresholdHigh: 41250, // seuil majoré
    microCeiling: 83600, // plafond micro, services
    declared: [], // periods marked as declared, e.g. "2026-Q3" or "2026-09"
  };
}

export function categoryRate(tax, cat) {
  const base = cat === 'bnc' ? tax.bncRate : tax.bicRate;
  const cfp = cat === 'bnc' ? tax.bncCfp : tax.bicCfp;
  const vl = tax.versementLiberatoire ? (cat === 'bnc' ? tax.bncVl : tax.bicVl) : 0;
  return (Number(base) || 0) + (Number(cfp) || 0) + (Number(vl) || 0);
}
export function sourceRate(tax, type) {
  return categoryRate(tax, type === 'adsense' ? tax.adsenseCategory : tax.sponsorCategory);
}
export function taxOn(tax, type, amount) {
  return round2((amount * sourceRate(tax, type)) / 100);
}

// ---------- months ----------
export const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
export const monthOf = (iso) => (iso || '').slice(0, 7);
export const isMonth = (s) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s || '');
export function monthLabel(ym, short = false) {
  const [y, m] = ym.split('-').map(Number);
  return `${(short ? MONTHS_SHORT : MONTHS_LONG)[m - 1]} ${y}`;
}

// ---------- entries ----------
export function normalizeRevenue(e) {
  const type = e.type === 'adsense' ? 'adsense' : 'sponsor';
  const receivedDate = /^\d{4}-\d{2}-\d{2}$/.test(e.receivedDate || '') ? e.receivedDate : '';
  let earnedMonth = isMonth(e.earnedMonth) ? e.earnedMonth : '';
  if (!earnedMonth) earnedMonth = receivedDate ? monthOf(receivedDate) : monthOf(todayISO());
  return {
    id: e.id || uid('rev'),
    type,
    earnedMonth, // AdSense: month the views happened; sponsor: campaign month
    receivedDate, // the day the money reached your bank
    amount: round2(Number(e.amount) || 0), // EUR
    fees: round2(Math.abs(Number(e.fees) || 0)), // bank fees taken on this payment, EUR
    estimated: type === 'adsense' ? e.estimated !== false : false,
    payer: e.payer || '',
    note: e.note || '',
    source: e.source || 'manual',
    bankRef: e.bankRef || '',
    updatedAt: e.updatedAt || new Date().toISOString(),
  };
}

// The month an entry counts in.
// received: when the money arrived (what URSSAF wants). AdSense pays ~21st of the next month.
export function receivedMonth(e) {
  if (e.receivedDate) return monthOf(e.receivedDate);
  return e.type === 'adsense' ? addMonths(e.earnedMonth, 1) : e.earnedMonth;
}

// Everything that counts as income: revenue entries + paid invoices.
export function incomeItems(data) {
  const items = [];
  for (const e of data.revenue || []) {
    items.push({
      kind: 'entry', id: e.id, type: e.type, amount: e.amount, fees: e.fees || 0,
      earned: e.earnedMonth, received: receivedMonth(e), receivedDate: e.receivedDate,
      estimated: !!e.estimated, label: e.payer || (e.type === 'adsense' ? 'YouTube AdSense' : 'Sponsor'), note: e.note,
    });
  }
  for (const inv of data.invoices || []) {
    if (inv.status !== 'paid' || !inv.paidDate) continue;
    const amount = invoiceEur(inv);
    if (amount == null) continue;
    items.push({
      kind: 'invoice', id: inv.id, type: 'sponsor', amount, fees: Number(inv.paidFees) || 0,
      earned: inv.campaignMonth || monthOf(inv.paidDate), received: monthOf(inv.paidDate), receivedDate: inv.paidDate,
      estimated: false, label: `${inv.number} · ${inv.client?.name || ''}`.trim(), note: inv.campaign,
    });
  }
  return items;
}

function emptyRow(month) {
  return { month, adsense: 0, sponsor: 0, total: 0, adsenseTax: 0, sponsorTax: 0, tax: 0, fees: 0, net: 0, estimated: false, count: 0 };
}

// Month rows for a year (or a list of months), by 'received' or 'earned' month.
export function monthlyRows(data, { months, view = 'received' }) {
  const tax = data.settings.tax;
  const map = new Map(months.map((m) => [m, emptyRow(m)]));
  for (const it of incomeItems(data)) {
    const m = view === 'earned' ? it.earned : it.received;
    const row = map.get(m);
    if (!row) continue;
    row[it.type] += it.amount;
    row.fees += it.fees;
    row.count++;
    if (it.estimated) row.estimated = true;
  }
  for (const row of map.values()) {
    row.adsense = round2(row.adsense);
    row.sponsor = round2(row.sponsor);
    row.total = round2(row.adsense + row.sponsor);
    row.adsenseTax = taxOn(tax, 'adsense', row.adsense);
    row.sponsorTax = taxOn(tax, 'sponsor', row.sponsor);
    row.tax = round2(row.adsenseTax + row.sponsorTax);
    row.fees = round2(row.fees);
    row.net = round2(row.total - row.tax - row.fees);
  }
  return months.map((m) => map.get(m));
}

export function sumRows(rows) {
  const t = emptyRow('total');
  for (const r of rows) for (const k of ['adsense', 'sponsor', 'total', 'adsenseTax', 'sponsorTax', 'tax', 'fees', 'net', 'count']) t[k] += r[k];
  for (const k of ['adsense', 'sponsor', 'total', 'adsenseTax', 'sponsorTax', 'tax', 'fees', 'net']) t[k] = round2(t[k]);
  t.estimated = rows.some((r) => r.estimated);
  return t;
}

// Which months to show for a year: from the first month with data to the current month
// (or December for past years). "last12" gives the rolling 12 months.
export function monthsFor(data, year, view) {
  const today = monthOf(todayISO());
  if (year === 'last12') return Array.from({ length: 12 }, (_, i) => addMonths(today, i - 11));
  const y = Number(year);
  const items = incomeItems(data).map((it) => (view === 'earned' ? it.earned : it.received)).filter((m) => m.startsWith(`${y}-`));
  const last = String(y) === today.slice(0, 4) ? today : `${y}-12`;
  let first = items.length ? items.sort()[0] : last;
  if (first > last) first = last;
  const out = [];
  for (let m = first; m <= last; m = addMonths(m, 1)) out.push(m);
  // money not received yet (e.g. this month's AdSense, paid next month) shows under "Still to come"
  if (view === 'earned') for (const m of [...new Set(items)].sort()) if (m > last && !out.includes(m)) out.push(m);
  return out;
}

export function yearsWithData(data) {
  const ys = new Set([todayISO().slice(0, 4)]);
  for (const it of incomeItems(data)) { ys.add(it.received.slice(0, 4)); ys.add(it.earned.slice(0, 4)); }
  return [...ys].filter(Boolean).sort().reverse();
}

// ---------- URSSAF declarations ----------
function lastDay(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}
export function periodInfo(key) {
  // "2026-Q3" or "2026-09"
  const q = /^(\d{4})-Q([1-4])$/.exec(key);
  if (q) {
    const y = Number(q[1]); const n = Number(q[2]);
    const first = `${y}-${String((n - 1) * 3 + 1).padStart(2, '0')}`;
    const months = [first, addMonths(first, 1), addMonths(first, 2)];
    const dueMonth = addMonths(months[2], 1);
    return { key, label: `Q${n} ${y}`, sub: `${MONTHS_SHORT[(n - 1) * 3]}–${MONTHS_SHORT[n * 3 - 1]}`, months, due: `${dueMonth}-${String(lastDay(dueMonth)).padStart(2, '0')}` };
  }
  const m = key;
  const dueMonth = addMonths(m, 1);
  return { key, label: monthLabel(m), sub: '', months: [m], due: `${dueMonth}-${String(lastDay(dueMonth)).padStart(2, '0')}` };
}
function periodKey(ym, period) {
  if (period === 'monthly') return ym;
  return `${ym.slice(0, 4)}-Q${Math.floor((Number(ym.slice(5, 7)) - 1) / 3) + 1}`;
}

// The declaration to do next: the latest finished period not yet marked declared.
export function nextDeclaration(data, today = todayISO()) {
  const tax = data.settings.tax;
  const thisPeriod = periodKey(monthOf(today), tax.period);
  // walk back from the period before this one
  let ym = monthOf(today);
  const seen = new Set();
  const list = [];
  for (let i = 0; i < 24; i++) {
    ym = addMonths(ym, -1);
    const key = periodKey(ym, tax.period);
    if (key === thisPeriod || seen.has(key)) continue;
    seen.add(key);
    list.push(key);
    if (list.length >= 4) break;
  }
  const hasIncome = (k) => declarationAmounts(data, periodInfo(k)).bic + declarationAmounts(data, periodInfo(k)).bnc > 0;
  const pending = list.filter((k, i) => !(tax.declared || []).includes(k) && (i === 0 || hasIncome(k)));
  const key = pending[0] || null; // most recent undeclared
  const overdue = pending.filter((k) => periodInfo(k).due < today);
  if (!key) {
    return { info: periodInfo(thisPeriod), upcoming: true, overdue: [] };
  }
  const info = periodInfo(key);
  return { info, upcoming: false, overdue: overdue.filter((k) => k !== key).map(periodInfo) };
}

export function declarationAmounts(data, info) {
  const rows = monthlyRows(data, { months: info.months, view: 'received' });
  const t = sumRows(rows);
  const tax = data.settings.tax;
  const byCat = { bic: 0, bnc: 0 };
  byCat[tax.adsenseCategory] += t.adsense;
  byCat[tax.sponsorCategory] += t.sponsor;
  return {
    bic: Math.round(byCat.bic), // URSSAF takes whole euros
    bnc: Math.round(byCat.bnc),
    contributions: t.tax,
    estimated: t.estimated,
    adsense: t.adsense,
    sponsor: t.sponsor,
  };
}

// ---------- expected money ----------
export function expectedIncome(data) {
  let total = 0, count = 0, noRate = 0, adsense = 0;
  const now = monthOf(todayISO());
  for (const e of data.revenue || []) {
    if (!e.receivedDate && receivedMonth(e) > now) adsense += e.amount;
  }
  for (const inv of data.invoices || []) {
    const st = effectiveStatus(inv);
    if (st === 'paid') continue;
    const eur = invoiceEur(inv);
    if (eur == null) { noRate++; continue; }
    total += eur;
    count++;
  }
  return { total: round2(total + adsense), invoices: round2(total), adsense: round2(adsense), count, noRate };
}

// ---------- bank statements ----------
function splitCsvLine(line, sep) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === sep) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function findCol(headers, ...names) {
  const h = headers.map(norm);
  for (const n of names) {
    const i = h.findIndex((x) => x === n || x.startsWith(n));
    if (i >= 0) return i;
  }
  return -1;
}
function toISO(d) {
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(d || '');
  if (m) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(d || '')) return d.slice(0, 10);
  return '';
}

// Reads a French bank CSV export (Caisse d'Epargne / BPCE style; tolerant of others).
// Returns { rows: [{ date, label, info, amount (+credit / -debit), ref }], period }.
export function parseBankCsv(text) {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new Error('That file is empty.');
  const sep = (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length ? ';' : ',';
  const headers = splitCsvLine(lines[0], sep);
  const cDate = findCol(headers, 'date de comptabilisation', 'date operation', 'date');
  const cLabel = findCol(headers, 'libelle simplifie', 'libelle', 'label', 'description');
  const cInfo = findCol(headers, 'informations complementaires', 'libelle operation', 'details');
  const cOp = findCol(headers, 'libelle operation');
  const cDebit = findCol(headers, 'debit');
  const cCredit = findCol(headers, 'credit');
  const cAmount = findCol(headers, 'montant', 'amount');
  if (cDate < 0 || cLabel < 0 || (cCredit < 0 && cAmount < 0)) {
    throw new Error('I couldn’t find the date, label and amount columns in this file. Export the statement as CSV from your bank’s website.');
  }
  const rows = [];
  for (const line of lines.slice(1)) {
    const c = splitCsvLine(line, sep);
    const date = toISO(c[cDate]);
    if (!date) continue;
    let amount;
    if (cCredit >= 0 && c[cCredit]) amount = Math.abs(parseNumber(c[cCredit]));
    else if (cDebit >= 0 && c[cDebit]) amount = -Math.abs(parseNumber(c[cDebit]));
    else if (cAmount >= 0) amount = parseNumber(c[cAmount]);
    else continue;
    rows.push({
      date,
      label: c[cLabel] || '',
      info: cInfo >= 0 ? c[cInfo] || '' : '',
      op: cOp >= 0 ? c[cOp] || '' : '',
      amount: round2(amount),
    });
  }
  const dates = rows.map((r) => r.date).sort();
  return { rows, period: dates.length ? [dates[0], dates[dates.length - 1]] : null };
}

// Finds business income in a parsed statement.
// Returns [{ ...row, ref, kind: 'sponsor'|'adsense'|'skip', payer, fees, invoiceNumber, reason }]
export function detectIncome(parsed, data) {
  const clients = (data.clients || []).map((c) => ({ c, key: slugify(c.name).replace(/-/g, '') })).filter((x) => x.key.length >= 3);
  const prefix = (data.settings.invoice.prefix || 'A').toLowerCase();
  const invRe = new RegExp(`invoice\\s*(${prefix.replace(/[^a-z0-9]/g, '')}\\d{3,})`, 'i');
  // fees linked to a received transfer ("FRAIS VIR RECU ... VIREMENT RECU 0882...-")
  const feeByRef = new Map();
  for (const r of parsed.rows) {
    if (r.amount >= 0) continue;
    const m = /VIREMENT RECU\s+(\d{6,})/i.exec(`${r.info} ${r.label}`);
    if (m && /frais|com(mission)?/i.test(`${r.label} ${r.op}`)) feeByRef.set(m[1], round2((feeByRef.get(m[1]) || 0) + Math.abs(r.amount)));
  }
  const out = [];
  for (const r of parsed.rows) {
    if (r.amount <= 0) continue;
    const text = `${r.label} ${r.info} ${r.op}`;
    const flat = slugify(text).replace(/-/g, '');
    const transfer = /VIREMENT RECU\s+(\d{6,})/i.exec(r.label) || /VIREMENT RECU\s+(\d{6,})/i.exec(r.op);
    const ref = transfer ? `vir-${transfer[1]}` : `row-${r.date}-${r.amount.toFixed(2)}-${slugify(r.label).slice(0, 24)}`;
    const fees = transfer ? feeByRef.get(transfer[1]) || 0 : 0;
    const invoiceMatch = invRe.exec(text);
    const client = clients.find((x) => flat.includes(x.key));
    let kind = 'skip', payer = '', reason = 'Looks personal';
    if (/google|adsense|youtube/i.test(text)) { kind = 'adsense'; payer = 'Google (AdSense)'; reason = 'Mentions Google/YouTube'; }
    else if (client) { kind = 'sponsor'; payer = client.c.name; reason = `Paid by ${client.c.name}`; }
    else if (invoiceMatch) { kind = 'sponsor'; payer = ''; reason = `Mentions invoice ${invoiceMatch[1].toUpperCase()}`; }
    else if (/interne|savings|epargne|remise|retrait|from savings/i.test(text)) { reason = 'Internal transfer or refund'; }
    out.push({ ...r, ref, kind, payer, fees, invoiceNumber: invoiceMatch ? invoiceMatch[1].toUpperCase() : '', reason, clientId: client?.c.id || '' });
  }
  return out;
}

// Unpaid invoice that best matches a payment (by number, or client + amount within 6%).
export function matchInvoice(found, data) {
  const unpaid = (data.invoices || []).filter((i) => i.status !== 'paid');
  if (found.invoiceNumber) {
    const byNum = unpaid.find((i) => i.number.toUpperCase() === found.invoiceNumber);
    if (byNum) return { invoice: byNum, how: 'number' };
  }
  let best = null;
  for (const inv of unpaid) {
    if (found.clientId && inv.clientId && inv.clientId !== found.clientId) continue;
    const eur = invoiceEur(inv);
    if (!eur) continue;
    const diff = Math.abs(eur - found.amount) / eur;
    if (diff <= 0.06 && (!best || diff < best.diff)) best = { invoice: inv, how: 'amount', diff };
  }
  return best;
}

// Rough projection for the calendar year: money received so far plus the average
// of finished months for each month left.
export function projection(rows, year) {
  const now = monthOf(todayISO());
  const sofar = rows.filter((r) => r.month.startsWith(String(year)) && r.month <= now);
  const done = sofar.filter((r) => r.month < now && r.total > 0);
  const ytd = round2(sofar.reduce((s, r) => s + r.total, 0));
  if (done.length < 2) return { ytd, avg: null, year: null };
  const avg = done.reduce((s, r) => s + r.total, 0) / done.length;
  const remaining = String(year) === now.slice(0, 4) ? 12 - Number(now.slice(5, 7)) : 0;
  return { ytd, avg: round2(avg), year: round2(ytd + avg * remaining) };
}
