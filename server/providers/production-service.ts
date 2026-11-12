import { randomUUID } from 'node:crypto';
import type {
  DatabaseConnection,
  DatabaseManager,
  RepositoryRecord,
} from '@nocobase/db';
import { createServiceToken } from '@nocobase/service-provider';
import { businessDate, businessShiftContext } from './business-date.js';
import { currentCompanyForUser } from './company-identity.js';
import { resolveProductionIdentity } from './production-identity.js';
import type {
  AttendanceSave,
  AttendanceStatus,
  DowntimeCancel,
  DowntimeClose,
  DowntimeInput,
  EquipmentInput,
  EquipmentUpdate,
  MaintenanceInput,
  MaintenancePlanInput,
  MaintenancePlanUpdate,
  MaintenanceUpdate,
  OvertimeDecision,
  OvertimeInput,
  ProductionReportMaterial,
  ProductionReportMaintenance,
  ProductionReportQuery,
  ProductionReportSave,
  ProductionShift,
  ShiftReportInput,
  ShiftReportLineInput,
  ShiftReportLineUpdate,
  ShiftReportQuery,
  ShiftReportUpdate,
  ShiftReportVoid,
  UnitMaterialInput,
} from './production-model.js';
import { normalizeDecimal } from './material-model.js';
import { stockMicros, stockQuantity } from './inventory-quantity.js';

export const productionServiceToken = createServiceToken<ProductionService>(
  'group-erp/production',
);

export type ProductionPrincipal = { type: string; id: string };
export type ProductionErrorCode =
  | 'PRODUCTION_FORBIDDEN'
  | 'PRODUCTION_NOT_FOUND'
  | 'PRODUCTION_INVALID'
  | 'PRODUCTION_CONFLICT';

export class ProductionError extends Error {
  constructor(
    public readonly code: ProductionErrorCode,
    message: string = code,
  ) {
    super(message);
    this.name = 'ProductionError';
  }
}

export type ProductionScope = {
  readAll: boolean;
  manage: boolean;
  approve: boolean;
};

type Row = RepositoryRecord;
type AttendanceRow = {
  id: string;
  personId: string;
  positionId: string;
  status: AttendanceStatus | 'unrecorded';
  absenceReason: string | null;
  overtimeMinutes: number;
  overtimeContent: string | null;
};

const text = (value: unknown) => (typeof value === 'string' ? value : '');
const number = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const businessToday = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
const addDays = (date: string, days: number) => {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

/** The manager and an open transaction expose the same repositories. */
type WriteConnection = DatabaseManager | DatabaseConnection;

export class ProductionService {
  constructor(
    private readonly database: DatabaseManager,
    private readonly timeZone: string,
  ) {}

  private async resolveSubject(
    principal: ProductionPrincipal,
    requested: string | undefined,
    scope: ProductionScope,
    write = false,
  ): Promise<string | null> {
    if (scope.readAll) {
      if (requested) return requested;
      if (write)
        throw new ProductionError('PRODUCTION_INVALID', 'SUBJECT_REQUIRED');
      return null;
    }
    const company = await currentCompanyForUser(
      this.database,
      this.timeZone,
      principal,
    );
    if (!company) throw new ProductionError('PRODUCTION_FORBIDDEN');
    if (requested && requested !== company)
      throw new ProductionError('PRODUCTION_FORBIDDEN');
    return company;
  }

  private async findUnit(unitId: string) {
    const unit = await this.database
      .repository('orgUnits')
      .findOne({ filter: { id: unitId } });
    if (!unit)
      throw new ProductionError('PRODUCTION_NOT_FOUND', 'UNIT_NOT_FOUND');
    return unit;
  }

  private async assertUnit(subjectId: string, unitId: string) {
    const unit = await this.findUnit(unitId);
    if (text(unit.subjectId) !== subjectId)
      throw new ProductionError('PRODUCTION_INVALID', 'UNIT_NOT_IN_COMPANY');
    return unit;
  }

  private async unitMaterials(
    database: WriteConnection,
    subjectId: string,
    unitId: string,
  ) {
    const rows = await database.repository('prdUnitMaterials').findMany({
      filter: { unitId, status: 'active' },
      limit: 500,
      sort: (sort) => [
        sort.field('sortOrder').asc(),
        sort.field('createdAt').asc(),
      ],
    });
    const skuIds = [...new Set(rows.map((row) => text(row.skuId)))];
    const skus = skuIds.length
      ? await database.repository('materialSkus').findMany({
          filter: (f) => f.or(skuIds.map((id) => f.string('id').eq(id))),
          limit: 500,
        })
      : [];
    const unitIds = [
      ...new Set(skus.map((row) => text(row.baseUnitId)).filter(Boolean)),
    ];
    const measureUnits = unitIds.length
      ? await database.repository('measureUnits').findMany({
          filter: (f) => f.or(unitIds.map((id) => f.string('id').eq(id))),
          limit: 500,
        })
      : [];
    const warehouseIds = [
      ...new Set(
        rows
          .map((row) => text(row.defaultWarehouseId))
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const warehouses = warehouseIds.length
      ? await database.repository('warehouses').findMany({
          filter: (f) => f.or(warehouseIds.map((id) => f.string('id').eq(id))),
          limit: 500,
        })
      : [];
    const skuById = new Map(skus.map((row) => [text(row.id), row] as const));
    const unitName = new Map(
      measureUnits.map((row) => [text(row.id), text(row.name)] as const),
    );
    const warehouseById = new Map(
      warehouses.map((row) => [text(row.id), row] as const),
    );
    return await Promise.all(
      rows.map(async (row) => {
        const sku = skuById.get(text(row.skuId));
        const skuId = text(row.skuId);
        const warehouseId = text(row.defaultWarehouseId) || null;
        let bookQuantity: string | null = null;
        if (warehouseId) {
          const balances = await database.repository('stockBalances').findMany({
            filter: { subjectId, skuId, warehouseId },
            limit: 200,
          });
          bookQuantity = stockQuantity(
            balances.reduce(
              (sum, balance) => sum + stockMicros(text(balance.quantity)),
              0n,
            ),
          );
        }
        return {
          id: text(row.id),
          unitId,
          subjectId,
          skuId,
          skuCode: text(sku?.code),
          skuName: text(sku?.name),
          unit: unitName.get(text(sku?.baseUnitId)) ?? '',
          role: text(row.role),
          defaultWarehouseId: warehouseId,
          warehouseName: text(warehouseById.get(warehouseId ?? '')?.name),
          sortOrder: number(row.sortOrder),
          notes: text(row.notes) || null,
          bookQuantity,
        };
      }),
    );
  }

  private current(row: Row, on: string) {
    const data = (row.data ?? {}) as Record<string, unknown>;
    const start = text(data.startDate);
    const end = text(data.endDate);
    return start <= on && (!end || end > on);
  }

  async options(principal: ProductionPrincipal, scope: ProductionScope) {
    const company = await this.resolveSubject(principal, undefined, scope);
    const subjects = await this.database.repository('orgSubjects').findMany({
      filter: {
        status: 'active',
        ...(company ? { id: company } : {}),
      },
      limit: 1000,
      sort: (sort) => [sort.field('sortOrder').asc(), sort.field('name').asc()],
    });
    const positions = await this.database.repository('orgPositions').findMany({
      filter: { status: 'active', productionRole: 'production' },
      limit: 10000,
    });
    const productionUnits = new Set(
      positions.map((position) => text(position.unitId)).filter(Boolean),
    );
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
      units: units
        .filter((unit) => productionUnits.has(text(unit.id)))
        .map((unit) => ({
          id: text(unit.id),
          name: text(unit.name),
          subjectId: text(unit.subjectId),
        })),
    };
  }

  async setup(principal: ProductionPrincipal, scope: ProductionScope) {
    const company = await this.resolveSubject(principal, undefined, scope);
    const scopeFilter = company ? { subjectId: company } : undefined;
    const units = await this.database.repository('orgUnits').findMany({
      filter: {
        status: 'active',
        ...(company ? { subjectId: company } : {}),
      },
      limit: 5000,
      sort: (sort) => [sort.field('sortOrder').asc(), sort.field('name').asc()],
    });
    const profiles = await this.database
      .repository('prdUnitProfiles')
      .findMany({
        ...(scopeFilter ? { filter: scopeFilter } : {}),
        limit: 10000,
      });
    const materials = await this.database
      .repository('prdUnitMaterials')
      .findMany({
        ...(scopeFilter ? { filter: scopeFilter } : {}),
        limit: 10000,
        sort: (sort) => [
          sort.field('sortOrder').asc(),
          sort.field('createdAt').asc(),
        ],
      });
    const skus = await this.database.repository('materialSkus').findMany({
      filter: { status: 'active' },
      limit: 10000,
      sort: (sort) => [sort.field('code').asc()],
    });
    const warehouses = await this.database.repository('warehouses').findMany({
      filter: {
        status: 'active',
        ...(company ? { subjectId: company } : {}),
      },
      limit: 5000,
      sort: (sort) => [sort.field('name').asc()],
    });
    const measureUnitIds = [
      ...new Set(skus.map((row) => text(row.baseUnitId)).filter(Boolean)),
    ];
    const measureUnits = measureUnitIds.length
      ? await this.database.repository('measureUnits').findMany({
          filter: (f) =>
            f.or(measureUnitIds.map((id) => f.string('id').eq(id))),
          limit: 5000,
        })
      : [];
    const skuById = new Map(skus.map((row) => [text(row.id), row] as const));
    const measureUnitName = new Map(
      measureUnits.map((row) => [text(row.id), text(row.name)] as const),
    );
    const warehouseById = new Map(
      warehouses.map((row) => [text(row.id), row] as const),
    );
    return {
      units: units.map((row) => ({
        id: text(row.id),
        code: text(row.code),
        name: text(row.name),
        subjectId: text(row.subjectId),
      })),
      profiles: profiles.map((row) => ({
        unitId: text(row.unitId),
        lineCode: text(row.lineCode) || null,
        processType: text(row.processType) || null,
        designCapacityTpd:
          row.designCapacityTpd === null || row.designCapacityTpd === undefined
            ? null
            : number(row.designCapacityTpd),
        commissionDate: text(row.commissionDate) || null,
        region: text(row.region) || null,
        gatewayKey: text(row.gatewayKey) || null,
        fuxaPageKey: text(row.fuxaPageKey) || null,
        status: text(row.status) || 'active',
      })),
      materials: materials.map((row) => {
        const sku = skuById.get(text(row.skuId));
        const warehouse = warehouseById.get(text(row.defaultWarehouseId));
        return {
          unitId: text(row.unitId),
          skuId: text(row.skuId),
          skuCode: text(sku?.code),
          skuName: text(sku?.name),
          unit: measureUnitName.get(text(sku?.baseUnitId)) ?? '',
          role: text(row.role),
          defaultWarehouseId: text(row.defaultWarehouseId) || null,
          warehouseName: text(warehouse?.name),
          sortOrder: number(row.sortOrder),
          status: text(row.status) || 'active',
          notes: text(row.notes) || null,
        };
      }),
      skus: skus.map((row) => ({
        id: text(row.id),
        code: text(row.code),
        name: text(row.name),
        unit: measureUnitName.get(text(row.baseUnitId)) ?? '',
      })),
      warehouses: warehouses.map((row) => ({
        id: text(row.id),
        code: text(row.code),
        name: text(row.name),
        subjectId: text(row.subjectId),
      })),
    };
  }

  async saveUnitSetup(
    principal: ProductionPrincipal,
    unitId: string,
    input: {
      lineCode?: string | null;
      processType?: string | null;
      designCapacityTpd?: number | null;
      commissionDate?: string | null;
      region?: string | null;
      gatewayKey?: string | null;
      fuxaPageKey?: string | null;
      status: 'active' | 'inactive';
      materials: UnitMaterialInput[];
    },
    scope: ProductionScope,
  ) {
    if (!scope.manage)
      throw new ProductionError('PRODUCTION_FORBIDDEN', 'PERMISSION_DENIED');
    const unit = await this.findUnit(unitId);
    const subjectId = await this.resolveSubject(
      principal,
      text(unit.subjectId),
      scope,
      true,
    );
    if (!subjectId) throw new ProductionError('PRODUCTION_INVALID');
    await this.assertUnit(subjectId, unitId);
    const seen = new Set<string>();
    for (const material of input.materials) {
      if (seen.has(material.skuId))
        throw new ProductionError('PRODUCTION_INVALID', 'DUPLICATE_MATERIAL');
      seen.add(material.skuId);
      const sku = await this.database.repository('materialSkus').findOne({
        filter: { id: material.skuId, status: 'active' },
      });
      if (!sku)
        throw new ProductionError('PRODUCTION_INVALID', 'SKU_NOT_FOUND');
      if (material.defaultWarehouseId) {
        const warehouse = await this.database.repository('warehouses').findOne({
          filter: {
            id: material.defaultWarehouseId,
            subjectId,
            status: 'active',
          },
        });
        if (!warehouse)
          throw new ProductionError(
            'PRODUCTION_INVALID',
            'WAREHOUSE_NOT_FOUND',
          );
      }
    }
    const now = new Date().toISOString();
    await this.database.transaction(async (c) => {
      const profiles = c.repository('prdUnitProfiles');
      const previous = await profiles.findOne({ filter: { unitId } });
      const values = {
        subjectId,
        unitId,
        lineCode: input.lineCode ?? null,
        processType: input.processType ?? null,
        designCapacityTpd: input.designCapacityTpd ?? null,
        commissionDate: input.commissionDate ?? null,
        region: input.region ?? null,
        gatewayKey: input.gatewayKey ?? null,
        fuxaPageKey: input.fuxaPageKey ?? null,
        status: input.status,
      };
      if (previous) {
        await profiles.updateOne({
          filter: { id: text(previous.id) },
          values: {
            ...values,
            version: number(previous.version) + 1,
            updatedBy: principal.id,
            updatedAt: now,
          } as never,
        });
      } else {
        await profiles.createOne({
          values: {
            ...values,
            id: randomUUID(),
            version: 1,
            createdBy: principal.id,
            updatedBy: principal.id,
            createdAt: now,
            updatedAt: now,
          } as never,
        });
      }
      const materials = c.repository('prdUnitMaterials');
      await materials.deleteMany({ filter: { unitId } });
      for (const material of input.materials) {
        await materials.createOne({
          values: {
            id: randomUUID(),
            subjectId,
            unitId,
            skuId: material.skuId,
            role: material.role,
            defaultWarehouseId: material.defaultWarehouseId ?? null,
            sortOrder: material.sortOrder,
            status: 'active',
            notes: material.notes ?? null,
            version: 1,
            createdBy: principal.id,
            updatedBy: principal.id,
            createdAt: now,
            updatedAt: now,
          } as never,
        });
      }
    });
    return this.setup(principal, scope);
  }

  private async productionPeople(
    database: WriteConnection,
    unitId: string,
    subjectId: string,
    onDate: string,
  ): Promise<
    {
      personId: string;
      personName: string;
      positionId: string;
      positionName: string;
    }[]
  > {
    const positions = await database.repository('orgPositions').findMany({
      filter: {
        unitId,
        status: 'active',
        productionRole: 'production',
      },
      limit: 10000,
      sort: (sort) => [sort.field('sortOrder').asc(), sort.field('name').asc()],
    });
    if (!positions.length) return [];

    const assignments = await database
      .repository('personnelAssignments')
      .findMany({
        filter: { subjectId },
        limit: 100000,
      });
    const employees = await database
      .repository('personnelEmployees')
      .findMany({ filter: { status: 'active' }, limit: 100000 });
    const employeeNames = new Map(
      employees.map((row) => [text(row.id), text(row.name)] as const),
    );
    const byPosition = new Map<string, { personId: string; name: string }[]>();
    for (const assignment of assignments) {
      if (
        !this.current(assignment, onDate) ||
        (assignment.data as Record<string, unknown> | undefined)?.type !==
          'primary'
      )
        continue;
      const positionId = text(assignment.positionId);
      const personId = text(assignment.personId);
      const name = employeeNames.get(personId);
      if (!positionId || !personId || !name) continue;
      const list = byPosition.get(positionId) ?? [];
      if (!list.some((person) => person.personId === personId))
        list.push({ personId, name });
      byPosition.set(positionId, list);
    }

    const seen = new Set<string>();
    const rows: {
      personId: string;
      personName: string;
      positionId: string;
      positionName: string;
    }[] = [];
    for (const position of positions) {
      const positionId = text(position.id);
      const people = (byPosition.get(positionId) ?? []).sort((a, b) =>
        a.name.localeCompare(b.name, 'zh-CN'),
      );
      for (const person of people) {
        if (seen.has(person.personId)) continue;
        seen.add(person.personId);
        rows.push({
          personId: person.personId,
          personName: person.name,
          positionId,
          positionName: text(position.name),
        });
      }
    }
    return rows;
  }

  async roster(
    principal: ProductionPrincipal,
    input: {
      unitId: string;
      workDate: string;
      shift: ProductionShift;
    },
    scope: ProductionScope,
  ) {
    const unit = await this.findUnit(input.unitId);
    const subjectId = text(unit.subjectId);
    await this.resolveSubject(principal, subjectId, scope);
    const subject = await this.database
      .repository('orgSubjects')
      .findOne({ filter: { id: subjectId } });
    const people = await this.productionPeople(
      this.database,
      input.unitId,
      subjectId,
      input.workDate,
    );
    if (!people.length)
      return {
        unit: { id: input.unitId, name: text(unit.name) },
        subjectName: text(subject?.name),
        workDate: input.workDate,
        shift: input.shift,
        source: 'positions' as const,
        scheduleId: null,
        rows: [] as (AttendanceRow & {
          personName: string;
          positionName: string;
        })[],
        summary: {
          expected: 0,
          present: 0,
          absent: 0,
          leave: 0,
          rest: 0,
          unrecorded: 0,
          overtimePeople: 0,
          overtimeMinutes: 0,
        },
      };

    const attendanceRows = await this.database
      .repository('prdAttendanceRecords')
      .findMany({
        filter: (f) =>
          f.and([
            f.string('subjectId').eq(subjectId),
            f.date('workDate').on(input.workDate),
            f.string('shift').eq(input.shift),
          ]),
        limit: 10000,
      });
    const attendance = new Map(
      attendanceRows.map((row) => [text(row.personId), row] as const),
    );
    let rows: (AttendanceRow & {
      personName: string;
      positionName: string;
    })[] = people.map((person) => {
      const record = attendance.get(person.personId);
      return {
        id: record ? text(record.id) : '',
        personId: person.personId,
        personName: person.personName,
        positionId: person.positionId,
        positionName: person.positionName,
        status: record
          ? (text(record.status) as AttendanceStatus)
          : 'unrecorded',
        absenceReason: record ? text(record.absenceReason) || null : null,
        overtimeMinutes: record ? number(record.overtimeMinutes) : 0,
        overtimeContent: record ? text(record.overtimeContent) || null : null,
      };
    });
    let source: 'positions' | 'schedule' = 'positions';
    let scheduleId: string | null = null;
    const schedule = await this.database.repository('prdSchedules').findOne({
      filter: (f) =>
        f.and([
          f.string('subjectId').eq(subjectId),
          f.string('unitId').eq(input.unitId),
          f.date('scheduleDate').on(input.workDate),
          f.string('shift').eq(input.shift),
          f.string('status').eq('published'),
        ]),
    });
    if (schedule) {
      const scheduleAssignments = await this.database
        .repository('prdScheduleAssignments')
        .findMany({
          filter: { scheduleId: text(schedule.id) },
          limit: 10000,
        });
      const assigned = new Set(
        scheduleAssignments.map((row) => text(row.personId)),
      );
      rows = rows.filter((row) => assigned.has(row.personId));
      source = 'schedule';
      scheduleId = text(schedule.id);
    }
    const summary = {
      expected: rows.length,
      present: rows.filter((row) => row.status === 'present').length,
      absent: rows.filter((row) => row.status === 'absent').length,
      leave: rows.filter((row) => row.status === 'leave').length,
      rest: rows.filter((row) => row.status === 'rest').length,
      unrecorded: rows.filter((row) => row.status === 'unrecorded').length,
      overtimePeople: rows.filter((row) => row.overtimeMinutes > 0).length,
      overtimeMinutes: rows.reduce((sum, row) => sum + row.overtimeMinutes, 0),
    };
    return {
      unit: { id: input.unitId, name: text(unit.name) },
      subjectName: text(subject?.name),
      workDate: input.workDate,
      shift: input.shift,
      source,
      scheduleId,
      rows,
      summary,
    };
  }

  async save(
    principal: ProductionPrincipal,
    input: AttendanceSave,
    scope: ProductionScope,
  ) {
    if (!scope.manage)
      throw new ProductionError('PRODUCTION_FORBIDDEN', 'PERMISSION_DENIED');
    const unit = await this.findUnit(input.unitId);
    const subjectId = await this.resolveSubject(
      principal,
      text(unit.subjectId),
      scope,
      true,
    );
    if (!subjectId) throw new ProductionError('PRODUCTION_INVALID');
    await this.assertUnit(subjectId, input.unitId);
    await this.writeAttendance(this.database, principal, subjectId, input);
    return this.roster(principal, input, scope);
  }

  /**
   * Replace the attendance of one shift. A record that is no longer submitted
   * is removed, so correcting a roster cannot leave a stale entry behind.
   */
  private async writeAttendance(
    connection: WriteConnection,
    principal: ProductionPrincipal,
    subjectId: string,
    input: Pick<AttendanceSave, 'unitId' | 'workDate' | 'shift' | 'records'>,
  ) {
    const positions = await connection.repository('orgPositions').findMany({
      filter: {
        unitId: input.unitId,
        status: 'active',
        productionRole: 'production',
      },
      limit: 10000,
    });
    const positionIds = new Set(positions.map((row) => text(row.id)));
    const assignments = await connection
      .repository('personnelAssignments')
      .findMany({ filter: { subjectId }, limit: 100000 });
    const personPositions = new Map<string, string>();
    for (const assignment of assignments) {
      if (
        !this.current(assignment, input.workDate) ||
        (assignment.data as Record<string, unknown> | undefined)?.type !==
          'primary'
      )
        continue;
      const personId = text(assignment.personId);
      const positionId = text(assignment.positionId);
      if (personId && positionId && !personPositions.has(personId))
        personPositions.set(personId, positionId);
    }
    const now = new Date().toISOString();
    for (const record of input.records) {
      if (!positionIds.has(record.positionId))
        throw new ProductionError('PRODUCTION_INVALID', 'POSITION_NOT_IN_UNIT');
      if (personPositions.get(record.personId) !== record.positionId)
        throw new ProductionError(
          'PRODUCTION_INVALID',
          'PERSON_NOT_ON_POSITION',
        );
      if (
        record.overtimeMinutes > 0 &&
        record.status !== 'present' &&
        record.status !== 'rest'
      )
        throw new ProductionError(
          'PRODUCTION_INVALID',
          'OVERTIME_WITHOUT_PRESENCE',
        );
      if (record.overtimeMinutes > 0 && !(record.overtimeContent ?? '').trim())
        throw new ProductionError(
          'PRODUCTION_INVALID',
          'OVERTIME_CONTENT_REQUIRED',
        );
      const existing = await connection
        .repository('prdAttendanceRecords')
        .findOne({
          filter: (f) =>
            f.and([
              f.string('personId').eq(record.personId),
              f.date('workDate').on(input.workDate),
              f.string('shift').eq(input.shift),
            ]),
        });
      const values = {
        subjectId,
        unitId: input.unitId,
        personId: record.personId,
        positionId: record.positionId,
        workDate: input.workDate,
        shift: input.shift,
        status: record.status,
        absenceReason: record.absenceReason ?? null,
        overtimeMinutes: record.overtimeMinutes,
        overtimeContent: record.overtimeContent ?? null,
      };
      if (existing) {
        await connection.repository('prdAttendanceRecords').updateOne({
          filter: { id: text(existing.id) },
          values: {
            ...values,
            version: number(existing.version) + 1,
            updatedBy: principal.id,
            updatedAt: now,
          } as never,
        });
      } else {
        await connection.repository('prdAttendanceRecords').createOne({
          values: {
            ...values,
            id: randomUUID(),
            version: 1,
            createdBy: principal.id,
            updatedBy: principal.id,
            createdAt: now,
            updatedAt: now,
          } as never,
        });
      }
    }
    const submitted = new Set(input.records.map((record) => record.personId));
    const current = await connection
      .repository('prdAttendanceRecords')
      .findMany({
        filter: (f) =>
          f.and([
            f.string('unitId').eq(input.unitId),
            f.date('workDate').on(input.workDate),
            f.string('shift').eq(input.shift),
          ]),
        limit: 1000,
      });
    for (const row of current)
      if (!submitted.has(text(row.personId)))
        await connection
          .repository('prdAttendanceRecords')
          .deleteOne({ filter: { id: text(row.id) } });
  }

  /** Identity and defaults for the single production reporting page. */
  async reportContext(principal: ProductionPrincipal, scope: ProductionScope) {
    const identity = await resolveProductionIdentity(
      this.database,
      this.timeZone,
      principal,
    );
    const current = businessShiftContext(this.timeZone);
    return {
      identity,
      businessDate: identity.today,
      reportDate: current.reportDate,
      shift: current.shift,
      canManage: scope.manage,
    };
  }

  async getReport(
    principal: ProductionPrincipal,
    query: ProductionReportQuery,
    scope: ProductionScope,
  ) {
    const unit = await this.findUnit(query.unitId);
    const subjectId = text(unit.subjectId);
    const resolved = await this.resolveSubject(principal, subjectId, scope);
    if (resolved) await this.assertUnit(resolved, query.unitId);
    const row = await this.database.repository('prdShiftReports').findOne({
      filter: (f) =>
        f.and([
          f.string('unitId').eq(query.unitId),
          f.date('reportDate').on(query.reportDate),
          f.string('shift').eq(query.shift),
        ]),
    });
    const report = row ? await this.shiftReportDetail(row) : null;
    const [attendance, downtime, overtime, equipment] = await Promise.all([
      this.roster(
        principal,
        {
          unitId: query.unitId,
          workDate: query.reportDate,
          shift: query.shift,
        },
        scope,
      ),
      this.listDowntimeEvents(
        principal,
        { unitId: query.unitId, date: query.reportDate },
        scope,
      ),
      this.listOvertime(
        principal,
        { unitId: query.unitId, businessDate: query.reportDate },
        scope,
      ),
      this.listEquipment(principal, { unitId: query.unitId }, scope),
    ]);
    return {
      unit: {
        id: text(unit.id),
        code: text(unit.code),
        name: text(unit.name),
        subjectId,
      },
      reportDate: query.reportDate,
      shift: query.shift,
      materials: await this.unitMaterials(
        this.database,
        subjectId,
        query.unitId,
      ),
      equipment: equipment.equipment.filter(
        (item) => item.status !== 'retired',
      ),
      maintenance: await this.reportMaintenance(
        subjectId,
        query.unitId,
        query.reportDate,
      ),
      report,
      attendance,
      downtime,
      overtime,
    };
  }

  /**
   * One transaction for everything the shift lead records: the shift report,
   * the attendance roster, the downtime log and overtime requests. The rows
   * carry client generated ids so a retried submission stays idempotent.
   */
  async submitReport(
    principal: ProductionPrincipal,
    input: ProductionReportSave,
    scope: ProductionScope,
  ) {
    if (!scope.manage)
      throw new ProductionError('PRODUCTION_FORBIDDEN', 'PERMISSION_DENIED');
    if (input.reportDate > businessDate(this.timeZone))
      throw new ProductionError('PRODUCTION_INVALID', 'REPORT_DATE_FUTURE');
    const unit = await this.findUnit(input.unitId);
    const subjectId = await this.resolveSubject(
      principal,
      text(unit.subjectId),
      scope,
      true,
    );
    if (!subjectId) throw new ProductionError('PRODUCTION_INVALID');
    await this.assertUnit(subjectId, input.unitId);
    const identity = await resolveProductionIdentity(
      this.database,
      this.timeZone,
      principal,
    );
    const assigned = identity.units.find((item) => item.id === input.unitId);
    if (!scope.readAll && !assigned)
      throw new ProductionError('PRODUCTION_FORBIDDEN', 'UNIT_NOT_ASSIGNED');
    await this.database.transaction(async (connection) => {
      if (input.report)
        await this.writeShiftReport(
          connection,
          principal,
          subjectId,
          input,
          assigned?.positionId ?? null,
        );
      await this.writeAttendance(connection, principal, subjectId, {
        unitId: input.unitId,
        workDate: input.reportDate,
        shift: input.shift,
        records: input.attendance,
      });
      for (const row of input.downtime)
        await this.writeDowntime(
          connection,
          principal,
          subjectId,
          input.unitId,
          row,
        );
      for (const row of input.overtime)
        await this.writeOvertime(
          connection,
          principal,
          subjectId,
          input.unitId,
          input.reportDate,
          row,
        );
      for (const row of input.maintenance)
        await this.writeMaintenance(
          connection,
          principal,
          subjectId,
          input.unitId,
          input.reportDate,
          row,
        );
    });
    return this.getReport(
      principal,
      {
        unitId: input.unitId,
        reportDate: input.reportDate,
        shift: input.shift,
      },
      scope,
    );
  }

  private async writeShiftReport(
    connection: DatabaseConnection,
    principal: ProductionPrincipal,
    subjectId: string,
    input: ProductionReportSave,
    positionId: string | null,
  ) {
    const content = input.report!;
    const existing = await connection.repository('prdShiftReports').findOne({
      filter: (f) =>
        f.and([
          f.string('unitId').eq(input.unitId),
          f.date('reportDate').on(input.reportDate),
          f.string('shift').eq(input.shift),
        ]),
    });
    const values = {
      runtimeMinutes: content.runtimeMinutes,
      downtimeMinutes: content.downtimeMinutes,
      notes: content.notes ?? null,
    };
    let reportId: string;
    if (existing) {
      if (text(existing.status) !== 'draft')
        throw new ProductionError('PRODUCTION_INVALID', 'REPORT_NOT_DRAFT');
      if (!content.version)
        throw new ProductionError(
          'PRODUCTION_INVALID',
          'REPORT_VERSION_REQUIRED',
        );
      if (number(existing.version) !== content.version)
        throw new ProductionError('PRODUCTION_CONFLICT');
      const result = await connection.repository('prdShiftReports').updateOne({
        filter: { id: text(existing.id), version: content.version },
        values: {
          ...values,
          version: content.version + 1,
          updatedBy: principal.id,
          updatedAt: new Date().toISOString(),
        } as never,
      });
      if (!result.record) throw new ProductionError('PRODUCTION_CONFLICT');
      reportId = text(existing.id);
    } else {
      if (content.version)
        throw new ProductionError('PRODUCTION_NOT_FOUND', 'REPORT_NOT_FOUND');
      reportId = randomUUID();
      const now = new Date().toISOString();
      await connection.repository('prdShiftReports').createOne({
        values: {
          id: reportId,
          subjectId,
          unitId: input.unitId,
          reportDate: input.reportDate,
          shift: input.shift,
          status: 'draft',
          ...values,
          processedQuantity: '0',
          metalQuantity: '0',
          sandQuantity: '0',
          tailingsQuantity: '0',
          confirmedBy: null,
          confirmedAt: null,
          enteredBy: principal.id,
          enteredByPositionId: positionId,
          sourceChannel: 'manual',
          version: 1,
          createdBy: principal.id,
          updatedBy: principal.id,
          createdAt: now,
          updatedAt: now,
        } as never,
      });
    }
    await this.writeReportMaterials(
      connection,
      principal,
      subjectId,
      input.unitId,
      reportId,
      content.materials,
    );
  }

  /**
   * One row per configured material. The physical count is what the shift lead
   * typed; the book quantity is the stock balance at submission time, so the
   * report keeps the difference it showed even after the warehouse moves.
   */
  private async writeReportMaterials(
    connection: DatabaseConnection,
    principal: ProductionPrincipal,
    subjectId: string,
    unitId: string,
    reportId: string,
    materials: ProductionReportMaterial[],
  ) {
    const repository = connection.repository('prdShiftReportMaterials');
    await repository.deleteMany({ filter: { reportId } });
    if (!materials.length) return;
    const configs = await this.unitMaterials(connection, subjectId, unitId);
    const configBySku = new Map(
      configs.map((row) => [row.skuId, row] as const),
    );
    const now = new Date().toISOString();
    for (const material of materials) {
      const config = configBySku.get(material.skuId);
      if (!config)
        throw new ProductionError(
          'PRODUCTION_INVALID',
          'MATERIAL_NOT_CONFIGURED',
        );
      let bookQuantity: string | null = null;
      if (config.defaultWarehouseId) {
        const balances = await connection.repository('stockBalances').findMany({
          filter: {
            subjectId,
            skuId: material.skuId,
            warehouseId: config.defaultWarehouseId,
          },
          limit: 200,
        });
        const total = balances.reduce(
          (sum, row) => sum + stockMicros(text(row.quantity)),
          0n,
        );
        bookQuantity = stockQuantity(total);
      }
      await repository.createOne({
        values: {
          id: randomUUID(),
          reportId,
          subjectId,
          unitId,
          skuId: material.skuId,
          role: material.role,
          quantity: normalizeDecimal(material.quantity),
          stockQuantity:
            material.stockQuantity === null ||
            material.stockQuantity === undefined
              ? null
              : normalizeDecimal(material.stockQuantity),
          bookQuantity,
          note: material.note ?? '',
          version: 1,
          createdBy: principal.id,
          updatedBy: principal.id,
          createdAt: now,
          updatedAt: now,
        } as never,
      });
    }
    const totals = new Map<string, bigint>();
    for (const material of materials) {
      const micros = stockMicros(material.quantity);
      totals.set(material.role, (totals.get(material.role) ?? 0n) + micros);
    }
    await connection.repository('prdShiftReports').updateOne({
      filter: { id: reportId },
      values: {
        processedQuantity: stockQuantity(totals.get('feedstock') ?? 0n),
        metalQuantity: stockQuantity(totals.get('product') ?? 0n),
        sandQuantity: stockQuantity(totals.get('byproduct') ?? 0n),
        updatedBy: principal.id,
        updatedAt: now,
      } as never,
    });
  }

  private async writeDowntime(
    connection: WriteConnection,
    principal: ProductionPrincipal,
    subjectId: string,
    unitId: string,
    input: Omit<DowntimeInput, 'unitId'> & { id?: string },
  ) {
    if (input.equipmentId) {
      const equipment = await connection
        .repository('prdEquipment')
        .findOne({ filter: { id: input.equipmentId } });
      if (!equipment)
        throw new ProductionError(
          'PRODUCTION_NOT_FOUND',
          'EQUIPMENT_NOT_FOUND',
        );
      if (text(equipment.unitId) !== unitId)
        throw new ProductionError(
          'PRODUCTION_INVALID',
          'EQUIPMENT_NOT_IN_UNIT',
        );
    }
    const id = input.id ?? randomUUID();
    if (input.id) {
      const existing = await connection
        .repository('prdDowntimeEvents')
        .findOne({ filter: { id } });
      if (existing) {
        if (text(existing.unitId) !== unitId)
          throw new ProductionError(
            'PRODUCTION_INVALID',
            'DOWNTIME_ID_CONFLICT',
          );
        return existing;
      }
    }
    const startedAt = this.parseInstant(input.startedAt, 'STARTED_AT_INVALID');
    const now = new Date().toISOString();
    const eventNo = `DT-${this.localDate(startedAt).replaceAll(
      '-',
      '',
    )}-${id.slice(0, 4).toUpperCase()}`;
    await connection.repository('prdDowntimeEvents').createOne({
      values: {
        id,
        subjectId,
        unitId,
        equipmentId: input.equipmentId ?? null,
        eventNo,
        startedAt,
        endedAt: null,
        durationMinutes: 0,
        category: input.category,
        impact: input.impact,
        status: 'open',
        description: input.description,
        resolution: null,
        reportedBy: principal.id,
        closedBy: null,
        version: 1,
        createdBy: principal.id,
        updatedBy: principal.id,
        createdAt: now,
        updatedAt: now,
      } as never,
    });
    return (await connection
      .repository('prdDowntimeEvents')
      .findOne({ filter: { id } }))!;
  }

  private async writeOvertime(
    connection: WriteConnection,
    principal: ProductionPrincipal,
    subjectId: string,
    unitId: string,
    onDate: string,
    input: Omit<OvertimeInput, 'unitId' | 'businessDate'> & { id?: string },
  ) {
    const id = input.id ?? randomUUID();
    if (input.id) {
      const existing = await connection
        .repository('prdOvertimeRequests')
        .findOne({ filter: { id } });
      if (existing) {
        if (text(existing.unitId) !== unitId)
          throw new ProductionError(
            'PRODUCTION_INVALID',
            'OVERTIME_ID_CONFLICT',
          );
        return existing;
      }
    }
    const people = await this.productionPeople(
      connection,
      unitId,
      subjectId,
      onDate,
    );
    const person = people.find((row) => row.personId === input.personId);
    if (!person)
      throw new ProductionError('PRODUCTION_INVALID', 'PERSON_NOT_ON_POSITION');
    const now = new Date().toISOString();
    const requestNo = `OT-${onDate.replaceAll('-', '')}-${id
      .slice(0, 4)
      .toUpperCase()}`;
    await connection.repository('prdOvertimeRequests').createOne({
      values: {
        id,
        subjectId,
        unitId,
        personId: input.personId,
        positionId: person.positionId,
        businessDate: onDate,
        requestNo,
        hours: input.hours.toFixed(2),
        type: input.type,
        reason: input.reason,
        compensation: input.compensation,
        status: 'submitted',
        approverId: null,
        approverName: null,
        decidedAt: null,
        rejectReason: null,
        version: 1,
        createdBy: principal.id,
        updatedBy: principal.id,
        createdAt: now,
        updatedAt: now,
      } as never,
    });
    return (await connection
      .repository('prdOvertimeRequests')
      .findOne({ filter: { id } }))!;
  }

  private async writeMaintenance(
    connection: DatabaseConnection,
    principal: ProductionPrincipal,
    subjectId: string,
    unitId: string,
    reportDate: string,
    input: ProductionReportMaintenance,
  ) {
    const existing = await connection
      .repository('prdMaintenanceOrders')
      .findOne({ filter: { id: input.id } });
    if (existing) {
      if (text(existing.unitId) !== unitId)
        throw new ProductionError(
          'PRODUCTION_INVALID',
          'MAINTENANCE_ID_CONFLICT',
        );
      return existing;
    }
    const equipment = await connection
      .repository('prdEquipment')
      .findOne({ filter: { id: input.equipmentId } });
    if (!equipment)
      throw new ProductionError('PRODUCTION_NOT_FOUND', 'EQUIPMENT_NOT_FOUND');
    if (text(equipment.unitId) !== unitId)
      throw new ProductionError('PRODUCTION_INVALID', 'EQUIPMENT_NOT_IN_UNIT');
    if (text(equipment.status) === 'retired')
      throw new ProductionError('PRODUCTION_INVALID', 'EQUIPMENT_RETIRED');
    const now = new Date().toISOString();
    const reportedAt = new Date(`${reportDate}T08:00:00+08:00`).toISOString();
    const orderNo = `MO-${reportDate.replaceAll('-', '')}-${input.id
      .slice(0, 4)
      .toUpperCase()}`;
    await connection.repository('prdMaintenanceOrders').createOne({
      values: {
        id: input.id,
        subjectId,
        unitId,
        equipmentId: input.equipmentId,
        planId: null,
        orderNo,
        type: input.kind === 'maintenance' ? 'preventive' : 'repair',
        priority: 'normal',
        status: 'reported',
        reportedBy: principal.id,
        reportedAt,
        assigneeName: input.assigneeName ?? null,
        description: input.description,
        cause: null,
        solution: null,
        startedAt: null,
        finishedAt: null,
        downtimeMinutes: 0,
        version: 1,
        createdBy: principal.id,
        updatedBy: principal.id,
        createdAt: now,
        updatedAt: now,
      } as never,
    });
    return (await connection
      .repository('prdMaintenanceOrders')
      .findOne({ filter: { id: input.id } }))!;
  }

  private async reportMaintenance(
    subjectId: string,
    unitId: string,
    reportDate: string,
  ) {
    const rows = await this.database
      .repository('prdMaintenanceOrders')
      .findMany({
        filter: (f) =>
          f.and([
            f.string('subjectId').eq(subjectId),
            f.string('unitId').eq(unitId),
          ]),
        limit: 1000,
        sort: (sort) => [sort.field('reportedAt').desc()],
      });
    const todays = rows.filter(
      (row) => this.localDate(row.reportedAt) === reportDate,
    );
    const equipmentIds = [
      ...new Set(todays.map((row) => text(row.equipmentId))),
    ];
    const equipment = equipmentIds.length
      ? await this.database.repository('prdEquipment').findMany({
          filter: (f) => f.or(equipmentIds.map((id) => f.string('id').eq(id))),
          limit: 1000,
        })
      : [];
    const names = new Map(
      equipment.map((row) => [text(row.id), text(row.name)] as const),
    );
    return todays.map((row) =>
      this.maintenanceView(row, names.get(text(row.equipmentId)) ?? ''),
    );
  }

  async getSchedule(
    principal: ProductionPrincipal,
    input: { unitId: string; scheduleDate: string; shift: ProductionShift },
    scope: ProductionScope,
  ) {
    const unit = await this.findUnit(input.unitId);
    const subjectId = text(unit.subjectId);
    await this.resolveSubject(principal, subjectId, scope);
    const subject = await this.database
      .repository('orgSubjects')
      .findOne({ filter: { id: subjectId } });
    const row = await this.database.repository('prdSchedules').findOne({
      filter: (f) =>
        f.and([
          f.string('subjectId').eq(subjectId),
          f.string('unitId').eq(input.unitId),
          f.date('scheduleDate').on(input.scheduleDate),
          f.string('shift').eq(input.shift),
        ]),
    });
    return this.schedulePayload(
      row ?? null,
      input.unitId,
      text(unit.name),
      subjectId,
      text(subject?.name),
      input.scheduleDate,
      input.shift,
    );
  }

  async saveSchedule(
    principal: ProductionPrincipal,
    input: {
      unitId: string;
      scheduleDate: string;
      shift: ProductionShift;
      personIds: string[];
      notes?: string | null;
    },
    scope: ProductionScope,
  ) {
    if (!scope.manage)
      throw new ProductionError('PRODUCTION_FORBIDDEN', 'PERMISSION_DENIED');
    const unit = await this.findUnit(input.unitId);
    const subjectId = text(unit.subjectId);
    await this.resolveSubject(principal, subjectId, scope);
    const candidates = await this.productionPeople(
      this.database,
      input.unitId,
      subjectId,
      input.scheduleDate,
    );
    const candidateIds = new Set(candidates.map((person) => person.personId));
    const candidateById = new Map(
      candidates.map((person) => [person.personId, person] as const),
    );
    const personIds = [...new Set(input.personIds)];
    if (personIds.some((personId) => !candidateIds.has(personId)))
      throw new ProductionError(
        'PRODUCTION_INVALID',
        'SCHEDULE_PERSON_NOT_IN_UNIT',
      );
    const now = new Date().toISOString();
    const existing = await this.database.repository('prdSchedules').findOne({
      filter: (f) =>
        f.and([
          f.string('subjectId').eq(subjectId),
          f.string('unitId').eq(input.unitId),
          f.date('scheduleDate').on(input.scheduleDate),
          f.string('shift').eq(input.shift),
        ]),
    });
    const scheduleId = existing ? text(existing.id) : randomUUID();
    await this.database.transaction(async (c) => {
      if (existing) {
        await c.repository('prdSchedules').updateMany({
          filter: { id: scheduleId },
          values: {
            notes: input.notes ?? null,
            status: 'draft',
            version: number(existing.version) + 1,
            updatedBy: principal.id,
            updatedAt: now,
          } as never,
        });
      } else {
        await c.repository('prdSchedules').createOne({
          values: {
            id: scheduleId,
            subjectId,
            unitId: input.unitId,
            scheduleDate: input.scheduleDate,
            shift: input.shift,
            status: 'draft',
            notes: input.notes ?? null,
            version: 1,
            createdBy: principal.id,
            updatedBy: principal.id,
            createdAt: now,
            updatedAt: now,
          } as never,
        });
      }
      await c
        .repository('prdScheduleAssignments')
        .deleteMany({ filter: { scheduleId } });
      for (const personId of personIds) {
        const candidate = candidateById.get(personId)!;
        await c.repository('prdScheduleAssignments').createOne({
          values: {
            id: randomUUID(),
            scheduleId,
            subjectId,
            unitId: input.unitId,
            personId,
            positionId: candidate.positionId,
            createdBy: principal.id,
            createdAt: now,
          } as never,
        });
      }
    });
    return this.getSchedule(principal, input, scope);
  }

  async publishSchedule(
    principal: ProductionPrincipal,
    id: string,
    scope: ProductionScope,
  ) {
    if (!scope.approve)
      throw new ProductionError('PRODUCTION_FORBIDDEN', 'PERMISSION_DENIED');
    const row = await this.database
      .repository('prdSchedules')
      .findOne({ filter: { id } });
    if (!row)
      throw new ProductionError('PRODUCTION_NOT_FOUND', 'SCHEDULE_NOT_FOUND');
    await this.resolveSubject(principal, text(row.subjectId), scope);
    const assignments = await this.database
      .repository('prdScheduleAssignments')
      .count({ filter: { scheduleId: id } });
    if (!assignments)
      throw new ProductionError('PRODUCTION_INVALID', 'SCHEDULE_EMPTY');
    await this.database.repository('prdSchedules').updateMany({
      filter: { id },
      values: {
        status: 'published',
        version: number(row.version) + 1,
        updatedBy: principal.id,
        updatedAt: new Date().toISOString(),
      } as never,
    });
    return { id, status: 'published' };
  }

  async listEquipment(
    principal: ProductionPrincipal,
    query: { unitId?: string },
    scope: ProductionScope,
  ) {
    const company = await this.resolveSubject(principal, undefined, scope);
    let unit: Row | null = null;
    if (query.unitId) {
      unit = await this.findUnit(query.unitId);
      if (company && text(unit.subjectId) !== company)
        throw new ProductionError('PRODUCTION_FORBIDDEN');
    }
    const subjectId = unit ? text(unit.subjectId) : (company ?? undefined);
    const filter = {
      ...(subjectId ? { subjectId } : {}),
      ...(unit ? { unitId: text(unit.id) } : {}),
    };
    const rows = await this.database.repository('prdEquipment').findMany({
      filter: Object.keys(filter).length > 0 ? filter : undefined,
      limit: 5000,
      sort: (sort) => [sort.field('code').asc()],
    });
    return { equipment: rows.map((row) => this.equipmentView(row)) };
  }

  async createEquipment(
    principal: ProductionPrincipal,
    input: EquipmentInput,
    scope: ProductionScope,
  ) {
    if (!scope.manage)
      throw new ProductionError('PRODUCTION_FORBIDDEN', 'PERMISSION_DENIED');
    const unit = await this.findUnit(input.unitId);
    const subjectId = text(unit.subjectId);
    await this.resolveSubject(principal, subjectId, scope, true);
    const duplicate = await this.database.repository('prdEquipment').exists({
      filter: { subjectId, code: input.code },
    });
    if (duplicate)
      throw new ProductionError('PRODUCTION_CONFLICT', 'EQUIPMENT_CODE_EXISTS');
    const now = new Date().toISOString();
    const id = randomUUID();
    await this.database.repository('prdEquipment').createOne({
      values: {
        id,
        subjectId,
        unitId: input.unitId,
        code: input.code,
        name: input.name,
        category: input.category ?? null,
        criticality: input.criticality,
        status: input.status,
        location: input.location ?? null,
        commissionedOn: input.commissionedOn ?? null,
        notes: input.notes ?? null,
        version: 1,
        createdBy: principal.id,
        updatedBy: principal.id,
        createdAt: now,
        updatedAt: now,
      } as never,
    });
    return this.equipmentView(
      (await this.database
        .repository('prdEquipment')
        .findOne({ filter: { id } }))!,
    );
  }

  async updateEquipment(
    principal: ProductionPrincipal,
    id: string,
    input: EquipmentUpdate,
    scope: ProductionScope,
  ) {
    if (!scope.manage)
      throw new ProductionError('PRODUCTION_FORBIDDEN', 'PERMISSION_DENIED');
    const row = await this.database.repository('prdEquipment').findOne({
      filter: { id },
    });
    if (!row)
      throw new ProductionError('PRODUCTION_NOT_FOUND', 'EQUIPMENT_NOT_FOUND');
    await this.resolveSubject(principal, text(row.subjectId), scope);
    if (number(row.version) !== input.version)
      throw new ProductionError('PRODUCTION_CONFLICT', 'VERSION_CONFLICT');
    await this.database.repository('prdEquipment').updateMany({
      filter: { id },
      values: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.criticality !== undefined
          ? { criticality: input.criticality }
          : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.location !== undefined ? { location: input.location } : {}),
        ...(input.commissionedOn !== undefined
          ? { commissionedOn: input.commissionedOn }
          : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        version: input.version + 1,
        updatedBy: principal.id,
        updatedAt: new Date().toISOString(),
      } as never,
    });
    return this.equipmentView(
      (await this.database
        .repository('prdEquipment')
        .findOne({ filter: { id } }))!,
    );
  }

  async listMaintenancePlans(
    principal: ProductionPrincipal,
    query: { unitId?: string },
    scope: ProductionScope,
  ) {
    const company = await this.resolveSubject(principal, undefined, scope);
    let unit: Row | null = null;
    if (query.unitId) {
      unit = await this.findUnit(query.unitId);
      if (company && text(unit.subjectId) !== company)
        throw new ProductionError('PRODUCTION_FORBIDDEN');
    }
    const subjectId = unit ? text(unit.subjectId) : (company ?? undefined);
    const filter = {
      ...(subjectId ? { subjectId } : {}),
      ...(unit ? { unitId: text(unit.id) } : {}),
    };
    const rows = await this.database
      .repository('prdMaintenancePlans')
      .findMany({
        filter: Object.keys(filter).length > 0 ? filter : undefined,
        limit: 5000,
        sort: (sort) => [sort.field('nextDueOn').asc()],
      });
    const equipmentIds = [...new Set(rows.map((row) => text(row.equipmentId)))];
    const equipmentRows =
      equipmentIds.length > 0
        ? await this.database.repository('prdEquipment').findMany({
            filter: (f) =>
              f.or(equipmentIds.map((id) => f.string('id').eq(id))),
            limit: 5000,
          })
        : [];
    const equipmentNames = new Map(
      equipmentRows.map((row) => [text(row.id), text(row.name)]),
    );
    const orders = await this.database
      .repository('prdMaintenanceOrders')
      .findMany({
        filter: subjectId ? { subjectId } : undefined,
        limit: 5000,
      });
    const openByPlan = new Map(
      orders
        .filter(
          (row) =>
            text(row.planId) &&
            ['reported', 'in_progress'].includes(text(row.status)),
        )
        .map((row) => [text(row.planId), row]),
    );
    return {
      plans: rows.map((row) =>
        this.maintenancePlanView(
          row,
          equipmentNames.get(text(row.equipmentId)) ?? '',
          openByPlan.get(text(row.id)) ?? null,
        ),
      ),
    };
  }

  async createMaintenancePlan(
    principal: ProductionPrincipal,
    input: MaintenancePlanInput,
    scope: ProductionScope,
  ) {
    if (!scope.manage)
      throw new ProductionError('PRODUCTION_FORBIDDEN', 'PERMISSION_DENIED');
    const unit = await this.findUnit(input.unitId);
    const subjectId = text(unit.subjectId);
    await this.resolveSubject(principal, subjectId, scope, true);
    const equipment = await this.database
      .repository('prdEquipment')
      .findOne({ filter: { id: input.equipmentId } });
    if (!equipment)
      throw new ProductionError('PRODUCTION_NOT_FOUND', 'EQUIPMENT_NOT_FOUND');
    if (text(equipment.unitId) !== input.unitId)
      throw new ProductionError('PRODUCTION_INVALID', 'EQUIPMENT_NOT_IN_UNIT');
    const duplicate = await this.database
      .repository('prdMaintenancePlans')
      .exists({
        filter: { equipmentId: input.equipmentId, name: input.name },
      });
    if (duplicate)
      throw new ProductionError('PRODUCTION_CONFLICT', 'PLAN_NAME_EXISTS');
    const now = new Date().toISOString();
    const id = randomUUID();
    await this.database.repository('prdMaintenancePlans').createOne({
      values: {
        id,
        subjectId,
        unitId: input.unitId,
        equipmentId: input.equipmentId,
        name: input.name,
        type: input.type,
        intervalDays: input.intervalDays,
        nextDueOn: input.nextDueOn,
        checklist: input.checklist ?? null,
        assigneeName: input.assigneeName ?? null,
        status: 'active',
        lastCompletedOn: null,
        lastOrderId: null,
        version: 1,
        createdBy: principal.id,
        updatedBy: principal.id,
        createdAt: now,
        updatedAt: now,
      } as never,
    });
    return this.maintenancePlanView(
      (await this.database
        .repository('prdMaintenancePlans')
        .findOne({ filter: { id } }))!,
      text(equipment.name),
      null,
    );
  }

  async updateMaintenancePlan(
    principal: ProductionPrincipal,
    id: string,
    input: MaintenancePlanUpdate,
    scope: ProductionScope,
  ) {
    if (!scope.manage)
      throw new ProductionError('PRODUCTION_FORBIDDEN', 'PERMISSION_DENIED');
    const row = await this.database
      .repository('prdMaintenancePlans')
      .findOne({ filter: { id } });
    if (!row)
      throw new ProductionError('PRODUCTION_NOT_FOUND', 'PLAN_NOT_FOUND');
    await this.resolveSubject(principal, text(row.subjectId), scope);
    if (number(row.version) !== input.version)
      throw new ProductionError('PRODUCTION_CONFLICT', 'VERSION_CONFLICT');
    const now = new Date().toISOString();
    await this.database.repository('prdMaintenancePlans').updateMany({
      filter: { id },
      values: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.intervalDays !== undefined
          ? { intervalDays: input.intervalDays }
          : {}),
        ...(input.nextDueOn !== undefined
          ? { nextDueOn: input.nextDueOn }
          : {}),
        ...(input.checklist !== undefined
          ? { checklist: input.checklist }
          : {}),
        ...(input.assigneeName !== undefined
          ? { assigneeName: input.assigneeName }
          : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        version: input.version + 1,
        updatedBy: principal.id,
        updatedAt: now,
      } as never,
    });
    const updated = (await this.database
      .repository('prdMaintenancePlans')
      .findOne({ filter: { id } }))!;
    const equipment = await this.database
      .repository('prdEquipment')
      .findOne({ filter: { id: text(updated.equipmentId) } });
    return this.maintenancePlanView(
      updated,
      equipment ? text(equipment.name) : '',
      null,
    );
  }

  async generatePlanOrder(
    principal: ProductionPrincipal,
    planId: string,
    scope: ProductionScope,
  ) {
    if (!scope.manage)
      throw new ProductionError('PRODUCTION_FORBIDDEN', 'PERMISSION_DENIED');
    const plan = await this.database
      .repository('prdMaintenancePlans')
      .findOne({ filter: { id: planId } });
    if (!plan)
      throw new ProductionError('PRODUCTION_NOT_FOUND', 'PLAN_NOT_FOUND');
    const subjectId = text(plan.subjectId);
    await this.resolveSubject(principal, subjectId, scope);
    if (text(plan.status) !== 'active')
      throw new ProductionError('PRODUCTION_INVALID', 'PLAN_PAUSED');
    const equipment = await this.database
      .repository('prdEquipment')
      .findOne({ filter: { id: text(plan.equipmentId) } });
    if (!equipment)
      throw new ProductionError('PRODUCTION_NOT_FOUND', 'EQUIPMENT_NOT_FOUND');
    if (text(equipment.status) === 'retired')
      throw new ProductionError('PRODUCTION_INVALID', 'EQUIPMENT_RETIRED');
    const existing = (
      await this.database.repository('prdMaintenanceOrders').findMany({
        filter: { planId },
        limit: 10,
      })
    ).find((order) => ['reported', 'in_progress'].includes(text(order.status)));
    if (existing)
      return {
        ...this.maintenanceView(existing, text(equipment.name)),
        existing: true,
      };
    const now = new Date().toISOString();
    const orderNo = `MO-${now.slice(0, 10).replaceAll('-', '')}-${randomUUID().slice(0, 4).toUpperCase()}`;
    const description = [text(plan.name), text(plan.checklist) || null]
      .filter(Boolean)
      .join('\n');
    const id = randomUUID();
    await this.database.transaction(async (c) => {
      await c.repository('prdMaintenanceOrders').createOne({
        values: {
          id,
          subjectId,
          unitId: text(plan.unitId),
          equipmentId: text(plan.equipmentId),
          planId,
          orderNo,
          type: text(plan.type),
          priority: 'normal',
          status: 'reported',
          reportedBy: principal.id,
          reportedAt: now,
          assigneeName: plan.assigneeName ?? null,
          description,
          cause: null,
          solution: null,
          startedAt: null,
          finishedAt: null,
          downtimeMinutes: 0,
          version: 1,
          createdBy: principal.id,
          updatedBy: principal.id,
          createdAt: now,
          updatedAt: now,
        } as never,
      });
      await c.repository('prdMaintenancePlans').updateMany({
        filter: { id: planId },
        values: { lastOrderId: id, updatedAt: now } as never,
      });
    });
    return {
      ...this.maintenanceView(
        (await this.database
          .repository('prdMaintenanceOrders')
          .findOne({ filter: { id } }))!,
        text(equipment.name),
      ),
      existing: false,
    };
  }

  async listMaintenanceOrders(
    principal: ProductionPrincipal,
    query: { unitId?: string; status?: string },
    scope: ProductionScope,
  ) {
    const company = await this.resolveSubject(principal, undefined, scope);
    let unit: Row | null = null;
    if (query.unitId) {
      unit = await this.findUnit(query.unitId);
      if (company && text(unit.subjectId) !== company)
        throw new ProductionError('PRODUCTION_FORBIDDEN');
    }
    const subjectId = unit ? text(unit.subjectId) : (company ?? undefined);
    const filter = {
      ...(subjectId ? { subjectId } : {}),
      ...(unit ? { unitId: text(unit.id) } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const rows = await this.database
      .repository('prdMaintenanceOrders')
      .findMany({
        filter: Object.keys(filter).length > 0 ? filter : undefined,
        limit: 1000,
        sort: (sort) => [sort.field('reportedAt').desc()],
      });
    const equipmentIds = [...new Set(rows.map((row) => text(row.equipmentId)))];
    const equipment = equipmentIds.length
      ? await this.database.repository('prdEquipment').findMany({
          filter: (f) =>
            f.or(
              equipmentIds.map((equipmentId) => f.string('id').eq(equipmentId)),
            ),
          limit: 5000,
        })
      : [];
    const names = new Map(
      equipment.map((row) => [text(row.id), text(row.name)] as const),
    );
    return {
      orders: rows.map((row) =>
        this.maintenanceView(row, names.get(text(row.equipmentId)) ?? ''),
      ),
    };
  }

  async createMaintenanceOrder(
    principal: ProductionPrincipal,
    input: MaintenanceInput,
    scope: ProductionScope,
  ) {
    if (!scope.manage)
      throw new ProductionError('PRODUCTION_FORBIDDEN', 'PERMISSION_DENIED');
    const unit = await this.findUnit(input.unitId);
    const subjectId = text(unit.subjectId);
    await this.resolveSubject(principal, subjectId, scope, true);
    const equipment = await this.database
      .repository('prdEquipment')
      .findOne({ filter: { id: input.equipmentId } });
    if (!equipment)
      throw new ProductionError('PRODUCTION_NOT_FOUND', 'EQUIPMENT_NOT_FOUND');
    if (text(equipment.unitId) !== input.unitId)
      throw new ProductionError('PRODUCTION_INVALID', 'EQUIPMENT_NOT_IN_UNIT');
    if (text(equipment.status) === 'retired')
      throw new ProductionError('PRODUCTION_INVALID', 'EQUIPMENT_RETIRED');
    const now = new Date().toISOString();
    const reportedAt = input.reportedAt ?? now;
    const orderNo = `MO-${reportedAt.slice(0, 10).replaceAll('-', '')}-${randomUUID().slice(0, 4).toUpperCase()}`;
    const id = randomUUID();
    await this.database.repository('prdMaintenanceOrders').createOne({
      values: {
        id,
        subjectId,
        unitId: input.unitId,
        equipmentId: input.equipmentId,
        orderNo,
        type: input.type,
        priority: input.priority,
        status: 'reported',
        reportedBy: principal.id,
        reportedAt,
        assigneeName: input.assigneeName ?? null,
        description: input.description,
        cause: null,
        solution: null,
        startedAt: null,
        finishedAt: null,
        downtimeMinutes: 0,
        version: 1,
        createdBy: principal.id,
        updatedBy: principal.id,
        createdAt: now,
        updatedAt: now,
      } as never,
    });
    return this.maintenanceView(
      (await this.database
        .repository('prdMaintenanceOrders')
        .findOne({ filter: { id } }))!,
      text(equipment.name),
    );
  }

  async updateMaintenanceOrder(
    principal: ProductionPrincipal,
    id: string,
    input: MaintenanceUpdate,
    scope: ProductionScope,
  ) {
    if (!scope.manage)
      throw new ProductionError('PRODUCTION_FORBIDDEN', 'PERMISSION_DENIED');
    const row = await this.database
      .repository('prdMaintenanceOrders')
      .findOne({ filter: { id } });
    if (!row)
      throw new ProductionError(
        'PRODUCTION_NOT_FOUND',
        'MAINTENANCE_NOT_FOUND',
      );
    await this.resolveSubject(principal, text(row.subjectId), scope);
    if (number(row.version) !== input.version)
      throw new ProductionError('PRODUCTION_CONFLICT', 'VERSION_CONFLICT');
    const current = text(row.status);
    const next = input.status ?? current;
    const allowed: Record<string, string[]> = {
      reported: ['reported', 'in_progress', 'cancelled'],
      in_progress: ['in_progress', 'completed', 'cancelled'],
      completed: ['completed'],
      cancelled: ['cancelled'],
    };
    if (!allowed[current]?.includes(next))
      throw new ProductionError(
        'PRODUCTION_INVALID',
        'MAINTENANCE_STATUS_INVALID',
      );
    if (next === 'completed' && !(input.solution ?? text(row.solution)).trim())
      throw new ProductionError(
        'PRODUCTION_INVALID',
        'MAINTENANCE_SOLUTION_REQUIRED',
      );
    const now = new Date().toISOString();
    const planId = text(row.planId);
    const plan = planId
      ? await this.database
          .repository('prdMaintenancePlans')
          .findOne({ filter: { id: planId } })
      : null;
    const startedAt =
      next === 'in_progress'
        ? text(row.startedAt) || now
        : text(row.startedAt) || null;
    const finishedAt =
      next === 'completed' ? now : text(row.finishedAt) || null;
    await this.database.transaction(async (c) => {
      await c.repository('prdMaintenanceOrders').updateMany({
        filter: { id },
        values: {
          status: next,
          ...(input.assigneeName !== undefined
            ? { assigneeName: input.assigneeName }
            : {}),
          ...(input.cause !== undefined ? { cause: input.cause } : {}),
          ...(input.solution !== undefined ? { solution: input.solution } : {}),
          ...(input.downtimeMinutes !== undefined
            ? { downtimeMinutes: input.downtimeMinutes }
            : {}),
          startedAt,
          finishedAt,
          version: input.version + 1,
          updatedBy: principal.id,
          updatedAt: now,
        } as never,
      });
      if (next === 'in_progress')
        await c.repository('prdEquipment').updateMany({
          filter: { id: text(row.equipmentId) },
          values: { status: 'maintenance', updatedAt: now } as never,
        });
      if (next === 'completed' || next === 'cancelled')
        await c.repository('prdEquipment').updateMany({
          filter: { id: text(row.equipmentId) },
          values: { status: 'active', updatedAt: now } as never,
        });
      if (next === 'completed' && plan) {
        const completedOn = businessToday();
        await c.repository('prdMaintenancePlans').updateMany({
          filter: { id: planId },
          values: {
            lastCompletedOn: completedOn,
            nextDueOn: addDays(completedOn, number(plan.intervalDays)),
            lastOrderId: id,
            version: number(plan.version) + 1,
            updatedBy: principal.id,
            updatedAt: now,
          } as never,
        });
      }
    });
    const updated = (await this.database
      .repository('prdMaintenanceOrders')
      .findOne({ filter: { id } }))!;
    const equipment = await this.database
      .repository('prdEquipment')
      .findOne({ filter: { id: text(row.equipmentId) } });
    return this.maintenanceView(updated, equipment ? text(equipment.name) : '');
  }

  private maintenancePlanView(
    row: Row,
    equipmentName: string,
    openOrder: Row | null,
  ) {
    const today = businessToday();
    const nextDueOn = text(row.nextDueOn);
    const status = text(row.status);
    const dueStatus =
      status === 'paused'
        ? 'paused'
        : nextDueOn < today
          ? 'overdue'
          : nextDueOn <= addDays(today, 7)
            ? 'due_soon'
            : 'ok';
    return {
      id: text(row.id),
      subjectId: text(row.subjectId),
      unitId: text(row.unitId),
      equipmentId: text(row.equipmentId),
      equipmentName,
      name: text(row.name),
      type: text(row.type),
      intervalDays: number(row.intervalDays),
      nextDueOn,
      checklist: text(row.checklist) || null,
      assigneeName: text(row.assigneeName) || null,
      status,
      dueStatus,
      lastCompletedOn: text(row.lastCompletedOn) || null,
      lastOrderId: text(row.lastOrderId) || null,
      openOrderId: openOrder ? text(openOrder.id) : null,
      openOrderNo: openOrder ? text(openOrder.orderNo) : null,
      version: number(row.version),
      updatedAt: text(row.updatedAt),
    };
  }

  private equipmentView(row: Row) {
    return {
      id: text(row.id),
      subjectId: text(row.subjectId),
      unitId: text(row.unitId),
      code: text(row.code),
      name: text(row.name),
      category: text(row.category) || null,
      criticality: text(row.criticality),
      status: text(row.status),
      location: text(row.location) || null,
      commissionedOn: text(row.commissionedOn) || null,
      notes: text(row.notes) || null,
      version: number(row.version),
      updatedAt: text(row.updatedAt),
    };
  }

  private maintenanceView(row: Row, equipmentName: string) {
    return {
      id: text(row.id),
      subjectId: text(row.subjectId),
      unitId: text(row.unitId),
      equipmentId: text(row.equipmentId),
      equipmentName,
      planId: text(row.planId) || null,
      orderNo: text(row.orderNo),
      type: text(row.type),
      priority: text(row.priority),
      status: text(row.status),
      reportedBy: text(row.reportedBy),
      reportedAt: text(row.reportedAt),
      assigneeName: text(row.assigneeName) || null,
      description: text(row.description),
      cause: text(row.cause) || null,
      solution: text(row.solution) || null,
      startedAt: text(row.startedAt) || null,
      finishedAt: text(row.finishedAt) || null,
      downtimeMinutes: number(row.downtimeMinutes),
      version: number(row.version),
      updatedAt: text(row.updatedAt),
    };
  }

  private scheduleView(row: Row) {
    return {
      id: text(row.id),
      subjectId: text(row.subjectId),
      unitId: text(row.unitId),
      scheduleDate: text(row.scheduleDate),
      shift: text(row.shift),
      status: text(row.status),
      notes: text(row.notes) || null,
      version: number(row.version),
      updatedAt: text(row.updatedAt),
    };
  }

  private async schedulePayload(
    row: Row | null,
    unitId: string,
    unitName: string,
    subjectId: string,
    subjectName: string,
    scheduleDate: string,
    shift: ProductionShift,
  ) {
    const people = await this.productionPeople(
      this.database,
      unitId,
      subjectId,
      scheduleDate,
    );
    const assignments = row
      ? await this.database
          .repository('prdScheduleAssignments')
          .findMany({ filter: { scheduleId: text(row.id) }, limit: 10000 })
      : [];
    const assigned = new Set(
      assignments.map((assignment) => text(assignment.personId)),
    );
    return {
      schedule: row ? this.scheduleView(row) : null,
      unit: { id: unitId, name: unitName },
      subjectName,
      scheduleDate,
      shift,
      people: people.map((person) => ({
        ...person,
        assigned: assigned.has(person.personId),
      })),
      summary: { planned: people.length, assigned: assigned.size },
    };
  }

  private async reportInputs(reportIds: string[]) {
    if (!reportIds.length) return new Map<string, Record<string, unknown>[]>();
    const inputs = await this.database
      .repository('prdShiftReportInputs')
      .findMany({
        filter: (f) =>
          f.or(reportIds.map((reportId) => f.string('reportId').eq(reportId))),
        limit: 5000,
        sort: (sort) => [sort.field('createdAt').asc()],
      });
    const skuIds = [...new Set(inputs.map((input) => text(input.skuId)))];
    const unitIds = [...new Set(inputs.map((input) => text(input.unitId)))];
    const documentIds = [
      ...new Set(
        inputs.map((input) => text(input.stockDocumentId)).filter(Boolean),
      ),
    ];
    const [skus, units, documents] = await Promise.all([
      skuIds.length
        ? this.database.repository('materialSkus').findMany({
            filter: (f) =>
              f.or(skuIds.map((skuId) => f.string('id').eq(skuId))),
            limit: 5000,
          })
        : [],
      unitIds.length
        ? this.database.repository('measureUnits').findMany({
            filter: (f) =>
              f.or(unitIds.map((unitId) => f.string('id').eq(unitId))),
            limit: 1000,
          })
        : [],
      documentIds.length
        ? this.database.repository('stockDocuments').findMany({
            filter: (f) =>
              f.or(
                documentIds.map((documentId) => f.string('id').eq(documentId)),
              ),
            limit: 1000,
          })
        : [],
    ]);
    const skuById = new Map(skus.map((sku) => [text(sku.id), sku] as const));
    const unitById = new Map(
      units.map((unit) => [text(unit.id), unit] as const),
    );
    const documentById = new Map(
      documents.map((document) => [text(document.id), document] as const),
    );
    const grouped = new Map<string, Record<string, unknown>[]>();
    for (const input of inputs) {
      const sku = skuById.get(text(input.skuId));
      const unit = unitById.get(text(input.unitId));
      const document = documentById.get(text(input.stockDocumentId));
      const view = {
        id: text(input.id),
        reportId: text(input.reportId),
        skuId: text(input.skuId),
        skuCode: text(sku?.code) || null,
        skuName: text(sku?.name) || null,
        quantity: text(input.quantity),
        unitId: text(input.unitId),
        unit: text(input.unit) || text(unit?.name) || null,
        sourceType: text(input.sourceType),
        issueRequestId: text(input.issueRequestId) || null,
        issueRequestLineId: text(input.issueRequestLineId) || null,
        stockDocumentId: text(input.stockDocumentId) || null,
        stockDocumentLineId: text(input.stockDocumentLineId) || null,
        stockDocumentCode: text(document?.code) || null,
        stockDocumentStatus: document ? text(document.status) : null,
        note: text(input.note) || null,
        version: number(input.version),
      };
      const list = grouped.get(text(input.reportId)) ?? [];
      list.push(view);
      grouped.set(text(input.reportId), list);
    }
    return grouped;
  }

  private reportView(row: Row) {
    return {
      id: text(row.id),
      subjectId: text(row.subjectId),
      unitId: text(row.unitId),
      reportDate: text(row.reportDate),
      shift: text(row.shift),
      status: text(row.status),
      processedQuantity: text(row.processedQuantity),
      metalQuantity: text(row.metalQuantity),
      sandQuantity: text(row.sandQuantity),
      tailingsQuantity: text(row.tailingsQuantity),
      runtimeMinutes: number(row.runtimeMinutes),
      downtimeMinutes: number(row.downtimeMinutes),
      notes: text(row.notes) || null,
      confirmedBy: text(row.confirmedBy) || null,
      confirmedAt: text(row.confirmedAt) || null,
      voidedBy: text(row.voidedBy) || null,
      voidedAt: text(row.voidedAt) || null,
      voidReason: text(row.voidReason) || null,
      reopenedBy: text(row.reopenedBy) || null,
      reopenedAt: text(row.reopenedAt) || null,
      correctionHistory: Array.isArray(row.correctionHistory)
        ? row.correctionHistory
        : [],
      version: number(row.version),
      updatedAt: text(row.updatedAt),
    };
  }

  private async shiftReportDetail(
    row: Row,
    inputs?: Record<string, unknown>[],
  ) {
    const reportInputs =
      inputs ??
      (await this.reportInputs([text(row.id)])).get(text(row.id)) ??
      [];
    const outputs = await this.database
      .repository('prdShiftReportOutputs')
      .findMany({
        filter: { reportId: text(row.id) },
        limit: 20,
        sort: (sort) => [sort.field('outputType').asc()],
      });
    const unit = await this.database
      .repository('orgUnits')
      .findOne({ filter: { id: text(row.unitId) } });
    const subject = await this.database
      .repository('orgSubjects')
      .findOne({ filter: { id: text(row.subjectId) } });
    const documentIds = outputs
      .map((output) => text(output.stockDocumentId))
      .filter(Boolean);
    const documents = documentIds.length
      ? await this.database.repository('stockDocuments').findMany({
          filter: (f) => f.or(documentIds.map((id) => f.string('id').eq(id))),
          limit: 20,
        })
      : [];
    const documentStatus = new Map(
      documents.map((document) => [text(document.id), text(document.status)]),
    );
    const materialRows = await this.database
      .repository('prdShiftReportMaterials')
      .findMany({ filter: { reportId: text(row.id) }, limit: 200 });
    const materialSkuIds = [
      ...new Set(materialRows.map((material) => text(material.skuId))),
    ];
    const materialSkus = materialSkuIds.length
      ? await this.database.repository('materialSkus').findMany({
          filter: (f) =>
            f.or(materialSkuIds.map((id) => f.string('id').eq(id))),
          limit: 200,
        })
      : [];
    const materialUnitIds = [
      ...new Set(
        materialSkus.map((sku) => text(sku.baseUnitId)).filter(Boolean),
      ),
    ];
    const materialUnits = materialUnitIds.length
      ? await this.database.repository('measureUnits').findMany({
          filter: (f) =>
            f.or(materialUnitIds.map((id) => f.string('id').eq(id))),
          limit: 200,
        })
      : [];
    const skuName = new Map(
      materialSkus.map((sku) => [text(sku.id), sku] as const),
    );
    const unitName = new Map(
      materialUnits.map(
        (measure) => [text(measure.id), text(measure.name)] as const,
      ),
    );
    return {
      ...this.reportView(row),
      unitName: text(unit?.name),
      subjectName: text(subject?.name),
      inputs: reportInputs,
      materials: materialRows
        .map((material) => {
          const sku = skuName.get(text(material.skuId));
          return {
            id: text(material.id),
            skuId: text(material.skuId),
            skuCode: text(sku?.code),
            skuName: text(sku?.name),
            unit: unitName.get(text(sku?.baseUnitId)) ?? '',
            role: text(material.role),
            quantity: text(material.quantity),
            stockQuantity: text(material.stockQuantity) || null,
            bookQuantity: text(material.bookQuantity) || null,
            stockDocumentId: text(material.stockDocumentId) || null,
            note: text(material.note) || null,
          };
        })
        .sort((left, right) => left.role.localeCompare(right.role)),
      outputs: outputs.map((output) => ({
        id: text(output.id),
        outputType: text(output.outputType),
        skuId: text(output.skuId),
        warehouseId: text(output.warehouseId) || null,
        quantity: text(output.quantity),
        stockDocumentId: text(output.stockDocumentId) || null,
        stockDocumentStatus: output.stockDocumentId
          ? (documentStatus.get(text(output.stockDocumentId)) ?? null)
          : null,
      })),
    };
  }

  async listShiftReports(
    principal: ProductionPrincipal,
    query: ShiftReportQuery,
    scope: ProductionScope,
  ) {
    const company = await this.resolveSubject(principal, undefined, scope);
    if (company) await this.assertUnit(company, query.unitId);
    const rows = await this.database.repository('prdShiftReports').findMany({
      filter: {
        unitId: query.unitId,
        ...(company ? { subjectId: company } : {}),
      },
      limit: 5000,
      sort: (sort) => [
        sort.field('reportDate').desc(),
        sort.field('shift').asc(),
      ],
    });
    const filtered = rows.filter(
      (row) =>
        (!query.reportDate || text(row.reportDate) === query.reportDate) &&
        (!query.status || text(row.status) === query.status),
    );
    const start = (query.page - 1) * query.pageSize;
    const pageRows = filtered.slice(start, start + query.pageSize);
    const inputsByReport = await this.reportInputs(
      pageRows.map((row) => text(row.id)),
    );
    return {
      data: await Promise.all(
        pageRows.map((row) =>
          this.shiftReportDetail(row, inputsByReport.get(text(row.id)) ?? []),
        ),
      ),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total: filtered.length,
      },
    };
  }

  async getShiftReport(
    principal: ProductionPrincipal,
    id: string,
    scope: ProductionScope,
  ) {
    const row = await this.database
      .repository('prdShiftReports')
      .findOne({ filter: { id } });
    if (!row) throw new ProductionError('PRODUCTION_NOT_FOUND');
    await this.resolveSubject(principal, text(row.subjectId), scope);
    return this.shiftReportDetail(row);
  }

  async createShiftReport(
    principal: ProductionPrincipal,
    input: ShiftReportInput,
    scope: ProductionScope,
  ) {
    if (!scope.manage)
      throw new ProductionError('PRODUCTION_FORBIDDEN', 'PERMISSION_DENIED');
    const unit = await this.findUnit(input.unitId);
    const subjectId = await this.resolveSubject(
      principal,
      text(unit.subjectId),
      scope,
      true,
    );
    if (!subjectId)
      throw new ProductionError('PRODUCTION_INVALID', 'SUBJECT_REQUIRED');
    await this.assertUnit(subjectId, input.unitId);
    const existing = await this.database.repository('prdShiftReports').findOne({
      filter: (f) =>
        f.and([
          f.string('unitId').eq(input.unitId),
          f.date('reportDate').on(input.reportDate),
          f.string('shift').eq(input.shift),
        ]),
    });
    if (existing)
      throw new ProductionError('PRODUCTION_CONFLICT', 'REPORT_EXISTS');
    const now = new Date().toISOString();
    const record = await this.database.repository('prdShiftReports').createOne({
      values: {
        id: randomUUID(),
        subjectId,
        unitId: input.unitId,
        reportDate: input.reportDate,
        shift: input.shift,
        status: 'draft',
        processedQuantity: normalizeDecimal(input.processedQuantity),
        metalQuantity: normalizeDecimal(input.metalQuantity),
        sandQuantity: normalizeDecimal(input.sandQuantity),
        tailingsQuantity: normalizeDecimal(input.tailingsQuantity),
        runtimeMinutes: input.runtimeMinutes,
        downtimeMinutes: input.downtimeMinutes,
        notes: input.notes ?? null,
        confirmedBy: null,
        confirmedAt: null,
        version: 1,
        createdBy: principal.id,
        updatedBy: principal.id,
        createdAt: now,
        updatedAt: now,
      } as never,
    });
    return this.shiftReportDetail(record.record);
  }

  async updateShiftReport(
    principal: ProductionPrincipal,
    id: string,
    input: ShiftReportUpdate,
    scope: ProductionScope,
  ) {
    if (!scope.manage)
      throw new ProductionError('PRODUCTION_FORBIDDEN', 'PERMISSION_DENIED');
    const row = await this.database
      .repository('prdShiftReports')
      .findOne({ filter: { id } });
    if (!row) throw new ProductionError('PRODUCTION_NOT_FOUND');
    await this.resolveSubject(principal, text(row.subjectId), scope);
    if (text(row.status) !== 'draft')
      throw new ProductionError('PRODUCTION_INVALID', 'REPORT_NOT_DRAFT');
    if (number(row.version) !== input.version)
      throw new ProductionError('PRODUCTION_CONFLICT');
    const result = await this.database.repository('prdShiftReports').updateOne({
      filter: { id, version: input.version },
      values: {
        processedQuantity: normalizeDecimal(input.processedQuantity),
        metalQuantity: normalizeDecimal(input.metalQuantity),
        sandQuantity: normalizeDecimal(input.sandQuantity),
        tailingsQuantity: normalizeDecimal(input.tailingsQuantity),
        runtimeMinutes: input.runtimeMinutes,
        downtimeMinutes: input.downtimeMinutes,
        notes: input.notes ?? null,
        version: input.version + 1,
        updatedBy: principal.id,
        updatedAt: new Date().toISOString(),
      } as never,
    });
    if (!result.record) throw new ProductionError('PRODUCTION_CONFLICT');
    return this.shiftReportDetail(result.record);
  }

  async shiftReportInputOptions(
    principal: ProductionPrincipal,
    id: string,
    scope: ProductionScope,
  ) {
    const report = await this.database
      .repository('prdShiftReports')
      .findOne({ filter: { id } });
    if (!report) throw new ProductionError('PRODUCTION_NOT_FOUND');
    await this.resolveSubject(principal, text(report.subjectId), scope);
    const [skus, units, documents] = await Promise.all([
      this.database.repository('materialSkus').findMany({
        filter: { status: 'active' },
        limit: 10000,
        sort: (sort) => [sort.field('code').asc()],
      }),
      this.database.repository('measureUnits').findMany({
        limit: 1000,
        sort: (sort) => [sort.field('name').asc()],
      }),
      this.database.repository('stockDocuments').findMany({
        filter: {
          subjectId: text(report.subjectId),
          kind: 'issue',
          status: 'posted',
        },
        limit: 200,
        sort: (sort) => [
          sort.field('occurredOn').desc(),
          sort.field('createdAt').desc(),
        ],
      }),
    ]);
    const documentIds = documents.map((document) => text(document.id));
    const lines = documentIds.length
      ? await this.database.repository('stockDocumentLines').findMany({
          filter: (f) =>
            f.or(
              documentIds.map((documentId) =>
                f.string('documentId').eq(documentId),
              ),
            ),
          limit: 5000,
          sort: (sort) => [sort.field('lineNo').asc()],
        })
      : [];
    const unitById = new Map(
      units.map((unit) => [text(unit.id), unit] as const),
    );
    const skuById = new Map(skus.map((sku) => [text(sku.id), sku] as const));
    const linesByDocument = new Map<string, Record<string, unknown>[]>();
    for (const line of lines) {
      const sku = skuById.get(text(line.skuId));
      const unit = unitById.get(text(line.baseUnitId));
      const view = {
        id: text(line.id),
        skuId: text(line.skuId),
        skuCode: text(sku?.code) || null,
        skuName: text(sku?.name) || null,
        quantity: text(line.baseQuantity) || text(line.quantity),
        unitId: text(line.baseUnitId),
        unit: text(unit?.name) || null,
        issueRequestId: text(line.issueRequestId) || null,
        issueRequestLineId: text(line.issueRequestLineId) || null,
      };
      const list = linesByDocument.get(text(line.documentId)) ?? [];
      list.push(view);
      linesByDocument.set(text(line.documentId), list);
    }
    return {
      materials: skus.map((sku) => ({
        id: text(sku.id),
        code: text(sku.code),
        name: text(sku.name),
        unitId: text(sku.baseUnitId),
        unit: text(unitById.get(text(sku.baseUnitId))?.name) || null,
        managementMode: text(sku.managementMode) || null,
      })),
      issueDocuments: documents.map((document) => ({
        id: text(document.id),
        code: text(document.code),
        occurredOn: text(document.occurredOn),
        warehouseId: text(document.warehouseId),
        issueRequestId: text(document.issueRequestId) || null,
        lines: linesByDocument.get(text(document.id)) ?? [],
      })),
    };
  }

  private async inputUnit(skuId: string) {
    const sku = await this.database
      .repository('materialSkus')
      .findOne({ filter: { id: skuId, status: 'active' } });
    if (!sku)
      throw new ProductionError('PRODUCTION_INVALID', 'INPUT_SKU_NOT_FOUND');
    const unit = await this.database
      .repository('measureUnits')
      .findOne({ filter: { id: text(sku.baseUnitId) } });
    if (!unit)
      throw new ProductionError('PRODUCTION_INVALID', 'INPUT_UNIT_MISSING');
    return { sku, unit };
  }

  async addShiftReportInput(
    principal: ProductionPrincipal,
    id: string,
    input: ShiftReportLineInput,
    scope: ProductionScope,
  ) {
    if (!scope.manage)
      throw new ProductionError('PRODUCTION_FORBIDDEN', 'PERMISSION_DENIED');
    const row = await this.database
      .repository('prdShiftReports')
      .findOne({ filter: { id } });
    if (!row) throw new ProductionError('PRODUCTION_NOT_FOUND');
    await this.resolveSubject(principal, text(row.subjectId), scope);
    if (text(row.status) !== 'draft')
      throw new ProductionError('PRODUCTION_INVALID', 'REPORT_NOT_DRAFT');
    if (number(row.version) !== input.version)
      throw new ProductionError('PRODUCTION_CONFLICT', 'VERSION_CONFLICT');
    const skuId = input.skuId;
    const quantity = normalizeDecimal(input.quantity);
    let unitId = '';
    let unitName = '';
    let issueRequestId: string | null = null;
    let issueRequestLineId: string | null = null;
    let stockDocumentId: string | null = null;
    let stockDocumentLineId: string | null = null;
    if (input.sourceType === 'manual') {
      if (!input.note)
        throw new ProductionError('PRODUCTION_INVALID', 'INPUT_NOTE_REQUIRED');
      const { sku, unit } = await this.inputUnit(skuId);
      unitId = text(unit.id);
      unitName = text(unit.name);
      const precision = number(unit.precision);
      if (
        !Number.isInteger(precision) ||
        precision < 0 ||
        precision > 6 ||
        stockMicros(quantity) % 10n ** BigInt(6 - precision) !== 0n
      )
        throw new ProductionError('PRODUCTION_INVALID', 'INPUT_PRECISION');
      if (text(sku.managementMode) === 'nonStock' && !input.note.trim())
        throw new ProductionError('PRODUCTION_INVALID', 'INPUT_NOTE_REQUIRED');
    } else {
      if (!input.stockDocumentId || !input.stockDocumentLineId)
        throw new ProductionError('PRODUCTION_INVALID', 'ISSUE_LINE_REQUIRED');
      const document = await this.database
        .repository('stockDocuments')
        .findOne({
          filter: {
            id: input.stockDocumentId,
            subjectId: text(row.subjectId),
            kind: 'issue',
          },
        });
      if (!document || text(document.status) !== 'posted')
        throw new ProductionError('PRODUCTION_INVALID', 'ISSUE_NOT_POSTED');
      const line = await this.database
        .repository('stockDocumentLines')
        .findOne({
          filter: {
            id: input.stockDocumentLineId,
            documentId: input.stockDocumentId,
            subjectId: text(row.subjectId),
          },
        });
      if (!line)
        throw new ProductionError('PRODUCTION_INVALID', 'ISSUE_LINE_NOT_FOUND');
      if (text(line.skuId) !== skuId)
        throw new ProductionError('PRODUCTION_INVALID', 'ISSUE_SKU_MISMATCH');
      const documentRequest = text(document.issueRequestId);
      const lineRequest = text(line.issueRequestId);
      if (
        !documentRequest ||
        !lineRequest ||
        documentRequest !== lineRequest ||
        input.issueRequestId !== documentRequest ||
        input.issueRequestLineId !== text(line.issueRequestLineId)
      )
        throw new ProductionError(
          'PRODUCTION_INVALID',
          'ISSUE_SOURCE_MISMATCH',
        );
      if (stockMicros(quantity) > stockMicros(text(line.baseQuantity)))
        throw new ProductionError(
          'PRODUCTION_INVALID',
          'ISSUE_QUANTITY_EXCEEDED',
        );
      const unit = await this.database
        .repository('measureUnits')
        .findOne({ filter: { id: text(line.baseUnitId) } });
      if (!unit)
        throw new ProductionError('PRODUCTION_INVALID', 'INPUT_UNIT_MISSING');
      unitId = text(unit.id);
      unitName = text(unit.name);
      issueRequestId = documentRequest;
      issueRequestLineId = lineRequest;
      stockDocumentId = text(document.id);
      stockDocumentLineId = text(line.id);
    }
    const now = new Date().toISOString();
    const created = await this.database.transaction(async (c) => {
      const claimed = await c.repository('prdShiftReports').updateOne({
        filter: { id, version: input.version, status: 'draft' },
        values: {
          version: input.version + 1,
          updatedBy: principal.id,
          updatedAt: now,
        } as never,
      });
      if (!claimed.record)
        throw new ProductionError('PRODUCTION_CONFLICT', 'VERSION_CONFLICT');
      if (
        await c.repository('prdShiftReportInputs').findOne({
          filter: { reportId: id, stockDocumentLineId },
        })
      )
        throw new ProductionError(
          'PRODUCTION_CONFLICT',
          'INPUT_ALREADY_LINKED',
        );
      await c.repository('prdShiftReportInputs').createOne({
        values: {
          id: randomUUID(),
          subjectId: text(row.subjectId),
          reportId: id,
          skuId,
          quantity,
          unitId,
          unit: unitName.slice(0, 20),
          sourceType: input.sourceType,
          issueRequestId,
          issueRequestLineId,
          stockDocumentId,
          stockDocumentLineId,
          note: input.note ?? '',
          version: 1,
          createdBy: principal.id,
          updatedBy: principal.id,
          createdAt: now,
          updatedAt: now,
        } as never,
      });
      return claimed.record;
    });
    return this.shiftReportDetail(created);
  }

  async updateShiftReportInput(
    principal: ProductionPrincipal,
    id: string,
    inputId: string,
    input: ShiftReportLineUpdate,
    scope: ProductionScope,
  ) {
    if (!scope.manage)
      throw new ProductionError('PRODUCTION_FORBIDDEN', 'PERMISSION_DENIED');
    const row = await this.database
      .repository('prdShiftReports')
      .findOne({ filter: { id } });
    if (!row) throw new ProductionError('PRODUCTION_NOT_FOUND');
    await this.resolveSubject(principal, text(row.subjectId), scope);
    if (text(row.status) !== 'draft')
      throw new ProductionError('PRODUCTION_INVALID', 'REPORT_NOT_DRAFT');
    if (number(row.version) !== input.version)
      throw new ProductionError('PRODUCTION_CONFLICT', 'VERSION_CONFLICT');
    const existing = await this.database
      .repository('prdShiftReportInputs')
      .findOne({ filter: { id: inputId, reportId: id } });
    if (!existing) throw new ProductionError('PRODUCTION_NOT_FOUND');
    if (text(existing.stockDocumentId))
      throw new ProductionError('PRODUCTION_CONFLICT', 'INPUT_LINKED');
    const quantity = normalizeDecimal(input.quantity);
    const unit = await this.database
      .repository('measureUnits')
      .findOne({ filter: { id: text(existing.unitId) } });
    const precision = number(unit?.precision);
    if (
      !Number.isInteger(precision) ||
      precision < 0 ||
      precision > 6 ||
      stockMicros(quantity) % 10n ** BigInt(6 - precision) !== 0n
    )
      throw new ProductionError('PRODUCTION_INVALID', 'INPUT_PRECISION');
    const now = new Date().toISOString();
    const updated = await this.database.transaction(async (c) => {
      const claimed = await c.repository('prdShiftReports').updateOne({
        filter: { id, version: input.version, status: 'draft' },
        values: {
          version: input.version + 1,
          updatedBy: principal.id,
          updatedAt: now,
        } as never,
      });
      if (!claimed.record)
        throw new ProductionError('PRODUCTION_CONFLICT', 'VERSION_CONFLICT');
      const result = await c.repository('prdShiftReportInputs').updateOne({
        filter: {
          id: inputId,
          reportId: id,
          version: number(existing.version),
        },
        values: {
          quantity,
          note: input.note ?? '',
          version: number(existing.version) + 1,
          updatedBy: principal.id,
          updatedAt: now,
        } as never,
      });
      if (!result.record)
        throw new ProductionError('PRODUCTION_CONFLICT', 'VERSION_CONFLICT');
      return claimed.record;
    });
    return this.shiftReportDetail(updated);
  }

  async removeShiftReportInput(
    principal: ProductionPrincipal,
    id: string,
    inputId: string,
    version: number,
    scope: ProductionScope,
  ) {
    if (!scope.manage)
      throw new ProductionError('PRODUCTION_FORBIDDEN', 'PERMISSION_DENIED');
    const row = await this.database
      .repository('prdShiftReports')
      .findOne({ filter: { id } });
    if (!row) throw new ProductionError('PRODUCTION_NOT_FOUND');
    await this.resolveSubject(principal, text(row.subjectId), scope);
    if (text(row.status) !== 'draft')
      throw new ProductionError('PRODUCTION_INVALID', 'REPORT_NOT_DRAFT');
    if (number(row.version) !== version)
      throw new ProductionError('PRODUCTION_CONFLICT', 'VERSION_CONFLICT');
    const existing = await this.database
      .repository('prdShiftReportInputs')
      .findOne({ filter: { id: inputId, reportId: id } });
    if (!existing) throw new ProductionError('PRODUCTION_NOT_FOUND');
    if (text(existing.stockDocumentId))
      throw new ProductionError('PRODUCTION_CONFLICT', 'INPUT_LINKED');
    const now = new Date().toISOString();
    const removed = await this.database.transaction(async (c) => {
      const claimed = await c.repository('prdShiftReports').updateOne({
        filter: { id, version, status: 'draft' },
        values: {
          version: version + 1,
          updatedBy: principal.id,
          updatedAt: now,
        } as never,
      });
      if (!claimed.record)
        throw new ProductionError('PRODUCTION_CONFLICT', 'VERSION_CONFLICT');
      await c
        .repository('prdShiftReportInputs')
        .deleteOne({ filter: { id: inputId, reportId: id } });
      return claimed.record;
    });
    return this.shiftReportDetail(removed);
  }

  async confirmShiftReport(
    principal: ProductionPrincipal,
    id: string,
    version: number,
    scope: ProductionScope,
  ) {
    if (!scope.approve)
      throw new ProductionError('PRODUCTION_FORBIDDEN', 'PERMISSION_DENIED');
    const row = await this.database
      .repository('prdShiftReports')
      .findOne({ filter: { id } });
    if (!row) throw new ProductionError('PRODUCTION_NOT_FOUND');
    await this.resolveSubject(principal, text(row.subjectId), scope);
    if (text(row.status) === 'confirmed') return this.shiftReportDetail(row);
    if (text(row.status) !== 'draft' || number(row.version) !== version)
      throw new ProductionError(
        'PRODUCTION_CONFLICT',
        text(row.status) === 'draft' ? 'VERSION_CONFLICT' : 'REPORT_NOT_DRAFT',
      );
    const configs = await this.unitMaterials(
      this.database,
      text(row.subjectId),
      text(row.unitId),
    );
    const configBySku = new Map(
      configs.map((config) => [config.skuId, config]),
    );
    const materialRows = await this.database
      .repository('prdShiftReportMaterials')
      .findMany({ filter: { reportId: id }, limit: 200 });
    const selected = materialRows
      .filter(
        (material) =>
          (text(material.role) === 'product' ||
            text(material.role) === 'byproduct') &&
          stockMicros(text(material.quantity)) > 0n,
      )
      .map((material) => ({
        outputType: text(material.role) === 'product' ? 'metal' : 'sand',
        quantity: text(material.quantity),
        skuId: text(material.skuId),
        warehouseId: configBySku.get(text(material.skuId))?.defaultWarehouseId,
      }));
    if (!selected.length)
      throw new ProductionError('PRODUCTION_INVALID', 'OUTPUT_REQUIRED');
    for (const output of selected)
      if (!output.warehouseId)
        throw new ProductionError(
          'PRODUCTION_INVALID',
          'OUTPUT_WAREHOUSE_MISSING',
        );
    const inputRows = await this.database
      .repository('prdShiftReportInputs')
      .findMany({ filter: { reportId: id }, limit: 200 });
    for (const line of inputRows) {
      if (stockMicros(text(line.quantity)) <= 0n)
        throw new ProductionError('PRODUCTION_INVALID', 'INPUT_QUANTITY');
      if (!text(line.stockDocumentId)) continue;
      const issue = await this.database
        .repository('stockDocuments')
        .findOne({ filter: { id: text(line.stockDocumentId) } });
      if (!issue || text(issue.status) !== 'posted')
        throw new ProductionError(
          'PRODUCTION_INVALID',
          'INPUT_ISSUE_NOT_POSTED',
        );
    }
    const now = new Date().toISOString();
    const confirmed = await this.database.transaction(async (c) => {
      // Claim the draft revision first; the row lock makes concurrent confirms
      // resolve to a single winner instead of writing duplicate snapshots.
      const claimed = await c.repository('prdShiftReports').updateOne({
        filter: { id, version, status: 'draft' },
        values: {
          status: 'confirmed',
          confirmedBy: principal.id,
          confirmedAt: now,
          version: version + 1,
          updatedBy: principal.id,
          updatedAt: now,
        } as never,
      });
      if (!claimed.record)
        throw new ProductionError('PRODUCTION_CONFLICT', 'VERSION_CONFLICT');
      const existing = await c
        .repository('prdShiftReportOutputs')
        .findMany({ filter: { reportId: id }, limit: 20 });
      if (existing.some((output) => text(output.stockDocumentId)))
        throw new ProductionError('PRODUCTION_CONFLICT', 'INBOUND_EXISTS');
      // A previous failed confirmation may have left unlinked snapshots.
      for (const output of existing)
        await c
          .repository('prdShiftReportOutputs')
          .deleteOne({ filter: { id: text(output.id) } });
      for (const output of selected) {
        await c.repository('prdShiftReportOutputs').createOne({
          values: {
            id: randomUUID(),
            reportId: id,
            subjectId: text(row.subjectId),
            unitId: text(row.unitId),
            outputType: output.outputType,
            skuId: output.skuId,
            warehouseId: output.warehouseId ?? null,
            quantity: normalizeDecimal(output.quantity),
            stockDocumentId: null,
            version: 1,
            createdBy: principal.id,
            updatedBy: principal.id,
            createdAt: now,
            updatedAt: now,
          } as never,
        });
      }
      return claimed.record;
    });
    return this.shiftReportDetail(confirmed);
  }

  async voidShiftReport(
    principal: ProductionPrincipal,
    id: string,
    input: ShiftReportVoid,
    scope: ProductionScope,
  ) {
    if (!scope.approve)
      throw new ProductionError('PRODUCTION_FORBIDDEN', 'PERMISSION_DENIED');
    const row = await this.database
      .repository('prdShiftReports')
      .findOne({ filter: { id } });
    if (!row) throw new ProductionError('PRODUCTION_NOT_FOUND');
    await this.resolveSubject(principal, text(row.subjectId), scope);
    if (text(row.status) !== 'confirmed')
      throw new ProductionError('PRODUCTION_INVALID', 'REPORT_NOT_CONFIRMED');
    if (number(row.version) !== input.version)
      throw new ProductionError('PRODUCTION_CONFLICT', 'VERSION_CONFLICT');
    const outputs = await this.database
      .repository('prdShiftReportOutputs')
      .findMany({ filter: { reportId: id }, limit: 20 });
    const reportInputs = (await this.reportInputs([id])).get(id) ?? [];
    const documentIds = [
      ...new Set(
        outputs.map((output) => text(output.stockDocumentId)).filter(Boolean),
      ),
    ];
    const documents = documentIds.length
      ? await this.database.repository('stockDocuments').findMany({
          filter: (f) =>
            f.or(
              documentIds.map((documentId) => f.string('id').eq(documentId)),
            ),
          limit: 20,
        })
      : [];
    const documentStatus = new Map(
      documents.map((document) => [text(document.id), text(document.status)]),
    );
    if (
      documentIds.some(
        (documentId) => documentStatus.get(documentId) !== 'cancelled',
      )
    )
      throw new ProductionError('PRODUCTION_CONFLICT', 'INBOUND_ACTIVE');
    const now = new Date().toISOString();
    const history = (
      Array.isArray(row.correctionHistory)
        ? row.correctionHistory
        : row.correctionHistory
          ? [row.correctionHistory]
          : []
    ) as Record<string, unknown>[];
    const voided = await this.database.transaction(async (c) => {
      const claimed = await c.repository('prdShiftReports').updateOne({
        filter: { id, version: input.version, status: 'confirmed' },
        values: {
          status: 'void',
          voidedBy: principal.id,
          voidedAt: now,
          voidReason: input.reason,
          version: input.version + 1,
          updatedBy: principal.id,
          updatedAt: now,
          correctionHistory: [
            ...history,
            {
              revision: input.version,
              voidedAt: now,
              voidedBy: principal.id,
              reason: input.reason,
              confirmedBy: text(row.confirmedBy) || null,
              confirmedAt: text(row.confirmedAt) || null,
              values: {
                processedQuantity: text(row.processedQuantity),
                metalQuantity: text(row.metalQuantity),
                sandQuantity: text(row.sandQuantity),
                tailingsQuantity: text(row.tailingsQuantity),
                runtimeMinutes: number(row.runtimeMinutes),
                downtimeMinutes: number(row.downtimeMinutes),
                notes: text(row.notes) || null,
              },
              inputs: reportInputs,
              outputs: outputs.map((output) => ({
                outputType: text(output.outputType),
                skuId: text(output.skuId),
                warehouseId: text(output.warehouseId) || null,
                quantity: text(output.quantity),
                stockDocumentId: text(output.stockDocumentId) || null,
              })),
            },
          ],
        } as never,
      });
      if (!claimed.record)
        throw new ProductionError('PRODUCTION_CONFLICT', 'VERSION_CONFLICT');
      for (const output of outputs)
        await c
          .repository('prdShiftReportOutputs')
          .deleteOne({ filter: { id: text(output.id) } });
      return claimed.record;
    });
    return this.shiftReportDetail(voided);
  }

  async reopenShiftReport(
    principal: ProductionPrincipal,
    id: string,
    version: number,
    scope: ProductionScope,
  ) {
    if (!scope.approve)
      throw new ProductionError('PRODUCTION_FORBIDDEN', 'PERMISSION_DENIED');
    const row = await this.database
      .repository('prdShiftReports')
      .findOne({ filter: { id } });
    if (!row) throw new ProductionError('PRODUCTION_NOT_FOUND');
    await this.resolveSubject(principal, text(row.subjectId), scope);
    if (text(row.status) !== 'void')
      throw new ProductionError('PRODUCTION_INVALID', 'REPORT_NOT_VOID');
    if (number(row.version) !== version)
      throw new ProductionError('PRODUCTION_CONFLICT', 'VERSION_CONFLICT');
    const now = new Date().toISOString();
    const reopened = await this.database.transaction(async (c) => {
      const claimed = await c.repository('prdShiftReports').updateOne({
        filter: { id, version, status: 'void' },
        values: {
          status: 'draft',
          confirmedBy: null,
          confirmedAt: null,
          voidedBy: null,
          voidedAt: null,
          voidReason: null,
          reopenedBy: principal.id,
          reopenedAt: now,
          version: version + 1,
          updatedBy: principal.id,
          updatedAt: now,
        } as never,
      });
      if (!claimed.record)
        throw new ProductionError('PRODUCTION_CONFLICT', 'VERSION_CONFLICT');
      await c
        .repository('prdShiftReportOutputs')
        .deleteMany({ filter: { reportId: id } });
      return claimed.record;
    });
    return this.shiftReportDetail(reopened);
  }

  async inboundDraft(
    principal: ProductionPrincipal,
    id: string,
    scope: ProductionScope,
  ) {
    if (!scope.manage)
      throw new ProductionError('PRODUCTION_FORBIDDEN', 'PERMISSION_DENIED');
    const report = await this.getShiftReport(principal, id, scope);
    if (report.status !== 'confirmed')
      throw new ProductionError('PRODUCTION_INVALID', 'REPORT_NOT_CONFIRMED');
    const configs = await this.unitMaterials(
      this.database,
      report.subjectId,
      report.unitId,
    );
    const configBySku = new Map(configs.map((row) => [row.skuId, row]));
    const materialLines = report.materials.filter(
      (material) =>
        (material.role === 'product' || material.role === 'byproduct') &&
        stockMicros(material.quantity) > 0n,
    );
    const documentIds = [
      ...new Set(
        [
          ...materialLines.map((material) => material.stockDocumentId),
          ...report.outputs.map((output) => output.stockDocumentId),
        ].filter((documentId): documentId is string => Boolean(documentId)),
      ),
    ];
    if (documentIds.length) {
      if (
        documentIds.length !== 1 ||
        materialLines.some((material) => !material.stockDocumentId) ||
        report.outputs.some((output) => !output.stockDocumentId)
      )
        throw new ProductionError('PRODUCTION_CONFLICT', 'INBOUND_EXISTS');
      const existing = await this.database
        .repository('stockDocuments')
        .findOne({ filter: { id: documentIds[0] } });
      if (!existing)
        throw new ProductionError('PRODUCTION_CONFLICT', 'INBOUND_EXISTS');
      if (text(existing.status) === 'cancelled')
        throw new ProductionError(
          'PRODUCTION_CONFLICT',
          'INBOUND_CANCELLED_REOPEN_REQUIRED',
        );
      return { report, lines: [], documentId: text(existing.id) };
    }
    const lines: {
      materialId?: string;
      outputId?: string;
      skuId: string;
      warehouseId: string;
      quantity: string;
      unitId: string;
    }[] = [];
    for (const material of materialLines) {
      const config = configBySku.get(material.skuId);
      const warehouseId = config?.defaultWarehouseId;
      if (!warehouseId)
        throw new ProductionError(
          'PRODUCTION_INVALID',
          'OUTPUT_WAREHOUSE_MISSING',
        );
      const sku = await this.database
        .repository('materialSkus')
        .findOne({ filter: { id: material.skuId } });
      const unitId = text(sku?.baseUnitId);
      if (!sku || !unitId)
        throw new ProductionError('PRODUCTION_INVALID', 'OUTPUT_UNIT_MISSING');
      lines.push({
        materialId: material.id,
        skuId: material.skuId,
        warehouseId,
        quantity: material.quantity,
        unitId,
      });
    }
    for (const output of materialLines.length ? [] : report.outputs) {
      if (!output.warehouseId)
        throw new ProductionError(
          'PRODUCTION_INVALID',
          'OUTPUT_WAREHOUSE_MISSING',
        );
      const sku = await this.database
        .repository('materialSkus')
        .findOne({ filter: { id: output.skuId } });
      const unitId = text(sku?.baseUnitId);
      if (!sku || !unitId)
        throw new ProductionError('PRODUCTION_INVALID', 'OUTPUT_UNIT_MISSING');
      lines.push({
        outputId: output.id,
        skuId: output.skuId,
        warehouseId: output.warehouseId,
        quantity: output.quantity,
        unitId,
      });
    }
    if (!lines.length)
      throw new ProductionError('PRODUCTION_INVALID', 'OUTPUT_REQUIRED');
    const warehouses = new Set(lines.map((line) => line.warehouseId));
    if (warehouses.size !== 1)
      throw new ProductionError(
        'PRODUCTION_INVALID',
        'OUTPUT_WAREHOUSE_MISMATCH',
      );
    return { report, lines, documentId: null };
  }

  async linkInbound(
    principal: ProductionPrincipal,
    reportId: string,
    documentId: string,
    scope: ProductionScope,
  ) {
    if (!scope.manage)
      throw new ProductionError('PRODUCTION_FORBIDDEN', 'PERMISSION_DENIED');
    return this.database.transaction(async (c) => {
      const report = await c
        .repository('prdShiftReports')
        .findOne({ filter: { id: reportId } });
      if (!report) throw new ProductionError('PRODUCTION_NOT_FOUND');
      await this.resolveSubject(principal, text(report.subjectId), scope);
      if (text(report.status) !== 'confirmed')
        throw new ProductionError('PRODUCTION_INVALID', 'REPORT_NOT_CONFIRMED');
      const document = await c
        .repository('stockDocuments')
        .findOne({ filter: { id: documentId } });
      if (
        !document ||
        text(document.kind) !== 'productionReceipt' ||
        text(document.subjectId) !== text(report.subjectId)
      )
        throw new ProductionError('PRODUCTION_CONFLICT', 'INBOUND_EXISTS');
      if (text(document.status) === 'cancelled')
        throw new ProductionError(
          'PRODUCTION_CONFLICT',
          'INBOUND_CANCELLED_REOPEN_REQUIRED',
        );
      const outputs = await c
        .repository('prdShiftReportOutputs')
        .findMany({ filter: { reportId }, limit: 20 });
      const materials = await c
        .repository('prdShiftReportMaterials')
        .findMany({ filter: { reportId }, limit: 200 });
      if (!outputs.length && !materials.length)
        throw new ProductionError('PRODUCTION_INVALID', 'OUTPUT_REQUIRED');
      const now = new Date().toISOString();
      for (const output of outputs) {
        const linked = text(output.stockDocumentId);
        if (linked && linked !== documentId)
          throw new ProductionError('PRODUCTION_CONFLICT', 'INBOUND_EXISTS');
        if (!linked)
          await c.repository('prdShiftReportOutputs').updateOne({
            filter: { id: text(output.id) },
            values: {
              stockDocumentId: documentId,
              updatedBy: principal.id,
              updatedAt: now,
            } as never,
          });
      }
      for (const material of materials) {
        const linked = text(material.stockDocumentId);
        if (linked && linked !== documentId)
          throw new ProductionError('PRODUCTION_CONFLICT', 'INBOUND_EXISTS');
        if (!linked)
          await c.repository('prdShiftReportMaterials').updateOne({
            filter: { id: text(material.id) },
            values: {
              stockDocumentId: documentId,
              updatedBy: principal.id,
              updatedAt: now,
            } as never,
          });
      }
      return documentId;
    });
  }

  async listDowntimeEvents(
    principal: ProductionPrincipal,
    query: { unitId?: string; date?: string; status?: string },
    scope: ProductionScope,
  ) {
    const company = await this.resolveSubject(principal, undefined, scope);
    let unit: Row | null = null;
    if (query.unitId) {
      unit = await this.findUnit(query.unitId);
      if (company && text(unit.subjectId) !== company)
        throw new ProductionError('PRODUCTION_FORBIDDEN');
    }
    const subjectId = unit ? text(unit.subjectId) : (company ?? undefined);
    const filter = {
      ...(subjectId ? { subjectId } : {}),
      ...(unit ? { unitId: text(unit.id) } : {}),
    };
    const rows = await this.database.repository('prdDowntimeEvents').findMany({
      filter: Object.keys(filter).length > 0 ? filter : undefined,
      limit: 2000,
      sort: (sort) => [sort.field('startedAt').desc()],
    });
    const unitRows = rows.length
      ? await this.database.repository('orgUnits').findMany({
          filter: (f) =>
            f.or(
              [...new Set(rows.map((row) => text(row.unitId)))].map((id) =>
                f.string('id').eq(id),
              ),
            ),
          limit: 5000,
        })
      : [];
    const equipmentIds = [
      ...new Set(rows.map((row) => text(row.equipmentId)).filter(Boolean)),
    ];
    const equipmentRows = equipmentIds.length
      ? await this.database.repository('prdEquipment').findMany({
          filter: (f) =>
            f.or(
              equipmentIds.map((equipmentId) => f.string('id').eq(equipmentId)),
            ),
          limit: 5000,
        })
      : [];
    const unitNames = new Map(
      unitRows.map((row) => [text(row.id), text(row.name)] as const),
    );
    const equipmentNames = new Map(
      equipmentRows.map((row) => [text(row.id), text(row.name)] as const),
    );
    const events = rows.filter(
      (row) =>
        (!query.date || this.localDate(row.startedAt) === query.date) &&
        (!query.status || text(row.status) === query.status),
    );
    return {
      events: events.map((row) =>
        this.downtimeView(
          row,
          unitNames.get(text(row.unitId)) ?? '',
          equipmentNames.get(text(row.equipmentId)) ?? '',
        ),
      ),
      summary: {
        open: events.filter((row) => text(row.status) === 'open').length,
        closed: events.filter((row) => text(row.status) === 'closed').length,
        minutes: events.reduce(
          (total, row) => total + number(row.durationMinutes),
          0,
        ),
      },
    };
  }

  async createDowntimeEvent(
    principal: ProductionPrincipal,
    input: DowntimeInput,
    scope: ProductionScope,
  ) {
    if (!scope.manage)
      throw new ProductionError('PRODUCTION_FORBIDDEN', 'PERMISSION_DENIED');
    const unit = await this.findUnit(input.unitId);
    const subjectId = await this.resolveSubject(
      principal,
      text(unit.subjectId),
      scope,
      true,
    );
    if (!subjectId) throw new ProductionError('PRODUCTION_INVALID');
    const row = await this.writeDowntime(
      this.database,
      principal,
      subjectId,
      input.unitId,
      input,
    );
    return this.downtimeView(row, text(unit.name), '');
  }

  async closeDowntimeEvent(
    principal: ProductionPrincipal,
    id: string,
    input: DowntimeClose,
    scope: ProductionScope,
  ) {
    if (!scope.manage)
      throw new ProductionError('PRODUCTION_FORBIDDEN', 'PERMISSION_DENIED');
    const row = await this.database
      .repository('prdDowntimeEvents')
      .findOne({ filter: { id } });
    if (!row)
      throw new ProductionError('PRODUCTION_NOT_FOUND', 'DOWNTIME_NOT_FOUND');
    await this.resolveSubject(principal, text(row.subjectId), scope);
    if (text(row.status) !== 'open')
      throw new ProductionError('PRODUCTION_CONFLICT', 'DOWNTIME_NOT_OPEN');
    if (number(row.version) !== input.version)
      throw new ProductionError('PRODUCTION_CONFLICT', 'VERSION_CONFLICT');
    const endedAt = this.parseInstant(input.endedAt, 'ENDED_AT_INVALID');
    if (new Date(endedAt) <= new Date(text(row.startedAt)))
      throw new ProductionError('PRODUCTION_INVALID', 'END_BEFORE_START');
    const durationMinutes = Math.max(
      1,
      Math.round(
        (new Date(endedAt).getTime() -
          new Date(text(row.startedAt)).getTime()) /
          60000,
      ),
    );
    const now = new Date().toISOString();
    await this.database.repository('prdDowntimeEvents').updateMany({
      filter: { id },
      values: {
        status: 'closed',
        endedAt,
        durationMinutes,
        resolution: input.resolution,
        closedBy: principal.id,
        version: input.version + 1,
        updatedBy: principal.id,
        updatedAt: now,
      } as never,
    });
    const updated = (await this.database
      .repository('prdDowntimeEvents')
      .findOne({ filter: { id } }))!;
    return this.downtimeView(updated, '', '');
  }

  async cancelDowntimeEvent(
    principal: ProductionPrincipal,
    id: string,
    input: DowntimeCancel,
    scope: ProductionScope,
  ) {
    if (!scope.manage)
      throw new ProductionError('PRODUCTION_FORBIDDEN', 'PERMISSION_DENIED');
    const row = await this.database
      .repository('prdDowntimeEvents')
      .findOne({ filter: { id } });
    if (!row)
      throw new ProductionError('PRODUCTION_NOT_FOUND', 'DOWNTIME_NOT_FOUND');
    await this.resolveSubject(principal, text(row.subjectId), scope);
    if (text(row.status) !== 'open')
      throw new ProductionError('PRODUCTION_CONFLICT', 'DOWNTIME_NOT_OPEN');
    if (number(row.version) !== input.version)
      throw new ProductionError('PRODUCTION_CONFLICT', 'VERSION_CONFLICT');
    const now = new Date().toISOString();
    await this.database.repository('prdDowntimeEvents').updateMany({
      filter: { id },
      values: {
        status: 'cancelled',
        resolution: input.reason,
        closedBy: principal.id,
        version: input.version + 1,
        updatedBy: principal.id,
        updatedAt: now,
      } as never,
    });
    const updated = (await this.database
      .repository('prdDowntimeEvents')
      .findOne({ filter: { id } }))!;
    return this.downtimeView(updated, '', '');
  }

  private localDate(value: unknown) {
    const instant = new Date(text(value));
    if (Number.isNaN(instant.getTime())) return '';
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: this.timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(instant);
  }

  private parseInstant(value: string, code: string) {
    const instant = new Date(value);
    if (Number.isNaN(instant.getTime()))
      throw new ProductionError('PRODUCTION_INVALID', code);
    return instant.toISOString();
  }

  private downtimeView(row: Row, unitName: string, equipmentName: string) {
    return {
      id: text(row.id),
      eventNo: text(row.eventNo),
      subjectId: text(row.subjectId),
      unitId: text(row.unitId),
      unitName,
      equipmentId: text(row.equipmentId) || null,
      equipmentName,
      startedAt: text(row.startedAt),
      endedAt: text(row.endedAt) || null,
      durationMinutes: number(row.durationMinutes),
      category: text(row.category),
      impact: text(row.impact),
      status: text(row.status),
      description: text(row.description),
      resolution: text(row.resolution) || null,
      reportedBy: text(row.reportedBy),
      closedBy: text(row.closedBy) || null,
      version: number(row.version),
    };
  }

  private overtimeView(
    row: Row,
    names: {
      units: Map<string, string>;
      people: Map<string, string>;
      positions: Map<string, string>;
    },
  ) {
    return {
      id: text(row.id),
      requestNo: text(row.requestNo),
      subjectId: text(row.subjectId),
      unitId: text(row.unitId),
      unitName: names.units.get(text(row.unitId)) ?? '',
      personId: text(row.personId),
      personName: names.people.get(text(row.personId)) ?? '',
      positionId: text(row.positionId),
      positionName: names.positions.get(text(row.positionId)) ?? '',
      businessDate: text(row.businessDate),
      hours: text(row.hours),
      type: text(row.type),
      reason: text(row.reason),
      compensation: text(row.compensation),
      status: text(row.status),
      approverId: row.approverId ? text(row.approverId) : null,
      approverName: row.approverName ? text(row.approverName) : null,
      decidedAt: row.decidedAt ? text(row.decidedAt) : null,
      rejectReason: row.rejectReason ? text(row.rejectReason) : null,
      version: Number(row.version),
    };
  }

  private async overtimeNames() {
    const [units, people, positions] = await Promise.all([
      this.database.repository('orgUnits').findMany({ limit: 10000 }),
      this.database
        .repository('personnelEmployees')
        .findMany({ limit: 100000 }),
      this.database.repository('orgPositions').findMany({ limit: 10000 }),
    ]);
    return {
      units: new Map(
        units.map((row) => [text(row.id), text(row.name)] as const),
      ),
      people: new Map(
        people.map((row) => [text(row.id), text(row.name)] as const),
      ),
      positions: new Map(
        positions.map((row) => [text(row.id), text(row.name)] as const),
      ),
    };
  }

  async overtimeCandidates(
    principal: ProductionPrincipal,
    input: { unitId: string; businessDate: string },
    scope: ProductionScope,
  ) {
    const unit = await this.findUnit(input.unitId);
    const subjectId = text(unit.subjectId);
    await this.resolveSubject(principal, subjectId, scope);
    const people = await this.productionPeople(
      this.database,
      input.unitId,
      subjectId,
      input.businessDate,
    );
    return { people };
  }

  async listOvertime(
    principal: ProductionPrincipal,
    query: { unitId?: string; businessDate?: string; status?: string },
    scope: ProductionScope,
  ) {
    const company = await this.resolveSubject(principal, undefined, scope);
    let unit: Row | null = null;
    if (query.unitId) {
      unit = await this.findUnit(query.unitId);
      if (company && text(unit.subjectId) !== company)
        throw new ProductionError('PRODUCTION_FORBIDDEN');
    }
    const subjectId = unit ? text(unit.subjectId) : (company ?? undefined);
    const baseFilter: Record<string, unknown> = {
      ...(subjectId ? { subjectId } : {}),
      ...(unit ? { unitId: text(unit.id) } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const filter = query.businessDate
      ? (f: {
          and: (conditions: unknown[]) => unknown;
          string: (field: string) => { eq: (value: string) => unknown };
          date: (field: string) => { on: (value: string) => unknown };
        }) => {
          const conditions = [];
          if (subjectId) conditions.push(f.string('subjectId').eq(subjectId));
          if (unit) conditions.push(f.string('unitId').eq(text(unit.id)));
          if (query.status)
            conditions.push(f.string('status').eq(query.status));
          conditions.push(
            f.date('businessDate').on(query.businessDate as string),
          );
          return f.and(conditions);
        }
      : Object.keys(baseFilter).length > 0
        ? baseFilter
        : undefined;
    const rows = await this.database
      .repository('prdOvertimeRequests')
      .findMany({
        filter: filter as never,
        limit: 5000,
        sort: (sort) => [
          sort.field('businessDate').desc(),
          sort.field('createdAt').desc(),
        ],
      });
    const names = await this.overtimeNames();
    return { records: rows.map((row) => this.overtimeView(row, names)) };
  }

  async createOvertime(
    principal: ProductionPrincipal,
    input: OvertimeInput,
    scope: ProductionScope,
  ) {
    if (!scope.manage)
      throw new ProductionError('PRODUCTION_FORBIDDEN', 'PERMISSION_DENIED');
    const unit = await this.findUnit(input.unitId);
    const subjectId = await this.resolveSubject(
      principal,
      text(unit.subjectId),
      scope,
      true,
    );
    if (!subjectId) throw new ProductionError('PRODUCTION_INVALID');
    const row = await this.writeOvertime(
      this.database,
      principal,
      subjectId,
      input.unitId,
      input.businessDate,
      input,
    );
    const names = await this.overtimeNames();
    return this.overtimeView(row, names);
  }

  async decideOvertime(
    principal: ProductionPrincipal,
    id: string,
    input: OvertimeDecision,
    scope: ProductionScope,
  ) {
    if (!scope.approve)
      throw new ProductionError('PRODUCTION_FORBIDDEN', 'PERMISSION_DENIED');
    const row = await this.database
      .repository('prdOvertimeRequests')
      .findOne({ filter: { id } });
    if (!row) throw new ProductionError('PRODUCTION_NOT_FOUND');
    await this.resolveSubject(principal, text(row.subjectId), scope, true);
    if (text(row.status) !== 'submitted')
      throw new ProductionError('PRODUCTION_CONFLICT', 'OVERTIME_NOT_PENDING');
    if (Number(row.version) !== input.version)
      throw new ProductionError('PRODUCTION_CONFLICT');
    if (input.decision === 'reject' && !input.reason)
      throw new ProductionError('PRODUCTION_INVALID', 'REJECT_REASON_REQUIRED');
    const now = new Date().toISOString();
    const result = await this.database
      .repository('prdOvertimeRequests')
      .updateOne({
        filter: { id, version: input.version },
        values: {
          status: input.decision === 'approve' ? 'approved' : 'rejected',
          approverId: principal.id,
          approverName: null,
          decidedAt: now,
          rejectReason:
            input.decision === 'reject' ? (input.reason ?? null) : null,
          version: input.version + 1,
          updatedBy: principal.id,
          updatedAt: now,
        } as never,
      });
    if (!result.record) throw new ProductionError('PRODUCTION_CONFLICT');
    const names = await this.overtimeNames();
    return this.overtimeView(result.record, names);
  }
}
