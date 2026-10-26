// Invoice editor: form on the left, live A4 preview on the right.
import {
  store, normalizeInvoice, nextInvoiceNumber, invoiceTotal, lineAmount, clientSnapshot, effectiveStatus, numericPart,
} from './store.js';
import {
  esc, clone, todayISO, addDays, daysBetween, fmtDate, fmtMoney, round2, parseNumber, uid, debounce, fmtMonth, splitCampaignMonth,
} from './util.js';
import { icons, statusPill, toast, modal, confirmDialog } from './ui.js';
import { renderInvoice, buildFileName } from './invoice.js';
import { getRate, lastKnownUsdEur } from './rates.js';
import { editClient } from './view-clients.js';
import {
  markPaid, duplicateInvoice, deleteInvoice, exportPdf, printPdf, missingForPdf, sendReminder, emailInvoice, setStatus,
} from './invoice-actions.js';

function blankInvoice(clientId) {
  const s = store.settings.invoice;
  const client = clientId ? store.client(clientId) : null;
  const termsDays = client?.termsDays ?? s.defaultTermsDays;
  const issue = todayISO();
  return normalizeInvoice({
    id: uid('inv'),
    number: nextInvoiceNumber(store.data),
    status: 'new',
    clientId: client?.id || '',
    client: clientSnapshot(client),
    issueDate: issue,
    campaignMonth: issue.slice(0, 7),
    termsDays,
    dueDate: addDays(issue, termsDays),
    currency: client?.currency || s.defaultCurrency,
    rateToEur: (client?.currency || s.defaultCurrency) === 'EUR' ? 1 : 0,
    items: [{ title: '', description: '', qty: 1, rate: 0 }],
  });
}

export function renderEditor(root, { navigate, id, params, setGuard }) {
  const isNew = id === 'new';
  const original = isNew ? null : store.invoice(id);
  if (!isNew && !original) {
    root.innerHTML = `<div class="empty"><h3>Invoice not found</h3><p>It may have been deleted on another device.</p><a class="btn btn-primary" href="#/invoices">Back to invoices</a></div>`;
    return () => {};
  }
  const from = isNew && params.get('from') ? store.invoice(params.get('from')) : null;
  let inv = isNew ? (from ? duplicateInvoice(from) : blankInvoice(params.get('client'))) : clone(original);
  let saved = isNew ? null : JSON.stringify(original);
  let baseline = JSON.stringify(inv); // for new invoices: unchanged from this = nothing to lose
  let rateBusy = false;

  // For a never-saved invoice, rate bookkeeping alone isn't worth a "leave?" prompt.
  const RATE_KEYS = ['rateToEur', 'rateDate', 'rateSource', 'usdRate'];
  const strip = (o) => { const c = { ...o }; RATE_KEYS.forEach((k) => delete c[k]); return JSON.stringify(c); };
  const dirty = () => (saved != null ? JSON.stringify(inv) !== saved : strip(inv) !== strip(JSON.parse(baseline)));
  setGuard(() => (dirty() ? 'You have unsaved changes on this invoice. Leave without saving?' : null));

  // ---------- layout ----------
  root.innerHTML = `
    <div class="editor">
      <div class="editor-bar">
        <a href="#/invoices" class="btn btn-ghost btn-sm back">${icons.back}<span>Invoices</span></a>
        <div class="editor-title">
          <h1 data-role="title"></h1>
          <span data-role="pill"></span>
          <span class="unsaved" data-role="unsaved" hidden>Unsaved</span>
        </div>
        <div class="editor-actions">
          <button class="btn btn-ghost" data-act="print" title="Print or save as PDF with selectable text">${icons.print}<span>Print</span></button>
          <button class="btn btn-soft" data-act="pdf" title="Download the PDF">${icons.download}<span>PDF</span></button>
          <button class="btn btn-primary" data-act="save" title="Save (Ctrl/⌘+S)">${icons.check}<span>Save</span></button>
          <details class="menu">
            <summary class="icon-btn" aria-label="More actions">${icons.more}</summary>
            <div class="menu-list">
              <button data-act="paid">${icons.check}Mark as paid…</button>
              <button data-act="email">${icons.mail}Draft email with invoice</button>
              <button data-act="remind">${icons.bell}Draft reminder email</button>
              <button data-act="duplicate">${icons.copy}Duplicate</button>
              <button data-act="delete" class="danger">${icons.trash}Delete</button>
            </div>
          </details>
        </div>
      </div>

      <div class="editor-tabs" role="tablist">
        <button role="tab" aria-selected="true" data-tab="form">Edit</button>
        <button role="tab" aria-selected="false" data-tab="preview">Preview</button>
      </div>

      <div class="editor-grid">
        <form class="editor-form" novalidate autocomplete="off">
          <div class="warnbox" data-role="warn" hidden></div>

          <section class="card">
            <h2>Client</h2>
            <div class="row">
              <label class="field grow"><span class="field-label">Billed to</span>
                <select name="clientId" data-role="client"></select>
              </label>
              <button type="button" class="btn btn-ghost btn-field" data-act="editclient" title="Edit this client">${icons.edit}<span>Edit</span></button>
            </div>
            <p class="client-preview" data-role="clientinfo"></p>
          </section>

          <section class="card">
            <h2>Status</h2>
            <div class="seg seg-status" role="radiogroup" aria-label="Status" data-role="status">
              <button type="button" role="radio" data-st="new">New</button>
              <button type="button" role="radio" data-st="waiting">Waiting for payment</button>
              <button type="button" role="radio" data-st="paid">Paid</button>
            </div>
            <p class="paid-note" data-role="paidnote"></p>
          </section>

          <section class="card">
            <h2>Campaign</h2>
            <div class="grid2">
              <label class="field full"><span class="field-label">Campaign</span>
                <input name="campaign" placeholder="Warhammer 40,000: Tacticus" list="campaign-list">
                <datalist id="campaign-list"></datalist>
              </label>
              <label class="field"><span class="field-label">Campaign month</span>
                <input type="month" name="campaignMonth" placeholder="2026-08">
                <small class="field-hint" data-role="monthhint">The month the campaign ran. Printed on the invoice.</small>
              </label>
              <div class="field"><span class="field-label">Fee for this campaign</span>
                <b class="fee-total" data-role="fee"></b>
                <small class="field-hint">Total of the items below.</small>
              </div>
              <label class="field"><span class="field-label">Reference</span>
                <input name="reference" placeholder="Campaign ID or PO number">
                <small class="field-hint">Sponsor’s campaign ID or PO. Printed on the invoice.</small>
              </label>
              <label class="field"><span class="field-label">Invoice number</span>
                <input name="number" required>
                <small class="field-hint" data-role="numhint"></small>
              </label>
            </div>
          </section>

          <section class="card">
            <h2>Dates</h2>
            <div class="grid2">
              <label class="field"><span class="field-label">Invoice date</span><input type="date" name="issueDate" required></label>
              <label class="field"><span class="field-label">Service date</span><input type="date" name="serviceDate">
                <span class="quick"><button type="button" data-act="samedate">Same as invoice date</button></span>
                <small class="field-hint">When the video went live. Required on French invoices.</small></label>
              <label class="field"><span class="field-label">Payment terms</span>
                <span class="input-suffix"><input type="number" name="termsDays" min="0" max="365" inputmode="numeric"><span>days</span></span>
                <span class="quick" data-role="terms">
                  ${[[0, 'On receipt'], [15, '15'], [30, '30'], [45, '45'], [60, '60']].map(([d, l]) => `<button type="button" data-days="${d}">${l}</button>`).join('')}
                </span>
              </label>
              <label class="field"><span class="field-label">Due date</span><input type="date" name="dueDate" required></label>
              <label class="field full"><span class="field-label">Payment reminder</span>
                <span class="row"><input type="date" name="reminderDate" class="grow">
                <span class="quick" data-role="remind">
                  <button type="button" data-rem="due">On due date</button>
                  <button type="button" data-rem="7">+7 days</button>
                  <button type="button" data-rem="none">None</button>
                </span></span>
                <small class="field-hint">Shows up in your tracker when it’s time to chase. Starts counting when the invoice is marked “Waiting for payment”.</small>
              </label>
            </div>
          </section>

          <section class="card">
            <div class="card-head">
              <h2>Items</h2>
              <div class="quick">
                <select data-role="saveditem" aria-label="Add a saved item">
                  <option value="">+ Add saved item…</option>
                </select>
              </div>
            </div>
            <div class="items" data-role="items"></div>
            <button type="button" class="btn btn-ghost btn-sm" data-act="additem">${icons.plus}Add line</button>
          </section>

          <section class="card">
            <h2>Currency</h2>
            <div class="currency-row">
              <div class="seg" role="radiogroup" aria-label="Invoice currency" data-role="cur">
                <button type="button" role="radio" data-cur="USD">USD $</button>
                <button type="button" role="radio" data-cur="EUR">EUR €</button>
              </div>
              <div class="rate-box" data-role="ratebox">
                <label class="rate-input"><span>1 USD =</span><input name="rateToEur" inputmode="decimal" aria-label="Exchange rate, euros per dollar"><span>EUR</span></label>
                <button type="button" class="btn btn-ghost btn-sm" data-act="liverate">${icons.refresh}<span>Live rate</span></button>
              </div>
            </div>
            <p class="rate-note" data-role="ratenote"></p>
          </section>

          <section class="card">
            <h2>Notes on the invoice</h2>
            <label class="field full"><span class="sr-only">Notes</span>
              <textarea name="notes" rows="2" placeholder="Optional – e.g. PO details, thank-you note. Printed above the terms."></textarea>
            </label>
          </section>



          <p class="filename-note" data-role="filename"></p>
        </form>

        <aside class="preview-col" aria-label="Invoice preview">
          <button type="button" class="btn btn-ghost btn-sm zoom-btn" data-act="zoom">Zoom to 100%</button>
          <div class="preview-scale" data-role="scale"><div class="preview-page" data-role="preview"></div></div>
        </aside>
      </div>
    </div>`;

  const form = root.querySelector('.editor-form');
  const q = (sel) => root.querySelector(sel);
  const input = (name) => form.elements[name];

  // ---------- fill controls ----------
  function fillClientSelect() {
    const sel = q('[data-role=client]');
    const clients = store.data.clients.slice().sort((a, b) => a.name.localeCompare(b.name));
    const missing = inv.clientId && !clients.find((c) => c.id === inv.clientId);
    sel.innerHTML = `
      <option value="">Choose a client…</option>
      ${clients.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}
      ${missing ? `<option value="${esc(inv.clientId)}">${esc(inv.client?.name || 'Deleted client')} (deleted)</option>` : ''}
      <option value="__new">+ New client…</option>`;
    sel.value = inv.clientId || '';
  }

  function fillSavedItems() {
    const sel = q('[data-role=saveditem]');
    sel.innerHTML = `<option value="">+ Add saved item…</option>${store.settings.savedItems.map((it) => `<option value="${esc(it.id)}">${esc(it.title)}${it.rate ? ` – ${fmtMoney(it.rate, it.currency)}` : ''}</option>`).join('')}`;
  }

  function fillCampaigns() {
    const set = new Set(store.data.invoices.map((i) => i.campaign).filter(Boolean));
    q('#campaign-list').innerHTML = [...set].slice(-40).map((c) => `<option value="${esc(c)}">`).join('');
  }

  function fillForm() {
    input('campaign').value = inv.campaign;
    input('campaignMonth').value = inv.campaignMonth || '';
    input('reference').value = inv.reference;
    input('number').value = inv.number;
    input('issueDate').value = inv.issueDate;
    input('serviceDate').value = inv.serviceDate;
    input('termsDays').value = inv.termsDays;
    input('dueDate').value = inv.dueDate;
    input('reminderDate').value = inv.reminderDate;
    input('notes').value = inv.notes;
    input('rateToEur').value = inv.rateToEur ? String(inv.rateToEur) : '';
    fillClientSelect();
    drawItems();
  }

  function drawItems() {
    const cur = inv.currency;
    const sym = cur === 'EUR' ? '€' : '$';
    q('[data-role=items]').innerHTML = inv.items.map((it, i) => `
      <div class="item" data-i="${i}">
        <div class="item-main">
          <label class="field full"><span class="field-label">Item ${i + 1}</span>
            <textarea data-f="title" rows="1" class="autogrow" placeholder="1 x Integrated Video (60-90s) - Game name">${esc(it.title)}</textarea></label>
          <label class="field full"><span class="field-label">Description <small>(optional, one line per row)</small></span>
 <textarea data-f="description" rows="2" class="autogrow" placeholder="Video Title: …&#10;https://youtu.be/…">${esc(it.description)}</textarea></label>
        </div>
        <div class="item-nums">
          <label class="field"><span class="field-label">Qty</span><input data-f="qty" inputmode="decimal" value="${esc(it.qty)}"></label>
          <label class="field"><span class="field-label">Rate</span><span class="input-prefix"><span>${sym}</span><input data-f="rate" inputmode="decimal" value="${esc(it.rate || '')}" placeholder="0.00"></span></label>
          <div class="item-amount"><span class="field-label">Amount</span><b data-role="amt">${fmtMoney(lineAmount(it), cur)}</b></div>
        </div>
        <div class="item-tools">
          <button type="button" class="icon-btn" data-act="up" ${i === 0 ? 'disabled' : ''} aria-label="Move item up" title="Move up">▲</button>
          <button type="button" class="icon-btn" data-act="down" ${i === inv.items.length - 1 ? 'disabled' : ''} aria-label="Move item down" title="Move down">▼</button>
          <button type="button" class="icon-btn danger" data-act="removeitem" ${inv.items.length === 1 ? 'disabled' : ''} aria-label="Remove item" title="Remove">${icons.trash}</button>
        </div>
      </div>`).join('') + `<div class="items-total"><span>Total</span><b data-role="total">${fmtMoney(invoiceTotal(inv), cur)}</b></div>`;
    requestAnimationFrame(growAll);
  }

  function grow(el) {
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }
  function growAll() {
    root.querySelectorAll('textarea.autogrow').forEach(grow);
  }

  function updateAmounts() {
    root.querySelectorAll('.item').forEach((el) => {
      const it = inv.items[Number(el.dataset.i)];
      el.querySelector('[data-role=amt]').textContent = fmtMoney(lineAmount(it), inv.currency);
    });
    const t = q('[data-role=total]');
    if (t) t.textContent = fmtMoney(invoiceTotal(inv), inv.currency);
    q('[data-role=fee]').textContent = fmtMoney(invoiceTotal(inv), inv.currency);
  }

  // ---------- status bits ----------
  function refreshMeta() {
    q('[data-role=title]').textContent = isNew && !saved ? `${from ? 'Copy' : 'New invoice'} ${inv.number}` : `Invoice ${inv.number}`;
    q('[data-role=pill]').innerHTML = statusPill(effectiveStatus(inv));
    q('[data-role=unsaved]').hidden = !dirty();
    q('[data-role=fee]').textContent = fmtMoney(invoiceTotal(inv), inv.currency);
    root.querySelectorAll('[data-cur]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.cur === inv.currency)));
    root.querySelectorAll('[data-st]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.st === inv.status)));
    root.querySelectorAll('[data-days]').forEach((b) => b.classList.toggle('on', Number(b.dataset.days) === Number(inv.termsDays)));

    // client info under the select
    const c = inv.client;
    q('[data-role=clientinfo]').innerHTML = c
      ? `${esc([c.addressLines?.replace(/\n/g, ', '), c.vatNumber ? `VAT ${c.vatNumber}` : ''].filter(Boolean).join(' · ') || 'No address saved for this client yet')}${staleClient() ? ` <button type="button" class="link-btn" data-act="refreshclient">Use their updated details</button>` : ''}`
      : '<span class="muted">Pick who you’re billing. Their address and VAT number fill in automatically.</span>';
    q('[data-act=editclient]').hidden = !c || !store.client(inv.clientId);

    // rate box
    const box = q('[data-role=ratebox]');
    box.hidden = inv.currency === 'EUR';
    const note = q('[data-role=ratenote]');
    const total = invoiceTotal(inv);
    if (inv.currency === 'EUR') {
      note.innerHTML = 'Euro invoice – no conversion needed. Switch to USD and the amounts can be converted for you.';
    } else if (rateBusy) {
      note.textContent = 'Fetching today’s ECB rate…';
    } else if (inv.rateToEur) {
      const src = inv.rateSource === 'manual' ? 'typed in by you' : `ECB reference rate for ${fmtDate(inv.rateDate)}`;
      note.innerHTML = `≈ <b>${fmtMoney(round2(total * inv.rateToEur), 'EUR')}</b> at this rate (${esc(src)}). Used for your EUR totals until you record what you actually received.`;
    } else {
      note.innerHTML = 'No rate yet. Tap <b>Live rate</b> or type one so this invoice counts in your EUR totals.';
    }

    // payment
    const pn = q('[data-role=paidnote]');
    if (inv.status === 'paid') {
      pn.innerHTML = `Paid on ${esc(fmtDate(inv.paidDate))}${inv.paidAmountEur != null ? ` · received ${fmtMoney(inv.paidAmountEur, 'EUR')}` : ''} <button type="button" class="link-btn" data-act="paid">Edit payment</button>`;
    } else if (effectiveStatus(inv) === 'overdue') {
      pn.innerHTML = `<span class="warn">${Math.abs(daysBetween(todayISO(), inv.dueDate))} days overdue.</span> <button type="button" class="link-btn" data-act="remind">Draft a reminder</button>`;
    } else {
      pn.textContent = inv.status === 'new' ? 'Switch to “Waiting for payment” once you’ve sent it.' : '';
    }

    // number check
    const dupe = store.data.invoices.find((x) => x.id !== inv.id && x.number.trim().toLowerCase() === inv.number.trim().toLowerCase());
    q('[data-role=numhint]').innerHTML = dupe ? `<span class="warn">${esc(dupe.number)} is already used.</span>` : 'Auto-numbered in sequence. French invoices need unbroken numbering.';

    // missing info
    const missing = missingForPdf(inv);
    const warn = q('[data-role=warn]');
    warn.hidden = !missing.length;
    warn.innerHTML = missing.length ? `<b>Before you send this, add:</b> ${missing.map((m) => (m.link ? `<a href="${m.link}">${esc(m.text)}</a>` : esc(m.text))).join(' · ')}` : '';

    q('[data-role=filename]').innerHTML = `PDF name: <code>${esc(buildFileName(store.settings.invoice.fileNameTemplate, inv, store.settings, store.settings.invoice.fileNameSlug !== false))}</code> · <a href="#/settings/files">change</a>`;
  }

  function staleClient() {
    const live = store.client(inv.clientId);
    if (!live || !inv.client) return false;
    return JSON.stringify(clientSnapshot(live)) !== JSON.stringify(inv.client);
  }

  // ---------- preview ----------
  const drawPreview = debounce(() => {
    q('[data-role=preview]').innerHTML = renderInvoice(inv, store.settings);
    fitPreview();
  }, 90);

  function fitPreview() {
    const col = q('.preview-col');
    const scale = q('[data-role=scale]');
    const page = scale.querySelector('.inv-page');
    if (!col || !page) return;
    const w = col.clientWidth - 2;
    const s = col.classList.contains('zoom') ? 1 : Math.min(1, w / 794);
    scale.style.setProperty('--s', s);
    scale.style.height = `${page.offsetHeight * s}px`;
  }
  const ro = new ResizeObserver(() => fitPreview());
  ro.observe(q('.preview-col'));

  function changed({ items = false, preview = true } = {}) {
    if (items) drawItems();
    refreshMeta();
    if (preview) drawPreview();
  }

  // ---------- rate ----------
  // USD->EUR rate for conversions, whatever the invoice currency is now.
  async function usdRate() {
    if (inv.currency === 'USD' && inv.rateToEur) return inv.rateToEur;
    if (inv.usdRate) return inv.usdRate;
    try {
      const r = (await getRate('USD', 'EUR', inv.issueDate)).rate;
      inv.usdRate = Number(r.toFixed(6));
      return inv.usdRate;
    } catch {
      return lastKnownUsdEur() || 0;
    }
  }

  async function fetchRate({ quiet = false } = {}) {
    if (inv.currency !== 'USD') return;
    const wasClean = !dirty();
    rateBusy = true;
    refreshMeta();
    try {
      const r = await getRate('USD', 'EUR', inv.issueDate);
      if (inv.currency !== 'USD') return; // switched while fetching
      inv.rateToEur = Number(r.rate.toFixed(6));
      inv.rateDate = r.date;
      inv.rateSource = 'ecb';
      input('rateToEur').value = String(inv.rateToEur);
      if (!quiet) toast(`1 USD = ${r.rate.toFixed(4)} EUR (ECB, ${fmtDate(r.date)})`);
      if (quiet && wasClean) {
        // an automatic lookup isn't an edit: don't nag about it
        if (saved != null) {
          const fields = { rateToEur: inv.rateToEur, rateDate: inv.rateDate, rateSource: inv.rateSource };
          store.update((d) => { const x = d.invoices.find((y) => y.id === inv.id); if (x) Object.assign(x, fields); });
          saved = JSON.stringify(inv);
        } else {
          baseline = JSON.stringify(inv);
        }
      }
    } catch (e) {
      if (!quiet) toast(e.message, { type: 'error' });
    } finally {
      rateBusy = false;
      changed();
    }
  }

  async function switchCurrency(to) {
    if (to === inv.currency) return;
    const from = inv.currency;
    const total = invoiceTotal(inv);
    const rate = await usdRate(); // EUR per USD
    if (total > 0) {
      const converted = rate ? (to === 'EUR' ? total * rate : total / rate) : null;
      const choice = await modal({
        title: `Switch to ${to}?`,
        body: `<p class="modal-text">${converted != null
          ? `Convert the amounts at <b>1 USD = ${rate.toFixed(4)} EUR</b> (${fmtMoney(total, from)} → <b>${fmtMoney(converted, to)}</b>), or keep the same numbers and just change the currency?`
          : 'There’s no exchange rate available right now, so the numbers will stay the same and only the currency changes.'}</p>`,
        actions: [
          { label: 'Cancel', value: null, kind: 'ghost' },
          { label: `Keep numbers (${fmtMoney(total, to)})`, value: 'keep', kind: 'ghost' },
          ...(converted != null ? [{ label: `Convert to ${fmtMoney(converted, to)}`, value: 'convert', kind: 'primary', submit: true }] : [{ label: 'Change currency', value: 'keep', kind: 'primary', submit: true }]),
        ],
      });
      if (!choice) return;
      if (choice === 'convert') {
        inv.items = inv.items.map((it) => ({ ...it, rate: round2(to === 'EUR' ? it.rate * rate : it.rate / rate) }));
      }
    }
    inv.currency = to;
    if (to === 'EUR') {
      // keep the USD rate around in case they switch back
      inv.usdRate = rate || inv.usdRate || 0;
      inv.rateToEur = 1;
      inv.rateSource = 'same';
      inv.rateDate = '';
    } else {
      inv.rateToEur = rate || 0;
      inv.rateSource = inv.rateToEur ? 'ecb' : '';
      if (!inv.rateDate && inv.rateToEur) inv.rateDate = inv.issueDate;
      input('rateToEur').value = inv.rateToEur ? String(inv.rateToEur) : '';
      if (!inv.rateToEur) fetchRate({ quiet: true });
    }
    changed({ items: true });
  }

  // ---------- save ----------
  async function save({ silent = false } = {}) {
    const problems = [];
    if (!inv.number.trim()) problems.push('an invoice number');
    if (!inv.issueDate) problems.push('an invoice date');
    if (!inv.dueDate) problems.push('a due date');
    if (problems.length) {
      toast(`Add ${problems.join(', ')} first`, { type: 'error' });
      return false;
    }
    if (inv.dueDate < inv.issueDate) {
      toast('The due date is before the invoice date', { type: 'error' });
      return false;
    }
    const dupe = store.data.invoices.find((x) => x.id !== inv.id && x.number.trim().toLowerCase() === inv.number.trim().toLowerCase());
    if (dupe) {
      const fresh = nextInvoiceNumber(store.data);
      const ok = await confirmDialog(`${inv.number} is already used by another invoice. Save this one as ${fresh} instead?`, { title: 'Number already used', ok: `Use ${fresh}` });
      if (!ok) return false;
      inv.number = fresh;
      input('number').value = fresh;
    }
    if (saved != null && !store.invoice(inv.id)) {
      const ok = await confirmDialog('This invoice was deleted on another device while you had it open. Save it again?', { title: 'Invoice was deleted', ok: 'Save it again' });
      if (!ok) return false;
    }
    const prefix = store.settings.invoice.prefix || '';
    const mine = numericPart(inv.number, prefix);
    const maxOther = Math.max(0, ...store.data.invoices.filter((x) => x.id !== inv.id).map((x) => numericPart(x.number, prefix) || 0));
    const wasNumber = saved ? JSON.parse(saved).number : null;
    if (mine && mine > maxOther + 1 && wasNumber !== inv.number) {
      const expected = nextInvoiceNumber({ ...store.data, invoices: store.data.invoices.filter((x) => x.id !== inv.id) });
      const ok = await confirmDialog(`${inv.number} skips ahead of ${expected}, which leaves a gap in your numbering. French rules expect invoice numbers without gaps.`, { title: 'Gap in numbering', ok: `Keep ${inv.number}` });
      if (!ok) return false;
    }
    const clean = clone(inv);
    clean.updatedAt = new Date().toISOString();
    store.update((d) => {
      const i = d.invoices.findIndex((x) => x.id === clean.id);
      if (i >= 0) d.invoices[i] = clean;
      else d.invoices.push(clean);
    });
    inv = clone(clean);
    saved = JSON.stringify(inv);
    if (isNew) history.replaceState(null, '', `#/invoices/${inv.id}`);
    refreshMeta();
    if (!silent) toast(`${inv.number} saved`);
    return true;
  }

  // ---------- events ----------
  form.addEventListener('input', (e) => {
    const t = e.target;
    const itemEl = t.closest('.item');
    if (t.classList.contains('autogrow')) grow(t);
    if (itemEl && t.dataset.f) {
      const it = inv.items[Number(itemEl.dataset.i)];
      if (t.dataset.f === 'qty' || t.dataset.f === 'rate') it[t.dataset.f] = parseNumber(t.value);
      else it[t.dataset.f] = t.value;
      updateAmounts();
      changed({ preview: true });
      return;
    }
    switch (t.name) {
      case 'campaign': {
        // typing "Game - August 2026" fills the month for you
        const split = splitCampaignMonth(t.value);
        if (split && e.inputType !== 'deleteContentBackward') {
          inv.campaign = split.name;
          inv.campaignMonth = split.month;
          t.value = split.name;
          input('campaignMonth').value = split.month;
        } else inv.campaign = t.value;
        break;
      }
      case 'campaignMonth':
        inv.campaignMonth = t.value;
        break;
      case 'reference': case 'number': case 'notes':
        inv[t.name] = t.value;
        break;
      case 'serviceDate':
        inv.serviceDate = t.value;
        break;
      case 'issueDate':
        if (!t.value) break;
        {
          const oldDue = inv.dueDate;
          inv.issueDate = t.value;
          inv.dueDate = addDays(inv.issueDate, inv.termsDays);
          input('dueDate').value = inv.dueDate;
          if (inv.reminderDate && oldDue) {
            inv.reminderDate = addDays(inv.reminderDate, daysBetween(oldDue, inv.dueDate));
            input('reminderDate').value = inv.reminderDate;
          }
        }
        if (inv.currency === 'USD' && inv.rateSource !== 'manual') fetchRate({ quiet: true });
        break;
      case 'termsDays': {
        const oldDue = inv.dueDate;
        inv.termsDays = Math.max(0, Math.min(365, Number(t.value) || 0));
        inv.dueDate = addDays(inv.issueDate, inv.termsDays);
        input('dueDate').value = inv.dueDate;
        if (inv.reminderDate && oldDue) { inv.reminderDate = addDays(inv.reminderDate, daysBetween(oldDue, inv.dueDate)); input('reminderDate').value = inv.reminderDate; }
        break;
      }
      case 'dueDate':
        if (!t.value) break;
        inv.dueDate = t.value;
        inv.termsDays = Math.max(0, daysBetween(inv.issueDate, inv.dueDate) ?? inv.termsDays);
        input('termsDays').value = inv.termsDays;
        break;
      case 'reminderDate':
        inv.reminderDate = t.value;
        break;
      case 'rateToEur': {
        let v = parseNumber(String(t.value).replace(',', '.'));
        if (v > 5) v = 0; // 1 USD is never worth 5+ EUR: a typo
        t.setCustomValidity(t.value && !v ? 'Type the rate like 0.86' : '');
        inv.rateToEur = v > 0 ? v : 0;
        inv.rateSource = v > 0 ? 'manual' : '';
        inv.rateDate = v > 0 ? todayISO() : '';
        break;
      }
      default:
        return;
    }
    changed();
  });

  form.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.matches('[data-role=client]')) {
      if (t.value === '__new') {
        t.value = inv.clientId || '';
        const c = await editClient();
        if (c) applyClient(c.id);
        fillClientSelect();
        return;
      }
      applyClient(t.value);
    }
    if (t.matches('[data-role=saveditem]')) {
      const preset = store.settings.savedItems.find((x) => x.id === t.value);
      t.value = '';
      if (!preset) return;
      let rate = Number(preset.rate) || 0;
      if (rate && preset.currency && preset.currency !== inv.currency) {
        const fx = await usdRate();
        if (fx) rate = round2(preset.currency === 'USD' ? rate * fx : rate / fx);
        else toast(`No exchange rate available, so ${fmtMoney(rate, preset.currency)} was added as ${fmtMoney(rate, inv.currency)}. Check the amount.`, { type: 'error' });
      }
      const title = `1 x ${preset.title}${inv.reference ? ` - ${inv.reference}` : ''}${inv.campaign ? ` ${inv.campaign}` : ''}`;
      const item = { title, description: [inv.campaign, fmtMonth(inv.campaignMonth)].filter(Boolean).join(' - '), qty: 1, rate };
      const onlyBlank = inv.items.length === 1 && !inv.items[0].title && !inv.items[0].rate;
      if (onlyBlank) inv.items = [item];
      else inv.items.push(item);
      changed({ items: true });
    }
  });

  function applyClient(cid) {
    const c = store.client(cid);
    inv.clientId = c?.id || '';
    inv.client = clientSnapshot(c);
    if (c && isNew && !saved) {
      // new invoice: take the client's usual terms and currency
      inv.termsDays = c.termsDays ?? inv.termsDays;
      inv.dueDate = addDays(inv.issueDate, inv.termsDays);
      input('termsDays').value = inv.termsDays;
      input('dueDate').value = inv.dueDate;
      if (c.currency && c.currency !== inv.currency && invoiceTotal(inv) === 0) {
        inv.currency = c.currency;
        inv.rateToEur = c.currency === 'EUR' ? 1 : 0;
        inv.rateSource = c.currency === 'EUR' ? 'same' : '';
        inv.rateDate = '';
        if (c.currency === 'USD') fetchRate({ quiet: true });
        drawItems();
      }
    }
    changed();
  }

  root.addEventListener('click', async (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab) {
      root.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b === tab)));
      q('.editor').dataset.view = tab.dataset.tab;
      requestAnimationFrame(tab.dataset.tab === 'preview' ? fitPreview : growAll);
      return;
    }
    const days = e.target.closest('[data-days]');
    if (days) {
      const oldDue = inv.dueDate;
      inv.termsDays = Number(days.dataset.days);
      inv.dueDate = addDays(inv.issueDate, inv.termsDays);
      if (inv.reminderDate && oldDue) { inv.reminderDate = addDays(inv.reminderDate, daysBetween(oldDue, inv.dueDate)); input('reminderDate').value = inv.reminderDate; }
      input('termsDays').value = inv.termsDays;
      input('dueDate').value = inv.dueDate;
      changed();
      return;
    }
    const rem = e.target.closest('[data-rem]');
    if (rem) {
      const r = rem.dataset.rem;
      inv.reminderDate = r === 'none' ? '' : r === 'due' ? inv.dueDate : addDays(inv.dueDate, Number(r));
      input('reminderDate').value = inv.reminderDate;
      changed({ preview: false });
      return;
    }
    const cur = e.target.closest('[data-cur]');
    if (cur) { switchCurrency(cur.dataset.cur); return; }
    const st = e.target.closest('[data-st]');
    if (st) {
      const v = st.dataset.st;
      if (v === 'paid') {
        if (dirty() && !(await save({ silent: true }))) return;
        const working = store.invoice(inv.id);
        if (working && await markPaid(working)) {
          inv = clone(store.invoice(inv.id));
          saved = JSON.stringify(inv);
        }
        changed();
        return;
      }
      if (inv.status === 'paid') {
        const ok = await confirmDialog('This clears the recorded payment. Continue?', { title: 'Mark as unpaid', ok: 'Mark unpaid' });
        if (!ok) return;
        inv.paidDate = '';
        inv.paidAmountEur = null;
        inv.paidFees = 0;
        inv.bankRef = '';
      }
      inv.status = v;
      if (v === 'waiting' && !inv.reminderDate) {
        inv.reminderDate = addDays(inv.dueDate, store.settings.invoice.reminderOffsetDays || 0);
        input('reminderDate').value = inv.reminderDate;
      }
      changed({ preview: false });
      return;
    }

    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    btn.closest('details')?.removeAttribute('open');
    const itemEl = btn.closest('.item');
    const i = itemEl ? Number(itemEl.dataset.i) : -1;
    switch (btn.dataset.act) {
      case 'additem':
        inv.items.push({ title: '', description: '', qty: 1, rate: 0 });
        changed({ items: true });
        q(`.item[data-i="${inv.items.length - 1}"] [data-f=title]`)?.focus();
        break;
      case 'removeitem':
        inv.items.splice(i, 1);
        changed({ items: true });
        break;
      case 'up':
        if (i > 0) [inv.items[i - 1], inv.items[i]] = [inv.items[i], inv.items[i - 1]];
        changed({ items: true });
        break;
      case 'down':
        if (i < inv.items.length - 1) [inv.items[i + 1], inv.items[i]] = [inv.items[i], inv.items[i + 1]];
        changed({ items: true });
        break;
      case 'samedate':
        inv.serviceDate = inv.issueDate;
        input('serviceDate').value = inv.serviceDate;
        changed();
        break;
      case 'zoom': {
        const col = q('.preview-col');
        col.classList.toggle('zoom');
        btn.textContent = col.classList.contains('zoom') ? 'Fit to screen' : 'Zoom to 100%';
        fitPreview();
        break;
      }
      case 'email': {
        if (dirty() && !(await save({ silent: true }))) return;
        emailInvoice(store.invoice(inv.id));
        break;
      }
      case 'liverate':
        fetchRate();
        break;
      case 'editclient': {
        const c = store.client(inv.clientId);
        if (!c) return;
        const updated = await editClient(c);
        if (updated) {
          inv.client = clientSnapshot(updated);
          fillClientSelect();
          changed();
        }
        break;
      }
      case 'refreshclient':
        inv.client = clientSnapshot(store.client(inv.clientId));
        changed();
        break;
      case 'save':
        save();
        break;
      case 'pdf':
      case 'print': {
        const missing = missingForPdf(inv);
        if (missing.length) {
          const go = await confirmDialog(`This invoice is missing ${missing.map((m) => m.text).join(', ')}. Make the PDF anyway?`, { title: 'Missing details', ok: 'Make PDF anyway' });
          if (!go) return;
        }
        if (dirty() && !(await save({ silent: true }))) return;
        if (btn.dataset.act === 'pdf') await exportPdf(inv);
        else printPdf(inv);
        if (inv.status === 'new') {
          toast('Sent it to the client?', {
            action: {
              label: 'Mark as waiting for payment',
              fn: async () => {
                const working = store.invoice(inv.id);
                if (working && working.status === 'new') {
                  await setStatus(working, 'waiting');
                  inv = clone(store.invoice(inv.id));
                  saved = JSON.stringify(inv);
                  fillForm();
                  changed();
                }
              },
            },
            timeout: 10000,
          });
        }
        break;
      }
      case 'paid': {
        if (dirty() && !(await save({ silent: true }))) return;
        const working = store.invoice(inv.id);
        if (working && await markPaid(working)) {
          inv = clone(store.invoice(inv.id));
          saved = JSON.stringify(inv);
          changed();
        }
        break;
      }
      case 'remind': {
        if (dirty() && !(await save({ silent: true }))) return;
        const working = store.invoice(inv.id);
        sendReminder(working);
        inv = clone(store.invoice(inv.id));
        saved = JSON.stringify(inv);
        fillForm();
        changed();
        break;
      }
      case 'duplicate': {
        if (dirty() && !(await save({ silent: true }))) return;
        navigate(`#/invoices/new?from=${encodeURIComponent(inv.id)}`);
        break;
      }
      case 'delete': {
        if (!store.invoice(inv.id)) {
          saved = JSON.stringify(inv);
          navigate('#/invoices');
          return;
        }
        if (await deleteInvoice(store.invoice(inv.id))) {
          saved = JSON.stringify(inv);
          navigate('#/invoices');
        }
        break;
      }
      default:
    }
  });

  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('textarea[data-f=title]')) e.preventDefault();
  });

  const onKey = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      save();
    }
  };
  document.addEventListener('keydown', onKey);

  // ---------- go ----------
  fillSavedItems();
  fillCampaigns();
  fillForm();
  changed();
  if (inv.currency === 'USD' && !inv.rateToEur) fetchRate({ quiet: true });
  if (from) toast(`Copy of ${from.number} – check the dates and save to keep it`);
  if (isNew) setTimeout(() => (inv.clientId ? input('campaign') : q('[data-role=client]')).focus(), 50);

  return () => {
    ro.disconnect();
    document.removeEventListener('keydown', onKey);
  };
}
