import { defineSeed, type SeedContext } from '@nocobase/db';

type Grant = {
  resource?: { type?: string; id?: string };
  actions?: Array<{ action?: string; policy?: unknown }>;
};

export default defineSeed({
  name: '202611130003_purchase_source_submit',
  transaction: true,
  async run({ repository }: Pick<SeedContext, 'repository'>) {
    const company = 'procurement.ownRequestCompany';
    // Keep this in step with 202610180001_purchase_request_defaults. Existing
    // installations created their requester sets before unmatched-line submit
    // needed to create the governance task in the same transaction.
    const scopes = {
      purchaseRequestLines: company,
      supplyChainRequestVersions: company,
      supplyChainReviewTasks: company,
      supplyChainAudit: company,
      personnelEmployees: company,
      personnelEmployments: company,
      personnelAssignments: company,
      orgUnits: company,
      partnerSubjectSettings: company,
      materialRequests: company,
      materialRequestSources: company,
      materialAttributeTemplates: 'allRecords',
      materialSkus: 'allRecords',
      materialNames: 'allRecords',
      measureUnits: 'allRecords',
      materialUnitRules: 'allRecords',
      materialReferences: 'allRecords',
      materialTags: 'allRecords',
      materialTagLinks: 'allRecords',
      businessPartners: 'allRecords',
      orgRegions: 'allRecords',
      orgPositions: 'allRecords',
      partnerRolePolicies: 'allRecords',
      partnerRegionScopes: 'allRecords',
      partnerCompanyScopes: 'allRecords',
      purchaseRequests: 'procurement.ownRequests',
      orgSubjects: 'supplyChain.ownSubject',
    };
    for (const key of [
      'procurement-requester',
      'procurement-request-agent',
    ]) {
      const row = await repository('authorizationPermissionSets').findOne({
        filter: { key },
      });
      if (!row) continue;
      const raw = (row as { grants?: unknown }).grants;
      const grants: Grant[] = Array.isArray(raw)
        ? (raw as Grant[])
        : typeof raw === 'string'
          ? (JSON.parse(raw) as Grant[])
          : [];
      const exists = grants.some(
        (grant) =>
          grant.resource?.type === 'composite' &&
          grant.resource.id === 'procurement.requests' &&
          grant.actions?.some(
            (action) => action.action === 'requestGovernance',
          ),
      );
      if (exists) continue;
      grants.push({
        resource: { type: 'composite', id: 'procurement.requests' },
        actions: [
          {
            action: 'requestGovernance',
            policy: { type: 'composite', scopes },
          },
        ],
      });
      await repository('authorizationPermissionSets').updateOne({
        filter: { key },
        values: { grants, updatedAt: new Date() },
      });
    }
  },
});
