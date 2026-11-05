import { randomUUID } from 'node:crypto';
import type { DatabaseManager } from '@nocobase/db';
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
export type OperationsScope = { readAll: boolean };

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

  async options(principal: OperationsPrincipal, scope: OperationsScope) {
    const company = await this.resolveSubject(principal, undefined, scope);
    const subjects = await this.database.repository('orgSubjects').findMany({
      filter: {
        status: 'active',
        ...(company ? { id: company } : {}),
      },
      limit: 1000,
      sort: (sort) => [sort.field('sortOrder').asc(), sort.field('name').asc()],
    });
    return {
      subjects: subjects.map((row) => ({
        id: text(row.id),
        name: text(row.name),
      })),
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
    const subject = subjectId
      ? await this.database
          .repository('orgSubjects')
          .findOne({ filter: { id: subjectId } })
      : null;
    if (subjectId && !subject)
      throw new OperationsError('OPERATIONS_INVALID', 'SUBJECT_NOT_FOUND');

    const [
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
      positions,
    ] = await Promise.all([
      this.database.repository('prdShiftReports').findMany({
        filter: {
          status: 'confirmed',
          ...(subjectId ? { subjectId } : {}),
        },
        limit: 20000,
      }),
      this.database.repository('orgUnits').findMany({
        filter: {
          status: 'active',
          ...(subjectId ? { subjectId } : {}),
        },
        limit: 5000,
      }),
      this.database.repository('prdUnitProfiles').findMany({
        filter: {
          status: 'active',
          ...(subjectId ? { subjectId } : {}),
        },
        limit: 5000,
      }),
      this.database.repository('prdOutputMappings').findMany({
        filter: {
          status: 'active',
          ...(subjectId ? { subjectId } : {}),
        },
        limit: 5000,
      }),
      this.database.repository('stockBalances').findMany({
        filter: subjectId ? { subjectId } : undefined,
        limit: 20000,
      }),
      this.database.repository('stockDocuments').findMany({
        filter: {
          kind: 'productionReceipt',
          ...(subjectId ? { subjectId } : {}),
        },
        limit: 20000,
      }),
      this.database.repository('hseIncidents').findMany({
        filter: subjectId ? { subjectId } : undefined,
        limit: 5000,
      }),
      this.database.repository('hseHazards').findMany({
        filter: subjectId ? { subjectId } : undefined,
        limit: 5000,
      }),
      this.database.repository('hseCertificates').findMany({
        filter: subjectId ? { subjectId } : undefined,
        limit: 5000,
      }),
      this.database.repository('opsIssues').findMany({
        filter: subjectId ? { subjectId } : undefined,
        limit: 20000,
      }),
      this.database.repository('salesOrders').findMany({
        filter: subjectId ? { subjectId } : undefined,
        limit: 20000,
      }),
      this.database.repository('purchaseOrders').findMany({
        filter: subjectId ? { subjectId } : undefined,
        limit: 20000,
      }),
      this.database.repository('stockDocuments').findMany({
        filter: {
          kind: 'salesShipment',
          ...(subjectId ? { subjectId } : {}),
        },
        limit: 20000,
      }),
      this.database.repository('stockDocuments').findMany({
        filter: {
          kind: 'purchaseReceipt',
          ...(subjectId ? { subjectId } : {}),
        },
        limit: 20000,
      }),
      this.database.repository('prdMaintenanceOrders').findMany({
        filter: subjectId ? { subjectId } : undefined,
        limit: 5000,
      }),
      this.database.repository('prdDowntimeEvents').findMany({
        filter: subjectId ? { subjectId } : undefined,
        limit: 5000,
      }),
      this.database.repository('personnelAssignments').findMany({
        filter: {
          status: 'active',
          ...(subjectId ? { subjectId } : {}),
        },
        limit: 20000,
      }),
      this.database.repository('orgPositions').findMany({
        filter: { status: 'active' },
        limit: 5000,
      }),
    ]);

    const today = businessDate(this.timeZone);
    const dayReports = reports.filter((row) => day(row.reportDate) === date);
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
      if (skuId) skuTypes.set(skuId, text(mapping.outputType));
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
      subjectName: subject ? text(subject.name) : '全部公司',
      production: {
        reports: dayReports.length,
        processed: decimal(processed),
        metal: decimal(metal),
        sand: decimal(sand),
        metalRate: rate(metal, processed),
      },
      warehouse: {
        receiptDraft: receiptCount(['draft']),
        receiptPending: receiptCount(['pending']),
        receiptPosted: receiptCount(['posted']),
        stockMetal: decimal(stockMetal),
        stockSand: decimal(stockSand),
        stockConfigured: mappings.length > 0,
      },
      hse: {
        incidentsOpen: openIncidents.length,
        hazardsOpen: openHazards.length,
        hazardsOverdue: overdueHazards.length,
        certificatesExpiring90: expiringCertificates.length,
      },
      sales: {
        openOrders: salesOrders.filter(openOrder).length,
        shippedToday: shippedToday.length,
      },
      procurement: {
        openOrders: purchaseOrders.filter(openOrder).length,
        receivedToday: receivedToday.length,
      },
      people: {
        active: activePeople.size,
        production: productionPeople.size,
      },
      issues: {
        open: openIssues.length,
        overdue: overdueIssues.length,
      },
      maintenance: { openOrders: openMaintenance.length },
      downtime: {
        open: openDowntime.length,
        minutesToday: downtimeMinutesToday,
      },
      units: [...unitRows.values()].sort((a, b) =>
        a.unitName.localeCompare(b.unitName, 'zh-CN'),
      ),
      notes: {
        salesConnected: true,
        procurementConnected: true,
        peopleConnected: true,
        peopleScope: 'active_primary_assignment' as const,
      },
    };
  }

  /**
   * One overview per authorized company, for the card view.
   *
   * Early deployments have a handful of companies; running the existing
   * per-company query keeps the aggregation rules in one place. Revisit with a
   * grouped query when the company count grows.
   */
  async companyOverview(
    principal: OperationsPrincipal,
    query: OperationsOverviewQuery,
    scope: OperationsScope,
  ) {
    const date = query.date ?? businessDate(this.timeZone);
    const { subjects } = await this.options(principal, scope);
    const items = [];
    for (const subject of subjects.slice(0, 100))
      items.push(
        await this.overview(principal, { subjectId: subject.id, date }, scope),
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
    const rows = await this.database.repository('opsKpiTargets').findMany({
      filter: {
        ...(subjectId ? { subjectId } : {}),
        ...(query.period ? { period: query.period } : {}),
      },
      limit: 500,
      sort: (sort) => [sort.field('period').desc(), sort.field('metric').asc()],
    });
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
    const existing = await this.database.repository('opsKpiTargets').findOne({
      filter: {
        subjectId,
        period: input.period,
        metric: input.metric,
      },
    });
    const now = new Date();
    if (existing) {
      await this.database.repository('opsKpiTargets').updateOne({
        filter: { id: text(existing.id) },
        values: {
          targetValue: input.targetValue,
          version: Number(existing.version) + 1,
          updatedBy: principal.id,
          updatedAt: now,
        },
      });
    } else {
      await this.database.repository('opsKpiTargets').createOne({
        values: {
          id: randomUUID(),
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
    const row = await this.database.repository('opsKpiTargets').findOne({
      filter: {
        subjectId,
        period: input.period,
        metric: input.metric,
      },
    });
    return this.target(row ?? {});
  }

  private async targetActuals(subjectId: string, period: string) {
    const rows = await this.database.repository('prdShiftReports').findMany({
      filter: { subjectId, status: 'confirmed' },
      limit: 50_000,
    });
    let processed = 0n;
    let metal = 0n;
    let sand = 0n;
    for (const row of rows) {
      if (!text(row.reportDate).slice(0, 10).startsWith(`${period}-`)) continue;
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
          sort.field('status').asc(),
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
    const id = randomUUID();
    const now = new Date();
    const code = `OPS-${businessDate(this.timeZone).replaceAll('-', '')}-${id.slice(0, 4).toUpperCase()}`;
    await this.database.repository('opsIssues').createOne({
      values: {
        id,
        code,
        subjectId,
        unitId: input.unitId ?? null,
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
    if (input.status === 'closed' && !input.resolution?.trim())
      throw new OperationsError('OPERATIONS_INVALID', 'RESOLUTION_REQUIRED');
    const now = new Date();
    const status = input.status ?? existing.status;
    await this.database.repository('opsIssues').updateOne({
      filter: { id, version: input.version },
      values: {
        ...(input.status ? { status: input.status } : {}),
        ...(input.severity ? { severity: input.severity } : {}),
        ...(input.ownerName ? { ownerName: input.ownerName } : {}),
        ...(input.dueAt ? { dueAt: input.dueAt } : {}),
        ...(input.resolution !== undefined
          ? { resolution: input.resolution }
          : {}),
        ...(status === 'closed'
          ? { closedAt: now, closedBy: principal.id }
          : { closedAt: null, closedBy: null }),
        version: input.version + 1,
        updatedBy: principal.id,
        updatedAt: now,
      },
    });
    return this.getIssue(principal, id, scope);
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
