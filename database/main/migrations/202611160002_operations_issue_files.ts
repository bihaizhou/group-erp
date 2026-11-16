import { defineMigration } from '@nocobase/db';

/**
 * Evidence files attached to operations issues.
 *
 * `issueId` binds a file to exactly one issue; `subjectId` is denormalised
 * from the issue so the content guard can re-check the company scope without
 * trusting the file row. There is intentionally no foreign key: a deleted
 * issue simply makes its files unreachable through the guarded download
 * route.
 */
export default defineMigration({
  name: '202611160002_operations_issue_files',
  async up({ builder }) {
    await builder.createCollection('operationsIssueFiles', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('disk', { length: 255, nullable: false });
      c.text('key', { nullable: false });
      c.text('filename', { nullable: false });
      c.string('ext', { length: 32, nullable: false });
      c.string('mimeType', { length: 255, nullable: false });
      c.bigInt('size', { nullable: false });
      c.string('ownerId', { length: 200, nullable: false, defaultValue: '' });
      c.string('issueId', { length: 36, nullable: false });
      c.string('subjectId', { length: 36, nullable: false, defaultValue: '' });
      c.datetime('createdAt', { nullable: false });
      c.datetime('updatedAt', { nullable: false });
      c.index('issueId');
      c.index('subjectId');
    });
  },
  async down({ builder }) {
    await builder.dropCollection('operationsIssueFiles');
  },
});
