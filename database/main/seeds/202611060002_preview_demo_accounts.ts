import { randomUUID, scryptSync } from 'node:crypto';
import { defineSeed, type SeedContext } from '@nocobase/db';

type Row = Record<string, unknown>;

/**
 * 演示账号：每个模块一个能登录的账号，带员工档案、任职记录、岗位与岗位权限。
 *
 * 属于 sample 数据，只在带 `app.sampleData`（APP_SAMPLE_DATA=true）的安装里自动装载，
 * 生产库默认跳过；`pnpm nocobase db sample` 可以在开发库里补装。
 * 统一密码见 DEMO_PASSWORD，登录后即可按岗位权限看到本模块能看到的范围。
 * 依赖 `202611060001_preview_sample_data` 建好的测试公司（TESTCO）。
 */
const DEMO_PASSWORD = 'qinwang2026';

const departments: { code: string; name: string }[] = [
  { code: 'DEMO-UNIT-PROCUREMENT', name: '采购部' },
  { code: 'DEMO-UNIT-WAREHOUSE', name: '仓储部' },
  { code: 'DEMO-UNIT-PRODUCTION', name: '生产部' },
  { code: 'DEMO-UNIT-HSE', name: '安环部' },
  { code: 'DEMO-UNIT-OPERATIONS', name: '运营部' },
  { code: 'DEMO-UNIT-ASSETS', name: '资产部' },
  { code: 'DEMO-UNIT-PEOPLE', name: '人事部' },
  { code: 'DEMO-UNIT-SALES', name: '销售部' },
];

type DemoAccount = {
  email: string;
  name: string;
  unit: string;
  position: { code: string; name: string; permissionSets: string[] };
};

const accounts: DemoAccount[] = [
  {
    email: 'buyer@demo.local',
    name: '演示采购员',
    unit: 'DEMO-UNIT-PROCUREMENT',
    position: {
      code: 'DEMO-POS-BUYER',
      name: '采购员',
      permissionSets: ['procurement-requester', 'procurement-material-selector', 'procurement-order-operator'],
    },
  },
  {
    email: 'keeper@demo.local',
    name: '演示仓储员',
    unit: 'DEMO-UNIT-WAREHOUSE',
    position: {
      code: 'DEMO-POS-KEEPER',
      name: '仓储员',
      permissionSets: ['warehouse-stock-operator', 'warehouse-stock-reader'],
    },
  },
  {
    email: 'planner@demo.local',
    name: '演示生产主管',
    unit: 'DEMO-UNIT-PRODUCTION',
    position: { code: 'DEMO-POS-PLANNER', name: '生产主管', permissionSets: ['production-lead'] },
  },
  {
    email: 'hse@demo.local',
    name: '演示安环专员',
    unit: 'DEMO-UNIT-HSE',
    position: {
      code: 'DEMO-POS-HSE',
      name: '安环专员',
      permissionSets: ['hse-project-manager', 'hse-group-viewer'],
    },
  },
  {
    email: 'operator@demo.local',
    name: '演示运营专员',
    unit: 'DEMO-UNIT-OPERATIONS',
    position: {
      code: 'DEMO-POS-OPERATOR',
      name: '运营专员',
      permissionSets: ['operations-project-viewer'],
    },
  },
  {
    email: 'asset@demo.local',
    name: '演示资产专员',
    unit: 'DEMO-UNIT-ASSETS',
    position: { code: 'DEMO-POS-ASSET', name: '资产专员', permissionSets: ['asset-manager'] },
  },
  {
    email: 'hr@demo.local',
    name: '演示人事专员',
    unit: 'DEMO-UNIT-PEOPLE',
    position: {
      code: 'DEMO-POS-HR',
      name: '人事专员',
      permissionSets: ['personnel-maintainer', 'personnel-reader'],
    },
  },
  {
    email: 'sales@demo.local',
    name: '演示销售员',
    unit: 'DEMO-UNIT-SALES',
    position: { code: 'DEMO-POS-SALES', name: '销售员', permissionSets: ['sales-order-operator'] },
  },
  {
    email: 'requester@demo.local',
    name: '演示领用申请人',
    unit: 'DEMO-UNIT-WAREHOUSE',
    position: {
      code: 'DEMO-POS-REQUESTER',
      name: '领用申请人',
      permissionSets: ['requisitions-requester'],
    },
  },
];

/**
 * 与 better-auth 的 credential 校验保持一致：`salt:scryptHex`，
 * salt 为 16 字节随机数的十六进制串，scrypt 参数 N=16384 / r=16 / p=1 / dkLen=64。
 */
function credentialHash(password: string): string {
  const salt = randomUUID().replace(/-/g, '');
  const key = scryptSync(password.normalize('NFKC'), salt, 64, {
    N: 16384,
    r: 16,
    p: 1,
    maxmem: 128 * 16384 * 16 * 2,
  });
  return `${salt}:${key.toString('hex')}`;
}

export default defineSeed({
  name: '202611060002_preview_demo_accounts',
  sample: true,
  transaction: true,
  async run({ repository, query }: Pick<SeedContext, 'repository' | 'query'>) {
    if (await repository('user').findOne({ filter: { email: accounts[0].email } })) return;

    const subject = await repository('orgSubjects').findOne({ filter: { code: 'TESTCO' } });
    if (!subject?.id) return;

    const admin =
      (await repository('user').findOne({ filter: { email: 'admin@nocobase.com' } })) ??
      (await repository('user').findOne({ filter: {} }));
    const now = new Date().toISOString();

    const unitIds = new Map<string, unknown>();
    for (const department of departments) {
      const found = await repository('orgUnits').findOne({ filter: { code: department.code } });
      const id = found?.id ?? randomUUID();
      if (!found) {
        await query
          .insertInto('org_units')
          .values({
            id,
            code: department.code,
            name: department.name,
            status: 'active',
            sort_order: 0,
            revision: 1,
            type: 'department',
            subject_id: subject.id,
            created_at: now,
            updated_at: now,
          } as Row)
          .execute();
      }
      unitIds.set(department.code, id);
    }

    for (const account of accounts) {
      const positionId = randomUUID();
      await query
        .insertInto('org_positions')
        .values({
          id: positionId,
          code: account.position.code,
          name: account.position.name,
          status: 'active',
          sort_order: 0,
          revision: 1,
          unit_id: unitIds.get(account.unit),
          created_at: now,
          updated_at: now,
        } as Row)
        .execute();

      for (const permissionSet of account.position.permissionSets) {
        await query
          .insertInto('org_position_permission_sets')
          .values({
            id: randomUUID(),
            position_id: positionId,
            permission_set_key: permissionSet,
            created_at: now,
            updated_at: now,
          } as Row)
          .execute();
      }

      const userId = randomUUID();
      await query
        .insertInto('user')
        .values({
          id: userId,
          name: account.name,
          email: account.email,
          email_verified: 1,
          kind: 'person',
          created_at: now,
          updated_at: now,
        } as Row)
        .execute();
      await query
        .insertInto('account')
        .values({
          id: randomUUID(),
          account_id: userId,
          provider_id: 'credential',
          user_id: userId,
          password: credentialHash(DEMO_PASSWORD),
          created_at: now,
          updated_at: now,
        } as Row)
        .execute();

      const employeeId = randomUUID();
      await query
        .insertInto('personnel_employees')
        .values({
          id: employeeId,
          code: `DEMO-EMP-${account.position.code.replace('DEMO-POS-', '')}`,
          name: account.name,
          status: 'active',
          revision: 1,
          lifecycle_version: 1,
          created_by: admin?.id,
          account_id: userId,
          subject_id: subject.id,
          data: JSON.stringify({ location: '演示数据', education: '', experience: '', accountId: userId }),
          created_at: now,
          updated_at: now,
        } as Row)
        .execute();

      await query
        .insertInto('personnel_assignments')
        .values({
          id: randomUUID(),
          code: `DEMO-ASG-${account.position.code.replace('DEMO-POS-', '')}`,
          name: account.name,
          status: 'active',
          revision: 1,
          lifecycle_version: 1,
          created_by: admin?.id,
          account_id: userId,
          subject_id: subject.id,
          person_id: employeeId,
          position_id: positionId,
          data: JSON.stringify({ type: 'primary', startDate: '2026-01-01', endDate: null, location: '' }),
          created_at: now,
          updated_at: now,
        } as Row)
        .execute();
    }
  },
});
