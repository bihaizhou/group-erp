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
  name: '202610240002_production_setup',
  async up({ builder }) {
    await builder.createCollection('prdUnitProfiles', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.string('subjectId', { length: 36, nullable: false });
      c.string('unitId', { length: 36, nullable: false });
      c.string('lineCode', { length: 64, nullable: true });
      c.string('processType', { length: 64, nullable: true });
      c.integer('designCapacityTpd', { nullable: true });
      c.date('commissionDate', { nullable: true });
      c.string('region', { length: 100, nullable: true });
      c.string('gatewayKey', { length: 100, nullable: true });
      c.string('fuxaPageKey', { length: 200, nullable: true });
      c.string('status', {
        length: 16,
        nullable: false,
        defaultValue: 'active',
      });
      audit(c);
      c.primary('id');
      c.unique('unitId');
      c.index('subjectId');
      c.index('status');
      c.foreignKey('subjectId', {
        references: { collection: 'orgSubjects', fields: ['id'] },
        name: 'prdUnitProfiles_subjectId_fk',
      });
      c.foreignKey('unitId', {
        references: { collection: 'orgUnits', fields: ['id'] },
        name: 'prdUnitProfiles_unitId_fk',
      });
    });

    await builder.createCollection('prdOutputMappings', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.string('subjectId', { length: 36, nullable: false });
      c.string('unitId', { length: 36, nullable: false });
      c.string('outputType', { length: 16, nullable: false });
      c.string('skuId', { length: 36, nullable: false });
      c.string('defaultWarehouseId', { length: 36, nullable: true });
      c.text('notes', { nullable: true });
      c.string('status', {
        length: 16,
        nullable: false,
        defaultValue: 'active',
      });
      audit(c);
      c.primary('id');
      c.unique(['unitId', 'outputType']);
      c.index('subjectId');
      c.index('skuId');
      c.index('defaultWarehouseId');
      c.foreignKey('subjectId', {
        references: { collection: 'orgSubjects', fields: ['id'] },
        name: 'prdOutputMappings_subjectId_fk',
      });
      c.foreignKey('unitId', {
        references: { collection: 'orgUnits', fields: ['id'] },
        name: 'prdOutputMappings_unitId_fk',
      });
      c.foreignKey('skuId', {
        references: { collection: 'materialSkus', fields: ['id'] },
        name: 'prdOutputMappings_skuId_fk',
      });
      c.foreignKey('defaultWarehouseId', {
        references: { collection: 'warehouses', fields: ['id'] },
        name: 'prdOutputMappings_defaultWarehouseId_fk',
      });
    });
  },
  async down({ builder }) {
    await builder.dropCollection('prdOutputMappings');
    await builder.dropCollection('prdUnitProfiles');
  },
});
