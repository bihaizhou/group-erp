import { defineMigration } from '@nocobase/db';

export default defineMigration({
  name: '202610160002_people',
  async up({ builder }) {
    await builder.createCollection('personnelEmployees', (c) => {
      c.unique('accountId');
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('code', { length: 64, nullable: false });
      c.unique('code');
      c.string('name', { length: 200, nullable: false });
      c.string('status', {
        length: 32,
        nullable: false,
        defaultValue: 'active',
      });
      c.integer('revision', { nullable: false, defaultValue: 1 });
      c.integer('lifecycleVersion', { nullable: false, defaultValue: 0 });
      c.datetimeTz('statusChangedAt', { nullable: true });
      c.string('createdBy', { length: 200, nullable: false });
      c.json('data', { nullable: false });
      c.json('snapshot', { nullable: true });
      c.datetime('createdAt', { nullable: false });
      c.datetime('updatedAt', { nullable: false });
      c.integer('grade', { nullable: true });
      c.string('accountId', { length: 200, nullable: true });
      c.string('photoId', { length: 36, nullable: true });
      c.string('subjectId', { length: 36, nullable: true });
      c.index('subjectId');
      c.foreignKey('subjectId', {
        references: { collection: 'orgSubjects', fields: ['id'] },
        name: 'personnelEmployees_subjectId_fk',
      });
      c.string('personId', { length: 36, nullable: true });
      c.index('personId');
      c.string('positionId', { length: 36, nullable: true });
      c.index('positionId');
      c.foreignKey('positionId', {
        references: { collection: 'orgPositions', fields: ['id'] },
        name: 'personnelEmployees_positionId_fk',
      });
      c.index('status');
      c.index('updatedAt');
    });
    await builder.createCollection('personnelEmployments', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('code', { length: 64, nullable: false });
      c.unique('code');
      c.string('name', { length: 200, nullable: false });
      c.string('status', {
        length: 32,
        nullable: false,
        defaultValue: 'active',
      });
      c.integer('revision', { nullable: false, defaultValue: 1 });
      c.integer('lifecycleVersion', { nullable: false, defaultValue: 0 });
      c.datetimeTz('statusChangedAt', { nullable: true });
      c.string('createdBy', { length: 200, nullable: false });
      c.json('data', { nullable: false });
      c.json('snapshot', { nullable: true });
      c.datetime('createdAt', { nullable: false });
      c.datetime('updatedAt', { nullable: false });
      c.integer('grade', { nullable: true });
      c.string('accountId', { length: 200, nullable: true });
      c.string('photoId', { length: 36, nullable: true });
      c.string('subjectId', { length: 36, nullable: true });
      c.index('subjectId');
      c.foreignKey('subjectId', {
        references: { collection: 'orgSubjects', fields: ['id'] },
        name: 'personnelEmployments_subjectId_fk',
      });
      c.string('personId', { length: 36, nullable: true });
      c.index('personId');
      c.foreignKey('personId', {
        references: { collection: 'personnelEmployees', fields: ['id'] },
        name: 'personnelEmployments_personId_fk',
      });
      c.string('positionId', { length: 36, nullable: true });
      c.index('positionId');
      c.foreignKey('positionId', {
        references: { collection: 'orgPositions', fields: ['id'] },
        name: 'personnelEmployments_positionId_fk',
      });
      c.index('status');
      c.index('updatedAt');
    });
    await builder.createCollection('personnelAssignments', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('code', { length: 64, nullable: false });
      c.unique('code');
      c.string('name', { length: 200, nullable: false });
      c.string('status', {
        length: 32,
        nullable: false,
        defaultValue: 'active',
      });
      c.integer('revision', { nullable: false, defaultValue: 1 });
      c.integer('lifecycleVersion', { nullable: false, defaultValue: 0 });
      c.datetimeTz('statusChangedAt', { nullable: true });
      c.string('createdBy', { length: 200, nullable: false });
      c.json('data', { nullable: false });
      c.json('snapshot', { nullable: true });
      c.datetime('createdAt', { nullable: false });
      c.datetime('updatedAt', { nullable: false });
      c.integer('grade', { nullable: true });
      c.string('accountId', { length: 200, nullable: true });
      c.string('photoId', { length: 36, nullable: true });
      c.string('subjectId', { length: 36, nullable: true });
      c.index('subjectId');
      c.foreignKey('subjectId', {
        references: { collection: 'orgSubjects', fields: ['id'] },
        name: 'personnelAssignments_subjectId_fk',
      });
      c.string('personId', { length: 36, nullable: true });
      c.index('personId');
      c.foreignKey('personId', {
        references: { collection: 'personnelEmployees', fields: ['id'] },
        name: 'personnelAssignments_personId_fk',
      });
      c.string('positionId', { length: 36, nullable: true });
      c.index('positionId');
      c.foreignKey('positionId', {
        references: { collection: 'orgPositions', fields: ['id'] },
        name: 'personnelAssignments_positionId_fk',
      });
      c.index('status');
      c.index('updatedAt');
    });
    await builder.createCollection('personnelChanges', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('code', { length: 64, nullable: false });
      c.unique('code');
      c.string('name', { length: 200, nullable: false });
      c.string('status', {
        length: 32,
        nullable: false,
        defaultValue: 'active',
      });
      c.integer('revision', { nullable: false, defaultValue: 1 });
      c.integer('lifecycleVersion', { nullable: false, defaultValue: 0 });
      c.datetimeTz('statusChangedAt', { nullable: true });
      c.string('createdBy', { length: 200, nullable: false });
      c.json('data', { nullable: false });
      c.json('snapshot', { nullable: true });
      c.datetime('createdAt', { nullable: false });
      c.datetime('updatedAt', { nullable: false });
      c.integer('grade', { nullable: true });
      c.string('accountId', { length: 200, nullable: true });
      c.string('photoId', { length: 36, nullable: true });
      c.string('subjectId', { length: 36, nullable: true });
      c.index('subjectId');
      c.foreignKey('subjectId', {
        references: { collection: 'orgSubjects', fields: ['id'] },
        name: 'personnelChanges_subjectId_fk',
      });
      c.string('personId', { length: 36, nullable: true });
      c.index('personId');
      c.foreignKey('personId', {
        references: { collection: 'personnelEmployees', fields: ['id'] },
        name: 'personnelChanges_personId_fk',
      });
      c.string('positionId', { length: 36, nullable: true });
      c.index('positionId');
      c.foreignKey('positionId', {
        references: { collection: 'orgPositions', fields: ['id'] },
        name: 'personnelChanges_positionId_fk',
      });
      c.index('status');
      c.index('updatedAt');
    });
    await builder.createCollection('hrDimensions', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('code', { length: 64, nullable: false });
      c.unique('code');
      c.string('name', { length: 200, nullable: false });
      c.string('status', {
        length: 32,
        nullable: false,
        defaultValue: 'active',
      });
      c.integer('revision', { nullable: false, defaultValue: 1 });
      c.integer('lifecycleVersion', { nullable: false, defaultValue: 0 });
      c.datetimeTz('statusChangedAt', { nullable: true });
      c.string('createdBy', { length: 200, nullable: false });
      c.json('data', { nullable: false });
      c.json('snapshot', { nullable: true });
      c.datetime('createdAt', { nullable: false });
      c.datetime('updatedAt', { nullable: false });
      c.integer('grade', { nullable: true });
      c.string('accountId', { length: 200, nullable: true });
      c.string('photoId', { length: 36, nullable: true });
      c.string('subjectId', { length: 36, nullable: true });
      c.index('subjectId');
      c.foreignKey('subjectId', {
        references: { collection: 'orgSubjects', fields: ['id'] },
        name: 'hrDimensions_subjectId_fk',
      });
      c.string('personId', { length: 36, nullable: true });
      c.index('personId');
      c.foreignKey('personId', {
        references: { collection: 'personnelEmployees', fields: ['id'] },
        name: 'hrDimensions_personId_fk',
      });
      c.string('positionId', { length: 36, nullable: true });
      c.index('positionId');
      c.foreignKey('positionId', {
        references: { collection: 'orgPositions', fields: ['id'] },
        name: 'hrDimensions_positionId_fk',
      });
      c.index('status');
      c.index('updatedAt');
    });
    await builder.createCollection('hrModels', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('code', { length: 64, nullable: false });
      c.unique('code');
      c.string('name', { length: 200, nullable: false });
      c.string('status', {
        length: 32,
        nullable: false,
        defaultValue: 'active',
      });
      c.integer('revision', { nullable: false, defaultValue: 1 });
      c.integer('lifecycleVersion', { nullable: false, defaultValue: 0 });
      c.datetimeTz('statusChangedAt', { nullable: true });
      c.string('createdBy', { length: 200, nullable: false });
      c.json('data', { nullable: false });
      c.json('snapshot', { nullable: true });
      c.datetime('createdAt', { nullable: false });
      c.datetime('updatedAt', { nullable: false });
      c.integer('grade', { nullable: true });
      c.string('accountId', { length: 200, nullable: true });
      c.string('photoId', { length: 36, nullable: true });
      c.string('subjectId', { length: 36, nullable: true });
      c.index('subjectId');
      c.foreignKey('subjectId', {
        references: { collection: 'orgSubjects', fields: ['id'] },
        name: 'hrModels_subjectId_fk',
      });
      c.string('personId', { length: 36, nullable: true });
      c.index('personId');
      c.foreignKey('personId', {
        references: { collection: 'personnelEmployees', fields: ['id'] },
        name: 'hrModels_personId_fk',
      });
      c.string('positionId', { length: 36, nullable: true });
      c.index('positionId');
      c.foreignKey('positionId', {
        references: { collection: 'orgPositions', fields: ['id'] },
        name: 'hrModels_positionId_fk',
      });
      c.index('status');
      c.index('updatedAt');
    });
    await builder.createCollection('hrProfiles', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('code', { length: 64, nullable: false });
      c.unique('code');
      c.string('name', { length: 200, nullable: false });
      c.string('status', {
        length: 32,
        nullable: false,
        defaultValue: 'active',
      });
      c.integer('revision', { nullable: false, defaultValue: 1 });
      c.integer('lifecycleVersion', { nullable: false, defaultValue: 0 });
      c.datetimeTz('statusChangedAt', { nullable: true });
      c.string('createdBy', { length: 200, nullable: false });
      c.json('data', { nullable: false });
      c.json('snapshot', { nullable: true });
      c.datetime('createdAt', { nullable: false });
      c.datetime('updatedAt', { nullable: false });
      c.integer('grade', { nullable: true });
      c.string('accountId', { length: 200, nullable: true });
      c.string('photoId', { length: 36, nullable: true });
      c.string('subjectId', { length: 36, nullable: true });
      c.index('subjectId');
      c.foreignKey('subjectId', {
        references: { collection: 'orgSubjects', fields: ['id'] },
        name: 'hrProfiles_subjectId_fk',
      });
      c.string('personId', { length: 36, nullable: true });
      c.foreignKey('personId', {
        references: { collection: 'personnelEmployees', fields: ['id'] },
        name: 'hrProfiles_personId_fk',
      });
      c.string('positionId', { length: 36, nullable: true });
      c.index('positionId');
      c.foreignKey('positionId', {
        references: { collection: 'orgPositions', fields: ['id'] },
        name: 'hrProfiles_positionId_fk',
      });
      c.index('status');
      c.index('updatedAt');
      c.unique('personId');
    });
    await builder.createCollection('hrEvaluations', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('code', { length: 64, nullable: false });
      c.unique('code');
      c.string('name', { length: 200, nullable: false });
      c.string('status', {
        length: 32,
        nullable: false,
        defaultValue: 'active',
      });
      c.integer('revision', { nullable: false, defaultValue: 1 });
      c.integer('lifecycleVersion', { nullable: false, defaultValue: 0 });
      c.datetimeTz('statusChangedAt', { nullable: true });
      c.string('createdBy', { length: 200, nullable: false });
      c.json('data', { nullable: false });
      c.json('snapshot', { nullable: true });
      c.datetime('createdAt', { nullable: false });
      c.datetime('updatedAt', { nullable: false });
      c.integer('grade', { nullable: true });
      c.string('accountId', { length: 200, nullable: true });
      c.string('photoId', { length: 36, nullable: true });
      c.string('subjectId', { length: 36, nullable: true });
      c.index('subjectId');
      c.foreignKey('subjectId', {
        references: { collection: 'orgSubjects', fields: ['id'] },
        name: 'hrEvaluations_subjectId_fk',
      });
      c.string('personId', { length: 36, nullable: true });
      c.index('personId');
      c.foreignKey('personId', {
        references: { collection: 'personnelEmployees', fields: ['id'] },
        name: 'hrEvaluations_personId_fk',
      });
      c.string('positionId', { length: 36, nullable: true });
      c.index('positionId');
      c.foreignKey('positionId', {
        references: { collection: 'orgPositions', fields: ['id'] },
        name: 'hrEvaluations_positionId_fk',
      });
      c.index('status');
      c.index('updatedAt');
    });
    await builder.createCollection('hrDevelopmentPlans', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('code', { length: 64, nullable: false });
      c.unique('code');
      c.string('name', { length: 200, nullable: false });
      c.string('status', {
        length: 32,
        nullable: false,
        defaultValue: 'active',
      });
      c.integer('revision', { nullable: false, defaultValue: 1 });
      c.integer('lifecycleVersion', { nullable: false, defaultValue: 0 });
      c.datetimeTz('statusChangedAt', { nullable: true });
      c.string('createdBy', { length: 200, nullable: false });
      c.json('data', { nullable: false });
      c.json('snapshot', { nullable: true });
      c.datetime('createdAt', { nullable: false });
      c.datetime('updatedAt', { nullable: false });
      c.integer('grade', { nullable: true });
      c.string('accountId', { length: 200, nullable: true });
      c.string('photoId', { length: 36, nullable: true });
      c.string('subjectId', { length: 36, nullable: true });
      c.index('subjectId');
      c.foreignKey('subjectId', {
        references: { collection: 'orgSubjects', fields: ['id'] },
        name: 'hrDevelopmentPlans_subjectId_fk',
      });
      c.string('personId', { length: 36, nullable: true });
      c.index('personId');
      c.foreignKey('personId', {
        references: { collection: 'personnelEmployees', fields: ['id'] },
        name: 'hrDevelopmentPlans_personId_fk',
      });
      c.string('positionId', { length: 36, nullable: true });
      c.index('positionId');
      c.foreignKey('positionId', {
        references: { collection: 'orgPositions', fields: ['id'] },
        name: 'hrDevelopmentPlans_positionId_fk',
      });
      c.index('status');
      c.index('updatedAt');
    });
    await builder.createCollection('hrWorkforcePlans', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('code', { length: 64, nullable: false });
      c.unique('code');
      c.string('name', { length: 200, nullable: false });
      c.string('status', {
        length: 32,
        nullable: false,
        defaultValue: 'active',
      });
      c.integer('revision', { nullable: false, defaultValue: 1 });
      c.integer('lifecycleVersion', { nullable: false, defaultValue: 0 });
      c.datetimeTz('statusChangedAt', { nullable: true });
      c.string('createdBy', { length: 200, nullable: false });
      c.json('data', { nullable: false });
      c.json('snapshot', { nullable: true });
      c.datetime('createdAt', { nullable: false });
      c.datetime('updatedAt', { nullable: false });
      c.integer('grade', { nullable: true });
      c.string('accountId', { length: 200, nullable: true });
      c.string('photoId', { length: 36, nullable: true });
      c.string('subjectId', { length: 36, nullable: true });
      c.index('subjectId');
      c.foreignKey('subjectId', {
        references: { collection: 'orgSubjects', fields: ['id'] },
        name: 'hrWorkforcePlans_subjectId_fk',
      });
      c.string('personId', { length: 36, nullable: true });
      c.index('personId');
      c.foreignKey('personId', {
        references: { collection: 'personnelEmployees', fields: ['id'] },
        name: 'hrWorkforcePlans_personId_fk',
      });
      c.string('positionId', { length: 36, nullable: true });
      c.index('positionId');
      c.foreignKey('positionId', {
        references: { collection: 'orgPositions', fields: ['id'] },
        name: 'hrWorkforcePlans_positionId_fk',
      });
      c.index('status');
      c.index('updatedAt');
    });
    await builder.createCollection('peopleAudit', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('kind', { length: 32, nullable: false });
      c.string('recordId', { length: 36, nullable: false });
      c.string('recordName', { length: 200, nullable: false });
      c.string('subjectId', { length: 36, nullable: true });
      c.index('subjectId');
      c.string('personId', { length: 36, nullable: true });
      c.string('operation', { length: 64, nullable: false });
      c.string('actorId', { length: 200, nullable: false });
      c.string('actorName', { length: 200, nullable: false });
      c.text('reason', { nullable: false });
      c.json('beforeValue', { nullable: true });
      c.json('afterValue', { nullable: false });
      c.datetime('createdAt', { nullable: false });
      c.index(['kind', 'recordId']);
      c.index('createdAt');
    });
    await builder.createCollection('personnelPrivate', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('subjectId', { length: 36, nullable: false });
      c.index('subjectId');
      c.string('phone', { length: 100, nullable: true });
      c.string('email', { length: 200, nullable: true });
      c.foreignKey('id', {
        references: { collection: 'personnelEmployees', fields: ['id'] },
        name: 'personnelPrivate_person_fk',
      });
    });
    await builder.createCollection('peopleFiles', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('disk', { length: 255, nullable: false });
      c.text('key', { nullable: false });
      c.text('filename', { nullable: false });
      c.string('ext', { length: 32, nullable: false });
      c.string('mimeType', { length: 255, nullable: false });
      c.bigInt('size', { nullable: false });
      c.string('ownerId', { length: 200, nullable: false, defaultValue: '' });
      c.datetime('createdAt', { nullable: false });
      c.datetime('updatedAt', { nullable: false });
    });
    await builder.createCollection('lifecycleTransitions', (c) => {
      c.increments('id');
      c.string('lifecycle', { nullable: false });
      c.string('recordId', { nullable: false });
      c.string('transition', { nullable: false });
      c.string('from', { nullable: true });
      c.string('to', { nullable: false });
      c.string('actorId', { nullable: false });
      c.json('input', { nullable: false });
      c.datetimeTz('at', { nullable: false });
      c.integer('version', { nullable: false });
      c.string('requestId', { nullable: true });
      c.string('requestKey', { nullable: false });
      c.unique(['lifecycle', 'recordId', 'version']);
      c.unique(['lifecycle', 'recordId', 'requestKey']);
      c.index(['lifecycle', 'recordId', 'id']);
    });
    await builder.createCollection('lifecycleEffectRuns', (c) => {
      c.increments('id');
      c.bigInt('transitionId', { nullable: false });
      c.string('lifecycle', { nullable: false });
      c.string('recordId', { nullable: false });
      c.string('effect', { nullable: false });
      c.boolean('stayBound', { nullable: false });
      c.string('status', { nullable: false });
      c.integer('attempts', { nullable: false, defaultValue: 0 });
      c.integer('maxAttempts', { nullable: false, defaultValue: 1 });
      c.json('result', { nullable: true });
      c.text('error', { nullable: true });
      c.datetimeTz('createdAt', { nullable: false });
      c.datetimeTz('updatedAt', { nullable: false });
      c.datetimeTz('claimedAt', { nullable: true });
      c.datetimeTz('runAfter', { nullable: true });
      c.json('continuation', { nullable: true });
      c.datetimeTz('continuationDueAt', { nullable: true });
      c.datetimeTz('continuationAbandonedAt', { nullable: true });
      c.index(['status', 'id']);
      c.index(['lifecycle', 'recordId', 'id']);
      c.index('continuationDueAt');
      c.index('continuationAbandonedAt');
    });
  },
  async down({ builder }) {
    await builder.dropCollection('lifecycleEffectRuns');
    await builder.dropCollection('lifecycleTransitions');
    await builder.dropCollection('peopleFiles');
    await builder.dropCollection('personnelPrivate');
    await builder.dropCollection('peopleAudit');
    await builder.dropCollection('hrWorkforcePlans');
    await builder.dropCollection('hrDevelopmentPlans');
    await builder.dropCollection('hrEvaluations');
    await builder.dropCollection('hrProfiles');
    await builder.dropCollection('hrModels');
    await builder.dropCollection('hrDimensions');
    await builder.dropCollection('personnelChanges');
    await builder.dropCollection('personnelAssignments');
    await builder.dropCollection('personnelEmployments');
    await builder.dropCollection('personnelEmployees');
  },
});
