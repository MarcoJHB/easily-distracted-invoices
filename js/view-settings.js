// Settings: your fixed details, legal text, signature, file names, saved items, data.
import { store, migrate, normalizeInvoice, nextInvoiceNumber, formatNumber, isLedgerShape, localBackups } from './store.js';
import {
  esc, uid, todayISO, addDays, downloadBlob, parseNumber, fmtMoney, debounce,
} from './util.js';
import { icons, toast, confirmDialog, field, modal } from './ui.js';
import { processUpload, createPad } from './signature.js';
import { FILE_TOKENS, buildFileName } from './invoice.js';

const SECTIONS = [
  ['business', 'Your details'],
  ['bank', 'Bank'],
  ['invoice', 'Invoice & legal'],
  ['tax', 'Tax & URSSAF'],
  ['signature', 'Signature'],
  ['files', 'PDF file names'],
  ['items', 'Saved items'],
  ['data', 'Data & sync'],
];

function sampleInvoice() {
  const latest = store.data.invoices.slice().sort((a, b) => (a.issueDate < b.issueDate ? 1 : -1))[0];
  if (latest) return latest;
  return normalizeInvoice({
    number: nextInvoiceNumber(store.data),
    client: { name: 'Acme Games' },
    campaign: 'Spring campaign',
    reference: '#101',
    issueDate: todayISO(),
    dueDate: addDays(todayISO(), 30),
    currency: 'USD',
    items: [{ title: 'Integrated video', qty: 1, rate: 1000 }],
  });
}

export function renderSettings(root, { navigate, section = 'business' }) {
  if (!SECTIONS.find(([k]) => k === section)) section = 'business';
  let pad = null;

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Settings</h1>
        <p class="sub">Your details stay the same on every invoice. Changes save automatically.</p>
      </div>
      <span class="saved-flag" data-role="flag" hidden>${icons.check}Saved</span>
    </div>
    <div class="settings">
      <nav class="settings-nav" aria-label="Settings sections">
        ${SECTIONS.map(([k, l]) => `<a href="#/settings/${k}" class="${k === section ? 'on' : ''}" ${k === section ? 'aria-current="page"' : ''}>${esc(l)}</a>`).join('')}
      </nav>
      <div class="settings-body" data-role="body"></div>
    </div>`;
  const body = root.querySelector('[data-role=body]');
  const flag = root.querySelector('[data-role=flag]');
  const hideFlag = debounce(() => { flag.hidden = true; }, 1600);
  const showSaved = () => { flag.hidden = false; hideFlag(); };

  // bind inputs with data-path="settings.business.name" to the store
  function bindPaths(scope) {
    scope.querySelectorAll('[data-path]').forEach((el) => {
      const evt = el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input';
      el.addEventListener(evt, () => {
        const path = el.dataset.path.split('.');
        let v = el.type === 'checkbox' ? el.checked : el.value;
        if (el.dataset.num) {
          const raw = String(v).trim();
          v = parseNumber(raw);
          const min = el.dataset.min != null ? Number(el.dataset.min) : -Infinity;
          const max = el.dataset.max != null ? Number(el.dataset.max) : Infinity;
          const bad = raw === '' || !/\d/.test(raw) || v < min || v > max;
          el.setAttribute('aria-invalid', String(bad));
          el.title = bad ? `Enter a number between ${min} and ${max}` : '';
          if (bad) return; // keep the last good value
        }
        store.update((d) => {
          let o = d;
          for (const k of path.slice(0, -1)) o = o[k];
          o[path[path.length - 1]] = v;
        });
        showSaved();
        scope.dispatchEvent(new CustomEvent('settings-changed'));
      });
    });
  }

  const s = store.settings;
  const p = (path, opts) => {
    const parts = path.split('.');
    let v = store.data;
    for (const k of parts) v = v?.[k];
    const attrs = `data-path="${path}" ${opts.num ? 'data-num="1"' : ''} ${opts.attrs || ''}`;
    return field({ ...opts, name: parts[parts.length - 1], value: v ?? '', attrs });
  };

  const views = {
    business: () => `
      <section class="card">
        <h2>Your details</h2>
        <p class="card-sub">Printed in the “Billed By” box.</p>
        <div class="grid2">
          ${p('settings.business.name', { label: 'Your full name', placeholder: 'Jane Doe' })}
          ${p('settings.business.tradeName', { label: 'Trade name', placeholder: 'My Channel' })}
          ${p('settings.business.legalForm', { label: 'Legal form', placeholder: 'EI', hint: 'French sole traders must show “EI” next to their name.' })}
          ${p('settings.business.siret', { label: 'SIRET', placeholder: '14 digits', attrs: 'inputmode="numeric"' })}
          ${p('settings.business.addressLines', { label: 'Address', type: 'textarea', rows: 3, full: true, placeholder: '12 rue Exemple\n75000 Paris', hint: 'One line per row, as it should print.' })}
          ${p('settings.business.country', { label: 'Country', placeholder: 'France' })}
          ${p('settings.business.vatNumber', { label: 'Intra-EU VAT number', placeholder: 'FR…', hint: 'Needed to bill businesses in other EU countries, even under the VAT franchise. Ask your SIE for one if you don’t have it.' })}
          ${p('settings.business.email', { label: 'Email', type: 'email' })}
          ${p('settings.business.phone', { label: 'Phone', type: 'tel' })}
        </div>
      </section>`,

    bank: () => `
      <section class="card">
        <h2>Bank details</h2>
        <p class="card-sub">Printed at the bottom of every invoice. Leave a field empty to hide it.</p>
        <div class="grid2">
          ${p('settings.bank.accountName', { label: 'Account name' })}
          ${p('settings.bank.bank', { label: 'Bank' })}
          ${p('settings.bank.iban', { label: 'IBAN', full: true, attrs: 'spellcheck="false"' })}
          ${p('settings.bank.swift', { label: 'SWIFT / BIC', attrs: 'spellcheck="false"' })}
          ${p('settings.bank.accountNumber', { label: 'Account number', hint: 'Optional, the IBAN usually covers it.' })}
        </div>
      </section>`,

    invoice: () => `
      <section class="card">
        <h2>Numbering</h2>
        <div class="grid3">
          ${p('settings.invoice.prefix', { label: 'Prefix', placeholder: 'A' })}
          ${p('settings.invoice.padding', { label: 'Digits', type: 'number', num: true, attrs: 'min="1" max="8"' })}
          ${p('settings.invoice.nextNumber', { label: 'Start numbering at', type: 'number', num: true, attrs: 'min="1"', hint: 'Only used when it’s higher than your latest invoice.' })}
        </div>
        <p class="card-sub" data-role="nextnum"></p>
      </section>
      <section class="card">
        <h2>Defaults for new invoices</h2>
        <div class="grid3">
          ${p('settings.invoice.defaultCurrency', { label: 'Currency', options: [['USD', 'USD ($)'], ['EUR', 'EUR (€)']] })}
          ${p('settings.invoice.defaultTermsDays', { label: 'Payment terms (days)', type: 'number', num: true, attrs: 'min="0"' })}
          ${p('settings.invoice.reminderOffsetDays', { label: 'Reminder (days after due)', type: 'number', num: true, attrs: 'min="0"', hint: '0 = on the due date' })}
        </div>
      </section>
      <section class="card">
        <h2>French legal mentions</h2>
        <label class="check"><input type="checkbox" data-path="settings.invoice.showLegal" ${s.invoice.showLegal ? 'checked' : ''}> Print these in the terms on every invoice</label>
        <div class="grid1">
          ${p('settings.invoice.vatMention', { label: 'VAT franchise mention', type: 'textarea', rows: 2, hint: 'Used for French and non-EU clients. Since the 2026 recodification, the legal reference is art. L. 223-3 du CIBS (formerly art. 293 B du CGI).' })}
          ${p('settings.invoice.reverseChargeMention', { label: 'EU reverse-charge mention', type: 'textarea', rows: 2, hint: 'Used instead for businesses in other EU countries. Remember to file the DES (déclaration européenne de services) for these.' })}
          ${p('settings.invoice.latePenalty', { label: 'Late-payment penalties', type: 'textarea', rows: 2, hint: 'Off by your choice: leave empty to keep it off the invoice. Note that French rules expect this on B2B invoices (e.g. “Late payment: penalties at 3× the legal interest rate + €40 recovery fee, art. L441-10 Code de commerce”).' })}
          ${p('settings.invoice.natureOfOperation', { label: 'Nature of the transaction', hint: 'Required since Sept 2026: goods, services, or both.' })}
          ${p('settings.invoice.extraTerms', { label: 'Extra terms', type: 'textarea', rows: 2, hint: 'Optional. One per line, each becomes a numbered term.' })}
          ${p('settings.invoice.signatureLabel', { label: 'Label under the signature' })}
        </div>
        <p class="fineprint">These follow common French guidance for micro-entrepreneurs as of October 2026. I'm not a lawyer or accountant, so have your accountant check the wording once.</p>
      </section>`,

    signature: () => `
      <section class="card">
        <h2>Signature</h2>
        <p class="card-sub">Shown above “${esc(s.invoice.signatureLabel || 'Authorised Signatory')}”. Upload a photo of your signature on white paper, or draw one.</p>
        <div class="sig-current" data-role="sigcurrent"></div>
        <div class="sig-tabs seg" role="tablist">
          <button role="tab" data-sig="upload" aria-selected="true">${icons.upload}Upload</button>
          <button role="tab" data-sig="draw" aria-selected="false">${icons.pen}Draw</button>
        </div>
        <div class="sig-panel" data-panel="upload">
          <label class="dropzone" data-role="drop">
            <input type="file" accept="image/png,image/jpeg,image/webp" data-role="file" class="sr-only">
            ${icons.upload}
            <b>Choose an image</b><span>or drop it here · PNG or JPG</span>
          </label>
          <label class="check"><input type="checkbox" data-role="removebg" checked> Remove the paper background</label>
        </div>
        <div class="sig-panel" data-panel="draw" hidden>
          <div class="pad-wrap"><canvas class="pad" data-role="pad" aria-label="Signature drawing area"></canvas><span class="pad-line" aria-hidden="true"></span><span class="pad-hint" data-role="padhint">Sign here with your mouse, finger or pen</span></div>
          <div class="pad-tools">
            <div class="swatches" role="radiogroup" aria-label="Ink colour">
              ${[['#111111', 'Black'], ['#1a3a8f', 'Blue'], ['#0b3a2f', 'Green']].map(([c, n], i) => `<button type="button" role="radio" aria-checked="${i === 0}" aria-label="${n} ink" data-ink="${c}" style="--c:${c}"></button>`).join('')}
            </div>
            <button type="button" class="btn btn-ghost btn-sm" data-act="padundo">${icons.undo}Undo</button>
            <button type="button" class="btn btn-ghost btn-sm" data-act="padclear">Clear</button>
            <button type="button" class="btn btn-primary btn-sm" data-act="paduse" disabled>${icons.check}Use this signature</button>
          </div>
        </div>
      </section>`,

    tax: () => {
      const t = s.tax;
      const pct = { num: true, attrs: 'inputmode="decimal" data-min="0" data-max="60"', type: 'text' };
      return `
      <section class="card">
        <h2>How your income is taxed</h2>
        <p class="card-sub">Used for the URSSAF figures on the Revenue page. Check these against your URSSAF account once.</p>
        <div class="grid2">
          ${p('settings.tax.adsenseCategory', { label: 'AdSense is declared as', options: [['bnc', 'BNC (non-commercial)'], ['bic', 'BIC – prestations de services']] })}
          ${p('settings.tax.sponsorCategory', { label: 'Sponsorships are declared as', options: [['bic', 'BIC – prestations de services'], ['bnc', 'BNC (non-commercial)']] })}
          ${p('settings.tax.period', { label: 'You declare to URSSAF', options: [['quarterly', 'Every quarter'], ['monthly', 'Every month']] })}
        </div>
        <p class="fineprint">Sources don’t all agree on whether sponsorships are BIC or BNC for creators. Go with what your URSSAF registration says, and ask your accountant if unsure.</p>
      </section>
      <section class="card">
        <h2>Contribution rates (${esc(t.ratesYear)})</h2>
        <div class="grid2">
          ${p('settings.tax.bncRate', { label: 'BNC social contributions %', ...pct, hint: '25.6% in 2026 (SSI, décret 2025-943).' })}
          ${p('settings.tax.bicRate', { label: 'BIC services social contributions %', ...pct, hint: '21.2% in 2026.' })}
          ${p('settings.tax.bncCfp', { label: 'BNC training contribution (CFP) %', ...pct, hint: '0.2%' })}
          ${p('settings.tax.bicCfp', { label: 'BIC training contribution (CFP) %', ...pct, hint: '0.1% for commercial, 0.3% for artisans.' })}
        </div>
        <label class="check"><input type="checkbox" data-path="settings.tax.versementLiberatoire" ${t.versementLiberatoire ? 'checked' : ''}> I opted for the versement libératoire (income tax paid with URSSAF)</label>
        <div class="grid2">
          ${p('settings.tax.bncVl', { label: 'Versement libératoire BNC %', ...pct, hint: '2.2%' })}
          ${p('settings.tax.bicVl', { label: 'Versement libératoire BIC services %', ...pct, hint: '1.7%' })}
        </div>
      </section>
      <section class="card">
        <h2>Limits</h2>
        <div class="grid3">
          ${p('settings.tax.vatThreshold', { label: 'VAT exemption threshold €', type: 'number', num: true, hint: '37,500 for services' })}
          ${p('settings.tax.vatThresholdHigh', { label: 'VAT immediate threshold €', type: 'number', num: true, hint: '41,250' })}
          ${p('settings.tax.microCeiling', { label: 'Micro ceiling €', type: 'number', num: true, hint: '83,600 for services' })}
        </div>
        <p class="fineprint">2026 figures. I’m not a tax adviser, so treat the results as estimates.</p>
      </section>`;
    },

    files: () => `
      <section class="card">
        <h2>PDF file names</h2>
        <p class="card-sub">Build the name from the pieces below. Click a piece to insert it.</p>
        ${p('settings.invoice.fileNameTemplate', { label: 'Template', full: true, attrs: 'spellcheck="false" data-role="tpl"' })}
        <div class="tokens">${FILE_TOKENS.map(([t, l]) => `<button type="button" class="token" data-token="${t}" title="${esc(l)}">${esc(t)}</button>`).join('')}</div>
        <label class="check"><input type="checkbox" data-path="settings.invoice.fileNameSlug" ${s.invoice.fileNameSlug !== false ? 'checked' : ''}> Lowercase, no spaces or accents (safest for email and cloud drives)</label>
        <div class="presets">
          <span>Presets:</span>
          <button type="button" class="link-btn" data-preset="invoice-{number}-{business}-{client}-{campaign}">Your current style</button>
          <button type="button" class="link-btn" data-preset="{date}_{number}_{client}">Date first</button>
          <button type="button" class="link-btn" data-preset="{year}-{month} {client} {number}">Month + client</button>
          <button type="button" class="link-btn" data-preset="Facture {number} - {client}">Facture style</button>
        </div>
        <div class="filename-preview"><span>Preview</span><code data-role="fnprev"></code></div>
      </section>`,

    items: () => `
      <section class="card">
        <div class="card-head"><h2>Saved items</h2><button type="button" class="btn btn-soft btn-sm" data-act="additem">${icons.plus}Add item</button></div>
        <p class="card-sub">Deliverables you sell often. Add them to an invoice in one click.</p>
        <div class="saved-items" data-role="items"></div>
      </section>`,

    data: () => {
      const c = store.conn || {};
      return `
      <section class="card">
        <h2>Where your data lives</h2>
        ${c.mode === 'github' ? `
          <dl class="kv">
            <div><dt>Repository</dt><dd><code>${esc(c.owner)}/${esc(c.repo)}</code> ${c.repoIsPrivate === false ? '<span class="pill st-overdue"><i></i>Public!</span>' : '<span class="pill st-paid"><i></i>Private</span>'}</dd></div>
            <div><dt>File</dt><dd><code>${esc(c.path)}</code> on <code>${esc(c.branch)}</code></dd></div>
            <div><dt>Status</dt><dd data-role="syncstate">${esc(store.sync.message)}</dd></div>
          </dl>
          ${c.repoIsPrivate === false ? '<p class="warnbox">This repo is public, so anyone can read your invoices and bank details. Make it private on GitHub (Settings → Danger zone → Change visibility).</p>' : ''}
          <div class="btn-row">
            <button type="button" class="btn btn-soft" data-act="syncnow">${icons.refresh}Sync now</button>
            <button type="button" class="btn btn-ghost" data-act="token">Replace token</button>
            <button type="button" class="btn btn-ghost" data-act="disconnect">Sign out on this device</button>
          </div>` : `
          <p>Data is saved in <b>this browser only</b>. Connect a private GitHub repo to use it on every device.</p>
          <div class="btn-row"><button type="button" class="btn btn-primary" data-act="disconnect">${icons.cloud}Connect GitHub</button></div>`}
      </section>
      <section class="card">
        <h2>Backups</h2>
        <p class="card-sub">A full copy of your settings, clients and invoices as one JSON file.</p>
        <div class="btn-row">
          <button type="button" class="btn btn-soft" data-act="export">${icons.download}Download backup</button>
          <label class="btn btn-ghost">${icons.upload}Restore from backup<input type="file" accept="application/json,.json" data-role="import" class="sr-only"></label>
        </div>
        <p class="fineprint">Restoring replaces everything in the app with the file’s contents.</p>
      </section>
      ${localBackups().length ? `<section class="card">
        <h2>Automatic copies on this device</h2>
        <p class="card-sub">Saved just before changes from another device were merged in, in case something went missing.</p>
        <div class="backup-list">${localBackups().map((b, i) => `<div class="backup-row"><span><b>${esc(new Date(b.at).toLocaleString())}</b><small>${esc(b.data?.invoices?.length ?? 0)} invoices</small></span><button type="button" class="btn btn-ghost btn-sm" data-act="dlbackup" data-i="${i}">${icons.download}Download</button></div>`).join('')}</div>
      </section>` : ''}`;
    },
  };

  body.innerHTML = views[section]();
  root.querySelector('.settings-nav a.on')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  bindPaths(body);

  // ----- section-specific behaviour -----
  if (section === 'invoice') {
    const show = () => { body.querySelector('[data-role=nextnum]').innerHTML = `Next invoice will be <b>${esc(nextInvoiceNumber(store.data))}</b>${store.data.invoices.length ? ' (always at least one higher than your latest number).' : '.'}`; };
    body.addEventListener('settings-changed', show);
    show();
  }

  if (section === 'files') {
    const tpl = body.querySelector('[data-role=tpl]');
    const prev = () => { body.querySelector('[data-role=fnprev]').textContent = buildFileName(store.settings.invoice.fileNameTemplate, sampleInvoice(), store.settings, store.settings.invoice.fileNameSlug !== false); };
    const set = (v) => {
      tpl.value = v;
      tpl.dispatchEvent(new Event('input'));
    };
    body.addEventListener('settings-changed', prev);
    body.querySelectorAll('[data-token]').forEach((b) => b.addEventListener('click', () => {
      const t = b.dataset.token;
      const start = tpl.selectionStart ?? tpl.value.length;
      const end = tpl.selectionEnd ?? tpl.value.length;
      set(tpl.value.slice(0, start) + t + tpl.value.slice(end));
      tpl.focus();
      tpl.setSelectionRange(start + t.length, start + t.length);
    }));
    body.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => set(b.dataset.preset)));
    prev();
  }

  if (section === 'signature') {
    const current = body.querySelector('[data-role=sigcurrent]');
    const drawCurrent = () => {
      const sig = store.settings.signature;
      current.innerHTML = sig
        ? `<div class="sig-box"><img src="${esc(sig)}" alt="Your current signature"><span>${esc(store.settings.invoice.signatureLabel || 'Authorised Signatory')}</span></div><button type="button" class="btn btn-ghost btn-sm" data-act="sigremove">${icons.trash}Remove</button>`
        : '<p class="muted">No signature yet. Invoices will show an empty space above the label.</p>';
    };
    const setSig = (dataUrl) => {
      store.update((d) => { d.settings.signature = dataUrl; });
      drawCurrent();
      showSaved();
    };
    drawCurrent();

    const fileInput = body.querySelector('[data-role=file]');
    const handleFile = async (file) => {
      try {
        const url = await processUpload(file, { removeBackground: body.querySelector('[data-role=removebg]').checked });
        setSig(url);
        toast('Signature saved');
      } catch (e) {
        toast(e.message, { type: 'error' });
      }
    };
    fileInput.addEventListener('change', () => fileInput.files[0] && handleFile(fileInput.files[0]));
    const drop = body.querySelector('[data-role=drop]');
    ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', (e) => e.dataTransfer.files[0] && handleFile(e.dataTransfer.files[0]));

    body.querySelectorAll('[data-sig]').forEach((tab) => tab.addEventListener('click', () => {
      body.querySelectorAll('[data-sig]').forEach((b) => b.setAttribute('aria-selected', String(b === tab)));
      body.querySelectorAll('[data-panel]').forEach((pnl) => { pnl.hidden = pnl.dataset.panel !== tab.dataset.sig; });
      if (tab.dataset.sig === 'draw' && !pad) {
        const useBtn = body.querySelector('[data-act=paduse]');
        const hint = body.querySelector('[data-role=padhint]');
        pad = createPad(body.querySelector('[data-role=pad]'), {
          onChange: (n) => { useBtn.disabled = n === 0; hint.hidden = n > 0; },
        });
      }
    }));
    body.addEventListener('click', (e) => {
      const ink = e.target.closest('[data-ink]');
      if (ink) {
        body.querySelectorAll('[data-ink]').forEach((b) => b.setAttribute('aria-checked', String(b === ink)));
        pad?.setColor(ink.dataset.ink);
      }
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'padundo') pad?.undo();
      if (act === 'padclear') pad?.clear();
      if (act === 'paduse') {
        const url = pad?.toDataURL();
        if (!url) return;
        setSig(url);
        pad.clear();
        toast('Signature saved');
      }
      if (act === 'sigremove') {
        const old = store.settings.signature;
        setSig(null);
        toast('Signature removed', { action: { label: 'Undo', fn: () => setSig(old) } });
      }
    });
  }

  if (section === 'items') {
    const list = body.querySelector('[data-role=items]');
    const draw = () => {
      const items = store.settings.savedItems;
      list.innerHTML = items.length ? items.map((it) => `
        <div class="saved-item" data-id="${esc(it.id)}">
          <label class="field grow"><span class="field-label">Name</span><input data-f="title" value="${esc(it.title)}"></label>
          <label class="field"><span class="field-label">Usual rate</span><input data-f="rate" inputmode="decimal" value="${esc(it.rate || '')}" placeholder="0.00"></label>
          <label class="field"><span class="field-label">Currency</span><select data-f="currency"><option${it.currency === 'USD' ? ' selected' : ''}>USD</option><option${it.currency === 'EUR' ? ' selected' : ''}>EUR</option></select></label>
          <button type="button" class="icon-btn danger" data-act="delitem" aria-label="Delete ${esc(it.title)}">${icons.trash}</button>
        </div>`).join('') : '<p class="muted">No saved items yet.</p>';
    };
    const save = debounce((id, f, v) => {
      store.update((d) => {
        const it = d.settings.savedItems.find((x) => x.id === id);
        if (it) it[f] = f === 'rate' ? parseNumber(v) : v;
      });
      showSaved();
    }, 300);
    list.addEventListener('input', (e) => {
      const row = e.target.closest('[data-id]');
      if (row && e.target.dataset.f) save(row.dataset.id, e.target.dataset.f, e.target.value);
    });
    list.addEventListener('change', (e) => {
      const row = e.target.closest('[data-id]');
      if (row && e.target.tagName === 'SELECT') save(row.dataset.id, e.target.dataset.f, e.target.value);
    });
    body.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'additem') {
        store.update((d) => d.settings.savedItems.push({ id: uid('item'), title: 'New item', rate: 0, currency: d.settings.invoice.defaultCurrency }));
        draw();
        list.querySelector('.saved-item:last-child input')?.select();
      }
      if (act === 'delitem') {
        const id = e.target.closest('[data-id]').dataset.id;
        const idx = store.settings.savedItems.findIndex((x) => x.id === id);
        const removed = store.settings.savedItems[idx];
        store.update((d) => { d.settings.savedItems = d.settings.savedItems.filter((x) => x.id !== id); });
        draw();
        toast(`${removed?.title || 'Item'} deleted`, { action: { label: 'Undo', fn: () => { store.update((d) => d.settings.savedItems.splice(idx, 0, removed)); draw(); } } });
      }
    });
    draw();
  }

  let offSync = null;
  if (section === 'data') {
    offSync = store.onSync((st) => {
      const el = body.querySelector('[data-role=syncstate]');
      if (el) el.textContent = st.message;
    });
    body.addEventListener('click', async (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'syncnow') {
        await store.pushNow();
        await store.pull();
        toast(store.sync.message);
      }
      if (act === 'token') {
        const res = await modal({
          title: 'Replace access token',
          body: `<p class="modal-text">Paste a new fine-grained token for <code>${esc(store.conn.owner)}/${esc(store.conn.repo)}</code>. Unsynced changes on this device are kept.</p>${field({ label: 'New token', name: 'token', type: 'password', placeholder: 'github_pat_…', attrs: 'autocomplete="off" spellcheck="false"' })}`,
          getValue: (el) => el.querySelector('[name=token]').value.trim(),
          actions: [
            { label: 'Cancel', value: null, kind: 'ghost' },
            { label: 'Save token', kind: 'primary', submit: true, validate: (el) => (el.querySelector('[name=token]').value.trim() ? '' : 'Paste the token first.') },
          ],
        });
        if (!res) return;
        try {
          await store.updateToken(res);
          toast('Token updated');
        } catch (err) {
          toast(err.message, { type: 'error' });
        }
      }
      if (act === 'dlbackup') {
        const b = localBackups()[Number(e.target.closest('[data-i]').dataset.i)];
        if (b) downloadBlob(new Blob([JSON.stringify(b.data, null, 2)], { type: 'application/json' }), `invoices-device-copy-${b.at.slice(0, 16).replace(/[:T]/g, '-')}.json`);
      }
      if (act === 'export') {
        const blob = new Blob([JSON.stringify(store.data, null, 2)], { type: 'application/json' });
        downloadBlob(blob, `invoices-backup-${todayISO()}.json`);
      }
      if (act === 'disconnect') {
        if (store.conn?.mode === 'github' && store.dirty) {
          const ok = await confirmDialog('Some changes haven’t reached GitHub yet and will be lost on this device. Sign out anyway?', { title: 'Unsynced changes', ok: 'Sign out', danger: true });
          if (!ok) return;
        } else if (store.conn?.mode === 'github') {
          const ok = await confirmDialog('This removes your GitHub token and the cached copy from this browser. Your data stays safe on GitHub.', { title: 'Sign out on this device', ok: 'Sign out' });
          if (!ok) return;
        } else {
          // moving from browser-only to GitHub: carry the data across
          downloadBlob(new Blob([JSON.stringify(store.data, null, 2)], { type: 'application/json' }), `invoices-backup-${todayISO()}.json`);
          try { sessionStorage.setItem('edg.pendingImport', JSON.stringify(store.data)); } catch { /* ignore */ }
          toast('Backup downloaded. Your invoices will move into the repo when you connect.');
          await new Promise((r) => setTimeout(r, 800));
        }
        store.disconnect();
        location.hash = '#/';
        location.reload();
      }
    });
    body.querySelector('[data-role=import]')?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        if (!isLedgerShape(parsed) || !parsed.settings) throw new Error('This doesn’t look like a backup from this app.');
        const data = migrate(parsed);
        const ok = await confirmDialog(`Replace everything with this backup? It has ${data.clients.length} client${data.clients.length === 1 ? '' : 's'} and ${data.invoices.length} invoice${data.invoices.length === 1 ? '' : 's'}.`, { title: 'Restore backup', ok: 'Replace', danger: true });
        if (!ok) return;
        store.replaceAll(data);
        toast('Backup restored');
      } catch (err) {
        toast(`Couldn’t restore: ${err.message}`, { type: 'error' });
      }
    });
  }

  void fmtMoney; void formatNumber; void navigate;
  return () => {
    pad?.destroy();
    offSync?.();
  };
}
