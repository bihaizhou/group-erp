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
  name: '202610240001_production_attendance',
  async up({ builder }) {
    await builder.alterCollection('orgPositions', (c) => {
      c.string('productionRole', {
        length: 16,
        nullable: false,
        defaultValue: 'support',
      });
      c.index('productionRole');
    });
    await builder.createCollection('prdAttendanceRecords', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.string('subjectId', { length: 36, nullable: false });
      c.string('unitId', { length: 36, nullable: false });
      c.string('personId', { length: 36, nullable: false });
      c.string('positionId', { length: 36, nullable: false });
      c.date('workDate', { nullable: false });
      c.string('shift', { length: 16, nullable: false });
      c.string('status', { length: 16, nullable: false });
      c.string('absenceReason', { length: 200, nullable: true });
      c.integer('overtimeMinutes', { nullable: false, defaultValue: 0 });
      c.text('overtimeContent', { nullable: true });
      audit(c);
      c.primary('id');
      c.unique(['personId', 'workDate', 'shift']);
      c.index(['subjectId', 'workDate', 'shift']);
      c.index(['unitId', 'workDate', 'shift']);
      c.index('personId');
      c.foreignKey(['subjectId'], {
        references: { collection: 'orgSubjects', fields: ['id'] },
        name: 'prdAttendanceRecords_subjectId_fk',
      });
      c.foreignKey(['unitId'], {
        references: { collection: 'orgUnits', fields: ['id'] },
        name: 'prdAttendanceRecords_unitId_fk',
      });
      c.foreignKey(['personId'], {
        references: { collection: 'personnelEmployees', fields: ['id'] },
        name: 'prdAttendanceRecords_personId_fk',
      });
      c.foreignKey(['positionId'], {
        references: { collection: 'orgPositions', fields: ['id'] },
        name: 'prdAttendanceRecords_positionId_fk',
      });
    });
  },
  async down({ builder }) {
    await builder.dropCollection('prdAttendanceRecords');
    await builder.alterCollection('orgPositions', (c) => {
      c.dropField('productionRole');
    });
  },
});
