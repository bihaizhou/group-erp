// @vitest-environment node
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import {
  describeMigration,
  verifyMigration,
} from '@nocobase/app-testing/server';
import migration from '../../database/main/migrations/202610170002_remove_material_categories.js';

const ids = {
  root: randomUUID(),
  leaf: randomUUID(),
  name: randomUUID(),
  unit: randomUUID(),
  sku: randomUUID(),
  tag: randomUUID(),
  obsolete: randomUUID(),
  longRoot: randomUUID(),
  longLeaf: randomUUID(),
};
const now = new Date();
const base = (id: string, code: string, name: string) => ({
  id,
  code,
  name,
  notes: '',
  status: 'active',
  revision: 1,
  lifecycleVersion: 0,
  statusChangedAt: now,
  createdBy: 'test',
  createdAt: now,
  updatedAt: now,
});
describeMigration('202610170002_remove_material_categories', {
  sources: [
    {
      packageName: 'group-erp',
      directory: path.resolve(
        import.meta.dirname,
        '../../database/main/migrations',
      ),
    },
  ],
  reversible: false,
  before: async ({ connection }) => {
    await connection.repository('materialCategories').createOne({
      values: {
        ...base(ids.longRoot, 'LONG-ROOT', 'A'.repeat(200)),
        parentId: null,
        sortOrder: 0,
      },
    });
    await connection.repository('materialCategories').createOne({
      values: {
        ...base(ids.longLeaf, 'LONG-LEAF', 'B'.repeat(200)),
        notes: '备注'.repeat(3000),
        parentId: ids.longRoot,
        sortOrder: 0,
      },
    });
    await connection.repository('materialCategories').createOne({
      values: {
        ...base(ids.obsolete, 'OLD', '停用品'),
        status: 'inactive',
        parentId: null,
        sortOrder: 0,
      },
    });
    await connection.repository('materialCategories').createOne({
      values: {
        ...base(ids.root, 'OFFICE', '办公用品'),
        parentId: null,
        sortOrder: 1,
      },
    });
    await connection.repository('materialCategories').createOne({
      values: {
        ...base(ids.leaf, 'WRITING', '书写用品'),
        parentId: ids.root,
        sortOrder: 2,
      },
    });
    await connection.repository('materialNames').createOne({
      values: {
        ...base(ids.name, 'PEN', '中性笔'),
        categoryId: ids.leaf,
        templateId: null,
      },
    });
    await connection.repository('measureUnits').createOne({
      values: {
        ...base(ids.unit, 'PCS', '支'),
        unitType: 'count',
        precision: 0,
      },
    });
    await connection.repository('materialSkus').createOne({
      values: {
        ...base(ids.sku, 'PEN-BLACK', '黑色中性笔'),
        materialNameId: ids.name,
        baseUnitId: ids.unit,
        managementMode: 'stock',
        attributeValues: {},
        identityKey: 'original-identity',
        searchText: 'black pen',
      },
    });
    await connection.repository('materialTags').createOne({
      values: { ...base(ids.tag, 'OFFICE', '办公用品'), appliesTo: 'both' },
    });
  },
  up: async ({ connection, expectCollection }) => {
    expect(migration.irreversible).toBe(true);
    await expectCollection('materialCategories').not.toExist();
    await expectCollection('materialNames').not.toHaveField('categoryId');
    await expectCollection('materialNames').not.toHaveForeignKey(
      ['categoryId'],
      'materialCategories',
    );
    await expectCollection('materialNames').not.toHaveIndex(['categoryId']);
    const name = await connection
      .repository('materialNames')
      .findOne({ filter: { id: ids.name } });
    expect(name?.name).toBe('中性笔');
    expect(name).not.toHaveProperty('categoryId');
    const sku = await connection
      .repository('materialSkus')
      .findOne({ filter: { id: ids.sku } });
    expect(sku).toMatchObject({
      materialNameId: ids.name,
      baseUnitId: ids.unit,
      identityKey: 'original-identity',
    });
    const tags = await connection.repository('materialTags').findMany({});
    expect(tags).toHaveLength(6);
    const longTag = tags.find((tag) => tag.name === 'B'.repeat(200));
    expect(longTag?.notes).toHaveLength(6000);
    expect(
      tags.some((tag) => tag.name === '停用品' && tag.status === 'inactive'),
    ).toBe(true);
    expect(tags.find((tag) => tag.id === ids.tag)).toMatchObject({
      code: 'OFFICE',
      name: '办公用品',
    });
    const links = await connection
      .repository('materialTagLinks')
      .findMany({ filter: { targetKind: 'names', targetId: ids.name } });
    expect(links).toHaveLength(2);
    expect(links.every((link) => link.status === 'active')).toBe(true);
    expect(
      links
        .map((link) => tags.find((tag) => tag.id === link.tagId)?.name)
        .sort(),
    ).toEqual(['办公用品', '办公用品 / 书写用品']);
    const audit = await connection
      .repository('materialAudit')
      .findMany({ filter: { reason: 'categoryMigration' } });
    expect(audit).toHaveLength(6);
    expect(
      audit.find((entry) => entry.recordId === longTag?.id)?.beforeValue,
    ).toMatchObject({
      id: ids.longLeaf,
      parentId: ids.longRoot,
      notes: '备注'.repeat(3000),
    });
    expect(
      audit.find((entry) => entry.kind === 'names')?.beforeValue,
    ).toMatchObject({ categoryId: ids.leaf });
  },
});

it('refuses a cyclic legacy hierarchy before changing the schema or writing its replacement tags', async () => {
  await expect(
    verifyMigration('202610170002_remove_material_categories', {
      sources: [
        {
          packageName: 'group-erp',
          directory: path.resolve(
            import.meta.dirname,
            '../../database/main/migrations',
          ),
        },
      ],
      reversible: false,
      before: async ({ connection }) => {
        await connection.repository('materialCategories').createOne({
          values: {
            ...base(ids.root, 'CYCLE', 'Cyclic legacy record'),
            parentId: ids.root,
            sortOrder: 0,
          },
        });
      },
      up: async () => {
        throw new Error(
          'A cyclic hierarchy must not reach the post-migration check.',
        );
      },
    }),
  ).rejects.toThrow(/cyclic material category/);
});
