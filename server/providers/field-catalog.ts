import type { DatabaseManager } from '@nocobase/db';

/**
 * Field-level permission catalogue.
 *
 * Each entry names a resource the UI can render and the collection its rows
 * come from. The field list is derived from the collection metadata at read
 * time, so a new column shows up in the permission editor without another
 * build. `labels` only adds localized titles to fields we already translate;
 * unknown fields fall back to their database name.
 */
export interface FieldCatalogResource {
  readonly resource: string;
  readonly collection: string;
  readonly titleKey: string;
  readonly descriptionKey: string;
  /** Fields that are structural rather than content, never offered. */
  readonly exclude?: readonly string[];
  /** Localized titles for known fields; other fields keep their column name. */
  readonly labels?: Readonly<Record<string, string>>;
  /** Values computed by the API rather than stored in the collection. */
  readonly computed?: readonly { field: string; titleKey: string }[];
}

export const FIELD_CATALOG_RESOURCES: readonly FieldCatalogResource[] = [
  {
    resource: 'production.report.material',
    collection: 'prdShiftReportMaterials',
    titleKey: 'production.reportOutput',
    descriptionKey: 'settings.fieldPermissionProductionReport',
    exclude: [
      'id',
      'reportId',
      'subjectId',
      'unitId',
      'skuId',
      'role',
      'stockDocumentId',
      'createdBy',
      'updatedBy',
      'createdAt',
      'updatedAt',
      'version',
    ],
    labels: {
      quantity: 'production.materialQuantity',
      stockQuantity: 'production.materialStock',
      bookQuantity: 'production.materialBook',
      note: 'production.notes',
    },
  },
  {
    resource: 'production.report.shift',
    collection: 'prdShiftReports',
    titleKey: 'production.reportShift',
    descriptionKey: 'production.reportOutputHint',
    exclude: [
      'confirmedAt',
      'confirmedBy',
      'correctionHistory',
      'createdAt',
      'createdBy',
      'enteredBy',
      'enteredByPositionId',
      'id',
      'metalQuantity',
      'processedQuantity',
      'reopenedAt',
      'reopenedBy',
      'reportDate',
      'sandQuantity',
      'shift',
      'sourceChannel',
      'status',
      'subjectId',
      'tailingsQuantity',
      'unitId',
      'updatedAt',
      'updatedBy',
      'version',
      'voidReason',
      'voidedAt',
      'voidedBy',
    ],
    labels: {
      runtimeMinutes: 'production.runtimeMinutes',
      downtimeMinutes: 'production.downtimeMinutes',
      notes: 'production.notes',
    },
  },
  {
    resource: 'production.report.attendance',
    collection: 'prdAttendanceRecords',
    titleKey: 'production.reportAttendance',
    descriptionKey: 'production.reportAttendanceHint',
    exclude: [
      'createdAt',
      'createdBy',
      'id',
      'personId',
      'positionId',
      'shift',
      'subjectId',
      'unitId',
      'updatedAt',
      'updatedBy',
      'version',
      'workDate',
    ],
    labels: {
      status: 'production.statusLabel',
      absenceReason: 'production.absenceReason',
      overtimeMinutes: 'production.overtimeHours',
      overtimeContent: 'production.overtimeContent',
    },
  },
  {
    resource: 'production.report.downtime',
    collection: 'prdDowntimeEvents',
    titleKey: 'production.reportDowntime',
    descriptionKey: 'production.reportDowntimeHint',
    exclude: [
      'closedBy',
      'createdAt',
      'createdBy',
      'durationMinutes',
      'endedAt',
      'equipmentId',
      'eventNo',
      'id',
      'reportedBy',
      'resolution',
      'status',
      'subjectId',
      'unitId',
      'updatedAt',
      'updatedBy',
      'version',
    ],
    labels: {
      startedAt: 'production.downtimeStartedAt',
      category: 'production.downtimeCategory',
      impact: 'production.downtimeImpact',
      description: 'production.downtimeDescription',
    },
  },
  {
    resource: 'production.report.maintenance',
    collection: 'prdMaintenanceOrders',
    titleKey: 'production.reportMaintenance',
    descriptionKey: 'production.reportMaintenanceHint',
    exclude: [
      'cause',
      'createdAt',
      'createdBy',
      'downtimeMinutes',
      'finishedAt',
      'id',
      'orderNo',
      'planId',
      'priority',
      'reportedAt',
      'reportedBy',
      'solution',
      'startedAt',
      'status',
      'subjectId',
      'unitId',
      'updatedAt',
      'updatedBy',
      'version',
    ],
    labels: {
      equipmentId: 'production.equipmentName',
      type: 'production.maintenanceType',
      description: 'production.faultDescription',
      assigneeName: 'production.assignee',
    },
  },
  {
    resource: 'production.report.overtime',
    collection: 'prdOvertimeRequests',
    titleKey: 'production.reportOvertime',
    descriptionKey: 'production.reportOvertimeHint',
    exclude: [
      'approverId',
      'approverName',
      'businessDate',
      'compensation',
      'createdAt',
      'createdBy',
      'decidedAt',
      'id',
      'positionId',
      'rejectReason',
      'requestNo',
      'status',
      'subjectId',
      'unitId',
      'updatedAt',
      'updatedBy',
      'version',
    ],
    labels: {
      personId: 'production.person',
      hours: 'production.overtimeHours',
      type: 'production.overtimeType',
      reason: 'production.overtimeReason',
    },
  },
  {
    resource: 'procurement.supplier.identity',
    collection: 'businessPartners',
    titleKey: 'procurement.identity',
    descriptionKey: 'settings.fieldPermissionSupplierIdentity',
    exclude: [
      'id',
      'name',
      'lifecycleVersion',
      'statusChangedAt',
      'createdBy',
      'updatedBy',
      'createdAt',
      'updatedAt',
    ],
    labels: {
      code: 'procurement.code',
      registrationCode: 'procurement.registrationCode',
      status: 'procurement.identityStatus',
    },
  },
  {
    resource: 'execution.document.line',
    collection: 'stockDocumentLines',
    titleKey: 'execution.lines',
    descriptionKey: 'settings.fieldPermissionExecutionLines',
    exclude: [
      'id',
      'documentId',
      'subjectId',
      'skuId',
      'warehouseId',
      'lineNo',
      'status',
      'baseUnitId',
      'unitId',
      'unitRuleId',
      'issueRequestId',
      'issueRequestLineId',
      'originalLineId',
      'originalDocumentId',
      'nonce',
      'transferId',
      'transferLineId',
      'purchaseOrderId',
      'purchaseOrderLineId',
      'salesOrderId',
      'salesOrderLineId',
      'sourceBalanceId',
      'returnedQuantity',
      'rejectedQuantity',
      'replenishmentRequested',
      'targetQuality',
      'condition',
      'selectionInput',
      'commercialSnapshot',
      'sourceSnapshot',
      'baseQuantity',
      'numeratorSnapshot',
      'denominatorSnapshot',
      'materialSnapshot',
      'baseRejectedQuantity',
      'conversionModeSnapshot',
      'variancePercentSnapshot',
      'createdBy',
      'updatedBy',
      'createdAt',
      'updatedAt',
      'version',
    ],
    computed: [
      { field: 'unitPrice', titleKey: 'execution.unitPrice' },
      { field: 'amount', titleKey: 'execution.amount' },
    ],
    labels: {
      quantity: 'execution.quantity',
      quality: 'execution.quality',
      notes: 'execution.notes',
    },
  },
  {
    resource: 'people.employee.contact',
    collection: 'personnelPrivate',
    titleKey: 'people.fields.phone',
    descriptionKey: 'settings.fieldPermissionPeopleContact',
    exclude: ['id', 'subjectId'],
    labels: {
      phone: 'people.fields.phone',
      email: 'people.fields.email',
    },
  },
  {
    resource: 'people.employee.grade',
    collection: 'personnelEmployees',
    titleKey: 'people.fields.grade',
    descriptionKey: 'settings.fieldPermissionPeopleGrade',
    exclude: [
      'id',
      'code',
      'name',
      'status',
      'revision',
      'lifecycleVersion',
      'statusChangedAt',
      'createdBy',
      'createdAt',
      'updatedAt',
      'data',
      'snapshot',
      'accountId',
      'photoId',
      'subjectId',
      'personId',
      'positionId',
    ],
    labels: { grade: 'people.fields.grade' },
  },
  {
    resource: 'warehouse.inventory.balance',
    collection: 'stockBalances',
    titleKey: 'execution.inventory',
    descriptionKey: 'settings.fieldPermissionInventory',
    exclude: [
      'id',
      'subjectId',
      'warehouseId',
      'skuId',
      'dimensionKey',
      'baseUnitId',
      'transferId',
      'nonce',
      'revision',
      'createdAt',
      'updatedAt',
    ],
    labels: {
      quantity: 'execution.onHand',
      reservedQuantity: 'execution.reservedQuantity',
      quality: 'execution.quality',
    },
    computed: [{ field: 'available', titleKey: 'execution.available' }],
  },
];

export interface FieldCatalogEntry {
  readonly resource: string;
  readonly titleKey: string;
  readonly descriptionKey: string;
  readonly fields: readonly {
    readonly field: string;
    readonly titleKey?: string;
    readonly label: string;
  }[];
}

const isSystemField = (name: string): boolean =>
  /^(id|createdBy|updatedBy|createdAt|updatedAt|version|revision|deletedAt)$/.test(
    name,
  );

const collectionFields = async (
  database: DatabaseManager,
  resource: FieldCatalogResource,
): Promise<{ field: string; label: string }[]> => {
  const collection = await database.collections().get(resource.collection);
  const excluded = new Set(resource.exclude ?? []);
  return (collection?.fields ?? [])
    .filter((field) => {
      const name = String(field.name);
      return !excluded.has(name) && !isSystemField(name);
    })
    .map((field) => {
      const title = (field as { title?: unknown }).title;
      return {
        field: String(field.name),
        label: typeof title === 'string' && title ? title : String(field.name),
      };
    });
};

export async function fieldCatalog(
  database: DatabaseManager,
): Promise<FieldCatalogEntry[]> {
  return Promise.all(
    FIELD_CATALOG_RESOURCES.map(async (resource) => {
      const stored = await collectionFields(database, resource);
      const fields = stored.map((field) => ({
        ...field,
        titleKey: resource.labels?.[field.field],
      }));
      for (const computed of resource.computed ?? []) {
        if (!fields.some((field) => field.field === computed.field)) {
          fields.push({
            field: computed.field,
            label: computed.field,
            titleKey: computed.titleKey,
          });
        }
      }
      return {
        resource: resource.resource,
        titleKey: resource.titleKey,
        descriptionKey: resource.descriptionKey,
        fields,
      };
    }),
  );
}

/** Field names the catalogue exposes for one resource (used by read redaction). */
export async function resourceFieldNames(
  database: DatabaseManager,
  resource: string,
): Promise<string[]> {
  const catalog = await fieldCatalog(database);
  return (
    catalog
      .find((entry) => entry.resource === resource)
      ?.fields.map((field) => field.field) ?? []
  );
}
