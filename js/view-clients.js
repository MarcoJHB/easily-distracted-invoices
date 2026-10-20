// Clients: saved sponsor/company details, reused on every invoice.
import { store, invoiceEur, effectiveStatus } from './store.js';
import { esc, uid, fmtMoney } from './util.js';
import { modal, field, formValues, toast, confirmDialog, icons } from './ui.js';

export async function editClient(existing = null, { prefillName = '' } = {}) {
  const c = existing || { name: prefillName, currency: store.settings.invoice.defaultCurrency, termsDays: store.settings.invoice.defaultTermsDays };
  const body = `
    <div class="grid2">
      ${field({ label: 'Company name *', name: 'name', value: c.name, attrs: 'required autocomplete="organization"', full: true })}
      ${field({ label: 'Contact person', name: 'contactName', value: c.contactName || '', placeholder: 'Optional' })}
      ${field({ label: 'Billing email', name: 'email', type: 'email', value: c.email || '', placeholder: 'For payment reminders' })}
      ${field({ label: 'Address', name: 'addressLines', type: 'textarea', value: c.addressLines || '', placeholder: 'Street and number\nCity\nPostcode', full: true, rows: 3, hint: 'One line per row, exactly as it should appear on the invoice.' })}
      ${field({ label: 'Country', name: 'country', value: c.country || '', placeholder: 'Germany', hint: 'Only printed if it isn’t already in the address.' })}
      ${field({ label: 'VAT number', name: 'vatNumber', value: c.vatNumber || '', placeholder: 'DE123456789' })}
      ${field({ label: 'SIREN (French companies)', name: 'siren', value: c.siren || '', placeholder: '9 digits', hint: 'Required on invoices to French businesses since Sept 2026.' })}
      ${field({ label: 'VAT wording on invoices', name: 'vatRule', value: c.vatRule || 'auto', options: [['auto', 'Automatic (reverse charge if EU VAT number)'], ['franchise', 'VAT not applicable (franchise)'], ['reverse', 'Reverse charge (EU business)'], ['none', 'Print nothing']], hint: 'EU businesses outside France get the reverse-charge mention.' })}
      ${field({ label: 'Usual currency', name: 'currency', value: c.currency || 'USD', options: [['USD', 'USD ($)'], ['EUR', 'EUR (€)']] })}
      ${field({ label: 'Payment terms (days)', name: 'termsDays', type: 'number', value: c.termsDays ?? 30, attrs: 'min="0" max="365" inputmode="numeric"' })}
      ${field({ label: 'Notes (private)', name: 'notes', type: 'textarea', value: c.notes || '', placeholder: 'Agency contact, rate history… never printed', full: true, rows: 2 })}
    </div>`;
  const values = await modal({
    title: existing ? 'Edit client' : 'New client',
    body,
    wide: true,
    getValue: (el) => formValues(el),
    actions: [
      { label: 'Cancel', value: null, kind: 'ghost' },
      {
        label: existing ? 'Save client' : 'Add client',
        kind: 'primary',
        submit: true,
        validate: (el) => {
          const v = formValues(el);
          if (!v.name.trim()) return 'Give the client a name.';
          if (v.email && !/^\S+@\S+\.\S+$/.test(v.email.trim())) return 'That email address doesn’t look right.';
          const dupe = store.data.clients.find((x) => x.name.trim().toLowerCase() === v.name.trim().toLowerCase() && x.id !== existing?.id);
          if (dupe) return `You already have a client called “${dupe.name}”.`;
          return '';
        },
      },
    ],
  });
  if (!values) return null;
  const record = {
    ...(existing || {}),
    id: existing?.id || uid('cli'),
    name: values.name.trim(),
    contactName: values.contactName.trim(),
    email: values.email.trim(),
    addressLines: values.addressLines.trim(),
    country: values.country.trim(),
    vatNumber: values.vatNumber.trim(),
    siren: values.siren.replace(/\s/g, ''),
    vatRule: values.vatRule || 'auto',
    currency: values.currency,
    termsDays: Math.max(0, Number(values.termsDays) || 0),
    notes: values.notes.trim(),
    updatedAt: new Date().toISOString(),
  };
  store.update((d) => {
    const i = d.clients.findIndex((x) => x.id === record.id);
    if (i >= 0) d.clients[i] = record;
    else d.clients.push(record);
  });
  toast(existing ? 'Client saved' : `${record.name} added`);
  return record;
}

export function renderClients(root, { navigate }) {
  const state = { q: '' };

  function stats(client) {
    const invs = store.data.invoices.filter((i) => i.clientId === client.id);
    let billed = 0, outstanding = 0;
    for (const inv of invs) {
      const eur = invoiceEur(inv) || 0;
      billed += eur;
      if (effectiveStatus(inv) !== 'paid') outstanding += eur;
    }
    return { count: invs.length, billed, outstanding };
  }

  function draw() {
    const q = state.q.trim().toLowerCase();
    const list = store.data.clients
      .filter((c) => !q || [c.name, c.contactName, c.email, c.country, c.vatNumber].join(' ').toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
    root.querySelector('.client-grid').innerHTML = list.length
      ? list.map((c) => {
        const s = stats(c);
        return `
          <article class="client-card" data-id="${esc(c.id)}">
            <div class="client-top">
              <div class="avatar" aria-hidden="true">${esc(c.name.slice(0, 1).toUpperCase())}</div>
              <div class="client-id">
                <h3>${esc(c.name)}</h3>
                <p>${esc([c.country, c.vatNumber].filter(Boolean).join(' · ') || 'No address yet')}</p>
              </div>
              <button class="icon-btn" data-act="edit" aria-label="Edit ${esc(c.name)}" title="Edit">${icons.edit}</button>
            </div>
            <dl class="client-stats">
              <div><dt>Invoices</dt><dd>${s.count}</dd></div>
              <div><dt>Billed</dt><dd>${fmtMoney(s.billed, 'EUR')}</dd></div>
              <div><dt>Outstanding</dt><dd class="${s.outstanding > 0 ? 'warn' : ''}">${fmtMoney(s.outstanding, 'EUR')}</dd></div>
            </dl>
            <p class="client-meta">${esc(c.email || 'No billing email')} · ${esc(c.currency)} · ${esc(c.termsDays)} days</p>
            <div class="client-actions">
              <button class="btn btn-soft btn-sm" data-act="invoice">${icons.plus}New invoice</button>
              <button class="btn btn-ghost btn-sm" data-act="history">View invoices</button>
              <button class="icon-btn danger" data-act="delete" aria-label="Delete ${esc(c.name)}" title="Delete">${icons.trash}</button>
            </div>
          </article>`;
      }).join('')
      : `<div class="empty">
          <h3>${q ? 'No clients match that search' : 'No clients yet'}</h3>
          <p>${q ? 'Try a different name.' : 'Save a sponsor once and their details fill in on every invoice.'}</p>
          ${q ? '' : `<button class="btn btn-primary" data-act="add">${icons.plus}Add your first client</button>`}
        </div>`;
  }

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Clients</h1>
        <p class="sub">${store.data.clients.length} saved</p>
      </div>
      <button class="btn btn-primary" data-act="add">${icons.plus}New client</button>
    </div>
    <div class="toolbar">
      <label class="search">${icons.search}<input type="search" placeholder="Search clients" aria-label="Search clients" data-role="q"></label>
    </div>
    <div class="client-grid"></div>`;

  root.querySelector('[data-role=q]').addEventListener('input', (e) => {
    state.q = e.target.value;
    draw();
  });

  root.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = btn.closest('[data-id]')?.dataset.id;
    const client = id ? store.client(id) : null;
    switch (btn.dataset.act) {
      case 'add':
        if (await editClient()) draw();
        break;
      case 'edit':
        if (await editClient(client)) draw();
        break;
      case 'invoice':
        navigate(`#/invoices/new?client=${encodeURIComponent(id)}`);
        break;
      case 'history':
        navigate(`#/invoices?client=${encodeURIComponent(id)}`);
        break;
      case 'delete': {
        const n = store.data.invoices.filter((i) => i.clientId === id).length;
        const ok = await confirmDialog(
          n ? `${client.name} has ${n} invoice${n > 1 ? 's' : ''}. Those invoices keep their copy of the address, but the client will be gone from your list.` : `Delete ${client.name}?`,
          { title: 'Delete client', ok: 'Delete', danger: true },
        );
        if (!ok) return;
        const backup = { ...client };
        store.update((d) => { d.clients = d.clients.filter((x) => x.id !== id); });
        draw();
        toast(`${backup.name} deleted`, { action: { label: 'Undo', fn: () => { store.update((d) => d.clients.push(backup)); draw(); } } });
        break;
      }
      default:
    }
  });

  draw();
}
