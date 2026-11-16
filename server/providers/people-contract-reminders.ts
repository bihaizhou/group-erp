import { randomUUID } from 'node:crypto';
import type { DatabaseManager } from '@nocobase/db';
import type { InAppStore } from '@nocobase/app-plugin-notification-in-app/server';
import { businessDate } from './business-date.js';

/** How many days before the contract end the reminder is delivered. */
export const CONTRACT_REMINDER_DAYS = 30;

const text = (value: unknown) => (typeof value === 'string' ? value : '');

const addDays = (date: string, days: number) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

/**
 * Daily in-app reminder for labour contracts nearing their end date.
 *
 * Delivers one in-app item per employment and contract end date to the
 * employee's own account, and a copy to the supervisor found through the
 * employee's current primary position (`orgPositions.reportsToId`), so the
 * responsible manager is reminded as well. Employees without an account (or
 * without an employment in effect today) are skipped; the personnel overview
 * keeps listing every expiring contract for HR.
 */
export class ContractReminders {
  private lastRun = '';

  constructor(
    private readonly database: DatabaseManager,
    private readonly store: InAppStore,
    private readonly timeZone: string,
  ) {}

  async run(now: Date = new Date()) {
    const today = businessDate(this.timeZone, now);
    if (this.lastRun === today) return { delivered: 0, skipped: true };
    const horizon = addDays(today, CONTRACT_REMINDER_DAYS);
    const rows = await this.database
      .repository('personnelEmployments')
      .findMany({
        limit: 5001,
      });
    const due = rows
      .map((row) => ({
        id: text(row.id),
        employeeId: text(row.employeeId),
        name: text(row.name),
        data: (row.data ?? {}) as Record<string, unknown>,
        subjectId: text(row.subjectId),
      }))
      .filter((row) => {
        const contractEnd = text(row.data.contractEnd);
        if (!contractEnd || contractEnd < today || contractEnd > horizon)
          return false;
        const startDate = text(row.data.startDate);
        if (startDate && startDate > today) return false;
        const endDate = text(row.data.endDate);
        return !endDate || endDate >= today;
      });
    this.lastRun = today;
    if (!due.length) return { delivered: 0, skipped: false };
    const employeeIds = [...new Set(due.map((row) => row.employeeId))];
    const employees = await this.database
      .repository('personnelEmployees')
      .findMany({ filter: { id: { $in: employeeIds } }, limit: 5001 });
    const accounts = new Map(
      employees.map((row) => [
        text(row.id),
        text((row.data as Record<string, unknown> | undefined)?.accountId),
      ]),
    );
    const supervisors = await this.supervisorAccounts(employeeIds, today);
    const send = async (
      deliveryId: string,
      accountId: string,
      body: string,
    ) => {
      try {
        await this.store.deliver({
          deliveryId,
          notificationId: randomUUID(),
          userId: accountId,
          createdAt: new Date().toISOString(),
          message: {
            to: accountId,
            title: '劳动合同即将到期 · Labour contract expiring',
            body,
          },
        });
        return true;
      } catch {
        // A duplicate delivery for the same contract and end date is expected
        // when the sweep runs again; nothing else is worth failing the job.
        return false;
      }
    };
    let delivered = 0;
    for (const row of due) {
      const contractEnd = text(row.data.contractEnd);
      const accountId = accounts.get(row.employeeId);
      if (accountId) {
        const copy = `${row.name} 的劳动合同将于 ${contractEnd} 到期。 / The labour contract of ${row.name} ends on ${contractEnd}.`;
        if (
          await send(
            `contract-expiry:${row.id}:${contractEnd}`,
            accountId,
            copy,
          )
        )
          delivered += 1;
      }
      for (const managerId of supervisors.get(row.employeeId) ?? []) {
        if (managerId === accountId) continue;
        const copy = `${row.name} 的劳动合同将于 ${contractEnd} 到期，请安排续签或离职流程。 / The labour contract of ${row.name} ends on ${contractEnd}; plan the renewal or exit.`;
        if (
          await send(
            `contract-expiry:${row.id}:${contractEnd}:manager`,
            managerId,
            copy,
          )
        )
          delivered += 1;
      }
    }
    return { delivered, skipped: false };
  }

  /**
   * Resolve the account ids of current supervisors for the given employees via
   * `orgPositions.reportsToId`. Any failure degrades to "no supervisor" so a
   * malformed org tree never blocks the employee reminder.
   */
  private async supervisorAccounts(
    employeeIds: string[],
    today: string,
  ): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();
    try {
      const assignments = await this.database
        .repository('personnelAssignments')
        .findMany({
          filter: { personId: { $in: employeeIds } },
          limit: 5001,
        });
      const primary = new Map<string, string>();
      for (const row of assignments) {
        const data = (row.data ?? {}) as Record<string, unknown>;
        if (text(data.type) !== 'primary') continue;
        const startDate = text(data.startDate);
        const endDate = text(data.endDate);
        if (startDate && startDate > today) continue;
        if (endDate && endDate <= today) continue;
        const personId = text(row.personId);
        if (personId && !primary.has(personId))
          primary.set(personId, text(row.positionId));
      }
      const positionIds = [...new Set([...primary.values()].filter(Boolean))];
      if (!positionIds.length) return result;
      const positions = await this.database
        .repository('orgPositions')
        .findMany({ filter: { id: { $in: positionIds } }, limit: 5001 });
      const reportTo = new Map(
        positions.map((row) => [text(row.id), text(row.reportsToId)]),
      );
      const supervisorPositionIds = [
        ...new Set(
          positionIds
            .map((id) => reportTo.get(id) ?? '')
            .filter((value) => value !== ''),
        ),
      ];
      if (!supervisorPositionIds.length) return result;
      const reports = await this.database
        .repository('personnelAssignments')
        .findMany({
          filter: { positionId: { $in: supervisorPositionIds } },
          limit: 5001,
        });
      const supervisorPersons = new Map<string, string[]>();
      for (const row of reports) {
        const data = (row.data ?? {}) as Record<string, unknown>;
        const startDate = text(data.startDate);
        const endDate = text(data.endDate);
        if (startDate && startDate > today) continue;
        if (endDate && endDate <= today) continue;
        const positionId = text(row.positionId);
        const personId = text(row.personId);
        if (!positionId || !personId) continue;
        const list = supervisorPersons.get(positionId) ?? [];
        list.push(personId);
        supervisorPersons.set(positionId, list);
      }
      const managerPersonIds = [
        ...new Set([...supervisorPersons.values()].flat()),
      ];
      if (!managerPersonIds.length) return result;
      const managers = await this.database
        .repository('personnelEmployees')
        .findMany({ filter: { id: { $in: managerPersonIds } }, limit: 5001 });
      const managerAccounts = new Map(
        managers.map((row) => [
          text(row.id),
          text((row.data as Record<string, unknown> | undefined)?.accountId),
        ]),
      );
      for (const [personId, positionId] of primary) {
        const target = reportTo.get(positionId);
        if (!target) continue;
        const accounts = (supervisorPersons.get(target) ?? [])
          .map((id) => managerAccounts.get(id) ?? '')
          .filter(Boolean);
        if (accounts.length) result.set(personId, [...new Set(accounts)]);
      }
    } catch {
      return new Map();
    }
    return result;
  }
}
