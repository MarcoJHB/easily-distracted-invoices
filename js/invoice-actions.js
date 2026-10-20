// Actions shared by the tracker and the editor: status changes, payments,
// reminders, duplicate, delete, PDF.
import {
  store, invoiceTotal, invoiceEur, nextInvoiceNumber, normalizeInvoice, effectiveStatus, numericPart, vatRuleFor,
} from './store.js';
import {
  esc, uid, clone, todayISO, addDays, fmtDate, fmtMoney, round2, parseNumber,
} from './util.js';
import { modal, field, formValues, toast, confirmDialog } from './ui.js';
import { downloadPdf, printInvoice, businessDisplayName } from './invoice.js';
import { getRate } from './rates.js';

function save(inv) {
  store.update((d) => {
    const i = d.invoices.findIndex((x) => x.id === inv.id);
    inv.updatedAt = new Date().toISOString();
    if (i >= 0) d.invoices[i] = inv;
    else d.invoices.push(inv);
  });
}

export async function markPaid(inv) {
  const total = invoiceTotal(inv);
  let suggestedEur = inv.currency === 'EUR' ? total : (inv.rateToEur ? round2(total * inv.rateToEur) : '');
  const body = `
    <p class="modal-text">Record the payment for <b>${esc(inv.number)}</b> (${fmtMoney(total, inv.currency)}).</p>
    <div class="grid2">
      ${field({ label: 'Date received', name: 'paidDate', type: 'date', value: inv.paidDate || todayISO() })}
      ${field({
        label: 'Amount received in EUR',
        name: 'paidAmountEur',
        value: inv.paidAmountEur ?? suggestedEur,
        attrs: 'inputmode="decimal"',
        hint: inv.currency === 'USD' ? 'Use the amount that actually landed in your bank. That is what counts for your URSSAF declaration and the revenue dashboard.' : '',
      })}
    </div>
    ${inv.currency === 'USD' ? '<button type="button" class="link-btn" data-role="paidrate">Use the ECB rate on the date received</button>' : ''}`;
  const res = await modal({
    title: 'Mark as paid',
    body,
    getValue: (el) => formValues(el),
    onMount: (el) => {
      el.querySelector('[data-role=paidrate]')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.textContent = 'Fetching rate…';
        try {
          const date = el.querySelector('[name=paidDate]').value;
          const r = await getRate('USD', 'EUR', date);
          el.querySelector('[name=paidAmountEur]').value = round2(total * r.rate).toFixed(2);
          btn.textContent = `Rate ${r.rate.toFixed(4)} from ${fmtDate(r.date)}`;
        } catch (err) {
          btn.textContent = err.message;
        }
      });
    },
    actions: [
      { label: 'Cancel', value: null, kind: 'ghost' },
      {
        label: 'Mark as paid',
        kind: 'primary',
        submit: true,
        validate: (el) => {
          const v = formValues(el);
          if (!v.paidDate) return 'When did the money arrive?';
          if (v.paidAmountEur === '' || parseNumber(v.paidAmountEur) <= 0) return 'Enter the amount received in euros.';
          return '';
        },
      },
    ],
  });
  if (!res) return false;
  inv.status = 'paid';
  inv.paidDate = res.paidDate;
  inv.paidAmountEur = round2(parseNumber(res.paidAmountEur));
  save(inv);
  toast(`${inv.number} marked as paid 🎉`);
  return true;
}

// Change status from the tracker. Returns true if something changed.
export async function setStatus(inv, status) {
  if (status === inv.status) return false;
  if (status === 'paid') return markPaid(inv);
  if (inv.status === 'paid') {
    const ok = await confirmDialog(`This clears the payment recorded for ${inv.number}. Continue?`, { title: 'Mark as unpaid', ok: 'Mark unpaid' });
    if (!ok) return false;
  }
  const prev = clone(inv);
  inv.status = status;
  if (status === 'waiting' && !inv.reminderDate && inv.dueDate) {
    inv.reminderDate = addDays(inv.dueDate, store.settings.invoice.reminderOffsetDays || 0);
  }
  if (prev.status === 'paid') {
    inv.paidDate = '';
    inv.paidAmountEur = null;
  }
  save(inv);
  toast(`${inv.number} → ${status === 'waiting' ? 'Waiting for payment' : 'New'}`, {
    action: { label: 'Undo', fn: () => save(prev) },
  });
  return true;
}

export function reminderEmail(inv) {
  const s = store.settings;
  const c = inv.client || {};
  const firstName = (s.business.name || '').split(' ')[0] || '';
  const status = effectiveStatus(inv);
  const total = fmtMoney(invoiceTotal(inv), inv.currency);
  const what = inv.campaign ? ` for ${inv.campaign}` : '';
  const dueLine = status === 'overdue'
    ? `was due on ${fmtDate(inv.dueDate)} and I haven't seen the payment come through yet`
    : `is due on ${fmtDate(inv.dueDate)}`;
  const subject = `Payment reminder – Invoice ${inv.number}${inv.campaign ? ` (${inv.campaign})` : ''}`;
  const body = [
    `Hi ${c.contactName ? c.contactName.split(' ')[0] : 'there'},`,
    '',
    `Hope you're doing well! Just a quick reminder that invoice ${inv.number}${what} (${total}) ${dueLine}.`,
    '',
    'I\'ve attached the invoice again in case it got buried. Let me know if you need anything else from me to get it processed.',
    '',
    'Thanks a lot!',
    firstName,
    s.business.tradeName || '',
  ].join('\n');
  return { to: c.email || '', subject, body };
}

export function sendReminder(inv) {
  const { to, subject, body } = reminderEmail(inv);
  const href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  window.location.href = href;
  const prev = clone(inv);
  inv.remindersSent = [...(inv.remindersSent || []), todayISO()];
  inv.reminderDate = addDays(todayISO(), 7);
  save(inv);
  toast(`Email drafted${to ? '' : ' (add a billing email to the client to fill the To: field)'}. Next reminder set for ${fmtDate(inv.reminderDate)}.`, {
    action: { label: 'Undo', fn: () => save(prev) },
    timeout: 8000,
  });
}

export async function copyReminder(inv) {
  const { subject, body } = reminderEmail(inv);
  try {
    await navigator.clipboard.writeText(`${subject}\n\n${body}`);
    toast('Reminder text copied');
  } catch {
    toast('Couldn’t copy – your browser blocked the clipboard', { type: 'error' });
  }
}

// Builds an unsaved copy (the editor saves it if you keep it).
export function duplicateInvoice(inv) {
  const terms = inv.termsDays ?? store.settings.invoice.defaultTermsDays;
  const strip = (t) => (inv.reference ? String(t || '').split(inv.reference).join('').replace(/\s+-\s+-\s+/g, ' - ').replace(/\s{2,}/g, ' ').replace(/\s+-\s*$/, '').trim() : t);
  const copy = normalizeInvoice({
    ...clone(inv),
    id: uid('inv'),
    number: nextInvoiceNumber(store.data),
    status: 'new',
    reference: '',
    issueDate: todayISO(),
    serviceDate: '',
    termsDays: terms,
    dueDate: addDays(todayISO(), terms),
    reminderDate: '',
    paidDate: '',
    paidAmountEur: null,
    remindersSent: [],
    rateDate: '',
    rateSource: inv.currency === 'EUR' ? 'same' : '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  copy.items = copy.items.map((it) => ({ ...it, title: strip(it.title) }));
  if (copy.currency === 'USD') copy.rateToEur = 0;
  copy.usdRate = 0;
  return copy;
}

export async function deleteInvoice(inv) {
  const prefix = store.settings.invoice.prefix || '';
  const mine = numericPart(inv.number, prefix) || 0;
  const isLast = !store.data.invoices.some((x) => x.id !== inv.id && (numericPart(x.number, prefix) || 0) > mine);
  const ok = await confirmDialog(
    `Delete invoice ${inv.number}?${inv.status !== 'new' && !isLast ? ' French rules expect invoice numbers to have no gaps, so for an invoice you already sent it’s better to issue a credit note than to delete it.' : ''}`,
    { title: 'Delete invoice', ok: 'Delete', danger: true },
  );
  if (!ok) return false;
  const backup = clone(inv);
  store.update((d) => { d.invoices = d.invoices.filter((x) => x.id !== inv.id); });
  toast(`${backup.number} deleted`, { action: { label: 'Undo', fn: () => store.update((d) => d.invoices.push(backup)) } });
  return true;
}

export async function exportPdf(inv) {
  const stop = toast('Building PDF…', { timeout: 20000 });
  try {
    const name = await downloadPdf(inv, store.settings);
    stop();
    toast(`${inv.number} PDF saved`);
    void name;
  } catch (e) {
    stop();
    toast(`PDF failed: ${e.message}`, { type: 'error' });
  }
}

export function printPdf(inv) {
  printInvoice(inv, store.settings);
}

export function missingForPdf(inv) {
  const s = store.settings;
  const missing = [];
  const add = (text, link) => missing.push({ text, link });
  if (!s.business.name) add('your name', '#/settings/business');
  if (!s.business.addressLines) add('your address', '#/settings/business');
  if (!s.business.siret) add('your SIRET', '#/settings/business');
  if (!s.bank.iban) add('your IBAN', '#/settings/bank');
  if (inv.client && vatRuleFor(inv.client) === 'reverse' && !s.business.vatNumber) add('your intra-EU VAT number (needed for EU clients)', '#/settings/business');
  if (!inv.client?.name) add('a client');
  if (!inv.serviceDate) add('the service date');
  if (!invoiceTotal(inv)) add('an amount');
  else if (invoiceTotal(inv) < 0) add('a positive total (it’s negative – use a credit note for refunds)');
  return missing;
}

// Opens the mail app with a ready-to-send message; the PDF still needs attaching.
export function emailInvoice(inv) {
  const s = store.settings;
  const c = inv.client || {};
  const first = (s.business.name || '').split(' ')[0] || '';
  const subject = `Invoice ${inv.number}${inv.campaign ? ` – ${inv.campaign}` : ''}`;
  const body = [
    `Hi ${c.contactName ? c.contactName.split(' ')[0] : 'there'},`,
    '',
    `Please find attached invoice ${inv.number}${inv.campaign ? ` for ${inv.campaign}` : ''}, for ${fmtMoney(invoiceTotal(inv), inv.currency)}, due on ${fmtDate(inv.dueDate)}.`,
    '',
    'Bank details are on the invoice. Let me know if you need anything else!',
    '',
    'Thanks,',
    first,
    s.business.tradeName || '',
  ].join('\n');
  window.location.href = `mailto:${encodeURIComponent(c.email || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  toast('Email drafted – attach the PDF before sending');
}

export { businessDisplayName, invoiceEur };
