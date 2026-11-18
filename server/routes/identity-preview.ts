import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Application } from '@nocobase/app-server/application';
import {
  authenticationToken,
  type AuthEnv,
} from '@nocobase/app-plugin-authentication';
import {
  authorizationToken,
  type AuthorizationEnv,
} from '@nocobase/app-plugin-authorization/server';
import { databaseManagerToken } from '@nocobase/db';
import {
  ApiError,
  apiErrorHandler,
  apiErrorResponses,
  apiValidator,
  dataResponse,
  defineApiRoutes,
  describeRoute,
  type AppApiRouteContribution,
} from '@nocobase/app-server/router';
import { Hono, type Context } from 'hono';
import { businessDate } from '../providers/business-date.js';
import {
  PREVIEW_COLLECTION,
  PREVIEW_TTL_MS,
  activePreviewSession,
} from '../providers/identity-preview.js';
import { isSuperAdmin } from '../providers/super-admin.js';

type Env = AuthEnv & AuthorizationEnv;

const text = (value: unknown): string =>
  typeof value === 'string' ? value : '';

const startBody = z.object({ employeeId: z.string().length(36) });

const previewSchema = z.object({
  active: z.boolean(),
  employeeId: z.string().nullable(),
  employeeName: z.string().nullable(),
  expiresAt: z.string().nullable(),
});

const employeeSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  positions: z.array(z.string()),
  units: z.array(z.string()),
});

const employeesResponse = z.object({ employees: z.array(employeeSchema) });

/** Root-only: borrowing another account's business identity is a debug tool,
 * never a permission shortcut. Every route below refuses non-root accounts. */
async function requireRoot(
  database: Parameters<typeof isSuperAdmin>[0],
  principal: { type?: string; id?: string },
): Promise<void> {
  if (!(await isSuperAdmin(database, principal)))
    throw new ApiError({
      status: 'PERMISSION_DENIED',
      reason: 'PERMISSION_DENIED',
      domain: 'identity',
      message: 'Only the super administrator may preview a staff identity.',
    });
}

async function endSessions(
  database: Parameters<typeof isSuperAdmin>[0],
  userId: string,
  now: Date,
): Promise<void> {
  await database.repository(PREVIEW_COLLECTION).updateMany({
    filter: { userId, status: 'active' },
    values: { status: 'ended', endedAt: now },
  });
}

/** Staff identity preview for the platform administrator.
 *
 * A root account already passes every authorization check, but business pages
 * still need a real employee record (employment, position, unit) behind the
 * account. Instead of creating a fake employee card, the administrator starts
 * a short-lived preview of an existing employee, which the identity resolvers
 * pick up while the session is active and unexpired.
 */
export const identityPreviewRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const db = app.container.resolve(databaseManagerToken);
    const auth = app.container.resolve(authenticationToken);
    const authz = app.container.resolve(authorizationToken);
    const timeZone =
      app.config.get<string>('people.timeZone') ?? 'Asia/Shanghai';
    const router = new Hono<Env>();
    const root = new Hono();
    router.use('*', auth.required(), authz.middleware());

    router.onError((error, c) => apiErrorHandler(error, c));

    const current = async (
      c: Context<Env>,
      userId: string,
      isRoot: boolean,
    ) => {
      if (!isRoot)
        return c.json({
          data: {
            active: false,
            employeeId: null,
            employeeName: null,
            expiresAt: null,
          },
        });
      const session = await activePreviewSession(db, userId);
      return c.json({
        data: {
          active: session !== null,
          employeeId: session?.employeeId ?? null,
          employeeName: session?.employeeName ?? null,
          expiresAt: session?.expiresAt ?? null,
        },
      });
    };

    router.get(
      '/current',
      describeRoute({
        tags: ['Identity'],
        summary: 'Read the active staff identity preview of the account',
        operationId: 'getIdentityPreview',
        responses: {
          '200': dataResponse(previewSchema),
          ...apiErrorResponses,
        },
      }),
      async (c) => {
        const user = c.get('auth')!.user;
        const isRoot = await isSuperAdmin(db, user);
        return current(c, user.id, isRoot);
      },
    );

    router.get(
      '/employees',
      describeRoute({
        tags: ['Identity'],
        summary: 'List employees available for an identity preview',
        operationId: 'listIdentityPreviewEmployees',
        responses: {
          '200': dataResponse(employeesResponse),
          ...apiErrorResponses,
        },
      }),
      async (c) => {
        const user = c.get('auth')!.user;
        await requireRoot(db, user);
        const [employees, assignments, positions, units] = await Promise.all([
          db.repository('personnelEmployees').findMany({
            filter: { status: 'active' },
            limit: 500,
            sort: (sort) => sort.field('name').asc(),
          }),
          db
            .repository('personnelAssignments')
            .findMany({ filter: { status: 'active' }, limit: 5000 }),
          db.repository('orgPositions').findMany({ limit: 2000 }),
          db.repository('orgUnits').findMany({ limit: 2000 }),
        ]);
        const today = businessDate(timeZone);
        const positionById = new Map(
          positions.map((row) => [text(row.id), row]),
        );
        const unitName = new Map(
          units.map((row) => [text(row.id), text(row.name)]),
        );
        const positionsByPerson = new Map<string, string[]>();
        const unitsByPerson = new Map<string, string[]>();
        for (const assignment of assignments) {
          const data = assignment.data as {
            startDate?: string;
            endDate?: string | null;
          } | null;
          const start = text(data?.startDate);
          const end = text(data?.endDate);
          if (start && start > today) continue;
          if (end && end <= today) continue;
          const personId = text(assignment.personId);
          const position = positionById.get(text(assignment.positionId));
          if (!personId || !position) continue;
          const list = positionsByPerson.get(personId) ?? [];
          list.push(text(position.name));
          positionsByPerson.set(personId, list);
          const unit = unitName.get(text(position.unitId));
          if (unit) {
            const unitList = unitsByPerson.get(personId) ?? [];
            unitList.push(unit);
            unitsByPerson.set(personId, unitList);
          }
        }
        return c.json({
          data: {
            employees: employees.map((employee) => {
              const id = text(employee.id);
              return {
                id,
                code: text(employee.code),
                name: text(employee.name),
                positions: [...new Set(positionsByPerson.get(id) ?? [])],
                units: [...new Set(unitsByPerson.get(id) ?? [])],
              };
            }),
          },
        });
      },
    );

    router.post(
      '/',
      describeRoute({
        tags: ['Identity'],
        summary: 'Start previewing one employee',
        operationId: 'startIdentityPreview',
        responses: {
          '200': dataResponse(previewSchema),
          ...apiErrorResponses,
        },
      }),
      apiValidator('json', startBody),
      async (c) => {
        const user = c.get('auth')!.user;
        await requireRoot(db, user);
        const { employeeId } = c.req.valid('json');
        const employee = await db
          .repository('personnelEmployees')
          .findOne({ filter: { id: employeeId, status: 'active' } });
        if (!employee)
          throw new ApiError({
            status: 'NOT_FOUND',
            reason: 'EMPLOYEE_NOT_FOUND',
            domain: 'identity',
            message: 'The employee does not exist or is not active.',
          });
        const now = new Date();
        await endSessions(db, user.id, now);
        const expiresAt = new Date(now.getTime() + PREVIEW_TTL_MS);
        await db.repository(PREVIEW_COLLECTION).createOne({
          values: {
            id: randomUUID(),
            userId: user.id,
            employeeId,
            employeeName: text(employee.name),
            status: 'active',
            startedAt: now,
            expiresAt,
          },
        });
        return c.json({
          data: {
            active: true,
            employeeId,
            employeeName: text(employee.name),
            expiresAt: expiresAt.toISOString(),
          },
        });
      },
    );

    router.delete(
      '/',
      describeRoute({
        tags: ['Identity'],
        summary: 'End the active staff identity preview',
        operationId: 'stopIdentityPreview',
        responses: {
          '200': dataResponse(previewSchema),
          ...apiErrorResponses,
        },
      }),
      async (c) => {
        const user = c.get('auth')!.user;
        await endSessions(db, user.id, new Date());
        return c.json({
          data: {
            active: false,
            employeeId: null,
            employeeName: null,
            expiresAt: null,
          },
        });
      },
    );

    root.route('/identity-preview', router);
    return root;
  });
