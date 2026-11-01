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
  name: '202610280001_production_schedules',
  async up({ builder }) {
    await builder.createCollection('prdSchedules', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.string('subjectId', { length: 36, nullable: false });
      c.string('unitId', { length: 36, nullable: false });
      c.date('scheduleDate', { nullable: false });
      c.string('shift', { length: 16, nullable: false });
      c.string('status', {
        length: 16,
        nullable: false,
        defaultValue: 'draft',
      });
      c.text('notes', { nullable: true });
      c.string('publishedBy', { length: 200, nullable: true });
      c.datetimeTz('publishedAt', { nullable: true });
      audit(c);
      c.primary('id');
      c.unique(['unitId', 'scheduleDate', 'shift']);
      c.index(['subjectId', 'scheduleDate']);
      c.index(['unitId', 'scheduleDate']);
      c.foreignKey(['subjectId'], {
        references: { collection: 'orgSubjects', fields: ['id'] },
        name: 'prdSchedules_subjectId_fk',
      });
      c.foreignKey(['unitId'], {
        references: { collection: 'orgUnits', fields: ['id'] },
        name: 'prdSchedules_unitId_fk',
      });
    });
    await builder.createCollection('prdScheduleAssignments', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.string('scheduleId', { length: 36, nullable: false });
      c.string('subjectId', { length: 36, nullable: false });
      c.string('unitId', { length: 36, nullable: false });
      c.string('personId', { length: 36, nullable: false });
      c.string('positionId', { length: 36, nullable: false });
      c.string('createdBy', { length: 200, nullable: false });
      c.datetimeTz('createdAt', { nullable: false });
      c.primary('id');
      c.unique(['scheduleId', 'personId']);
      c.index('scheduleId');
      c.index('personId');
      c.index(['unitId', 'createdAt']);
      c.foreignKey(['scheduleId'], {
        references: { collection: 'prdSchedules', fields: ['id'] },
        name: 'prdScheduleAssignments_scheduleId_fk',
      });
      c.foreignKey(['subjectId'], {
        references: { collection: 'orgSubjects', fields: ['id'] },
        name: 'prdScheduleAssignments_subjectId_fk',
      });
      c.foreignKey(['unitId'], {
        references: { collection: 'orgUnits', fields: ['id'] },
        name: 'prdScheduleAssignments_unitId_fk',
      });
      c.foreignKey(['personId'], {
        references: { collection: 'personnelEmployees', fields: ['id'] },
        name: 'prdScheduleAssignments_personId_fk',
      });
      c.foreignKey(['positionId'], {
        references: { collection: 'orgPositions', fields: ['id'] },
        name: 'prdScheduleAssignments_positionId_fk',
      });
    });
  },
  async down({ builder }) {
    await builder.dropCollection('prdScheduleAssignments');
    await builder.dropCollection('prdSchedules');
  },
});
