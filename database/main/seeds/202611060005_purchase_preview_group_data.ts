import { randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { defineSeed, type SeedContext } from '@nocobase/db';

const groupEmail = 'group@demo.local';
const password = 'Demo1234!';

async function ensureEmployment(
  context: SeedContext,
  input: {
    personId: string;
    subjectId: string;
    positionId: string;
    code: string;
    createdBy: string;
  },
) {
  const { repository } = context,
    employment = await repository('personnelEmployments').findOne({
      filter: {
        personId: input.personId,
        subjectId: input.subjectId,
        status: 'active',
      },
    });
  if (!employment)
    await repository('personnelEmployments').createOne({
      values: {
        id: randomUUID(),
        code: `PM2-GROUP-EMP-${input.code}`,
        name: '演示集团采购',
        status: 'active',
        revision: 1,
        lifecycleVersion: 0,
        createdBy: input.createdBy,
        data: { type: 'employee', startDate: '2026-01-01', endDate: null },
        subjectId: input.subjectId,
        personId: input.personId,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
  const assignment = await repository('personnelAssignments').findOne({
    filter: {
      personId: input.personId,
      subjectId: input.subjectId,
      status: 'active',
    },
  });
  if (!assignment)
    await repository('personnelAssignments').createOne({
      values: {
        id: randomUUID(),
        code: `PM2-GROUP-ASN-${input.code}`,
        name: '演示集团采购',
        status: 'active',
        revision: 1,
        lifecycleVersion: 0,
        createdBy: input.createdBy,
        data: { type: 'primary', startDate: '2026-01-01', endDate: null },
        subjectId: input.subjectId,
        personId: input.personId,
        positionId: input.positionId,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
}

async function assignRole(
  context: SeedContext,
  userId: string,
  role: string,
) {
  const { query } = context;
  if (
    await query
      .selectFrom('authorizationPermissionSetAssignments')
      .select('id')
      .where('permissionSetKey', '=', role)
      .where('subjectType', '=', 'user')
      .where('subjectId', '=', userId)
      .executeTakeFirst()
  )
    return;
  await query
    .insertInto('authorizationPermissionSetAssignments')
    .values({
      id: randomUUID(),
      subjectType: 'user',
      subjectId: userId,
      permissionSetKey: role,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .execute();
}

async function ensurePosition(
  context: SeedContext,
  input: { code: string; name: string; unitId: string },
) {
  const { repository } = context;
  let position = await repository('orgPositions').findOne({
    filter: { code: input.code },
  });
  if (!position) {
    const id = randomUUID();
    await repository('orgPositions').createOne({
      values: {
        id,
        code: input.code,
        name: input.name,
        unitId: input.unitId,
        status: 'active',
        sortOrder: 0,
        revision: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    position = { id };
  }
  return String(position.id);
}

async function ensureUnit(
  context: SeedContext,
  input: { code: string; name: string; subjectId: string },
) {
  const { repository } = context;
  let unit = await repository('orgUnits').findOne({
    filter: { code: input.code },
  });
  if (!unit) {
    const id = randomUUID();
    await repository('orgUnits').createOne({
      values: {
        id,
        code: input.code,
        name: input.name,
        type: 'department',
        subjectId: input.subjectId,
        status: 'active',
        sortOrder: 0,
        revision: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    unit = { id };
  }
  return String(unit.id);
}

export default defineSeed({
  name: '202611060005_purchase_preview_group_data',
  transaction: false,
  async run(context) {
    const { query, repository } = context,
      testco = await repository('orgSubjects').findOne({
        filter: { code: 'TESTCO' },
      }),
      testco2 = await repository('orgSubjects').findOne({
        filter: { code: 'TESTCO2' },
      }),
      buyerUser = await query
        .selectFrom('user')
        .select('id')
        .where('email', '=', 'buyer@demo.local')
        .executeTakeFirst();
    if (!testco || !testco2 || !buyerUser) return;
    const testcoId = String(testco.id),
      testco2Id = String(testco2.id),
      buyerId = String(buyerUser.id),
      buyer = await repository('personnelEmployees').findOne({
        filter: { accountId: buyerId },
      });
    if (!buyer) return;
    const buyerEmployeeId = String(buyer.id);

    const buyerUnit2 = await ensureUnit(context, {
        code: 'DEMO-UNIT-PROCUREMENT-2',
        name: '采购二部',
        subjectId: testco2Id,
      }),
      buyerPosition2 = await ensurePosition(context, {
        code: 'DEMO-POS-BUYER-2',
        name: '采购员二',
        unitId: buyerUnit2,
      }),
      buyerOneUnit = await repository('orgUnits').findOne({
        filter: { code: 'DEMO-UNIT-PROCUREMENT' },
      }),
      buyerOnePosition = await repository('orgPositions').findOne({
        filter: { code: 'DEMO-POS-BUYER' },
      });
    if (!buyerOneUnit || !buyerOnePosition) return;
    await ensureEmployment(context, {
      personId: buyerEmployeeId,
      subjectId: testco2Id,
      positionId: buyerPosition2,
      code: 'BUYER-TESTCO2',
      createdBy: buyerId,
    });
    await assignRole(context, buyerId, 'procurement-source-requester');

    const reviewerOneUnit = String(buyerOneUnit.id),
      reviewerOnePosition = await ensurePosition(context, {
        code: 'DEMO-POS-GROUP-REVIEWER',
        name: '集团采购审核',
        unitId: reviewerOneUnit,
      }),
      reviewerTwoPosition = await ensurePosition(context, {
        code: 'DEMO-POS-GROUP-REVIEWER-2',
        name: '集团采购审核二',
        unitId: buyerUnit2,
      });

    let groupUser = await query
      .selectFrom('user')
      .select('id')
      .where('email', '=', groupEmail)
      .executeTakeFirst();
    let groupId = groupUser ? String(groupUser.id) : randomUUID();
    const passwordHash = await hashPassword(password);
    if (!groupUser) {
      await query
        .insertInto('user')
        .values({
          id: groupId,
          name: '演示集团采购',
          username: 'demogroup',
          email: groupEmail,
          email_verified: 1,
          kind: 'person',
          created_at: new Date(),
          updated_at: new Date(),
        })
        .execute();
      await query
        .insertInto('account')
        .values({
          id: randomUUID(),
          account_id: groupId,
          provider_id: 'credential',
          user_id: groupId,
          password: passwordHash,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .execute();
    } else {
      await query
        .updateTable('account')
        .set({ password: passwordHash, updated_at: new Date() })
        .where('user_id', '=', groupId)
        .where('provider_id', '=', 'credential')
        .execute();
    }

    let groupEmployee = await repository('personnelEmployees').findOne({
      filter: { accountId: groupId },
    });
    let groupEmployeeId = groupEmployee ? String(groupEmployee.id) : randomUUID();
    if (!groupEmployee) {
      await repository('personnelEmployees').createOne({
        values: {
          id: groupEmployeeId,
          code: 'PM2-GROUP-EMPLOYEE',
          name: '演示集团采购',
          status: 'active',
          revision: 1,
          lifecycleVersion: 0,
          createdBy: buyerId,
          data: { accountId: groupId },
          subjectId: testcoId,
          accountId: groupId,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    await ensureEmployment(context, {
      personId: groupEmployeeId,
      subjectId: testcoId,
      positionId: reviewerOnePosition,
      code: 'GROUP-TESTCO',
      createdBy: buyerId,
    });
    await ensureEmployment(context, {
      personId: groupEmployeeId,
      subjectId: testco2Id,
      positionId: reviewerTwoPosition,
      code: 'GROUP-TESTCO2',
      createdBy: buyerId,
    });
    for (const role of [
      'procurement-group-purchaser',
      'procurement-review-configurator',
    ])
      await assignRole(context, groupId, role);
  },
});
