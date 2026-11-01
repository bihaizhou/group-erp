import type { Application } from '@nocobase/app-server/application';
import { ServiceProvider } from '@nocobase/service-provider';
import { agentsToken } from '@nocobase/app-plugin-agents/server/tokens';
import type { OnlineAgentJson } from '@nocobase/app-plugin-agents/server';
import type { AuthorizationContext } from '@nocobase/authorization/core';
import { databaseManagerToken, type DatabaseConnection } from '@nocobase/db';
import type { FilterBuilder, RepositoryPolicy } from '@nocobase/db';
import { materialIdFilter } from './material-filters.js';
import { z } from 'zod';

const deliveryQuery = z.object({
  supplier: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .optional()
    .describe('供应商名称或编号的包含匹配；省略则返回最近的全部交付记录'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(10)
    .default(5)
    .describe('最多返回的收货单数量'),
});

const stockKinds = [
  'purchaseReceipt',
  'purchaseReturn',
  'productionReceipt',
  'salesShipment',
  'salesReturn',
  'transferDispatch',
  'transferReceipt',
  'countAdjustment',
  'reversal',
] as const;

const stockQuery = z.object({
  kind: z
    .enum(stockKinds)
    .optional()
    .describe(
      '出入库单类型：purchaseReceipt 采购收货、purchaseReturn 采购退货、productionReceipt 生产入库、salesShipment 销售发货、salesReturn 销售退货、transferDispatch 调拨出、transferReceipt 调拨入、countAdjustment 盘盈亏、reversal 冲销；省略则返回全部类型',
    ),
  status: z
    .string()
    .trim()
    .max(40)
    .optional()
    .describe('单据状态，例如 draft、posted；省略则不限'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(10)
    .default(5)
    .describe('最多返回的单据数量'),
});

const iso = (value: unknown): string | null => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || value instanceof Date) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
};

const text = (value: unknown): string =>
  typeof value === 'string' ? value : '';

const number = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const ids = (rows: readonly object[], field: string): string[] => [
  ...new Set(
    rows
      .map((row) => (row as Record<string, unknown>)[field])
      .filter((value): value is string => typeof value === 'string'),
  ),
];

/**
 * The one rule every assistant shares. It says nothing about a domain: a
 * permission answer is the model's own wording, the tool only reports `denied`.
 */
const sharedRules =
  '只陈述工具返回的内容，不要编造数量、日期、单据号或供应商名称；没有记录时如实说明。工具返回 denied 表示当前账号没有这项数据的权限：如实说没有权限、建议联系管理员，不要提错误码或内部实现，也不要猜测或编造数据。';

/**
 * One scope per module of the application: the floating chat picks the scope of
 * the page the person is on, so each module answers with its own role and its
 * own tools.
 */
interface ModuleAssistant {
  /** The scope the conversation is created in. */
  readonly scope: string;
  /** The conversation title, shown in the chat's header. */
  readonly title: string;
  /** Who the assistant is, in the module the person is on. */
  readonly role: string;
  /** The tools this module may call; none yet for most modules. */
  readonly tool: readonly string[];
}

const noTools =
  '这个模块还没有接入查询工具：不要假装查过数据，不要编造单据、数字、菜单名称或页面路径；需要具体数据时说明暂未开通，请对方到本模块的列表页面查看。';

const assistants: readonly ModuleAssistant[] = [
  {
    scope: 'group-erp/procurement',
    title: '采购助手',
    role: '你是集团 ERP 的采购助手，负责采购申请、采购订单、供应商与收货交付的问题。',
    tool: ['read_supplier_deliveries'],
  },
  {
    scope: 'group-erp/warehouse',
    title: '仓储助手',
    role: '你是集团 ERP 的仓储助手，负责库存与出入库单据（收货、发货、调拨、盘点、冲销）的问题。',
    tool: ['read_stock_documents'],
  },
  {
    scope: 'group-erp/requisitions',
    title: '领用助手',
    role: '你是集团 ERP 的领用助手，负责物料领用申请、审批与发放的问题。',
    tool: [],
  },
  {
    scope: 'group-erp/sales',
    title: '销售助手',
    role: '你是集团 ERP 的销售助手，负责客户、销售订单与发货的问题。',
    tool: [],
  },
  {
    scope: 'group-erp/hse',
    title: '安环助手',
    role: '你是集团 ERP 的安环助手，负责安全与环保的制度、检查与记录的问题。',
    tool: [],
  },
  {
    scope: 'group-erp/production',
    title: '生产助手',
    role: '你是集团 ERP 的生产助手，负责生产订单、投料、产出与生产入库的问题。',
    tool: [],
  },
  {
    scope: 'group-erp/operations',
    title: '运营助手',
    role: '你是集团 ERP 的运营助手，负责运营计划与经营分析的问题。',
    tool: [],
  },
  {
    scope: 'group-erp/assets',
    title: '资产助手',
    role: '你是集团 ERP 的资产助手，负责固定资产台账、领用、调拨与报废的问题。',
    tool: [],
  },
  {
    scope: 'group-erp/people',
    title: '人事助手',
    role: '你是集团 ERP 的人事助手，负责组织人员、任职、评价与人才发展的问题。',
    tool: [],
  },
  {
    scope: 'group-erp/organization',
    title: '组织助手',
    role: '你是集团 ERP 的组织助手，负责组织架构、单元、岗位、板块与权限的问题。',
    tool: [],
  },
  {
    scope: 'group-erp/general',
    title: '集团助手',
    role: '你是集团的智能助手，回答系统怎么用、某个页面在哪里，以及跨模块的流程问题。',
    tool: [],
  },
];

/**
 * Registers the application's read-only business tools and one scope per module
 * for the native online agent. Tools apply the same `warehouse.inventory` data
 * policies the inventory pages use.
 */
export default class AgentsProvider extends ServiceProvider<Application> {
  public readonly name = 'group-erp/agents';

  public override register() {
    // An application booted without the agents plugin (tests, or a trimmed runtime) has no token to bind to.
    if (!this.app.container.has(agentsToken)) return;
    const online = this.app.container.resolve(agentsToken).onlineAgent;
    const database = this.app.container.resolve(databaseManagerToken);

    /**
     * The policies of `warehouse.inventory`, or null when the caller may not
     * read it or is denied one of the tables this tool needs.
     */
    const inventoryPolicies = async (
      context: { authorization: AuthorizationContext },
      tables: readonly string[],
    ): Promise<Record<string, RepositoryPolicy> | null> => {
      const decision = await context.authorization.authorize({
        resource: { type: 'composite', id: 'warehouse.inventory' },
        action: 'read',
      });
      const policies =
        decision.effect === 'deny' ? undefined : decision.conditions?.database;
      if (!policies || tables.some((table) => !policies[table])) return null;
      return policies;
    };

    online.configurator.registerTool('read_supplier_deliveries', {
      version: '1',
      definition: () => ({
        description:
          '查询供应商的采购交付记录（收货单）：供应商、收货单号、收货日期、物料、数量与被拒数量、单据状态。只读操作。',
        inputSchema: deliveryQuery,
        execute: async (input, { context }): Promise<OnlineAgentJson> => {
          const policies = await inventoryPolicies(context, [
            'businessPartners',
            'purchaseOrders',
            'stockDocuments',
            'stockDocumentLines',
          ]);
          if (!policies) return { denied: true, reason: 'no_permission' };

          const connection: DatabaseConnection = database.connection();
          const repo = (table: string) =>
            connection.repository(table).withPolicy(policies[table]);
          const optional = (table: string) => {
            const policy = policies[table];
            return policy
              ? connection.repository(table).withPolicy(policy)
              : null;
          };

          const partners = await repo('businessPartners').findMany({
            filter: input.supplier
              ? (f: FilterBuilder) =>
                  f.or([
                    f.string('name').includes(input.supplier as string, {
                      mode: 'insensitive',
                    }),
                    f.string('code').includes(input.supplier as string, {
                      mode: 'insensitive',
                    }),
                  ])
              : undefined,
            select: (s) => s.fields('id', 'code', 'name'),
            sort: (s) => [s.field('name').asc()],
            limit: 50,
          });
          if (!partners.length) {
            return { supplier: input.supplier ?? null, deliveries: [] };
          }

          const partnerIds = ids(partners, 'id');
          const orders = await repo('purchaseOrders').findMany({
            filter: (f: FilterBuilder) =>
              materialIdFilter(f, 'partnerId', partnerIds),
            select: (s) => s.fields('id', 'code', 'partnerId', 'deliveryOn'),
            sort: (s) => [s.field('deliveryOn').desc()],
            limit: 200,
          });
          const orderById = new Map(orders.map((order) => [order.id, order]));

          const documents = await repo('stockDocuments').findMany({
            filter: (f: FilterBuilder) =>
              f.and([
                f.string('kind').eq('purchaseReceipt'),
                materialIdFilter(f, 'purchaseOrderId', ids(orders, 'id')),
              ]),
            select: (s) =>
              s.fields(
                'id',
                'code',
                'status',
                'purchaseOrderId',
                'occurredOn',
                'postedAt',
                'notes',
              ),
            sort: (s) => [s.field('occurredOn').desc()],
            limit: input.limit,
          });

          const lines = documents.length
            ? await repo('stockDocumentLines').findMany({
                filter: (f: FilterBuilder) =>
                  materialIdFilter(f, 'documentId', ids(documents, 'id')),
                select: (s) =>
                  s.fields(
                    'documentId',
                    'lineNo',
                    'skuId',
                    'quantity',
                    'baseQuantity',
                    'rejectedQuantity',
                    'returnedQuantity',
                  ),
                sort: (s) => [
                  s.field('documentId').asc(),
                  s.field('lineNo').asc(),
                ],
              })
            : [];

          const skus = optional('materialSkus');
          const skuIds = ids(lines, 'skuId');
          const skuRows =
            skus && skuIds.length
              ? await skus.findMany({
                  filter: (f: FilterBuilder) =>
                    materialIdFilter(f, 'id', skuIds),
                  select: (s) => s.fields('id', 'code', 'name'),
                })
              : [];
          const skuName = new Map<string, string>(
            skuRows.map((row) => [
              text(row.id),
              text(row.name) || text(row.code),
            ]),
          );

          const partnerById = new Map(partners.map((row) => [row.id, row]));

          return {
            supplier: input.supplier ?? null,
            deliveries: documents.map((document) => {
              const order = orderById.get(document.purchaseOrderId);
              const partner = partnerById.get(order?.partnerId ?? null);
              return {
                document: text(document.code),
                occurredOn: iso(document.occurredOn ?? document.postedAt),
                status: text(document.status),
                order: order ? text(order.code) : null,
                supplier: partner
                  ? { code: text(partner.code), name: text(partner.name) }
                  : null,
                notes: text(document.notes) || null,
                lines: lines
                  .filter((line) => line.documentId === document.id)
                  .map((line) => ({
                    material: skuName.get(line.skuId as string) ?? null,
                    quantity: number(line.quantity),
                    baseQuantity: number(line.baseQuantity),
                    rejectedQuantity: number(line.rejectedQuantity),
                    returnedQuantity: number(line.returnedQuantity),
                  })),
              };
            }),
          };
        },
      }),
    });

    online.configurator.registerTool('read_stock_documents', {
      version: '1',
      definition: () => ({
        description:
          '查询出入库单据：单号、类型、状态、发生日期、仓库、物料与数量。可按单据类型和状态筛选。只读操作。',
        inputSchema: stockQuery,
        execute: async (input, { context }): Promise<OnlineAgentJson> => {
          const policies = await inventoryPolicies(context, [
            'stockDocuments',
            'stockDocumentLines',
          ]);
          if (!policies) return { denied: true, reason: 'no_permission' };

          const connection: DatabaseConnection = database.connection();
          const repo = (table: string) =>
            connection.repository(table).withPolicy(policies[table]);
          const optional = (table: string) => {
            const policy = policies[table];
            return policy
              ? connection.repository(table).withPolicy(policy)
              : null;
          };

          const documents = await repo('stockDocuments').findMany({
            filter: (f: FilterBuilder) =>
              f.and([
                ...(input.kind ? [f.string('kind').eq(input.kind)] : []),
                ...(input.status ? [f.string('status').eq(input.status)] : []),
              ]),
            select: (s) =>
              s.fields(
                'id',
                'code',
                'kind',
                'status',
                'warehouseId',
                'occurredOn',
                'postedAt',
              ),
            sort: (s) => [s.field('occurredOn').desc()],
            limit: input.limit,
          });

          const lines = documents.length
            ? await repo('stockDocumentLines').findMany({
                filter: (f: FilterBuilder) =>
                  materialIdFilter(f, 'documentId', ids(documents, 'id')),
                select: (s) =>
                  s.fields(
                    'documentId',
                    'lineNo',
                    'skuId',
                    'quantity',
                    'baseQuantity',
                    'rejectedQuantity',
                    'returnedQuantity',
                  ),
                sort: (s) => [
                  s.field('documentId').asc(),
                  s.field('lineNo').asc(),
                ],
              })
            : [];

          const skus = optional('materialSkus');
          const skuIds = ids(lines, 'skuId');
          const skuRows =
            skus && skuIds.length
              ? await skus.findMany({
                  filter: (f: FilterBuilder) =>
                    materialIdFilter(f, 'id', skuIds),
                  select: (s) => s.fields('id', 'code', 'name'),
                })
              : [];
          const skuName = new Map<string, string>(
            skuRows.map((row) => [
              text(row.id),
              text(row.name) || text(row.code),
            ]),
          );

          const warehouses = optional('warehouses');
          const warehouseRows =
            warehouses && documents.length
              ? await warehouses.findMany({
                  filter: (f: FilterBuilder) =>
                    materialIdFilter(f, 'id', ids(documents, 'warehouseId')),
                  select: (s) => s.fields('id', 'code', 'name'),
                })
              : [];
          const warehouseName = new Map<string, string>(
            warehouseRows.map((row) => [
              text(row.id),
              text(row.name) || text(row.code),
            ]),
          );

          return {
            kind: input.kind ?? null,
            status: input.status ?? null,
            documents: documents.map((document) => ({
              document: text(document.code),
              kind: text(document.kind),
              status: text(document.status),
              warehouse:
                warehouseName.get(document.warehouseId as string) ?? null,
              occurredOn: iso(document.occurredOn ?? document.postedAt),
              lines: lines
                .filter((line) => line.documentId === document.id)
                .map((line) => ({
                  material: skuName.get(line.skuId as string) ?? null,
                  quantity: number(line.quantity),
                  baseQuantity: number(line.baseQuantity),
                  rejectedQuantity: number(line.rejectedQuantity),
                  returnedQuantity: number(line.returnedQuantity),
                })),
            })),
          };
        },
      }),
    });

    for (const assistant of assistants) {
      online.configurator.registerOnlineAgentScope(assistant.scope, {
        agentId: 'online',
        tool: [...assistant.tool],
        systemPromptTemplate: [
          assistant.role,
          assistant.tool.length ? '' : noTools,
          sharedRules,
        ]
          .filter(Boolean)
          .join(' '),
      });
    }
  }
}
