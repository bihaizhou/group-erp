import { defineMigration } from '@nocobase/db';

export default defineMigration({
  name: '202610160001_organization',
  async up({ builder }) {
    await builder.createCollection('orgSectors', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('code', { length: 64, nullable: false });
      c.unique('code');
      c.string('name', { length: 200, nullable: false });
      c.string('status', { length: 16, nullable: false, defaultValue: 'active' });
      c.integer('sortOrder', { nullable: false, defaultValue: 0 });
      c.integer('revision', { nullable: false, defaultValue: 1 });
      c.text('notes', { nullable: true });
      c.datetime('createdAt', { nullable: false });
      c.datetime('updatedAt', { nullable: false });
      c.index('status');
      c.string('parentId', { length: 36, nullable: true });
      c.foreignKey('parentId', { references: { collection: 'orgSectors', fields: ['id'] }, name: 'orgSectors_parentId_fk' });
      c.index('parentId');
    });
    await builder.createCollection('orgRegions', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('code', { length: 64, nullable: false });
      c.unique('code');
      c.string('name', { length: 200, nullable: false });
      c.string('status', { length: 16, nullable: false, defaultValue: 'active' });
      c.integer('sortOrder', { nullable: false, defaultValue: 0 });
      c.integer('revision', { nullable: false, defaultValue: 1 });
      c.text('notes', { nullable: true });
      c.datetime('createdAt', { nullable: false });
      c.datetime('updatedAt', { nullable: false });
      c.index('status');
      c.string('parentId', { length: 36, nullable: true });
      c.foreignKey('parentId', { references: { collection: 'orgRegions', fields: ['id'] }, name: 'orgRegions_parentId_fk' });
      c.index('parentId');
    });
    await builder.createCollection('orgSubjects', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('code', { length: 64, nullable: false });
      c.unique('code');
      c.string('name', { length: 200, nullable: false });
      c.string('status', { length: 16, nullable: false, defaultValue: 'active' });
      c.integer('sortOrder', { nullable: false, defaultValue: 0 });
      c.integer('revision', { nullable: false, defaultValue: 1 });
      c.text('notes', { nullable: true });
      c.datetime('createdAt', { nullable: false });
      c.datetime('updatedAt', { nullable: false });
      c.index('status');
      c.string('type', { length: 32, nullable: true });
      c.string('shortName', { length: 100, nullable: true });
      c.string('parentId', { length: 36, nullable: true });
      c.string('sectorId', { length: 36, nullable: true });
      c.string('regionId', { length: 36, nullable: true });
      c.string('registrationCountry', { length: 100, nullable: true });
      c.string('registrationNumber', { length: 100, nullable: true });
      c.foreignKey('parentId', { references: { collection: 'orgSubjects', fields: ['id'] }, name: 'orgSubjects_parentId_fk' });
      c.index('parentId');
      c.foreignKey('sectorId', { references: { collection: 'orgSectors', fields: ['id'] }, name: 'orgSubjects_sectorId_fk' });
      c.index('sectorId');
      c.foreignKey('regionId', { references: { collection: 'orgRegions', fields: ['id'] }, name: 'orgSubjects_regionId_fk' });
      c.index('regionId');
    });
    await builder.createCollection('orgUnits', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('code', { length: 64, nullable: false });
      c.unique('code');
      c.string('name', { length: 200, nullable: false });
      c.string('status', { length: 16, nullable: false, defaultValue: 'active' });
      c.integer('sortOrder', { nullable: false, defaultValue: 0 });
      c.integer('revision', { nullable: false, defaultValue: 1 });
      c.text('notes', { nullable: true });
      c.datetime('createdAt', { nullable: false });
      c.datetime('updatedAt', { nullable: false });
      c.index('status');
      c.string('type', { length: 32, nullable: true });
      c.string('subjectId', { length: 36, nullable: false });
      c.string('parentId', { length: 36, nullable: true });
      c.string('leaderPositionId', { length: 36, nullable: true });
      c.text('duties', { nullable: true });
      c.foreignKey('subjectId', { references: { collection: 'orgSubjects', fields: ['id'] }, name: 'orgUnits_subjectId_fk' });
      c.index('subjectId');
      c.foreignKey('parentId', { references: { collection: 'orgUnits', fields: ['id'] }, name: 'orgUnits_parentId_fk' });
      c.index('parentId');
    });
    await builder.createCollection('orgPositions', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('code', { length: 64, nullable: false });
      c.unique('code');
      c.string('name', { length: 200, nullable: false });
      c.string('status', { length: 16, nullable: false, defaultValue: 'active' });
      c.integer('sortOrder', { nullable: false, defaultValue: 0 });
      c.integer('revision', { nullable: false, defaultValue: 1 });
      c.text('notes', { nullable: true });
      c.datetime('createdAt', { nullable: false });
      c.datetime('updatedAt', { nullable: false });
      c.index('status');
      c.string('unitId', { length: 36, nullable: false });
      c.string('reportsToId', { length: 36, nullable: true });
      c.text('duties', { nullable: true });
      c.text('requirements', { nullable: true });
      c.foreignKey('unitId', { references: { collection: 'orgUnits', fields: ['id'] }, name: 'orgPositions_unitId_fk' });
      c.index('unitId');
      c.foreignKey('reportsToId', { references: { collection: 'orgPositions', fields: ['id'] }, name: 'orgPositions_reportsToId_fk' });
      c.index('reportsToId');
    });
    await builder.createCollection('orgRelations', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('code', { length: 64, nullable: false });
      c.unique('code');
      c.string('name', { length: 200, nullable: false });
      c.string('status', { length: 16, nullable: false, defaultValue: 'active' });
      c.integer('sortOrder', { nullable: false, defaultValue: 0 });
      c.integer('revision', { nullable: false, defaultValue: 1 });
      c.text('notes', { nullable: true });
      c.datetime('createdAt', { nullable: false });
      c.datetime('updatedAt', { nullable: false });
      c.index('status');
      c.string('type', { length: 32, nullable: true });
      c.string('sourceKind', { length: 16, nullable: false });
      c.string('sourceId', { length: 36, nullable: false });
      c.string('targetKind', { length: 16, nullable: false });
      c.string('targetId', { length: 36, nullable: false });
      c.string('startDate', { length: 10, nullable: false });
      c.string('endDate', { length: 10, nullable: true });
    });
    await builder.createCollection('orgAudit', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('kind', { length: 32, nullable: false });
      c.string('recordId', { length: 36, nullable: false });
      c.string('recordName', { length: 200, nullable: false });
      c.string('operation', { length: 16, nullable: false });
      c.string('actorId', { length: 200, nullable: false });
      c.string('actorName', { length: 200, nullable: false });
      c.text('reason', { nullable: false });
      c.json('beforeValue', { nullable: true });
      c.json('afterValue', { nullable: false });
      c.datetime('createdAt', { nullable: false });
      c.index(['kind', 'recordId']);
      c.index('createdAt');
    });
    await builder.createCollection('orgMutationLock', (c) => {
      c.string('id', { length: 32, nullable: false });
      c.primary('id');
      c.string('nonce', { length: 36, nullable: false });
    });
  },
  async down({ builder }) {
    await builder.dropCollection('orgMutationLock');
    await builder.dropCollection('orgAudit');
    await builder.dropCollection('orgRelations');
    await builder.dropCollection('orgPositions');
    await builder.dropCollection('orgUnits');
    await builder.dropCollection('orgSubjects');
    await builder.dropCollection('orgRegions');
    await builder.dropCollection('orgSectors');
  },
});

