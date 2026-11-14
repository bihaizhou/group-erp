import { defineMigration } from '@nocobase/db';

/**
 * Trace a hazard back to the inspection or report that produced it.
 *
 * `sourceRef` holds the inspection number / report document number typed by
 * the reporter; `inspectorId` is the employee who found it. Both are optional
 * so historical rows stay valid, but `source === 'inspection'` requires a
 * reference at the service layer.
 */
export default defineMigration({
  name: '202611130013_hse_hazard_source_refs',
  transaction: true,
  async up({ builder }) {
    await builder.alterCollection('hseHazards', (c) => {
      c.string('sourceRef', { length: 64, nullable: true });
      c.string('inspectorId', { length: 36, nullable: true });
      c.index('sourceRef');
    });
  },
  async down({ builder }) {
    await builder.alterCollection('hseHazards', (c) => {
      c.dropField('sourceRef');
      c.dropField('inspectorId');
    });
  },
});
