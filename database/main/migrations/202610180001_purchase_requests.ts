import { defineMigration } from '@nocobase/db';

export default defineMigration({
  name: '202610180001_purchase_requests',
  async up({ builder, query, connection }) {
    await builder.createCollection('purchaseRequests', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.string('code', { length: 64, nullable: false });
      c.string('subjectId', { length: 36, nullable: false });
      c.string('requesterEmployeeId', { length: 36, nullable: true });
      c.string('requesterAccountId', { length: 200, nullable: true });
      c.string('requestingUnitId', { length: 36, nullable: true });
      c.text('usage', { nullable: false });
      c.date('neededOn', { nullable: true });
      c.string('suggestedSupplierId', { length: 36, nullable: true });
      c.json('supplierSnapshot', { nullable: true });
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
        name: 'purchaseRequests_subjectId_fk',
      });
      c.foreignKey(['requesterEmployeeId'], {
        references: { collection: 'personnelEmployees', fields: ['id'] },
        name: 'purchaseRequests_requesterEmployeeId_fk',
      });
      c.foreignKey(['requestingUnitId'], {
        references: { collection: 'orgUnits', fields: ['id'] },
        name: 'purchaseRequests_requestingUnitId_fk',
      });
      c.foreignKey(['suggestedSupplierId'], {
        references: { collection: 'businessPartners', fields: ['id'] },
        name: 'purchaseRequests_suggestedSupplierId_fk',
      });
      c.foreignKey(['supersedesId'], {
        references: { collection: 'purchaseRequests', fields: ['id'] },
        name: 'purchaseRequests_supersedesId_fk',
      });
    });
    await builder.createCollection('purchaseRequestLines', (c) => {
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
          collection: 'purchaseRequests',
          fields: ['id', 'subjectId'],
        },
        name: 'purchaseRequestLin_requestId_fk',
      });
      c.foreignKey(['materialNameId'], {
        references: { collection: 'materialNames', fields: ['id'] },
        name: 'purchaseRequestLin_materialNameId_fk',
      });
      c.foreignKey(['skuId'], {
        references: { collection: 'materialSkus', fields: ['id'] },
        name: 'purchaseRequestLin_skuId_fk',
      });
      c.foreignKey(['unitId'], {
        references: { collection: 'measureUnits', fields: ['id'] },
        name: 'purchaseRequestLin_unitId_fk',
      });
      c.foreignKey(['requestedUnitId'], {
        references: { collection: 'measureUnits', fields: ['id'] },
        name: 'purchaseRequestLin_requestedUnitId_fk',
      });
      c.foreignKey(['baseUnitId'], {
        references: { collection: 'measureUnits', fields: ['id'] },
        name: 'purchaseRequestLin_baseUnitId_fk',
      });
      c.foreignKey(['unitRuleId'], {
        references: { collection: 'materialUnitRules', fields: ['id'] },
        name: 'purchaseRequestLin_unitRuleId_fk',
      });
    });
    await builder.createCollection('supplyChainRequestVersions', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.string('kind', { length: 32, nullable: false });
      c.string('requestId', { length: 36, nullable: false });
      c.string('subjectId', { length: 36, nullable: false });
      c.integer('contentVersion', { nullable: false });
      c.json('payload', { nullable: false });
      c.datetimeTz('createdAt', { nullable: false });
      c.primary('id');
      c.unique(['kind', 'requestId', 'contentVersion']);
      c.index(['requestId']);
      c.foreignKey(['requestId', 'subjectId'], {
        references: {
          collection: 'purchaseRequests',
          fields: ['id', 'subjectId'],
        },
        name: 'supplyChainRequest_requestId_fk',
      });
    });
    await builder.createCollection('supplyChainReviewTasks', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.string('kind', { length: 32, nullable: false });
      c.string('requestId', { length: 36, nullable: false });
      c.string('subjectId', { length: 36, nullable: false });
      c.integer('round', { nullable: false });
      c.string('versionId', { length: 36, nullable: false });
      c.json('candidates', { nullable: false });
      c.json('excludedActors', { nullable: false });
      c.string('status', { length: 32, nullable: false });
      c.string('decidedBy', { length: 200, nullable: true });
      c.text('reason', { nullable: false });
      c.datetimeTz('decidedAt', { nullable: true });
      c.datetimeTz('createdAt', { nullable: false });
      c.primary('id');
      c.unique(['kind', 'requestId', 'round']);
      c.index(['requestId', 'status']);
      c.foreignKey(['requestId', 'subjectId'], {
        references: {
          collection: 'purchaseRequests',
          fields: ['id', 'subjectId'],
        },
        name: 'supplyChainReviewT_requestId_fk',
      });
      c.foreignKey(['versionId'], {
        references: {
          collection: 'supplyChainRequestVersions',
          fields: ['id'],
        },
        name: 'supplyChainReviewT_versionId_fk',
      });
    });
    await builder.createCollection('supplyChainParameterHeads', (c) => {
      c.string('id', { length: 64, nullable: false });
      c.string('scope', { length: 100, nullable: false });
      c.string('groupKey', { length: 100, nullable: false });
      c.string('status', { length: 32, nullable: false });
      c.integer('revision', { nullable: false });
      c.primary('id');
      c.unique(['scope', 'groupKey']);
    });
    await builder.createCollection('supplyChainParameterVersions', (c) => {
      c.string('id', { length: 64, nullable: false });
      c.json('payload', { nullable: false });
      c.json('selectionCounts', { nullable: false });
      c.primary('id');
    });
    await builder.createCollection('supplyChainParameterSelections', (c) => {
      c.string('id', { length: 64, nullable: false });
      c.string('versionId', { length: 64, nullable: false });
      c.string('ruleKey', { length: 100, nullable: false });
      c.integer('group', { nullable: false });
      c.string('type', { length: 32, nullable: false });
      c.string('referenceId', { length: 200, nullable: false });
      c.primary('id');
      c.index(['versionId']);
    });
    await builder.createCollection('supplyChainParameterRequests', (c) => {
      c.string('id', { length: 64, nullable: false });
      c.string('actorId', { length: 200, nullable: false });
      c.text('fingerprint', { nullable: false });
      c.integer('revision', { nullable: false });
      c.primary('id');
    });
    await builder.createCollection('supplyChainParameterSnapshots', (c) => {
      c.string('id', { length: 64, nullable: false });
      c.json('payload', { nullable: false });
      c.primary('id');
    });
    await builder.createCollection('supplyChainParameterUsages', (c) => {
      c.string('id', { length: 64, nullable: false });
      c.json('payload', { nullable: false });
      c.string('recordKey', { length: 64, nullable: false });
      c.datetimeTz('at', { nullable: false });
      c.primary('id');
      c.index(['recordKey', 'at', 'id']);
    });
    // @nocobase/db beta.20 models CHECK but explicitly skips compiling it.
    // Use the transaction-bound driver only for this missing schema capability.
    // Resolve physical identifiers through Query compilation, preserving connection naming.
    if (!['sqlite', 'postgres'].includes(connection.dialect))
      throw new Error('Purchase request bounds require SQLite or PostgreSQL.');
    const client = await connection.client<{
      raw(sql: string): Promise<unknown>;
    }>();
    const quoted = /^(?:(?:"[^"]+"|`[^`]+`)\.)?(?:"[^"]+"|`[^`]+`)$/u;
    for (const [table, fields, clause] of [
      [
        'purchaseRequests',
        [
          'revision',
          'contentVersion',
          'governanceEpoch',
          'reviewRound',
          'lifecycleVersion',
          'identifiedCount',
          'lineCount',
        ],
        (f: string[]) =>
          `${f[0]} >= 1 AND ${f[1]} >= 1 AND ${f[2]} >= 1 AND ${f[3]} >= 0 AND ${f[4]} >= 0 AND ${f[5]} >= 0 AND ${f[5]} <= ${f[6]} AND ${f[6]} <= 100`,
      ],
      [
        'purchaseRequestLines',
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
      [
        'supplyChainRequestVersions',
        ['contentVersion'],
        (f: string[]) => `${f[0]} >= 1`,
      ],
      ['supplyChainReviewTasks', ['round'], (f: string[]) => `${f[0]} >= 1`],
    ] as const) {
      const columns: string[] = [];
      let physical = '';
      for (const field of fields) {
        const compiled = query.selectFrom(table).select(field).compile();
        const match = /^select (.+?) as ["`][^"`]+["`] from (.+)$/iu.exec(
          compiled.sql,
        );
        if (
          compiled.parameters.length ||
          !match ||
          !quoted.test(match[1]) ||
          !quoted.test(match[2])
        )
          throw new Error('Cannot resolve purchase constraint identifiers.');
        columns.push(match[1]);
        physical = match[2];
      }
      if (connection.dialect === 'postgres')
        await client.raw(
          `ALTER TABLE ${physical} ADD CONSTRAINT "${table}_bounds" CHECK (${clause(columns)})`,
        );
      else
        for (const event of ['INSERT', 'UPDATE'])
          await client.raw(
            `CREATE TRIGGER "${table}_bounds_${event}" BEFORE ${event} ON ${physical} FOR EACH ROW WHEN NOT (${clause(columns.map((column) => `NEW.${column}`))}) BEGIN SELECT RAISE(ABORT, 'Purchase request bounds violated'); END`,
          );
    }
  },
  async down({ builder }) {
    await builder.dropCollection('supplyChainParameterUsages');
    await builder.dropCollection('supplyChainParameterSnapshots');
    await builder.dropCollection('supplyChainParameterRequests');
    await builder.dropCollection('supplyChainParameterSelections');
    await builder.dropCollection('supplyChainParameterVersions');
    await builder.dropCollection('supplyChainParameterHeads');
    await builder.dropCollection('supplyChainReviewTasks');
    await builder.dropCollection('supplyChainRequestVersions');
    await builder.dropCollection('purchaseRequestLines');
    await builder.dropCollection('purchaseRequests');
  },
});
