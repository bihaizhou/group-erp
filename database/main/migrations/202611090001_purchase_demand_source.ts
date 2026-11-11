import { defineMigration } from '@nocobase/db';

/**
 * A purchase order must declare where its demand comes from. `request` orders
 * carry at least one allocation against an approved purchase request line;
 * `temporary` orders explain why no request covers the demand. Orders created
 * before this field existed are backfilled so their history stays readable.
 */
export default defineMigration({
  name: '202611090001_purchase_demand_source',
  transaction: true,
  async up(context) {
    const { builder } = context;
    await builder.alterCollection('purchaseOrders', (c) => {
      c.string('demandMode', { length: 16, nullable: true });
      c.text('temporaryReason', { nullable: true });
    });
    const orders = context.repository('purchaseOrders'),
      allocations = context.repository('purchaseAllocations'),
      orderRows = await orders.findMany({ limit: 10001 }),
      allocationRows = await allocations.findMany({
        filter: { status: 'active' },
        limit: 10001,
      }),
      sourced = new Set(allocationRows.map((row) => row.orderId as string));
    for (const order of orderRows) {
      const id = order.id as string;
      if ((order.status as string) === 'draft') continue;
      const allocated = sourced.has(id);
      await orders.updateOne({
        filter: { id },
        values: {
          demandMode: allocated ? 'request' : 'temporary',
          temporaryReason: allocated
            ? null
            : '历史订单：迁移前未登记需求来源，需在下一次修订时补齐。',
        },
      });
    }
  },
  async down(context) {
    const { builder } = context;
    await builder.alterCollection('purchaseOrders', (c) => {
      c.dropField('demandMode');
      c.dropField('temporaryReason');
    });
  },
});
