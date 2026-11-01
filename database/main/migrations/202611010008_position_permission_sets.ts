import { defineMigration } from '@nocobase/db';

export default defineMigration({
  name: '202611010008_position_permission_sets',
  async up({ builder }) {
    await builder.createCollection('orgPositionPermissionSets', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('positionId', { length: 36, nullable: false });
      c.string('permissionSetKey', { length: 64, nullable: false });
      c.datetime('createdAt', { nullable: false });
      c.datetime('updatedAt', { nullable: false });
      c.unique(['positionId', 'permissionSetKey']);
      c.foreignKey('positionId', {
        references: { collection: 'orgPositions', fields: ['id'] },
        name: 'orgPositionPermissionSets_positionId_fk',
      });
      c.index('positionId');
      c.index('permissionSetKey');
    });
  },
  async down({ builder }) {
    await builder.dropCollection('orgPositionPermissionSets');
  },
});
