import { defineMigration } from '@nocobase/db';

/**
 * HSE evidence files for incidents, hazards and certificates.
 *
 * `scope` + `scopeId` bind a file to exactly one HSE record; `subjectId` is
 * denormalised from the parent record so the content guard can re-check the
 * company scope without trusting the file row. There is intentionally no
 * foreign key: the binding table is polymorphic and a deleted parent simply
 * makes the file unreachable through the guarded download route.
 */
export default defineMigration({
  name: '202611130012_hse_files',
  async up({ builder }) {
    await builder.createCollection('hseFiles', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('disk', { length: 255, nullable: false });
      c.text('key', { nullable: false });
      c.text('filename', { nullable: false });
      c.string('ext', { length: 32, nullable: false });
      c.string('mimeType', { length: 255, nullable: false });
      c.bigInt('size', { nullable: false });
      c.string('ownerId', { length: 200, nullable: false, defaultValue: '' });
      c.string('scope', { length: 16, nullable: false });
      c.string('scopeId', { length: 36, nullable: false });
      c.string('subjectId', { length: 36, nullable: false, defaultValue: '' });
      c.datetime('createdAt', { nullable: false });
      c.datetime('updatedAt', { nullable: false });
      c.index(['scope', 'scopeId']);
      c.index('subjectId');
    });
  },
  async down({ builder }) {
    await builder.dropCollection('hseFiles');
  },
});
