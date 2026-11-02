import { randomUUID } from 'node:crypto';
import type { DatabaseConnection } from '@nocobase/db';
import { peopleFail, type PeopleActor } from './people-model.js';

export const PEOPLE_CHECKLIST_TABLE = 'peopleChangeChecklist';

export type ChecklistItemTemplate = {
  key: string;
  title: string;
  owner: string;
};

/**
 * The default onboarding/offboarding work each transaction type starts with.
 * Titles are the Chinese source copy; the client translates by key and owner.
 * Templates stay code-owned in v1 so a fresh install still has a usable flow.
 */
export const checklistTemplates: Record<string, ChecklistItemTemplate[]> = {
  entry: [
    { key: 'entry-pickup', title: '领取办公物品与设备', owner: 'admin' },
    { key: 'entry-accounts', title: '开通账号与系统权限', owner: 'it' },
    { key: 'entry-onboarding', title: '工作对接与入职引导', owner: 'manager' },
    { key: 'entry-contract', title: '签署劳动合同', owner: 'hr' },
  ],
  transfer: [
    {
      key: 'transfer-handover',
      title: '原岗位工作交接',
      owner: 'oldDepartment',
    },
    {
      key: 'transfer-role',
      title: '新岗位职责与目标确认',
      owner: 'newDepartment',
    },
    { key: 'transfer-access', title: '系统权限调整', owner: 'it' },
  ],
  partTime: [
    { key: 'parttime-agreement', title: '签署兼职协议', owner: 'hr' },
    { key: 'parttime-plan', title: '兼职工作安排确认', owner: 'department' },
  ],
  endPartTime: [
    { key: 'endparttime-handover', title: '兼职工作交接', owner: 'department' },
    { key: 'endparttime-access', title: '收回兼职权限', owner: 'it' },
  ],
  exit: [
    { key: 'exit-handover', title: '工作交接', owner: 'manager' },
    { key: 'exit-return', title: '归还公司物品', owner: 'admin' },
    { key: 'exit-access', title: '账号与系统权限回收', owner: 'it' },
    { key: 'exit-settlement', title: '工资与补偿结算', owner: 'finance' },
    { key: 'exit-social', title: '社保与公积金减员', owner: 'hr' },
    { key: 'exit-certificate', title: '开具离职证明', owner: 'hr' },
  ],
  regularize: [
    { key: 'regularize-review', title: '转正评估', owner: 'manager' },
    { key: 'regularize-paperwork', title: '转正手续与合同变更', owner: 'hr' },
  ],
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
  async ensure(c: DatabaseConnection, changeId: string, type: string) {
    const existing = await this.repository(c).count({
      filter: { changeId },
    });
    if (existing) return;
    const template = checklistTemplates[type] ?? [];
    if (!template.length) return;
    for (const [sort, item] of template.entries())
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
