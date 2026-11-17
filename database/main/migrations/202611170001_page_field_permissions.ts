import { defineMigration } from '@nocobase/db';

/**
 * Per-page field permissions (the merged model replacing "resource-level field
 * policies + page display visibility"): each page row now also records whether
 * the field is writable on that page. Three states live on one row:
 *   visible=false            -> 不显示 (hidden on the page and redacted server-side)
 *   visible=true, writable=false -> 只读 (rendered, writes rejected server-side)
 *   visible=true, writable=true  -> 可编辑
 * Existing rows only carried display visibility: fields that stayed visible
 * were editable up to the resource-level policy, so they migrate to
 * writable=true; hidden fields migrate to writable=false.
 */
export default defineMigration({
  name: '202611170001_page_field_permissions',
  async up({ builder }) {
    await builder.alterCollection('appPageFieldVisibilities', (c) => {
      c.boolean('writable', { nullable: false, defaultValue: true });
    });
  },
  async down({ builder }) {
    await builder.alterCollection('appPageFieldVisibilities', (c) => {
      c.dropField('writable');
    });
  },
});
