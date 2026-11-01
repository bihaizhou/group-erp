import { randomUUID } from 'node:crypto';
import type { DatabaseManager, RepositoryRecord } from '@nocobase/db';
import { createServiceToken } from '@nocobase/service-provider';
import { currentCompanyForUser } from './company-identity.js';
import { businessDate } from './business-date.js';
import type {
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
      permissions: { manage: scope.manage, approve: scope.approve },
    };
  }

  async overview(principal: HsePrincipal, scope: HseScope) {
    const company = await this.resolveSubject(principal, undefined, scope);
    const today = businessDate(this.timeZone);
    const horizon = new Date(`${today}T00:00:00Z`);
    horizon.setUTCDate(horizon.getUTCDate() + 90);
    const horizonDate = horizon.toISOString().slice(0, 10);
    const [incidents, hazards, certificates, names] = await Promise.all([
      this.scopedRows('hseIncidents', company, 'occurredAt'),
      this.scopedRows('hseHazards', company, 'discoveredAt'),
      this.scopedRows('hseCertificates', company, 'expiresAt'),
      this.subjectNames(company),
    ]);
    const openIncidents = incidents.filter((row) =>
      ['reported', 'investigating', 'rectifying'].includes(text(row.status)),
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

  async listIncidents(
    principal: HsePrincipal,
    query: HseIncidentQuery,
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
    const total = rows.length;
    const page = query.page;
    const start = (page - 1) * query.pageSize;
    return {
      data: rows.slice(start, start + query.pageSize).map((row) => ({
        ...row,
        environmentalRelease: bool(row.environmentalRelease),
        subjectName: names.get(text(row.subjectId)) ?? '',
      })),
      meta: { page, pageSize: query.pageSize, total },
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
        rootCause: '',
        actions: '',
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
      if (from !== 'investigating')
        throw new HseError('HSE_INVALID', 'INCIDENT_STATE');
      if (!rootCause) throw new HseError('HSE_INVALID', 'ROOT_CAUSE_REQUIRED');
      to = 'rectifying';
      values.status = to;
      values.rootCause = rootCause;
      if (input.actions !== undefined) values.actions = actions;
    } else {
      if (!scope.approve) throw new HseError('HSE_FORBIDDEN');
      if (from !== 'rectifying')
        throw new HseError('HSE_INVALID', 'INCIDENT_STATE');
      if (!rootCause) throw new HseError('HSE_INVALID', 'ROOT_CAUSE_REQUIRED');
      if (!actions) throw new HseError('HSE_INVALID', 'ACTIONS_REQUIRED');
      to = 'closed';
      values.status = to;
      values.rootCause = rootCause;
      values.actions = actions;
      values.closedBy = principal.id;
      values.closedAt = now;
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

  async listHazards(
    principal: HsePrincipal,
    query: HseHazardQuery,
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
      to = 'rectifying';
      values.status = to;
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
