import { defineMigration } from '@nocobase/db';

export default defineMigration({
  name: '202611010002_hse_lifecycle',
  async up({ builder }) {
    await builder.alterCollection('hseIncidents', (c) => {
      c.json('history', { nullable: true });
    });
    await builder.alterCollection('hseHazards', (c) => {
      c.json('history', { nullable: true });
      c.string('rectifiedBy', { length: 200, nullable: true });
      c.datetimeTz('rectifiedAt', { nullable: true });
    });
    await builder.alterCollection('hseCertificates', (c) => {
      c.json('history', { nullable: true });
      c.string('revokedBy', { length: 200, nullable: true });
      c.datetimeTz('revokedAt', { nullable: true });
      c.text('revokedReason', { nullable: true });
    });
  },
  async down({ builder }) {
    await builder.alterCollection('hseCertificates', (c) => {
      c.dropField('revokedReason');
      c.dropField('revokedAt');
      c.dropField('revokedBy');
      c.dropField('history');
    });
    await builder.alterCollection('hseHazards', (c) => {
      c.dropField('rectifiedAt');
      c.dropField('rectifiedBy');
      c.dropField('history');
    });
    await builder.alterCollection('hseIncidents', (c) => {
      c.dropField('history');
    });
  },
});
