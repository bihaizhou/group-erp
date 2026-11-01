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
  name: '202610310001_production_overtime',
  async up({ builder }) {
    await builder.createCollection('prdOvertimeRequests', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.string('subjectId', { length: 36, nullable: false });
      c.string('unitId', { length: 36, nullable: false });
      c.string('personId', { length: 36, nullable: false });
      c.string('positionId', { length: 36, nullable: false });
      c.date('businessDate', { nullable: false });
      c.string('requestNo', { length: 32, nullable: false });
      c.string('hours', { length: 25, nullable: false });
      c.string('type', { length: 16, nullable: false });
      c.text('reason', { nullable: false });
      c.string('compensation', {
        length: 16,
        nullable: false,
        defaultValue: 'none',
      });
      c.string('status', {
        length: 16,
        nullable: false,
        defaultValue: 'submitted',
      });
      c.string('approverId', { length: 36, nullable: true });
      c.string('approverName', { length: 100, nullable: true });
      c.datetimeTz('decidedAt', { nullable: true });
      c.text('rejectReason', { nullable: true });
      audit(c);
      c.primary('id');
      c.unique(['subjectId', 'requestNo']);
      c.index(['subjectId', 'businessDate']);
      c.index(['unitId', 'businessDate']);
      c.index(['personId', 'businessDate']);
      c.index(['status', 'businessDate']);
      c.foreignKey('subjectId', {
        references: { collection: 'orgSubjects', fields: ['id'] },
        name: 'prdOvertimeRequests_subjectId_fk',
      });
      c.foreignKey('unitId', {
        references: { collection: 'orgUnits', fields: ['id'] },
        name: 'prdOvertimeRequests_unitId_fk',
      });
      c.foreignKey('personId', {
        references: { collection: 'personnelEmployees', fields: ['id'] },
        name: 'prdOvertimeRequests_personId_fk',
      });
      c.foreignKey('positionId', {
        references: { collection: 'orgPositions', fields: ['id'] },
        name: 'prdOvertimeRequests_positionId_fk',
      });
    });
  },
  async down({ builder }) {
    await builder.dropCollection('prdOvertimeRequests');
  },
});
