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
  name: '202610310002_production_downtime',
  async up({ builder }) {
    await builder.createCollection('prdDowntimeEvents', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.string('subjectId', { length: 36, nullable: false });
      c.string('unitId', { length: 36, nullable: false });
      c.string('equipmentId', { length: 36, nullable: true });
      c.string('eventNo', { length: 64, nullable: false });
      c.datetimeTz('startedAt', { nullable: false });
      c.datetimeTz('endedAt', { nullable: true });
      c.integer('durationMinutes', { nullable: false, defaultValue: 0 });
      c.string('category', {
        length: 24,
        nullable: false,
        defaultValue: 'other',
      });
      c.string('impact', {
        length: 16,
        nullable: false,
        defaultValue: 'stop',
      });
      c.string('status', {
        length: 16,
        nullable: false,
        defaultValue: 'open',
      });
      c.text('description', { nullable: false });
      c.text('resolution', { nullable: true });
      c.string('reportedBy', { length: 200, nullable: false });
      c.string('closedBy', { length: 200, nullable: true });
      audit(c);
      c.primary('id');
      c.unique(['subjectId', 'eventNo']);
      c.index(['subjectId', 'startedAt']);
      c.index(['unitId', 'startedAt']);
      c.index('status');
      c.foreignKey('subjectId', {
        references: { collection: 'orgSubjects', fields: ['id'] },
        name: 'prdDowntimeEvents_subjectId_fk',
      });
      c.foreignKey('unitId', {
        references: { collection: 'orgUnits', fields: ['id'] },
        name: 'prdDowntimeEvents_unitId_fk',
      });
      c.foreignKey('equipmentId', {
        references: { collection: 'prdEquipment', fields: ['id'] },
        name: 'prdDowntimeEvents_equipmentId_fk',
      });
    });
  },
  async down({ builder }) {
    await builder.dropCollection('prdDowntimeEvents');
  },
});
