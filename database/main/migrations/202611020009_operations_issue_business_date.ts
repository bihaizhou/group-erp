import { defineMigration } from '@nocobase/db';

export default defineMigration({
  name: '202611020009_operations_issue_business_date',
  transaction: true,
  async up({ builder }) {
    await builder.alterCollection('opsIssues', (c) => {
      c.date('businessDate', { nullable: true });
    });
  },
  async down({ builder }) {
    await builder.alterCollection('opsIssues', (c) => {
      c.dropField('businessDate');
    });
  },
});
