import { defineSeed, type SeedContext } from '@nocobase/db';
import { encodeAuthorizationTitle } from '@nocobase/authorization/core';

export default defineSeed({
  name: '202610170004_procurement_supplier_defaults',
  transaction: true,
  async run({ repository }: Pick<SeedContext, 'repository'>) {
    await repository('supplyChainMutationLock').upsertOne({
      filter: { id: 'supplyChain' },
      create: { id: 'supplyChain', nonce: 'initial' },
      update: { id: 'supplyChain' },
    });
    // Immutable initialization snapshot; no evolving runtime resource imports.
    // Page grants are added with the page delivery, after its design is confirmed.
    for (const [key, title, actions] of [
      ['procurement-supplier-reader', '本公司供应商查看', ['read']],
      [
        'procurement-supplier-manager',
        '本公司供应商维护',
        ['read', 'create', 'updateRelationship'],
      ],
      [
        'procurement-supplier-master',
        '供应商公共身份维护',
        ['read', 'updateIdentity', 'linkIdentity'],
      ],
    ] as const) {
      if (
        await repository('authorizationPermissionSets').exists({
          filter: { key },
        })
      )
        continue;
      await repository('authorizationPermissionSets').createOne({
        values: {
          id: key,
          key,
          title: encodeAuthorizationTitle(title),
          grants: [
            {
              resource: { type: 'composite', id: 'procurement.suppliers' },
              actions: actions.map((action) => ({
                action,
                policy: {
                  type: 'composite',
                  scopes: {
                    businessPartners: 'allRecords',
                    partnerSubjectSettings: 'procurement.ownSupplierCompany',
                    supplyChainAudit:
                      action === 'updateIdentity'
                        ? 'allRecords'
                        : 'procurement.ownSupplierCompany',
                    orgSubjects: 'supplyChain.ownSubject',
                  },
                },
              })),
            },
          ],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    // No business samples or real-account assignments; preserve administrator edits.
  },
});
