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
  name: '202610290001_production_equipment',
  async up({ builder }) {
    await builder.createCollection('prdEquipment', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.string('subjectId', { length: 36, nullable: false });
      c.string('unitId', { length: 36, nullable: false });
      c.string('code', { length: 64, nullable: false });
      c.string('name', { length: 200, nullable: false });
      c.string('category', { length: 64, nullable: true });
      c.string('criticality', {
        length: 16,
        nullable: false,
        defaultValue: 'normal',
      });
      c.string('status', {
        length: 16,
        nullable: false,
        defaultValue: 'active',
      });
      c.string('location', { length: 200, nullable: true });
      c.date('commissionedOn', { nullable: true });
      c.text('notes', { nullable: true });
      audit(c);
      c.primary('id');
      c.unique(['subjectId', 'code']);
      c.index(['subjectId', 'unitId']);
      c.index('status');
      c.foreignKey('subjectId', {
        references: { collection: 'orgSubjects', fields: ['id'] },
        name: 'prdEquipment_subjectId_fk',
      });
      c.foreignKey('unitId', {
        references: { collection: 'orgUnits', fields: ['id'] },
        name: 'prdEquipment_unitId_fk',
      });
    });

    await builder.createCollection('prdMaintenanceOrders', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.string('subjectId', { length: 36, nullable: false });
      c.string('unitId', { length: 36, nullable: false });
      c.string('equipmentId', { length: 36, nullable: false });
      c.string('orderNo', { length: 64, nullable: false });
      c.string('type', {
        length: 16,
        nullable: false,
        defaultValue: 'repair',
      });
      c.string('priority', {
        length: 16,
        nullable: false,
        defaultValue: 'normal',
      });
      c.string('status', {
        length: 16,
        nullable: false,
        defaultValue: 'reported',
      });
      c.string('reportedBy', { length: 200, nullable: false });
      c.datetimeTz('reportedAt', { nullable: false });
      c.string('assigneeName', { length: 100, nullable: true });
      c.text('description', { nullable: false });
      c.text('cause', { nullable: true });
      c.text('solution', { nullable: true });
      c.datetimeTz('startedAt', { nullable: true });
      c.datetimeTz('finishedAt', { nullable: true });
      c.integer('downtimeMinutes', { nullable: false, defaultValue: 0 });
      audit(c);
      c.primary('id');
      c.unique(['subjectId', 'orderNo']);
      c.index(['subjectId', 'unitId', 'status']);
      c.index(['equipmentId', 'status']);
      c.foreignKey('subjectId', {
        references: { collection: 'orgSubjects', fields: ['id'] },
        name: 'prdMaintenanceOrders_subjectId_fk',
      });
      c.foreignKey('unitId', {
        references: { collection: 'orgUnits', fields: ['id'] },
        name: 'prdMaintenanceOrders_unitId_fk',
      });
      c.foreignKey('equipmentId', {
        references: { collection: 'prdEquipment', fields: ['id'] },
        name: 'prdMaintenanceOrders_equipmentId_fk',
      });
    });
  },
  async down({ builder }) {
    await builder.dropCollection('prdMaintenanceOrders');
    await builder.dropCollection('prdEquipment');
  },
});
