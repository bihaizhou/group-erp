import { randomUUID } from 'node:crypto';
import { defineMigration } from '@nocobase/db';

function hasRaw(
  value: unknown,
): value is { raw(sql: string): Promise<unknown[]> } {
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    'raw' in value &&
    typeof value.raw === 'function'
  );
}

export default defineMigration({
  name: '202610170002_remove_material_categories',
  // Multiple tag memberships cannot be converted back to one required category.
  // Release rollback restores the pre-migration backup, rather than losing data.
  irreversible: true,
  async up(context) {
    const { builder, query, connection } = context;
    // Knex rebuilds SQLite tables for column/constraint removal. Defer checks
    // inside this transaction while it replaces the parent of existing SKUs;
    // explicitly verify every FK before restoring immediate enforcement.
    const client =
      connection.dialect === 'sqlite' ? await connection.client() : null;
    if (connection.dialect === 'sqlite' && !hasRaw(client))
      throw new Error('SQLite migration requires the driver raw client.');
    const sqlite = hasRaw(client) ? client : null;
    if (sqlite) await sqlite.raw('PRAGMA defer_foreign_keys = ON');
    const categories = await query
      .selectFrom('materialCategories')
      .selectAll()
      .execute();
    const names = await query.selectFrom('materialNames').selectAll().execute();
    const byId = new Map(
      categories.map((category) => [String(category.id), category]),
    );
    const ancestors = new Map<string, string[]>();
    for (const category of categories) {
      const path: string[] = [];
      let current: typeof category | undefined = category;
      while (current) {
        const id = String(current.id);
        if (path.includes(id))
          throw new Error(
            'Cannot migrate a cyclic material category hierarchy.',
          );
        path.unshift(id);
        if (!current.parentId) break;
        if (typeof current.parentId !== 'string')
          throw new Error(
            'Cannot migrate an invalid material category parent.',
          );
        current = byId.get(current.parentId);
        if (!current)
          throw new Error(
            'Cannot migrate a material category with a missing parent.',
          );
      }
      ancestors.set(String(category.id), path);
    }
    for (const name of names)
      if (!ancestors.has(String(name.categoryId)))
        throw new Error(
          'Cannot migrate a material name with a missing category.',
        );

    const now = new Date();
    const tagIds = new Map(
      categories.map((category) => [String(category.id), randomUUID()]),
    );
    const tags = categories.map((category) => {
      const path = ancestors
        .get(String(category.id))!
        .map((id) => String(byId.get(id)!.name))
        .join(' / ');
      return {
        id: tagIds.get(String(category.id))!,
        code: `MIG-${randomUUID()}`.toUpperCase(),
        name: path.length <= 200 ? path : String(category.name),
        notes:
          path.length > 200
            ? `${path}\n${String(category.notes)}`.slice(0, 6000)
            : String(category.notes),
        status: category.status,
        revision: category.revision,
        lifecycleVersion: 0,
        statusChangedAt: now,
        createdBy: category.createdBy,
        createdAt: category.createdAt,
        updatedAt: now,
        appliesTo: 'both',
      };
    });
    const links = names.flatMap((name) =>
      ancestors.get(String(name.categoryId))!.map((categoryId) => ({
        id: randomUUID(),
        code: `MIG-${randomUUID()}`.toUpperCase(),
        name: String(name.name),
        notes: '',
        status: 'active',
        revision: 1,
        lifecycleVersion: 0,
        statusChangedAt: now,
        createdBy: 'system',
        createdAt: now,
        updatedAt: now,
        tagId: tagIds.get(categoryId)!,
        targetKind: 'names',
        targetId: name.id,
      })),
    );
    for (let offset = 0; offset < tags.length; offset += 50)
      await query
        .insertInto('materialTags')
        .values(tags.slice(offset, offset + 50))
        .execute();
    for (let offset = 0; offset < links.length; offset += 50)
      await query
        .insertInto('materialTagLinks')
        .values(links.slice(offset, offset + 50))
        .execute();

    // Repository is needed only for portable JSON/temporal encoding of audit
    // snapshots. Business-table backfills above use the migration's query.
    const audits = [
      ...tags.map((tag, index) => ({
        id: randomUUID(),
        kind: 'tags',
        recordId: tag.id,
        recordName: tag.name,
        subjectId: null,
        actorId: 'system',
        actorName: 'system',
        operation: 'create',
        reason: 'categoryMigration',
        beforeValue: categories[index],
        afterValue: tag,
        createdAt: now,
      })),
      ...names.map((name) => ({
        id: randomUUID(),
        kind: 'names',
        recordId: String(name.id),
        recordName: String(name.name),
        subjectId: null,
        actorId: 'system',
        actorName: 'system',
        operation: 'update',
        reason: 'categoryMigration',
        beforeValue: name,
        afterValue: Object.fromEntries(
          Object.entries(name).filter(([key]) => key !== 'categoryId'),
        ),
        createdAt: now,
      })),
    ];
    for (let offset = 0; offset < audits.length; offset += 50) {
      const [first, ...rest] = audits.slice(offset, offset + 50);
      if (first)
        await context.repository('materialAudit').createMany({
          values: [first, ...rest],
        });
    }

    // Drop the index before the column: SQLite removes that index along with
    // its column, so combining both in one alter would try to drop it twice.
    await builder.dropIndex('materialNames', 'idx_material_names_category_id');
    await builder.dropConstraint(
      'materialNames',
      'materialNames_categoryId_fk',
    );
    await builder.alterCollection('materialNames', (c) => {
      c.dropField('categoryId');
    });
    await builder.dropCollection('materialCategories');
    if (sqlite) {
      const violations = await sqlite.raw('PRAGMA foreign_key_check');
      if (violations.length)
        throw new Error('Material category removal violated a foreign key.');
      await sqlite.raw('PRAGMA defer_foreign_keys = OFF');
    }
  },
});
