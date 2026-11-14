import { defineMigration } from '@nocobase/db';

/**
 * E2/E3 事件整改闭环 + 隐患责任人：
 * - hseIncidents 补 ownerId/dueAt/rectifiedBy/rectifiedAt/verifiedBy/verifiedAt
 *   （事件五态 verified 状态需要整改验收人与整改完成时间留痕）
 * - ownerId 不建 DB 外键：在 hse-service 层做 assertOwner 校验
 *   （员工存在 + 有 status='active' 且 subjectId 匹配的任职），
 *   与组织/人事的服务端校验模式一致（alterCollection 内无加 FK 先例）。
 * - ownerId 长度 36 = 员工 id（uuid）；hseHazards.ownerId 历史列为 200
 *   （202610230001），语义相同，长度差异为存量不一致，不改旧迁移。
 */
export default defineMigration({
  name: '202611130008_hse_closure_owners',
  transaction: true,
  async up({ builder }) {
    await builder.alterCollection('hseIncidents', (c) => {
      c.string('ownerId', { length: 36, nullable: true });
      c.date('dueAt', { nullable: true });
      c.string('rectifiedBy', { length: 200, nullable: true });
      c.datetimeTz('rectifiedAt', { nullable: true });
      c.string('verifiedBy', { length: 200, nullable: true });
      c.datetimeTz('verifiedAt', { nullable: true });
    });
  },
  async down({ builder }) {
    await builder.alterCollection('hseIncidents', (c) => {
      c.dropField('ownerId');
      c.dropField('dueAt');
      c.dropField('rectifiedBy');
      c.dropField('rectifiedAt');
      c.dropField('verifiedBy');
      c.dropField('verifiedAt');
    });
  },
});
