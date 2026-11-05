import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { DatabaseManager, DatabaseConnection } from '@nocobase/db';
import {
  MaterialService,
  type MaterialPolicies,
  type MaterialCatalogContext,
} from './material-service.js';
import { materialQuery, normalizeDecimal } from './material-model.js';
import { materialIdFilter } from './material-filters.js';
import {
  exactBaseQuantity,
  materialSelectionInput,
  referenceBaseQuantity,
  supplyChainFail as fail,
  theoreticalBaseQuantity,
  type MaterialSelectionInput,
  type SupplyChainModule,
} from './supply-chain-model.js';

const maxCompanyMaterials = 10000;
const selectionSku = z.object({
  id: z.string().uuid(),
  version: z.number().int().min(0),
  code: z.string(),
  name: z.string(),
  standardName: z.string(),
  materialNameId: z.string().uuid(),
  baseUnitId: z.string().uuid(),
  managementMode: z.enum(['stock', 'nonStock']),
  attributeValues: z.record(z.string(), z.string()),
});
const text = (value: unknown) => (typeof value === 'string' ? value : '');

export class SupplyChainMaterialService {
  constructor(
    private readonly db: DatabaseManager,
    private readonly materials: MaterialService,
  ) {}

  private repo(
    c: DatabaseConnection,
    table: string,
    policies: MaterialPolicies,
  ) {
    if (!policies[table] || policies[table].read === false)
      return fail('SUPPLY_FORBIDDEN');
    return c.repository(table).withPolicy(policies[table]);
  }

  private async company(
    c: DatabaseConnection,
    subjectId: string,
    policies: MaterialPolicies,
  ) {
    if (
      !(await this.repo(c, 'orgSubjects', policies).exists({
        filter: { id: subjectId, status: 'active' },
      }))
    )
      return fail('SUPPLY_COMPANY_UNAVAILABLE', 'subjectId');
  }

  private async context(
    c: DatabaseConnection,
    module: SupplyChainModule,
    subjectId: string,
    policies: MaterialPolicies,
    skuId?: string,
    materialNameId?: string,
  ): Promise<MaterialCatalogContext> {
    await this.company(c, subjectId, policies);
    const settings = await this.repo(
      c,
      'materialSubjectSettings',
      policies,
    ).findMany({
      filter: {
        subjectId,
        status: 'active',
        ...(module === 'procurement' ? { canPurchase: true } : {}),
        ...(module === 'sales' ? { canSell: true } : {}),
        ...(skuId ? { skuId } : {}),
      },
      limit: maxCompanyMaterials + 1,
    });
    if (settings.length > maxCompanyMaterials)
      return fail('SUPPLY_CATALOG_TOO_LARGE');
    const ids = settings.map((setting) => text(setting.skuId));
    const skus = ids.length
      ? await this.repo(c, 'materialSkus', policies).findMany({
          filter: (f) =>
            f.and([
              materialIdFilter(f, 'id', ids),
              f.string('status').eq('active'),
              ...(materialNameId
                ? [f.string('materialNameId').eq(materialNameId)]
                : []),
              ...(module !== 'procurement'
                ? [f.string('managementMode').eq('stock')]
                : []),
            ]),
          limit: maxCompanyMaterials + 1,
        })
      : [];
    const nameIds = [...new Set(skus.map((sku) => text(sku.materialNameId)))];
    const unitIds = [...new Set(skus.map((sku) => text(sku.baseUnitId)))];
    const names = nameIds.length
      ? await this.repo(c, 'materialNames', policies).findMany({
          filter: (f) =>
            f.and([
              materialIdFilter(f, 'id', nameIds),
              f.string('status').eq('active'),
            ]),
          limit: maxCompanyMaterials + 1,
        })
      : [];
    const units = unitIds.length
      ? await this.repo(c, 'measureUnits', policies).findMany({
          filter: (f) =>
            f.and([
              materialIdFilter(f, 'id', unitIds),
              f.string('status').eq('active'),
            ]),
          limit: maxCompanyMaterials + 1,
        })
      : [];
    const activeNames = new Set(names.map((name) => name.id));
    const activeUnits = new Set(units.map((unit) => unit.id));
    const available = skus.filter(
      (sku) =>
        activeNames.has(sku.materialNameId) && activeUnits.has(sku.baseUnitId),
    );
    return {
      connection: c,
      subjectId,
      skuIds: available.map((sku) => text(sku.id)),
      nameIds: [...new Set(available.map((sku) => text(sku.materialNameId)))],
    };
  }

  async options(
    module: SupplyChainModule,
    query: {
      subjectId: string;
      q?: string;
      materialNameId?: string;
      page: number;
      pageSize: number;
    },
    policies: MaterialPolicies,
  ) {
    const c = this.db.connection();
    const context = await this.context(
      c,
      module,
      query.subjectId,
      policies,
      undefined,
      query.materialNameId,
    );
    return this.materials.catalog(
      materialQuery.parse(query),
      policies,
      undefined,
      context,
    );
  }

  async detail(
    module: SupplyChainModule,
    subjectId: string,
    skuId: string,
    policies: MaterialPolicies,
  ) {
    const c = this.db.connection();
    return this.detailInTransaction(c, module, subjectId, skuId, policies);
  }

  async detailInTransaction(
    c: DatabaseConnection,
    module: SupplyChainModule,
    subjectId: string,
    skuId: string,
    policies: MaterialPolicies,
  ) {
    const context = await this.context(c, module, subjectId, policies, skuId);
    if (!context.skuIds.includes(skuId))
      return fail('SUPPLY_MATERIAL_UNAVAILABLE', 'skuId');
    return this.materials.catalog(
      materialQuery.parse({}),
      policies,
      skuId,
      context,
    );
  }

  async resolveSelection(
    module: SupplyChainModule,
    input: MaterialSelectionInput,
    policies: MaterialPolicies,
  ) {
    return this.db.transaction((c) =>
      this.resolveSelectionInTransaction(c, module, input, policies),
    );
  }

  // Future request writes call this with their connection; the returned snapshot
  // is not a reservation or a substitute for revalidation at formal submission.
  async resolveSelectionInTransaction(
    c: DatabaseConnection,
    module: SupplyChainModule,
    raw: MaterialSelectionInput,
    policies: MaterialPolicies,
  ) {
    const input = materialSelectionInput.parse(raw);
    await c.repository('orgMutationLock').updateOne({
      filter: { id: 'organization' },
      values: { nonce: randomUUID() },
    });
    await c.repository('supplyChainMutationLock').updateOne({
      filter: { id: 'supplyChain' },
      values: { nonce: randomUUID() },
    });
    await c.repository('materialMutationLock').updateOne({
      filter: { id: 'materials' },
      values: { nonce: randomUUID() },
    });
    const selection = await this.previewSelectionInTransaction(
      c,
      module,
      input,
      policies,
    );
    if (
      selection.identificationStatus === 'identified' &&
      selection.baseQuantity === null
    )
      return fail('SUPPLY_REFERENCE_QUANTITY_REQUIRED', 'baseQuantity');
    return selection;
  }

  /** Read-only preview for action availability; never mutates coordination locks. */
  async previewSelectionInTransaction(
    c: DatabaseConnection,
    module: SupplyChainModule,
    raw: MaterialSelectionInput,
    policies: MaterialPolicies,
  ) {
    const input = materialSelectionInput.parse(raw);
    await this.company(c, input.subjectId, policies);
    if (input.kind === 'unknown')
      return {
        identificationStatus: 'unidentified' as const,
        subjectId: input.subjectId,
        originalName: input.originalName,
        originalSpecification: input.originalSpecification,
        requestedUnitText: input.requestedUnitText,
        requestedQuantity: normalizeDecimal(input.quantity),
        skuId: null,
        baseQuantity: null,
      };
    const detail = await this.detailInTransaction(
      c,
      module,
      input.subjectId,
      input.skuId,
      policies,
    );
    const sku = selectionSku.parse(detail.data);
    const unit = await this.repo(c, 'measureUnits', policies).findOne({
      filter: { id: input.unitId, status: 'active' },
    });
    const base = await this.repo(c, 'measureUnits', policies).findOne({
      filter: { id: text(sku.baseUnitId), status: 'active' },
    });
    if (!unit || !base) return fail('SUPPLY_INVALID_UNIT', 'unitId');
    const rule = input.unitRuleId
      ? await this.repo(c, 'materialUnitRules', policies).findOne({
          filter: {
            id: input.unitRuleId,
            skuId: input.skuId,
            unitId: input.unitId,
            status: 'active',
          },
        })
      : null;
    if (
      (input.unitRuleId && !rule) ||
      (!rule && input.unitId !== sku.baseUnitId)
    )
      return fail('SUPPLY_INVALID_UNIT', 'unitRuleId');
    const numerator = rule ? text(rule.numerator) : '1';
    const denominator = rule ? text(rule.denominator) : '1';
    const conversionMode =
        rule && text(rule.conversionMode) === 'reference' ? 'reference' : 'exact',
      variancePercent =
        conversionMode === 'reference'
          ? text(rule?.variancePercent) || '3'
          : null;
    let baseQuantity: string | null = null,
      suggestedBaseQuantity: string | null = null;
    if (conversionMode === 'reference') {
      suggestedBaseQuantity = theoreticalBaseQuantity(
        input.quantity,
        numerator,
        denominator,
        Number(unit.precision),
        Number(base.precision),
      );
      if (input.baseQuantity)
        baseQuantity = referenceBaseQuantity(
          input.baseQuantity,
          input.quantity,
          numerator,
          denominator,
          Number(unit.precision),
          Number(base.precision),
          variancePercent,
        );
    } else {
      baseQuantity = exactBaseQuantity(
        input.quantity,
        numerator,
        denominator,
        Number(unit.precision),
        Number(base.precision),
      );
      if (
        input.baseQuantity &&
        normalizeDecimal(input.baseQuantity) !== baseQuantity
      )
        return fail('SUPPLY_BASE_QUANTITY_INVALID', 'baseQuantity');
    }
    return {
      identificationStatus: 'identified' as const,
      subjectId: input.subjectId,
      requestedQuantity: normalizeDecimal(input.quantity),
      skuId: input.skuId,
      skuRevision: sku.version,
      materialNameId: sku.materialNameId,
      managementModeSnapshot: sku.managementMode,
      unitId: input.unitId,
      unitRuleId: rule?.id ?? null,
      unitRuleRevision: rule?.revision ?? null,
      numeratorSnapshot: numerator,
      denominatorSnapshot: denominator,
      conversionMode,
      variancePercent,
      baseUnitId: sku.baseUnitId,
      baseQuantity,
      suggestedBaseQuantity,
      materialSnapshot: {
        code: sku.code,
        name: sku.name,
        standardName: sku.standardName,
        attributeValues: sku.attributeValues,
        unitName: unit.name,
        baseUnitName: base.name,
      },
    };
  }
}
