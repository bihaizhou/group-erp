// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { expect } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';

import { fieldCatalog } from '../../server/providers/field-catalog.js';
import { createStandaloneServer } from '../../server/standalone.js';
import { fixture, send } from '../helpers/purchase-requests.js';
import zhCN from '../../client/locales/zh-CN.js';
import enUS from '../../client/locales/en-US.js';

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

function resolve(dictionary: unknown, key: string): string | undefined {
  let current: unknown = dictionary;
  for (const part of key.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'string' && current.length > 0 ? current : undefined;
}

/**
 * The permission editor must never render an English column name. The
 * catalogue generates a titleKey from the schema, but a new collection can be
 * added before its locale entry exists, so this guard walks the real catalogue
 * and fails as soon as a field is not covered by either dictionary.
 */
test('every catalogue field has a Chinese and English label', async ({ database }) => {
  const entries = await fieldCatalog(database);
  const fields = entries.flatMap((entry) =>
    entry.fields.map((field) => ({ resource: entry.resource, ...field })),
  );
  expect(fields.length).toBeGreaterThan(500);

  const missing: string[] = [];
  for (const field of fields) {
    const zh =
      (field.titleKey ? resolve(zhCN, field.titleKey) : undefined) ??
      resolve(zhCN, `fieldLabel.${field.field}`);
    const en =
      (field.titleKey ? resolve(enUS, field.titleKey) : undefined) ??
      resolve(enUS, `fieldLabel.${field.field}`);
    if (!zh) {
      missing.push(
        `${field.resource}.${field.field} has no Chinese label (titleKey=${field.titleKey ?? 'none'}, label=${field.label})`,
      );
    } else if (!/[\u4e00-\u9fff]/u.test(zh)) {
      missing.push(
        `${field.resource}.${field.field} Chinese label is not Chinese: ${zh}`,
      );
    }
    if (!en) {
      missing.push(
        `${field.resource}.${field.field} has no English label (titleKey=${field.titleKey ?? 'none'}, label=${field.label})`,
      );
    }
  }

  expect(missing).toEqual([]);
});

interface LocalizedText {
  key?: string;
  ns?: string;
  defaultValue?: string;
}

/**
 * The permission tree is rendered from server-declared titles. An action
 * without a title falls back to its raw name (`read`, `manage`, …), and a
 * title whose key is missing from the client locale shows the English default,
 * so both cases are treated as untranslated.
 */
test('every permission resource and action has a Chinese and English title', async ({
  testApp,
  database,
}) => {
  const f = await fixture(testApp, database);
  const response = await send(
    f.admin,
    '/authorization/permissionSets/options',
    undefined,
    'GET',
  );
  expect(response.status).toBe(200);
  const { data } = (await response.json()) as {
    data: {
      sections: {
        title?: LocalizedText | string;
        subsections: {
          title?: LocalizedText | string;
          resources: {
            id: string;
            title?: LocalizedText | string;
            actions: { name: string; title?: LocalizedText | string }[];
          }[];
        }[];
      }[];
    };
  };

  const appNamespace = 'group-erp';
  const missing: string[] = [];
  const check = (label: string, title: LocalizedText | string | undefined) => {
    if (typeof title === 'string') {
      missing.push(`${label} has a raw title "${title}"`);
      return;
    }
    if (!title?.key || title.ns !== appNamespace) return;
    const zh = resolve(zhCN, title.key);
    const en = resolve(enUS, title.key);
    if (!zh || !en) {
      missing.push(`${label} title key ${title.key} is missing`);
    } else if (!/[\u4e00-\u9fff]/u.test(zh)) {
      missing.push(`${label} title is not Chinese: ${zh}`);
    }
  };

  for (const section of data.sections) {
    check(`section ${section.title ? 'title' : ''}`, section.title);
    for (const subsection of section.subsections) {
      check('subsection', subsection.title);
      for (const resource of subsection.resources) {
        check(`resource ${resource.id}`, resource.title);
        for (const action of resource.actions) {
          check(`action ${resource.id}.${action.name}`, action.title);
          if (action.title === undefined) {
            missing.push(`action ${resource.id}.${action.name} has no title`);
          }
        }
      }
    }
  }

  expect(missing).toEqual([]);
});
