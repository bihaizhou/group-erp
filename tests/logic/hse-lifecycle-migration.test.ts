// @vitest-environment node
import path from 'node:path';
import { expect } from 'vitest';
import { describeMigration } from '@nocobase/app-testing/server';

const incidentFields = ['history'] as const;
const hazardFields = ['history', 'rectifiedBy', 'rectifiedAt'] as const;
const certificateFields = [
  'history',
  'revokedBy',
  'revokedAt',
  'revokedReason',
] as const;

describeMigration('202611010002_hse_lifecycle', {
  sources: [
    {
      packageName: 'group-erp',
      directory: path.resolve(
        import.meta.dirname,
        '../../database/main/migrations',
      ),
    },
  ],
  up: async ({ expectCollection, connection }) => {
    await expectCollection('hseIncidents').toExist();
    await expectCollection('hseHazards').toExist();
    await expectCollection('hseCertificates').toExist();
    for (const field of incidentFields) {
      await expectCollection('hseIncidents').toHaveField(field, {
        nullable: true,
      });
    }
    for (const field of hazardFields) {
      await expectCollection('hseHazards').toHaveField(field, {
        nullable: true,
      });
    }
    for (const field of certificateFields) {
      await expectCollection('hseCertificates').toHaveField(field, {
        nullable: true,
      });
    }
    // History is JSON, so the lifecycle trail stays on the operational row and
    // does not need a second audit table.
    await expect(
      connection.query
        .selectFrom('hseIncidents')
        .select('history')
        .limit(1)
        .execute(),
    ).resolves.toBeInstanceOf(Array);
  },
  down: async ({ connection }) => {
    for (const [table, fields] of [
      ['hseIncidents', incidentFields],
      ['hseHazards', hazardFields],
      ['hseCertificates', certificateFields],
    ] as const) {
      for (const field of fields) {
        await expect(
          connection.query.selectFrom(table).select(field).limit(1).execute(),
        ).rejects.toThrow();
      }
    }
  },
});

describeMigration('202611130008_hse_closure_owners', {
  sources: [
    {
      packageName: 'group-erp',
      directory: path.resolve(
        import.meta.dirname,
        '../../database/main/migrations',
      ),
    },
    // Earlier app migrations (e.g. 202611010007_review_settings_page) read
    // authorizationPermissionSets, created by the authorization plugin whose
    // migrations live outside this package.
    {
      packageName: '@nocobase/app-plugin-authorization',
      directory: path.resolve(
        import.meta.dirname,
        '../../node_modules/@nocobase/app-plugin-authorization/dist/database/migrations',
      ),
    },
  ],
  up: async ({ expectCollection, connection }) => {
    await expectCollection('hseIncidents').toExist();
    // The closure-owner migration adds the incident-level owner and due date;
    // assertOwner reads ownerId at the service layer, so no DB foreign key.
    for (const field of ['ownerId', 'dueAt'] as const)
      await expectCollection('hseIncidents').toHaveField(field, {
        nullable: true,
      });
    await expect(
      connection.query
        .selectFrom('hseIncidents')
        .select(['ownerId', 'dueAt'])
        .limit(1)
        .execute(),
    ).resolves.toBeInstanceOf(Array);
  },
  down: async ({ connection }) => {
    for (const field of ['ownerId', 'dueAt'] as const)
      await expect(
        connection.query
          .selectFrom('hseIncidents')
          .select(field)
          .limit(1)
          .execute(),
      ).rejects.toThrow();
  },
});
