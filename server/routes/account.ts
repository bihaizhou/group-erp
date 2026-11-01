import { z } from 'zod';
import type { Application } from '@nocobase/app-server/application';
import {
  authenticationToken,
  type AuthEnv,
} from '@nocobase/app-plugin-authentication';
import { databaseManagerToken } from '@nocobase/db';
import {
  dataResponse,
  defineApiRoutes,
  describeRoute,
  type AppApiRouteContribution,
} from '@nocobase/app-server/router';
import { Hono } from 'hono';

const context = z.object({
  employeeId: z.string().nullable(),
  defaultCompanyId: z.string().nullable(),
});

/**
 * Resolves the signed-in account's home company from the employee record.
 * It is deliberately self-scoped: no page permission is needed to know which
 * company you belong to, and no other account's data is exposed.
 */
export const accountRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const auth = app.container.resolve(authenticationToken);
    const db = app.container.resolve(databaseManagerToken);
    const router = new Hono<AuthEnv>();
    router.use('*', auth.required());
    router.get(
      '/context',
      describeRoute({
        tags: ['Account'],
        summary: 'Read the signed-in account context',
        operationId: 'getAccountContext',
        responses: { '200': dataResponse(context) },
      }),
      async (c) => {
        const user = c.get('auth')!.user;
        const employee = await db.repository('personnelEmployees').findOne({
          filter: { accountId: user.id },
        });
        const subjectId =
          typeof employee?.subjectId === 'string' ? employee.subjectId : null;
        let defaultCompanyId: string | null = null;
        if (subjectId) {
          const company = await db.repository('orgSubjects').findOne({
            filter: { id: subjectId, type: 'company', status: 'active' },
          });
          if (company) defaultCompanyId = subjectId;
        }
        return c.json({
          data: {
            employeeId:
              employee && typeof employee.id === 'string' ? employee.id : null,
            defaultCompanyId,
          },
        });
      },
    );
    const root = new Hono();
    root.route('/account', router);
    return root;
  });
