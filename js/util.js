// Small shared helpers: escaping, dates, money, ids, slugs, number-to-words.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function uid(prefix = 'id') {
  const rnd = (crypto.getRandomValues ? crypto.getRandomValues(new Uint32Array(2)) : [Math.random() * 1e9, Date.now()]);
  return `${prefix}_${Date.now().toString(36)}${Array.from(rnd).map((n) => n.toString(36)).join('')}`.slice(0, 24);
}

export function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// ---------- dates (all stored as YYYY-MM-DD strings, local time) ----------
export function todayISO() {
  const d = new Date();
  return toISO(d);
}
export function toISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
export function parseISO(s) {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(iso, days) {
  const d = parseISO(iso);
  if (!d) return '';
  d.setDate(d.getDate() + Number(days || 0));
  return toISO(d);
}
export function daysBetween(fromISO, toISOstr) {
  const a = parseISO(fromISO);
  const b = parseISO(toISOstr);
  if (!a || !b) return null;
  return Math.round((b - a) / 86400000);
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// "Oct 20, 2026" — the style used on the original invoice
export function fmtDate(iso) {
  const d = parseISO(iso);
  if (!d) return '—';
  return `${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2, '0')}, ${d.getFullYear()}`;
}
export function fmtDateShort(iso) {
  const d = parseISO(iso);
  if (!d) return '—';
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
}

// ---------- money ----------
export const CURRENCIES = {
  USD: { symbol: '$', name: 'USD', words: ['DOLLAR', 'DOLLARS'], minor: ['CENT', 'CENTS'] },
  EUR: { symbol: '€', name: 'EUR', words: ['EURO', 'EUROS'], minor: ['CENT', 'CENTS'] },
};

export function round2(n) {
  return Math.round((Number(n) || 0) * 100 + Number.EPSILON) / 100;
}

export function fmtMoney(amount, currency = 'USD', { symbol = true } = {}) {
  const n = round2(amount);
  const str = n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (!symbol) return str;
  const c = CURRENCIES[currency] || { symbol: currency + ' ' };
  if (n < 0) return `-${c.symbol}${str.slice(1)}`;
  return `${c.symbol}${str}`;
}

// Rate shown without forced trailing zeros, like "$892.5" on the original
export function fmtRate(amount, currency = 'USD') {
  const n = round2(amount);
  const c = CURRENCIES[currency] || { symbol: currency + ' ' };
  return `${c.symbol}${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function parseNumber(value) {
  if (typeof value === 'number') return value;
  let s = String(value ?? '').trim().replace(/[\s\u00a0\u202f]/g, '').replace(/[^0-9.,-]/g, '');
  if (!s) return 0;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    // both: whichever comes last is the decimal mark
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma > -1) {
    // only commas: "1,234" / "12,345,678" are thousands; "0,865" / "892,5" / "1,23" are decimals
    s = /^-?[1-9]\d{0,2}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(/,(?=.*,)/g, '').replace(',', '.');
  } else if ((s.match(/\./g) || []).length > 1) {
    s = s.replace(/\./g, ''); // "1.234.567" = thousands
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

// ---------- number to words ----------
const ONES = ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN'];
const TENS = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY'];

function under1000(n) {
  const parts = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h) parts.push(`${ONES[h]} HUNDRED`);
  if (rest) {
    if (rest < 20) parts.push(ONES[rest]);
    else parts.push(TENS[Math.floor(rest / 10)] + (rest % 10 ? ' ' + ONES[rest % 10] : ''));
  }
  return parts.join(' ');
}

export function intToWords(n) {
  n = Math.floor(Math.abs(n));
  if (n === 0) return 'ZERO';
  const scales = [[1e9, 'BILLION'], [1e6, 'MILLION'], [1e3, 'THOUSAND']];
  const parts = [];
  for (const [value, word] of scales) {
    if (n >= value) {
      parts.push(`${under1000(Math.floor(n / value))} ${word}`);
      n %= value;
    }
  }
  if (n) parts.push(under1000(n));
  return parts.join(' ');
}

// "EIGHT HUNDRED NINETY TWO DOLLARS AND FIFTY CENTS ONLY"
export function amountToWords(amount, currency = 'USD') {
  const c = CURRENCIES[currency] || { words: [currency, currency], minor: ['CENT', 'CENTS'] };
  const total = round2(amount);
  const major = Math.floor(total);
  const minor = Math.round((total - major) * 100);
  let out = `${intToWords(major)} ${major === 1 ? c.words[0] : c.words[1]}`;
  if (minor) out += ` AND ${intToWords(minor)} ${minor === 1 ? c.minor[0] : c.minor[1]}`;
  return `${total < 0 ? 'MINUS ' : ''}${out} ONLY`;
}

// ---------- slugs & file names ----------
export function slugify(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function safeFileName(s) {
  return String(s ?? '')
    .normalize('NFC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180) || 'invoice';
}

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function base64ToUtf8(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function nl2lines(text) {
  return String(text ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}
