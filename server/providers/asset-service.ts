import { randomUUID } from 'node:crypto';
import type {
  DatabaseConnection,
  DatabaseManager,
  RepositoryRecord,
} from '@nocobase/db';
import { createServiceToken } from '@nocobase/service-provider';
import { businessDate } from './business-date.js';
import { currentCompanyForUser } from './company-identity.js';
import type {
  AssetAssign,
  AssetCompanyQuery,
  AssetCreate,
  AssetQuery,
  AssetReturn,
  AssetScrapDecision,
  AssetScrapRequest,
  AssetStatus,
  AssetUpdate,
} from './asset-model.js';

export const assetServiceToken =
  createServiceToken<AssetService>('group-erp/assets');

export type AssetPrincipal = { type: string; id: string };
export type AssetScope = {
  readAll: boolean;
  manage: boolean;
  approve: boolean;
};
export type AssetErrorCode =
  | 'ASSET_FORBIDDEN'
  | 'ASSET_NOT_FOUND'
  | 'ASSET_CONFLICT'
  | 'ASSET_INVALID'
  | 'ASSET_CUSTODIAN_COMPANY'
  | 'ASSET_SUBJECT_INACTIVE';

export class AssetError extends Error {
  constructor(
    public readonly code: AssetErrorCode,
    message: string = code,
  ) {
    super(message);
    this.name = 'AssetError';
  }
}

type Row = RepositoryRecord;
const text = (value: unknown) => (typeof value === 'string' ? value : '');
const number = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export class AssetService {
  constructor(
    private readonly database: DatabaseManager,
    private readonly timeZone: string,
  ) {}

  private async resolveSubject(
    principal: AssetPrincipal,
    requested: string | undefined,
    scope: AssetScope,
    write = false,
  ) {
    if (scope.readAll) {
      if (requested) {
        const subject = await this.database
          .repository('orgSubjects')
          .findOne({ filter: { id: requested } });
        if (!subject || text(subject.status) !== 'active')
          throw new AssetError('ASSET_SUBJECT_INACTIVE');
        return requested;
      }
      if (write) throw new AssetError('ASSET_INVALID', 'SUBJECT_REQUIRED');
      return null;
    }
    const company = await currentCompanyForUser(
      this.database,
      this.timeZone,
      principal,
    );
    if (!company) throw new AssetError('ASSET_FORBIDDEN');
    if (requested && requested !== company)
      throw new AssetError('ASSET_FORBIDDEN');
    return company;
  }

  private async employee(id: string | null | undefined) {
    if (!id) return null;
    const row = await this.database
      .repository('personnelEmployees')
      .findOne({ filter: { id } });
    return row && text(row.status) === 'active' ? row : null;
  }

  private async view(row: Row) {
    const custodian = await this.employee(
      text(row.custodianEmployeeId) || null,
    );
    return {
      id: text(row.id),
      subjectId: text(row.subjectId),
      code: text(row.code),
      name: text(row.name),
      category: text(row.category) || null,
      status: text(row.status) as AssetStatus,
      scrapPending: row.scrapPending === true,
      scrapReason: text(row.scrapReason) || null,
      scrapDecision: text(row.scrapDecision) || null,
      scrapRequestedAt: row.scrapRequestedAt ?? null,
      scrapDecidedAt: row.scrapDecidedAt ?? null,
      custodianEmployeeId: text(row.custodianEmployeeId) || null,
      custodian: custodian
        ? {
            id: text(custodian.id),
            code: text(custodian.code),
            name: text(custodian.name),
          }
        : null,
      location: text(row.location) || null,
      acquiredOn: text(row.acquiredOn) || null,
      originalCost: text(row.originalCost) || null,
      currency: text(row.currency) || null,
      sourceDocumentId: text(row.sourceDocumentId) || null,
      notes: text(row.notes) || null,
      version: number(row.version),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private async event(
    c: DatabaseConnection,
    values: Partial<Row> & {
      assetId: string;
      subjectId: string;
      action: string;
      actorId: string;
    },
  ) {
    await c.repository('assetEvents').createOne({
      values: {
        id: randomUUID(),
        createdAt: new Date(),
        ...values,
      },
    });
  }

  async companies(
    principal: AssetPrincipal,
    query: AssetCompanyQuery,
    scope: AssetScope,
  ) {
    const subjectId = await this.resolveSubject(principal, undefined, scope);
    const rows = await this.database.repository('orgSubjects').findMany({
      filter: { status: 'active', ...(subjectId ? { id: subjectId } : {}) },
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

  async options(principal: AssetPrincipal, scope: AssetScope) {
    const subjectId = await this.resolveSubject(principal, undefined, scope);
    const subjects = await this.database.repository('orgSubjects').findMany({
      filter: subjectId ? { id: subjectId } : undefined,
      limit: 1000,
    });
    const employees = await this.database
      .repository('personnelEmployees')
      .findMany({
        filter: {
          status: 'active',
          ...(subjectId ? { subjectId } : {}),
        },
        limit: 5000,
      });
    return {
      subjects: subjects.map((row) => ({
        id: text(row.id),
        name: text(row.name),
      })),
      employees: employees.map((row) => ({
        id: text(row.id),
        code: text(row.code),
        name: text(row.name),
        subjectId: text(row.subjectId) || null,
      })),
      categories: [
        'electronics',
        'furniture',
        'vehicle',
        'machinery',
        'instrument',
        'other',
      ],
      permissions: {
        manage: scope.manage,
        readAll: scope.readAll,
        approve: scope.approve,
      },
    };
  }

  async list(principal: AssetPrincipal, query: AssetQuery, scope: AssetScope) {
    const subjectId = await this.resolveSubject(
      principal,
      query.subjectId,
      scope,
    );
    const filter = {
      ...(subjectId ? { subjectId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.custodianEmployeeId
        ? { custodianEmployeeId: query.custodianEmployeeId }
        : {}),
    };
    const rows = await this.database.repository('assets').findMany({
      ...(Object.keys(filter).length ? { filter } : {}),
      sort: (s) => [s.field('updatedAt').desc()],
      limit: 5000,
    });
    const needle = query.q?.toLocaleLowerCase();
    const filtered = needle
      ? rows.filter((row) =>
          [row.code, row.name, row.location].some((value) =>
            text(value).toLocaleLowerCase().includes(needle),
          ),
        )
      : rows;
    const start = (query.page - 1) * query.pageSize;
    return {
      rows: await Promise.all(
        filtered
          .slice(start, start + query.pageSize)
          .map((row) => this.view(row)),
      ),
      total: filtered.length,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async detail(principal: AssetPrincipal, id: string, scope: AssetScope) {
    const row = await this.database
      .repository('assets')
      .findOne({ filter: { id } });
    if (!row || !(await this.allowedSubject(principal, row, scope)))
      throw new AssetError('ASSET_NOT_FOUND');
    const events = await this.database.repository('assetEvents').findMany({
      filter: { assetId: id },
      sort: (s) => [s.field('createdAt').desc()],
      limit: 100,
    });
    return {
      ...(await this.view(row)),
      events: events.map((event) => ({
        id: text(event.id),
        action: text(event.action),
        fromEmployeeId: text(event.fromEmployeeId) || null,
        toEmployeeId: text(event.toEmployeeId) || null,
        fromLocation: text(event.fromLocation) || null,
        toLocation: text(event.toLocation) || null,
        fromStatus: text(event.fromStatus) || null,
        toStatus: text(event.toStatus) || null,
        actorId: text(event.actorId),
        note: text(event.note) || null,
        createdAt: event.createdAt,
      })),
    };
  }

  private async allowedSubject(
    principal: AssetPrincipal,
    row: Row,
    scope: AssetScope,
  ) {
    if (scope.readAll) return true;
    const company = await currentCompanyForUser(
      this.database,
      this.timeZone,
      principal,
    );
    return !!company && text(row.subjectId) === company;
  }

  async create(
    principal: AssetPrincipal,
    input: AssetCreate,
    scope: AssetScope,
  ) {
    if (!scope.manage) throw new AssetError('ASSET_FORBIDDEN');
    const subjectId = (await this.resolveSubject(
      principal,
      input.subjectId,
      scope,
      true,
    ))!;
    const custodian = input.custodianEmployeeId
      ? await this.employee(input.custodianEmployeeId)
      : null;
    if (input.custodianEmployeeId && !custodian)
      throw new AssetError('ASSET_INVALID', 'EMPLOYEE_NOT_ACTIVE');
    if (
      custodian &&
      text(custodian.subjectId) &&
      text(custodian.subjectId) !== subjectId
    )
      // Same code as the assign path: a cross-company custodian is one rule.
      throw new AssetError('ASSET_CUSTODIAN_COMPANY');
    const code =
      input.code ??
      `AST-${businessDate(this.timeZone).replaceAll('-', '')}-${randomUUID().slice(0, 6).toUpperCase()}`;
    if (
      await this.database
        .repository('assets')
        .exists({ filter: { subjectId, code } })
    )
      throw new AssetError('ASSET_CONFLICT', 'CODE_EXISTS');
    const id = randomUUID();
    const now = new Date();
    const status: AssetStatus = custodian ? 'assigned' : 'in_stock';
    await this.database.transaction(async (c) => {
      await c.repository('assets').createOne({
        values: {
          id,
          subjectId,
          code,
          name: input.name,
          category: input.category ?? null,
          status,
          custodianEmployeeId: custodian ? text(custodian.id) : null,
          location: input.location ?? null,
          acquiredOn: input.acquiredOn ?? null,
          originalCost: input.originalCost ?? null,
          currency: input.currency ?? 'CNY',
          sourceDocumentId: input.sourceDocumentId ?? null,
          notes: input.notes ?? null,
          version: 1,
          createdBy: principal.id,
          updatedBy: principal.id,
          createdAt: now,
          updatedAt: now,
        },
      });
      await this.event(c, {
        assetId: id,
        subjectId,
        action: custodian ? 'assign' : 'create',
        fromStatus: null,
        toStatus: status,
        toEmployeeId: custodian ? text(custodian.id) : null,
        toLocation: input.location ?? null,
        actorId: principal.id,
        note: custodian ? 'CREATE' : null,
      });
    });
    return this.detail(principal, id, scope);
  }

  async update(
    principal: AssetPrincipal,
    id: string,
    input: AssetUpdate,
    scope: AssetScope,
  ) {
    if (!scope.manage) throw new AssetError('ASSET_FORBIDDEN');
    const { version, ...values } = input;
    await this.database.transaction(async (c) => {
      const row = await c.repository('assets').findOne({ filter: { id } });
      if (!row || !(await this.allowedSubject(principal, row, scope)))
        throw new AssetError('ASSET_NOT_FOUND');
      if (text(row.status) === 'scrapped')
        throw new AssetError('ASSET_INVALID', 'ASSET_SCRAPPED');
      const status = text(row.status);
      const fromLocation = text(row.location) || null;
      const updated = await c.repository('assets').updateOne({
        filter: { id, version },
        values: {
          ...values,
          version: version + 1,
          updatedBy: principal.id,
          updatedAt: new Date(),
        },
      });
      if (!updated) throw new AssetError('ASSET_CONFLICT', 'VERSION_CONFLICT');
      await this.event(c, {
        assetId: id,
        subjectId: text(row.subjectId),
        action: 'update',
        fromStatus: status,
        toStatus: status,
        fromLocation,
        toLocation: values.location ?? fromLocation,
        actorId: principal.id,
        note: null,
      });
    });
    return this.detail(principal, id, scope);
  }

  async assign(
    principal: AssetPrincipal,
    id: string,
    input: AssetAssign,
    scope: AssetScope,
  ) {
    if (!scope.manage) throw new AssetError('ASSET_FORBIDDEN');
    const employee = await this.employee(input.employeeId);
    if (!employee) throw new AssetError('ASSET_INVALID', 'EMPLOYEE_NOT_ACTIVE');
    await this.database.transaction(async (c) => {
      const row = await c.repository('assets').findOne({ filter: { id } });
      if (!row || !(await this.allowedSubject(principal, row, scope)))
        throw new AssetError('ASSET_NOT_FOUND');
      if (text(row.status) === 'scrapped')
        throw new AssetError('ASSET_INVALID', 'ASSET_SCRAPPED');
      if (
        text(employee.subjectId) &&
        text(employee.subjectId) !== text(row.subjectId)
      )
        throw new AssetError('ASSET_CUSTODIAN_COMPANY');
      const fromEmployeeId = text(row.custodianEmployeeId) || null;
      const fromLocation = text(row.location) || null;
      const updated = await c.repository('assets').updateOne({
        filter: { id, version: input.version },
        values: {
          custodianEmployeeId: text(employee.id),
          status: 'assigned',
          location: input.location ?? fromLocation,
          version: input.version + 1,
          updatedBy: principal.id,
          updatedAt: new Date(),
        },
      });
      if (!updated) throw new AssetError('ASSET_CONFLICT', 'VERSION_CONFLICT');
      await this.event(c, {
        assetId: id,
        subjectId: text(row.subjectId),
        action: fromEmployeeId ? 'transfer' : 'assign',
        fromStatus: text(row.status),
        toStatus: 'assigned',
        fromEmployeeId,
        toEmployeeId: text(employee.id),
        fromLocation,
        toLocation: input.location ?? fromLocation,
        actorId: principal.id,
        note: input.note ?? null,
      });
    });
    return this.detail(principal, id, scope);
  }

  async returnAsset(
    principal: AssetPrincipal,
    id: string,
    input: AssetReturn,
    scope: AssetScope,
  ) {
    if (!scope.manage) throw new AssetError('ASSET_FORBIDDEN');
    await this.database.transaction(async (c) => {
      const row = await c.repository('assets').findOne({ filter: { id } });
      if (!row || !(await this.allowedSubject(principal, row, scope)))
        throw new AssetError('ASSET_NOT_FOUND');
      if (text(row.status) !== 'assigned')
        throw new AssetError('ASSET_INVALID', 'ASSET_NOT_ASSIGNED');
      const fromEmployeeId = text(row.custodianEmployeeId) || null;
      const fromLocation = text(row.location) || null;
      const updated = await c.repository('assets').updateOne({
        filter: { id, version: input.version, status: 'assigned' },
        values: {
          custodianEmployeeId: null,
          status: 'in_stock',
          location: input.location ?? fromLocation,
          version: input.version + 1,
          updatedBy: principal.id,
          updatedAt: new Date(),
        },
      });
      if (!updated) throw new AssetError('ASSET_CONFLICT', 'VERSION_CONFLICT');
      await this.event(c, {
        assetId: id,
        subjectId: text(row.subjectId),
        action: 'return',
        fromStatus: 'assigned',
        toStatus: 'in_stock',
        fromEmployeeId,
        fromLocation,
        toLocation: input.location ?? fromLocation,
        actorId: principal.id,
        note: input.note ?? null,
      });
    });
    return this.detail(principal, id, scope);
  }

  async requestScrap(
    principal: AssetPrincipal,
    id: string,
    input: AssetScrapRequest,
    scope: AssetScope,
  ) {
    if (!scope.manage) throw new AssetError('ASSET_FORBIDDEN');
    await this.database.transaction(async (c) => {
      const row = await c.repository('assets').findOne({ filter: { id } });
      if (!row || !(await this.allowedSubject(principal, row, scope)))
        throw new AssetError('ASSET_NOT_FOUND');
      if (text(row.status) === 'scrapped')
        throw new AssetError('ASSET_INVALID', 'ASSET_SCRAPPED');
      if (row.scrapPending === true)
        throw new AssetError('ASSET_CONFLICT', 'ASSET_SCRAP_PENDING');
      const updated = await c.repository('assets').updateOne({
        filter: { id, version: input.version },
        values: {
          scrapPending: true,
          scrapReason: input.reason,
          scrapDecision: null,
          scrapRequestedBy: principal.id,
          scrapRequestedAt: new Date(),
          scrapDecidedBy: null,
          scrapDecidedAt: null,
          version: input.version + 1,
          updatedBy: principal.id,
          updatedAt: new Date(),
        },
      });
      if (!updated) throw new AssetError('ASSET_CONFLICT', 'VERSION_CONFLICT');
      await this.event(c, {
        assetId: id,
        subjectId: text(row.subjectId),
        action: 'scrap_requested',
        fromStatus: text(row.status),
        toStatus: text(row.status),
        actorId: principal.id,
        note: input.reason,
      });
    });
    return this.detail(principal, id, scope);
  }

  async decideScrap(
    principal: AssetPrincipal,
    id: string,
    input: AssetScrapDecision,
    scope: AssetScope,
  ) {
    if (!scope.approve) throw new AssetError('ASSET_FORBIDDEN');
    await this.database.transaction(async (c) => {
      const row = await c.repository('assets').findOne({ filter: { id } });
      if (!row || !(await this.allowedSubject(principal, row, scope)))
        throw new AssetError('ASSET_NOT_FOUND');
      if (row.scrapPending !== true)
        throw new AssetError('ASSET_INVALID', 'ASSET_SCRAP_NOT_PENDING');
      if (text(row.scrapRequestedBy) === principal.id)
        throw new AssetError('ASSET_CONFLICT', 'ASSET_SELF_APPROVAL');
      const fromEmployeeId = text(row.custodianEmployeeId) || null;
      const fromLocation = text(row.location) || null;
      const values = input.approve
        ? {
            custodianEmployeeId: null,
            status: 'scrapped',
            scrapPending: false,
            scrapDecision: 'approved',
            scrapDecidedBy: principal.id,
            scrapDecidedAt: new Date(),
            version: input.version + 1,
            updatedBy: principal.id,
            updatedAt: new Date(),
          }
        : {
            scrapPending: false,
            scrapDecision: 'rejected',
            scrapDecidedBy: principal.id,
            scrapDecidedAt: new Date(),
            version: input.version + 1,
            updatedBy: principal.id,
            updatedAt: new Date(),
          };
      const updated = await c.repository('assets').updateOne({
        filter: { id, version: input.version },
        values,
      });
      if (!updated) throw new AssetError('ASSET_CONFLICT', 'VERSION_CONFLICT');
      await this.event(c, {
        assetId: id,
        subjectId: text(row.subjectId),
        action: input.approve ? 'scrap' : 'scrap_rejected',
        fromStatus: text(row.status),
        toStatus: input.approve ? 'scrapped' : text(row.status),
        fromEmployeeId,
        fromLocation,
        actorId: principal.id,
        note: input.note ?? (text(row.scrapReason) || null),
      });
    });
    return this.detail(principal, id, scope);
  }

  async employeeAssets(employeeId: string) {
    const rows = await this.database.repository('assets').findMany({
      filter: { custodianEmployeeId: employeeId, status: 'assigned' },
      sort: (s) => [s.field('code').asc()],
      limit: 1000,
    });
    return Promise.all(rows.map((row) => this.view(row)));
  }

  async outstandingForEmployee(employeeId: string) {
    return this.database.repository('assets').count({
      filter: { custodianEmployeeId: employeeId, status: 'assigned' },
    });
  }
}
