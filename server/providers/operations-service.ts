import { randomUUID } from 'node:crypto';
import type {
  DatabaseManager,
  FilterBuilder,
  FilterNode,
} from '@nocobase/db';
import { createServiceToken } from '@nocobase/service-provider';
import { businessDate } from './business-date.js';
import { currentCompanyForUser } from './company-identity.js';
import type {
  OperationsCompanyQuery,
  OperationsTargetMetric,
  OperationsIssueInput,
  OperationsIssueQuery,
  OperationsIssueUpdate,
  OperationsOverviewQuery,
  OperationsTargetInput,
  OperationsTargetQuery,
} from './operations-model.js';

export const operationsServiceToken = createServiceToken<OperationsService>(
  'group-erp/operations',
);

export type OperationsPrincipal = { type: string; id: string };
export type OperationsErrorCode =
  'OPERATIONS_FORBIDDEN' | 'OPERATIONS_INVALID' | 'OPERATIONS_CONFLICT';
export type OperationsSource =
  | 'hse'
  | 'production'
  | 'warehouse'
  | 'sales'
  | 'procurement'
  | 'people';
export type OperationsScope = {
  readAll: boolean;
  /**
   * Per-source-module read grants. The overview aggregates source tables
   * directly, so a block is only computed (and its tables only read) when
   * the caller also holds the source module's own read permission.
   * Absent sources (legacy callers) default to full access.
   */
  sources?: Record<OperationsSource, boolean>;
};

export class OperationsError extends Error {
  constructor(
    public readonly code: OperationsErrorCode,
    message: string = code,
  ) {
    super(message);
    this.name = 'OperationsError';
  }
}

const text = (value: unknown) => (typeof value === 'string' ? value : '');
const day = (value: unknown) => text(value).slice(0, 10);
const scale = 1_000_000n;

const issueTransitions: Record<string, ReadonlyArray<string>> = {
  open: ['in_progress', 'closed'],
  in_progress: ['open', 'closed'],
  closed: [],
};

function issueTransitionAllowed(
  from: string,
  to: string,
): boolean {
  return (issueTransitions[from] ?? []).includes(to);
}

function amount(value: unknown): bigint {
  const raw = text(value).trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) return 0n;
  const negative = raw.startsWith('-');
  const [whole, fraction = ''] = (negative ? raw.slice(1) : raw).split('.');
  const minor =
    BigInt(whole || '0') * scale + BigInt(fraction.padEnd(6, '0').slice(0, 6));
  return negative ? -minor : minor;
}

function decimal(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / scale;
  const fraction = (absolute % scale)
    .toString()
    .padStart(6, '0')
    .replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

function rate(part: bigint, total: bigint): string | null {
  if (total === 0n) return null;
  return ((Number(part) / Number(total)) * 100).toFixed(1);
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

type OverviewTableKey =
  | 'reports'
  | 'units'
  | 'profiles'
  | 'mappings'
  | 'balances'
  | 'receipts'
  | 'incidents'
  | 'hazards'
  | 'certificates'
  | 'issues'
  | 'salesOrders'
  | 'purchaseOrders'
  | 'salesShipments'
  | 'purchaseReceipts'
  | 'maintenanceOrders'
  | 'downtimeEvents'
  | 'assignments';

type OverviewTables = Record<OverviewTableKey, Record<string, unknown>[]>;

const overviewTableKeys: ReadonlyArray<OverviewTableKey> = [
  'reports',
  'units',
  'profiles',
  'mappings',
  'balances',
  'receipts',
  'incidents',
  'hazards',
  'certificates',
  'issues',
  'salesOrders',
  'purchaseOrders',
  'salesShipments',
  'purchaseReceipts',
  'maintenanceOrders',
  'downtimeEvents',
  'assignments',
];

const emptyOverviewTables = (): OverviewTables => ({
  reports: [],
  units: [],
  profiles: [],
  mappings: [],
  balances: [],
  receipts: [],
  incidents: [],
  hazards: [],
  certificates: [],
  issues: [],
  salesOrders: [],
  purchaseOrders: [],
  salesShipments: [],
  purchaseReceipts: [],
  maintenanceOrders: [],
  downtimeEvents: [],
  assignments: [],
});

/** IN-list on a string field; no repository `.in()` operator exists. */
function subjectIdIn(
  f: FilterBuilder,
  field: string,
  ids: readonly string[],
): FilterNode {
  if (!ids.length) return f.string(field).eq('__none__');
  if (ids.length <= 100)
    return f.or(ids.map((id) => f.string(field).eq(id)));
  const middle = Math.floor(ids.length / 2);
  return f.or([
    subjectIdIn(f, field, ids.slice(0, middle)),
    subjectIdIn(f, field, ids.slice(middle)),
  ]);
}

export class OperationsService {
  constructor(
    private readonly database: DatabaseManager,
    private readonly timeZone: string,
  ) {}

  private async resolveSubject(
    principal: OperationsPrincipal,
    requested: string | undefined,
    scope: OperationsScope,
  ): Promise<string | null> {
    if (scope.readAll) return requested ?? null;
    const company = await currentCompanyForUser(
      this.database,
      this.timeZone,
      principal,
    );
    if (!company) throw new OperationsError('OPERATIONS_FORBIDDEN');
    if (requested && requested !== company)
      throw new OperationsError('OPERATIONS_FORBIDDEN');
    return company;
  }

  async companies(
    principal: OperationsPrincipal,
    query: OperationsCompanyQuery,
    scope: OperationsScope,
  ) {
    const company = await this.resolveSubject(principal, undefined, scope);
    const rows = await this.database.repository('orgSubjects').findMany({
      filter: {
        status: 'active',
        ...(company ? { id: company } : {}),
      },
      limit: 1000,
      sort: (sort) => [sort.field('sortOrder').asc(), sort.field('name').asc()],
    });
    const q = query.q?.toLowerCase() ?? '';
    const matched = rows
      .map((row) => ({
        id: text(row.id),
        code: text(row.code),
        name: text(row.name),
      }))
      .filter(
        (row) => !q || `${row.code} ${row.name}`.toLowerCase().includes(q),
      );
    const start = (query.page - 1) * query.pageSize;
    return {
      data: matched.slice(start, start + query.pageSize),
      meta: {
        total: matched.length,
        page: query.page,
        pageSize: query.pageSize,
      },
    };
  }

  private async subjectRows(
    principal: OperationsPrincipal,
    scope: OperationsScope,
  ) {
    const company = await this.resolveSubject(principal, undefined, scope);
    const subjects = await this.database.repository('orgSubjects').findMany({
      filter: {
        status: 'active',
        ...(company ? { id: company } : {}),
      },
      limit: 1000,
      sort: (sort) => [sort.field('sortOrder').asc(), sort.field('name').asc()],
    });
    return { company, subjects };
  }

  async options(principal: OperationsPrincipal, scope: OperationsScope) {
    const { company, subjects } = await this.subjectRows(principal, scope);
    const units = await this.database.repository('orgUnits').findMany({
      filter: {
        status: 'active',
        ...(company ? { subjectId: company } : {}),
      },
      limit: 5000,
    });
    const unitSubjects = new Map(
      units.map((row) => [text(row.id), text(row.subjectId)]),
    );
    const unitIds = [...unitSubjects.keys()];
    // The owner picker needs positions grouped by company. `orgPositions` has
    // no company column, so resolve it through the position's unit.
    const positions = unitIds.length
      ? await this.database.repository('orgPositions').findMany({
          filter: (f: FilterBuilder) =>
            f.and([
              f.string('status').eq('active'),
              subjectIdIn(f, 'unitId', unitIds),
            ]),
          limit: 5000,
          sort: (sort) => [sort.field('name').asc()],
        })
      : [];
    return {
      subjects: subjects.map((row) => ({
        id: text(row.id),
        name: text(row.name),
      })),
      positions: positions.flatMap((row) => {
        const subjectId = unitSubjects.get(text(row.unitId));
        return subjectId
          ? [{ id: text(row.id), name: text(row.name), subjectId }]
          : [];
      }),
    };
  }

  async overview(
    principal: OperationsPrincipal,
    query: OperationsOverviewQuery,
    scope: OperationsScope,
  ) {
    const subjectId = await this.resolveSubject(
      principal,
      query.subjectId,
      scope,
    );
    const date = query.date ?? businessDate(this.timeZone);
    // With no subjectId the overview aggregates across the whole group.
    // That branch is currently reachable only through the API and through
    // the CompanyComparison total row — the client's CompanyGate always
    // injects the current company's subjectId.
    const subject = subjectId
      ? await this.database
          .repository('orgSubjects')
          .findOne({ filter: { id: subjectId } })
      : null;
    if (subjectId && !subject)
      throw new OperationsError('OPERATIONS_INVALID', 'SUBJECT_NOT_FOUND');
    const { tables, positions, truncated } = await this.loadOverviewTables(
      subjectId ? [subjectId] : null,
      date,
      scope,
    );
    return this.buildOverview(
      subjectId,
      subject ? text(subject.name) : null,
      date,
      tables,
      positions,
      scope,
      truncated,
    );
  }

  /**
   * Loads every table the overview aggregates with all row-level filters
   * pushed down to the repository (date windows, open/closed statuses,
   * posted-only documents), so overviews no longer filter whole tables in
   * memory. `subjectIds` selects the companies to load for (`null` = all
   * companies, `[]` = none); one load serves a whole company batch and the
   * caller groups rows per company. Positions are company-agnostic and loaded
   * once. Each table is read with `limit + 1` rows so a result that exceeds
   * its `limit` is reported in `truncated`; an exactly-full table is not
   * mistaken for a truncated one.
   */
  private async loadOverviewTables(
    subjectIds: string[] | null,
    date: string,
    scope: OperationsScope,
  ): Promise<{
    tables: OverviewTables;
    positions: Record<string, unknown>[];
    truncated: string[];
  }> {
    const today = businessDate(this.timeZone);
    const expiryLimit = addDays(today, 90);
    const can = (source: OperationsSource) =>
      !scope.sources || scope.sources[source];
    const specs: ReadonlyArray<{
      key: OverviewTableKey;
      source: OperationsSource | null;
      repository: string;
      limit: number;
      base: (f: FilterBuilder) => FilterNode[];
    }> = [
      {
        key: 'reports',
        source: 'production',
        repository: 'prdShiftReports',
        limit: 20000,
        base: (f) => [
          f.string('status').eq('confirmed'),
          f.date('reportDate').on(date),
        ],
      },
      {
        key: 'units',
        source: 'production',
        repository: 'orgUnits',
        limit: 5000,
        base: (f) => [f.string('status').eq('active')],
      },
      {
        key: 'profiles',
        source: 'production',
        repository: 'prdUnitProfiles',
        limit: 5000,
        base: (f) => [f.string('status').eq('active')],
      },
      {
        key: 'mappings',
        source: 'production',
        repository: 'prdUnitMaterials',
        limit: 5000,
        base: (f) => [f.string('status').eq('active')],
      },
      {
        key: 'balances',
        source: 'warehouse',
        repository: 'stockBalances',
        limit: 20000,
        base: (f) => [f.string('subjectId').notEmpty()],
      },
      {
        key: 'receipts',
        source: 'warehouse',
        repository: 'stockDocuments',
        limit: 20000,
        base: (f) => [
          f.string('kind').eq('productionReceipt'),
          f.date('occurredOn').on(date),
        ],
      },
      {
        key: 'incidents',
        source: 'hse',
        repository: 'hseIncidents',
        limit: 5000,
        base: (f) => [f.string('status').ne('closed')],
      },
      {
        key: 'hazards',
        source: 'hse',
        repository: 'hseHazards',
        limit: 5000,
        base: (f) => [f.string('status').ne('closed')],
      },
      {
        key: 'certificates',
        source: 'hse',
        repository: 'hseCertificates',
        limit: 5000,
        base: (f) => [
          f.date('expiresAt').notBefore(today),
          f.date('expiresAt').notAfter(expiryLimit),
        ],
      },
      {
        key: 'issues',
        source: null,
        repository: 'opsIssues',
        limit: 20000,
        base: (f) => [f.string('status').ne('closed')],
      },
      {
        key: 'salesOrders',
        source: 'sales',
        repository: 'salesOrders',
        limit: 20000,
        base: (f) => [
          f.or(
            ['draft', 'pending', 'approved'].map((v) =>
              f.string('status').eq(v),
            ),
          ),
        ],
      },
      {
        key: 'purchaseOrders',
        source: 'procurement',
        repository: 'purchaseOrders',
        limit: 20000,
        base: (f) => [
          f.or(
            ['draft', 'pending', 'approved'].map((v) =>
              f.string('status').eq(v),
            ),
          ),
        ],
      },
      {
        key: 'salesShipments',
        source: 'sales',
        repository: 'stockDocuments',
        limit: 20000,
        base: (f) => [
          f.string('kind').eq('salesShipment'),
          f.date('occurredOn').on(date),
          f.string('status').eq('posted'),
        ],
      },
      {
        key: 'purchaseReceipts',
        source: 'procurement',
        repository: 'stockDocuments',
        limit: 20000,
        base: (f) => [
          f.string('kind').eq('purchaseReceipt'),
          f.date('occurredOn').on(date),
          f.string('status').eq('posted'),
        ],
      },
      {
        key: 'maintenanceOrders',
        source: 'production',
        repository: 'prdMaintenanceOrders',
        limit: 5000,
        base: (f) => [
          f.or(
            ['reported', 'in_progress'].map((v) => f.string('status').eq(v)),
          ),
        ],
      },
      {
        key: 'downtimeEvents',
        source: 'production',
        repository: 'prdDowntimeEvents',
        limit: 5000,
        // Downtime rows stay whole: minutesToday aggregates every event that
        // started on the business date, not only currently open ones.
        base: (f) => [f.string('subjectId').notEmpty()],
      },
      {
        key: 'assignments',
        source: 'people',
        repository: 'personnelAssignments',
        limit: 20000,
        base: (f) => [
          f.string('status').eq('active'),
          f.string('personId').notEmpty(),
        ],
      },
    ];
    if (subjectIds !== null && subjectIds.length === 0) {
      return {
        tables: emptyOverviewTables(),
        positions: [],
        truncated: [],
      };
    }
    const truncated = new Set<string>();
    const tables = {} as OverviewTables;
    await Promise.all(
      specs.map(async ({ key, source, repository, limit, base }) => {
        if (source !== null && !can(source)) {
          tables[key] = [];
          return;
        }
        const rows = (await this.database.repository(repository).findMany({
          filter: (f: FilterBuilder) => {
            const nodes = base(f);
            if (subjectIds !== null)
              nodes.push(subjectIdIn(f, 'subjectId', subjectIds));
            return f.and(nodes);
          },
          limit: limit + 1,
        })) as Record<string, unknown>[];
        if (rows.length > limit)
          truncated.add(`${source ?? 'issues'}:${key}`);
        tables[key] = rows.length > limit ? rows.slice(0, limit) : rows;
      }),
    );
    const positions = can('people')
      ? ((await this.database.repository('orgPositions').findMany({
          filter: { status: 'active' },
          limit: 5001,
        })) as Record<string, unknown>[])
      : [];
    if (positions.length > 5000) {
      truncated.add('people:positions');
      positions.length = 5000;
    }
    return { tables, positions, truncated: [...truncated].sort() };
  }

  /**
   * Aggregates one company's overview block from already-loaded rows. Kept
   * separate from loading so the single-company overview and the batched
   * company overview share exactly the same aggregation rules.
   */
  private buildOverview(
    subjectId: string | null,
    subjectName: string | null,
    date: string,
    tables: OverviewTables,
    positions: Record<string, unknown>[],
    scope: OperationsScope,
    truncated: string[],
  ) {
    const can = (source: OperationsSource) =>
      !scope.sources || scope.sources[source];
    const {
      reports,
      units,
      profiles,
      mappings,
      balances,
      receipts,
      incidents,
      hazards,
      certificates,
      issues,
      salesOrders,
      purchaseOrders,
      salesShipments,
      purchaseReceipts,
      maintenanceOrders,
      downtimeEvents,
      assignments,
    } = tables;

    const today = businessDate(this.timeZone);
    const dayReports = reports;
    const unitMap = new Map(
      units.map((row) => [text(row.id), text(row.name)] as const),
    );
    const profileUnits = new Set(profiles.map((row) => text(row.unitId)));
    const unitRows = new Map<
      string,
      {
        unitId: string;
        unitName: string;
        reports: number;
        processed: string;
        metal: string;
        sand: string;
        metalRate: string | null;
      }
    >();
    for (const unitId of profileUnits) {
      unitRows.set(unitId, {
        unitId,
        unitName: unitMap.get(unitId) ?? unitId,
        reports: 0,
        processed: '0',
        metal: '0',
        sand: '0',
        metalRate: null,
      });
    }
    let processed = 0n;
    let metal = 0n;
    let sand = 0n;
    for (const report of dayReports) {
      const unitId = text(report.unitId);
      const current = unitRows.get(unitId) ?? {
        unitId,
        unitName: unitMap.get(unitId) ?? unitId,
        reports: 0,
        processed: '0',
        metal: '0',
        sand: '0',
        metalRate: null,
      };
      const reportProcessed = amount(report.processedQuantity);
      const reportMetal = amount(report.metalQuantity);
      const reportSand = amount(report.sandQuantity);
      current.reports += 1;
      current.processed = decimal(amount(current.processed) + reportProcessed);
      current.metal = decimal(amount(current.metal) + reportMetal);
      current.sand = decimal(amount(current.sand) + reportSand);
      current.metalRate = rate(
        amount(current.metal),
        amount(current.processed),
      );
      unitRows.set(unitId, current);
      processed += reportProcessed;
      metal += reportMetal;
      sand += reportSand;
    }

    const skuTypes = new Map<string, string>();
    for (const mapping of mappings) {
      const skuId = text(mapping.skuId);
      const role = text(mapping.role);
      if (!skuId) continue;
      if (role === 'product') skuTypes.set(skuId, 'metal');
      else if (role === 'byproduct') skuTypes.set(skuId, 'sand');
    }
    let stockMetal = 0n;
    let stockSand = 0n;
    for (const balance of balances) {
      const type = skuTypes.get(text(balance.skuId));
      if (type === 'metal') stockMetal += amount(balance.quantity);
      else if (type === 'sand') stockSand += amount(balance.quantity);
    }

    const dayReceipts = receipts.filter((row) => day(row.occurredOn) === date);
    const receiptCount = (statuses: string[]) =>
      dayReceipts.filter((row) => statuses.includes(text(row.status))).length;
    const openIncidents = incidents.filter(
      (row) => text(row.status) !== 'closed',
    );
    const openHazards = hazards.filter((row) => text(row.status) !== 'closed');
    const overdueHazards = openHazards.filter((row) => {
      const due = day(row.dueAt);
      return Boolean(due) && due < today;
    });
    const limit = addDays(today, 90);
    const expiringCertificates = certificates.filter((row) => {
      const expiry = day(row.expiresAt);
      return Boolean(expiry) && expiry >= today && expiry <= limit;
    });
    const openOrder = (row: Record<string, unknown>) =>
      ['draft', 'pending', 'approved'].includes(text(row.status));
    const shippedToday = salesShipments.filter(
      (row) => day(row.occurredOn) === date && text(row.status) === 'posted',
    );
    const receivedToday = purchaseReceipts.filter(
      (row) => day(row.occurredOn) === date && text(row.status) === 'posted',
    );
    const productionPositions = new Set(
      positions
        .filter((row) => text(row.productionRole) === 'production')
        .map((row) => text(row.id)),
    );
    const activeAssignments = assignments.filter((row) => {
      const data = (row.data ?? {}) as Record<string, unknown>;
      if (text(data.type) !== 'primary') return false;
      const start = day(data.startDate);
      const end = day(data.endDate);
      if (start && start > date) return false;
      if (end && end < date) return false;
      return Boolean(text(row.personId));
    });
    const activePeople = new Set(
      activeAssignments.map((row) => text(row.personId)),
    );
    const productionPeople = new Set(
      activeAssignments
        .filter((row) => productionPositions.has(text(row.positionId)))
        .map((row) => text(row.personId)),
    );
    const openMaintenance = maintenanceOrders.filter(
      (row) =>
        text(row.status) === 'reported' || text(row.status) === 'in_progress',
    );
    const openDowntime = downtimeEvents.filter(
      (row) => text(row.status) === 'open',
    );
    const downtimeMinutesToday = downtimeEvents
      .filter(
        (row) =>
          businessDate(this.timeZone, new Date(text(row.startedAt))) === date,
      )
      .reduce((total, row) => total + Number(row.durationMinutes ?? 0), 0);
    const openIssues = issues.filter((row) => text(row.status) !== 'closed');
    const overdueIssues = openIssues.filter((row) => {
      const due = day(row.dueAt);
      return Boolean(due) && due < today;
    });

    return {
      date,
      subjectId,
      subjectName,
      production: can('production')
        ? {
            reports: dayReports.length,
            processed: decimal(processed),
            metal: decimal(metal),
            sand: decimal(sand),
            metalRate: rate(metal, processed),
          }
        : null,
      warehouse: can('warehouse')
        ? {
            receiptDraft: receiptCount(['draft']),
            receiptPending: receiptCount(['pending']),
            receiptPosted: receiptCount(['posted']),
            stockMetal: decimal(stockMetal),
            stockSand: decimal(stockSand),
            stockConfigured: mappings.length > 0,
          }
        : null,
      hse: can('hse')
        ? {
            incidentsOpen: openIncidents.length,
            hazardsOpen: openHazards.length,
            hazardsOverdue: overdueHazards.length,
            certificatesExpiring90: expiringCertificates.length,
          }
        : null,
      sales: can('sales')
        ? {
            openOrders: salesOrders.filter(openOrder).length,
            shippedToday: shippedToday.length,
          }
        : null,
      procurement: can('procurement')
        ? {
            openOrders: purchaseOrders.filter(openOrder).length,
            receivedToday: receivedToday.length,
          }
        : null,
      people: can('people')
        ? {
            active: activePeople.size,
            production: productionPeople.size,
          }
        : null,
      issues: {
        open: openIssues.length,
        overdue: overdueIssues.length,
      },
      maintenance: can('production')
        ? { openOrders: openMaintenance.length }
        : null,
      downtime: can('production')
        ? {
            open: openDowntime.length,
            minutesToday: downtimeMinutesToday,
          }
        : null,
      units: can('production')
        ? [...unitRows.values()].sort((a, b) =>
            a.unitName.localeCompare(b.unitName, 'zh-CN'),
          )
        : [],
      notes: {
        truncated,
        salesConnected: true,
        procurementConnected: true,
        peopleConnected: true,
        peopleScope: 'active_primary_assignment' as const,
        maskedSources: scope.sources
          ? (Object.entries(scope.sources)
              .filter(([, allowed]) => !allowed)
              .map(([source]) => source) as OperationsSource[])
          : [],
      },
    };
  }

  /**
   * One overview per authorized company, for the card view.
   *
   * Loads every aggregated table once for the whole company batch (instead
   * of re-running the overview per company), then groups the rows per
   * company and runs the shared aggregation for each. Positions are
   * company-agnostic and shared across the batch.
   */
  async companyOverview(
    principal: OperationsPrincipal,
    query: OperationsOverviewQuery,
    scope: OperationsScope,
  ) {
    const date = query.date ?? businessDate(this.timeZone);
    const { subjects } = await this.subjectRows(principal, scope);
    // `subjectRows` caps the list at the query's own limit; the whole
    // authorized batch is loaded here so a group larger than one IN-list
    // chunk still renders every company card.
    const batch = subjects;
    const ids = batch.map((subject) => text(subject.id));
    const names = new Map(
      batch.map((subject) => [text(subject.id), text(subject.name)]),
    );
    const { tables, positions, truncated } = await this.loadOverviewTables(
      ids,
      date,
      scope,
    );
    const buckets = new Map<string, OverviewTables>(
      ids.map((id) => [id, emptyOverviewTables()]),
    );
    for (const key of overviewTableKeys) {
      for (const row of tables[key]) {
        const subjectId = text(row.subjectId);
        const bucket = buckets.get(subjectId);
        if (!bucket) continue;
        bucket[key].push(row);
      }
    }
    const items = ids.map((id) =>
      this.buildOverview(
        id,
        names.get(id) ?? id,
        date,
        buckets.get(id) ?? emptyOverviewTables(),
        positions,
        scope,
        truncated,
      ),
    );
    return { date, items };
  }

  async listTargets(
    principal: OperationsPrincipal,
    query: OperationsTargetQuery,
    scope: OperationsScope,
  ) {
    const subjectId = await this.resolveSubject(
      principal,
      query.subjectId,
      scope,
    );
    const filter = {
      ...(subjectId ? { subjectId } : {}),
      ...(query.period ? { period: query.period } : {}),
    };
    const [rows, total] = await Promise.all([
      this.database.repository('opsKpiTargets').findMany({
        filter,
        limit: 500,
        sort: (sort) => [
          sort.field('period').desc(),
          sort.field('metric').asc(),
        ],
      }),
      this.database.repository('opsKpiTargets').count({ filter }),
    ]);
    const actuals = new Map<
      string,
      {
        processed: string;
        metal: string;
        sand: string;
        metalRate: string | null;
      }
    >();
    for (const row of rows) {
      const subjectId = text(row.subjectId);
      const period = text(row.period);
      const key = `${subjectId}:${period}`;
      if (!actuals.has(key)) {
        actuals.set(key, await this.targetActuals(subjectId, period));
      }
    }
    return {
      items: rows.map((row) => {
        const key = `${text(row.subjectId)}:${text(row.period)}`;
        return this.target(row, actuals.get(key));
      }),
      total,
    };
  }

  async saveTarget(
    principal: OperationsPrincipal,
    input: OperationsTargetInput,
    scope: OperationsScope,
  ) {
    const subjectId = await this.resolveSubject(
      principal,
      input.subjectId,
      scope,
    );
    if (!subjectId || subjectId !== input.subjectId)
      throw new OperationsError('OPERATIONS_FORBIDDEN');
    const subject = await this.database
      .repository('orgSubjects')
      .findOne({ filter: { id: subjectId } });
    if (!subject)
      throw new OperationsError('OPERATIONS_INVALID', 'SUBJECT_NOT_FOUND');
    const now = new Date();
    const saved = await this.database.transaction(async (connection) => {
      const existing = await connection.repository('opsKpiTargets').findOne({
        filter: {
          subjectId,
          period: input.period,
          metric: input.metric,
        },
      });
      const targetId = existing ? text(existing.id) : randomUUID();
      const nextVersion = existing ? Number(existing.version) + 1 : 1;
      if (existing) {
        // `opsKpiTargets` is versioned, so claim the row by its current version
        // to reject a concurrent save instead of overwriting it. The filter
        // still keys on the row id when a version column is absent, keeping the
        // conditional update inside the transaction.
        const updated = await connection.repository('opsKpiTargets').updateOne({
          filter: {
            id: targetId,
            ...(existing.version !== undefined
              ? { version: Number(existing.version) }
              : {}),
          },
          values: {
            targetValue: input.targetValue,
            version: nextVersion,
            updatedBy: principal.id,
            updatedAt: now,
          },
        });
        if (!updated.record)
          throw new OperationsError('OPERATIONS_CONFLICT', 'VERSION_CONFLICT');
      } else {
        await connection.repository('opsKpiTargets').createOne({
          values: {
            id: targetId,
            subjectId,
            period: input.period,
            metric: input.metric,
            targetValue: input.targetValue,
            version: 1,
            createdBy: principal.id,
            updatedBy: principal.id,
            createdAt: now,
            updatedAt: now,
          },
        });
      }
      await connection.repository('opsKpiTargetHistory').createOne({
        values: {
          id: randomUUID(),
          targetId,
          subjectId,
          period: input.period,
          metric: input.metric,
          beforeValue: existing
            ? {
                targetValue: text(existing.targetValue),
                version: Number(existing.version),
                updatedBy: text(existing.updatedBy),
              }
            : null,
          afterValue: {
            targetValue: input.targetValue,
            version: nextVersion,
          },
          version: nextVersion,
          actorId: principal.id,
          createdAt: now,
        },
      });
      return connection.repository('opsKpiTargets').findOne({
        filter: {
          subjectId,
          period: input.period,
          metric: input.metric,
        },
      });
    });
    return this.target(saved ?? {});
  }

  private async targetActuals(subjectId: string, period: string) {
    const [year, month] = period.split('-').map(Number);
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const rows = await this.database.repository('prdShiftReports').findMany({
      filter: (f: FilterBuilder) =>
        f.and([
          f.string('subjectId').eq(subjectId),
          f.string('status').eq('confirmed'),
          f.date('reportDate').notBefore(`${period}-01`),
          f.date('reportDate').notAfter(
            `${period}-${String(lastDay).padStart(2, '0')}`,
          ),
        ]),
      limit: 50_000,
    });
    let processed = 0n;
    let metal = 0n;
    let sand = 0n;
    for (const row of rows) {
      processed += amount(row.processedQuantity);
      metal += amount(row.metalQuantity);
      sand += amount(row.sandQuantity);
    }
    return {
      processed: decimal(processed),
      metal: decimal(metal),
      sand: decimal(sand),
      metalRate: rate(metal, processed),
    };
  }

  private periodProgress(period: string) {
    const today = businessDate(this.timeZone);
    const current = today.slice(0, 7);
    const [year, month] = period.split('-').map(Number);
    const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (!Number.isFinite(days) || days <= 0) return 0;
    if (period === current) {
      const elapsed = Number(today.slice(8, 10));
      return Number(((elapsed / days) * 100).toFixed(1));
    }
    return period < current ? 100 : 0;
  }

  private target(
    row: Record<string, unknown>,
    actuals?: {
      processed: string;
      metal: string;
      sand: string;
      metalRate: string | null;
    },
  ) {
    const metric = text(row.metric) as OperationsTargetMetric;
    const actualValue = actuals ? actuals[metric] : null;
    const targetMinor = amount(row.targetValue);
    const actualMinor = actualValue === null ? null : amount(actualValue);
    const achievementPct =
      actualMinor !== null && targetMinor > 0n
        ? ((Number(actualMinor) / Number(targetMinor)) * 100).toFixed(1)
        : null;
    const progressPct = this.periodProgress(text(row.period));
    const status:
      'no_data' | 'achieved' | 'on_track' | 'behind' | 'not_started' =
      actualValue === null || achievementPct === null
        ? 'no_data'
        : Number(achievementPct) >= 100
          ? 'achieved'
          : progressPct <= 0
            ? 'not_started'
            : progressPct >= 100
              ? 'behind'
              : Number(achievementPct) >= progressPct
                ? 'on_track'
                : 'behind';
    return {
      id: text(row.id),
      subjectId: text(row.subjectId),
      period: text(row.period),
      metric,
      targetValue: text(row.targetValue),
      actualValue,
      achievementPct,
      progressPct,
      varianceValue:
        actualMinor === null ? null : decimal(actualMinor - targetMinor),
      status,
      version: Number(row.version ?? 1),
      updatedAt: text(row.updatedAt),
    };
  }

  async listIssues(
    principal: OperationsPrincipal,
    query: OperationsIssueQuery,
    scope: OperationsScope,
  ) {
    const subjectId = await this.resolveSubject(
      principal,
      query.subjectId,
      scope,
    );
    const filter = {
      ...(subjectId ? { subjectId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const scopedFilter = Object.keys(filter).length > 0 ? filter : undefined;
    const [rows, total] = await Promise.all([
      this.database.repository('opsIssues').findMany({
        filter: scopedFilter,
        limit: query.pageSize,
        offset: (query.page - 1) * query.pageSize,
        sort: (sort) => [
          sort.field('status').desc(),
          sort.field('dueAt').asc(),
          sort.field('createdAt').desc(),
        ],
      }),
      this.database.repository('opsIssues').count({ filter: scopedFilter }),
    ]);
    return {
      items: rows.map((row) => this.issue(row)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async createIssue(
    principal: OperationsPrincipal,
    input: OperationsIssueInput,
    scope: OperationsScope,
  ) {
    const subjectId = await this.resolveSubject(
      principal,
      input.subjectId,
      scope,
    );
    if (!subjectId)
      throw new OperationsError('OPERATIONS_INVALID', 'SUBJECT_REQUIRED');
    const subject = await this.database
      .repository('orgSubjects')
      .findOne({ filter: { id: subjectId } });
    if (!subject)
      throw new OperationsError('OPERATIONS_INVALID', 'SUBJECT_NOT_FOUND');
    if (input.unitId) {
      const unit = await this.database
        .repository('orgUnits')
        .findOne({ filter: { id: input.unitId } });
      if (!unit || text(unit.subjectId) !== subjectId)
        throw new OperationsError('OPERATIONS_INVALID', 'UNIT_NOT_FOUND');
    }
    await this.assertOwner(subjectId, input.ownerId);
    const id = randomUUID();
    const now = new Date();
    const code = `OPS-${businessDate(this.timeZone).replaceAll('-', '')}-${id.slice(0, 4).toUpperCase()}`;
    await this.database.repository('opsIssues').createOne({
      values: {
        id,
        code,
        subjectId,
        unitId: input.unitId ?? null,
        ownerId: input.ownerId ?? null,
        sourceType: input.sourceType,
        sourceId: input.sourceId ?? null,
        title: input.title,
        description: input.description,
        severity: input.severity,
        ownerName: input.ownerName,
        dueAt: input.dueAt,
        businessDate: input.businessDate ?? businessDate(this.timeZone),
        status: 'open',
        resolution: '',
        closedAt: null,
        closedBy: null,
        version: 1,
        createdBy: principal.id,
        updatedBy: principal.id,
        createdAt: now,
        updatedAt: now,
      },
    });
    return this.getIssue(principal, id, scope);
  }

  async updateIssue(
    principal: OperationsPrincipal,
    id: string,
    input: OperationsIssueUpdate,
    scope: OperationsScope,
  ) {
    const existing = await this.getIssue(principal, id, scope);
    if (Number(existing.version) !== input.version)
      throw new OperationsError('OPERATIONS_CONFLICT', 'VERSION_CONFLICT');
    if (existing.status === 'closed')
      throw new OperationsError('OPERATIONS_CONFLICT', 'ISSUE_CLOSED_IMMUTABLE');
    if (
      input.status &&
      input.status !== existing.status &&
      !issueTransitionAllowed(existing.status, input.status)
    )
      throw new OperationsError(
        'OPERATIONS_INVALID',
        'ISSUE_TRANSITION_INVALID',
      );
    if (input.status === 'closed' && !input.resolution?.trim())
      throw new OperationsError('OPERATIONS_INVALID', 'RESOLUTION_REQUIRED');
    if (input.ownerId !== undefined)
      await this.assertOwner(existing.subjectId, input.ownerId);
    const now = new Date();
    const status = input.status ?? existing.status;
    await this.database.repository('opsIssues').updateOne({
      filter: { id, version: input.version },
      values: {
        ...(input.status ? { status: input.status } : {}),
        ...(input.severity ? { severity: input.severity } : {}),
        ...(input.ownerName ? { ownerName: input.ownerName } : {}),
        ...(input.ownerId !== undefined ? { ownerId: input.ownerId } : {}),
        ...(input.dueAt ? { dueAt: input.dueAt } : {}),
        ...(input.resolution !== undefined
          ? { resolution: input.resolution }
          : {}),
        ...(status === 'closed'
          ? { closedAt: now, closedBy: principal.id }
          : {}),
        version: input.version + 1,
        updatedBy: principal.id,
        updatedAt: now,
      },
    });
    return this.getIssue(principal, id, scope);
  }

  private async assertOwner(
    subjectId: string,
    ownerId: string | null | undefined,
  ) {
    if (!ownerId) return;
    const position = await this.database
      .repository('orgPositions')
      .findOne({ filter: { id: ownerId } });
    if (!position)
      throw new OperationsError('OPERATIONS_INVALID', 'OWNER_NOT_FOUND');
    if (text(position.status) !== 'active')
      throw new OperationsError('OPERATIONS_INVALID', 'OWNER_NOT_IN_COMPANY');
    const unit = position.unitId
      ? await this.database
          .repository('orgUnits')
          .findOne({ filter: { id: text(position.unitId) } })
      : null;
    if (!unit || text(unit.subjectId) !== subjectId)
      throw new OperationsError('OPERATIONS_INVALID', 'OWNER_NOT_IN_COMPANY');
  }

  private async getIssue(
    principal: OperationsPrincipal,
    id: string,
    scope: OperationsScope,
  ) {
    const row = await this.database
      .repository('opsIssues')
      .findOne({ filter: { id } });
    if (!row)
      throw new OperationsError('OPERATIONS_INVALID', 'ISSUE_NOT_FOUND');
    const subjectId = await this.resolveSubject(
      principal,
      text(row.subjectId),
      scope,
    );
    if (subjectId !== text(row.subjectId))
      throw new OperationsError('OPERATIONS_FORBIDDEN');
    return this.issue(row);
  }

  private issue(row: Record<string, unknown>) {
    return {
      id: text(row.id),
      code: text(row.code),
      subjectId: text(row.subjectId),
      unitId: row.unitId ? text(row.unitId) : null,
      ownerId: row.ownerId ? text(row.ownerId) : null,
      sourceType: text(row.sourceType),
      sourceId: row.sourceId ? text(row.sourceId) : null,
      title: text(row.title),
      description: text(row.description),
      severity: text(row.severity),
      ownerName: text(row.ownerName),
      dueAt: day(row.dueAt),
      businessDate: day(row.businessDate),
      status: text(row.status),
      resolution: text(row.resolution),
      version: Number(row.version ?? 0),
      closedAt: row.closedAt ? text(row.closedAt) : null,
    };
  }
}
