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
  position: {
    code: string;
    name: string;
    productionRole?: 'production' | 'support';
    permissionSets: string[];
  };
};

const accounts: DemoAccount[] = [
  {
    email: 'buyer@demo.local',
    name: '演示采购员',
    unit: 'DEMO-UNIT-PROCUREMENT',
    position: {
      code: 'DEMO-POS-BUYER',
      name: '采购员',
      permissionSets: [
        'procurement-requester',
        'procurement-material-selector',
        'procurement-order-operator',
        'procurement-supplier-reader',
        'procurement-review-configurator',
      ],
    },
  },
  {
    email: 'keeper@demo.local',
    name: '演示仓储员',
    unit: 'DEMO-UNIT-WAREHOUSE',
    position: {
      code: 'DEMO-POS-KEEPER',
      name: '仓储员',
      permissionSets: [
        'warehouse-stock-operator',
        'warehouse-stock-reader',
        'warehouse-transfer-operator',
        'warehouse-count-operator',
        'warehouse-master-maintainer',
        'demo-warehouse-review-settings',
      ],
    },
  },
  {
    email: 'planner@demo.local',
    name: '演示生产主管',
    unit: 'DEMO-UNIT-PRODUCTION',
    position: {
      code: 'DEMO-POS-PLANNER',
      name: '生产主管',
      productionRole: 'production',
      permissionSets: ['production-manager'],
    },
  },
  {
    email: 'shiftlead@demo.local',
    name: '演示生产代班',
    unit: 'DEMO-UNIT-PRODUCTION',
    position: {
      code: 'DEMO-POS-SHIFTLEAD',
      name: '生产代班',
      productionRole: 'production',
      permissionSets: ['production-lead'],
    },
  },
  {
    email: 'viewer@demo.local',
    name: '演示集团查看',
    unit: 'DEMO-UNIT-PRODUCTION',
    position: {
      code: 'DEMO-POS-VIEWER',
      name: '集团生产查看',
      productionRole: 'production',
      permissionSets: ['production-group-viewer'],
    },
  },
  {
    email: 'worker1@demo.local',
    name: '张伟（演示）',
    unit: 'DEMO-UNIT-PRODUCTION',
    position: {
      code: 'DEMO-POS-WORKER1',
      name: '球磨工',
      productionRole: 'production',
      permissionSets: [],
    },
  },
  {
    email: 'worker2@demo.local',
    name: '李强（演示）',
    unit: 'DEMO-UNIT-PRODUCTION',
    position: {
      code: 'DEMO-POS-WORKER2',
      name: '浮选工',
      productionRole: 'production',
      permissionSets: [],
    },
  },
  {
    email: 'reader@demo.local',
    name: '演示只读查看',
    unit: 'DEMO-UNIT-WAREHOUSE',
    position: {
      code: 'DEMO-POS-READER',
      name: '仓库查看',
      productionRole: 'support',
      permissionSets: ['warehouse-stock-reader', 'procurement-supplier-reader'],
    },
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
      permissionSets: ['personnel-maintainer', 'personnel-reader', 'human-resources-reader', 'people-auditor'],
    },
  },
  {
    email: 'sales@demo.local',
    name: '演示销售员',
    unit: 'DEMO-UNIT-SALES',
    position: {
      code: 'DEMO-POS-SALES',
      name: '销售员',
      permissionSets: ['sales-order-operator', 'sales-customer-manager', 'demo-sales-review-settings'],
    },
  },
  {
    email: 'requester@demo.local',
    name: '演示领用申请人',
    unit: 'DEMO-UNIT-WAREHOUSE',
    position: {
      code: 'DEMO-POS-REQUESTER',
      name: '领用申请人',
      permissionSets: ['requisitions-requester', 'requisitions-purpose-maintainer', 'requisitions-review-configurator'],
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

    for (const extra of [
      { key: 'demo-sales-review-settings', title: '演示：销售复核设置', page: 'sales-review-settings' },
      { key: 'demo-warehouse-review-settings', title: '演示：仓储复核设置', page: 'warehouse-review-settings' },
    ]) {
      if (await repository('authorizationPermissionSets').findOne({ filter: { key: extra.key } })) continue;
      await query
        .insertInto('authorization_permission_sets')
        .values({
          id: extra.key,
          key: extra.key,
          title: JSON.stringify(extra.title),
          grants: JSON.stringify([
            { resource: { type: 'page', id: extra.page }, actions: [{ action: 'access' }] },
          ]),
          revision: 1,
          created_at: now,
          updated_at: now,
        } as Row)
        .execute();
    }

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
      const userId = randomUUID();
      const positionId = randomUUID();
      await query
        .insertInto('org_positions')
        .values({
          id: positionId,
          code: account.position.code,
          name: account.position.name,
          status: 'active',
          sort_order: 0,
          production_role: account.position.productionRole ?? 'support',
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
        // 任职同步在界面上由人事服务写这张表；种子直接落库，登录后即可生效。
        await query
          .insertInto('authorization_permission_set_assignments')
          .values({
            id: `user:${userId}:${permissionSet}`,
            subject_type: 'user',
            subject_id: userId,
            permission_set_key: permissionSet,
            created_at: now,
            updated_at: now,
          } as Row)
          .execute();
      }

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
          data: { location: '演示数据', education: '', experience: '', accountId: userId },
          created_at: now,
          updated_at: now,
        } as Row)
        .execute();

      await query
        .insertInto('personnel_employments')
        .values({
          id: randomUUID(),
          code: `DEMO-EMP-REC-${account.position.code.replace('DEMO-POS-', '')}`,
          name: account.name,
          status: 'active',
          revision: 1,
          lifecycle_version: 1,
          created_by: admin?.id,
          account_id: userId,
          subject_id: subject.id,
          person_id: employeeId,
          data: { startDate: '2026-01-01', endDate: null, location: '演示数据' },
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
          data: { type: 'primary', startDate: '2026-01-01', endDate: null, location: '' },
          created_at: now,
          updated_at: now,
        } as Row)
        .execute();
    }

    // 生产报表页的演示数据：单元档案、物料清单与账面库存。
    const productionUnitId = unitIds.get('DEMO-UNIT-PRODUCTION');
    if (productionUnitId) {
      const subjectId = String(subject.id);
      const unitId = String(productionUnitId);
      const createdBy = admin?.id ? String(admin.id) : 'seed';
      const profile = await repository('prdUnitProfiles').findOne({
        filter: { unitId },
      });
      if (!profile) {
        await repository('prdUnitProfiles').createOne({
          values: {
            id: randomUUID(),
            subjectId,
            unitId,
            lineCode: 'PRD-L1',
            processType: '磁选+浮选',
            designCapacityTpd: 1200,
            commissionDate: '2024-06-01',
            region: '华东',
            status: 'active',
            version: 1,
            createdBy,
            updatedBy: createdBy,
            createdAt: now,
            updatedAt: now,
          },
        });
      }
      const warehouse = await repository('warehouses').findOne({
        filter: { code: 'WH1', subjectId },
      });
      const ton = await repository('measureUnits').findOne({
        filter: { code: 'T' },
      });
      const ensureSku = async (name: string, code: string) => {
        const existing = await repository('materialSkus').findOne({
          filter: { code },
        });
        if (existing?.id) return String(existing.id);
        if (!ton?.id) return null;
        const materialName = await repository('materialNames').findOne({
          filter: { code: `DEMO-${code}` },
        });
        const nameId = materialName?.id
          ? String(materialName.id)
          : randomUUID();
        if (!materialName?.id)
          await repository('materialNames').createOne({
            values: {
              id: nameId,
              code: `DEMO-${code}`,
              name,
              notes: '',
              status: 'active',
              revision: 1,
              lifecycleVersion: 1,
              createdBy,
              createdAt: now,
              updatedAt: now,
            },
          });
        const skuId = randomUUID();
        await repository('materialSkus').createOne({
          values: {
            id: skuId,
            code,
            name,
            materialNameId: nameId,
            baseUnitId: String(ton.id),
            managementMode: 'stock',
            attributeValues: {},
            identityKey: code,
            searchText: `${name} ${code}`,
            notes: '',
            status: 'active',
            revision: 1,
            lifecycleVersion: 1,
            createdBy,
            createdAt: now,
            updatedAt: now,
          },
        });
        return skuId;
      };
      const slagSku = await ensureSku('炉渣', 'SLAG01');
      const reagentSku = await ensureSku('浮选药剂', 'REAGENT01');
      const metalSku = await repository('materialSkus').findOne({
        filter: { code: 'METAL01' },
      });
      const sandSku = await repository('materialSkus').findOne({
        filter: { code: 'SAND01' },
      });
      const materials = [
        { skuId: slagSku, role: 'feedstock', warehouseId: null, sortOrder: 0 },
        {
          skuId: metalSku?.id ? String(metalSku.id) : null,
          role: 'product',
          warehouseId: warehouse?.id ? String(warehouse.id) : null,
          sortOrder: 10,
        },
        {
          skuId: sandSku?.id ? String(sandSku.id) : null,
          role: 'byproduct',
          warehouseId: warehouse?.id ? String(warehouse.id) : null,
          sortOrder: 20,
        },
        {
          skuId: reagentSku,
          role: 'auxiliary',
          warehouseId: null,
          sortOrder: 30,
        },
      ];
      for (const material of materials) {
        if (!material.skuId) continue;
        const existing = await repository('prdUnitMaterials').findOne({
          filter: { unitId, skuId: material.skuId },
        });
        if (existing) continue;
        await repository('prdUnitMaterials').createOne({
          values: {
            id: randomUUID(),
            subjectId,
            unitId,
            skuId: material.skuId,
            role: material.role,
            defaultWarehouseId: material.warehouseId,
            sortOrder: material.sortOrder,
            status: 'active',
            version: 1,
            createdBy,
            updatedBy: createdBy,
            createdAt: now,
            updatedAt: now,
          },
        });
      }
      if (warehouse?.id && ton?.id) {
        for (const [skuId, quantity] of [
          [metalSku?.id ? String(metalSku.id) : '', '40'],
          [sandSku?.id ? String(sandSku.id) : '', '120'],
        ] as const) {
          if (!skuId) continue;
          const existing = await repository('stockBalances').findOne({
            filter: {
              subjectId,
              skuId,
              warehouseId: String(warehouse.id),
              quality: 'qualified',
            },
          });
          if (existing) continue;
          await repository('stockBalances').createOne({
            values: {
              id: randomUUID(),
              dimensionKey: `${subjectId}:warehouse:${String(warehouse.id)}:${skuId}:qualified`,
              subjectId,
              skuId,
              baseUnitId: String(ton.id),
              warehouseId: String(warehouse.id),
              quality: 'qualified',
              quantity,
              reservedQuantity: '0',
              revision: 1,
              nonce: randomUUID(),
              updatedAt: now,
            },
          });
        }
      }
      for (const [code, name] of [
        ['CR-01', '一段破碎机'],
        ['BM-01', '球磨机'],
        ['FL-01', '浮选机'],
      ] as const) {
        const existing = await repository('prdEquipment').findOne({
          filter: { subjectId, code },
        });
        if (existing) continue;
        await repository('prdEquipment').createOne({
          values: {
            id: randomUUID(),
            subjectId,
            unitId,
            code,
            name,
            category: 'production',
            criticality: 'normal',
            status: 'active',
            version: 1,
            createdBy,
            updatedBy: createdBy,
            createdAt: now,
            updatedAt: now,
          },
        });
      }
    }
  },
});
