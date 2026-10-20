// Renders an invoice as an A4 page (HTML) and exports it to PDF.
// The same markup drives the live preview, the PDF download and printing,
// so what you see is what the client gets.

import {
  esc, fmtDate, fmtMoney, fmtRate, amountToWords, nl2lines, daysBetween, slugify, safeFileName,
} from './util.js';
import { lineAmount, invoiceTotal, vatRuleFor } from './store.js';

export const LOGO_URL = 'assets/logo.png';

export function businessDisplayName(b) {
  const name = [b.name, b.legalForm].filter(Boolean).join(' ');
  if (b.tradeName && name) return `${name} (${b.tradeName})`;
  return name || b.tradeName || 'Your business name';
}

export function termsLines(inv, settings) {
  const s = settings.invoice;
  const lines = [];
  const days = daysBetween(inv.issueDate, inv.dueDate);
  if (inv.dueDate) {
    lines.push(days === 0
      ? 'Payment due on receipt.'
      : days != null && days > 0
        ? `Please pay within ${days} days from the date of invoice.`
        : `Please pay by ${fmtDate(inv.dueDate)}.`);
  }
  if (s.showLegal) {
    if (s.latePenalty) lines.push(s.latePenalty);
    const rule = vatRuleFor(inv.client);
    if (rule === 'reverse' && s.reverseChargeMention) lines.push(s.reverseChargeMention);
    else if (rule === 'franchise' && s.vatMention) lines.push(s.vatMention);
    if (s.natureOfOperation) lines.push(`Nature of transaction: ${s.natureOfOperation}.`.replace('..', '.'));
  }
  for (const l of nl2lines(s.extraTerms)) lines.push(l);
  return lines;
}

export function renderInvoice(inv, settings) {
  const b = settings.business;
  const bank = settings.bank;
  const c = inv.client || {};
  const cur = inv.currency;
  const total = invoiceTotal(inv);
  const items = inv.items || [];

  const meta = [
    ['Invoice No #', inv.number || 'Draft'],
    ['Invoice Date', fmtDate(inv.issueDate)],
  ];
  if (inv.serviceDate) meta.push(['Service Date', fmtDate(inv.serviceDate)]);
  meta.push(['Due Date', fmtDate(inv.dueDate)]);
  if (inv.reference) meta.push(['Reference', inv.reference]);

  const byLines = [
    ...nl2lines(b.addressLines).map((l, i, arr) => esc(l) + (i < arr.length - 1 ? ',' : '')),
  ];
  if (b.country && !nl2lines(b.addressLines).some((l) => l.toLowerCase().includes(b.country.toLowerCase()))) byLines.push(esc(b.country));
  if (b.email) byLines.push(`<b>Email:</b> ${esc(b.email)}`);
  if (b.phone) byLines.push(`<b>Phone:</b> ${esc(b.phone)}`);
  if (b.siret) byLines.push(`<b>SIRET:</b> ${esc(b.siret)}`);
  if (b.vatNumber) byLines.push(`<b>VAT Number:</b> ${esc(b.vatNumber)}`);

  const toLines = nl2lines(c.addressLines).map((l, i, arr) => esc(l) + (i < arr.length - 1 ? ',' : ''));
  if (c.country && !nl2lines(c.addressLines).some((l) => l.toLowerCase().includes(c.country.toLowerCase()))) toLines.push(esc(c.country));
  if (c.vatNumber) toLines.push(`<b>VAT Number:</b> ${esc(c.vatNumber)}`);
  if (c.siren) toLines.push(`<b>SIREN:</b> ${esc(c.siren)}`);

  const rows = items.map((it, i) => {
    const desc = nl2lines(it.description);
    return `
      <tr class="inv-item${desc.length ? ' has-desc' : ''}">
        <td class="inv-c-num">${i + 1}.</td>
        <td class="inv-c-item">${esc(it.title) || '<span class="inv-muted">Item</span>'}</td>
        <td class="inv-c-qty">${esc(Number(it.qty) || 0)}</td>
        <td class="inv-c-rate">${fmtRate(it.rate, cur)}</td>
        <td class="inv-c-amt">${fmtMoney(lineAmount(it), cur)}</td>
      </tr>
      ${desc.length ? `<tr class="inv-desc"><td></td><td colspan="4">${desc.map(esc).join('<br>')}</td></tr>` : ''}`;
  }).join('');

  const bankRows = [
    ['Account Name', bank.accountName],
    ['Account Number', bank.accountNumber],
    ['IBAN', bank.iban],
    ['SWIFT Code', bank.swift],
    ['Bank', bank.bank],
  ].filter(([, v]) => v);

  const terms = termsLines(inv, settings);
  const sigLabel = settings.invoice.signatureLabel || 'Authorised Signatory';

  return `
  <div class="inv-page">
    <header class="inv-head">
      <div>
        <h1 class="inv-title">Invoice</h1>
        <table class="inv-meta">
          ${meta.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}
        </table>
      </div>
      <img class="inv-logo" src="${LOGO_URL}" alt="">
    </header>

    <section class="inv-parties">
      <div class="inv-box">
        <h2>Billed By</h2>
        <p class="inv-strong">${esc(businessDisplayName(b))}</p>
        <p>${byLines.join('<br>')}</p>
      </div>
      <div class="inv-box">
        <h2>Billed To</h2>
        <p class="inv-strong">${esc(c.name) || '<span class="inv-muted">Choose a client</span>'}</p>
        <p>${toLines.join('<br>')}</p>
      </div>
    </section>

    <table class="inv-items">
      <thead>
        <tr><th class="inv-c-num"></th><th class="inv-c-item">Item</th><th class="inv-c-qty">Quantity</th><th class="inv-c-rate">Rate</th><th class="inv-c-amt">Amount</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <section class="inv-totals">
      <p class="inv-words">Total (in words) : ${esc(amountToWords(total, cur))}</p>
      <div class="inv-total"><span>Total (${esc(cur)})</span><b>${fmtMoney(total, cur)}</b></div>
    </section>

    <section class="inv-bottom">
      <div class="inv-box inv-bank">
        <h3>Bank Details</h3>
        <table>${bankRows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('') || '<tr><td class="inv-muted">Add your bank details in Settings</td></tr>'}</table>
      </div>
      <div class="inv-sign">
        ${settings.signature ? `<img src="${esc(settings.signature)}" alt="Signature">` : '<div class="inv-sign-empty"></div>'}
        <span>${esc(sigLabel)}</span>
      </div>
    </section>

    ${inv.notes ? `<section class="inv-notes"><h3>Notes</h3><p>${nl2lines(inv.notes).map(esc).join('<br>')}</p></section>` : ''}

    ${terms.length ? `<section class="inv-terms"><h3>Terms and Conditions</h3><ol>${terms.map((t) => `<li>${esc(t)}</li>`).join('')}</ol></section>` : ''}

    <footer class="inv-foot">${esc([b.tradeName, b.siret ? `SIRET ${b.siret}` : '', b.email].filter(Boolean).join(' · '))}</footer>
  </div>`;
}

// ---------- file names ----------
export const FILE_TOKENS = [
  ['{number}', 'Invoice number'],
  ['{client}', 'Client name'],
  ['{campaign}', 'Campaign'],
  ['{reference}', 'Reference'],
  ['{date}', 'Invoice date (2026-10-20)'],
  ['{year}', 'Year'],
  ['{month}', 'Month (10)'],
  ['{monthname}', 'Month name (October)'],
  ['{currency}', 'USD / EUR'],
  ['{total}', 'Total (892.50)'],
  ['{business}', 'Your name + channel'],
];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function buildFileName(template, inv, settings, slug = true) {
  const b = settings.business;
  const d = inv.issueDate || '';
  const values = {
    number: inv.number || 'draft',
    client: inv.client?.name || 'client',
    campaign: inv.campaign || '',
    reference: inv.reference || '',
    date: d,
    year: d.slice(0, 4),
    month: d.slice(5, 7),
    monthname: d ? MONTH_NAMES[Number(d.slice(5, 7)) - 1] : '',
    currency: inv.currency,
    total: invoiceTotal(inv).toFixed(2),
    business: [b.name, b.tradeName].filter(Boolean).join(' '),
  };
  const filled = String(template || '{number}').replace(/\{(\w+)\}/g, (m, key) => {
    if (!(key in values)) return '';
    const v = String(values[key]);
    return slug && key !== 'total' && key !== 'date' ? slugify(v) : v;
  });
  let name = slug
    ? filled.replace(/\s+/g, '-').replace(/-{2,}/g, '-').replace(/_{2,}/g, '_').replace(/^[-_]+|[-_]+$/g, '').toLowerCase()
    : filled.replace(/\s{2,}/g, ' ').replace(/^[\s\-_]+|[\s\-_]+$/g, '');
  name = safeFileName(name).replace(/[.\s_-]+$/, '') || 'invoice';
  return `${name}.pdf`;
}

// ---------- export ----------
function mountOffscreen(html) {
  const host = document.createElement('div');
  host.className = 'inv-offscreen';
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

async function waitForImages(root) {
  const imgs = Array.from(root.querySelectorAll('img'));
  await Promise.all(imgs.map((img) => (img.complete ? null : new Promise((r) => { img.onload = r; img.onerror = r; }))));
  if (document.fonts?.ready) await document.fonts.ready;
}

function pdfOptions(filename) {
  return {
    margin: 0,
    filename,
    image: { type: 'jpeg', quality: 0.96 },
    html2canvas: { scale: 2.5, useCORS: true, backgroundColor: '#ffffff', logging: false, scrollX: 0, scrollY: 0 },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait', compress: true },
    pagebreak: { mode: ['css'], avoid: ['tr', '.inv-box', '.inv-totals', '.inv-sign', '.inv-terms li'] },
  };
}

export async function makePdfBlob(inv, settings) {
  if (!window.html2pdf) throw new Error('PDF library failed to load.');
  const host = mountOffscreen(renderInvoice(inv, settings));
  const sx = window.scrollX, sy = window.scrollY;
  try {
    await waitForImages(host);
    window.scrollTo(0, 0);
    const page = host.querySelector('.inv-page');
    return await window.html2pdf().set(pdfOptions('x.pdf')).from(page).outputPdf('blob');
  } finally {
    host.remove();
    window.scrollTo(sx, sy);
  }
}

export async function downloadPdf(inv, settings) {
  const filename = buildFileName(settings.invoice.fileNameTemplate, inv, settings, settings.invoice.fileNameSlug !== false);
  if (!window.html2pdf) throw new Error('PDF library failed to load.');
  const host = mountOffscreen(renderInvoice(inv, settings));
  const sx = window.scrollX, sy = window.scrollY;
  try {
    await waitForImages(host);
    window.scrollTo(0, 0); // html2canvas offsets the capture by the page scroll
    await window.html2pdf().set(pdfOptions(filename)).from(host.querySelector('.inv-page')).save();
  } finally {
    host.remove();
    window.scrollTo(sx, sy);
  }
  return filename;
}

// Browser print gives crisp vector text; the suggested PDF name comes from the title.
export function printInvoice(inv, settings) {
  const filename = buildFileName(settings.invoice.fileNameTemplate, inv, settings, settings.invoice.fileNameSlug !== false).replace(/\.pdf$/, '');
  const frame = document.createElement('iframe');
  frame.className = 'inv-print-frame';
  frame.setAttribute('aria-hidden', 'true');
  document.body.appendChild(frame);
  const base = document.baseURI;
  const doc = frame.contentDocument;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><base href="${esc(base)}"><title>${esc(filename)}</title>
    <link rel="stylesheet" href="css/invoice.css">
    <style>@page{size:A4;margin:0}html,body{margin:0;background:#fff}.inv-page{box-shadow:none!important;margin:0!important}</style>
    </head><body>${renderInvoice(inv, settings)}</body></html>`);
  doc.close();
  const prevTitle = document.title;
  document.title = filename;
  let started = false;
  const go = async () => {
    if (started) return;
    started = true;
    try {
      await waitForImages(doc.body);
      if (doc.fonts?.ready) await doc.fonts.ready;
    } catch { /* ignore */ }
    frame.contentWindow.focus();
    frame.contentWindow.print();
    setTimeout(() => {
      document.title = prevTitle;
      frame.remove();
    }, 1500);
  };
  const link = doc.querySelector('link[rel=stylesheet]');
  if (link && !link.sheet) link.addEventListener('load', go);
  else setTimeout(go, 50);
  setTimeout(go, 1500); // fallback if the stylesheet event never fires
}
