import { defineMigration } from '@nocobase/db';
export default defineMigration({
  name: '202610180002_material_issue_requests',
  async up({ builder, query, connection }) {
    await builder.createCollection('materialIssuePurposes', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.string('subjectId', { length: 36, nullable: false });
      c.string('code', { length: 64, nullable: false });
      c.string('name', { length: 200, nullable: false });
      c.text('description', { nullable: false });
      c.string('status', { length: 32, nullable: false });
      c.integer('revision', { nullable: false });
      c.integer('lifecycleVersion', { nullable: false });
      c.datetimeTz('statusChangedAt', { nullable: true });
      c.string('createdBy', { length: 200, nullable: false });
      c.string('updatedBy', { length: 200, nullable: false });
      c.datetimeTz('createdAt', { nullable: false });
      c.datetimeTz('updatedAt', { nullable: false });
      c.primary('id');
      c.unique(['subjectId', 'code']);
      c.unique(['id', 'subjectId']);
      c.index(['subjectId', 'status']);
      c.foreignKey(['subjectId'], {
        references: { collection: 'orgSubjects', fields: ['id'] },
        name: 'issuePurposes_subject_fk',
      });
    });
    await builder.createCollection('materialIssueRequests', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.string('code', { length: 64, nullable: false });
      c.string('subjectId', { length: 36, nullable: false });
      c.string('requesterEmployeeId', { length: 36, nullable: true });
      c.string('recipientEmployeeId', { length: 36, nullable: true });
      c.string('recipientAccountId', { length: 200, nullable: true });
      c.string('requesterAccountId', { length: 200, nullable: true });
      c.string('requestingUnitId', { length: 36, nullable: true });
      c.text('usage', { nullable: false });
      c.date('neededOn', { nullable: true });
      c.string('purposeId', { length: 36, nullable: true });
      c.json('purposeSnapshot', { nullable: true });
      c.text('notes', { nullable: false });
      c.string('status', { length: 32, nullable: false });
      c.datetimeTz('statusChangedAt', { nullable: true });
      c.integer('lifecycleVersion', { nullable: false });
      c.integer('revision', { nullable: false });
      c.integer('contentVersion', { nullable: false });
      c.integer('governanceEpoch', { nullable: false });
      c.integer('reviewRound', { nullable: false });
      c.integer('identifiedCount', { nullable: false });
      c.string('identificationStatus', { length: 32, nullable: false });
      c.integer('lineCount', { nullable: false });
      c.string('submittedVersionId', { length: 36, nullable: true });
      c.string('approvedVersionId', { length: 36, nullable: true });
      c.integer('parameterContract', { nullable: false });
      c.string('supersedesId', { length: 36, nullable: true });
      c.string('createdBy', { length: 200, nullable: false });
      c.string('updatedBy', { length: 200, nullable: false });
      c.string('submittedBy', { length: 200, nullable: true });
      c.datetimeTz('submittedAt', { nullable: true });
      c.datetimeTz('approvedAt', { nullable: true });
      c.datetimeTz('createdAt', { nullable: false });
      c.datetimeTz('updatedAt', { nullable: false });
      c.primary('id');
      c.unique(['code']);
      c.unique(['id', 'subjectId']);
      c.index(['subjectId', 'status', 'updatedAt']);
      c.index(['subjectId', 'requesterAccountId']);
      c.index(['neededOn']);
      c.foreignKey(['subjectId'], {
        references: { collection: 'orgSubjects', fields: ['id'] },
        name: 'issueRequests_subjectId_fk',
      });
      c.foreignKey(['requesterEmployeeId'], {
        references: { collection: 'personnelEmployees', fields: ['id'] },
        name: 'issueRequests_requesterEmployeeId_fk',
      });
      c.foreignKey(['recipientEmployeeId'], {
        references: { collection: 'personnelEmployees', fields: ['id'] },
        name: 'issueRequests_recipient_fk',
      });
      c.foreignKey(['requestingUnitId'], {
        references: { collection: 'orgUnits', fields: ['id'] },
        name: 'issueRequests_requestingUnitId_fk',
      });
      c.foreignKey(['purposeId', 'subjectId'], {
        references: {
          collection: 'materialIssuePurposes',
          fields: ['id', 'subjectId'],
        },
        name: 'issueRequests_purposeId_fk',
      });
      c.foreignKey(['supersedesId'], {
        references: { collection: 'materialIssueRequests', fields: ['id'] },
        name: 'issueRequests_supersedesId_fk',
      });
    });
    await builder.createCollection('materialIssueRequestLines', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.string('requestId', { length: 36, nullable: false });
      c.string('subjectId', { length: 36, nullable: false });
      c.integer('lineNo', { nullable: false });
      c.string('status', { length: 32, nullable: false });
      c.integer('revision', { nullable: false });
      c.integer('inputRevision', { nullable: false });
      c.integer('governanceAttempt', { nullable: false });
      c.string('originalName', { length: 200, nullable: false });
      c.text('originalSpecification', { nullable: false });
      c.string('requestedQuantity', { length: 32, nullable: false });
      c.string('requestedUnitText', { length: 100, nullable: false });
      c.string('requestedUnitId', { length: 36, nullable: true });
      c.string('materialNameId', { length: 36, nullable: true });
      c.string('skuId', { length: 36, nullable: true });
      c.integer('skuRevision', { nullable: true });
      c.string('managementModeSnapshot', { length: 32, nullable: true });
      c.string('unitId', { length: 36, nullable: true });
      c.string('unitRuleId', { length: 36, nullable: true });
      c.integer('unitRuleRevision', { nullable: true });
      c.string('numeratorSnapshot', { length: 32, nullable: true });
      c.string('denominatorSnapshot', { length: 32, nullable: true });
      c.string('baseUnitId', { length: 36, nullable: true });
      c.string('baseQuantity', { length: 32, nullable: true });
      c.string('identificationStatus', { length: 32, nullable: false });
      c.string('activeSourceLinkId', { length: 36, nullable: true });
      c.json('materialSnapshot', { nullable: true });
      c.string('confirmedBy', { length: 200, nullable: true });
      c.datetimeTz('confirmedAt', { nullable: true });
      c.text('usage', { nullable: false });
      c.text('notes', { nullable: false });
      c.json('selectionInput', { nullable: false });
      c.primary('id');
      c.unique(['requestId', 'lineNo']);
      c.index(['requestId', 'status']);
      c.foreignKey(['requestId', 'subjectId'], {
        references: {
          collection: 'materialIssueRequests',
          fields: ['id', 'subjectId'],
        },
        name: 'issueLines_requestId_fk',
      });
      c.foreignKey(['materialNameId'], {
        references: { collection: 'materialNames', fields: ['id'] },
        name: 'issueLines_materialNameId_fk',
      });
      c.foreignKey(['skuId'], {
        references: { collection: 'materialSkus', fields: ['id'] },
        name: 'issueLines_skuId_fk',
      });
      c.foreignKey(['unitId'], {
        references: { collection: 'measureUnits', fields: ['id'] },
        name: 'issueLines_unitId_fk',
      });
      c.foreignKey(['requestedUnitId'], {
        references: { collection: 'measureUnits', fields: ['id'] },
        name: 'issueLines_requestedUnitId_fk',
      });
      c.foreignKey(['baseUnitId'], {
        references: { collection: 'measureUnits', fields: ['id'] },
        name: 'issueLines_baseUnitId_fk',
      });
      c.foreignKey(['unitRuleId'], {
        references: { collection: 'materialUnitRules', fields: ['id'] },
        name: 'issueLines_unitRuleId_fk',
      });
    });
    // SQLite rebuilds altered tables; detach the incoming snapshot FK first so nonempty history survives.
    await builder.dropConstraint(
      'supplyChainReviewTasks',
      'supplyChainReviewT_versionId_fk',
    );
    for (const table of [
      'supplyChainRequestVersions',
      'supplyChainReviewTasks',
    ]) {
      await builder.alterCollection(table, (c) => {
        c.alterField('requestId', {
          type: 'string',
          length: 36,
          nullable: true,
        });
        c.string('issueRequestId', { length: 36, nullable: true });
        c.foreignKey(['issueRequestId', 'subjectId'], {
          references: {
            collection: 'materialIssueRequests',
            fields: ['id', 'subjectId'],
          },
          name: table + '_issue_fk',
        });
        c.unique(
          [
            'kind',
            'issueRequestId',
            table === 'supplyChainRequestVersions' ? 'contentVersion' : 'round',
          ],
          { name: table + '_issue_unique' },
        );
      });
    }
    await builder.addConstraint('supplyChainReviewTasks', {
      type: 'foreignKey',
      fields: ['versionId'],
      references: { collection: 'supplyChainRequestVersions', fields: ['id'] },
      name: 'supplyChainReviewT_versionId_fk',
    });
    // The DB beta's CHECK compiler skips these constraints. Install actual bounds
    // with transaction-bound DDL; all physical identifiers come from Query compilation.
    const client = await connection.client<{
      raw(sql: string): Promise<unknown>;
    }>();
    if (!['sqlite', 'postgres'].includes(connection.dialect))
      throw new Error('Issue requests require SQLite or PostgreSQL.');
    for (const [table, fields, predicate] of [
      [
        'materialIssuePurposes',
        ['revision', 'lifecycleVersion'],
        (f: string[]) => `${f[0]} >= 1 AND ${f[1]} >= 0`,
      ],
      [
        'materialIssueRequests',
        [
          'revision',
          'lifecycleVersion',
          'contentVersion',
          'governanceEpoch',
          'reviewRound',
          'identifiedCount',
          'lineCount',
        ],
        (f: string[]) =>
          `${f[0]} >= 1 AND ${f[1]} >= 0 AND ${f[2]} >= 1 AND ${f[3]} >= 1 AND ${f[4]} >= 0 AND ${f[5]} >= 0 AND ${f[5]} <= ${f[6]} AND ${f[6]} <= 100`,
      ],
      [
        'materialIssueRequestLines',
        [
          'revision',
          'inputRevision',
          'governanceAttempt',
          'lineNo',
          'requestedQuantity',
        ],
        (f: string[]) =>
          `${f[0]} >= 1 AND ${f[1]} >= 1 AND ${f[2]} >= 0 AND ${f[3]} <> 0 AND CAST(${f[4]} AS NUMERIC) > 0`,
      ],
      ...['supplyChainRequestVersions', 'supplyChainReviewTasks'].map(
        (table) =>
          [
            table,
            [
              'kind',
              'requestId',
              'issueRequestId',
              table === 'supplyChainRequestVersions'
                ? 'contentVersion'
                : 'round',
            ],
            (f: string[]) =>
              `(((${f[0]} = 'purchaseRequest' AND ${f[1]} IS NOT NULL AND ${f[2]} IS NULL) OR (${f[0]} = 'materialIssueRequest' AND ${f[1]} IS NULL AND ${f[2]} IS NOT NULL)) AND ${f[3]} >= 1)`,
          ] as const,
      ),
    ] as const) {
      const resolve = (field: string) => {
        const compiled = query.selectFrom(table).select(field).compile();
        const match = /^select (.+?) as ["`][^"`]+["`] from (.+)$/iu.exec(
          compiled.sql,
        );
        const identifier = /^(?:(?:"[^"]+"|`[^`]+`)\.)?(?:"[^"]+"|`[^`]+`)$/u;
        if (
          !match ||
          compiled.parameters.length ||
          !identifier.test(match[1]) ||
          !identifier.test(match[2])
        )
          throw new Error('Cannot resolve issue constraint identifiers.');
        return { column: match[1], table: match[2] };
      };
      const names = fields.map(resolve),
        physical = names[0].table;
      if (connection.dialect === 'postgres')
        await client.raw(
          `ALTER TABLE ${physical} ADD CONSTRAINT "${table}_issue_bounds" CHECK (${predicate(names.map((v) => v.column))})`,
        );
      else
        for (const event of ['INSERT', 'UPDATE'])
          await client.raw(
            `CREATE TRIGGER "${table}_issue_bounds_${event}" BEFORE ${event} ON ${physical} FOR EACH ROW WHEN NOT (${predicate(names.map((v) => 'NEW.' + v.column))}) BEGIN SELECT RAISE(ABORT, 'Issue request bounds violated'); END`,
          );
    }
  },
  async down({ builder, query, connection }) {
    await builder.dropConstraint(
      'supplyChainReviewTasks',
      'supplyChainReviewT_versionId_fk',
    );
    await query
      .deleteFrom('supplyChainReviewTasks')
      .where('kind', '=', 'materialIssueRequest')
      .execute();
    await query
      .deleteFrom('supplyChainRequestVersions')
      .where('kind', '=', 'materialIssueRequest')
      .execute();
    const client = await connection.client<{
      raw(sql: string): Promise<unknown>;
    }>();
    for (const table of [
      'supplyChainReviewTasks',
      'supplyChainRequestVersions',
    ]) {
      if (connection.dialect === 'postgres') {
        const compiled = query.selectFrom(table).select('id').compile();
        const match = /^select .+? from (.+)$/iu.exec(compiled.sql);
        if (
          !match ||
          compiled.parameters.length ||
          !/^(?:"[^"]+"\.)?"[^"]+"$/u.test(match[1])
        )
          throw new Error('Cannot resolve issue rollback identifiers.');
        await client.raw(
          `ALTER TABLE ${match[1]} DROP CONSTRAINT "${table}_issue_bounds"`,
        );
      } else
        for (const event of ['INSERT', 'UPDATE'])
          await client.raw(
            `DROP TRIGGER IF EXISTS "${table}_issue_bounds_${event}"`,
          );
      // Drop dependent constraints first: PostgreSQL drops them with their column,
      // while this builder otherwise emits column removal before constraint removal.
      await builder.alterCollection(table, (c) => {
        c.dropConstraint(table + '_issue_unique');
        c.dropConstraint(table + '_issue_fk');
      });
      await builder.alterCollection(table, (c) => {
        c.dropField('issueRequestId');
        c.alterField('requestId', {
          type: 'string',
          length: 36,
          nullable: false,
        });
      });
    }
    await builder.addConstraint('supplyChainReviewTasks', {
      type: 'foreignKey',
      fields: ['versionId'],
      references: { collection: 'supplyChainRequestVersions', fields: ['id'] },
      name: 'supplyChainReviewT_versionId_fk',
    });
    // Restore the original SQLite bounds after its table rebuilds.
    if (connection.dialect === 'sqlite')
      for (const [table, field] of [
        ['supplyChainRequestVersions', 'contentVersion'],
        ['supplyChainReviewTasks', 'round'],
      ] as const) {
        const compiled = query.selectFrom(table).select(field).compile();
        const match = /^select (.+?) as ["`][^"`]+["`] from (.+)$/iu.exec(
          compiled.sql,
        );
        const identifier = /^(?:(?:"[^"]+"|`[^`]+`)\.)?(?:"[^"]+"|`[^`]+`)$/u;
        if (
          !match ||
          compiled.parameters.length ||
          !identifier.test(match[1]) ||
          !identifier.test(match[2])
        )
          throw new Error('Cannot resolve restored purchase bounds.');
        for (const event of ['INSERT', 'UPDATE'])
          await client.raw(
            `CREATE TRIGGER IF NOT EXISTS "${table}_bounds_${event}" BEFORE ${event} ON ${match[2]} FOR EACH ROW WHEN NOT (NEW.${match[1]} >= 1) BEGIN SELECT RAISE(ABORT, 'Purchase request bounds violated'); END`,
          );
      }
    await builder.dropCollection('materialIssueRequestLines');
    await builder.dropCollection('materialIssueRequests');
    await builder.dropCollection('materialIssuePurposes');
  },
});
