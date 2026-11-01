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
  name: '202610300001_production_maintenance_plans',
  async up({ builder }) {
    await builder.createCollection('prdMaintenancePlans', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.string('subjectId', { length: 36, nullable: false });
      c.string('unitId', { length: 36, nullable: false });
      c.string('equipmentId', { length: 36, nullable: false });
      c.string('name', { length: 200, nullable: false });
      c.string('type', {
        length: 16,
        nullable: false,
        defaultValue: 'preventive',
      });
      c.integer('intervalDays', { nullable: false });
      c.date('nextDueOn', { nullable: false });
      c.text('checklist', { nullable: true });
      c.string('assigneeName', { length: 100, nullable: true });
      c.string('status', {
        length: 16,
        nullable: false,
        defaultValue: 'active',
      });
      c.date('lastCompletedOn', { nullable: true });
      c.string('lastOrderId', { length: 36, nullable: true });
      audit(c);
      c.primary('id');
      c.unique(['equipmentId', 'name']);
      c.index(['subjectId', 'nextDueOn']);
      c.index(['unitId', 'nextDueOn']);
      c.index(['equipmentId', 'status']);
      c.foreignKey('subjectId', {
        references: { collection: 'orgSubjects', fields: ['id'] },
        name: 'prdMaintenancePlans_subjectId_fk',
      });
      c.foreignKey('unitId', {
        references: { collection: 'orgUnits', fields: ['id'] },
        name: 'prdMaintenancePlans_unitId_fk',
      });
      c.foreignKey('equipmentId', {
        references: { collection: 'prdEquipment', fields: ['id'] },
        name: 'prdMaintenancePlans_equipmentId_fk',
      });
    });

    await builder.alterCollection('prdMaintenanceOrders', (c) => {
      c.string('planId', { length: 36, nullable: true });
      c.index(['planId', 'status']);
    });
  },
  async down({ builder }) {
    await builder.alterCollection('prdMaintenanceOrders', (c) => {
      c.dropField('planId');
    });
    await builder.dropCollection('prdMaintenancePlans');
  },
});
