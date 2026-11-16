import { randomUUID } from 'node:crypto';
import type { DatabaseManager, RepositoryRecord } from '@nocobase/db';
import { createServiceToken } from '@nocobase/service-provider';
import { currentCompanyForUser } from './company-identity.js';
import { businessDate } from './business-date.js';
import type {
  HseActionCreate,
  HseActionQuery,
  HseActionTransition,
  HseActionUpdate,
  HseCertificateCreate,
  HseCertificateQuery,
  HseCertificateTransition,
  HseCertificateUpdate,
  HseHazardCreate,
  HseHazardQuery,
  HseHazardTransition,
  HseHazardUpdate,
  HseIncidentCreate,
  HseIncidentQuery,
  HseIncidentTransition,
  HseIncidentUpdate,
  HseInspectionCreate,
  HseInspectionQuery,
  HseInspectionTransition,
  HseInspectionUpdate,
  HseTrainingRecordCreate,
  HseTrainingRecordQuery,
  HseTrainingRecordUpdate,
  HseWorkPermitCreate,
  HseWorkPermitQuery,
  HseWorkPermitTransition,
  HseWorkPermitUpdate,
} from './hse-model.js';

export const hseServiceToken = createServiceToken<HseService>('group-erp/hse');

export type HsePrincipal = { type: string; id: string };
export type HseErrorCode =
  'HSE_FORBIDDEN' | 'HSE_NOT_FOUND' | 'HSE_CONFLICT' | 'HSE_INVALID';

export class HseError extends Error {
  constructor(
    public readonly code: HseErrorCode,
    message: string = code,
  ) {
    super(message);
    this.name = 'HseError';
  }
}

export type HseScope = {
  readAll: boolean;
  manage: boolean;
  approve: boolean;
  report: boolean;
};

type Row = RepositoryRecord;

const text = (value: unknown) => (typeof value === 'string' ? value : '');
const number = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const bool = (value: unknown) => value === true || value === 1;

type HistoryEntry = {
  at: string;
  by: string;
  action: string;
  from?: string;
  to?: string;
  note?: string;
};

function history(row: Row): HistoryEntry[] {
  let parsed: unknown = row.history;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(
      (entry): entry is HistoryEntry =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as HistoryEntry).at === 'string' &&
        typeof (entry as HistoryEntry).action === 'string',
    )
    .slice(-100);
}

function appendHistory(
  row: Row,
  entry: Omit<HistoryEntry, 'at' | 'by'>,
  principal: HsePrincipal,
  at: string,
): HistoryEntry[] {
  return [...history(row), { ...entry, at, by: principal.id }].slice(-100);
}

function subjectFilter(scope: string | null) {
  return scope ? { subjectId: scope } : undefined;
}

export class HseService {
  constructor(
    private readonly database: DatabaseManager,
    private readonly timeZone: string,
  ) {}

  private async resolveSubject(
    principal: HsePrincipal,
    requested: string | undefined,
    scope: HseScope,
    write = false,
  ): Promise<string | null> {
    if (scope.readAll) {
      if (write && !scope.manage) {
        // Group-level readers/reporters have no company scope of their
        // own. Creating records is only allowed inside the company of the
        // user's assignment, so an accidental or malicious subjectId for
        // another company is rejected instead of writing foreign records.
        const company = await currentCompanyForUser(
          this.database,
          this.timeZone,
          principal,
        );
        if (!company) throw new HseError('HSE_FORBIDDEN');
        if (requested && requested !== company)
          throw new HseError('HSE_FORBIDDEN');
        return requested ?? company;
      }
      if (requested) return requested;
      if (write) throw new HseError('HSE_INVALID', 'SUBJECT_REQUIRED');
      return null;
    }
    const company = await currentCompanyForUser(
      this.database,
      this.timeZone,
      principal,
    );
    if (!company) throw new HseError('HSE_FORBIDDEN');
    if (requested && requested !== company) throw new HseError('HSE_FORBIDDEN');
    return company;
  }

  /**
   * Resolve the company that owns a record bound to a file, after checking
   * that `principal` may see that company under the current HSE scope.
   */
  async fileSubject(
    principal: HsePrincipal,
    scope: HseScope,
    kind: 'incident' | 'hazard' | 'certificate',
    recordId: string,
  ): Promise<string> {
    const collection =
      kind === 'incident'
        ? 'hseIncidents'
        : kind === 'hazard'
          ? 'hseHazards'
          : 'hseCertificates';
    const row = await this.database
      .repository(collection)
      .findOne({ filter: { id: recordId } });
    if (!row) throw new HseError('HSE_NOT_FOUND');
    const subjectId = text(row.subjectId);
    await this.resolveSubject(principal, subjectId || undefined, scope, false);
    if (!subjectId) throw new HseError('HSE_NOT_FOUND');
    return subjectId;
  }

  private async assertUnit(
    subjectId: string,
    unitId: string | null | undefined,
  ) {
    if (!unitId) return;
    const unit = await this.database
      .repository('orgUnits')
      .findOne({ filter: { id: unitId } });
    if (!unit || text(unit.subjectId) !== subjectId)
      throw new HseError('HSE_INVALID', 'UNIT_NOT_IN_COMPANY');
  }

  private async employeeNames(
    subjectId: string | null,
    ids: readonly string[],
  ) {
    const names = new Map<string, string>();
    if (!ids.length || !subjectId) return names;
    const rows = await this.database.repository('personnelEmployees').findMany({
      filter: (f) => f.string('subjectId').eq(subjectId),
      limit: 5001,
    });
    for (const row of rows) {
      const id = text(row.id);
      if (ids.includes(id)) names.set(id, text(row.name));
    }
    return names;
  }

  private async assertOwner(
    subjectId: string,
    ownerId: string | null | undefined,
  ) {
    if (!ownerId) return;
    const employee = await this.database
      .repository('personnelEmployees')
      .findOne({ filter: { id: ownerId } });
    if (!employee) throw new HseError('HSE_INVALID', 'OWNER_NOT_FOUND');
    if (
      text(employee.subjectId) !== subjectId ||
      text(employee.status) !== 'active'
    )
      throw new HseError('HSE_INVALID', 'OWNER_NOT_IN_COMPANY');
  }

  private async assertHolder(subjectId: string, holderId: string) {
    const employee = await this.database
      .repository('personnelEmployees')
      .findOne({ filter: { id: holderId } });
    if (!employee) throw new HseError('HSE_INVALID', 'HOLDER_NOT_FOUND');
    if (
      text(employee.subjectId) !== subjectId ||
      text(employee.status) !== 'active'
    )
      throw new HseError('HSE_INVALID', 'HOLDER_NOT_IN_COMPANY');
  }

  private async subjectNames(scope: string | null) {
    const rows = await this.database.repository('orgSubjects').findMany({
      filter: scope ? { id: scope } : undefined,
      limit: 1000,
    });
    return new Map(rows.map((row) => [text(row.id), text(row.name)] as const));
  }

  private async scopedRows(
    table: string,
    scope: string | null,
    sortField: string,
  ): Promise<Row[]> {
    return this.database.repository(table).findMany({
      filter: subjectFilter(scope),
      limit: 10000,
      sort: (sort) => [sort.field(sortField).desc(), sort.field('id').asc()],
    });
  }

  async options(principal: HsePrincipal, scope: HseScope) {
    const company = await this.resolveSubject(principal, undefined, scope);
    const subjects = await this.database.repository('orgSubjects').findMany({
      filter: {
        status: 'active',
        ...(company ? { id: company } : {}),
      },
      limit: 1000,
      sort: (sort) => [sort.field('sortOrder').asc(), sort.field('name').asc()],
    });
    const units = await this.database.repository('orgUnits').findMany({
      filter: {
        status: 'active',
        ...(company ? { subjectId: company } : {}),
      },
      limit: 5000,
      sort: (sort) => [sort.field('sortOrder').asc(), sort.field('name').asc()],
    });
    const employees = await this.database
      .repository('personnelEmployees')
      .findMany({
        filter: {
          status: 'active',
          ...(company ? { subjectId: company } : {}),
        },
        limit: 5000,
        sort: (sort) => [sort.field('code').asc(), sort.field('name').asc()],
      });
    return {
      subjects: subjects.map((row) => ({
        id: text(row.id),
        code: text(row.code),
        name: text(row.name),
        type: text(row.type),
      })),
      units: units.map((row) => ({
        id: text(row.id),
        name: text(row.name),
        subjectId: text(row.subjectId),
      })),
      employees: employees.map((row) => ({
        id: text(row.id),
        code: text(row.code),
        name: text(row.name),
        subjectId: text(row.subjectId),
      })),
      permissions: {
        manage: scope.manage,
        approve: scope.approve,
        report: scope.report,
      },
    };
  }

  async overview(
    principal: HsePrincipal,
    scope: HseScope,
    query: { subjectId?: string; horizonDays?: number } = {},
  ) {
    const company = await this.resolveSubject(
      principal,
      query.subjectId,
      scope,
    );
    const horizonDays = query.horizonDays ?? 90;
    const today = businessDate(this.timeZone);
    const horizon = new Date(`${today}T00:00:00Z`);
    horizon.setUTCDate(horizon.getUTCDate() + horizonDays);
    const horizonDate = horizon.toISOString().slice(0, 10);
    const [incidents, hazards, certificates, names] = await Promise.all([
      this.scopedRows('hseIncidents', company, 'occurredAt'),
      this.scopedRows('hseHazards', company, 'discoveredAt'),
      this.scopedRows('hseCertificates', company, 'expiresAt'),
      this.subjectNames(company),
    ]);
    const openIncidents = incidents.filter((row) =>
      ['reported', 'investigating', 'rectifying', 'verifying'].includes(
        text(row.status),
      ),
    );
    const openHazards = hazards.filter((row) =>
      ['open', 'rectifying', 'verifying'].includes(text(row.status)),
    );
    const overdueHazards = openHazards.filter(
      (row) => row.dueAt && text(row.dueAt) < today,
    );
    const expiringCertificates = certificates.filter(
      (row) =>
        text(row.status) === 'active' &&
        row.expiresAt &&
        text(row.expiresAt) <= horizonDate &&
        text(row.expiresAt) >= today,
    );
    const withSubject = (row: Row) => ({
      ...row,
      subjectName: names.get(text(row.subjectId)) ?? '',
    });
    return {
      businessDate: today,
      scope: company ? 'company' : 'group',
      horizonDays,
      counts: {
        incidentsOpen: openIncidents.length,
        incidentsLti: incidents.filter((row) => number(row.lostDays) > 0)
          .length,
        hazardsOpen: openHazards.length,
        hazardsOverdue: overdueHazards.length,
        certificatesExpiring90: expiringCertificates.length,
      },
      recentIncidents: openIncidents.slice(0, 5).map(withSubject),
      recentHazards: openHazards.slice(0, 5).map(withSubject),
      expiringCertificates: expiringCertificates.slice(0, 5).map(withSubject),
    };
  }

  private async incidentRows(
    principal: HsePrincipal,
    query: { subjectId?: string; status?: string; type?: string },
    scope: HseScope,
  ) {
    const company = await this.resolveSubject(
      principal,
      query.subjectId,
      scope,
    );
    const names = await this.subjectNames(company);
    let rows = await this.scopedRows('hseIncidents', company, 'occurredAt');
    if (query.status) rows = rows.filter((row) => row.status === query.status);
    if (query.type) rows = rows.filter((row) => row.type === query.type);
    const ownerIds = [
      ...new Set(
        rows
          .map((row) => text(row.ownerId))
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const ownerNames = await this.employeeNames(company, ownerIds);
    return {
      rows: rows.map((row) => ({
        ...row,
        environmentalRelease: bool(row.environmentalRelease),
        subjectName: names.get(text(row.subjectId)) ?? '',
        ownerName: ownerNames.get(text(row.ownerId)) ?? '',
      })),
    };
  }

  async listIncidents(
    principal: HsePrincipal,
    query: HseIncidentQuery,
    scope: HseScope,
  ) {
    const { rows } = await this.incidentRows(principal, query, scope);
    const total = rows.length;
    const start = (query.page - 1) * query.pageSize;
    return {
      data: rows.slice(start, start + query.pageSize),
      meta: { page: query.page, pageSize: query.pageSize, total },
    };
  }

  async exportIncidents(
    principal: HsePrincipal,
    query: { subjectId?: string; status?: string; type?: string },
    scope: HseScope,
  ) {
    const { rows } = await this.incidentRows(principal, query, scope);
    const limit = 5000;
    return {
      data: rows.slice(0, limit),
      meta: { total: rows.length, truncated: rows.length > limit },
    };
  }

  async createIncident(
    principal: HsePrincipal,
    input: HseIncidentCreate,
    scope: HseScope,
  ) {
    const subjectId = await this.resolveSubject(
      principal,
      input.subjectId,
      scope,
      true,
    );
    if (!subjectId) throw new HseError('HSE_INVALID', 'SUBJECT_REQUIRED');
    await this.assertUnit(subjectId, input.unitId);
    const now = new Date().toISOString();
    const no = `HSE-INC-${businessDate(this.timeZone).replaceAll('-', '')}-${randomUUID().slice(0, 4).toUpperCase()}`;
    const record = await this.database.repository('hseIncidents').createOne({
      values: {
        id: randomUUID(),
        subjectId,
        unitId: input.unitId ?? null,
        incidentNo: no,
        occurredAt: new Date(input.occurredAt).toISOString(),
        type: input.type,
        severity: input.severity,
        location: input.location,
        description: input.description,
        injuryCount: input.injuryCount,
        lostDays: input.lostDays,
        environmentalRelease: input.environmentalRelease ? 1 : 0,
        status: 'reported',
        history: [],
        investigatorId: null,
        ownerId: null,
        dueAt: null,
        rootCause: '',
        actions: '',
        rectifiedBy: null,
        rectifiedAt: null,
        verifiedBy: null,
        verifiedAt: null,
        closedBy: null,
        closedAt: null,
        version: 1,
        createdBy: principal.id,
        updatedBy: principal.id,
        createdAt: now,
        updatedAt: now,
      },
    });
    return {
      ...record.record,
      environmentalRelease: bool(record.record.environmentalRelease),
    };
  }

  async updateIncident(
    principal: HsePrincipal,
    id: string,
    input: HseIncidentUpdate,
    scope: HseScope,
  ) {
    const existing = await this.database
      .repository('hseIncidents')
      .findOne({ filter: { id } });
    if (!existing) throw new HseError('HSE_NOT_FOUND');
    const subjectId = await this.resolveSubject(
      principal,
      text(existing.subjectId),
      scope,
    );
    if (subjectId && subjectId !== text(existing.subjectId))
      throw new HseError('HSE_FORBIDDEN');
    if (number(existing.version) !== input.version)
      throw new HseError('HSE_CONFLICT');
    if (text(existing.status) === 'closed')
      throw new HseError('HSE_INVALID', 'INCIDENT_CLOSED');
    // A verifying incident is under approval: direct PATCH would let the
    // submitter rewrite the evidence while the approver is deciding, so edits
    // must go through the return/verify transitions instead.
    if (text(existing.status) === 'verifying')
      throw new HseError('HSE_INVALID', 'INCIDENT_STATE');
    if (input.ownerId !== undefined) {
      const company = await this.resolveSubject(
        principal,
        text(existing.subjectId),
        scope,
      );
      if (!company) throw new HseError('HSE_FORBIDDEN');
      await this.assertOwner(company, input.ownerId);
    }
    const now = new Date().toISOString();
    const values: Record<string, unknown> = {
      version: input.version + 1,
      updatedBy: principal.id,
      updatedAt: now,
      history: appendHistory(
        existing,
        {
          action: 'update',
          from: text(existing.status),
          to: text(existing.status),
        },
        principal,
        now,
      ),
    };
    for (const key of [
      'severity',
      'investigatorId',
      'ownerId',
      'dueAt',
      'rootCause',
      'actions',
      'injuryCount',
      'lostDays',
    ] as const) {
      if (input[key] !== undefined) values[key] = input[key];
    }
    if (input.environmentalRelease !== undefined)
      values.environmentalRelease = input.environmentalRelease ? 1 : 0;
    const result = await this.database.repository('hseIncidents').updateOne({
      filter: { id, version: input.version },
      values: values as never,
    });
    if (!result.record) throw new HseError('HSE_CONFLICT');
    return {
      ...result.record,
      environmentalRelease: bool(result.record.environmentalRelease),
    };
  }

  async transitionIncident(
    principal: HsePrincipal,
    id: string,
    input: HseIncidentTransition,
    scope: HseScope,
  ) {
    const existing = await this.database
      .repository('hseIncidents')
      .findOne({ filter: { id } });
    if (!existing) throw new HseError('HSE_NOT_FOUND');
    const subjectId = await this.resolveSubject(
      principal,
      text(existing.subjectId),
      scope,
    );
    if (subjectId && subjectId !== text(existing.subjectId))
      throw new HseError('HSE_FORBIDDEN');
    if (number(existing.version) !== input.version)
      throw new HseError('HSE_CONFLICT');
    const from = text(existing.status);
    if (from === 'closed') throw new HseError('HSE_INVALID', 'INCIDENT_CLOSED');
    const now = new Date().toISOString();
    const values: Record<string, unknown> = {
      version: input.version + 1,
      updatedBy: principal.id,
      updatedAt: now,
    };
    const rootCause = (input.rootCause ?? text(existing.rootCause)).trim();
    const actions = (input.actions ?? text(existing.actions)).trim();
    let to: string;
    if (input.action === 'investigate') {
      if (!scope.manage) throw new HseError('HSE_FORBIDDEN');
      if (from !== 'reported')
        throw new HseError('HSE_INVALID', 'INCIDENT_STATE');
      to = 'investigating';
      values.status = to;
      values.investigatorId =
        input.investigatorId ?? (text(existing.investigatorId) || principal.id);
    } else if (input.action === 'rectify') {
      if (!scope.manage) throw new HseError('HSE_FORBIDDEN');
      if (!['investigating', 'rectifying'].includes(from))
        throw new HseError('HSE_INVALID', 'INCIDENT_STATE');
      if (!rootCause) throw new HseError('HSE_INVALID', 'ROOT_CAUSE_REQUIRED');
      const ownerId = (input.ownerId ?? text(existing.ownerId)) || null;
      const dueAt = (input.dueAt ?? text(existing.dueAt)) || null;
      if (!ownerId) throw new HseError('HSE_INVALID', 'OWNER_REQUIRED');
      if (!dueAt) throw new HseError('HSE_INVALID', 'DUE_REQUIRED');
      if (!subjectId) throw new HseError('HSE_FORBIDDEN');
      await this.assertOwner(subjectId, ownerId);
      to = 'rectifying';
      values.status = to;
      values.rootCause = rootCause;
      values.ownerId = ownerId;
      values.dueAt = dueAt;
      if (input.actions !== undefined) values.actions = actions;
    } else if (input.action === 'submit') {
      if (!scope.manage) throw new HseError('HSE_FORBIDDEN');
      if (from !== 'rectifying')
        throw new HseError('HSE_INVALID', 'INCIDENT_STATE');
      if (!actions) throw new HseError('HSE_INVALID', 'ACTIONS_REQUIRED');
      to = 'verifying';
      values.status = to;
      values.actions = actions;
      values.rectifiedBy = principal.id;
      values.rectifiedAt = now;
    } else if (input.action === 'verify') {
      if (!scope.approve) throw new HseError('HSE_FORBIDDEN');
      if (from !== 'verifying')
        throw new HseError('HSE_INVALID', 'INCIDENT_STATE');
      const rectifiedBy =
        text(existing.rectifiedBy) || text(existing.updatedBy);
      if (rectifiedBy === principal.id)
        throw new HseError('HSE_INVALID', 'SELF_VERIFICATION');
      to = 'closed';
      values.status = to;
      values.verifiedBy = principal.id;
      values.verifiedAt = now;
      values.closedBy = principal.id;
      values.closedAt = now;
    } else {
      if (!scope.approve) throw new HseError('HSE_FORBIDDEN');
      if (from !== 'verifying')
        throw new HseError('HSE_INVALID', 'INCIDENT_STATE');
      const note = (input.note ?? '').trim();
      if (!note) throw new HseError('HSE_INVALID', 'RETURN_REASON_REQUIRED');
      to = 'rectifying';
      values.status = to;
      values.rectifiedBy = null;
      values.rectifiedAt = null;
    }
    values.history = appendHistory(
      existing,
      { action: input.action, from, to, note: input.note },
      principal,
      now,
    );
    const result = await this.database.repository('hseIncidents').updateOne({
      filter: { id, version: input.version },
      values: values as never,
    });
    if (!result.record) throw new HseError('HSE_CONFLICT');
    return {
      ...result.record,
      environmentalRelease: bool(result.record.environmentalRelease),
    };
  }

  private async hazardRows(
    principal: HsePrincipal,
    query: { subjectId?: string; status?: string; level?: string },
    scope: HseScope,
  ) {
    const company = await this.resolveSubject(
      principal,
      query.subjectId,
      scope,
    );
    const names = await this.subjectNames(company);
    let rows = await this.scopedRows('hseHazards', company, 'discoveredAt');
    if (query.status) rows = rows.filter((row) => row.status === query.status);
    if (query.level) rows = rows.filter((row) => row.level === query.level);
    return {
      rows: rows.map((row) => ({
        ...row,
        subjectName: names.get(text(row.subjectId)) ?? '',
      })),
    };
  }

  async listHazards(
    principal: HsePrincipal,
    query: HseHazardQuery,
    scope: HseScope,
  ) {
    const { rows } = await this.hazardRows(principal, query, scope);
    const total = rows.length;
    const start = (query.page - 1) * query.pageSize;
    return {
      data: rows.slice(start, start + query.pageSize),
      meta: { page: query.page, pageSize: query.pageSize, total },
    };
  }

  async exportHazards(
    principal: HsePrincipal,
    query: { subjectId?: string; status?: string; level?: string },
    scope: HseScope,
  ) {
    const { rows } = await this.hazardRows(principal, query, scope);
    const limit = 5000;
    return {
      data: rows.slice(0, limit),
      meta: { total: rows.length, truncated: rows.length > limit },
    };
  }

  async createHazard(
    principal: HsePrincipal,
    input: HseHazardCreate,
    scope: HseScope,
  ) {
    const subjectId = await this.resolveSubject(
      principal,
      input.subjectId,
      scope,
      true,
    );
    if (!subjectId) throw new HseError('HSE_INVALID', 'SUBJECT_REQUIRED');
    await this.assertUnit(subjectId, input.unitId);
    await this.assertOwner(subjectId, input.ownerId);
    await this.assertOwner(subjectId, input.inspectorId);
    if (input.source === 'inspection' && !input.sourceRef)
      throw new HseError('HSE_INVALID', 'INSPECTION_REF_REQUIRED');
    const now = new Date().toISOString();
    const record = await this.database.repository('hseHazards').createOne({
      values: {
        id: randomUUID(),
        subjectId,
        unitId: input.unitId ?? null,
        source: input.source,
        level: input.level,
        description: input.description,
        location: input.location,
        discoveredAt: input.discoveredAt,
        ownerId: input.ownerId ?? null,
        ownerName: input.ownerName,
        dueAt: input.dueAt ?? null,
        sourceRef: input.sourceRef ?? null,
        inspectorId: input.inspectorId ?? null,
        status: 'open',
        history: [],
        rectification: input.rectification,
        verifiedBy: null,
        verifiedAt: null,
        closedBy: null,
        closedAt: null,
        version: 1,
        createdBy: principal.id,
        updatedBy: principal.id,
        createdAt: now,
        updatedAt: now,
      },
    });
    return record.record;
  }

  async updateHazard(
    principal: HsePrincipal,
    id: string,
    input: HseHazardUpdate,
    scope: HseScope,
  ) {
    const existing = await this.database
      .repository('hseHazards')
      .findOne({ filter: { id } });
    if (!existing) throw new HseError('HSE_NOT_FOUND');
    const subjectId = await this.resolveSubject(
      principal,
      text(existing.subjectId),
      scope,
    );
    if (subjectId && subjectId !== text(existing.subjectId))
      throw new HseError('HSE_FORBIDDEN');
    if (number(existing.version) !== input.version)
      throw new HseError('HSE_CONFLICT');
    if (['verifying', 'closed'].includes(text(existing.status)))
      throw new HseError('HSE_INVALID', 'HAZARD_LOCKED');
    if (input.ownerId !== undefined) {
      if (!subjectId) throw new HseError('HSE_FORBIDDEN');
      await this.assertOwner(subjectId, input.ownerId);
    }
    if (input.inspectorId !== undefined && subjectId)
      await this.assertOwner(subjectId, input.inspectorId);
    const now = new Date().toISOString();
    const values: Record<string, unknown> = {
      version: input.version + 1,
      updatedBy: principal.id,
      updatedAt: now,
      history: appendHistory(
        existing,
        {
          action: 'update',
          from: text(existing.status),
          to: text(existing.status),
        },
        principal,
        now,
      ),
    };
    for (const key of [
      'level',
      'ownerId',
      'ownerName',
      'dueAt',
      'rectification',
      'sourceRef',
      'inspectorId',
    ] as const) {
      if (input[key] !== undefined) values[key] = input[key];
    }
    const result = await this.database.repository('hseHazards').updateOne({
      filter: { id, version: input.version },
      values: values as never,
    });
    if (!result.record) throw new HseError('HSE_CONFLICT');
    return result.record;
  }

  async transitionHazard(
    principal: HsePrincipal,
    id: string,
    input: HseHazardTransition,
    scope: HseScope,
  ) {
    const existing = await this.database
      .repository('hseHazards')
      .findOne({ filter: { id } });
    if (!existing) throw new HseError('HSE_NOT_FOUND');
    const subjectId = await this.resolveSubject(
      principal,
      text(existing.subjectId),
      scope,
    );
    if (subjectId && subjectId !== text(existing.subjectId))
      throw new HseError('HSE_FORBIDDEN');
    if (number(existing.version) !== input.version)
      throw new HseError('HSE_CONFLICT');
    const from = text(existing.status);
    if (from === 'closed') throw new HseError('HSE_INVALID', 'HAZARD_CLOSED');
    const now = new Date().toISOString();
    const values: Record<string, unknown> = {
      version: input.version + 1,
      updatedBy: principal.id,
      updatedAt: now,
    };
    let to: string;
    if (input.action === 'startRectification') {
      if (!scope.manage) throw new HseError('HSE_FORBIDDEN');
      if (from !== 'open') throw new HseError('HSE_INVALID', 'HAZARD_STATE');
      const ownerId = (input.ownerId ?? text(existing.ownerId)) || null;
      const dueAt = (input.dueAt ?? text(existing.dueAt)) || null;
      if (!ownerId) throw new HseError('HSE_INVALID', 'OWNER_REQUIRED');
      if (!dueAt) throw new HseError('HSE_INVALID', 'DUE_REQUIRED');
      if (!subjectId) throw new HseError('HSE_FORBIDDEN');
      await this.assertOwner(subjectId, ownerId);
      to = 'rectifying';
      values.status = to;
      values.ownerId = ownerId;
      values.dueAt = dueAt;
    } else if (input.action === 'submitVerification') {
      if (!scope.manage) throw new HseError('HSE_FORBIDDEN');
      if (from !== 'rectifying')
        throw new HseError('HSE_INVALID', 'HAZARD_STATE');
      const rectification = (
        input.rectification ?? text(existing.rectification)
      ).trim();
      if (!rectification)
        throw new HseError('HSE_INVALID', 'RECTIFICATION_REQUIRED');
      to = 'verifying';
      values.status = to;
      values.rectification = rectification;
      values.rectifiedBy = principal.id;
      values.rectifiedAt = now;
    } else if (input.action === 'verify') {
      if (!scope.approve) throw new HseError('HSE_FORBIDDEN');
      if (from !== 'verifying')
        throw new HseError('HSE_INVALID', 'HAZARD_STATE');
      const rectifiedBy =
        text(existing.rectifiedBy) || text(existing.updatedBy);
      if (rectifiedBy === principal.id)
        throw new HseError('HSE_INVALID', 'SELF_VERIFICATION');
      to = 'closed';
      values.status = to;
      values.verifiedBy = principal.id;
      values.verifiedAt = now;
      values.closedBy = principal.id;
      values.closedAt = now;
    } else {
      if (!scope.approve) throw new HseError('HSE_FORBIDDEN');
      if (from !== 'verifying')
        throw new HseError('HSE_INVALID', 'HAZARD_STATE');
      const note = (input.note ?? '').trim();
      if (!note) throw new HseError('HSE_INVALID', 'RETURN_REASON_REQUIRED');
      to = 'rectifying';
      values.status = to;
      values.rectifiedBy = null;
      values.rectifiedAt = null;
    }
    values.history = appendHistory(
      existing,
      { action: input.action, from, to, note: input.note },
      principal,
      now,
    );
    const result = await this.database.repository('hseHazards').updateOne({
      filter: { id, version: input.version },
      values: values as never,
    });
    if (!result.record) throw new HseError('HSE_CONFLICT');
    return result.record;
  }

  private certificateStatus(row: Row, today: string): string {
    const status = text(row.status);
    if (status !== 'active') return status;
    const expiresAt = text(row.expiresAt);
    if (expiresAt && expiresAt < today) return 'expired';
    const horizon = new Date(`${today}T00:00:00Z`);
    horizon.setUTCDate(horizon.getUTCDate() + 90);
    if (expiresAt && expiresAt <= horizon.toISOString().slice(0, 10))
      return 'expiring';
    return 'active';
  }

  async listCertificates(
    principal: HsePrincipal,
    query: HseCertificateQuery,
    scope: HseScope,
  ) {
    const company = await this.resolveSubject(
      principal,
      query.subjectId,
      scope,
    );
    const names = await this.subjectNames(company);
    const today = businessDate(this.timeZone);
    let rows = await this.scopedRows('hseCertificates', company, 'expiresAt');
    rows = rows.map((row) => ({
      ...row,
      status: this.certificateStatus(row, today),
    }));
    if (query.status) rows = rows.filter((row) => row.status === query.status);
    if (query.type) rows = rows.filter((row) => row.certType === query.type);
    const total = rows.length;
    const start = (query.page - 1) * query.pageSize;
    return {
      data: rows.slice(start, start + query.pageSize).map((row) => ({
        ...row,
        subjectName: names.get(text(row.subjectId)) ?? '',
      })),
      meta: { page: query.page, pageSize: query.pageSize, total },
    };
  }

  async createCertificate(
    principal: HsePrincipal,
    input: HseCertificateCreate,
    scope: HseScope,
  ) {
    const subjectId = await this.resolveSubject(
      principal,
      input.subjectId,
      scope,
      true,
    );
    if (!subjectId) throw new HseError('HSE_INVALID', 'SUBJECT_REQUIRED');
    if (input.holderType === 'person') {
      const holderId = (input.holderId ?? '').trim();
      if (!holderId) throw new HseError('HSE_INVALID', 'HOLDER_REQUIRED');
      await this.assertHolder(subjectId, holderId);
    }
    const duplicate = await this.database
      .repository('hseCertificates')
      .findOne({
        filter: {
          certType: input.certType,
          holderId:
            input.holderId ?? (input.holderType === 'company' ? subjectId : ''),
          status: 'active',
        },
      });
    if (duplicate) throw new HseError('HSE_CONFLICT', 'CERTIFICATE_DUPLICATE');
    const now = new Date().toISOString();
    const record = await this.database.repository('hseCertificates').createOne({
      values: {
        id: randomUUID(),
        subjectId,
        holderType: input.holderType,
        holderId:
          input.holderId ?? (input.holderType === 'company' ? subjectId : ''),
        holderName: input.holderName,
        certType: input.certType,
        certNo: input.certNo,
        issuedAt: input.issuedAt ?? null,
        expiresAt: input.expiresAt,
        authority: input.authority,
        fileId: input.fileId ?? null,
        status: 'active',
        history: [],
        version: 1,
        createdBy: principal.id,
        updatedBy: principal.id,
        createdAt: now,
        updatedAt: now,
      },
    });
    return {
      ...record.record,
      status: this.certificateStatus(
        record.record,
        businessDate(this.timeZone),
      ),
    };
  }

  async updateCertificate(
    principal: HsePrincipal,
    id: string,
    input: HseCertificateUpdate,
    scope: HseScope,
  ) {
    const existing = await this.database
      .repository('hseCertificates')
      .findOne({ filter: { id } });
    if (!existing) throw new HseError('HSE_NOT_FOUND');
    const subjectId = await this.resolveSubject(
      principal,
      text(existing.subjectId),
      scope,
    );
    if (subjectId && subjectId !== text(existing.subjectId))
      throw new HseError('HSE_FORBIDDEN');
    if (number(existing.version) !== input.version)
      throw new HseError('HSE_CONFLICT');
    if (text(existing.status) === 'revoked')
      throw new HseError('HSE_INVALID', 'CERTIFICATE_REVOKED');
    if (
      text(existing.status) === 'active' &&
      // Only an unexpired certificate is locked to the renew flow; an expired
      // one is regularity work and may be corrected through PATCH.
      text(existing.expiresAt) >= businessDate(this.timeZone) &&
      (input.issuedAt !== undefined || input.expiresAt !== undefined)
    )
      throw new HseError('HSE_INVALID', 'CERTIFICATE_ACTIVE');
    const now = new Date().toISOString();
    const values: Record<string, unknown> = {
      version: input.version + 1,
      updatedBy: principal.id,
      updatedAt: now,
      history: appendHistory(
        existing,
        {
          action: 'update',
          from: text(existing.status),
          to: text(existing.status),
        },
        principal,
        now,
      ),
    };
    for (const key of [
      'holderName',
      'certNo',
      'issuedAt',
      'expiresAt',
      'authority',
      'fileId',
    ] as const) {
      if (input[key] !== undefined) values[key] = input[key];
    }
    const result = await this.database.repository('hseCertificates').updateOne({
      filter: { id, version: input.version },
      values: values as never,
    });
    if (!result.record) throw new HseError('HSE_CONFLICT');
    return {
      ...result.record,
      status: this.certificateStatus(
        result.record,
        businessDate(this.timeZone),
      ),
    };
  }

  async transitionCertificate(
    principal: HsePrincipal,
    id: string,
    input: HseCertificateTransition,
    scope: HseScope,
  ) {
    const existing = await this.database
      .repository('hseCertificates')
      .findOne({ filter: { id } });
    if (!existing) throw new HseError('HSE_NOT_FOUND');
    const subjectId = await this.resolveSubject(
      principal,
      text(existing.subjectId),
      scope,
    );
    if (subjectId && subjectId !== text(existing.subjectId))
      throw new HseError('HSE_FORBIDDEN');
    if (number(existing.version) !== input.version)
      throw new HseError('HSE_CONFLICT');
    const stored = text(existing.status);
    const today = businessDate(this.timeZone);
    const current = this.certificateStatus(existing, today);
    const now = new Date().toISOString();
    const values: Record<string, unknown> = {
      version: input.version + 1,
      updatedBy: principal.id,
      updatedAt: now,
    };
    let to: string;
    if (input.action === 'renew') {
      if (!scope.manage) throw new HseError('HSE_FORBIDDEN');
      if (stored === 'revoked')
        throw new HseError('HSE_INVALID', 'CERTIFICATE_REVOKED');
      if (!input.expiresAt)
        throw new HseError('HSE_INVALID', 'EXPIRES_AT_REQUIRED');
      if (input.expiresAt <= text(existing.expiresAt))
        throw new HseError('HSE_INVALID', 'EXPIRY_NOT_EXTENDED');
      to = 'active';
      values.status = to;
      values.expiresAt = input.expiresAt;
      if (input.issuedAt !== undefined) values.issuedAt = input.issuedAt;
      if (input.authority !== undefined) values.authority = input.authority;
    } else if (input.action === 'revoke') {
      if (!scope.approve) throw new HseError('HSE_FORBIDDEN');
      if (stored === 'revoked')
        throw new HseError('HSE_INVALID', 'CERTIFICATE_REVOKED');
      to = 'revoked';
      values.status = to;
      values.revokedBy = principal.id;
      values.revokedAt = now;
      values.revokedReason = input.note;
    } else {
      if (!scope.approve) throw new HseError('HSE_FORBIDDEN');
      if (stored !== 'revoked')
        throw new HseError('HSE_INVALID', 'CERTIFICATE_STATE');
      to = 'active';
      values.status = to;
      values.revokedBy = null;
      values.revokedAt = null;
      values.revokedReason = null;
    }
    values.history = appendHistory(
      existing,
      { action: input.action, from: current, to, note: input.note },
      principal,
      now,
    );
    const result = await this.database.repository('hseCertificates').updateOne({
      filter: { id, version: input.version },
      values: values as never,
    });
    if (!result.record) throw new HseError('HSE_CONFLICT');
    return {
      ...result.record,
      status: this.certificateStatus(
        result.record,
        businessDate(this.timeZone),
      ),
    };
  }

  private pageRows<T>(rows: readonly T[], page: number, pageSize: number) {
    const start = (page - 1) * pageSize;
    return {
      data: rows.slice(start, start + pageSize),
      meta: { page, pageSize, total: rows.length },
    };
  }

  /** A training attendee/owner must be an active employee of the company. */
  private async assertPerson(
    subjectId: string,
    personId: string | null | undefined,
  ) {
    if (!personId) throw new HseError('HSE_INVALID', 'PERSON_REQUIRED');
    const employee = await this.database
      .repository('personnelEmployees')
      .findOne({ filter: { id: personId } });
    if (!employee) throw new HseError('HSE_INVALID', 'PERSON_NOT_FOUND');
    if (
      text(employee.subjectId) !== subjectId ||
      text(employee.status) !== 'active'
    )
      throw new HseError('HSE_INVALID', 'PERSON_NOT_IN_COMPANY');
  }

  private async inspectionRows(
    principal: HsePrincipal,
    query: { subjectId?: string; status?: string; type?: string },
    scope: HseScope,
  ) {
    const company = await this.resolveSubject(
      principal,
      query.subjectId,
      scope,
    );
    const names = await this.subjectNames(company);
    let rows = await this.scopedRows('hseInspections', company, 'plannedAt');
    if (query.status) rows = rows.filter((row) => row.status === query.status);
    if (query.type) rows = rows.filter((row) => row.type === query.type);
    const inspectorIds = [
      ...new Set(
        rows
          .map((row) => text(row.inspectorId))
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const inspectorNames = await this.employeeNames(company, inspectorIds);
    return {
      rows: rows.map((row) => ({
        ...row,
        checklist: this.jsonList(row.checklist),
        subjectName: names.get(text(row.subjectId)) ?? '',
        inspectorName: inspectorNames.get(text(row.inspectorId)) ?? '',
      })),
    };
  }

  private jsonList(value: unknown): string[] {
    let parsed: unknown = value;
    if (typeof parsed === 'string') {
      try {
        parsed = JSON.parse(parsed);
      } catch {
        return [];
      }
    }
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === 'string');
  }

  async listInspections(
    principal: HsePrincipal,
    query: HseInspectionQuery,
    scope: HseScope,
  ) {
    const { rows } = await this.inspectionRows(principal, query, scope);
    return this.pageRows(rows, query.page, query.pageSize);
  }

  async createInspection(
    principal: HsePrincipal,
    input: HseInspectionCreate,
    scope: HseScope,
  ) {
    const subjectId = await this.resolveSubject(
      principal,
      input.subjectId,
      scope,
      true,
    );
    if (!subjectId) throw new HseError('HSE_INVALID', 'SUBJECT_REQUIRED');
    await this.assertUnit(subjectId, input.unitId);
    if (input.inspectorId) await this.assertPerson(subjectId, input.inspectorId);
    const now = new Date().toISOString();
    const record = await this.database.repository('hseInspections').createOne({
      values: {
        id: randomUUID(),
        subjectId,
        unitId: input.unitId ?? null,
        type: input.type,
        plannedAt: input.plannedAt,
        completedAt: null,
        inspectorId: input.inspectorId ?? null,
        checklist: input.checklist,
        findingsCount: 0,
        status: 'planned',
        version: 1,
        createdBy: principal.id,
        updatedBy: principal.id,
        createdAt: now,
        updatedAt: now,
      },
    });
    return {
      ...record.record,
      checklist: this.jsonList(record.record.checklist),
    };
  }

  async updateInspection(
    principal: HsePrincipal,
    id: string,
    input: HseInspectionUpdate,
    scope: HseScope,
  ) {
    const existing = await this.database
      .repository('hseInspections')
      .findOne({ filter: { id } });
    if (!existing) throw new HseError('HSE_NOT_FOUND');
    const subjectId = await this.resolveSubject(
      principal,
      text(existing.subjectId),
      scope,
    );
    if (subjectId && subjectId !== text(existing.subjectId))
      throw new HseError('HSE_FORBIDDEN');
    if (number(existing.version) !== input.version)
      throw new HseError('HSE_CONFLICT');
    if (text(existing.status) !== 'planned')
      throw new HseError('HSE_INVALID', 'INSPECTION_STATE');
    if (input.inspectorId)
      await this.assertPerson(text(existing.subjectId), input.inspectorId);
    const values: Record<string, unknown> = {
      version: input.version + 1,
      updatedBy: principal.id,
      updatedAt: new Date().toISOString(),
    };
    for (const key of [
      'type',
      'plannedAt',
      'inspectorId',
      'checklist',
    ] as const) {
      if (input[key] !== undefined) values[key] = input[key];
    }
    const result = await this.database.repository('hseInspections').updateOne({
      filter: { id, version: input.version },
      values: values as never,
    });
    if (!result.record) throw new HseError('HSE_CONFLICT');
    return {
      ...result.record,
      checklist: this.jsonList(result.record.checklist),
    };
  }

  async transitionInspection(
    principal: HsePrincipal,
    id: string,
    input: HseInspectionTransition,
    scope: HseScope,
  ) {
    const existing = await this.database
      .repository('hseInspections')
      .findOne({ filter: { id } });
    if (!existing) throw new HseError('HSE_NOT_FOUND');
    const subjectId = await this.resolveSubject(
      principal,
      text(existing.subjectId),
      scope,
    );
    if (subjectId && subjectId !== text(existing.subjectId))
      throw new HseError('HSE_FORBIDDEN');
    if (number(existing.version) !== input.version)
      throw new HseError('HSE_CONFLICT');
    if (!scope.manage) throw new HseError('HSE_FORBIDDEN');
    if (text(existing.status) !== 'planned')
      throw new HseError('HSE_INVALID', 'INSPECTION_STATE');
    const now = new Date().toISOString();
    const result = await this.database.repository('hseInspections').updateOne({
      filter: { id, version: input.version },
      values: {
        status: 'completed',
        completedAt: now,
        findingsCount: input.findingsCount,
        version: input.version + 1,
        updatedBy: principal.id,
        updatedAt: now,
      } as never,
    });
    if (!result.record) throw new HseError('HSE_CONFLICT');
    return {
      ...result.record,
      checklist: this.jsonList(result.record.checklist),
    };
  }

  private assertPermitPeriod(validFrom: string, validTo: string) {
    const from = Date.parse(validFrom);
    const to = Date.parse(validTo);
    if (Number.isNaN(from) || Number.isNaN(to) || from >= to)
      throw new HseError('HSE_INVALID', 'PERMIT_PERIOD_INVALID');
    return {
      validFrom: new Date(from).toISOString(),
      validTo: new Date(to).toISOString(),
    };
  }

  private async assertPermitNoFree(
    subjectId: string,
    permitNo: string,
    excludeId?: string,
  ) {
    const duplicate = await this.database
      .repository('hseWorkPermits')
      .findOne({ filter: { subjectId, permitNo } });
    if (duplicate && text(duplicate.id) !== excludeId)
      throw new HseError('HSE_CONFLICT', 'PERMIT_NO_DUPLICATE');
  }

  private async workPermitRows(
    principal: HsePrincipal,
    query: { subjectId?: string; status?: string; type?: string },
    scope: HseScope,
  ) {
    const company = await this.resolveSubject(
      principal,
      query.subjectId,
      scope,
    );
    const names = await this.subjectNames(company);
    let rows = await this.scopedRows('hseWorkPermits', company, 'validTo');
    if (query.status) rows = rows.filter((row) => row.status === query.status);
    if (query.type) rows = rows.filter((row) => row.type === query.type);
    return {
      rows: rows.map((row) => ({
        ...row,
        riskMeasures: this.jsonList(row.riskMeasures),
        subjectName: names.get(text(row.subjectId)) ?? '',
      })),
    };
  }

  async listWorkPermits(
    principal: HsePrincipal,
    query: HseWorkPermitQuery,
    scope: HseScope,
  ) {
    const { rows } = await this.workPermitRows(principal, query, scope);
    return this.pageRows(rows, query.page, query.pageSize);
  }

  async createWorkPermit(
    principal: HsePrincipal,
    input: HseWorkPermitCreate,
    scope: HseScope,
  ) {
    const subjectId = await this.resolveSubject(
      principal,
      input.subjectId,
      scope,
      true,
    );
    if (!subjectId) throw new HseError('HSE_INVALID', 'SUBJECT_REQUIRED');
    await this.assertUnit(subjectId, input.unitId);
    await this.assertPermitNoFree(subjectId, input.permitNo);
    const period = this.assertPermitPeriod(input.validFrom, input.validTo);
    const now = new Date().toISOString();
    let record;
    try {
      record = await this.database.repository('hseWorkPermits').createOne({
        values: {
          id: randomUUID(),
          subjectId,
          unitId: input.unitId ?? null,
          permitNo: input.permitNo,
          type: input.type,
          workDescription: input.workDescription,
          location: input.location,
          contractorId: input.contractorId ?? null,
          // The applicant is always the authenticated creator: accepting an
          // applicantId from the body would let the creator nominate somebody
          // else and then approve their own permit.
          applicantId: principal.id,
          validFrom: period.validFrom,
          validTo: period.validTo,
          riskMeasures: input.riskMeasures,
          gasTest: input.gasTest ?? null,
          approverId: null,
          approvedAt: null,
          status: 'draft',
          linkedMaintenanceOrderId: input.linkedMaintenanceOrderId ?? null,
          version: 1,
          createdBy: principal.id,
          updatedBy: principal.id,
          createdAt: now,
          updatedAt: now,
        },
      });
    } catch (error) {
      // The unique (subjectId, permitNo) index is the last line of defence
      // against two concurrent creates passing the pre-check above.
      if (/unique|duplicate|constraint/iu.test(String(error)))
        throw new HseError('HSE_CONFLICT', 'PERMIT_NO_DUPLICATE');
      throw error;
    }
    return {
      ...record.record,
      riskMeasures: this.jsonList(record.record.riskMeasures),
    };
  }

  async updateWorkPermit(
    principal: HsePrincipal,
    id: string,
    input: HseWorkPermitUpdate,
    scope: HseScope,
  ) {
    const existing = await this.database
      .repository('hseWorkPermits')
      .findOne({ filter: { id } });
    if (!existing) throw new HseError('HSE_NOT_FOUND');
    const subjectId = await this.resolveSubject(
      principal,
      text(existing.subjectId),
      scope,
    );
    if (subjectId && subjectId !== text(existing.subjectId))
      throw new HseError('HSE_FORBIDDEN');
    if (number(existing.version) !== input.version)
      throw new HseError('HSE_CONFLICT');
    if (text(existing.status) !== 'draft')
      throw new HseError('HSE_INVALID', 'PERMIT_STATE');
    if (input.unitId !== undefined)
      await this.assertUnit(text(existing.subjectId), input.unitId);
    const values: Record<string, unknown> = {
      version: input.version + 1,
      updatedBy: principal.id,
      updatedAt: new Date().toISOString(),
    };
    if (input.validFrom !== undefined || input.validTo !== undefined) {
      const current = (value: unknown) =>
        value instanceof Date ? value.toISOString() : text(value);
      const period = this.assertPermitPeriod(
        input.validFrom ?? current(existing.validFrom),
        input.validTo ?? current(existing.validTo),
      );
      values.validFrom = period.validFrom;
      values.validTo = period.validTo;
    }
    for (const key of [
      'unitId',
      'workDescription',
      'location',
      'contractorId',
      'riskMeasures',
      'gasTest',
      'linkedMaintenanceOrderId',
    ] as const) {
      if (input[key] !== undefined) values[key] = input[key];
    }
    const result = await this.database.repository('hseWorkPermits').updateOne({
      filter: { id, version: input.version },
      values: values as never,
    });
    if (!result.record) throw new HseError('HSE_CONFLICT');
    return {
      ...result.record,
      riskMeasures: this.jsonList(result.record.riskMeasures),
    };
  }

  async transitionWorkPermit(
    principal: HsePrincipal,
    id: string,
    input: HseWorkPermitTransition,
    scope: HseScope,
  ) {
    const existing = await this.database
      .repository('hseWorkPermits')
      .findOne({ filter: { id } });
    if (!existing) throw new HseError('HSE_NOT_FOUND');
    const subjectId = await this.resolveSubject(
      principal,
      text(existing.subjectId),
      scope,
    );
    if (subjectId && subjectId !== text(existing.subjectId))
      throw new HseError('HSE_FORBIDDEN');
    if (number(existing.version) !== input.version)
      throw new HseError('HSE_CONFLICT');
    const from = text(existing.status);
    const now = new Date().toISOString();
    const values: Record<string, unknown> = {
      version: input.version + 1,
      updatedBy: principal.id,
      updatedAt: now,
    };
    let to: string;
    if (input.action === 'submit') {
      if (!scope.manage) throw new HseError('HSE_FORBIDDEN');
      if (!['draft', 'rejected'].includes(from))
        throw new HseError('HSE_INVALID', 'PERMIT_STATE');
      to = 'submitted';
      values.status = to;
      values.approverId = null;
      values.approvedAt = null;
    } else if (input.action === 'approve') {
      if (!scope.approve) throw new HseError('HSE_FORBIDDEN');
      if (from !== 'submitted')
        throw new HseError('HSE_INVALID', 'PERMIT_STATE');
      if (text(existing.applicantId) === principal.id)
        throw new HseError('HSE_INVALID', 'PERMIT_SELF_APPROVAL');
      to = 'approved';
      values.status = to;
      values.approverId = principal.id;
      values.approvedAt = now;
    } else if (input.action === 'reject') {
      if (!scope.approve) throw new HseError('HSE_FORBIDDEN');
      if (from !== 'submitted')
        throw new HseError('HSE_INVALID', 'PERMIT_STATE');
      const note = (input.note ?? '').trim();
      if (!note) throw new HseError('HSE_INVALID', 'REJECT_REASON_REQUIRED');
      to = 'rejected';
      values.status = to;
      values.approverId = principal.id;
      values.approvedAt = null;
    } else {
      if (!scope.manage && !scope.approve) throw new HseError('HSE_FORBIDDEN');
      if (from !== 'approved')
        throw new HseError('HSE_INVALID', 'PERMIT_STATE');
      to = 'closed';
      values.status = to;
    }
    const result = await this.database.repository('hseWorkPermits').updateOne({
      filter: { id, version: input.version },
      values: values as never,
    });
    if (!result.record) throw new HseError('HSE_CONFLICT');
    return {
      ...result.record,
      riskMeasures: this.jsonList(result.record.riskMeasures),
    };
  }

  private async trainingRecordRows(
    principal: HsePrincipal,
    query: { subjectId?: string; status?: string; courseType?: string },
    scope: HseScope,
  ) {
    const company = await this.resolveSubject(
      principal,
      query.subjectId,
      scope,
    );
    const names = await this.subjectNames(company);
    let rows = await this.scopedRows(
      'hseTrainingRecords',
      company,
      'completedAt',
    );
    if (query.status) rows = rows.filter((row) => row.status === query.status);
    if (query.courseType)
      rows = rows.filter((row) => row.courseType === query.courseType);
    const personIds = [
      ...new Set(
        rows
          .map((row) => text(row.personId))
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const personNames = await this.employeeNames(company, personIds);
    return {
      rows: rows.map((row) => ({
        ...row,
        subjectName: names.get(text(row.subjectId)) ?? '',
        personName: personNames.get(text(row.personId)) ?? '',
      })),
    };
  }

  async listTrainingRecords(
    principal: HsePrincipal,
    query: HseTrainingRecordQuery,
    scope: HseScope,
  ) {
    const { rows } = await this.trainingRecordRows(principal, query, scope);
    return this.pageRows(rows, query.page, query.pageSize);
  }

  async createTrainingRecord(
    principal: HsePrincipal,
    input: HseTrainingRecordCreate,
    scope: HseScope,
  ) {
    const subjectId = await this.resolveSubject(
      principal,
      input.subjectId,
      scope,
      true,
    );
    if (!subjectId) throw new HseError('HSE_INVALID', 'SUBJECT_REQUIRED');
    await this.assertPerson(subjectId, input.personId);
    const now = new Date().toISOString();
    const record = await this.database
      .repository('hseTrainingRecords')
      .createOne({
        values: {
          id: randomUUID(),
          subjectId,
          personId: input.personId,
          courseType: input.courseType,
          courseName: input.courseName,
          completedAt: input.completedAt,
          score: input.score ?? null,
          certificateId: input.certificateId ?? null,
          status: input.status,
          version: 1,
          createdBy: principal.id,
          updatedBy: principal.id,
          createdAt: now,
          updatedAt: now,
        },
      });
    return record.record;
  }

  async updateTrainingRecord(
    principal: HsePrincipal,
    id: string,
    input: HseTrainingRecordUpdate,
    scope: HseScope,
  ) {
    const existing = await this.database
      .repository('hseTrainingRecords')
      .findOne({ filter: { id } });
    if (!existing) throw new HseError('HSE_NOT_FOUND');
    const subjectId = await this.resolveSubject(
      principal,
      text(existing.subjectId),
      scope,
    );
    if (subjectId && subjectId !== text(existing.subjectId))
      throw new HseError('HSE_FORBIDDEN');
    if (number(existing.version) !== input.version)
      throw new HseError('HSE_CONFLICT');
    const values: Record<string, unknown> = {
      version: input.version + 1,
      updatedBy: principal.id,
      updatedAt: new Date().toISOString(),
    };
    for (const key of [
      'courseType',
      'courseName',
      'completedAt',
      'score',
      'certificateId',
      'status',
    ] as const) {
      if (input[key] !== undefined) values[key] = input[key];
    }
    const result = await this.database
      .repository('hseTrainingRecords')
      .updateOne({
        filter: { id, version: input.version },
        values: values as never,
      });
    if (!result.record) throw new HseError('HSE_CONFLICT');
    return result.record;
  }

  private async actionRows(
    principal: HsePrincipal,
    query: { subjectId?: string; status?: string; sourceType?: string },
    scope: HseScope,
  ) {
    const company = await this.resolveSubject(
      principal,
      query.subjectId,
      scope,
    );
    const names = await this.subjectNames(company);
    let rows = await this.scopedRows('hseActions', company, 'dueAt');
    if (query.status) rows = rows.filter((row) => row.status === query.status);
    if (query.sourceType)
      rows = rows.filter((row) => row.sourceType === query.sourceType);
    return {
      rows: rows.map((row) => ({
        ...row,
        subjectName: names.get(text(row.subjectId)) ?? '',
      })),
    };
  }

  async listActions(
    principal: HsePrincipal,
    query: HseActionQuery,
    scope: HseScope,
  ) {
    const { rows } = await this.actionRows(principal, query, scope);
    return this.pageRows(rows, query.page, query.pageSize);
  }

  async createAction(
    principal: HsePrincipal,
    input: HseActionCreate,
    scope: HseScope,
  ) {
    const subjectId = await this.resolveSubject(
      principal,
      input.subjectId,
      scope,
      true,
    );
    if (!subjectId) throw new HseError('HSE_INVALID', 'SUBJECT_REQUIRED');
    await this.assertUnit(subjectId, input.unitId);
    await this.assertOwner(subjectId, input.ownerId);
    const now = new Date().toISOString();
    const record = await this.database.repository('hseActions').createOne({
      values: {
        id: randomUUID(),
        subjectId,
        unitId: input.unitId ?? null,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        description: input.description,
        ownerId: input.ownerId ?? null,
        ownerName: input.ownerName,
        dueAt: input.dueAt ?? null,
        status: 'open',
        completedAt: null,
        verifiedBy: null,
        verifiedAt: null,
        version: 1,
        createdBy: principal.id,
        updatedBy: principal.id,
        createdAt: now,
        updatedAt: now,
      },
    });
    return record.record;
  }

  async updateAction(
    principal: HsePrincipal,
    id: string,
    input: HseActionUpdate,
    scope: HseScope,
  ) {
    const existing = await this.database
      .repository('hseActions')
      .findOne({ filter: { id } });
    if (!existing) throw new HseError('HSE_NOT_FOUND');
    const subjectId = await this.resolveSubject(
      principal,
      text(existing.subjectId),
      scope,
    );
    if (subjectId && subjectId !== text(existing.subjectId))
      throw new HseError('HSE_FORBIDDEN');
    if (number(existing.version) !== input.version)
      throw new HseError('HSE_CONFLICT');
    if (text(existing.status) !== 'open')
      throw new HseError('HSE_INVALID', 'ACTION_LOCKED');
    if (input.unitId !== undefined)
      await this.assertUnit(text(existing.subjectId), input.unitId);
    if (input.ownerId !== undefined)
      await this.assertOwner(text(existing.subjectId), input.ownerId);
    const values: Record<string, unknown> = {
      version: input.version + 1,
      updatedBy: principal.id,
      updatedAt: new Date().toISOString(),
    };
    for (const key of [
      'unitId',
      'description',
      'ownerId',
      'ownerName',
      'dueAt',
    ] as const) {
      if (input[key] !== undefined) values[key] = input[key];
    }
    const result = await this.database.repository('hseActions').updateOne({
      filter: { id, version: input.version },
      values: values as never,
    });
    if (!result.record) throw new HseError('HSE_CONFLICT');
    return result.record;
  }

  async transitionAction(
    principal: HsePrincipal,
    id: string,
    input: HseActionTransition,
    scope: HseScope,
  ) {
    const existing = await this.database
      .repository('hseActions')
      .findOne({ filter: { id } });
    if (!existing) throw new HseError('HSE_NOT_FOUND');
    const subjectId = await this.resolveSubject(
      principal,
      text(existing.subjectId),
      scope,
    );
    if (subjectId && subjectId !== text(existing.subjectId))
      throw new HseError('HSE_FORBIDDEN');
    if (number(existing.version) !== input.version)
      throw new HseError('HSE_CONFLICT');
    const from = text(existing.status);
    const now = new Date().toISOString();
    const values: Record<string, unknown> = {
      version: input.version + 1,
      updatedBy: principal.id,
      updatedAt: now,
    };
    if (input.action === 'complete') {
      if (!scope.manage) throw new HseError('HSE_FORBIDDEN');
      if (from !== 'open') throw new HseError('HSE_INVALID', 'ACTION_STATE');
      values.status = 'completed';
      values.completedAt = now;
    } else {
      if (!scope.approve) throw new HseError('HSE_FORBIDDEN');
      if (from !== 'completed')
        throw new HseError('HSE_INVALID', 'ACTION_STATE');
      // hseActions has no completedBy column; the last writer at completion
      // time is the completer, and a verifier cannot verify their own work.
      if (text(existing.updatedBy) === principal.id)
        throw new HseError('HSE_INVALID', 'SELF_VERIFICATION');
      values.status = 'verified';
      values.verifiedBy = principal.id;
      values.verifiedAt = now;
    }
    const result = await this.database.repository('hseActions').updateOne({
      filter: { id, version: input.version },
      values: values as never,
    });
    if (!result.record) throw new HseError('HSE_CONFLICT');
    return result.record;
  }

  async operationsSummary(principal: HsePrincipal, scope: HseScope) {
    const overview = await this.overview(principal, scope);
    return {
      businessDate: overview.businessDate,
      scope: overview.scope,
      metrics: {
        incidentsOpen: overview.counts.incidentsOpen,
        incidentsLti: overview.counts.incidentsLti,
        hazardsOpen: overview.counts.hazardsOpen,
        hazardsOverdue: overview.counts.hazardsOverdue,
        certificatesExpiring90: overview.counts.certificatesExpiring90,
      },
    };
  }
}
