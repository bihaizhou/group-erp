import { defineMigration } from '@nocobase/db';
export default defineMigration({
  name: '202610180004_supply_chain_files',
  async up({ builder, query, connection }) {
    for (const parent of ['requestId', 'issueRequestId'])
      await builder.addConstraint('supplyChainRequestVersions', {
        type: 'unique',
        name: `supply_file_version_${parent}`,
        fields: ['id', parent, 'subjectId'],
      });
    await builder.createCollection('supplyChainFiles', (c) => {
      c.string('id', { length: 36 }).primary().notNull();
      c.string('disk', { length: 255 }).notNull();
      c.text('key').notNull();
      c.text('filename').notNull();
      c.string('ext', { length: 32 }).notNull();
      c.string('mimeType', { length: 255 }).notNull();
      c.bigInt('size').notNull();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.string('ownerId', { length: 36 }).notNull();
      c.string('kind', { length: 32 }).notNull();
      c.string('documentId', { length: 36 }).notNull();
      c.string('subjectId', { length: 36 }).notNull();
      c.string('purchaseRequestId', { length: 36 }).nullable();
      c.string('issueRequestId', { length: 36 }).nullable();
      c.unique(['id', 'documentId', 'subjectId']);
      c.index(['documentId', 'ownerId']);
      c.foreignKey(['purchaseRequestId', 'subjectId'], {
        references: {
          collection: 'purchaseRequests',
          fields: ['id', 'subjectId'],
        },
        name: 'supply_file_purchase_fk',
      });
      c.foreignKey(['issueRequestId', 'subjectId'], {
        references: {
          collection: 'materialIssueRequests',
          fields: ['id', 'subjectId'],
        },
        name: 'supply_file_issue_fk',
      });
    });
    await builder.createCollection('supplyChainFileLinks', (c) => {
      c.string('id', { length: 36 }).primary().notNull();
      c.string('kind', { length: 32 }).notNull();
      c.string('documentId', { length: 36 }).notNull();
      c.string('subjectId', { length: 36 }).notNull();
      c.string('purchaseRequestId', { length: 36 }).nullable();
      c.string('issueRequestId', { length: 36 }).nullable();
      c.string('purchaseLineId', { length: 36 }).nullable();
      c.string('issueLineId', { length: 36 }).nullable();
      c.string('fileId', { length: 36 }).notNull();
      c.string('versionId', { length: 36 }).nullable();
      c.string('versionKey', { length: 36 }).notNull();
      c.boolean('shareWithGovernance').notNull();
      c.datetime('createdAt').notNull();
      c.unique(['documentId', 'fileId', 'versionKey']);
      c.index(['documentId', 'versionKey']);
      c.index(['fileId']);
      c.foreignKey(['fileId', 'documentId', 'subjectId'], {
        references: {
          collection: 'supplyChainFiles',
          fields: ['id', 'documentId', 'subjectId'],
        },
        name: 'supply_link_file_fk',
      });
      c.foreignKey(['purchaseRequestId', 'subjectId'], {
        references: {
          collection: 'purchaseRequests',
          fields: ['id', 'subjectId'],
        },
        name: 'supply_link_purchase_fk',
      });
      c.foreignKey(['issueRequestId', 'subjectId'], {
        references: {
          collection: 'materialIssueRequests',
          fields: ['id', 'subjectId'],
        },
        name: 'supply_link_issue_fk',
      });
      c.foreignKey(['purchaseLineId', 'documentId', 'subjectId'], {
        references: {
          collection: 'purchaseRequestLines',
          fields: ['id', 'requestId', 'subjectId'],
        },
        name: 'supply_link_purchase_line_fk',
      });
      c.foreignKey(['issueLineId', 'documentId', 'subjectId'], {
        references: {
          collection: 'materialIssueRequestLines',
          fields: ['id', 'requestId', 'subjectId'],
        },
        name: 'supply_link_issue_line_fk',
      });
      c.foreignKey(['versionId', 'purchaseRequestId', 'subjectId'], {
        references: {
          collection: 'supplyChainRequestVersions',
          fields: ['id', 'requestId', 'subjectId'],
        },
        name: 'supply_link_purchase_version_fk',
      });
      c.foreignKey(['versionId', 'issueRequestId', 'subjectId'], {
        references: {
          collection: 'supplyChainRequestVersions',
          fields: ['id', 'issueRequestId', 'subjectId'],
        },
        name: 'supply_link_issue_version_fk',
      });
    });
    const client = await connection.client<{
      raw(sql: string): Promise<unknown>;
    }>();
    for (const table of ['supplyChainFiles', 'supplyChainFileLinks']) {
      const fields = [
        'kind',
        'documentId',
        'purchaseRequestId',
        'issueRequestId',
        ...(table === 'supplyChainFileLinks'
          ? [
              'purchaseLineId',
              'issueLineId',
              'versionId',
              'versionKey',
              'shareWithGovernance',
            ]
          : []),
      ];
      let physical = '';
      const columns = fields.map((field) => {
        const q = query.selectFrom(table).select(field).compile(),
          match = /^select (.+?) as ["`][^"`]+["`] from (.+)$/iu.exec(q.sql),
          valid = /^(?:(?:"[^"]+"|`[^`]+`)\.)?(?:"[^"]+"|`[^`]+`)$/u;
        if (
          !match ||
          q.parameters.length ||
          !valid.test(match[1]) ||
          !valid.test(match[2])
        )
          throw new Error('Cannot resolve attachment constraint identifiers');
        physical = match[2];
        return match[1];
      });
      const predicate = (f: string[]) =>
        `((${f[0]}='purchaseRequest' AND ${f[2]} IS NOT NULL AND ${f[1]}=${f[2]} AND ${f[3]} IS NULL) OR (${f[0]}='materialIssueRequest' AND ${f[3]} IS NOT NULL AND ${f[1]}=${f[3]} AND ${f[2]} IS NULL))` +
        (table === 'supplyChainFileLinks'
          ? ` AND NOT (${f[4]} IS NOT NULL AND ${f[5]} IS NOT NULL) AND (${f[4]} IS NULL OR ${f[0]}='purchaseRequest') AND (${f[5]} IS NULL OR ${f[0]}='materialIssueRequest') AND ((${f[6]} IS NULL AND ${f[7]}='current') OR (${f[6]} IS NOT NULL AND ${f[7]}=${f[6]})) AND (NOT ${f[8]} OR ${f[4]} IS NOT NULL OR ${f[5]} IS NOT NULL)`
          : '');
      if (connection.dialect === 'postgres')
        await client.raw(
          `ALTER TABLE ${physical} ADD CONSTRAINT "${table}_ownership" CHECK (${predicate(columns)})`,
        );
      else if (connection.dialect === 'sqlite')
        for (const event of ['INSERT', 'UPDATE'])
          await client.raw(
            `CREATE TRIGGER "${table}_ownership_${event}" BEFORE ${event} ON ${physical} FOR EACH ROW WHEN NOT (${predicate(columns.map((c) => 'NEW.' + c))}) BEGIN SELECT RAISE(ABORT,'Invalid attachment ownership'); END`,
          );
      else throw new Error('Supply attachments require PostgreSQL or SQLite');
    }
  },
  async down({ builder }) {
    await builder.dropCollection('supplyChainFileLinks');
    await builder.dropCollection('supplyChainFiles');
    for (const parent of ['requestId', 'issueRequestId'])
      await builder.dropConstraint(
        'supplyChainRequestVersions',
        `supply_file_version_${parent}`,
      );
  },
});
