import { ApiError } from '@nocobase/app-server/router';
import type {
  DatabaseConnection,
  DatabaseManager,
  FilterBuilder,
} from '@nocobase/db';
import { businessDate } from './business-date.js';
import { materialIdFilter } from './material-filters.js';

export interface PurchaseIdentityUnit {
  id: string;
  code: string;
  name: string;
  positionId: string;
  positionCode: string;
  positionName: string;
  primary: boolean;
}

export interface PurchaseIdentityCompany {
  id: string;
  code: string;
  name: string;
  primary: boolean;
  units: PurchaseIdentityUnit[];
}

export interface PurchaseIdentity {
  employee: { id: string; code: string; name: string } | null;
  companies: PurchaseIdentityCompany[];
  default: {
    employeeId: string;
    subjectId: string;
    unitId: string | null;
  } | null;
}

export interface IdentityPrincipal {
  type?: string;
  id: string;
}

const text = (value: unknown) => (typeof value === 'string' ? value : '');
const empty = (): PurchaseIdentity => ({
  employee: null,
  companies: [],
  default: null,
});
const tooBroad = (): never => {
  throw new ApiError({
    status: 'FAILED_PRECONDITION',
    domain: 'procurement',
    reason: 'PURCHASE_REFERENCE_TOO_BROAD',
    message: 'The employee record has too many active references.',
  });
};

function effective(row: Record<string, unknown>, today: string): boolean {
  const data = (row.data ?? {}) as {
    startDate?: unknown;
    endDate?: unknown;
  };
  const startDate = text(data.startDate),
    endDate = text(data.endDate);
  return !!startDate && startDate <= today && (!endDate || endDate > today);
}

/**
 * The caller's purchase identity, derived only from active employments and
 * assignments. It is the source for form defaults and self-service checks.
 */
export async function resolvePurchaseIdentity(
  c: DatabaseConnection,
  timeZone: string,
  principal: IdentityPrincipal,
): Promise<PurchaseIdentity> {
  if (principal.type && principal.type !== 'user') return empty();
  const person = await c
    .repository('personnelEmployees')
    .findOne({ filter: { accountId: principal.id, status: 'active' } });
  if (!person) return empty();
  const personId = text(person.id);
  const employee = {
    id: personId,
    code: text(person.code),
    name: text(person.name),
  };
  const employments = await c.repository('personnelEmployments').findMany({
    filter: { personId, status: 'active' },
    limit: 10001,
  });
  if (employments.length > 10000) tooBroad();
  const today = businessDate(timeZone),
    activeEmployments = employments.filter((row) =>
      effective(row as Record<string, unknown>, today),
    ),
    companyIds = [
      ...new Set(activeEmployments.map((row) => text(row.subjectId))),
    ].filter(Boolean);
  if (!companyIds.length) return { employee, companies: [], default: null };

  const assignments = await c.repository('personnelAssignments').findMany({
    filter: { personId, status: 'active' },
    limit: 10001,
  });
  if (assignments.length > 10000) tooBroad();
  const activeAssignments = assignments.filter(
    (row) =>
      effective(row as Record<string, unknown>, today) &&
      companyIds.includes(text(row.subjectId)),
  );
  const positionIds = [
      ...new Set(activeAssignments.map((row) => text(row.positionId))),
    ].filter(Boolean),
    positions = positionIds.length
      ? await c.repository('orgPositions').findMany({
          filter: (f: FilterBuilder) =>
            f.and([
              f.string('status').eq('active'),
              materialIdFilter(f, 'id', positionIds),
            ]),
          limit: 10001,
        })
      : [];
  if (positions.length > 10000) tooBroad();
  const positionMap = new Map(positions.map((row) => [text(row.id), row])),
    unitIds = [...new Set(positions.map((row) => text(row.unitId)))].filter(
      Boolean,
    ),
    units = unitIds.length
      ? await c.repository('orgUnits').findMany({
          filter: (f: FilterBuilder) =>
            f.and([
              f.string('status').eq('active'),
              materialIdFilter(f, 'id', unitIds),
            ]),
          limit: 10001,
        })
      : [];
  if (units.length > 10000) tooBroad();
  const unitMap = new Map(units.map((row) => [text(row.id), row])),
    companies = await c.repository('orgSubjects').findMany({
      filter: (f: FilterBuilder) =>
        f.and([
          f.string('status').eq('active'),
          materialIdFilter(f, 'id', companyIds),
        ]),
      limit: 10001,
    });
  if (companies.length > 10000) tooBroad();
  const companyMap = new Map(
    companies.map((row) => [
      text(row.id),
      { code: text(row.code), name: text(row.name) },
    ]),
  );

  const grouped = new Map<
    string,
    Omit<PurchaseIdentityCompany, 'code' | 'name'> & { order: number }
  >();
  for (const [index, id] of companyIds.entries())
    if (companyMap.has(id))
      grouped.set(id, {
        id,
        primary: false,
        units: [],
        order: index,
      });
  const seenUnits = new Set<string>();
  for (const assignment of activeAssignments) {
    const company = grouped.get(text(assignment.subjectId));
    if (!company) continue;
    const position = positionMap.get(text(assignment.positionId)),
      unit = position && unitMap.get(text(position.unitId));
    if (!position || !unit || text(unit.subjectId) !== company.id) continue;
    const unitId = text(unit.id),
      key = `${company.id}:${unitId}`;
    if (seenUnits.has(key)) continue;
    seenUnits.add(key);
    const data = (assignment.data ?? {}) as { type?: unknown },
      primary = text(data.type) === 'primary';
    if (primary) company.primary = true;
    company.units.push({
      id: unitId,
      code: text(unit.code),
      name: text(unit.name),
      positionId: text(position.id),
      positionCode: text(position.code),
      positionName: text(position.name),
      primary,
    });
  }

  const result = [...grouped.values()]
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .map((company) => {
      const meta = companyMap.get(company.id)!;
      company.units.sort(
        (a, b) =>
          Number(b.primary) - Number(a.primary) ||
          a.code.localeCompare(b.code) ||
          a.id.localeCompare(b.id),
      );
      return {
        id: company.id,
        code: meta.code,
        name: meta.name,
        primary: company.primary,
        units: company.units,
      };
    });
  const defaultCompany =
    result.find((company) => company.primary) ?? result[0] ?? null;
  const defaultUnit =
    defaultCompany?.units.find((unit) => unit.primary) ??
    defaultCompany?.units[0] ??
    null;
  return {
    employee,
    companies: result,
    default: defaultCompany
      ? {
          employeeId: employee.id,
          subjectId: defaultCompany.id,
          unitId: defaultUnit?.id ?? null,
        }
      : null,
  };
}

/**
 * Every active company the caller can act for through an effective employment.
 * Authorization scopes use this lighter path; the form also needs departments.
 */
export async function currentCompaniesForUser(
  database: DatabaseManager,
  timeZone: string,
  principal: IdentityPrincipal,
): Promise<string[]> {
  if (principal.type && principal.type !== 'user') return [];
  const c = database.connection(),
    person = await c
      .repository('personnelEmployees')
      .findOne({ filter: { accountId: principal.id, status: 'active' } });
  if (!person) return [];
  const employments = await c.repository('personnelEmployments').findMany({
    filter: { personId: text(person.id), status: 'active' },
    limit: 10001,
  });
  if (employments.length > 10000) tooBroad();
  const today = businessDate(timeZone);
  return [
    ...new Set(
      employments
        .filter((row) => effective(row as Record<string, unknown>, today))
        .map((row) => text(row.subjectId))
        .filter(Boolean),
    ),
  ];
}
