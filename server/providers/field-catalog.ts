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
  readonly collection?: string;
  readonly titleKey: string;
  readonly descriptionKey: string;
  /** Fields that are structural rather than content, never offered. */
  readonly exclude?: readonly string[];
  /**
   * Curated fields, offered first in this order. Other collection fields
   * that have a UI title (new content fields added later) are appended
   * automatically, so the permission editor stays in sync with the page.
   */
  readonly only?: readonly string[];
  /** Fields for pages without a backing collection (dashboards, settings). */
  readonly manual?: readonly { field: string; titleKey: string }[];
  /** Localized titles for known fields; other fields keep their column name. */
  readonly labels?: Readonly<Record<string, string>>;
  /** Values computed by the API rather than stored in the collection. */
  readonly computed?: readonly { field: string; titleKey: string }[];
  /**
   * Fields the page renders but users can never edit directly (workflow
   * status, auto numbers, snapshots, audit data). The permission editor
   * greys out the write option for these fields.
   */
  readonly readonlyFields?: readonly string[];
  /**
   * Whether manual fields are writable; dashboards and audit pages set this
   * to false so every offered field drops the write option.
   */
  readonly manualWritable?: boolean;
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
    readonlyFields: ['status'],
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
    readonlyFields: ['reservedQuantity'],
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
  // ---- complete page catalogue: every page offers field permissions ----
  {
    resource: 'production.overview',
    titleKey: 'dashboard.production.title',
    manualWritable: false,
    descriptionKey: 'fieldPermission.description',
    manual: [
      {
        field: 'processed',
        titleKey: 'dashboard.production.metrics.processed',
      },
      { field: 'reports', titleKey: 'dashboard.production.metrics.reports' },
      {
        field: 'confirmed',
        titleKey: 'dashboard.production.metrics.confirmed',
      },
      { field: 'runtime', titleKey: 'dashboard.production.metrics.runtime' },
    ],
  },
  {
    resource: 'production.schedule',
    collection: 'prdSchedules',
    readonlyFields: ['status'],
    titleKey: 'production.scheduleTitle',
    descriptionKey: 'fieldPermission.description',
    only: ['scheduleDate', 'shift', 'status', 'notes'],
    labels: {
      scheduleDate: 'fieldCatalog.date',
      shift: 'production.shift',
      status: 'production.statusLabel',
      notes: 'production.notes',
    },
  },
  {
    resource: 'production.shiftReport',
    collection: 'prdShiftReports',
    readonlyFields: ['status'],
    titleKey: 'production.shiftReports',
    descriptionKey: 'fieldPermission.description',
    only: [
      'reportDate',
      'shift',
      'status',
      'processedQuantity',
      'metalQuantity',
      'sandQuantity',
      'tailingsQuantity',
      'runtimeMinutes',
      'downtimeMinutes',
      'notes',
    ],
    labels: {
      reportDate: 'production.reportDate',
      shift: 'production.shift',
      status: 'production.statusLabel',
      processedQuantity: 'production.processedQuantity',
      metalQuantity: 'production.metalQuantity',
      sandQuantity: 'production.sandQuantity',
      tailingsQuantity: 'production.tailingsQuantity',
      runtimeMinutes: 'production.runtimeMinutes',
      downtimeMinutes: 'production.downtimeMinutes',
      notes: 'production.notes',
    },
  },
  {
    resource: 'production.equipment',
    collection: 'prdEquipment',
    readonlyFields: ['status'],
    titleKey: 'production.equipment',
    descriptionKey: 'fieldPermission.description',
    only: [
      'code',
      'name',
      'category',
      'criticality',
      'status',
      'location',
      'commissionedOn',
      'notes',
    ],
    labels: {
      code: 'production.equipmentCode',
      name: 'production.equipmentName',
      category: 'production.category',
      criticality: 'production.criticality',
      status: 'production.equipmentStatus',
      location: 'fieldCatalog.location',
      commissionedOn: 'fieldCatalog.commissionedOn',
      notes: 'production.notes',
    },
  },
  {
    resource: 'production.plan',
    collection: 'prdMaintenancePlans',
    readonlyFields: ['status'],
    titleKey: 'production.maintenancePlans',
    descriptionKey: 'fieldPermission.description',
    only: [
      'name',
      'type',
      'intervalDays',
      'nextDueOn',
      'checklist',
      'assigneeName',
      'status',
    ],
    labels: {
      name: 'production.planName',
      type: 'production.maintenanceType',
      intervalDays: 'production.planIntervalDays',
      nextDueOn: 'production.planNextDue',
      checklist: 'production.planChecklist',
      assigneeName: 'production.planAssignee',
      status: 'production.statusLabel',
    },
  },
  {
    resource: 'production.downtime',
    collection: 'prdDowntimeEvents',
    readonlyFields: ['status', 'durationMinutes'],
    titleKey: 'production.downtimeTitle',
    descriptionKey: 'fieldPermission.description',
    only: [
      'startedAt',
      'endedAt',
      'durationMinutes',
      'category',
      'impact',
      'status',
      'description',
      'resolution',
    ],
    labels: {
      startedAt: 'production.downtimeStartedAt',
      endedAt: 'production.downtimeEndedAt',
      durationMinutes: 'production.downtimeMinutes',
      category: 'production.downtimeCategory',
      impact: 'production.downtimeImpact',
      status: 'production.downtimeStatus',
      description: 'production.downtimeDescription',
      resolution: 'production.downtimeResolution',
    },
  },
  {
    resource: 'production.overtime',
    collection: 'prdOvertimeRequests',
    readonlyFields: ['status', 'requestNo', 'approverName'],
    titleKey: 'production.overtimeTitle',
    descriptionKey: 'fieldPermission.description',
    only: [
      'requestNo',
      'businessDate',
      'hours',
      'type',
      'reason',
      'compensation',
      'status',
      'approverName',
    ],
    labels: {
      requestNo: 'fieldCatalog.requestNo',
      businessDate: 'production.businessDate',
      hours: 'production.overtimeHoursInput',
      type: 'production.overtimeType',
      reason: 'production.overtimeReason',
      compensation: 'fieldCatalog.compensation',
      status: 'production.statusLabel',
      approverName: 'fieldCatalog.approverName',
    },
  },
  {
    resource: 'production.setupUnit',
    collection: 'prdUnitProfiles',
    titleKey: 'production.setup',
    descriptionKey: 'fieldPermission.description',
    only: [
      'lineCode',
      'processType',
      'designCapacityTpd',
      'commissionDate',
      'region',
      'status',
    ],
    labels: {
      lineCode: 'fieldCatalog.lineCode',
      processType: 'fieldCatalog.processType',
      designCapacityTpd: 'fieldCatalog.designCapacityTpd',
      commissionDate: 'fieldCatalog.commissionDate',
      region: 'fieldCatalog.region',
      status: 'production.statusLabel',
    },
  },
  {
    resource: 'production.setupMaterial',
    collection: 'prdUnitMaterials',
    titleKey: 'production.materialConfig',
    descriptionKey: 'fieldPermission.description',
    only: ['role', 'defaultWarehouseId', 'sortOrder', 'status', 'notes'],
    labels: {
      role: 'fieldCatalog.materialRole',
      defaultWarehouseId: 'execution.warehouse',
      sortOrder: 'fieldCatalog.sortOrder',
      status: 'production.statusLabel',
      notes: 'production.notes',
    },
  },
  {
    resource: 'hse.overview',
    titleKey: 'hse.overview',
    manualWritable: false,
    descriptionKey: 'fieldPermission.description',
    manual: [
      { field: 'incidentsOpen', titleKey: 'hse.metrics.incidentsOpen' },
      { field: 'incidentsLti', titleKey: 'hse.metrics.incidentsLti' },
      { field: 'hazardsOpen', titleKey: 'hse.metrics.hazardsOpen' },
      { field: 'hazardsOverdue', titleKey: 'hse.metrics.hazardsOverdue' },
      { field: 'permitsActive', titleKey: 'hse.metrics.permitsActive' },
      {
        field: 'certificatesExpiring90',
        titleKey: 'hse.metrics.certificatesExpiring90',
      },
    ],
  },
  {
    resource: 'hse.incident',
    collection: 'hseIncidents',
    readonlyFields: ['status', 'incidentNo'],
    titleKey: 'hse.incidents',
    descriptionKey: 'fieldPermission.description',
    only: [
      'incidentNo',
      'occurredAt',
      'type',
      'severity',
      'location',
      'description',
      'injuryCount',
      'lostDays',
      'environmentalRelease',
      'status',
      'rootCause',
      'actions',
    ],
    labels: {
      incidentNo: 'hse.fields.incidentNo',
      occurredAt: 'hse.fields.occurredAt',
      type: 'hse.fields.type',
      severity: 'hse.fields.severity',
      location: 'hse.fields.location',
      description: 'hse.fields.description',
      injuryCount: 'hse.fields.injuryCount',
      lostDays: 'hse.fields.lostDays',
      environmentalRelease: 'hse.fields.environmentalRelease',
      status: 'hse.fields.status',
      rootCause: 'hse.fields.rootCause',
      actions: 'hse.fields.actions',
    },
  },
  {
    resource: 'hse.hazard',
    collection: 'hseHazards',
    readonlyFields: ['status'],
    titleKey: 'hse.hazards',
    descriptionKey: 'fieldPermission.description',
    only: [
      'source',
      'level',
      'description',
      'location',
      'discoveredAt',
      'ownerName',
      'dueAt',
      'status',
      'rectification',
    ],
    labels: {
      source: 'hse.fields.source',
      level: 'hse.fields.level',
      description: 'hse.fields.description',
      location: 'hse.fields.location',
      discoveredAt: 'hse.fields.discoveredAt',
      ownerName: 'hse.fields.ownerName',
      dueAt: 'hse.fields.dueAt',
      status: 'hse.fields.status',
      rectification: 'hse.fields.rectification',
    },
  },
  {
    resource: 'hse.certificate',
    collection: 'hseCertificates',
    readonlyFields: ['status'],
    titleKey: 'hse.certificates',
    descriptionKey: 'fieldPermission.description',
    only: [
      'holderType',
      'holderName',
      'certType',
      'certNo',
      'issuedAt',
      'expiresAt',
      'authority',
      'status',
    ],
    labels: {
      holderType: 'hse.fields.holderType',
      holderName: 'hse.fields.holderName',
      certType: 'hse.fields.certType',
      certNo: 'hse.fields.certNo',
      issuedAt: 'hse.fields.issuedAt',
      expiresAt: 'hse.fields.expiresAt',
      authority: 'hse.fields.authority',
      status: 'hse.fields.status',
    },
  },
  {
    resource: 'operations.overview',
    titleKey: 'operations.overview',
    manualWritable: false,
    descriptionKey: 'fieldPermission.description',
    manual: [
      { field: 'processed', titleKey: 'operations.processed' },
      { field: 'metal', titleKey: 'operations.metal' },
      { field: 'sand', titleKey: 'operations.sand' },
      { field: 'metalRate', titleKey: 'operations.metalRate' },
    ],
  },
  {
    resource: 'operations.issue',
    collection: 'opsIssues',
    readonlyFields: ['status', 'code'],
    titleKey: 'operations.issues',
    descriptionKey: 'fieldPermission.description',
    only: [
      'code',
      'title',
      'description',
      'severity',
      'ownerName',
      'dueAt',
      'status',
      'resolution',
    ],
    labels: {
      code: 'operations.issueCode',
      title: 'operations.issueTitle',
      description: 'operations.issueDescription',
      severity: 'operations.issueSeverityLabel',
      ownerName: 'operations.issueOwner',
      dueAt: 'operations.issueDue',
      status: 'operations.issueStatusLabel',
      resolution: 'operations.issueResolution',
    },
  },
  {
    resource: 'operations.target',
    collection: 'opsKpiTargets',
    titleKey: 'operations.targets',
    descriptionKey: 'fieldPermission.description',
    only: ['period', 'metric', 'targetValue'],
    labels: {
      period: 'operations.period',
      metric: 'operations.metric',
      targetValue: 'operations.targetValue',
    },
    computed: [
      { field: 'actualValue', titleKey: 'operations.actualValue' },
      { field: 'achievementPct', titleKey: 'operations.achievement' },
      { field: 'varianceValue', titleKey: 'operations.variance' },
    ],
  },
  {
    resource: 'people.overview',
    titleKey: 'people.overview',
    manualWritable: false,
    descriptionKey: 'fieldPermission.description',
    manual: [
      { field: 'activePeople', titleKey: 'people.metrics.activePeople' },
      { field: 'profiles', titleKey: 'people.metrics.profiles' },
      { field: 'evaluations', titleKey: 'people.metrics.evaluations' },
      {
        field: 'developmentPlans',
        titleKey: 'people.metrics.developmentPlans',
      },
      { field: 'workforcePlans', titleKey: 'people.metrics.workforcePlans' },
    ],
  },
  {
    resource: 'people.personnelOverview',
    titleKey: 'people.personnel',
    manualWritable: false,
    descriptionKey: 'fieldPermission.description',
    manual: [
      { field: 'activePeople', titleKey: 'people.metrics.activePeople' },
      { field: 'profiles', titleKey: 'people.metrics.profiles' },
      { field: 'evaluations', titleKey: 'people.metrics.evaluations' },
      {
        field: 'developmentPlans',
        titleKey: 'people.metrics.developmentPlans',
      },
      { field: 'workforcePlans', titleKey: 'people.metrics.workforcePlans' },
    ],
  },
  {
    resource: 'people.history',
    collection: 'peopleAudit',
    readonlyFields: [
      'operation',
      'actorName',
      'reason',
      'beforeValue',
      'afterValue',
    ],
    titleKey: 'people.history',
    descriptionKey: 'fieldPermission.description',
    only: ['operation', 'actorName', 'reason', 'beforeValue', 'afterValue'],
    labels: {
      operation: 'fieldCatalog.operation',
      actorName: 'fieldCatalog.actorName',
      reason: 'fieldCatalog.reason',
      beforeValue: 'fieldCatalog.beforeValue',
      afterValue: 'fieldCatalog.afterValue',
    },
  },
  {
    resource: 'people.approvals',
    collection: 'peopleApprovalTasks',
    readonlyFields: ['title', 'mode', 'status', 'decidedAt'],
    titleKey: 'people.approvals',
    descriptionKey: 'fieldPermission.description',
    only: ['title', 'mode', 'status', 'decidedAt'],
    labels: {
      title: 'fieldCatalog.approvalTitle',
      mode: 'people.approvalMode',
      status: 'people.taskStatus',
      decidedAt: 'fieldCatalog.decidedAt',
    },
  },
  {
    resource: 'people.approvalSettings',
    titleKey: 'people.approvalSettings',
    descriptionKey: 'fieldPermission.description',
    manual: [
      { field: 'approvalMode', titleKey: 'people.approvalMode' },
      { field: 'approvalStage', titleKey: 'people.approvalStageTitle' },
      { field: 'approvalReviewers', titleKey: 'people.approvalReviewers' },
    ],
  },
  {
    resource: 'people.assets',
    collection: 'assets',
    readonlyFields: ['status'],
    titleKey: 'assets.title',
    descriptionKey: 'fieldPermission.description',
    only: [
      'code',
      'name',
      'category',
      'status',
      'custodianEmployeeId',
      'location',
      'acquiredOn',
      'originalCost',
      'currency',
      'notes',
    ],
    labels: {
      code: 'assets.fields.code',
      name: 'assets.fields.name',
      category: 'assets.fields.category',
      status: 'assets.fields.status',
      custodianEmployeeId: 'assets.fields.custodian',
      location: 'assets.fields.location',
      acquiredOn: 'assets.fields.acquiredOn',
      originalCost: 'assets.fields.originalCost',
      currency: 'fieldCatalog.currency',
      notes: 'assets.fields.notes',
    },
  },
  {
    resource: 'people.employee',
    collection: 'personnelEmployees',
    readonlyFields: ['status'],
    titleKey: 'people.employees',
    descriptionKey: 'fieldPermission.description',
    only: ['code', 'name', 'status'],
    labels: {
      code: 'people.fields.code',
      name: 'people.fields.name',
      status: 'people.fields.status',
    },
  },
  {
    resource: 'people.employment',
    collection: 'personnelEmployments',
    readonlyFields: ['status'],
    titleKey: 'people.employments',
    descriptionKey: 'fieldPermission.description',
    only: ['code', 'name', 'status'],
    labels: {
      code: 'people.fields.code',
      name: 'people.fields.name',
      status: 'people.fields.status',
    },
  },
  {
    resource: 'people.assignment',
    collection: 'personnelAssignments',
    readonlyFields: ['status'],
    titleKey: 'people.assignments',
    descriptionKey: 'fieldPermission.description',
    only: ['code', 'name', 'status'],
    labels: {
      code: 'people.fields.code',
      name: 'people.fields.name',
      status: 'people.fields.status',
    },
  },
  {
    resource: 'people.change',
    collection: 'personnelChanges',
    readonlyFields: ['status'],
    titleKey: 'people.changes',
    descriptionKey: 'fieldPermission.description',
    only: ['code', 'name', 'status'],
    labels: {
      code: 'people.fields.code',
      name: 'people.fields.name',
      status: 'people.fields.status',
    },
  },
  {
    resource: 'people.dimension',
    collection: 'hrDimensions',
    readonlyFields: ['status'],
    titleKey: 'people.dimensions',
    descriptionKey: 'fieldPermission.description',
    only: ['code', 'name', 'status'],
    labels: {
      code: 'people.fields.code',
      name: 'people.fields.name',
      status: 'people.fields.status',
    },
  },
  {
    resource: 'people.model',
    collection: 'hrModels',
    readonlyFields: ['status'],
    titleKey: 'people.models',
    descriptionKey: 'fieldPermission.description',
    only: ['code', 'name', 'status'],
    labels: {
      code: 'people.fields.code',
      name: 'people.fields.name',
      status: 'people.fields.status',
    },
  },
  {
    resource: 'people.profile',
    collection: 'hrProfiles',
    readonlyFields: ['status'],
    titleKey: 'people.profiles',
    descriptionKey: 'fieldPermission.description',
    only: ['code', 'name', 'status'],
    labels: {
      code: 'people.fields.code',
      name: 'people.fields.name',
      status: 'people.fields.status',
    },
  },
  {
    resource: 'people.evaluation',
    collection: 'hrEvaluations',
    readonlyFields: ['status'],
    titleKey: 'people.evaluations',
    descriptionKey: 'fieldPermission.description',
    only: ['code', 'name', 'status'],
    labels: {
      code: 'people.fields.code',
      name: 'people.fields.name',
      status: 'people.fields.status',
    },
  },
  {
    resource: 'people.developmentPlan',
    collection: 'hrDevelopmentPlans',
    readonlyFields: ['status'],
    titleKey: 'people.developmentPlans',
    descriptionKey: 'fieldPermission.description',
    only: ['code', 'name', 'status'],
    labels: {
      code: 'people.fields.code',
      name: 'people.fields.name',
      status: 'people.fields.status',
    },
  },
  {
    resource: 'people.workforcePlan',
    collection: 'hrWorkforcePlans',
    readonlyFields: ['status'],
    titleKey: 'people.workforcePlans',
    descriptionKey: 'fieldPermission.description',
    only: ['code', 'name', 'status'],
    labels: {
      code: 'people.fields.code',
      name: 'people.fields.name',
      status: 'people.fields.status',
    },
  },
  {
    resource: 'materials.overview',
    titleKey: 'dashboard.materials.title',
    manualWritable: false,
    descriptionKey: 'fieldPermission.description',
    manual: [
      {
        field: 'activeSkus',
        titleKey: 'dashboard.materials.metrics.activeSkus',
      },
      { field: 'names', titleKey: 'dashboard.materials.metrics.names' },
      { field: 'templates', titleKey: 'dashboard.materials.metrics.templates' },
      {
        field: 'pendingRequests',
        titleKey: 'dashboard.materials.metrics.pendingRequests',
      },
    ],
  },
  {
    resource: 'materials.name',
    collection: 'materialNames',
    titleKey: 'materials.kinds.names',
    descriptionKey: 'fieldPermission.description',
    only: ['code', 'name', 'notes', 'status'],
    labels: {
      code: 'materials.fields.code',
      name: 'materials.fields.name',
      notes: 'materials.fields.notes',
      status: 'materials.fields.status',
    },
  },
  {
    resource: 'materials.template',
    collection: 'materialAttributeTemplates',
    titleKey: 'materials.kinds.templates',
    descriptionKey: 'fieldPermission.description',
    only: ['code', 'name', 'notes', 'status'],
    labels: {
      code: 'materials.fields.code',
      name: 'materials.fields.name',
      notes: 'materials.fields.notes',
      status: 'materials.fields.status',
    },
  },
  {
    resource: 'materials.sku',
    collection: 'materialSkus',
    titleKey: 'materials.kinds.skus',
    descriptionKey: 'fieldPermission.description',
    only: ['code', 'name', 'notes', 'status', 'managementMode'],
    labels: {
      code: 'materials.fields.code',
      name: 'materials.fields.name',
      notes: 'materials.fields.notes',
      status: 'materials.fields.status',
      managementMode: 'materials.fields.managementMode',
    },
  },
  {
    resource: 'materials.unit',
    collection: 'measureUnits',
    titleKey: 'materials.kinds.units',
    descriptionKey: 'fieldPermission.description',
    only: ['code', 'name', 'notes', 'status', 'unitType', 'precision'],
    labels: {
      code: 'materials.fields.code',
      name: 'materials.fields.name',
      notes: 'materials.fields.notes',
      status: 'materials.fields.status',
      unitType: 'materials.fields.unitType',
      precision: 'materials.fields.precision',
    },
  },
  {
    resource: 'materials.unitRule',
    collection: 'materialUnitRules',
    titleKey: 'materials.kinds.unitRules',
    descriptionKey: 'fieldPermission.description',
    only: ['code', 'name', 'notes', 'status', 'numerator', 'denominator'],
    labels: {
      code: 'materials.fields.code',
      name: 'materials.fields.name',
      notes: 'materials.fields.notes',
      status: 'materials.fields.status',
      numerator: 'materials.fields.numerator',
      denominator: 'materials.fields.denominator',
    },
  },
  {
    resource: 'materials.reference',
    collection: 'materialReferences',
    titleKey: 'materials.kinds.references',
    descriptionKey: 'fieldPermission.description',
    only: ['code', 'name', 'notes', 'status', 'sourceType', 'targetKind'],
    labels: {
      code: 'materials.fields.code',
      name: 'materials.fields.name',
      notes: 'materials.fields.notes',
      status: 'materials.fields.status',
      sourceType: 'materials.fields.sourceType',
      targetKind: 'materials.fields.targetKind',
    },
  },
  {
    resource: 'materials.tag',
    collection: 'materialTags',
    titleKey: 'materials.kinds.tags',
    descriptionKey: 'fieldPermission.description',
    only: ['code', 'name', 'notes', 'status', 'appliesTo'],
    labels: {
      code: 'materials.fields.code',
      name: 'materials.fields.name',
      notes: 'materials.fields.notes',
      status: 'materials.fields.status',
      appliesTo: 'materials.fields.appliesTo',
    },
  },
  {
    resource: 'materials.tagLink',
    collection: 'materialTagLinks',
    titleKey: 'materials.kinds.tagLinks',
    descriptionKey: 'fieldPermission.description',
    only: ['code', 'name', 'notes', 'status', 'targetKind'],
    labels: {
      code: 'materials.fields.code',
      name: 'materials.fields.name',
      notes: 'materials.fields.notes',
      status: 'materials.fields.status',
      targetKind: 'materials.fields.targetKind',
    },
  },
  {
    resource: 'materials.request',
    collection: 'materialRequests',
    readonlyFields: ['status'],
    titleKey: 'materials.kinds.requests',
    descriptionKey: 'fieldPermission.description',
    only: [
      'code',
      'name',
      'notes',
      'status',
      'specification',
      'proposedUnit',
      'usage',
    ],
    labels: {
      code: 'materials.fields.code',
      name: 'materials.fields.name',
      notes: 'materials.fields.notes',
      status: 'materials.fields.status',
      specification: 'materials.fields.specification',
      proposedUnit: 'materials.fields.proposedUnit',
      usage: 'materials.fields.usage',
    },
  },
  {
    resource: 'materials.subjectSetting',
    collection: 'materialSubjectSettings',
    titleKey: 'materials.kinds.subjectSettings',
    descriptionKey: 'fieldPermission.description',
    only: ['code', 'name', 'notes', 'status', 'canPurchase', 'canSell'],
    labels: {
      code: 'materials.fields.code',
      name: 'materials.fields.name',
      notes: 'materials.fields.notes',
      status: 'materials.fields.status',
      canPurchase: 'materials.fields.canPurchase',
      canSell: 'materials.fields.canSell',
    },
  },
  {
    resource: 'materials.warehouse',
    collection: 'warehouses',
    titleKey: 'materials.kinds.warehouses',
    descriptionKey: 'fieldPermission.description',
    only: ['code', 'name', 'notes', 'status'],
    labels: {
      code: 'materials.fields.code',
      name: 'materials.fields.name',
      notes: 'materials.fields.notes',
      status: 'materials.fields.status',
    },
  },
  {
    resource: 'materials.history',
    collection: 'materialAudit',
    readonlyFields: [
      'operation',
      'actorName',
      'reason',
      'beforeValue',
      'afterValue',
    ],
    titleKey: 'materials.history',
    descriptionKey: 'fieldPermission.description',
    only: ['operation', 'actorName', 'reason', 'beforeValue', 'afterValue'],
    labels: {
      operation: 'fieldCatalog.operation',
      actorName: 'fieldCatalog.actorName',
      reason: 'fieldCatalog.reason',
      beforeValue: 'fieldCatalog.beforeValue',
      afterValue: 'fieldCatalog.afterValue',
    },
  },
  {
    resource: 'sales.overview',
    titleKey: 'dashboard.sales.title',
    manualWritable: false,
    descriptionKey: 'fieldPermission.description',
    manual: [
      { field: 'orders', titleKey: 'dashboard.sales.metrics.orders' },
      {
        field: 'pendingOrders',
        titleKey: 'dashboard.sales.metrics.pendingOrders',
      },
      {
        field: 'approvedOrders',
        titleKey: 'dashboard.sales.metrics.approvedOrders',
      },
      { field: 'customers', titleKey: 'dashboard.sales.metrics.customers' },
    ],
  },
  {
    resource: 'warehouse.overview',
    titleKey: 'dashboard.warehouse.title',
    manualWritable: false,
    descriptionKey: 'fieldPermission.description',
    manual: [
      {
        field: 'inboundDocuments',
        titleKey: 'dashboard.warehouse.metrics.inboundDocuments',
      },
      {
        field: 'outboundDocuments',
        titleKey: 'dashboard.warehouse.metrics.outboundDocuments',
      },
      {
        field: 'inventoryItems',
        titleKey: 'dashboard.warehouse.metrics.inventoryItems',
      },
      {
        field: 'pendingTransfers',
        titleKey: 'dashboard.warehouse.metrics.pendingTransfers',
      },
    ],
  },
  {
    resource: 'procurement.overview',
    titleKey: 'dashboard.procurement.title',
    manualWritable: false,
    descriptionKey: 'fieldPermission.description',
    manual: [
      { field: 'orders', titleKey: 'dashboard.procurement.metrics.orders' },
      {
        field: 'pendingRequests',
        titleKey: 'dashboard.procurement.metrics.pendingRequests',
      },
      {
        field: 'approvedRequests',
        titleKey: 'dashboard.procurement.metrics.approvedRequests',
      },
      {
        field: 'suppliers',
        titleKey: 'dashboard.procurement.metrics.suppliers',
      },
    ],
  },
  {
    resource: 'requisitions.overview',
    titleKey: 'dashboard.requisitions.title',
    manualWritable: false,
    descriptionKey: 'fieldPermission.description',
    manual: [
      {
        field: 'requests',
        titleKey: 'dashboard.requisitions.metrics.requests',
      },
      { field: 'pending', titleKey: 'dashboard.requisitions.metrics.pending' },
      { field: 'open', titleKey: 'dashboard.requisitions.metrics.open' },
      { field: 'issued', titleKey: 'dashboard.requisitions.metrics.issued' },
    ],
  },
  {
    resource: 'sales.customer',
    collection: 'businessPartners',
    readonlyFields: ['status'],
    titleKey: 'execution.customers',
    descriptionKey: 'fieldPermission.description',
    only: ['code', 'name', 'registrationCode', 'status'],
    labels: {
      code: 'procurement.code',
      name: 'fieldCatalog.name',
      registrationCode: 'procurement.registrationCode',
      status: 'procurement.identityStatus',
    },
  },
  {
    resource: 'procurement.supplier.base',
    collection: 'businessPartners',
    readonlyFields: ['status'],
    titleKey: 'procurement.suppliers',
    descriptionKey: 'fieldPermission.description',
    only: ['code', 'name', 'registrationCode', 'status'],
    labels: {
      code: 'procurement.code',
      name: 'procurement.name',
      registrationCode: 'procurement.registrationCode',
      status: 'procurement.identityStatus',
    },
  },
  {
    resource: 'execution.document',
    collection: 'stockDocuments',
    readonlyFields: ['status', 'code'],
    titleKey: 'execution.executionDocuments',
    descriptionKey: 'fieldPermission.description',
    only: ['code', 'occurredOn', 'reason', 'notes', 'status'],
    labels: {
      code: 'execution.code',
      occurredOn: 'execution.occurredOn',
      reason: 'execution.reason',
      notes: 'execution.notes',
      status: 'execution.status',
    },
  },
  {
    resource: 'purchase.request',
    collection: 'purchaseRequests',
    readonlyFields: ['status', 'code'],
    titleKey: 'purchase-request.title',
    descriptionKey: 'fieldPermission.description',
    only: ['code', 'usage', 'neededOn', 'notes', 'status'],
    labels: {
      code: 'purchase-request.code',
      usage: 'purchase-request.usage',
      neededOn: 'purchase-request.neededOn',
      notes: 'purchase-request.notes',
      status: 'fieldCatalog.status',
    },
  },
  {
    resource: 'purchase.request.line',
    collection: 'purchaseRequestLines',
    readonlyFields: ['lineNo', 'baseQuantity'],
    titleKey: 'purchase-request.lines',
    descriptionKey: 'fieldPermission.description',
    only: [
      'lineNo',
      'originalName',
      'originalSpecification',
      'requestedQuantity',
      'requestedUnitText',
      'baseQuantity',
      'usage',
      'notes',
    ],
    labels: {
      lineNo: 'fieldCatalog.lineNo',
      originalName: 'purchase-request.originalName',
      originalSpecification: 'purchase-request.specification',
      requestedQuantity: 'purchase-request.quantity',
      requestedUnitText: 'purchase-request.requestedUnit',
      baseQuantity: 'purchase-request.baseQuantity',
      usage: 'purchase-request.usage',
      notes: 'purchase-request.notes',
    },
  },
  {
    resource: 'issue.purpose',
    collection: 'materialIssuePurposes',
    titleKey: 'requisitions.purposes.title',
    descriptionKey: 'fieldPermission.description',
    only: ['code', 'name', 'description', 'status'],
    labels: {
      code: 'fieldCatalog.code',
      name: 'fieldCatalog.name',
      description: 'fieldCatalog.description',
      status: 'fieldCatalog.status',
    },
  },
  {
    resource: 'issue.request',
    collection: 'materialIssueRequests',
    readonlyFields: ['status', 'code'],
    titleKey: 'requisitions.issue.title',
    descriptionKey: 'fieldPermission.description',
    only: ['code', 'usage', 'neededOn', 'notes', 'status'],
    labels: {
      code: 'issue-request.code',
      usage: 'issue-request.usage',
      neededOn: 'issue-request.neededOn',
      notes: 'issue-request.notes',
      status: 'fieldCatalog.status',
    },
  },
  {
    resource: 'issue.request.line',
    collection: 'materialIssueRequestLines',
    readonlyFields: ['lineNo', 'baseQuantity'],
    titleKey: 'issue-request.lines',
    descriptionKey: 'fieldPermission.description',
    only: [
      'lineNo',
      'originalName',
      'originalSpecification',
      'requestedQuantity',
      'requestedUnitText',
      'baseQuantity',
      'usage',
      'notes',
    ],
    labels: {
      lineNo: 'fieldCatalog.lineNo',
      originalName: 'issue-request.originalName',
      originalSpecification: 'issue-request.specification',
      requestedQuantity: 'issue-request.quantity',
      requestedUnitText: 'issue-request.requestedUnit',
      baseQuantity: 'issue-request.baseQuantity',
      usage: 'issue-request.usage',
      notes: 'issue-request.notes',
    },
  },
  {
    resource: 'review.sales',
    titleKey: 'reviewSettings.sales',
    descriptionKey: 'fieldPermission.description',
    manual: [
      {
        field: 'reviewerSelections',
        titleKey: 'fieldCatalog.reviewerSelections',
      },
    ],
  },
  {
    resource: 'review.warehouse',
    titleKey: 'reviewSettings.warehouse',
    descriptionKey: 'fieldPermission.description',
    manual: [
      {
        field: 'reviewerSelections',
        titleKey: 'fieldCatalog.reviewerSelections',
      },
    ],
  },
  {
    resource: 'review.procurement',
    titleKey: 'reviewSettings.procurement',
    descriptionKey: 'fieldPermission.description',
    manual: [
      {
        field: 'reviewerSelections',
        titleKey: 'fieldCatalog.reviewerSelections',
      },
    ],
  },
  {
    resource: 'review.requisitions',
    titleKey: 'reviewSettings.requisitions',
    descriptionKey: 'fieldPermission.description',
    manual: [
      {
        field: 'reviewerSelections',
        titleKey: 'fieldCatalog.reviewerSelections',
      },
    ],
  },
  {
    resource: 'organization.positionPermissions',
    titleKey: 'organization.positionPermissions',
    descriptionKey: 'fieldPermission.description',
    manual: [
      {
        field: 'positionMembers',
        titleKey: 'organization.positionMembers',
      },
      { field: 'permissionSet', titleKey: 'fieldCatalog.permissionSet' },
    ],
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
    /** False when the field can never be edited; write option is greyed out. */
    readonly writable: boolean;
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
  const collection = resource.collection
    ? await database.collections().get(resource.collection)
    : undefined;
  const excluded = new Set(resource.exclude ?? []);
  const available = (collection?.fields ?? []).filter((field) => {
    const name = String(field.name);
    return !excluded.has(name) && !isSystemField(name);
  });
  const picked = resource.only
    ? (resource.only
        .map((name) => available.find((field) => String(field.name) === name))
        .filter(Boolean) as typeof available)
    : available;
  // Fields configured in the UI carry a title; append any such field that
  // is not listed yet, so content fields added later show up in the
  // permission editor automatically. Untitled columns (foreign keys,
  // internal links) and relation fields stay out.
  const pickedNames = new Set(picked.map((field) => String(field.name)));
  const relationTypes = new Set([
    'belongsTo',
    'hasOne',
    'hasMany',
    'belongsToMany',
  ]);
  const titledExtras = resource.only
    ? available.filter((field) => {
        if (pickedNames.has(String(field.name))) return false;
        const type = (field as { type?: unknown }).type;
        if (typeof type === 'string' && relationTypes.has(type)) {
          return false;
        }
        const title = (field as { title?: unknown }).title;
        return typeof title === 'string' && title.trim().length > 0;
      })
    : [];
  return [...picked, ...titledExtras].map((field) => {
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
      const readonlyFields = new Set(resource.readonlyFields ?? []);
      const stored = resource.manual
        ? resource.manual.map((entry) => ({
            field: entry.field,
            label: entry.field,
            titleKey: entry.titleKey,
            writable: resource.manualWritable ?? true,
          }))
        : (await collectionFields(database, resource)).map((field) => ({
            ...field,
            writable: !readonlyFields.has(field.field),
          }));
      const fields = stored.map((field) => ({
        ...field,
        titleKey:
          resource.labels?.[field.field] ??
          (field as { titleKey?: string }).titleKey,
      }));
      for (const computed of resource.computed ?? []) {
        if (!fields.some((field) => field.field === computed.field)) {
          fields.push({
            field: computed.field,
            label: computed.field,
            titleKey: computed.titleKey,
            writable: false,
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
