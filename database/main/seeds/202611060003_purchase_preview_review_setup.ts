import { randomUUID } from 'node:crypto';
import { defineSeed, type SeedContext } from '@nocobase/db';

async function addEmployment(
  context: SeedContext,
  input: { email: string; companyCode: string; positionCode: string; code: string },
) {
  const { query, repository } = context;
  const user = await query
      .selectFrom('user')
      .select('id')
      .where('email', '=', input.email)
      .executeTakeFirst(),
    employee = user
      ? await repository('personnelEmployees').findOne({
          filter: { accountId: String(user.id) },
        })
      : undefined,
    company = await repository('orgSubjects').findOne({
      filter: { code: input.companyCode },
    }),
    position = await repository('orgPositions').findOne({
      filter: { code: input.positionCode },
    });
  if (!employee || !company || !position) return;
  const subjectId = String(company.id),
    personId = String(employee.id),
    positionId = String(position.id);
  if (
    !(await repository('personnelEmployments').findOne({
      filter: { personId, subjectId, status: 'active' },
    }))
  )
    await repository('personnelEmployments').createOne({
      values: {
        id: randomUUID(),
        code: `PM2-PREVIEW-EMP-${input.code}`,
        name: '预览审核任职',
        status: 'active',
        revision: 1,
        lifecycleVersion: 0,
        createdBy: 'pm2-preview-seed',
        data: { type: 'employee', startDate: '2020-01-01', endDate: null },
        subjectId,
        personId,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
  if (
    !(await repository('personnelAssignments').findOne({
      filter: { personId, subjectId, status: 'active' },
    }))
  )
    await repository('personnelAssignments').createOne({
      values: {
        id: randomUUID(),
        code: `PM2-PREVIEW-ASN-${input.code}`,
        name: '预览审核岗位',
        status: 'active',
        revision: 1,
        lifecycleVersion: 0,
        createdBy: 'pm2-preview-seed',
        data: { type: 'partTime', startDate: '2020-01-01', endDate: null },
        subjectId,
        personId,
        positionId,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
}

async function assignRole(context: SeedContext, email: string, role: string) {
  const { query } = context;
  const user = await query
    .selectFrom('user')
    .select('id')
    .where('email', '=', email)
    .executeTakeFirst();
  if (!user) return;
  const userId = String(user.id);
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

export default defineSeed({
  name: '202611060003_purchase_preview_review_setup',
  transaction: false,
  async run(context) {
    await addEmployment(context, {
      email: 'buyer@demo.example',
      companyCode: 'PM2-DEMO-GROUP',
      positionCode: 'PM2-DEMO-GROUP-BUYER',
      code: 'BUYER-GROUP',
    });
    await addEmployment(context, {
      email: 'group@demo.example',
      companyCode: 'PM2-DEMO',
      positionCode: 'PM2-DEMO-BUYER',
      code: 'GROUP-BUYER',
    });
    await assignRole(
      context,
      'group@demo.example',
      'procurement-review-configurator',
    );
  },
});
