import { randomUUID } from 'node:crypto';
import { defineMigration } from '@nocobase/db';

export default defineMigration({
  name: '202610170004_partner_applicability',
  async up({ builder, query }) {
    await builder.createCollection('partnerRolePolicies', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('partnerId', { length: 36, nullable: false });
      c.foreignKey('partnerId', {
        references: { collection: 'businessPartners', fields: ['id'] },
        name: 'partnerRolePolicies_partner_fk',
      });
      c.string('partnerRole', { length: 32, nullable: false });
      c.unique(['partnerId', 'partnerRole']);
      c.string('scopeMode', { length: 16, nullable: false });
      c.string('status', { length: 32, nullable: false });
      c.integer('revision', { nullable: false, defaultValue: 1 });
      c.integer('lifecycleVersion', { nullable: false, defaultValue: 0 });
      c.datetimeTz('statusChangedAt', { nullable: true });
      c.string('createdBy', { length: 200, nullable: false });
      c.datetimeTz('createdAt', { nullable: false });
      c.datetimeTz('updatedAt', { nullable: false });
      c.index(['partnerRole', 'scopeMode', 'status']);
    });
    await builder.createCollection('partnerRegionScopes', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('policyId', { length: 36, nullable: false });
      c.foreignKey('policyId', {
        references: { collection: 'partnerRolePolicies', fields: ['id'] },
        name: 'partnerRegionScopes_policy_fk',
      });
      c.string('regionId', { length: 36, nullable: false });
      c.foreignKey('regionId', {
        references: { collection: 'orgRegions', fields: ['id'] },
        name: 'partnerRegionScopes_region_fk',
      });
      c.unique(['policyId', 'regionId']);
      c.index('regionId');
    });
    await builder.createCollection('partnerCompanyScopes', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('policyId', { length: 36, nullable: false });
      c.foreignKey('policyId', {
        references: { collection: 'partnerRolePolicies', fields: ['id'] },
        name: 'partnerCompanyScopes_policy_fk',
      });
      c.string('subjectId', { length: 36, nullable: false });
      c.foreignKey('subjectId', {
        references: { collection: 'orgSubjects', fields: ['id'] },
        name: 'partnerCompanyScopes_subject_fk',
      });
      c.unique(['policyId', 'subjectId']);
      c.index('subjectId');
    });
    // Existing explicit use remains explicit, including local inactive overrides.
    // Do not turn old company relationships into an all-company grant.
    const partners = await query
      .selectFrom('businessPartners')
      .selectAll()
      .execute();
    for (const partner of partners) {
      const settings = await query
        .selectFrom('partnerSubjectSettings')
        .selectAll()
        .where('partnerId', '=', partner.id)
        .execute();
      for (const role of [
        ...new Set(settings.map((s) => String(s.partnerRole))),
      ]) {
        const id = randomUUID(),
          now = new Date();
        await query
          .insertInto('partnerRolePolicies')
          .values({
            id,
            partnerId: partner.id,
            partnerRole: role,
            scopeMode: 'selected',
            status: 'active',
            revision: 1,
            lifecycleVersion: 0,
            statusChangedAt: now,
            createdBy: partner.createdBy,
            createdAt: now,
            updatedAt: now,
          })
          .execute();
        for (const subjectId of [
          ...new Set(
            settings
              .filter((s) => s.partnerRole === role)
              .map((s) => String(s.subjectId)),
          ),
        ]) {
          await query
            .insertInto('partnerCompanyScopes')
            .values({ id: randomUUID(), policyId: id, subjectId })
            .execute();
        }
      }
    }
  },
  async down({ builder }) {
    await builder.dropCollection('partnerCompanyScopes');
    await builder.dropCollection('partnerRegionScopes');
    await builder.dropCollection('partnerRolePolicies');
  },
});
