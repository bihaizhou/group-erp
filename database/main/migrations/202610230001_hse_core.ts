import { defineMigration } from '@nocobase/db';

const audit = (c: {
  string: (name: string, options: object) => void;
  integer: (name: string, options: object) => void;
  datetimeTz: (name: string, options: object) => void;
}) => {
  c.integer('version', { nullable: false, defaultValue: 1 });
  c.string('createdBy', { length: 200, nullable: false });
  c.string('updatedBy', { length: 200, nullable: false });
  c.datetimeTz('createdAt', { nullable: false });
  c.datetimeTz('updatedAt', { nullable: false });
};

export default defineMigration({
  name: '202610230001_hse_core',
  async up({ builder }) {
    await builder.createCollection('hseIncidents', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.string('subjectId', { length: 36, nullable: false });
      c.string('unitId', { length: 36, nullable: true });
      c.string('incidentNo', { length: 64, nullable: false });
      c.datetimeTz('occurredAt', { nullable: false });
      c.string('type', { length: 32, nullable: false });
      c.string('severity', { length: 32, nullable: false });
      c.string('location', { length: 200, nullable: false });
      c.text('description', { nullable: false });
      c.integer('injuryCount', { nullable: false, defaultValue: 0 });
      c.integer('lostDays', { nullable: false, defaultValue: 0 });
      c.integer('environmentalRelease', {
        nullable: false,
        defaultValue: 0,
      });
      c.string('status', { length: 32, nullable: false });
      c.string('investigatorId', { length: 200, nullable: true });
      c.text('rootCause', { nullable: false });
      c.text('actions', { nullable: false });
      c.string('closedBy', { length: 200, nullable: true });
      c.datetimeTz('closedAt', { nullable: true });
      audit(c);
      c.primary('id');
      c.unique(['subjectId', 'incidentNo']);
      c.index(['subjectId', 'occurredAt']);
      c.index(['subjectId', 'status', 'severity']);
      c.foreignKey(['subjectId'], {
        references: { collection: 'orgSubjects', fields: ['id'] },
        name: 'hseIncidents_subjectId_fk',
      });
      c.foreignKey(['unitId'], {
        references: { collection: 'orgUnits', fields: ['id'] },
        name: 'hseIncidents_unitId_fk',
      });
    });
    await builder.createCollection('hseHazards', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.string('subjectId', { length: 36, nullable: false });
      c.string('unitId', { length: 36, nullable: true });
      c.string('source', { length: 32, nullable: false });
      c.string('level', { length: 32, nullable: false });
      c.string('description', { length: 500, nullable: false });
      c.string('location', { length: 200, nullable: false });
      c.date('discoveredAt', { nullable: false });
      c.string('ownerId', { length: 200, nullable: true });
      c.string('ownerName', { length: 100, nullable: false });
      c.date('dueAt', { nullable: true });
      c.string('status', { length: 32, nullable: false });
      c.text('rectification', { nullable: false });
      c.string('verifiedBy', { length: 200, nullable: true });
      c.datetimeTz('verifiedAt', { nullable: true });
      c.string('closedBy', { length: 200, nullable: true });
      c.datetimeTz('closedAt', { nullable: true });
      audit(c);
      c.primary('id');
      c.index(['subjectId', 'status', 'dueAt']);
      c.index(['subjectId', 'discoveredAt']);
      c.foreignKey(['subjectId'], {
        references: { collection: 'orgSubjects', fields: ['id'] },
        name: 'hseHazards_subjectId_fk',
      });
      c.foreignKey(['unitId'], {
        references: { collection: 'orgUnits', fields: ['id'] },
        name: 'hseHazards_unitId_fk',
      });
    });
    await builder.createCollection('hseInspections', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.string('subjectId', { length: 36, nullable: false });
      c.string('unitId', { length: 36, nullable: true });
      c.string('type', { length: 32, nullable: false });
      c.date('plannedAt', { nullable: false });
      c.datetimeTz('completedAt', { nullable: true });
      c.string('inspectorId', { length: 200, nullable: true });
      c.json('checklist', { nullable: false });
      c.integer('findingsCount', { nullable: false, defaultValue: 0 });
      c.string('status', { length: 32, nullable: false });
      audit(c);
      c.primary('id');
      c.index(['subjectId', 'plannedAt']);
      c.foreignKey(['subjectId'], {
        references: { collection: 'orgSubjects', fields: ['id'] },
        name: 'hseInspections_subjectId_fk',
      });
      c.foreignKey(['unitId'], {
        references: { collection: 'orgUnits', fields: ['id'] },
        name: 'hseInspections_unitId_fk',
      });
    });
    await builder.createCollection('hseWorkPermits', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.string('subjectId', { length: 36, nullable: false });
      c.string('unitId', { length: 36, nullable: true });
      c.string('permitNo', { length: 64, nullable: false });
      c.string('type', { length: 32, nullable: false });
      c.string('workDescription', { length: 1000, nullable: false });
      c.string('location', { length: 200, nullable: false });
      c.string('contractorId', { length: 36, nullable: true });
      c.string('applicantId', { length: 200, nullable: false });
      c.datetimeTz('validFrom', { nullable: false });
      c.datetimeTz('validTo', { nullable: false });
      c.json('riskMeasures', { nullable: false });
      c.json('gasTest', { nullable: true });
      c.string('approverId', { length: 200, nullable: true });
      c.datetimeTz('approvedAt', { nullable: true });
      c.string('status', { length: 32, nullable: false });
      c.string('linkedMaintenanceOrderId', { length: 36, nullable: true });
      audit(c);
      c.primary('id');
      c.unique(['subjectId', 'permitNo']);
      c.index(['subjectId', 'status', 'validTo']);
      c.foreignKey(['subjectId'], {
        references: { collection: 'orgSubjects', fields: ['id'] },
        name: 'hseWorkPermits_subjectId_fk',
      });
      c.foreignKey(['unitId'], {
        references: { collection: 'orgUnits', fields: ['id'] },
        name: 'hseWorkPermits_unitId_fk',
      });
    });
    await builder.createCollection('hseCertificates', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.string('subjectId', { length: 36, nullable: false });
      c.string('holderType', { length: 32, nullable: false });
      c.string('holderId', { length: 200, nullable: false });
      c.string('holderName', { length: 100, nullable: false });
      c.string('certType', { length: 64, nullable: false });
      c.string('certNo', { length: 100, nullable: false });
      c.date('issuedAt', { nullable: true });
      c.date('expiresAt', { nullable: true });
      c.string('authority', { length: 200, nullable: false });
      c.string('fileId', { length: 64, nullable: true });
      c.string('status', { length: 32, nullable: false });
      audit(c);
      c.primary('id');
      c.index(['subjectId', 'expiresAt']);
      c.index(['subjectId', 'holderType', 'holderId']);
      c.foreignKey(['subjectId'], {
        references: { collection: 'orgSubjects', fields: ['id'] },
        name: 'hseCertificates_subjectId_fk',
      });
    });
    await builder.createCollection('hseTrainingRecords', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.string('subjectId', { length: 36, nullable: false });
      c.string('personId', { length: 36, nullable: false });
      c.string('courseType', { length: 32, nullable: false });
      c.string('courseName', { length: 200, nullable: false });
      c.string('completedAt', { length: 10, nullable: false });
      c.integer('score', { nullable: true });
      c.string('certificateId', { length: 36, nullable: true });
      c.string('status', { length: 32, nullable: false });
      audit(c);
      c.primary('id');
      c.index(['subjectId', 'personId', 'completedAt']);
      c.foreignKey(['subjectId'], {
        references: { collection: 'orgSubjects', fields: ['id'] },
        name: 'hseTrainingRecords_subjectId_fk',
      });
      c.foreignKey(['personId'], {
        references: { collection: 'personnelEmployees', fields: ['id'] },
        name: 'hseTrainingRecords_personId_fk',
      });
    });
    await builder.createCollection('hseActions', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.string('subjectId', { length: 36, nullable: false });
      c.string('unitId', { length: 36, nullable: true });
      c.string('sourceType', { length: 32, nullable: false });
      c.string('sourceId', { length: 36, nullable: false });
      c.string('description', { length: 500, nullable: false });
      c.string('ownerId', { length: 200, nullable: true });
      c.string('ownerName', { length: 100, nullable: false });
      c.date('dueAt', { nullable: true });
      c.string('status', { length: 32, nullable: false });
      c.datetimeTz('completedAt', { nullable: true });
      c.string('verifiedBy', { length: 200, nullable: true });
      c.datetimeTz('verifiedAt', { nullable: true });
      audit(c);
      c.primary('id');
      c.index(['subjectId', 'sourceType', 'sourceId']);
      c.index(['subjectId', 'status', 'dueAt']);
      c.foreignKey(['subjectId'], {
        references: { collection: 'orgSubjects', fields: ['id'] },
        name: 'hseActions_subjectId_fk',
      });
      c.foreignKey(['unitId'], {
        references: { collection: 'orgUnits', fields: ['id'] },
        name: 'hseActions_unitId_fk',
      });
    });
  },
  async down({ builder }) {
    for (const table of [
      'hseActions',
      'hseTrainingRecords',
      'hseCertificates',
      'hseWorkPermits',
      'hseInspections',
      'hseHazards',
      'hseIncidents',
    ])
      await builder.dropCollection(table);
  },
});
