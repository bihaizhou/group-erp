import type { DatabaseConnection, RepositoryRecord } from '@nocobase/db';
import type { UserAdministrationService } from '@nocobase/app-plugin-authentication';
import {
  resolveReviewerSelections,
  type ReviewerSelection,
} from '@nocobase/lifecycle';
import { businessDate } from './business-date.js';
import { inventoryError as fail } from './inventory-quantity.js';

const text = (value: unknown) => (typeof value === 'string' ? value : '');

/** Business approval eligibility only. Every HTTP action also needs its own grant. */
export class ExecutionReviewers {
  constructor(
    private readonly users: UserAdministrationService,
    private readonly timeZone: string,
  ) {}
  private effective(row: RepositoryRecord) {
    const data = row.data as { startDate?: string; endDate?: string | null },
      today = businessDate(this.timeZone);
    return (
      typeof data.startDate === 'string' &&
      data.startDate <= today &&
      (!data.endDate || data.endDate > today)
    );
  }
  async eligible(
    c: DatabaseConnection,
    accountId: string,
    subjectId: string,
    excluded: readonly string[] = [],
  ): Promise<boolean> {
    if (excluded.includes(accountId)) return false;
    const user = await this.users.withConnection(c).get(accountId);
    if (!user || user.kind !== 'person' || user.disabledAt) return false;
    const person = await c
      .repository('personnelEmployees')
      .findOne({ filter: { accountId, status: 'active' } });
    if (!person) return false;
    const employments = await c.repository('personnelEmployments').findMany({
      filter: { personId: text(person.id), subjectId, status: 'active' },
      limit: 10001,
    });
    if (employments.length > 10000) return fail('STOCK_REFERENCE_TOO_BROAD');
    if (!employments.some((row) => this.effective(row))) return false;
    const assignments = await c.repository('personnelAssignments').findMany({
      filter: { personId: text(person.id), subjectId, status: 'active' },
      limit: 10001,
    });
    if (assignments.length > 10000) return fail('STOCK_REFERENCE_TOO_BROAD');
    for (const assignment of assignments) {
      if (!this.effective(assignment)) continue;
      const position = await c.repository('orgPositions').findOne({
        filter: { id: text(assignment.positionId), status: 'active' },
      });
      if (
        position &&
        (await c.repository('orgUnits').exists({
          filter: { id: text(position.unitId), subjectId, status: 'active' },
        }))
      )
        return true;
    }
    return false;
  }
  async resolve(
    c: DatabaseConnection,
    subjectId: string,
    selections: readonly ReviewerSelection[],
    excluded: readonly string[],
  ): Promise<string[]> {
    const values = await resolveReviewerSelections(
      [...selections],
      {
        scope: `execution:${subjectId}`,
        applicantId: excluded[0] ?? '',
        transactionHandle: c,
      },
      {
        selectors: {
          user: async (id) => [id],
          position: async (id) => {
            const position = await c
              .repository('orgPositions')
              .findOne({ filter: { id, status: 'active' } });
            if (
              !position ||
              !(await c.repository('orgUnits').exists({
                filter: {
                  id: text(position.unitId),
                  subjectId,
                  status: 'active',
                },
              }))
            )
              return [];
            const rows = await c.repository('personnelAssignments').findMany({
              filter: { positionId: id, subjectId, status: 'active' },
              limit: 10001,
            });
            if (rows.length > 10000) return fail('STOCK_REFERENCE_TOO_BROAD');
            const accounts: string[] = [];
            for (const row of rows) {
              if (!this.effective(row)) continue;
              const person = await c.repository('personnelEmployees').findOne({
                filter: { id: text(row.personId), status: 'active' },
              });
              if (person?.accountId) accounts.push(text(person.accountId));
            }
            return accounts;
          },
        },
        eligible: (id) => this.eligible(c, id, subjectId, excluded),
      },
    );
    if (!values.length)
      return fail('STOCK_REVIEWERS_EMPTY', 'reviewerSelections');
    return [...values];
  }
}
