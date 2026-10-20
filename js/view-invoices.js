// The invoice tracker: a sortable, filterable sheet of every invoice.
import {
  store, invoiceTotal, invoiceEur, invoiceIn, effectiveStatus, reminderDue,
} from './store.js';
import {
  esc, fmtDateShort, fmtMoney, todayISO, downloadBlob, daysBetween, fmtMonth,
} from './util.js';
import { icons, statusPill, STATUS, toast } from './ui.js';
import {
  setStatus, sendReminder, copyReminder, deleteInvoice, exportPdf,
} from './invoice-actions.js';
import { lastKnownUsdEur } from './rates.js';

const PREFS_KEY = 'edg.tracker.prefs.v1';
function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'); } catch { return {}; }
}
function savePrefs(p) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

const COLUMNS = [
  ['number', 'Invoice #'],
  ['status', 'Status'],
  ['client', 'Client'],
  ['campaign', 'Campaign'],
  ['reference', 'Reference'],
  ['issueDate', 'Date'],
  ['dueDate', 'Due'],
  ['reminderDate', 'Reminder'],
  ['total', 'Total'],
];

const STATUS_ORDER = { overdue: 0, waiting: 1, new: 2, paid: 3 };

export function renderInvoices(root, { navigate, params }) {
  const prefs = loadPrefs();
  const state = {
    q: '',
    status: params.get('status') || 'all',
    client: params.get('client') || '',
    year: params.get('year') || prefs.year || 'all',
    show: prefs.show || 'original', // original | EUR | USD
    sort: prefs.sort || 'issueDate',
    dir: prefs.dir || 'desc',
    reminders: params.get('reminders') === '1',
  };
  const today = todayISO();

  const years = () => Array.from(new Set(store.data.invoices.map((i) => (i.issueDate || '').slice(0, 4)).filter(Boolean))).sort().reverse();

  function displayTotal(inv) {
    if (state.show === 'original') return { value: invoiceTotal(inv), cur: inv.currency, approx: false };
    const v = invoiceIn(inv, state.show, lastKnownUsdEur() || store.data.invoices.find((i) => i.currency === 'USD' && i.rateToEur)?.rateToEur);
    const approx = inv.currency !== state.show && !(state.show === 'EUR' && inv.status === 'paid' && inv.paidAmountEur != null);
    return { value: v, cur: state.show, approx };
  }

  function filtered() {
    const q = state.q.trim().toLowerCase();
    return store.data.invoices.filter((inv) => {
      const st = effectiveStatus(inv, today);
      if (state.status !== 'all') {
        if (state.status === 'open' ? st === 'paid' : st !== state.status) return false;
      }
      if (state.reminders && !reminderDue(inv, today)) return false;
      if (state.client && inv.clientId !== state.client) return false;
      if (state.year !== 'all' && !(inv.issueDate || '').startsWith(state.year)) return false;
      if (q) {
        const hay = [inv.number, inv.client?.name, inv.campaign, fmtMonth(inv.campaignMonth), inv.reference, inv.notes, ...(inv.items || []).map((i) => `${i.title} ${i.description}`)].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function sorted(list) {
    const dir = state.dir === 'asc' ? 1 : -1;
    const key = state.sort;
    const val = (inv) => {
      switch (key) {
        case 'status': return STATUS_ORDER[effectiveStatus(inv, today)];
        case 'client': return (inv.client?.name || '').toLowerCase();
        case 'total': return invoiceEur(inv) ?? invoiceTotal(inv);
        case 'number': return inv.number;
        default: return inv[key] || (dir > 0 ? '9999' : '');
      }
    };
    return list.slice().sort((a, b) => {
      const A = val(a), B = val(b);
      if (A < B) return -dir;
      if (A > B) return dir;
      return (a.number < b.number ? 1 : -1);
    });
  }

  function summary() {
    const all = store.data.invoices;
    const year = today.slice(0, 4);
    let outstanding = 0, overdue = 0, overdueCount = 0, paidYear = 0, unknownRate = false;
    for (const inv of all) {
      const st = effectiveStatus(inv, today);
      const eur = invoiceEur(inv);
      if (eur == null && st !== 'paid' && inv.currency !== 'EUR') unknownRate = true;
      if (st === 'waiting' || st === 'overdue' || st === 'new') outstanding += eur || 0;
      if (st === 'overdue') { overdue += eur || 0; overdueCount++; }
      if (st === 'paid' && (inv.paidDate || inv.issueDate || '').startsWith(year)) paidYear += eur || 0;
    }
    const remindersCount = all.filter((i) => reminderDue(i, today)).length;
    return { outstanding, overdue, overdueCount, paidYear, remindersCount, unknownRate, year };
  }

  function drawSummary() {
    const s = summary();
    root.querySelector('.stats').innerHTML = `
      <button class="stat" data-filter="open">
        <span class="stat-label">Outstanding</span>
        <span class="stat-value">${fmtMoney(s.outstanding, 'EUR')}</span>
        <span class="stat-note">${s.unknownRate ? 'Some invoices have no rate yet' : 'New + waiting, in EUR'}</span>
      </button>
      <button class="stat ${s.overdueCount ? 'stat-alert' : ''}" data-filter="overdue">
        <span class="stat-label">Overdue</span>
        <span class="stat-value">${fmtMoney(s.overdue, 'EUR')}</span>
        <span class="stat-note">${s.overdueCount} invoice${s.overdueCount === 1 ? '' : 's'}</span>
      </button>
      <button class="stat" data-filter="paid">
        <span class="stat-label">Paid in ${s.year}</span>
        <span class="stat-value">${fmtMoney(s.paidYear, 'EUR')}</span>
        <span class="stat-note">Amounts received</span>
      </button>
      <button class="stat ${s.remindersCount ? 'stat-remind' : ''}" data-filter="reminders">
        <span class="stat-label">Reminders due</span>
        <span class="stat-value">${s.remindersCount}</span>
        <span class="stat-note">${s.remindersCount ? 'Tap to see them' : 'All caught up'}</span>
      </button>`;
  }

  function dueRel(inv) {
    if (inv.status === 'paid' || !inv.dueDate) return '';
    const d = daysBetween(today, inv.dueDate);
    if (d < 0) return `<span class="due-rel late">${-d}d overdue</span>`;
    return `<span class="due-rel">${d === 0 ? 'today' : `in ${d}d`}</span>`;
  }

  function reminderCell(inv) {
    if (inv.status === 'paid') return '<span class="muted">—</span>';
    if (!inv.reminderDate) return '<span class="muted">—</span>';
    const due = reminderDue(inv, today);
    const d = daysBetween(today, inv.reminderDate);
    const when = d === 0 ? 'today' : d > 0 ? `in ${d}d` : `${-d}d ago`;
    return `<span class="remind ${due ? 'remind-due' : ''}" title="${esc(fmtDateShort(inv.reminderDate))}">${icons.bell}${esc(fmtDateShort(inv.reminderDate))}<small>${when}</small></span>`;
  }

  function statusSelect(inv) {
    const st = effectiveStatus(inv, today);
    return `
      <label class="status-select ${STATUS[st].cls}" title="Change status">
        <span class="sr-only">Status for ${esc(inv.number)}</span>
        <select data-act="status" aria-label="Status for ${esc(inv.number)}">
          <option value="new"${inv.status === 'new' ? ' selected' : ''}>New</option>
          <option value="waiting"${inv.status === 'waiting' ? ' selected' : ''}>${st === 'overdue' ? 'Overdue' : 'Waiting'}</option>
          <option value="paid"${inv.status === 'paid' ? ' selected' : ''}>Paid</option>
        </select>
        <i></i>
      </label>`;
  }

  function rowActions(inv) {
    const showRemind = inv.status !== 'paid' && inv.status !== 'new';
    return `
      <div class="row-actions">
        ${showRemind ? `<button class="icon-btn ${reminderDue(inv, today) ? 'hot' : ''}" data-act="remind" title="Draft reminder email" aria-label="Draft reminder email for ${esc(inv.number)}">${icons.mail}</button>` : ''}
        <button class="icon-btn" data-act="pdf" title="Download PDF" aria-label="Download PDF of ${esc(inv.number)}">${icons.download}</button>
        <details class="menu">
          <summary class="icon-btn" title="More" aria-label="More actions for ${esc(inv.number)}">${icons.more}</summary>
          <div class="menu-list">
            <button data-act="open">${icons.edit}Open</button>
            <button data-act="duplicate">${icons.copy}Duplicate</button>
            ${showRemind ? `<button data-act="copyremind">${icons.mail}Copy reminder text</button>` : ''}
            <button data-act="delete" class="danger">${icons.trash}Delete</button>
          </div>
        </details>
      </div>`;
  }

  function drawTable() {
    const list = sorted(filtered());
    const body = root.querySelector('.sheet-body');
    const foot = root.querySelector('.sheet-foot');
    const cards = root.querySelector('.cards');
    const clientName = state.client ? store.client(state.client)?.name || 'that client' : '';
    root.querySelector('.filter-note').innerHTML = (state.client || state.reminders)
      ? `<span class="chip">${state.reminders ? 'Reminders due' : `Client: ${esc(clientName)}`}<button data-act="clearfilter" aria-label="Clear filter">${icons.x}</button></span>`
      : '';

    if (!list.length) {
      const none = store.data.invoices.length === 0;
      body.innerHTML = `<tr><td colspan="10"><div class="empty">
        <h3>${none ? 'No invoices yet' : 'Nothing matches these filters'}</h3>
        <p>${none ? 'Create your first invoice. Your number sequence and details carry over from Settings.' : 'Try clearing the search or picking “All”.'}</p>
        ${none ? `<button class="btn btn-primary" data-act="new">${icons.plus}New invoice</button>` : '<button class="btn btn-ghost" data-act="reset">Clear filters</button>'}
      </div></td></tr>`;
      cards.innerHTML = body.querySelector('.empty').outerHTML;
      foot.innerHTML = '';
      return;
    }

    let sum = 0, sumApprox = false, mixed = new Set(), noRate = 0;
    body.innerHTML = list.map((inv) => {
      const t = displayTotal(inv);
      if (t.value == null) noRate++; else sum += t.value;
      if (t.approx) sumApprox = true;
      mixed.add(t.cur);
      const st = effectiveStatus(inv, today);
      return `
        <tr data-id="${esc(inv.id)}" class="row-${st}">
          <td class="c-number"><a href="#/invoices/${esc(inv.id)}" class="num-link">${esc(inv.number || 'Draft')}</a></td>
          <td class="c-status">${statusSelect(inv)}</td>
          <td class="c-client">${esc(inv.client?.name || '—')}</td>
          <td class="c-campaign" title="${esc(inv.campaign)}">${esc(inv.campaign || '—')}${inv.campaignMonth ? `<span class="due-rel">${esc(fmtMonth(inv.campaignMonth))}</span>` : ''}</td>
          <td class="c-ref">${esc(inv.reference || '—')}</td>
          <td class="c-date">${esc(fmtDateShort(inv.issueDate))}</td>
          <td class="c-date ${st === 'overdue' ? 'warn' : ''}">${esc(fmtDateShort(inv.dueDate))}${dueRel(inv)}</td>
          <td class="c-remind">${reminderCell(inv)}</td>
          <td class="c-total num">${t.value == null ? '<span class="muted" title="No exchange rate on this invoice yet">no rate</span>' : `${t.approx ? '<span class="approx" title="Converted at the invoice’s rate">≈</span>' : ''}${fmtMoney(t.value, t.cur)}`}</td>
          <td class="c-actions">${rowActions(inv)}</td>
        </tr>`;
    }).join('');

    cards.innerHTML = list.map((inv) => {
      const t = displayTotal(inv);
      const st = effectiveStatus(inv, today);
      return `
        <article class="inv-card" data-id="${esc(inv.id)}">
          <a class="inv-card-main" href="#/invoices/${esc(inv.id)}">
            <span class="inv-card-top"><b>${esc(inv.number)}</b>${st === 'overdue' ? statusPill(st) : ''}</span>
            <span class="inv-card-client">${esc(inv.client?.name || '—')}</span>
            <span class="inv-card-campaign">${esc([inv.campaign, fmtMonth(inv.campaignMonth)].filter(Boolean).join(' · '))}</span>
            <span class="inv-card-bottom"><span>${esc(fmtDateShort(inv.issueDate))} · due ${esc(fmtDateShort(inv.dueDate))}${dueRel(inv).replace('due-rel', 'due-rel inline')}</span><b>${t.value == null ? '—' : `${t.approx ? '≈' : ''}${fmtMoney(t.value, t.cur)}`}</b></span>
          </a>
          <div class="inv-card-actions">${statusSelect(inv)}${rowActions(inv)}</div>
        </article>`;
    }).join('');

    const sumLabel = mixed.size > 1 ? 'Mixed currencies – pick EUR or USD to total' : `${sumApprox ? '≈ ' : ''}${fmtMoney(sum, [...mixed][0])}${noRate ? ` (+${noRate} without a rate)` : ''}`;
    // one cell per column so hidden columns (narrow screens) keep the total aligned
    foot.innerHTML = `<tr><td class="c-number foot-count">${list.length} invoice${list.length === 1 ? '' : 's'}</td><td class="c-status"></td><td class="c-client"></td><td class="c-campaign"></td><td class="c-ref"></td><td class="c-date"></td><td class="c-date"></td><td class="c-remind"></td><td class="num"><b>${sumLabel}</b></td><td></td></tr>`;
    root.querySelector('.cards-foot').textContent = `${list.length} invoice${list.length === 1 ? '' : 's'} · ${sumLabel}`;
  }

  function drawHead() {
    root.querySelector('.sheet-head').innerHTML = `<tr>${COLUMNS.map(([key, label]) => {
      const active = state.sort === key;
      const aria = active ? (state.dir === 'asc' ? 'ascending' : 'descending') : 'none';
      return `<th aria-sort="${aria}" class="${key === 'total' ? 'num' : ''}"><button data-sort="${key}">${esc(label)}<span class="sort-ind">${active ? (state.dir === 'asc' ? '▲' : '▼') : ''}</span></button></th>`;
    }).join('')}<th><span class="sr-only">Actions</span></th></tr>`;
    root.querySelectorAll('.seg [data-status]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.status === state.status && !state.reminders)));
  }

  function draw() {
    drawSummary();
    drawHead();
    drawTable();
    const yearSel = root.querySelector('[data-role=year]');
    const ys = years();
    yearSel.innerHTML = `<option value="all">All years</option>${ys.map((y) => `<option${y === state.year ? ' selected' : ''}>${y}</option>`).join('')}`;
    if (state.year !== 'all' && !ys.includes(state.year)) state.year = 'all';
    yearSel.value = state.year;
  }

  function persist() {
    savePrefs({ year: state.year, show: state.show, sort: state.sort, dir: state.dir });
  }

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Invoices</h1>
        <p class="sub">Track every campaign from sent to paid.</p>
      </div>
      <div class="head-actions">
        <button class="btn btn-ghost" data-act="csv" title="Export the current view as CSV">${icons.download}<span>CSV</span></button>
        <button class="btn btn-primary" data-act="new">${icons.plus}New invoice</button>
      </div>
    </div>
    <div class="stats"></div>
    <div class="toolbar">
      <label class="search">${icons.search}<input type="search" placeholder="Search number, client, campaign…" aria-label="Search invoices" data-role="q"><kbd>/</kbd></label>
      <div class="seg" role="group" aria-label="Filter by status">
        <button data-status="all">All</button>
        <button data-status="new">New</button>
        <button data-status="waiting">Waiting</button>
        <button data-status="overdue">Overdue</button>
        <button data-status="paid">Paid</button>
      </div>
      <select data-role="year" aria-label="Year"></select>
      <label class="show-as">Totals in
        <select data-role="show" aria-label="Show totals in">
          <option value="original">Invoice currency</option>
          <option value="EUR">EUR €</option>
          <option value="USD">USD $</option>
        </select>
      </label>
    </div>
    <div class="filter-note"></div>
    <div class="sheet-wrap">
      <table class="sheet">
        <thead class="sheet-head"></thead>
        <tbody class="sheet-body"></tbody>
        <tfoot class="sheet-foot"></tfoot>
      </table>
    </div>
    <div class="cards"></div>
    <p class="cards-foot"></p>`;

  root.querySelector('[data-role=show]').value = state.show;

  const q = root.querySelector('[data-role=q]');
  q.addEventListener('input', () => { state.q = q.value; drawTable(); });
  root.querySelector('[data-role=year]').addEventListener('change', (e) => { state.year = e.target.value; persist(); drawTable(); });
  root.querySelector('[data-role=show]').addEventListener('change', (e) => { state.show = e.target.value; persist(); drawTable(); });

  root.addEventListener('change', async (e) => {
    const sel = e.target.closest('select[data-act=status]');
    if (!sel) return;
    const id = sel.closest('[data-id]').dataset.id;
    const inv = store.invoice(id);
    const changed = await setStatus(inv, sel.value);
    if (!changed) sel.value = inv.status;
    draw();
  });

  root.addEventListener('click', async (e) => {
    const sortBtn = e.target.closest('[data-sort]');
    if (sortBtn) {
      const key = sortBtn.dataset.sort;
      if (state.sort === key) state.dir = state.dir === 'asc' ? 'desc' : 'asc';
      else { state.sort = key; state.dir = ['issueDate', 'dueDate', 'total', 'number', 'reminderDate'].includes(key) ? 'desc' : 'asc'; }
      persist();
      drawHead();
      drawTable();
      return;
    }
    const statusBtn = e.target.closest('[data-status]');
    if (statusBtn) {
      state.status = statusBtn.dataset.status;
      state.reminders = false;
      drawHead();
      drawTable();
      return;
    }
    const stat = e.target.closest('.stat[data-filter]');
    if (stat) {
      const f = stat.dataset.filter;
      state.reminders = f === 'reminders';
      state.status = f === 'reminders' ? 'all' : f;
      drawHead();
      drawTable();
      return;
    }
    const btn = e.target.closest('[data-act]');
    if (!btn) {
      // click anywhere on a row opens it (except controls)
      const row = e.target.closest('tr[data-id]');
      if (row && !e.target.closest('a, button, select, label, details')) navigate(`#/invoices/${row.dataset.id}`);
      return;
    }
    const id = btn.closest('[data-id]')?.dataset.id;
    const inv = id ? store.invoice(id) : null;
    btn.closest('details')?.removeAttribute('open');
    switch (btn.dataset.act) {
      case 'new': navigate(state.client ? `#/invoices/new?client=${encodeURIComponent(state.client)}` : '#/invoices/new'); break;
      case 'open': navigate(`#/invoices/${id}`); break;
      case 'pdf': exportPdf(inv); break;
      case 'remind': sendReminder(inv); draw(); break;
      case 'copyremind': copyReminder(inv); break;
      case 'duplicate': {
        navigate(`#/invoices/new?from=${encodeURIComponent(id)}`);
        break;
      }
      case 'delete': if (await deleteInvoice(inv)) draw(); break;
      case 'clearfilter': state.client = ''; state.reminders = false; history.replaceState(null, '', '#/invoices'); draw(); break;
      case 'reset': state.q = ''; q.value = ''; state.status = 'all'; state.year = 'all'; state.client = ''; state.reminders = false; persist(); draw(); break;
      case 'csv': exportCsv(sorted(filtered())); break;
      default:
    }
  });

  root.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('tr[data-id]')) navigate(`#/invoices/${e.target.dataset.id}`);
  });

  // close any open row menu when clicking elsewhere
  const closeMenus = (e) => {
    root.querySelectorAll('details.menu[open]').forEach((d) => { if (!d.contains(e.target)) d.removeAttribute('open'); });
  };
  document.addEventListener('click', closeMenus);

  const off = store.on(() => draw());
  draw();
  return () => {
    off();
    document.removeEventListener('click', closeMenus);
  };
}

function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportCsv(list) {
  const today = todayISO();
  const header = ['Invoice number', 'Status', 'Client', 'Campaign', 'Campaign month', 'Reference', 'Invoice date', 'Service date', 'Due date', 'Reminder', 'Currency', 'Total', 'Rate to EUR', 'Total EUR', 'Paid date', 'Received EUR'];
  const rows = list.map((inv) => [
    inv.number,
    STATUS[effectiveStatus(inv, today)].label,
    inv.client?.name || '',
    inv.campaign,
    fmtMonth(inv.campaignMonth),
    inv.reference,
    inv.issueDate,
    inv.serviceDate,
    inv.dueDate,
    inv.status === 'paid' ? '' : inv.reminderDate,
    inv.currency,
    invoiceTotal(inv).toFixed(2),
    inv.currency === 'EUR' ? '1' : (inv.rateToEur || ''),
    invoiceEur(inv) == null ? '' : invoiceEur(inv).toFixed(2),
    inv.paidDate,
    inv.paidAmountEur ?? '',
  ]);
  const csv = '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `invoices-${today}.csv`);
  toast(`Exported ${list.length} invoice${list.length === 1 ? '' : 's'}`);
}
