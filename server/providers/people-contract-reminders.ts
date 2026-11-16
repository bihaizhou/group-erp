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
 * employee's own account, so the employee is reminded where they already
 * look for notifications. Employees without an account (or without an
 * employment in effect today) are skipped; the personnel overview keeps
 * listing every expiring contract for HR.
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
    let delivered = 0;
    for (const row of due) {
      const accountId = accounts.get(row.employeeId);
      if (!accountId) continue;
      const contractEnd = text(row.data.contractEnd);
      try {
        await this.store.deliver({
          deliveryId: `contract-expiry:${row.id}:${contractEnd}`,
          notificationId: randomUUID(),
          userId: accountId,
          createdAt: new Date().toISOString(),
          message: {
            to: accountId,
            title: '劳动合同即将到期 · Labour contract expiring',
            body: `${row.name} 的劳动合同将于 ${contractEnd} 到期。 / The labour contract of ${row.name} ends on ${contractEnd}.`,
          },
        });
        delivered += 1;
      } catch {
        // A duplicate delivery for the same contract and end date is expected
        // when the sweep runs again; nothing else is worth failing the job.
      }
    }
    return { delivered, skipped: false };
  }
}
