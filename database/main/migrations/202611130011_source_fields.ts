import { defineMigration } from '@nocobase/db';

/**
 * 来源字段八件套补齐（G3/G4/G5 整改）：
 * 采购申请已有 businessDate + sourceChannel；本迁移补 sourceRef（来源单据号）、
 * sourceDoc（来源单据说明）、onBehalfOf（代录人账号，仅登记不做 FK 校验）、
 * period（会计期间 YYYY-MM）。
 * 销售/采购订单已有 sourceChannel；同补四字段。
 */
export default defineMigration({
  name: '202611130011_source_fields',
  transaction: true,
  async up({ builder }) {
    const columns = [
      ['sourceRef', (c: any) => c.string('sourceRef', { length: 200, nullable: true })],
      ['sourceDoc', (c: any) => c.string('sourceDoc', { length: 200, nullable: true })],
      ['onBehalfOf', (c: any) => c.string('onBehalfOf', { length: 36, nullable: true })],
      ['period', (c: any) => c.string('period', { length: 7, nullable: true })],
    ] as const;
    for (const collection of ['purchaseRequests', 'purchaseOrders', 'salesOrders']) {
      await builder.alterCollection(collection, (c: any) => {
        for (const [, add] of columns) add(c);
      });
    }
  },
  async down({ builder }) {
    for (const collection of ['purchaseRequests', 'purchaseOrders', 'salesOrders']) {
      await builder.alterCollection(collection, (c: any) => {
        c.dropField('period');
        c.dropField('onBehalfOf');
        c.dropField('sourceDoc');
        c.dropField('sourceRef');
      });
    }
  },
});
