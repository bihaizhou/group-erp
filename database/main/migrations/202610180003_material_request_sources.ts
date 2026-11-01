import { defineMigration } from '@nocobase/db';

export default defineMigration({
  name: '202610180003_material_request_sources',
  async up({ builder, query, connection }) {
    // Unique indexes avoid rebuilding nonempty source-line and governance tables.
    for (const table of ['purchaseRequestLines', 'materialIssueRequestLines'])
      await builder.addConstraint(table, {
        type: 'unique',
        name: table + '_source_identity',
        fields: ['id', 'requestId', 'subjectId'],
      });
    await builder.addConstraint('materialRequests', {
      type: 'unique',
      name: 'materialRequests_source_company',
      fields: ['id', 'subjectId'],
    });
    await builder.createCollection('materialRequestSources', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('requestId', { length: 36, nullable: false });
      c.unique(['requestId']);
      c.string('sourceKind', { length: 32, nullable: false });
      c.string('purchaseRequestLineId', { length: 36, nullable: true });
      c.string('materialIssueRequestLineId', { length: 36, nullable: true });
      c.string('sourceDocumentId', { length: 36, nullable: false });
      c.string('subjectId', { length: 36, nullable: false });
      c.integer('sourceInputRevision', { nullable: false });
      c.integer('sourceEpoch', { nullable: false });
      c.integer('sourceAttempt', { nullable: false });
      c.integer('revision', { nullable: false });
      c.string('status', { length: 32, nullable: false });
      c.string('proposedSkuId', { length: 36, nullable: true });
      c.datetimeTz('offeredAt', { nullable: true });
      c.json('inputSnapshot', { nullable: false });
      c.json('resolutionSnapshot', { nullable: true });
      c.string('requestedBy', { length: 200, nullable: false });
      c.string('sourceHandlerId', { length: 200, nullable: false });
      c.text('reason', { nullable: false });
      c.text('invalidatedReason', { nullable: false });
      c.datetimeTz('createdAt', { nullable: false });
      c.datetimeTz('updatedAt', { nullable: false });
      c.index(['sourceDocumentId', 'status']);
      c.index(['subjectId', 'status']);
      c.unique(
        [
          'purchaseRequestLineId',
          'sourceInputRevision',
          'sourceEpoch',
          'sourceAttempt',
        ],
        { name: 'source_purchase_round_unique' },
      );
      c.unique(
        [
          'materialIssueRequestLineId',
          'sourceInputRevision',
          'sourceEpoch',
          'sourceAttempt',
        ],
        { name: 'source_issue_round_unique' },
      );
      c.foreignKey(['requestId', 'subjectId'], {
        references: {
          collection: 'materialRequests',
          fields: ['id', 'subjectId'],
        },
        name: 'source_task_company_fk',
      });
      c.foreignKey(['purchaseRequestLineId', 'sourceDocumentId', 'subjectId'], {
        references: {
          collection: 'purchaseRequestLines',
          fields: ['id', 'requestId', 'subjectId'],
        },
        name: 'source_purchase_line_fk',
      });
      c.foreignKey(
        ['materialIssueRequestLineId', 'sourceDocumentId', 'subjectId'],
        {
          references: {
            collection: 'materialIssueRequestLines',
            fields: ['id', 'requestId', 'subjectId'],
          },
          name: 'source_issue_line_fk',
        },
      );
      c.foreignKey(['proposedSkuId'], {
        references: { collection: 'materialSkus', fields: ['id'] },
        name: 'source_sku_fk',
      });
    });
    const client = await connection.client<{
      raw(sql: string): Promise<unknown>;
    }>();
    const fields = [
      'sourceKind',
      'purchaseRequestLineId',
      'materialIssueRequestLineId',
      'sourceInputRevision',
      'sourceEpoch',
      'sourceAttempt',
      'revision',
      'status',
    ];
    let physical = '';
    const cols = fields.map((field) => {
      const q = query
        .selectFrom('materialRequestSources')
        .select(field)
        .compile();
      const m = /^select (.+?) as ["`][^"`]+["`] from (.+)$/iu.exec(q.sql);
      const valid = /^(?:(?:"[^"]+"|`[^`]+`)\.)?(?:"[^"]+"|`[^`]+`)$/u;
      if (!m || q.parameters.length || !valid.test(m[1]) || !valid.test(m[2]))
        throw new Error('Cannot resolve source constraint identifiers');
      physical = m[2];
      return m[1];
    });
    const predicate = (f: string[]) =>
      `((${f[0]} = 'purchaseRequestLine' AND ${f[1]} IS NOT NULL AND ${f[2]} IS NULL) OR (${f[0]} = 'materialIssueRequestLine' AND ${f[1]} IS NULL AND ${f[2]} IS NOT NULL)) AND ${f[3]} >= 1 AND ${f[4]} >= 1 AND ${f[5]} >= 1 AND ${f[6]} >= 1 AND ${f[7]} IN ('pending','needsInformation','offered','applied','invalidated')`;
    if (connection.dialect === 'postgres')
      await client.raw(
        `ALTER TABLE ${physical} ADD CONSTRAINT "material_sources_identity" CHECK (${predicate(cols)})`,
      );
    else if (connection.dialect === 'sqlite')
      for (const event of ['INSERT', 'UPDATE'])
        await client.raw(
          `CREATE TRIGGER "material_sources_identity_${event}" BEFORE ${event} ON ${physical} FOR EACH ROW WHEN NOT (${predicate(cols.map((c) => 'NEW.' + c))}) BEGIN SELECT RAISE(ABORT, 'Invalid material source identity'); END`,
        );
    else throw new Error('Material sources require PostgreSQL or SQLite');
  },
  async down({ builder, query }) {
    // Clear only pointers into this migration's source table. Saved demand
    // inputs and already confirmed material identities predate this relation.
    for (const [table, kind] of [
      ['purchaseRequestLines', 'purchaseRequestLine'],
      ['materialIssueRequestLines', 'materialIssueRequestLine'],
    ]) {
      let cursor = '';
      while (true) {
        const rows = await query
          .selectFrom('materialRequestSources')
          .select('id')
          .where('sourceKind', '=', kind)
          .where('id', '>', cursor)
          .orderBy('id', 'asc')
          .limit(500)
          .execute();
        if (!rows.length) break;
        const ids = rows.map((row) => String(row.id));
        for (const identified of [false, true])
          await query
            .updateTable(table)
            .set({
              activeSourceLinkId: null,
              identificationStatus: identified ? 'identified' : 'unidentified',
            })
            .where('activeSourceLinkId', 'in', ids)
            .where('skuId', identified ? 'is not' : 'is', null)
            .execute();
        cursor = ids.at(-1)!;
      }
    }
    await builder.dropCollection('materialRequestSources');
    await builder.dropConstraint(
      'materialRequests',
      'materialRequests_source_company',
    );
    for (const table of ['purchaseRequestLines', 'materialIssueRequestLines'])
      await builder.dropConstraint(table, table + '_source_identity');
  },
});
