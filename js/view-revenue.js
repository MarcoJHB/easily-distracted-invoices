// Revenue: month-by-month income, URSSAF contributions, limits and bank imports.
import { store } from './store.js';
import {
  esc, fmtMoney, fmtDate, todayISO, daysBetween, parseNumber, round2, uid, clone,
} from './util.js';
import { icons, modal, field, formValues, toast, confirmDialog } from './ui.js';
import {
  monthlyRows, sumRows, monthsFor, yearsWithData, monthLabel, MONTHS_SHORT, addMonths, monthOf,
  incomeItems, nextDeclaration, declarationAmounts, expectedIncome, sourceRate, normalizeRevenue,
  parseBankCsv, detectIncome, matchInvoice, projection, isMonth,
} from './revenue.js';

const PREFS_KEY = 'edg.revenue.prefs.v1';
function loadPrefs() { try { return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'); } catch { return {}; } }
function savePrefs(p) { try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* ignore */ } }

const eur = (n) => fmtMoney(n, 'EUR');
const pct = (n) => `${(Math.round(n * 10) / 10).toLocaleString('en-US')}%`;
const catLabel = (cat) => (cat === 'bnc' ? 'BNC' : 'BIC');

export function renderRevenue(root, { navigate }) {
  const prefs = loadPrefs();
  const state = {
    year: prefs.year || todayISO().slice(0, 4),
    view: prefs.view === 'earned' ? 'earned' : 'received',
  };
  const persist = () => savePrefs({ year: state.year, view: state.view });

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Revenue</h1>
        <p class="sub">AdSense and sponsor income, what to set aside for URSSAF, and what’s left.</p>
      </div>
      <div class="head-actions">
        <button class="btn btn-ghost" data-act="import">${icons.upload}<span>Import bank statement</span></button>
        <button class="btn btn-primary" data-act="add">${icons.plus}Add income</button>
      </div>
    </div>
    <div class="toolbar">
      <select data-role="year" aria-label="Year"></select>
      <div class="seg" role="group" aria-label="Count income by">
        <button data-view="received" title="The month the money reached your bank. This is what URSSAF uses.">When received</button>
        <button data-view="earned" title="The month the views or the campaign happened.">When earned</button>
      </div>
      <span class="toolbar-note" data-role="viewnote"></span>
    </div>
    <div class="stats rev-stats" data-role="stats"></div>
    <div class="rev-grid">
      <section class="card decl" data-role="decl" aria-labelledby="decl-h"></section>
      <section class="card limits" data-role="limits" aria-labelledby="limits-h"></section>
    </div>
    <section class="card chart-card" aria-labelledby="chart-h">
      <div class="card-head">
        <h2 id="chart-h">Month by month</h2>
        <div class="legend" aria-hidden="true">
          <span><i class="sw sw-adsense"></i>AdSense</span>
          <span><i class="sw sw-sponsor"></i>Sponsors</span>
          <span><i class="sw sw-est"></i>AdSense estimate</span>
        </div>
      </div>
      <div class="chart" data-role="chart"></div>
    </section>
    <section class="card table-card" aria-labelledby="table-h">
      <div class="card-head">
        <h2 id="table-h">Monthly breakdown</h2>
        <a href="#/settings/tax" class="link-btn" data-role="rates"></a>
      </div>
      <div class="rev-table-wrap"><table class="rev-table" data-role="table"></table></div>
      <p class="fineprint">Click any amount to see or edit the payments behind it. “est.” means the AdSense figure is still YouTube’s estimate.</p>
    </section>
    <section class="card insights" data-role="insights" aria-labelledby="ins-h"></section>`;

  const q = (s) => root.querySelector(s);

  // ---------- data for the current view ----------
  function compute() {
    const months = monthsFor(store.data, state.year, state.view);
    const rows = monthlyRows(store.data, { months, view: state.view });
    return { months, rows, total: sumRows(rows) };
  }

  // ---------- stats ----------
  function drawStats({ total }) {
    const exp = expectedIncome(store.data);
    const label = state.year === 'last12' ? 'last 12 months' : state.year;
    q('[data-role=stats]').innerHTML = `
      <div class="stat stat-hero">
        <span class="stat-label">Revenue · ${esc(label)}</span>
        <span class="stat-value">${eur(total.total)}</span>
        <span class="stat-note">${eur(total.adsense)} AdSense · ${eur(total.sponsor)} sponsors</span>
      </div>
      <div class="stat">
        <span class="stat-label">URSSAF contributions</span>
        <span class="stat-value">${eur(total.tax)}</span>
        <span class="stat-note">Set aside ${total.total ? pct((total.tax / total.total) * 100) : '—'} of what comes in</span>
      </div>
      <div class="stat">
        <span class="stat-label">Take-home</span>
        <span class="stat-value">${eur(total.net)}</span>
        <span class="stat-note">After contributions${total.fees ? ` and ${eur(total.fees)} bank fees` : ''}</span>
      </div>
      <a class="stat" href="#/invoices?status=open" title="Unpaid invoices plus AdSense earned but not paid out yet">
        <span class="stat-label">Still to come</span>
        <span class="stat-value">${eur(exp.total)}</span>
        <span class="stat-note">${[exp.count ? `${exp.count} unpaid invoice${exp.count === 1 ? '' : 's'}` : '', exp.adsense ? `${eur(exp.adsense)} AdSense on its way` : ''].filter(Boolean).join(' · ') || 'Nothing pending'}${exp.noRate ? ` (+${exp.noRate} without a rate)` : ''}</span>
      </a>`;
  }

  // ---------- URSSAF declaration ----------
  function drawDecl() {
    const data = store.data;
    const tax = data.settings.tax;
    const next = nextDeclaration(data);
    const info = next.info;
    const a = declarationAmounts(data, info);
    const today = todayISO();
    const days = daysBetween(today, info.due);
    const when = next.upcoming
      ? `Next one covers ${esc(info.label)}${info.sub ? ` (${esc(info.sub)})` : ''}, due ${esc(fmtDate(info.due))}`
      : days < 0 ? `<span class="warn">Was due ${esc(fmtDate(info.due))} (${-days} days ago)</span>`
        : `Due <b>${esc(fmtDate(info.due))}</b> · ${days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`}`;
    const line = (cat, amount, src) => `
      <div class="decl-row">
        <span><b>${cat === 'bic' ? 'BIC – prestations de services' : 'BNC – prestations de services'}</b><small>${esc(src)}</small></span>
        <span class="decl-amt"><output>${eur(amount).replace('.00', '')}</output><button type="button" class="icon-btn" data-copy="${amount}" aria-label="Copy ${amount}" title="Copy">${icons.copy}</button></span>
      </div>`;
    const srcFor = (cat) => [tax.adsenseCategory === cat ? 'AdSense' : '', tax.sponsorCategory === cat ? 'Sponsors' : ''].filter(Boolean).join(' + ') || 'Nothing in this category';
    q('[data-role=decl]').innerHTML = `
      <div class="card-head"><h2 id="decl-h">URSSAF declaration</h2><span class="chip-soft">${tax.period === 'monthly' ? 'Monthly' : 'Quarterly'}</span></div>
      <p class="decl-period"><b>${esc(info.label)}</b>${info.sub ? ` <span class="muted">${esc(info.sub)}</span>` : ''}</p>
      <p class="decl-due ${!next.upcoming && days <= 7 ? 'soon' : ''}">${when}</p>
      ${next.upcoming ? '<p class="muted">Nothing to declare right now.</p>' : `
        <div class="decl-rows">
          ${line('bic', a.bic, srcFor('bic'))}
          ${line('bnc', a.bnc, srcFor('bnc'))}
          <div class="decl-row decl-total"><span>Contributions to pay</span><span class="decl-amt"><b>≈ ${eur(a.contributions)}</b></span></div>
        </div>
        ${a.estimated ? '<p class="warnbox small">These AdSense figures are YouTube estimates. Before you declare, replace them with what Google actually paid (AdSense → Payments).</p>' : ''}
        <div class="btn-row">
          <button type="button" class="btn btn-soft btn-sm" data-act="declared" data-key="${esc(info.key)}">${icons.check}Mark ${esc(info.label)} as declared</button>
          <a class="link-btn" href="https://autoentrepreneur.urssaf.fr" target="_blank" rel="noopener">Open URSSAF</a>
        </div>`}
      ${next.overdue?.length ? `<p class="fineprint">Not ticked off yet: ${next.overdue.map((p) => `<button type="button" class="link-btn" data-act="declared" data-key="${esc(p.key)}">${esc(p.label)}</button>`).join(', ')}. Tick them off if you already declared them.</p>` : ''}
      <p class="fineprint">Amounts count money by the day it reached your bank, rounded to whole euros as URSSAF asks.</p>`;
  }

  // ---------- limits ----------
  function drawLimits({ rows }) {
    const tax = store.data.settings.tax;
    const year = state.year === 'last12' ? todayISO().slice(0, 4) : state.year;
    const yRows = monthlyRows(store.data, { months: Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`), view: 'received' });
    const proj = projection(yRows, year);
    const ytd = proj.ytd;
    const meter = (label, value, limit, high, note) => {
      const share = Math.min(100, (value / (high || limit)) * 100);
      const p = (value / limit) * 100;
      const level = p >= 100 ? 'bad' : p >= 80 ? 'warn' : 'ok';
      const mark = high ? (limit / high) * 100 : null;
      return `
        <div class="meter-block">
          <div class="meter-top"><span>${esc(label)}</span><span><b>${eur(value)}</b> <span class="muted">of ${eur(limit).replace('.00', '')}</span></span></div>
          <div class="meter meter-${level}" role="meter" aria-valuemin="0" aria-valuemax="${limit}" aria-valuenow="${value}" aria-label="${esc(label)}">
            <span style="width:${share}%"></span>${mark ? `<i style="left:${mark}%" title="${eur(limit)}"></i>` : ''}
          </div>
          <p class="meter-note">${note}</p>
        </div>`;
    };
    q('[data-role=limits]').innerHTML = `
      <div class="card-head"><h2 id="limits-h">Limits for ${esc(year)}</h2></div>
      ${meter('VAT exemption (franchise)', ytd, tax.vatThreshold, tax.vatThresholdHigh, `${eur(Math.max(0, tax.vatThreshold - ytd))} left before you lose the exemption from next year. Above ${eur(tax.vatThresholdHigh).replace('.00', '')}, VAT applies straight away.`)}
      ${meter('Micro-entreprise ceiling', ytd, tax.microCeiling, null, `${pct((ytd / tax.microCeiling) * 100)} used.`)}
      ${proj.avg ? `<p class="proj">At your current pace (${eur(proj.avg)} a month) you’ll end ${esc(year)} around <b>${eur(proj.year)}</b>${proj.year > tax.vatThreshold ? ' – <span class="warn">above the VAT threshold</span>' : ', comfortably under both limits'}.</p>` : ''}
      <p class="fineprint">Counted on money received in ${esc(year)} so far, as the rules do.</p>`;
    void rows;
  }

  // ---------- chart ----------
  // clean axis: step of 1/2/2.5/5 × 10^n, about 4 ticks, top tick above the tallest bar
  function niceScale(v) {
    if (v <= 0) return { max: 1000, step: 250 };
    const raw = v / 4;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= raw);
    return { max: Math.ceil((v * 1.08) / step) * step, step };
  }
  const kfmt = (n) => (n >= 1000 ? `€${(n / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })}k` : `€${n}`);

  function drawChart({ rows }) {
    const host = q('[data-role=chart]');
    const W = Math.max(300, host.clientWidth || 600);
    const H = 260;
    const m = { l: 46, r: 10, t: 26, b: 30 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    if (!rows.length || rows.every((r) => r.total === 0)) {
      host.innerHTML = `<div class="empty small"><p>No income ${state.year === 'last12' ? 'in the last 12 months' : `in ${esc(state.year)}`} yet. Add your AdSense months or import a bank statement.</p><button class="btn btn-soft btn-sm" data-act="add">${icons.plus}Add income</button></div>`;
      return;
    }
    const { max, step } = niceScale(Math.max(...rows.map((r) => r.total)));
    const y = (v) => m.t + ph - (v / max) * ph;
    const band = pw / rows.length;
    const bw = Math.min(28, band * 0.56);
    const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
    const best = rows.reduce((a, b) => (b.total > a.total ? b : a));
    const today = monthOf(todayISO());
    const roundTop = (x, top, w, h, r) => {
      r = Math.min(r, h, w / 2);
      return `M${x},${top + h}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${top + h}Z`;
    };
    let bars = '';
    rows.forEach((r, i) => {
      const cx = m.l + band * i + band / 2;
      const x = cx - bw / 2;
      const gap = r.adsense > 0 && r.sponsor > 0 ? 2 : 0;
      const hA = (r.adsense / max) * ph;
      const hS = (r.sponsor / max) * ph;
      const base = m.t + ph;
      const aTop = base - hA;
      const sTop = aTop - gap - hS;
      const aIsTop = r.sponsor <= 0;
      const est = r.estimated;
      if (hA > 0) {
        const d = aIsTop ? roundTop(x, aTop, bw, hA, 4) : `M${x},${aTop}h${bw}v${hA}h${-bw}Z`;
        bars += `<path d="${d}" class="bar-adsense${est ? ' est' : ''}"/>`;
        if (est) bars += `<path d="${d}" fill="url(#hatch)"/>`;
      }
      if (hS > 0) bars += `<path d="${roundTop(x, sTop, bw, hS, 4)}" class="bar-sponsor"/>`;
      // labels
      const lab = MONTHS_SHORT[Number(r.month.slice(5, 7)) - 1] + (rows.length > 12 || r.month.slice(5, 7) === '01' || i === 0 ? ` ${r.month.slice(2, 4)}` : '');
      bars += `<text x="${cx}" y="${H - 10}" class="ax-x${r.month === today ? ' now' : ''}" text-anchor="middle">${esc(lab)}</text>`;
      if (r === best && r.total > 0) bars += `<text x="${cx}" y="${y(r.total) - 7}" class="bar-val" text-anchor="middle">${esc(kfmt(Math.round(r.total)))}</text>`;
      bars += `<rect x="${m.l + band * i}" y="${m.t}" width="${band}" height="${ph}" class="hit" data-i="${i}" tabindex="0" aria-label="${esc(monthLabel(r.month))}: ${eur(r.total)}"/>`;
    });
    host.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Stacked columns of monthly revenue, AdSense and sponsors">
        <defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" class="hatch-line"/></pattern></defs>
        ${ticks.map((t) => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}" class="grid"/><text x="${m.l - 8}" y="${y(t) + 4}" class="ax-y" text-anchor="end">${esc(kfmt(t))}</text>`).join('')}
        <g class="hl" data-role="hl"></g>
        ${bars}
      </svg>
      <div class="tip" data-role="tip" hidden></div>`;
    const svg = host.querySelector('svg');
    const tip = host.querySelector('[data-role=tip]');
    const hl = host.querySelector('[data-role=hl]');
    const show = (i) => {
      const r = rows[i];
      hl.innerHTML = `<rect x="${m.l + band * i}" y="${m.t}" width="${band}" height="${ph}" class="band"/>`;
      tip.innerHTML = `<b>${esc(monthLabel(r.month))}</b>
        <span><i class="sw sw-adsense"></i>AdSense<em>${eur(r.adsense)}${r.estimated ? ' est.' : ''}</em></span>
        <span><i class="sw sw-sponsor"></i>Sponsors<em>${eur(r.sponsor)}</em></span>
        <span class="tip-total">Total<em>${eur(r.total)}</em></span>
        <span class="tip-muted">Contributions<em>${eur(r.tax)}</em></span>`;
      tip.hidden = false;
      const cx = (m.l + band * i + band / 2) * (svg.clientWidth / W);
      const tw = tip.offsetWidth;
      tip.style.left = `${Math.max(0, Math.min(host.clientWidth - tw, cx - tw / 2))}px`;
      tip.style.top = `${Math.max(0, y(r.total) * (svg.clientHeight / H) - tip.offsetHeight - 10)}px`;
    };
    const hide = () => { tip.hidden = true; hl.innerHTML = ''; };
    host.querySelectorAll('.hit').forEach((h) => {
      h.addEventListener('mouseenter', () => show(Number(h.dataset.i)));
      h.addEventListener('focus', () => show(Number(h.dataset.i)));
      h.addEventListener('blur', hide);
      h.addEventListener('click', () => show(Number(h.dataset.i)));
    });
    svg.addEventListener('mouseleave', hide);
  }

  // ---------- table ----------
  function drawTable({ rows, total }) {
    const tax = store.data.settings.tax;
    const today = monthOf(todayISO());
    q('[data-role=rates]').textContent = `AdSense ${catLabel(tax.adsenseCategory)} ${pct(sourceRate(tax, 'adsense'))} · Sponsors ${catLabel(tax.sponsorCategory)} ${pct(sourceRate(tax, 'sponsor'))} · change`;
    const cell = (r, type, val, est) => `<td class="num"><button type="button" class="cell-btn" data-month="${r.month}" data-type="${type}" aria-label="${type === 'adsense' ? 'AdSense' : 'Sponsors'} in ${esc(monthLabel(r.month))}: ${eur(val)}">${val ? eur(val) : '<span class="muted">—</span>'}${est ? '<sup>est.</sup>' : ''}</button></td>`;
    const money = (v, cls = '') => `<td class="num ${cls}">${v ? eur(v) : '<span class="muted">—</span>'}</td>`;
    q('[data-role=table]').innerHTML = `
      <thead><tr>
        <th scope="col">Month</th>
        <th scope="col" class="num"><i class="sw sw-adsense"></i>AdSense</th>
        <th scope="col" class="num"><i class="sw sw-sponsor"></i>Sponsors</th>
        <th scope="col" class="num">Total</th>
        <th scope="col" class="num">${catLabel(tax.adsenseCategory)} tax (AdSense)</th>
        <th scope="col" class="num">${catLabel(tax.sponsorCategory)} tax (Sponsors)</th>
        <th scope="col" class="num">Tax total</th>
        <th scope="col" class="num col-extra">Bank fees</th>
        <th scope="col" class="num col-extra">Take-home</th>
      </tr></thead>
      <tbody>${rows.slice().reverse().map((r) => `
        <tr class="${r.month === today ? 'now' : ''}">
          <th scope="row">${esc(monthLabel(r.month))}${r.month === today ? '<span class="tag">in progress</span>' : r.month > today ? '<span class="tag">expected</span>' : ''}</th>
          ${cell(r, 'adsense', r.adsense, r.estimated && r.adsense > 0)}
          ${cell(r, 'sponsor', r.sponsor, false)}
          <td class="num strong">${r.total ? eur(r.total) : '<span class="muted">—</span>'}</td>
          ${money(r.adsenseTax)}
          ${money(r.sponsorTax)}
          ${money(r.tax, 'strong')}
          ${money(r.fees, 'col-extra')}
          ${money(r.net, 'col-extra strong')}
        </tr>`).join('')}</tbody>
      <tfoot><tr>
        <th scope="row">Total</th>
        <td class="num">${eur(total.adsense)}</td>
        <td class="num">${eur(total.sponsor)}</td>
        <td class="num">${eur(total.total)}</td>
        <td class="num">${eur(total.adsenseTax)}</td>
        <td class="num">${eur(total.sponsorTax)}</td>
        <td class="num">${eur(total.tax)}</td>
        <td class="num col-extra">${eur(total.fees)}</td>
        <td class="num col-extra">${eur(total.net)}</td>
      </tr></tfoot>`;
  }

  // ---------- insights ----------
  function drawInsights({ rows, total }) {
    const items = incomeItems(store.data).filter((it) => rows.some((r) => r.month === (state.view === 'earned' ? it.earned : it.received)));
    const sponsorPays = items.filter((it) => it.type === 'sponsor');
    const withFees = sponsorPays.filter((it) => it.fees > 0);
    const feeTotal = round2(withFees.reduce((s, it) => s + it.fees, 0));
    const worst = withFees.reduce((a, b) => (!a || b.fees / b.amount > a.fees / a.amount ? b : a), null);
    const now = monthOf(todayISO());
    const active = rows.filter((r) => r.total > 0 && r.month < now); // finished months only
    const best = active.reduce((a, b) => (!a || b.total > a.total ? b : a), null);
    const avg = active.length ? active.reduce((s, r) => s + r.total, 0) / active.length : 0;
    const shareA = total.total ? (total.adsense / total.total) * 100 : 0;
    const facts = [];
    if (feeTotal > 0) {
      facts.push(`<li class="fact-warn"><b>${eur(feeTotal)} lost to bank fees</b> on ${withFees.length} sponsor payment${withFees.length === 1 ? '' : 's'}, ${pct((feeTotal / (total.sponsor || 1)) * 100)} of sponsor income.${worst ? ` The worst: ${eur(worst.fees)} taken from a ${eur(worst.amount)} payment.` : ''} The fees are a flat ~€33 per transfer, so a few larger payments cost far less than many small ones.</li>`);
    }
    if (best) facts.push(`<li><b>Best month:</b> ${esc(monthLabel(best.month))} with ${eur(best.total)}.</li>`);
    const avgNet = active.length ? active.reduce((s, r) => s + r.net, 0) / active.length : 0;
    if (active.length > 1) facts.push(`<li><b>Average finished month:</b> ${eur(avg)} in, ${eur(avgNet)} take-home after contributions and fees.</li>`);
    if (total.total) facts.push(`<li><b>Mix:</b> ${pct(shareA)} AdSense, ${pct(100 - shareA)} sponsors.</li>`);
    if (store.data.settings.tax.versementLiberatoire === false && total.total) {
      const t = store.data.settings.tax;
      const base = round2(total.adsense * (t.adsenseCategory === 'bnc' ? 0.66 : 0.5) + total.sponsor * (t.sponsorCategory === 'bnc' ? 0.66 : 0.5));
      facts.push(`<li><b>Income tax:</b> not included above. On your yearly return (2042-C-PRO) this income adds about ${eur(base)} to your taxable income after the micro allowances (34% BNC, 50% BIC).</li>`);
    }
    q('[data-role=insights]').innerHTML = `
      <div class="card-head"><h2 id="ins-h">Good to know</h2></div>
      ${facts.length ? `<ul class="facts">${facts.join('')}</ul>` : '<p class="muted">Add some income to see insights here.</p>'}`;
  }

  function draw() {
    const years = yearsWithData(store.data);
    if (state.year !== 'last12' && !years.includes(state.year)) state.year = years[0];
    const sel = q('[data-role=year]');
    sel.innerHTML = `${years.map((y) => `<option value="${y}">${y}</option>`).join('')}<option value="last12">Last 12 months</option>`;
    sel.value = state.year;
    root.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === state.view)));
    q('[data-role=viewnote]').textContent = state.view === 'received'
      ? 'Counted on the day the money arrived, as URSSAF does. AdSense usually lands the month after.'
      : 'Counted in the month the views or campaign happened.';
    const c = compute();
    drawStats(c);
    drawDecl();
    drawLimits(c);
    drawChart(c);
    drawTable(c);
    drawInsights(c);
    lastC = c;
  }
  let lastC = null;

  // ---------- events ----------
  q('[data-role=year]').addEventListener('change', (e) => { state.year = e.target.value; persist(); draw(); });
  root.addEventListener('click', async (e) => {
    const v = e.target.closest('[data-view]');
    if (v) { state.view = v.dataset.view; persist(); draw(); return; }
    const cellBtn = e.target.closest('.cell-btn');
    if (cellBtn) { monthDetail(cellBtn.dataset.month, cellBtn.dataset.type, state.view, navigate); return; }
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      try { await navigator.clipboard.writeText(copy.dataset.copy); toast(`Copied ${copy.dataset.copy}`); } catch { toast('Couldn’t copy – select the number instead', { type: 'error' }); }
      return;
    }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    switch (btn.dataset.act) {
      case 'add': editEntry(null); break;
      case 'import': importDialog(); break;
      case 'declared': {
        const key = btn.dataset.key;
        store.update((d) => { if (!d.settings.tax.declared.includes(key)) d.settings.tax.declared.push(key); });
        toast(`${key.replace('-', ' ')} marked as declared`, { action: { label: 'Undo', fn: () => store.update((d) => { d.settings.tax.declared = d.settings.tax.declared.filter((k) => k !== key); }) } });
        break;
      }
      default:
    }
  });

  const ro = new ResizeObserver(() => { if (lastC) drawChart(lastC); });
  ro.observe(q('[data-role=chart]'));
  const off = store.on(() => draw());
  draw();
  return () => { off(); ro.disconnect(); };
}

// ---------- add / edit an entry ----------
export async function editEntry(existing, preset = {}) {
  const e = existing ? clone(existing) : normalizeRevenue({ type: preset.type || 'adsense', earnedMonth: preset.earnedMonth || addMonths(monthOf(todayISO()), -1), receivedDate: preset.receivedDate || '', estimated: true });
  if (!existing && preset.type === 'sponsor') { e.receivedDate = preset.receivedDate || todayISO(); e.earnedMonth = monthOf(e.receivedDate); }
  const clients = store.data.clients.map((c) => c.name);
  const body = `
    <div class="seg type-seg" role="radiogroup" aria-label="Type of income">
      <button type="button" role="radio" data-type="adsense" aria-checked="${e.type === 'adsense'}">YouTube AdSense</button>
      <button type="button" role="radio" data-type="sponsor" aria-checked="${e.type === 'sponsor'}">Sponsor payment</button>
    </div>
    <div class="grid2" data-for="adsense">
      ${field({ label: 'Month earned', name: 'earnedMonth', type: 'month', value: e.earnedMonth, hint: 'The month of the views, as in YouTube Studio.' })}
      ${field({ label: 'Amount (EUR)', name: 'amountA', value: e.type === 'adsense' && e.amount ? e.amount : '', placeholder: '1,625.88', attrs: 'inputmode="decimal"' })}
      <label class="check full"><input type="checkbox" name="final" ${e.type === 'adsense' && !e.estimated ? 'checked' : ''}> This is the final amount Google paid (not YouTube’s estimate)</label>
      ${field({ label: 'Date it reached your bank (optional)', name: 'receivedA', type: 'date', value: e.type === 'adsense' ? e.receivedDate : '', hint: 'Leave empty and it counts the month after it was earned. AdSense pays around the 21st.' })}
    </div>
    <div class="grid2" data-for="sponsor">
      ${field({ label: 'Date received', name: 'receivedS', type: 'date', value: e.type === 'sponsor' ? e.receivedDate : todayISO() })}
      ${field({ label: 'Amount received (EUR)', name: 'amountS', value: e.type === 'sponsor' && e.amount ? e.amount : '', placeholder: '596.81', attrs: 'inputmode="decimal"', hint: 'What landed in your account, before fees.' })}
      ${field({ label: 'From', name: 'payer', value: e.payer, placeholder: 'Puka BV', attrs: 'list="payer-list"' })}
      ${field({ label: 'Bank fees (EUR)', name: 'fees', value: e.fees || '', placeholder: '33.10', attrs: 'inputmode="decimal"' })}
      ${field({ label: 'Campaign month (optional)', name: 'campaignMonth', type: 'month', value: e.type === 'sponsor' && e.earnedMonth !== monthOf(e.receivedDate) ? e.earnedMonth : '' })}
      ${field({ label: 'Note', name: 'note', value: e.note, placeholder: 'Invoice A00018' })}
    </div>
    <datalist id="payer-list">${clients.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
    <p class="fineprint">Paid invoices count automatically. Use this for money that has no invoice in the app.</p>`;
  let type = e.type;
  const actions = [
    ...(existing ? [{ label: 'Delete', value: 'delete', kind: 'danger' }] : []),
    { label: 'Cancel', value: null, kind: 'ghost' },
    {
      label: existing ? 'Save' : 'Add',
      kind: 'primary',
      submit: true,
      validate: (el) => {
        const v = formValues(el);
        if (type === 'adsense') {
          if (!isMonth(v.earnedMonth)) return 'Pick the month the AdSense was earned.';
          if (parseNumber(v.amountA) <= 0) return 'Enter the AdSense amount in euros.';
        } else {
          if (!v.receivedS) return 'When did the money arrive?';
          if (parseNumber(v.amountS) <= 0) return 'Enter the amount received in euros.';
        }
        return '';
      },
    },
  ];
  const res = await modal({
    title: existing ? 'Edit income' : 'Add income',
    body,
    wide: true,
    actions,
    getValue: (el) => ({ ...formValues(el), type }),
    onMount: (el) => {
      const sync = () => {
        el.querySelectorAll('[data-for]').forEach((g) => { g.hidden = g.dataset.for !== type; });
        el.querySelectorAll('[data-type]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.type === type)));
      };
      el.querySelectorAll('[data-type]').forEach((b) => b.addEventListener('click', () => { type = b.dataset.type; sync(); }));
      sync();
    },
  });
  if (!res) return;
  if (res === 'delete') {
    const backup = clone(existing);
    store.update((d) => { d.revenue = d.revenue.filter((x) => x.id !== existing.id); });
    toast('Income deleted', { action: { label: 'Undo', fn: () => store.update((d) => d.revenue.push(backup)) } });
    return;
  }
  const rec = res.type === 'adsense'
    ? normalizeRevenue({
      ...e, type: 'adsense', earnedMonth: res.earnedMonth, amount: parseNumber(res.amountA), estimated: !res.final,
      receivedDate: res.receivedA, payer: 'YouTube AdSense', fees: 0, updatedAt: new Date().toISOString(),
    })
    : normalizeRevenue({
      ...e, type: 'sponsor', receivedDate: res.receivedS, earnedMonth: res.campaignMonth || monthOf(res.receivedS),
      amount: parseNumber(res.amountS), fees: parseNumber(res.fees), payer: res.payer.trim(), note: res.note.trim(), estimated: false,
      updatedAt: new Date().toISOString(),
    });
  // one AdSense entry per earned month: replace rather than duplicate
  const dupe = rec.type === 'adsense' && store.data.revenue.find((x) => x.type === 'adsense' && x.earnedMonth === rec.earnedMonth && x.id !== rec.id);
  if (dupe) {
    const ok = await confirmDialog(`You already have ${eur(dupe.amount)} of AdSense for ${monthLabel(rec.earnedMonth)}. Replace it with ${eur(rec.amount)}?`, { title: 'Replace AdSense month', ok: 'Replace' });
    if (!ok) return;
  }
  store.update((d) => {
    if (dupe) d.revenue = d.revenue.filter((x) => x.id !== dupe.id);
    const i = d.revenue.findIndex((x) => x.id === rec.id);
    if (i >= 0) d.revenue[i] = rec; else d.revenue.push(rec);
  });
  toast(existing || dupe ? 'Income updated' : `Added ${eur(rec.amount)} ${rec.type === 'adsense' ? `AdSense for ${monthLabel(rec.earnedMonth)}` : 'sponsor payment'}`);
}

// ---------- what's behind a cell ----------
async function monthDetail(month, type, view, navigate) {
  const items = incomeItems(store.data).filter((it) => it.type === type && (view === 'earned' ? it.earned : it.received) === month);
  const name = type === 'adsense' ? 'AdSense' : 'Sponsor payments';
  const list = items.length ? `<ul class="pay-list">${items.map((it) => `
    <li>
      <span class="pay-main"><b>${eur(it.amount)}</b>${it.estimated ? ' <span class="tag">estimate</span>' : ''}<small>${esc(it.label)}${it.receivedDate ? ` · received ${esc(fmtDate(it.receivedDate))}` : type === 'adsense' ? ` · earned ${esc(monthLabel(it.earned))}, expected ${esc(monthLabel(it.received))}` : ''}${it.fees ? ` · ${eur(it.fees)} fees` : ''}</small></span>
      <button type="button" class="btn btn-ghost btn-sm" data-open="${esc(it.kind)}:${esc(it.id)}">${it.kind === 'invoice' ? 'Open invoice' : 'Edit'}</button>
    </li>`).join('')}</ul>` : `<p class="modal-text">Nothing counted here yet.</p>`;
  const presetMonth = type === 'adsense' ? (view === 'received' ? addMonths(month, -1) : month) : month;
  const res = await modal({
    title: `${name} · ${monthLabel(month)}`,
    body: `${list}${view === 'received' && type === 'adsense' ? '<p class="fineprint">You’re counting by date received, so this shows AdSense earned the month before unless a received date says otherwise.</p>' : ''}`,
    actions: [
      { label: 'Close', value: null, kind: 'ghost' },
      { label: type === 'adsense' ? `Add AdSense for ${monthLabel(presetMonth, true)}` : 'Add sponsor payment', value: 'add', kind: 'primary', submit: true },
    ],
    onMount: (el, { close }) => {
      el.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => close(b.dataset.open)));
    },
  });
  if (!res) return;
  if (res === 'add') {
    editEntry(null, type === 'adsense' ? { type, earnedMonth: presetMonth } : { type, receivedDate: month === monthOf(todayISO()) ? todayISO() : `${month}-15` });
    return;
  }
  const [kind, id] = res.split(':');
  if (kind === 'invoice') navigate(`#/invoices/${id}`);
  else editEntry(store.data.revenue.find((x) => x.id === id));
}

// ---------- import ----------
function isImported(ref) {
  return store.data.revenue.some((x) => x.bankRef === ref) || store.data.invoices.some((i) => i.bankRef === ref);
}
// Same money already recorded another way (another CSV format, typed in by hand, a paid invoice)?
function sameMoney({ receivedDate, date, amount }) {
  const d = receivedDate || date;
  if (!d) return false;
  const near = (a) => Math.abs(a - amount) < 0.01;
  return store.data.revenue.some((x) => x.receivedDate === d && near(x.amount))
    || store.data.invoices.some((i) => i.status === 'paid' && i.paidDate === d && near(Number(i.paidAmountEur) || 0));
}
const alreadyIn = (f) => isImported(f.ref) || sameMoney(f);

async function importDialog() {
  let found = null; // detected rows
  let jsonEntries = null;
  let period = null;
  const render = (el) => {
    const out = el.querySelector('[data-role=result]');
    if (jsonEntries) {
      const fresh = jsonEntries.filter((x) => !store.data.revenue.some((r) => r.id === x.id) && !(x.bankRef && isImported(x.bankRef)) && !sameMoney(x));
      out.innerHTML = `<p class="modal-text">This file has <b>${jsonEntries.length}</b> income entries${fresh.length < jsonEntries.length ? `, ${jsonEntries.length - fresh.length} already in the app` : ''}.</p>
        <ul class="pay-list">${fresh.map((x) => `<li><span class="pay-main"><b>${eur(x.amount)}</b><small>${x.type === 'adsense' ? `AdSense earned ${esc(monthLabel(x.earnedMonth))}${x.estimated ? ' (estimate)' : ''}` : `${esc(x.payer || 'Sponsor')} · ${esc(fmtDate(x.receivedDate))}${x.fees ? ` · ${eur(x.fees)} fees` : ''}`}</small></span></li>`).join('')}</ul>`;
      return;
    }
    if (!found) { out.innerHTML = ''; return; }
    const biz = found.filter((f) => f.kind !== 'skip' || f.include);
    const other = found.filter((f) => f.kind === 'skip' && !f.include);
    const unpaid = store.data.invoices.filter((i) => i.status !== 'paid');
    const row = (f, i) => {
      const done = alreadyIn(f);
      return `<tr class="${done ? 'done' : ''}">
        <td>${esc(fmtDate(f.date))}</td>
        <td class="num"><b>${eur(f.amount)}</b>${f.fees ? `<small>−${eur(f.fees)} fees</small>` : ''}</td>
        <td><span class="imp-label">${esc(f.payer || f.label)}</span><small>${esc(f.info || f.reason)}</small></td>
        <td>${done ? '<span class="tag">Already imported</span>' : `<select data-i="${i}" data-f="kind" aria-label="Type">
            <option value="sponsor"${f.kind === 'sponsor' ? ' selected' : ''}>Sponsor</option>
            <option value="adsense"${f.kind === 'adsense' ? ' selected' : ''}>AdSense</option>
            <option value="skip"${f.kind === 'skip' ? ' selected' : ''}>Skip (personal)</option></select>`}</td>
        <td>${done || f.kind !== 'sponsor' ? '' : `<select data-i="${i}" data-f="invoice" aria-label="Pays invoice">
            <option value="">No invoice in the app</option>
            ${unpaid.map((inv) => `<option value="${esc(inv.id)}"${f.invoiceId === inv.id ? ' selected' : ''}>Pays ${esc(inv.number)} (${esc(inv.client?.name || '')})</option>`).join('')}</select>`}</td>
      </tr>`;
    };
    const todo = biz.filter((f) => !alreadyIn(f) && f.kind !== 'skip');
    out.innerHTML = `
      <p class="modal-text">${period ? `Statement from ${esc(fmtDate(period[0]))} to ${esc(fmtDate(period[1]))}. ` : ''}${biz.length ? `Found <b>${biz.length}</b> business payment${biz.length === 1 ? '' : 's'}${todo.length ? `, <b>${todo.length}</b> new` : ', all already in the app'}.` : 'No sponsor or AdSense payments found. If one is listed under the skipped credits, mark it as business income.'} Bank fees linked to each transfer are picked up too.</p>
      ${biz.length ? `<div class="imp-wrap"><table class="imp-table"><thead><tr><th>Date</th><th class="num">Amount</th><th>From</th><th>Type</th><th>Invoice</th></tr></thead><tbody>${biz.map((f) => row(f, found.indexOf(f))).join('')}</tbody></table></div>` : ''}
      ${other.length ? `<details class="imp-other"><summary>${other.length} other credit${other.length === 1 ? '' : 's'} skipped as personal (transfers, refunds, sales…)</summary>
        <table class="imp-table"><tbody>${other.map((f) => `<tr><td>${esc(fmtDate(f.date))}</td><td class="num">${eur(f.amount)}</td><td><span class="imp-label">${esc(f.label)}</span><small>${esc(f.info || f.reason)}</small></td><td><button type="button" class="link-btn" data-include="${found.indexOf(f)}">It’s business income</button></td></tr>`).join('')}</tbody></table></details>` : ''}`;
    el.querySelector('[data-role=go]').textContent = todo.length ? `Import ${todo.length} payment${todo.length === 1 ? '' : 's'}` : 'Nothing new to import';
  };
  const res = await modal({
    title: 'Import bank statement',
    wide: true,
    body: `
      <p class="modal-text">Export your statement as <b>CSV</b> from your bank’s website and drop it here. Nothing leaves your browser except what you choose to import.</p>
      <label class="dropzone small" data-role="drop">
        <input type="file" accept=".csv,text/csv,.json,application/json" class="sr-only" data-role="file">
        ${icons.upload}<b>Choose a CSV file</b><span>or drop it here · also accepts a revenue .json file</span>
      </label>
      <div data-role="result"></div>`,
    actions: [
      { label: 'Cancel', value: null, kind: 'ghost' },
      { label: 'Import', value: 'go', kind: 'primary', submit: true, validate: () => (!found && !jsonEntries ? 'Choose a file first.' : '') },
    ],
    onMount: (el) => {
      el.querySelector('.modal-foot .btn-primary').dataset.role = 'go';
      const handle = async (file) => {
        if (!file) return;
        try {
          const text = await file.text();
          if (/\.json$/i.test(file.name) || text.trim().startsWith('{')) {
            let j;
            try { j = JSON.parse(text); } catch { throw new Error('That JSON file is damaged and can’t be read.'); }
            const list = Array.isArray(j) ? j : j.revenue;
            if (!Array.isArray(list)) throw new Error('This JSON has no revenue entries.');
            jsonEntries = list.filter((x) => x && typeof x === 'object').map(normalizeRevenue);
            found = null;
          } else {
            const parsed = parseBankCsv(text);
            period = parsed.period;
            found = detectIncome(parsed, store.data).map((f) => {
              const m = f.kind === 'sponsor' ? matchInvoice(f, store.data) : null;
              return { ...f, invoiceId: m?.invoice.id || '' };
            });
            jsonEntries = null;
          }
          el.querySelector('.modal-error').hidden = true;
          el.querySelector('[data-role=drop]').classList.add('loaded');
          el.querySelector('[data-role=drop] b').textContent = file.name;
          render(el);
        } catch (err) {
          const box = el.querySelector('.modal-error');
          box.textContent = err.message;
          box.hidden = false;
        }
      };
      const input = el.querySelector('[data-role=file]');
      input.addEventListener('change', () => handle(input.files[0]));
      const drop = el.querySelector('[data-role=drop]');
      ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (ev) => { ev.preventDefault(); drop.classList.add('over'); }));
      ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (ev) => { ev.preventDefault(); drop.classList.remove('over'); }));
      drop.addEventListener('drop', (ev) => handle(ev.dataTransfer.files[0]));
      el.addEventListener('change', (ev) => {
        const s = ev.target.closest('select[data-i]');
        if (!s) return;
        const f = found[Number(s.dataset.i)];
        if (s.dataset.f === 'kind') { f.kind = s.value; f.include = s.value !== 'skip'; } else f.invoiceId = s.value;
        render(el);
      });
      el.addEventListener('click', (ev) => {
        const inc = ev.target.closest('[data-include]');
        if (!inc) return;
        const f = found[Number(inc.dataset.include)];
        f.kind = 'sponsor';
        f.include = true;
        render(el);
      });
    },
  });
  if (res !== 'go') return;
  if (jsonEntries) {
    const fresh = jsonEntries.filter((x) => !store.data.revenue.some((r) => r.id === x.id) && !(x.bankRef && isImported(x.bankRef)) && !sameMoney(x));
    store.update((d) => { d.revenue.push(...fresh); });
    toast(`Imported ${fresh.length} income entr${fresh.length === 1 ? 'y' : 'ies'}`);
    return;
  }
  const todo = found.filter((f) => f.kind !== 'skip' && !alreadyIn(f));
  let invoicesPaid = 0, added = 0, replaced = 0;
  store.update((d) => {
    for (const f of todo) {
      if (f.kind === 'sponsor' && f.invoiceId) {
        const inv = d.invoices.find((i) => i.id === f.invoiceId);
        if (inv) {
          Object.assign(inv, { status: 'paid', paidDate: f.date, paidAmountEur: f.amount, paidFees: f.fees, bankRef: f.ref, updatedAt: new Date().toISOString() });
          invoicesPaid++;
          continue;
        }
      }
      if (f.kind === 'adsense') {
        const earned = addMonths(monthOf(f.date), -1);
        const est = d.revenue.find((x) => x.type === 'adsense' && x.earnedMonth === earned && !x.bankRef);
        if (est) {
          Object.assign(est, { amount: f.amount, receivedDate: f.date, estimated: false, bankRef: f.ref, source: 'bank', updatedAt: new Date().toISOString() });
          replaced++;
          continue;
        }
      }
      d.revenue.push(normalizeRevenue({
        id: uid('rev'), type: f.kind, receivedDate: f.date,
        earnedMonth: f.kind === 'adsense' ? addMonths(monthOf(f.date), -1) : monthOf(f.date),
        amount: f.amount, fees: f.fees, estimated: false, payer: f.payer || f.label, note: f.info, source: 'bank', bankRef: f.ref,
      }));
      added++;
    }
  });
  const parts = [];
  if (added) parts.push(`${added} payment${added === 1 ? '' : 's'} added`);
  if (invoicesPaid) parts.push(`${invoicesPaid} invoice${invoicesPaid === 1 ? '' : 's'} marked paid`);
  if (replaced) parts.push(`${replaced} AdSense estimate${replaced === 1 ? '' : 's'} replaced with the real amount`);
  toast(parts.join(' · ') || 'Nothing new to import', { timeout: 7000 });
}
