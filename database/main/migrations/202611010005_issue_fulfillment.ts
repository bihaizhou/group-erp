import { defineMigration } from '@nocobase/db';

export default defineMigration({
  name: '202611010005_issue_fulfillment',
  async up({ builder }) {
    await builder.alterCollection('materialIssueRequests', (c) => {
      c.string('fulfillmentStatus', {
        length: 32,
        defaultValue: 'open',
        nullable: false,
      });
      c.datetimeTz('issuedAt', { nullable: true });
      c.string('issuedBy', { length: 200, nullable: true });
      c.datetimeTz('receivedAt', { nullable: true });
      c.string('receivedBy', { length: 200, nullable: true });
      c.text('receiptNote', { nullable: true });
    });
    await builder.alterCollection('stockIssueFulfillments', (c) => {
      c.string('receivedQuantity', {
        length: 25,
        defaultValue: '0',
        nullable: false,
      });
    });
  },
  async down({ builder }) {
    await builder.alterCollection('stockIssueFulfillments', (c) => {
      c.dropField('receivedQuantity');
    });
    await builder.alterCollection('materialIssueRequests', (c) => {
      c.dropField('receiptNote');
      c.dropField('receivedBy');
      c.dropField('receivedAt');
      c.dropField('issuedBy');
      c.dropField('issuedAt');
      c.dropField('fulfillmentStatus');
    });
  },
});
