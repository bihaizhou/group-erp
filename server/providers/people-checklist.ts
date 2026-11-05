import { randomUUID } from 'node:crypto';
import type { DatabaseConnection } from '@nocobase/db';
import { peopleFail, type PeopleActor } from './people-model.js';

export const PEOPLE_CHECKLIST_TABLE = 'peopleChangeChecklist';

export type ChecklistItemTemplate = {
  key: string;
  title: string;
  owner: string;
  assets?: boolean;
};

export type ChecklistItem = {
  id: string;
  key: string;
  title: string;
  owner: string;
  done: boolean;
  doneBy: string | null;
  doneAt: Date | string | null;
  note: string;
};

export type ChecklistView = {
  total: number;
  done: number;
  items: ChecklistItem[];
};

const text = (value: unknown) => (typeof value === 'string' ? value : '');
const asItem = (row: Record<string, unknown>): ChecklistItem => ({
  id: text(row.id),
  key: text(row.key),
  title: text(row.title),
  owner: text(row.owner),
  done: row.done === true,
  doneBy: row.doneBy ? text(row.doneBy) : null,
  doneAt: (row.doneAt as Date | string | null) ?? null,
  note: text(row.note),
});

export class PeopleChecklist {
  private repository(c: DatabaseConnection) {
    return c.repository(PEOPLE_CHECKLIST_TABLE);
  }
  /**
   * Materializes the configured template into rows. An `assets` item expands
   * into one return row per asset the employee still holds, so HR can check
   * the physical items off one by one; an employee without assets keeps the
   * configured row as a record that the step was reviewed.
   */
  async ensure(
    c: DatabaseConnection,
    changeId: string,
    employeeId: string,
    templates: ChecklistItemTemplate[],
  ) {
    const existing = await this.repository(c).count({
      filter: { changeId },
    });
    if (existing) return;
    if (!templates.length) return;
    const rows: { key: string; title: string; owner: string }[] = [];
    for (const item of templates) {
      if (item.assets && employeeId) {
        const assets = await c.repository('assets').findMany({
          filter: { custodianEmployeeId: employeeId, status: 'assigned' },
          sort: (s) => [s.field('code').asc()],
          limit: 200,
        });
        if (assets.length) {
          for (const asset of assets)
            rows.push({
              key: `asset:${text(asset.id)}`,
              title: `归还：${text(asset.name)}（${text(asset.code)}）`,
              owner: item.owner,
            });
          continue;
        }
      }
      rows.push({ key: item.key, title: item.title, owner: item.owner });
    }
    for (const [sort, item] of rows.entries())
      await this.repository(c).createOne({
        values: {
          id: randomUUID(),
          changeId,
          key: item.key,
          title: item.title,
          owner: item.owner,
          sort,
          done: false,
          doneBy: null,
          doneAt: null,
          note: '',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
  }
  async view(c: DatabaseConnection, changeId: string): Promise<ChecklistView> {
    const rows = await this.repository(c).findMany({
      filter: { changeId },
      sort: (s) => [s.field('sort').asc()],
      limit: 100,
    });
    const items = rows.map((row) => asItem(row as Record<string, unknown>));
    return {
      total: items.length,
      done: items.filter((item) => item.done).length,
      items,
    };
  }
  async set(
    c: DatabaseConnection,
    changeId: string,
    itemId: string,
    input: { done: boolean; note?: string },
    actor: PeopleActor,
  ): Promise<ChecklistView> {
    const item = await this.repository(c).findOne({
      filter: { id: itemId, changeId },
    });
    if (!item) return peopleFail('PEOPLE_NOT_FOUND');
    await this.repository(c).updateOne({
      filter: { id: itemId },
      values: {
        done: input.done,
        note: input.note ?? text(item.note),
        doneBy: input.done ? actor.id : null,
        doneAt: input.done ? new Date() : null,
        updatedAt: new Date(),
      },
    });
    return this.view(c, changeId);
  }
}
