// Toasts, modals, confirm dialogs and the status pill — shared UI bits.
import { esc } from './util.js';

export const icons = {
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14"/></svg>',
  print: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 9V4h10v5M7 17H5a1 1 0 0 1-1-1v-5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v5a1 1 0 0 1-1 1h-2"/><path d="M7 14h10v6H7z"/></svg>',
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/></svg>',
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>',
  bell: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>',
  mail: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18 9 12l6-6"/></svg>',
  edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/></svg>',
  more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>',
  swap: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h12m0 0-3.5-3.5M19 7l-3.5 3.5M17 17H5m0 0 3.5 3.5M5 17l3.5-3.5"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.6-4.5M4 13a8 8 0 0 0 14.6 4.5M5 3v4h4M19 21v-4h-4"/></svg>',
  invoice: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 12h7M9 16h7"/></svg>',
  users: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M3 20a6 6 0 0 1 12 0M16 4.5a3.5 3.5 0 0 1 0 7M21 20a6 6 0 0 0-4-5.6"/></svg>',
  chart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  cloud: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 18 9.5a4 4 0 0 1-.5 8.5z"/></svg>',
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  upload: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V5m0 0L7.5 9.5M12 5l4.5 4.5M5 19h14"/></svg>',
  pen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 21c3-1 5-3 7-6l7-10 2 2-10 7c-3 2-5 4-6 7z"/></svg>',
  undo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg>',
};

export const STATUS = {
  new: { label: 'New', cls: 'st-new' },
  waiting: { label: 'Waiting for payment', short: 'Waiting', cls: 'st-waiting' },
  overdue: { label: 'Overdue', cls: 'st-overdue' },
  paid: { label: 'Paid', cls: 'st-paid' },
};

export function statusPill(status, { short = false } = {}) {
  const s = STATUS[status] || STATUS.new;
  return `<span class="pill ${s.cls}"><i></i>${esc(short ? s.short || s.label : s.label)}</span>`;
}

// ---------- toasts ----------
let toastHost;
export function toast(message, { type = 'ok', action, timeout = 4200 } = {}) {
  if (!toastHost) {
    toastHost = document.createElement('div');
    toastHost.className = 'toasts';
    toastHost.setAttribute('role', 'status');
    toastHost.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastHost);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span>${esc(message)}</span>${action ? `<button type="button" class="toast-action">${esc(action.label)}</button>` : ''}`;
  toastHost.appendChild(el);
  const remove = () => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 220);
  };
  if (action) {
    el.querySelector('.toast-action').addEventListener('click', () => {
      action.fn();
      remove();
    });
  }
  setTimeout(remove, action ? Math.max(timeout, 7000) : timeout);
  return remove;
}

// ---------- modal ----------
// actions: [{ label, value, kind: 'primary'|'ghost'|'danger', submit: bool }]
// Resolves with the clicked action's value (or null on cancel / Esc).
// If an action has `validate(el)` returning a string, the modal stays open and shows it.
export function modal({ title, body = '', actions = [{ label: 'OK', value: true, kind: 'primary', submit: true }], wide = false, onMount, getValue } = {}) {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    const titleId = `modal-title-${Math.random().toString(36).slice(2, 8)}`;
    wrap.innerHTML = `
      <div class="modal${wide ? ' modal-wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
        <form class="modal-form" novalidate>
          <header class="modal-head">
            <h2 id="${titleId}">${esc(title)}</h2>
            <button type="button" class="icon-btn" data-close aria-label="Close">${icons.x}</button>
          </header>
          <div class="modal-body">${body}</div>
          <p class="modal-error" role="alert" hidden></p>
          <footer class="modal-foot">
            ${actions.map((a, i) => `<button type="${a.submit ? 'submit' : 'button'}" class="btn btn-${a.kind || 'ghost'}" data-i="${i}">${esc(a.label)}</button>`).join('')}
          </footer>
        </form>
      </div>`;
    document.body.appendChild(wrap);
    document.body.classList.add('modal-open');
    const el = wrap.querySelector('.modal');
    const form = wrap.querySelector('form');
    const err = wrap.querySelector('.modal-error');
    const cleanups = [];
    const close = (value) => {
      cleanups.forEach((fn) => fn());
      wrap.classList.add('out');
      setTimeout(() => wrap.remove(), 160);
      if (!document.querySelector('.modal-wrap:not(.out)')) document.body.classList.remove('modal-open');
      document.removeEventListener('keydown', onKey, true);
      prevFocus?.focus?.();
      resolve(value);
    };
    const run = (a) => {
      if (a.validate) {
        const problem = a.validate(el);
        if (problem) {
          err.textContent = problem;
          err.hidden = false;
          return;
        }
      }
      const v = typeof a.value === 'function' ? a.value(el) : (getValue && a.submit ? getValue(el) : a.value);
      close(v);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(null);
      }
      if (e.key === 'Tab') {
        const f = Array.from(el.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter((n) => !n.disabled && n.offsetParent !== null);
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener('keydown', onKey, true);
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(null); });
    wrap.querySelector('[data-close]').addEventListener('click', () => close(null));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const idx = actions.findIndex((a) => a.submit);
      if (idx >= 0) run(actions[idx]);
    });
    wrap.querySelectorAll('.modal-foot button').forEach((b) => {
      if (b.type === 'submit') return;
      b.addEventListener('click', () => run(actions[Number(b.dataset.i)]));
    });
    const extra = onMount?.(el, { close, cleanup: (fn) => cleanups.push(fn) });
    void extra;
    requestAnimationFrame(() => {
      const first = el.querySelector('[autofocus], .modal-body input:not([type=hidden]), .modal-body select, .modal-body textarea') || el.querySelector('.modal-foot .btn-primary');
      first?.focus();
    });
  });
}

export function confirmDialog(message, { title = 'Are you sure?', ok = 'Yes', danger = false } = {}) {
  return modal({
    title,
    body: `<p class="modal-text">${esc(message)}</p>`,
    actions: [
      { label: 'Cancel', value: false, kind: 'ghost' },
      { label: ok, value: true, kind: danger ? 'danger' : 'primary', submit: true },
    ],
  }).then((v) => v === true);
}

export function field({ label, name, value = '', type = 'text', hint = '', placeholder = '', attrs = '', full = false, options = null, rows = 3 }) {
  const id = `f_${name}_${Math.random().toString(36).slice(2, 7)}`;
  let control;
  if (options) {
    control = `<select id="${id}" name="${esc(name)}" ${attrs}>${options.map((o) => {
      const [v, l] = Array.isArray(o) ? o : [o, o];
      return `<option value="${esc(v)}"${String(v) === String(value) ? ' selected' : ''}>${esc(l)}</option>`;
    }).join('')}</select>`;
  } else if (type === 'textarea') {
    control = `<textarea id="${id}" name="${esc(name)}" rows="${rows}" placeholder="${esc(placeholder)}" ${attrs}>${esc(value)}</textarea>`;
  } else {
    control = `<input id="${id}" name="${esc(name)}" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${attrs}>`;
  }
  return `<label class="field${full ? ' full' : ''}" for="${id}"><span class="field-label">${esc(label)}</span>${control}${hint ? `<small class="field-hint">${hint}</small>` : ''}</label>`;
}

export function formValues(root) {
  const out = {};
  root.querySelectorAll('input[name], select[name], textarea[name]').forEach((el) => {
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
    else out[el.name] = el.value;
  });
  return out;
}
