// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { expect, test } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';
import { createStandaloneServer } from '../../server/standalone.js';
import { PAGE_ID_SET } from '../../database/main/permissions/page-catalog.js';

const test = createAppTest({
  createServer: createStandaloneServer,
  config: {
    app: { publicOrigin: 'http://localhost' },
    secrets: { keys: [{ version: 1, key: randomBytes(32).toString('hex') }] },
    jobs: { default: 'memory' },
    queue: { default: 'memory' },
    logging: { console: { enabled: false }, file: { enabled: false } },
  },
});

type Grant = {
  resource?: { type?: unknown; id?: unknown };
};

/** The database JSON codec may hand back the serialized seed value as a string. */
function parseGrants(value: unknown): Grant[] {
  let grants = value;
  while (typeof grants === 'string') grants = JSON.parse(grants) as unknown;
  return Array.isArray(grants) ? (grants as Grant[]) : [];
}

test('every seeded permission set only grants pages the client serves', async ({
  connection,
}) => {
  const sets = await connection.query
    .selectFrom('authorizationPermissionSets')
    .select(['key', 'grants'])
    .execute();
  expect(sets.length).toBeGreaterThan(0);
  const unknown: { key: string; page: string }[] = [];
  for (const set of sets) {
    for (const grant of parseGrants(set.grants)) {
      const resource = grant.resource;
      if (resource?.type !== 'page' || typeof resource.id !== 'string') {
        continue;
      }
      if (!PAGE_ID_SET.has(resource.id)) {
        unknown.push({ key: String(set.key), page: resource.id });
      }
    }
  }
  expect(
    unknown,
    'A seeded permission set grants a page that no longer exists; remove the stale grant or rename it to the page that replaced it.',
  ).toEqual([]);
});
