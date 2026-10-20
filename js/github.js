// Reads and writes one JSON file in a (private) GitHub repo through the Contents API.
// The token is a fine-grained personal access token with "Contents: read and write"
// on the data repo only. It never leaves this browser except to api.github.com.

import { utf8ToBase64, base64ToUtf8 } from './util.js';

const API = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(message, status, kind) {
    super(message);
    this.status = status;
    this.kind = kind; // 'auth' | 'notfound' | 'conflict' | 'network' | 'other'
  }
}

function headers(token, accept = 'application/vnd.github+json') {
  return {
    Accept: accept,
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function contentsUrl(cfg) {
  const path = cfg.path.split('/').map(encodeURIComponent).join('/');
  return `${API}/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${path}`;
}

async function request(url, opts) {
  let res;
  try {
    res = await fetch(url, { cache: 'no-store', ...opts });
  } catch (e) {
    throw new GitHubError('Could not reach GitHub. Check your connection.', 0, 'network');
  }
  return res;
}

async function explain(res) {
  let msg = '';
  try {
    msg = (await res.json()).message || '';
  } catch { /* ignore */ }
  if (res.status === 401) return new GitHubError('GitHub rejected the token (it may be wrong or expired).', 401, 'auth');
  if (res.status === 403) return new GitHubError(`GitHub refused access: ${msg || 'check the token has Contents read & write on this repo'}.`, 403, 'auth');
  if (res.status === 404) return new GitHubError('Repo or file not found (or the token cannot see this repo).', 404, 'notfound');
  if (res.status === 409) return new GitHubError('The file changed on GitHub since it was loaded.', res.status, 'conflict');
  return new GitHubError(`GitHub error ${res.status}: ${msg}`, res.status, 'other');
}

// Checks the token can see the repo. Returns { private: bool, fullName }.
export async function checkRepo(cfg) {
  const res = await request(`${API}/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`, {
    headers: headers(cfg.token),
  });
  if (!res.ok) throw await explain(res);
  const j = await res.json();
  return { private: !!j.private, fullName: j.full_name, defaultBranch: j.default_branch };
}

// Returns { data, sha } or null when the file does not exist yet.
export async function loadFile(cfg) {
  const url = `${contentsUrl(cfg)}?ref=${encodeURIComponent(cfg.branch)}`;
  const res = await request(url, { headers: headers(cfg.token) });
  if (res.status === 404) {
    // distinguish "no file yet" from "no repo access"
    await checkRepo(cfg);
    return null;
  }
  if (!res.ok) throw await explain(res);
  const meta = await res.json();
  let text;
  if (meta.content && meta.encoding === 'base64') {
    text = base64ToUtf8(meta.content);
  } else {
    // files over 1 MB come back without inline content
    const raw = await request(url, { headers: headers(cfg.token, 'application/vnd.github.raw+json') });
    if (!raw.ok) throw await explain(raw);
    text = await raw.text();
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new GitHubError('The data file on GitHub is not valid JSON, so nothing was changed. Fix or delete it on GitHub.', 0, 'other');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data) || ('invoices' in data && !Array.isArray(data.invoices))) {
    throw new GitHubError('The data file on GitHub doesn’t look like invoice data, so nothing was changed.', 0, 'other');
  }
  return { data, sha: meta.sha };
}

// Writes the file. Pass the sha from the last load/save (null to create).
export async function saveFile(cfg, data, sha, message) {
  const body = {
    message: message || `Update invoices ${new Date().toISOString()}`,
    content: utf8ToBase64(JSON.stringify(data, null, 2)),
    branch: cfg.branch,
  };
  if (sha) body.sha = sha;
  const res = await request(contentsUrl(cfg), {
    method: 'PUT',
    headers: { ...headers(cfg.token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await explain(res);
  const j = await res.json();
  return { sha: j.content.sha };
}
