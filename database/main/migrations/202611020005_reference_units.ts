import { defineMigration } from '@nocobase/db';

/**
 * Reference conversions keep a stock fact that cannot be weighed at issue time
 * (steel plates counted by sheet, purchased by tonne). The rule stores the mode
 * and the accepted deviation; every quantity line snapshots both so a later
 * rule change can never rewrite an existing document.
 */
export default defineMigration({
  name: '202611020005_reference_units',
  async up({ builder }) {
    await builder.alterCollection('materialUnitRules', (c) => {
      c.string('conversionMode', {
        length: 16,
        defaultValue: 'exact',
        nullable: false,
      });
      c.string('variancePercent', {
        length: 25,
        defaultValue: '3',
        nullable: false,
      });
    });
    for (const collection of [
      'purchaseOrderLines',
      'salesOrderLines',
      'stockDocumentLines',
    ])
      await builder.alterCollection(collection, (c) => {
        c.string('conversionModeSnapshot', {
          length: 16,
          defaultValue: 'exact',
          nullable: false,
        });
        c.string('variancePercentSnapshot', { length: 25, nullable: true });
      });
  },
  async down({ builder }) {
    for (const collection of [
      'purchaseOrderLines',
      'salesOrderLines',
      'stockDocumentLines',
    ])
      await builder.alterCollection(collection, (c) => {
        c.dropField('variancePercentSnapshot');
        c.dropField('conversionModeSnapshot');
      });
    await builder.alterCollection('materialUnitRules', (c) => {
      c.dropField('variancePercent');
      c.dropField('conversionMode');
    });
  },
});
