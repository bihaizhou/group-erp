import { randomUUID } from 'node:crypto';
import { defineSeed, type SeedContext } from '@nocobase/db';

/**
 * Field-level defaults: a shift lead records quantities and the physical stock
 * count, while the book quantity stays a management figure. Administrators can
 * change these rows afterwards; this seed only installs the baseline.
 */
const POLICIES = [
  {
    permissionSetKey: 'production-lead',
    settingsId: 'production',
    resource: 'production.report.material',
    field: 'bookQuantity',
    access: 'hidden',
  },
  {
    permissionSetKey: 'company-personnel-reader',
    settingsId: 'personnel.sensitive',
    resource: 'people.employee.contact',
    field: 'phone',
    access: 'hidden',
  },
  {
    permissionSetKey: 'company-personnel-reader',
    settingsId: null,
    resource: 'people.employee.grade',
    field: 'grade',
    access: 'hidden',
  },
  {
    permissionSetKey: 'warehouse-stock-reader',
    settingsId: null,
    resource: 'warehouse.inventory.balance',
    field: 'reservedQuantity',
    access: 'hidden',
  },
] as const;

export default defineSeed({
  name: '202611110001_field_policies',
  transaction: true,
  async run({ repository }: Pick<SeedContext, 'repository'>) {
    for (const policy of POLICIES) {
      const existing = await repository('appFieldPolicies').findOne({
        filter: {
          permissionSetKey: policy.permissionSetKey,
          resource: policy.resource,
          field: policy.field,
        },
      });
      if (existing) continue;
      await repository('appFieldPolicies').createOne({
        values: {
          id: randomUUID(),
          ...policy,
          version: 1,
          createdBy: 'system',
          updatedBy: 'system',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
  },
});
