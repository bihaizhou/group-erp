#!/usr/bin/env node
/**
 * Apply the production page matrix to an existing installation.
 *
 * Fresh installs get this matrix from
 * database/main/seeds/202611100001_production_page_matrix.ts. An installation
 * that already ran its seeds keeps whatever an administrator configured, so the
 * change is applied here as an explicit, reviewed data change instead of a
 * migration: migrations own schema, the authorization backend owns grants.
 *
 * Usage (dry run by default):
 *   node scripts/apply-production-page-matrix.mjs \
 *     --url http://127.0.0.1:13100 \
 *     --email admin@nocobase.com --password '…'
 *   add --apply to write the changes.
 */
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';

const MATRIX = {
  'production-manager': [
    'production-overview',
    'production-report',
    'production-schedules',
    'production-shift-reports',
    'production-downtime',
    'production-overtime',
    'production-equipment',
    'production-maintenance-plans',
    'production-setup',
  ],
  'production-lead': ['production-overview', 'production-report'],
  'production-group-viewer': [
    'production-overview',
    'production-report',
    'production-schedules',
    'production-shift-reports',
    'production-downtime',
    'production-overtime',
  ],
  'production-system-admin': [
    'production-overview',
    'production-report',
    'production-schedules',
    'production-shift-reports',
    'production-downtime',
    'production-overtime',
    'production-equipment',
    'production-maintenance-plans',
    'production-setup',
  ],
};

const MANAGED = new Set(Object.values(MATRIX).flat());

const { values } = parseArgs({
  options: {
    url: { type: 'string' },
    email: { type: 'string' },
    password: { type: 'string' },
    apply: { type: 'boolean', default: false },
  },
});

const base = (
  values.url ??
  process.env.APP_URL ??
  'http://127.0.0.1:13100'
).replace(/\/+$/, '');
const email = values.email ?? process.env.ADMIN_EMAIL;
const password = values.password ?? process.env.ADMIN_PASSWORD;

if (!email || !password) {
  console.error('Pass --email/--password (or ADMIN_EMAIL/ADMIN_PASSWORD).');
  process.exit(2);
}

async function api(path, init = {}, token) {
  const response = await fetch(`${base}/api${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      origin: base,
      ...(init.method && init.method !== 'GET'
        ? { 'idempotency-key': `${Date.now()}.${randomUUID()}` }
        : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

function pagesOf(grants) {
  return (grants ?? [])
    .filter((grant) => grant?.resource?.type === 'page')
    .map((grant) => grant.resource.id);
}

function nextGrants(grants, pages) {
  const kept = (grants ?? []).filter(
    (grant) =>
      !(grant?.resource?.type === 'page' && MANAGED.has(grant.resource.id)),
  );
  const keptIds = new Set(
    kept
      .filter((grant) => grant?.resource?.type === 'page')
      .map((grant) => grant.resource.id),
  );
  return [
    ...kept,
    ...pages
      .filter((page) => !keptIds.has(page))
      .map((page) => ({
        resource: { type: 'page', id: page },
        actions: [{ action: 'access' }],
      })),
  ];
}

const signIn = await api('/auth/sign-in/email', {
  method: 'POST',
  body: JSON.stringify({ email, password }),
});
if (signIn.status !== 200 || !signIn.body?.token) {
  console.error(
    `Sign-in failed: ${signIn.status} ${JSON.stringify(signIn.body)}`,
  );
  process.exit(1);
}
const token = signIn.body.token;

const listed = await api('/authorization/permissionSets', {}, token);
if (listed.status !== 200) {
  console.error(`Cannot list permission sets: ${listed.status}`);
  process.exit(1);
}
const sets = new Map((listed.body?.data ?? []).map((set) => [set.key, set]));

let changes = 0;
for (const [key, pages] of Object.entries(MATRIX)) {
  const set = sets.get(key);
  if (!set) {
    console.log(`${key}: not found, skipped`);
    continue;
  }
  const current = set.grants ?? [];
  const next = nextGrants(current, pages);
  if (JSON.stringify(current) === JSON.stringify(next)) {
    console.log(`${key}: already matches`);
    continue;
  }
  const before = new Set(pagesOf(current));
  const after = new Set(pagesOf(next));
  const added = [...after].filter((page) => !before.has(page));
  const removed = [...before].filter(
    (page) => MANAGED.has(page) && !after.has(page),
  );
  changes += 1;
  console.log(
    `${key}: +[${added.join(', ') || '—'}] -[${removed.join(', ') || '—'}]`,
  );
  if (!values.apply) continue;
  const patched = await api(
    `/authorization/permissionSets/${encodeURIComponent(key)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ grants: next, expectedRevision: set.revision }),
    },
    token,
  );
  if (patched.status === 409) {
    console.error(`${key}: revision conflict, reload and re-run`);
    process.exitCode = 1;
  } else if (patched.status !== 200) {
    console.error(
      `${key}: update failed ${patched.status} ${JSON.stringify(patched.body)}`,
    );
    process.exitCode = 1;
  } else {
    console.log(`${key}: applied`);
  }
}

console.log(
  values.apply
    ? `Done. ${changes} set(s) reviewed.`
    : `Dry run. ${changes} set(s) would change; re-run with --apply.`,
);
