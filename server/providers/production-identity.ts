import type {
  DatabaseManager,
  FilterBuilder,
  RepositoryRecord,
} from '@nocobase/db';
import { businessDate } from './business-date.js';
import { isSuperAdmin } from './super-admin.js';

type Row = RepositoryRecord;

export interface ProductionIdentityUnit {
  id: string;
  code: string;
  name: string;
  positionId: string;
  positionCode: string;
  positionName: string;
  primary: boolean;
  subjectId?: string;
  subjectName?: string;
}

export type ProductionIdentityReason =
  'NO_EMPLOYEE' | 'NO_EMPLOYMENT' | 'NO_PRODUCTION_POSITION' | null;

/**
 * The caller's production identity. It is derived from HR records only — an
 * account, its employments and its assignments — so a form never asks the user
 * which company they belong to or who they are.
 */
export interface ProductionIdentity {
  employee: { id: string; code: string; name: string } | null;
  company: { id: string; code: string; name: string } | null;
  position: { id: string; code: string; name: string } | null;
  /** Production units the caller may report for, primary assignment first. */
  units: ProductionIdentityUnit[];
  /** Civil business date in the production timezone. */
  today: string;
  defaultUnitId: string | null;
  reason: ProductionIdentityReason;
  /** Root accounts administer every company but are not staff themselves. */
  superAdmin: boolean;
}

export interface IdentityPrincipal {
  type?: string;
  id: string;
}

const text = (value: unknown) => (typeof value === 'string' ? value : '');
const idFilter = (f: FilterBuilder, ids: string[]) =>
  ids.length === 1
    ? f.string('id').eq(ids[0])
    : f.or(ids.map((id) => f.string('id').eq(id)));

function effective(row: Row, today: string): boolean {
  const data = (row.data ?? {}) as { startDate?: unknown; endDate?: unknown };
  const startDate = text(data.startDate);
  const endDate = text(data.endDate);
  return !!startDate && startDate <= today && (!endDate || endDate > today);
}

const empty = (today: string, reason: ProductionIdentityReason) => ({
  employee: null,
  company: null,
  position: null,
  units: [],
  today,
  defaultUnitId: null,
  reason,
  superAdmin: false,
});

/**
 * Resolve the caller's production identity without granting anything: callers
 * still need the production permission before they can read or write.
 *
 * Only positions tagged `productionRole = 'production'` open a production
 * unit, which keeps supporting positions out of the shift roster.
 */
export async function resolveProductionIdentity(
  database: DatabaseManager,
  timeZone: string,
  principal: IdentityPrincipal,
): Promise<ProductionIdentity> {
  const today = businessDate(timeZone);
  if (principal.type && principal.type !== 'user')
    return empty(today, 'NO_EMPLOYEE');

  const person = await database.repository('personnelEmployees').findOne({
    filter: { accountId: principal.id, status: 'active' },
  });
  if (!person) {
    if (await isSuperAdmin(database, principal))
      return superAdminIdentity(database, today);
    return empty(today, 'NO_EMPLOYEE');
  }
  const personId = text(person.id);
  const employee = {
    id: personId,
    code: text(person.code),
    name: text(person.name),
  };

  const employments = await database
    .repository('personnelEmployments')
    .findMany({
      filter: { personId, status: 'active' },
      limit: 1001,
    });
  const activeEmployments = employments.filter((row) => effective(row, today));
  if (!activeEmployments.length)
    return { ...empty(today, 'NO_EMPLOYMENT'), employee };

  // The employee record names the home company; a second active employment is
  // only a fallback so a transferred employee keeps working during handover.
  const home = text(person.subjectId);
  const companyId =
    (activeEmployments.some((row) => text(row.subjectId) === home) && home) ||
    text(activeEmployments[0].subjectId);
  if (!companyId) return { ...empty(today, 'NO_EMPLOYMENT'), employee };

  const [company, assignments] = await Promise.all([
    database.repository('orgSubjects').findOne({
      filter: (f) =>
        f.and([f.string('id').eq(companyId), f.string('status').eq('active')]),
    }),
    database.repository('personnelAssignments').findMany({
      filter: { personId, status: 'active' },
      limit: 1001,
    }),
  ]);
  if (!company) return { ...empty(today, 'NO_EMPLOYMENT'), employee };

  const activeAssignments = assignments.filter(
    (row) => effective(row, today) && text(row.subjectId) === companyId,
  );
  const positionIds = [
    ...new Set(activeAssignments.map((row) => text(row.positionId))),
  ].filter(Boolean);
  if (!positionIds.length)
    return { ...empty(today, 'NO_PRODUCTION_POSITION'), employee };

  const positions = await database.repository('orgPositions').findMany({
    filter: (f) =>
      f.and([f.string('status').eq('active'), idFilter(f, positionIds)]),
    limit: 1001,
  });
  const positionMap = new Map(positions.map((row) => [text(row.id), row]));

  const primaryAssignment =
    activeAssignments.find(
      (row) => text((row.data as { type?: unknown })?.type) === 'primary',
    ) ?? activeAssignments[0];
  const primaryPosition = positionMap.get(text(primaryAssignment.positionId));

  const productionPositions = positions.filter(
    (row) => text(row.productionRole) === 'production',
  );
  if (!productionPositions.length)
    return {
      ...empty(today, 'NO_PRODUCTION_POSITION'),
      employee,
      company: {
        id: companyId,
        code: text(company.code),
        name: text(company.name),
      },
      position: primaryPosition
        ? {
            id: text(primaryPosition.id),
            code: text(primaryPosition.code),
            name: text(primaryPosition.name),
          }
        : null,
    };

  const unitIds = [
    ...new Set(productionPositions.map((row) => text(row.unitId))),
  ].filter(Boolean);
  const unitRows = unitIds.length
    ? await database.repository('orgUnits').findMany({
        filter: (f) =>
          f.and([
            f.string('status').eq('active'),
            f.string('subjectId').eq(companyId),
            idFilter(f, unitIds),
          ]),
        limit: 1001,
      })
    : [];
  const unitMap = new Map(unitRows.map((row) => [text(row.id), row]));

  const units: ProductionIdentityUnit[] = [];
  const seen = new Set<string>();
  for (const position of productionPositions) {
    const unitId = text(position.unitId);
    const unit = unitMap.get(unitId);
    if (!unit || seen.has(unitId)) continue;
    seen.add(unitId);
    const assignment = activeAssignments.find(
      (row) => text(row.positionId) === text(position.id),
    );
    units.push({
      id: unitId,
      code: text(unit.code),
      name: text(unit.name),
      positionId: text(position.id),
      positionCode: text(position.code),
      positionName: text(position.name),
      primary:
        text((assignment?.data as { type?: unknown })?.type) === 'primary',
    });
  }
  units.sort(
    (a, b) =>
      Number(b.primary) - Number(a.primary) ||
      a.code.localeCompare(b.code) ||
      a.id.localeCompare(b.id),
  );

  return {
    employee,
    company: {
      id: companyId,
      code: text(company.code),
      name: text(company.name),
    },
    position: primaryPosition
      ? {
          id: text(primaryPosition.id),
          code: text(primaryPosition.code),
          name: text(primaryPosition.name),
        }
      : null,
    units,
    today,
    defaultUnitId: units[0]?.id ?? null,
    reason: units.length ? null : 'NO_PRODUCTION_POSITION',
    superAdmin: false,
  };
}

/**
 * Root accounts see every production unit so they can inspect or support any
 * company, with no employee card attached.
 */
async function superAdminIdentity(
  database: DatabaseManager,
  today: string,
): Promise<ProductionIdentity> {
  const positions = await database.repository('orgPositions').findMany({
    filter: { status: 'active', productionRole: 'production' },
    limit: 10001,
  });
  const unitIds = [...new Set(positions.map((row) => text(row.unitId)))].filter(
    Boolean,
  );
  if (!unitIds.length)
    return { ...empty(today, 'NO_PRODUCTION_POSITION'), superAdmin: true };
  const units = await database.repository('orgUnits').findMany({
    filter: (f) =>
      f.and([f.string('status').eq('active'), idFilter(f, unitIds)]),
    limit: 10001,
  });
  const companyIds = [...new Set(units.map((row) => text(row.subjectId)))];
  const companies = companyIds.length
    ? await database.repository('orgSubjects').findMany({
        filter: (f) =>
          f.and([f.string('status').eq('active'), idFilter(f, companyIds)]),
        limit: 1001,
      })
    : [];
  const companyMap = new Map(companies.map((row) => [text(row.id), row]));
  const positionByUnit = new Map<string, Row>();
  for (const position of positions) {
    const unitId = text(position.unitId);
    if (!positionByUnit.has(unitId)) positionByUnit.set(unitId, position);
  }
  const result: ProductionIdentityUnit[] = [];
  for (const unit of units) {
    const unitId = text(unit.id);
    const position = positionByUnit.get(unitId);
    const company = companyMap.get(text(unit.subjectId));
    result.push({
      id: unitId,
      code: text(unit.code),
      name: text(unit.name),
      positionId: position ? text(position.id) : '',
      positionCode: position ? text(position.code) : '',
      positionName: position ? text(position.name) : '',
      primary: false,
      subjectId: text(unit.subjectId),
      subjectName: text(company?.name),
    });
  }
  result.sort(
    (a, b) =>
      (a.subjectName ?? '').localeCompare(b.subjectName ?? '') ||
      a.code.localeCompare(b.code),
  );
  return {
    employee: null,
    company: null,
    position: null,
    units: result,
    today,
    defaultUnitId: result[0]?.id ?? null,
    reason: result.length ? null : 'NO_PRODUCTION_POSITION',
    superAdmin: true,
  };
}
