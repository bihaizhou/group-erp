// @vitest-environment node
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { describeMigration } from '@nocobase/app-testing/server';
import stripMigration from '../../database/main/migrations/202611130005_strip_material_subject_settings_scopes.js';

// Earlier app migrations read `authorizationPermissionSets`, which the
// authorization plugin's own migrations create; the app package does not
// ship those tables.
const sources = [
  {
    packageName: 'group-erp',
    directory: path.resolve(
      import.meta.dirname,
      '../../database/main/migrations',
    ),
  },
  {
    packageName: '@nocobase/app-plugin-authorization',
    directory: path.resolve(
      import.meta.dirname,
      '../../node_modules/@nocobase/app-plugin-authorization/dist/database/migrations',
    ),
  },
];

type Grant = {
  resource?: { type?: string; id?: string };
  actions?: Array<Record<string, unknown>>;
};

const cleanGrant: Grant = {
  resource: { type: 'page', id: 'people-employees' },
  actions: [{ action: 'access' }],
};

const subjectSettingsGrant: Grant = {
  resource: { type: 'composite', id: 'materials.subjectSettings' },
  actions: [{ action: 'read' }, { action: 'update' }],
};

const scopedCompositeGrant: Grant = {
  resource: { type: 'composite', id: 'materials.skus' },
  actions: [
    {
      action: 'read',
      policy: {
        materialSubjectSettings: { subjectId: { $eq: 'subject-1' } },
        status: { $eq: 'active' },
      },
    },
  ],
};

const staleKey = `stale-material-subject-settings-${randomUUID()}`;
const cleanKey = `unaffected-${randomUUID()}`;

describeMigration('202611130004_drop_material_subject_settings', {
  sources,
  up: async ({ expectCollection }) => {
    await expectCollection('materialSubjectSettings').not.toExist();
  },
  down: async ({ expectCollection }) => {
    for (const field of [
      'code',
      'name',
      'status',
      'subjectId',
      'skuId',
      'canPurchase',
      'canSell',
      'createdAt',
      'updatedAt',
    ] as const)
      await expectCollection('materialSubjectSettings').toHaveField(field);
    await expectCollection('materialSubjectSettings').toHaveForeignKey(
      ['subjectId'],
      'orgSubjects',
    );
    await expectCollection('materialSubjectSettings').toHaveForeignKey(
      ['skuId'],
      'materialSkus',
    );
    await expectCollection('materialSubjectSettings').toHaveIndex(['code'], {
      unique: true,
    });
    await expectCollection('materialSubjectSettings').toHaveIndex(
      ['subjectId', 'skuId'],
      { unique: true },
    );
    await expectCollection('materialSubjectSettings').toHaveIndex(['status']);
  },
});

describeMigration('202611130005_strip_material_subject_settings_scopes', {
  sources,
  reversible: false,
  before: async ({ connection }) => {
    const sets = connection.repository('authorizationPermissionSets');
    await sets.createOne({
      values: {
        id: randomUUID(),
        key: staleKey,
        title: 'Warehouse transfer operator',
        revision: 'initial',
        grants: [
          subjectSettingsGrant,
          {
            resource: {
              type: 'page',
              id: 'warehouse-material-subjectSettings-new',
            },
            actions: [{ action: 'access' }],
          },
          scopedCompositeGrant,
          cleanGrant,
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    await sets.createOne({
      values: {
        id: randomUUID(),
        key: cleanKey,
        title: 'Unrelated role',
        revision: 'initial',
        grants: [cleanGrant],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
  },
  up: async ({ connection }) => {
    // The feature is permanently removed; there is deliberately no down.
    expect(stripMigration.irreversible).toBe(true);
    expect(stripMigration.down).toBeUndefined();

    const sets = connection.repository('authorizationPermissionSets');

    const stale = await sets.findOne({ filter: { key: staleKey } });
    expect(stale).toBeDefined();
    const grants = stale?.grants as Grant[];
    expect(
      grants.some(
        (grant) =>
          grant.resource?.type === 'composite' &&
          grant.resource.id === 'materials.subjectSettings',
      ),
    ).toBe(false);
    expect(
      grants.some(
        (grant) =>
          grant.resource?.type === 'page' &&
          typeof grant.resource.id === 'string' &&
          grant.resource.id.startsWith('warehouse-material-subjectSettings'),
      ),
    ).toBe(false);
    // Unrelated grants survive untouched.
    expect(grants).toContainEqual(cleanGrant);
    // The removed scope key is stripped from other composite policies while
    // the rest of the policy stays.
    expect(
      grants.find(
        (grant) =>
          grant.resource?.type === 'composite' &&
          grant.resource.id === 'materials.skus',
      ),
    ).toEqual({
      resource: { type: 'composite', id: 'materials.skus' },
      actions: [{ action: 'read', policy: { status: { $eq: 'active' } } }],
    });

    // A permission set with nothing to clean is left byte-for-byte alone.
    const clean = await sets.findOne({ filter: { key: cleanKey } });
    expect(clean?.grants).toEqual([cleanGrant]);
    expect(clean?.revision).toBe('initial');
  },
});

// A permission set stored before the table became NOT NULL may still surface
// null grants; the migration must skip it instead of throwing on `.filter`.
it('tolerates a permission set whose grants are null and writes nothing', async () => {
  const updates: unknown[] = [];
  await stripMigration.up({
    repository: () => ({
      findMany: async () => [{ key: 'legacy-null-grants', grants: null }],
      updateOne: async (options: unknown) => {
        updates.push(options);
      },
    }),
  } as never);
  expect(updates).toEqual([]);
});
