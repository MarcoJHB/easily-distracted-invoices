// USD <-> EUR reference rates from the European Central Bank via Frankfurter
// (free, no key). Rates publish once per working day around 16:00 CET.

const CACHE_KEY = 'edg.rates.v1';
const ENDPOINTS = [
  (date, from, to) => `https://api.frankfurter.dev/v1/${date || 'latest'}?base=${from}&symbols=${to}`,
  (date, from, to) => `https://api.frankfurter.app/${date || 'latest'}?from=${from}&to=${to}`,
];

function readCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
  } catch {
    return {};
  }
}
function writeCache(c) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(c));
  } catch { /* ignore */ }
}

// Returns { rate, date, source } where rate = how many `to` for 1 `from`.
// Pass an ISO date to get that day's rate (or the last working day before it).
export async function getRate(from, to, date) {
  if (from === to) return { rate: 1, date: date || '', source: 'same currency' };
  const today = new Date().toISOString().slice(0, 10);
  const day = date && date < today ? date : '';
  const key = `${from}-${to}-${day || 'latest:' + today}`;
  const cache = readCache();
  if (cache[key]) return cache[key];
  let lastErr;
  for (const make of ENDPOINTS) {
    try {
      const res = await fetch(make(day, from, to));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      const rate = j?.rates?.[to];
      if (!rate) throw new Error('No rate in response');
      const out = { rate: Number(rate), date: j.date, source: 'ECB via Frankfurter' };
      cache[key] = out;
      writeCache(cache);
      return out;
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`Couldn't fetch a live rate (${lastErr?.message || 'network'}). You can type one in.`);
}

// Last known USD->EUR rate, for quick display conversions when an invoice has none.
export function lastKnownUsdEur() {
  const cache = readCache();
  const entries = Object.entries(cache).filter(([k]) => k.startsWith('USD-EUR'));
  if (!entries.length) return null;
  entries.sort((a, b) => (a[1].date < b[1].date ? 1 : -1));
  return entries[0][1].rate;
}
