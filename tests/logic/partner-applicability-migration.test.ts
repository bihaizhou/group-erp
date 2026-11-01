// @vitest-environment node
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { describeMigration } from '@nocobase/app-testing/server';

const partnerId = randomUUID(),
  subjectId = randomUUID(),
  settingId = randomUUID(),
  now = new Date();
describeMigration('202610170004_partner_applicability', {
  sources: [
    {
      packageName: 'group-erp',
      directory: path.resolve(
        import.meta.dirname,
        '../../database/main/migrations',
      ),
    },
  ],
  before: async ({ connection }) => {
    await connection.repository('orgSubjects').createOne({
      values: {
        id: subjectId,
        code: 'LEGACY-COMPANY',
        name: 'Legacy supplier company',
        type: 'group',
        status: 'active',
        sortOrder: 0,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      },
    });
    await connection.repository('businessPartners').createOne({
      values: {
        id: partnerId,
        code: 'LEGACY-PARTNER',
        name: 'Legacy supplier',
        registrationCode: null,
        status: 'active',
        revision: 1,
        lifecycleVersion: 0,
        statusChangedAt: now,
        createdBy: 'migration-test',
        createdAt: now,
        updatedAt: now,
      },
    });
    await connection.repository('partnerSubjectSettings').createOne({
      values: {
        id: settingId,
        partnerId,
        subjectId,
        partnerRole: 'supplier',
        notes: 'Preserve local exclusion',
        status: 'inactive',
        revision: 3,
        lifecycleVersion: 2,
        statusChangedAt: now,
        createdBy: 'migration-test',
        createdAt: now,
        updatedAt: now,
      },
    });
  },
  up: async ({ connection, expectCollection }) => {
    for (const name of [
      'partnerRolePolicies',
      'partnerRegionScopes',
      'partnerCompanyScopes',
    ])
      await expectCollection(name).toExist();
    await expectCollection('partnerRolePolicies').toHaveForeignKey(
      ['partnerId'],
      'businessPartners',
    );
    await expectCollection('partnerRegionScopes').toHaveForeignKey(
      ['regionId'],
      'orgRegions',
    );
    await expectCollection('partnerCompanyScopes').toHaveForeignKey(
      ['subjectId'],
      'orgSubjects',
    );
    const policy = await connection
      .repository('partnerRolePolicies')
      .findOne({ filter: { partnerId } });
    expect(policy).toMatchObject({
      partnerRole: 'supplier',
      scopeMode: 'selected',
      status: 'active',
      revision: 1,
    });
    expect(
      await connection.repository('partnerCompanyScopes').findMany({}),
    ).toMatchObject([{ policyId: policy!.id, subjectId }]);
    expect(await connection.repository('partnerRegionScopes').count()).toBe(0);
    expect(
      await connection
        .repository('partnerSubjectSettings')
        .findOne({ filter: { id: settingId } }),
    ).toMatchObject({
      status: 'inactive',
      revision: 3,
      notes: 'Preserve local exclusion',
    });
  },
  down: async ({ connection, expectCollection }) => {
    for (const name of [
      'partnerRolePolicies',
      'partnerRegionScopes',
      'partnerCompanyScopes',
    ])
      await expectCollection(name).not.toExist();
    expect(
      await connection
        .repository('partnerSubjectSettings')
        .findOne({ filter: { id: settingId } }),
    ).toMatchObject({ status: 'inactive', revision: 3 });
    expect(
      await connection
        .repository('businessPartners')
        .exists({ filter: { id: partnerId } }),
    ).toBe(true);
  },
});
