import { defineMigration } from '@nocobase/db';

/**
 * 运营目标保存留痕 + 问题负责人职位引用：
 * - opsKpiTargetHistory 记录 opsKpiTargets 每次目标值写入（新建/覆盖）的
 *   前后快照，修复"覆盖式保存无审批无历史"的审计问题；写入由
 *   operations-service.saveTarget 在目标更新同一事务内完成。
 * - opsIssues 补 ownerId 引用 orgPositions（organization.md 要求责任人员以
 *   职位 id 引用，ownerName 仅作展示与历史兜底）；ownerId 不建 DB 外键：
 *   在 operations-service 层做 assertOwner 校验（职位存在 + status='active'
 *   且经 orgUnits 归属问题所在公司），与 hse-service 对 hseIncidents.ownerId
 *   的服务端校验模式一致（alterCollection 内无加 FK 先例）。
 */
export default defineMigration({
  name: '202611130010_operations_target_history',
  transaction: true,
  async up({ builder }) {
    await builder.createCollection('opsKpiTargetHistory', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('targetId', { length: 36, nullable: false });
      c.string('subjectId', { length: 36, nullable: false });
      c.string('period', { length: 7, nullable: false });
      c.string('metric', { length: 32, nullable: false });
      c.json('beforeValue', { nullable: true });
      c.json('afterValue', { nullable: false });
      c.integer('version', { nullable: false });
      c.string('actorId', { length: 200, nullable: false });
      c.datetimeTz('createdAt', { nullable: false });
      c.index(['targetId', 'createdAt']);
      c.index(['subjectId', 'period']);
    });
    await builder.alterCollection('opsIssues', (c) => {
      c.string('ownerId', { length: 36, nullable: true });
    });
  },
  async down({ builder }) {
    await builder.alterCollection('opsIssues', (c) => {
      c.dropField('ownerId');
    });
    await builder.dropCollection('opsKpiTargetHistory');
  },
});
