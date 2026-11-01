import { defineMigration } from '@nocobase/db';

const audit = (c: {
  integer: (name: string, options: object) => void;
  string: (name: string, options: object) => void;
  datetimeTz: (name: string, options: object) => void;
}) => {
  c.integer('version', { nullable: false, defaultValue: 1 });
  c.string('createdBy', { length: 200, nullable: false });
  c.string('updatedBy', { length: 200, nullable: false });
  c.datetimeTz('createdAt', { nullable: false });
  c.datetimeTz('updatedAt', { nullable: false });
};

export default defineMigration({
  name: '202611010006_assets',
  async up({ builder }) {
    await builder.createCollection('assets', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.string('subjectId', { length: 36, nullable: false });
      c.string('code', { length: 80, nullable: false });
      c.string('name', { length: 200, nullable: false });
      c.string('category', { length: 100, nullable: true });
      c.string('status', { length: 32, nullable: false, defaultValue: 'in_stock' });
      c.string('custodianEmployeeId', { length: 36, nullable: true });
      c.string('location', { length: 200, nullable: true });
      c.date('acquiredOn', { nullable: true });
      c.string('originalCost', { length: 25, nullable: true });
      c.string('currency', { length: 8, nullable: false, defaultValue: 'CNY' });
      c.string('sourceDocumentId', { length: 36, nullable: true });
      c.text('notes', { nullable: true });
      audit(c);
      c.primary('id');
      c.unique(['subjectId', 'code']);
      c.index(['subjectId', 'status']);
      c.index(['subjectId', 'custodianEmployeeId']);
      c.foreignKey(['subjectId'], {
        references: { collection: 'orgSubjects', fields: ['id'] },
        name: 'assets_subjectId_fk',
      });
      c.foreignKey(['custodianEmployeeId'], {
        references: { collection: 'personnelEmployees', fields: ['id'] },
        name: 'assets_custodian_fk',
      });
      c.foreignKey(['sourceDocumentId'], {
        references: { collection: 'stockDocuments', fields: ['id'] },
        name: 'assets_source_document_fk',
      });
    });
    await builder.createCollection('assetEvents', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.string('subjectId', { length: 36, nullable: false });
      c.string('assetId', { length: 36, nullable: false });
      c.string('action', { length: 32, nullable: false });
      c.string('fromEmployeeId', { length: 36, nullable: true });
      c.string('toEmployeeId', { length: 36, nullable: true });
      c.string('fromLocation', { length: 200, nullable: true });
      c.string('toLocation', { length: 200, nullable: true });
      c.string('actorId', { length: 200, nullable: false });
      c.text('note', { nullable: true });
      c.datetimeTz('createdAt', { nullable: false });
      c.primary('id');
      c.index(['assetId', 'createdAt']);
      c.index(['subjectId', 'createdAt']);
      c.foreignKey(['assetId'], {
        references: { collection: 'assets', fields: ['id'] },
        name: 'assetEvents_asset_fk',
      });
    });
  },
  async down({ builder }) {
    await builder.dropCollection('assetEvents');
    await builder.dropCollection('assets');
  },
});
