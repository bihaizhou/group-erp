import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import {
  fixture,
  purchaseMaterial,
  send,
  mutation,
} from './purchase-requests.js';
import {
  executionResources,
  inventoryResource,
  customerResource,
  executionCompanyCollections,
} from '../../server/providers/execution-resources.js';
export const executionFixture = async (...args: Parameters<typeof fixture>) => {
  const f = await fixture(...args),
    m = await purchaseMaterial(f, args[1]),
    warehouse = await f.create('/materials/warehouses', {
      name: 'Actual isolated order warehouse',
      subjectId: f.a.id,
    }),
    supplier = await f.create('/procurement/suppliers', {
      subjectId: f.a.id,
      code: `P-${randomUUID()}`,
      name: 'Shared counterparty identity',
      notes: 'Supplier notes',
      requestKey: randomUUID(),
    });
  const grant = async (
    userId: string,
    resource: string,
    actions: string[],
    companyIds = [String(f.a.id)],
  ) => {
    const definition = [
      ...executionResources,
      inventoryResource,
      customerResource,
    ].find((item) => item.name === resource)!;
    const scopes = (action: string) =>
      Object.fromEntries(
        (
          definition.actions.find((item) => item.name === action)?.dataScopes ??
          []
        ).map(({ key }) => [
          key,
          executionCompanyCollections.includes(key)
            ? {
                type: 'recordAccess',
                key: 'execution.companies',
                params: { subjectIds: companyIds },
              }
            : 'allRecords',
        ]),
      );
    const role = await f.authz.permissionSets.create({
      key: randomUUID(),
      title: 'Isolated quantity order grant',
      grants: [
        {
          resource: { type: 'composite', id: resource },
          actions: actions.map((action) => ({
            action,
            policy: { type: 'composite', scopes: scopes(action) },
          })),
        },
      ],
    });
    await f.authz.permissionSets.assign({
      permissionSet: role.key,
      subject: { type: 'user', id: userId },
    });
    return role;
  };
  const line = (quantity = '10') => ({
    id: randomUUID(),
    selection: {
      kind: 'known' as const,
      subjectId: String(f.a.id),
      skuId: m.sku.id,
      unitId: String(m.each.id),
      quantity,
    },
    notes: '',
    unitPrice: null as string | null,
    allocations: [] as {
      requestId: string;
      requestLineId: string;
      requestVersionId: string;
      baseQuantity: string;
    }[],
  });
  const content = (quantity = '10') => ({
    subjectId: String(f.a.id),
    warehouseId: String(warehouse.id),
    partnerId: String(supplier.partnerId),
    occurredOn: '2026-10-19',
    currency: 'CNY',
    deliveryOn: null,
    deliveryTerms: 'Partial delivery allowed',
    notes: 'Quantity verification',
    reason: '',
    demandMode: 'temporary',
    temporaryReason: 'Test fixture: no purchase request covers this demand.',
    lines: [line(quantity)],
  });
  const rules = async (
    kind: import('../../server/providers/execution-workflow.js').ExecutionKind,
    ids = [f.reviewer.user.id],
    version = 0,
  ) => {
    const result = await send(
      f.admin,
      '/warehouse/settings',
      {
        subjectId: f.a.id,
        kind,
        version,
        requestKey: randomUUID(),
        values: {
          reviewerSelections: ids.map((id, index) => ({
            type: 'user',
            referenceId: id,
            group: index + 1,
          })),
        },
      },
      'PUT',
    );
    expect(result.status).toBe(200);
    return (await result.json()).data;
  };
  const fire = async (
    base: string,
    row: { id: string; revision: number; lifecycleVersion: number },
    action: string,
    session = f.applicant.session,
  ) => {
    const result = await send(
      session,
      `${base}/${row.id}/${action}`,
      mutation(row),
    );
    expect(result.status).toBe(200);
    return (await result.json()).data;
  };
  return {
    ...f,
    m,
    warehouse,
    supplier,
    grant,
    line,
    orderContent: content,
    orderRules: rules,
    orderFire: fire,
  };
};
