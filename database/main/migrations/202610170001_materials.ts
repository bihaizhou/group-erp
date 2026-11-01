import { defineMigration } from '@nocobase/db';

export default defineMigration({
  name: '202610170001_materials',
  async up({ builder }) {
    await builder.createCollection('materialCategories', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('code', { length: 64, nullable: false });
      c.string('name', { length: 200, nullable: false });
      c.text('notes', { nullable: false });
      c.string('status', { length: 32, nullable: false });
      c.integer('revision', { nullable: false, defaultValue: 1 });
      c.integer('lifecycleVersion', { nullable: false, defaultValue: 0 });
      c.datetimeTz('statusChangedAt', { nullable: true });
      c.string('createdBy', { length: 200, nullable: false });
      c.datetimeTz('createdAt', { nullable: false });
      c.datetimeTz('updatedAt', { nullable: false });
      c.index('status');
      c.index('updatedAt');
      c.unique('code');
      c.string('parentId', { length: 36, nullable: true });
      c.index('parentId');
      c.foreignKey('parentId', {
        references: { collection: 'materialCategories', fields: ['id'] },
        name: 'materialCategories_parentId_fk',
      });
      c.integer('sortOrder', { nullable: false, defaultValue: 0 });
    });
    await builder.createCollection('materialAttributeTemplates', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('code', { length: 64, nullable: false });
      c.string('name', { length: 200, nullable: false });
      c.text('notes', { nullable: false });
      c.string('status', { length: 32, nullable: false });
      c.integer('revision', { nullable: false, defaultValue: 1 });
      c.integer('lifecycleVersion', { nullable: false, defaultValue: 0 });
      c.datetimeTz('statusChangedAt', { nullable: true });
      c.string('createdBy', { length: 200, nullable: false });
      c.datetimeTz('createdAt', { nullable: false });
      c.datetimeTz('updatedAt', { nullable: false });
      c.index('status');
      c.index('updatedAt');
      c.unique('code');
      c.json('fields', { nullable: false });
    });
    await builder.createCollection('measureUnits', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('code', { length: 64, nullable: false });
      c.string('name', { length: 200, nullable: false });
      c.text('notes', { nullable: false });
      c.string('status', { length: 32, nullable: false });
      c.integer('revision', { nullable: false, defaultValue: 1 });
      c.integer('lifecycleVersion', { nullable: false, defaultValue: 0 });
      c.datetimeTz('statusChangedAt', { nullable: true });
      c.string('createdBy', { length: 200, nullable: false });
      c.datetimeTz('createdAt', { nullable: false });
      c.datetimeTz('updatedAt', { nullable: false });
      c.index('status');
      c.index('updatedAt');
      c.unique('code');
      c.string('unitType', { length: 200, nullable: false });
      c.integer('precision', { nullable: false, defaultValue: 0 });
    });
    await builder.createCollection('materialNames', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('code', { length: 64, nullable: false });
      c.string('name', { length: 200, nullable: false });
      c.text('notes', { nullable: false });
      c.string('status', { length: 32, nullable: false });
      c.integer('revision', { nullable: false, defaultValue: 1 });
      c.integer('lifecycleVersion', { nullable: false, defaultValue: 0 });
      c.datetimeTz('statusChangedAt', { nullable: true });
      c.string('createdBy', { length: 200, nullable: false });
      c.datetimeTz('createdAt', { nullable: false });
      c.datetimeTz('updatedAt', { nullable: false });
      c.index('status');
      c.index('updatedAt');
      c.unique('code');
      c.string('categoryId', { length: 36, nullable: false });
      c.index('categoryId');
      c.foreignKey('categoryId', {
        references: { collection: 'materialCategories', fields: ['id'] },
        name: 'materialNames_categoryId_fk',
      });
      c.string('templateId', { length: 36, nullable: true });
      c.index('templateId');
      c.foreignKey('templateId', {
        references: {
          collection: 'materialAttributeTemplates',
          fields: ['id'],
        },
        name: 'materialNames_templateId_fk',
      });
    });
    await builder.createCollection('materialSkus', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('code', { length: 64, nullable: false });
      c.string('name', { length: 200, nullable: false });
      c.text('notes', { nullable: false });
      c.string('status', { length: 32, nullable: false });
      c.integer('revision', { nullable: false, defaultValue: 1 });
      c.integer('lifecycleVersion', { nullable: false, defaultValue: 0 });
      c.datetimeTz('statusChangedAt', { nullable: true });
      c.string('createdBy', { length: 200, nullable: false });
      c.datetimeTz('createdAt', { nullable: false });
      c.datetimeTz('updatedAt', { nullable: false });
      c.index('status');
      c.index('updatedAt');
      c.unique('code');
      c.string('materialNameId', { length: 36, nullable: false });
      c.index('materialNameId');
      c.foreignKey('materialNameId', {
        references: { collection: 'materialNames', fields: ['id'] },
        name: 'materialSkus_materialNameId_fk',
      });
      c.string('baseUnitId', { length: 36, nullable: false });
      c.index('baseUnitId');
      c.foreignKey('baseUnitId', {
        references: { collection: 'measureUnits', fields: ['id'] },
        name: 'materialSkus_baseUnitId_fk',
      });
      c.string('managementMode', { length: 200, nullable: false });
      c.json('attributeValues', { nullable: false });
      c.string('identityKey', { length: 200, nullable: false });
      c.text('searchText', { nullable: false });
      c.unique(['materialNameId', 'identityKey']);
    });
    await builder.createCollection('materialUnitRules', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('code', { length: 64, nullable: false });
      c.string('name', { length: 200, nullable: false });
      c.text('notes', { nullable: false });
      c.string('status', { length: 32, nullable: false });
      c.integer('revision', { nullable: false, defaultValue: 1 });
      c.integer('lifecycleVersion', { nullable: false, defaultValue: 0 });
      c.datetimeTz('statusChangedAt', { nullable: true });
      c.string('createdBy', { length: 200, nullable: false });
      c.datetimeTz('createdAt', { nullable: false });
      c.datetimeTz('updatedAt', { nullable: false });
      c.index('status');
      c.index('updatedAt');
      c.unique('code');
      c.string('skuId', { length: 36, nullable: false });
      c.index('skuId');
      c.foreignKey('skuId', {
        references: { collection: 'materialSkus', fields: ['id'] },
        name: 'materialUnitRules_skuId_fk',
      });
      c.string('unitId', { length: 36, nullable: false });
      c.index('unitId');
      c.foreignKey('unitId', {
        references: { collection: 'measureUnits', fields: ['id'] },
        name: 'materialUnitRules_unitId_fk',
      });
      c.string('numerator', { length: 200, nullable: false });
      c.string('denominator', { length: 200, nullable: false });
      c.unique(['skuId', 'unitId', 'numerator', 'denominator']);
    });
    await builder.createCollection('materialReferences', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('code', { length: 64, nullable: false });
      c.string('name', { length: 200, nullable: false });
      c.text('notes', { nullable: false });
      c.string('status', { length: 32, nullable: false });
      c.integer('revision', { nullable: false, defaultValue: 1 });
      c.integer('lifecycleVersion', { nullable: false, defaultValue: 0 });
      c.datetimeTz('statusChangedAt', { nullable: true });
      c.string('createdBy', { length: 200, nullable: false });
      c.datetimeTz('createdAt', { nullable: false });
      c.datetimeTz('updatedAt', { nullable: false });
      c.index('status');
      c.index('updatedAt');
      c.unique('code');
      c.string('targetKind', { length: 200, nullable: false });
      c.string('targetId', { length: 36, nullable: false });
      c.string('sourceType', { length: 200, nullable: false });
      c.string('subjectId', { length: 36, nullable: true });
      c.index('subjectId');
      c.foreignKey('subjectId', {
        references: { collection: 'orgSubjects', fields: ['id'] },
        name: 'materialReferences_subjectId_fk',
      });
      c.string('searchKey', { length: 200, nullable: false });
      c.string('scopeKey', { length: 200, nullable: false });
      c.unique(['searchKey', 'scopeKey', 'targetKind', 'targetId']);
    });
    await builder.createCollection('materialTags', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('code', { length: 64, nullable: false });
      c.string('name', { length: 200, nullable: false });
      c.text('notes', { nullable: false });
      c.string('status', { length: 32, nullable: false });
      c.integer('revision', { nullable: false, defaultValue: 1 });
      c.integer('lifecycleVersion', { nullable: false, defaultValue: 0 });
      c.datetimeTz('statusChangedAt', { nullable: true });
      c.string('createdBy', { length: 200, nullable: false });
      c.datetimeTz('createdAt', { nullable: false });
      c.datetimeTz('updatedAt', { nullable: false });
      c.index('status');
      c.index('updatedAt');
      c.unique('code');
      c.string('appliesTo', { length: 200, nullable: false });
    });
    await builder.createCollection('materialTagLinks', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('code', { length: 64, nullable: false });
      c.string('name', { length: 200, nullable: false });
      c.text('notes', { nullable: false });
      c.string('status', { length: 32, nullable: false });
      c.integer('revision', { nullable: false, defaultValue: 1 });
      c.integer('lifecycleVersion', { nullable: false, defaultValue: 0 });
      c.datetimeTz('statusChangedAt', { nullable: true });
      c.string('createdBy', { length: 200, nullable: false });
      c.datetimeTz('createdAt', { nullable: false });
      c.datetimeTz('updatedAt', { nullable: false });
      c.index('status');
      c.index('updatedAt');
      c.unique('code');
      c.string('tagId', { length: 36, nullable: false });
      c.index('tagId');
      c.foreignKey('tagId', {
        references: { collection: 'materialTags', fields: ['id'] },
        name: 'materialTagLinks_tagId_fk',
      });
      c.string('targetKind', { length: 200, nullable: false });
      c.string('targetId', { length: 36, nullable: false });
      c.unique(['tagId', 'targetKind', 'targetId']);
    });
    await builder.createCollection('materialRequests', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('code', { length: 64, nullable: false });
      c.string('name', { length: 200, nullable: false });
      c.text('notes', { nullable: false });
      c.string('status', { length: 32, nullable: false });
      c.integer('revision', { nullable: false, defaultValue: 1 });
      c.integer('lifecycleVersion', { nullable: false, defaultValue: 0 });
      c.datetimeTz('statusChangedAt', { nullable: true });
      c.string('createdBy', { length: 200, nullable: false });
      c.datetimeTz('createdAt', { nullable: false });
      c.datetimeTz('updatedAt', { nullable: false });
      c.index('status');
      c.index('updatedAt');
      c.unique('code');
      c.string('subjectId', { length: 36, nullable: false });
      c.index('subjectId');
      c.foreignKey('subjectId', {
        references: { collection: 'orgSubjects', fields: ['id'] },
        name: 'materialRequests_subjectId_fk',
      });
      c.text('specification', { nullable: false });
      c.string('proposedUnit', { length: 200, nullable: false });
      c.text('usage', { nullable: false });
      c.string('resolvedSkuId', { length: 36, nullable: true });
      c.index('resolvedSkuId');
      c.foreignKey('resolvedSkuId', {
        references: { collection: 'materialSkus', fields: ['id'] },
        name: 'materialRequests_resolvedSkuId_fk',
      });
    });
    await builder.createCollection('materialRequestLinks', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('requestId', { length: 36, nullable: false });
      c.string('skuId', { length: 36, nullable: false });
      c.string('relation', { length: 20, nullable: false });
      c.string('createdBy', { length: 200, nullable: false });
      c.datetimeTz('createdAt', { nullable: false });
      c.unique(['requestId', 'skuId', 'relation']);
      c.index('skuId');
      c.foreignKey('requestId', {
        references: { collection: 'materialRequests', fields: ['id'] },
        name: 'materialRequestLinks_requestId_fk',
      });
      c.foreignKey('skuId', {
        references: { collection: 'materialSkus', fields: ['id'] },
        name: 'materialRequestLinks_skuId_fk',
      });
    });
    await builder.createCollection('materialSubjectSettings', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('code', { length: 64, nullable: false });
      c.string('name', { length: 200, nullable: false });
      c.text('notes', { nullable: false });
      c.string('status', { length: 32, nullable: false });
      c.integer('revision', { nullable: false, defaultValue: 1 });
      c.integer('lifecycleVersion', { nullable: false, defaultValue: 0 });
      c.datetimeTz('statusChangedAt', { nullable: true });
      c.string('createdBy', { length: 200, nullable: false });
      c.datetimeTz('createdAt', { nullable: false });
      c.datetimeTz('updatedAt', { nullable: false });
      c.index('status');
      c.index('updatedAt');
      c.unique('code');
      c.string('subjectId', { length: 36, nullable: false });
      c.index('subjectId');
      c.foreignKey('subjectId', {
        references: { collection: 'orgSubjects', fields: ['id'] },
        name: 'materialSubjectSettings_subjectId_fk',
      });
      c.string('skuId', { length: 36, nullable: false });
      c.index('skuId');
      c.foreignKey('skuId', {
        references: { collection: 'materialSkus', fields: ['id'] },
        name: 'materialSubjectSettings_skuId_fk',
      });
      c.boolean('canPurchase', { nullable: false, defaultValue: true });
      c.boolean('canSell', { nullable: false, defaultValue: true });
      c.unique(['subjectId', 'skuId']);
    });
    await builder.createCollection('warehouses', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('code', { length: 64, nullable: false });
      c.string('name', { length: 200, nullable: false });
      c.text('notes', { nullable: false });
      c.string('status', { length: 32, nullable: false });
      c.integer('revision', { nullable: false, defaultValue: 1 });
      c.integer('lifecycleVersion', { nullable: false, defaultValue: 0 });
      c.datetimeTz('statusChangedAt', { nullable: true });
      c.string('createdBy', { length: 200, nullable: false });
      c.datetimeTz('createdAt', { nullable: false });
      c.datetimeTz('updatedAt', { nullable: false });
      c.index('status');
      c.index('updatedAt');
      c.string('subjectId', { length: 36, nullable: false });
      c.index('subjectId');
      c.foreignKey('subjectId', {
        references: { collection: 'orgSubjects', fields: ['id'] },
        name: 'warehouses_subjectId_fk',
      });
      c.string('responsiblePositionId', { length: 36, nullable: true });
      c.index('responsiblePositionId');
      c.foreignKey('responsiblePositionId', {
        references: { collection: 'orgPositions', fields: ['id'] },
        name: 'warehouses_responsiblePositionId_fk',
      });
      c.unique(['subjectId', 'code']);
    });
    await builder.createCollection('materialAudit', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('kind', { length: 32, nullable: false });
      c.string('recordId', { length: 36, nullable: false });
      c.string('recordName', { length: 200, nullable: false });
      c.string('subjectId', { length: 36, nullable: true });
      c.string('actorId', { length: 200, nullable: false });
      c.string('actorName', { length: 200, nullable: false });
      c.string('operation', { length: 40, nullable: false });
      c.text('reason', { nullable: false });
      c.json('beforeValue', { nullable: true });
      c.json('afterValue', { nullable: false });
      c.datetimeTz('createdAt', { nullable: false });
      c.index(['kind', 'recordId']);
      c.index('subjectId');
      c.index('createdAt');
    });
    await builder.createCollection('materialMutationLock', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('nonce', { length: 36, nullable: false });
    });
  },
  async down({ builder }) {
    await builder.dropCollection('materialMutationLock');
    await builder.dropCollection('materialAudit');
    await builder.dropCollection('warehouses');
    await builder.dropCollection('materialSubjectSettings');
    await builder.dropCollection('materialRequestLinks');
    await builder.dropCollection('materialRequests');
    await builder.dropCollection('materialTagLinks');
    await builder.dropCollection('materialTags');
    await builder.dropCollection('materialReferences');
    await builder.dropCollection('materialUnitRules');
    await builder.dropCollection('materialSkus');
    await builder.dropCollection('materialNames');
    await builder.dropCollection('measureUnits');
    await builder.dropCollection('materialAttributeTemplates');
    await builder.dropCollection('materialCategories');
  },
});
