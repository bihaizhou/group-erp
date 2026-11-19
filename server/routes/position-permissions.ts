import { randomUUID } from 'node:crypto';
import type { Application } from '@nocobase/app-server/application';
import {
  authenticationToken,
  type AuthEnv,
} from '@nocobase/app-plugin-authentication';
import {
  authorizationToken,
  type AuthorizationEnv,
} from '@nocobase/app-plugin-authorization/server';
import { databaseManagerToken, type DatabaseConnection } from '@nocobase/db';
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
import { lockOrgMutation } from '../providers/organization-service.js';
import {
  isCurrentAssignment,
  syncAccountPositionPermissions,
} from '../providers/position-permission-sync.js';
import { z } from 'zod';

type Env = AuthEnv & AuthorizationEnv;
const params = z.object({ id: z.string().length(36) });
/** Built-in sets stored under bare keys; never assign them through positions. */
const BUILTIN_SET_KEYS = new Set(['root', 'member']);
const body = z.object({
  permissionSetKeys: z.array(z.string().min(1).max(64)).max(50),
  // Saving the template and the explicit sets together keeps one form, one
  // save and one transaction; separate calls leave a half-applied permission
  // state when the second request fails.
  templateId: z.string().length(36).nullable().optional(),
});
const templateBody = z.object({
  code: z.string().min(2).max(64),
  name: z.string().min(1).max(200),
  permissionSetKeys: z.array(z.string().min(1).max(64)).max(50),
  notes: z.string().max(2000).optional(),
});
const templateUpdate = z.object({
  name: z.string().min(1).max(200).optional(),
  permissionSetKeys: z.array(z.string().min(1).max(64)).max(50).optional(),
  notes: z.string().max(2000).optional(),
});
const templateLink = z.object({ templateId: z.string().length(36).nullable() });
const text = (value: unknown) => (typeof value === 'string' ? value : '');

function keyList(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(text).filter(Boolean);
  if (typeof raw !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(text).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function titleOf(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'string') return parsed;
    if (parsed && typeof parsed === 'object' && 'key' in parsed)
      return String(parsed.key);
  } catch {
    /* plain text */
  }
  return raw;
}

function grantSummary(raw: unknown): {
  pageCount: number;
  actionCount: number;
  grantCount: number;
} {
  // The repository may return JSON columns already parsed, or still as text
  // (raw SQL). Summarize either shape instead of reporting 0 grants for every
  // set. A set's reach is much easier to judge as "pages + actions" than as a
  // raw count of resource rows.
  let grants: unknown = raw;
  if (typeof raw === 'string') {
    try {
      grants = JSON.parse(raw);
    } catch {
      grants = [];
    }
  }
  if (!Array.isArray(grants))
    return { pageCount: 0, actionCount: 0, grantCount: 0 };
  const pages = new Set<string>();
  let actionCount = 0;
  for (const row of grants as unknown[]) {
    if (!row || typeof row !== 'object') continue;
    const grant = row as Record<string, unknown>;
    const resource = grant.resource;
    const record =
      resource && typeof resource === 'object'
        ? (resource as Record<string, unknown>)
        : undefined;
    const resourceType = text(record?.type);
    const resourceId = text(record?.id);
    if (resourceType === 'page' && resourceId) pages.add(resourceId);
    const actions = grant.actions;
    if (!Array.isArray(actions)) continue;
    for (const item of actions as unknown[]) {
      if (!item || typeof item !== 'object') continue;
      const action = item as Record<string, unknown>;
      // Page access is already reflected by pageCount; counting it again would
      // make a read-only page set look like it grants many operations.
      if (resourceType === 'page' && text(action.action) === 'access') continue;
      actionCount += 1;
    }
  }
  // Keep the raw count for callers built before the page/action summary.
  return { pageCount: pages.size, actionCount, grantCount: grants.length };
}

async function accountsAtPosition(
  connection: DatabaseConnection,
  positionId: string,
  timeZone: string,
): Promise<string[]> {
  const [employees, assignments] = await Promise.all([
    connection
      .repository('personnelEmployees')
      .findMany({ filter: { status: 'active' }, limit: 10000 }),
    connection
      .repository('personnelAssignments')
      .findMany({ filter: { status: 'active' }, limit: 10000 }),
  ]);
  const today = businessDate(timeZone);
  const personIds = new Set(
    assignments
      .filter((assignment) => text(assignment.positionId) === positionId)
      .filter((assignment) => isCurrentAssignment(assignment, today))
      .map((assignment) => text(assignment.personId))
      .filter(Boolean),
  );
  return [
    ...new Set(
      employees
        .filter((employee) => personIds.has(text(employee.id)))
        .map((employee) => text(employee.accountId))
        .filter(Boolean),
    ),
  ];
}

/** Position mappings may only reference existing, non-system permission sets. */
async function validateSetKeys(
  connection: DatabaseConnection,
  keys: readonly string[],
): Promise<void> {
  if (keys.length === 0) return;
  const sets = await connection
    .repository('authorizationPermissionSets')
    .findMany({ limit: 500 });
  const known = new Set(sets.map((set) => text(set.key)));
  if (keys.some((key) => !known.has(key)))
    throw new ApiError({
      status: 'INVALID_ARGUMENT',
      reason: 'PERMISSION_SET_NOT_FOUND',
      domain: 'authorization',
      message: 'One of the permission sets does not exist.',
    });
  const reserved = new Set(
    sets
      .filter(
        (set) =>
          BUILTIN_SET_KEYS.has(text(set.key)) ||
          text(set.key).startsWith('permissionSets.builtin.'),
      )
      .map((set) => text(set.key)),
  );
  if (keys.some((key) => reserved.has(key)))
    throw new ApiError({
      status: 'INVALID_ARGUMENT',
      reason: 'PERMISSION_SET_RESERVED',
      domain: 'authorization',
      message: 'System permission sets cannot be mapped to positions.',
    });
}

/** Position → permission-set configuration.
 *
 * Permission sets stay the single authorization unit. This endpoint only maps
 * a position to existing sets and reconciles the membership rows of the
 * employees currently holding that position. It deliberately does not create a
 * second permission engine.
 */
export const positionPermissionRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const db = app.container.resolve(databaseManagerToken);
    const auth = app.container.resolve(authenticationToken);
    const authz = app.container.resolve(authorizationToken);
    // Civil business dates follow the configured people timezone, not the
    // server's OS timezone (see ERP_PEOPLE_TIME_ZONE).
    const timeZone =
      app.config.get<string>('people.timeZone') ?? 'Asia/Shanghai';
    const router = new Hono<Env>();
    const root = new Hono();
    router.use('*', auth.required(), authz.middleware());

    const permit = async (
      c: Context<Env>,
      action: 'read' | 'assign',
    ): Promise<void> => {
      const result = await c.get('authz').authorize({
        resource: { type: 'settings', id: 'authorization.permission-sets' },
        action,
      });
      if (result.effect === 'deny')
        throw new ApiError({
          status: 'PERMISSION_DENIED',
          reason: 'PERMISSION_DENIED',
          domain: 'authorization',
          message: 'Permission set administration is required.',
        });
    };

    router.onError((error, c) => apiErrorHandler(error, c));

    router.get(
      '/',
      describeRoute({
        tags: ['Authorization'],
        summary: 'Read positions, their permission sets and members',
        operationId: 'listPositionPermissions',
        responses: {
          '200': dataResponse(z.record(z.string(), z.json())),
          ...apiErrorResponses,
        },
      }),
      async (c) => {
        await permit(c, 'read');
        const [
          positions,
          units,
          sets,
          templates,
          mappings,
          employees,
          assignments,
        ] = await Promise.all([
          db.repository('orgPositions').findMany({
            filter: { status: 'active' },
            limit: 500,
            sort: (sort) => [
              sort.field('sortOrder').asc(),
              sort.field('name').asc(),
            ],
          }),
          db.repository('orgUnits').findMany({ limit: 2000 }),
          db.repository('authorizationPermissionSets').findMany({
            limit: 500,
            sort: (sort) => sort.field('key').asc(),
          }),
          db.repository('orgPositionTemplates').findMany({
            filter: { status: 'active' },
            limit: 200,
            sort: (sort) => [
              sort.field('sortOrder').asc(),
              sort.field('name').asc(),
            ],
          }),
          db.repository('orgPositionPermissionSets').findMany({ limit: 5000 }),
          db
            .repository('personnelEmployees')
            .findMany({ filter: { status: 'active' }, limit: 10000 }),
          db.repository('personnelAssignments').findMany({
            filter: { status: 'active' },
            limit: 10000,
          }),
        ]);
        const unitNames = new Map(
          units.map((unit) => [text(unit.id), text(unit.name)]),
        );
        const templateNames = new Map(
          templates.map((template) => [text(template.id), text(template.name)]),
        );
        const templateKeys = new Map(
          templates.map((template) => [
            text(template.id),
            keyList(template.permissionSetKeys).sort(),
          ]),
        );
        const positionsByTemplate = new Map<string, number>();
        for (const position of positions) {
          const templateId = text(position.templateId);
          if (!templateId) continue;
          positionsByTemplate.set(
            templateId,
            (positionsByTemplate.get(templateId) ?? 0) + 1,
          );
        }
        const keysByPosition = new Map<string, string[]>();
        for (const mapping of mappings) {
          const positionId = text(mapping.positionId);
          const key = text(mapping.permissionSetKey);
          keysByPosition.set(positionId, [
            ...(keysByPosition.get(positionId) ?? []),
            key,
          ]);
        }
        const positionsByPerson = new Map<string, Set<string>>();
        const today = businessDate(timeZone);
        for (const assignment of assignments) {
          if (!isCurrentAssignment(assignment, today)) continue;
          const personId = text(assignment.personId);
          const positionId = text(assignment.positionId);
          if (!personId || !positionId) continue;
          const held = positionsByPerson.get(personId) ?? new Set<string>();
          held.add(positionId);
          positionsByPerson.set(personId, held);
        }
        const membersByPosition = new Map<string, number>();
        for (const employee of employees) {
          for (const positionId of positionsByPerson.get(text(employee.id)) ??
            []) {
            membersByPosition.set(
              positionId,
              (membersByPosition.get(positionId) ?? 0) + 1,
            );
          }
        }
        return c.json({
          data: {
            positions: positions.map((position) => {
              const id = text(position.id);
              const keys = keysByPosition.get(id) ?? [];
              const templateId = text(position.templateId);
              return {
                id,
                code: text(position.code),
                name: text(position.name),
                unitName: unitNames.get(text(position.unitId)) ?? '',
                permissionSetKeys: keys.sort(),
                templateId,
                templateName: templateNames.get(templateId) ?? '',
                templateKeys: templateKeys.get(templateId) ?? [],
                memberCount: membersByPosition.get(id) ?? 0,
              };
            }),
            templates: templates.map((template) => {
              const id = text(template.id);
              return {
                id,
                code: text(template.code),
                name: text(template.name),
                permissionSetKeys: templateKeys.get(id) ?? [],
                positionCount: positionsByTemplate.get(id) ?? 0,
              };
            }),
            permissionSets: sets
              .filter(
                (set) =>
                  !BUILTIN_SET_KEYS.has(text(set.key)) &&
                  !text(set.key).startsWith('permissionSets.builtin.'),
              )
              .map((set) => ({
                key: text(set.key),
                title: titleOf(set.title) || text(set.key),
                ...grantSummary(set.grants),
              }))
              .filter((set) => set.key && set.key !== 'root'),
          },
        });
      },
    );

    router.put(
      '/:id',
      describeRoute({
        tags: ['Authorization'],
        summary:
          'Replace a position permission-set mapping and template, sync members',
        operationId: 'savePositionPermissions',
        responses: {
          '200': dataResponse(z.record(z.string(), z.json())),
          ...apiErrorResponses,
        },
      }),
      apiValidator('param', params),
      apiValidator('json', body),
      async (c) => {
        await permit(c, 'assign');
        const positionId = c.req.valid('param').id;
        const input = c.req.valid('json');
        const keys = [...new Set(input.permissionSetKeys)];
        const requestedTemplateId = input.templateId;
        // Mapping writes run in one transaction and serialize on the shared
        // organization mutation lock, exactly like organization topology
        // changes, so concurrent saves and position deactivations cannot race.
        const result = await db.transaction(async (connection) => {
          await lockOrgMutation(connection);
          const position = await connection
            .repository('orgPositions')
            .findOne({ filter: { id: positionId } });
          if (!position)
            throw new ApiError({
              status: 'NOT_FOUND',
              reason: 'POSITION_NOT_FOUND',
              domain: 'organization',
              message: 'Position was not found.',
            });
          if (text(position.status) !== 'active')
            throw new ApiError({
              status: 'FAILED_PRECONDITION',
              reason: 'ORG_POSITION_NOT_ACTIVE',
              domain: 'organization',
              message: 'Position is not active.',
            });
          // Position mapping only ever grants business permission sets:
          // root/builtin sets are managed by the system and must not be
          // assigned through this endpoint (GET never lists them either).
          await validateSetKeys(connection, keys);

          // Capture what this position granted before the save so a key that
          // disappears (for example when a template is unlinked) is revoked
          // from its holders instead of lingering as an orphan assignment.
          const previousTemplateId = text(position.templateId) || null;
          const [previousMappings, previousTemplate] = await Promise.all([
            connection
              .repository('orgPositionPermissionSets')
              .findMany({ filter: { positionId }, limit: 200 }),
            previousTemplateId
              ? connection
                  .repository('orgPositionTemplates')
                  .findOne({ filter: { id: previousTemplateId } })
              : Promise.resolve(undefined),
          ]);
          const previousKeys = new Set([
            ...previousMappings.map((row) => text(row.permissionSetKey)),
            ...keyList(previousTemplate?.permissionSetKeys),
          ]);

          // Template and explicit mappings are one editable unit. The UI
          // stages both and saves them together so a template change and a
          // checkbox change cannot land in two half-applied requests.
          let templateId = previousTemplateId;
          if (
            requestedTemplateId !== undefined &&
            requestedTemplateId !== templateId
          ) {
            if (requestedTemplateId !== null) {
              const template = await connection
                .repository('orgPositionTemplates')
                .findOne({ filter: { id: requestedTemplateId } });
              if (!template || text(template.status) !== 'active')
                throw new ApiError({
                  status: 'NOT_FOUND',
                  reason: 'POSITION_TEMPLATE_NOT_FOUND',
                  domain: 'organization',
                  message: 'Position template was not found.',
                });
            }
            templateId = requestedTemplateId;
            // Bumping the revision makes a stale organization form fail
            // instead of silently overwriting the template link.
            await connection.repository('orgPositions').updateOne({
              filter: { id: positionId },
              values: {
                templateId,
                revision: Number(position.revision ?? 1) + 1,
                updatedAt: new Date(),
              },
            });
          }

          const now = new Date();
          const mappingRepo = connection.repository(
            'orgPositionPermissionSets',
          );
          await mappingRepo.deleteMany({ filter: { positionId } });
          for (const key of keys)
            await mappingRepo.createOne({
              values: {
                id: randomUUID(),
                positionId,
                permissionSetKey: key,
                createdAt: now,
                updatedAt: now,
              },
            });

          // Reconcile each holder from the saved state. The shared sync helper
          // also knows about the template, other positions and manual grants,
          // so an explicit key still inherited elsewhere is not revoked.
          const accounts = await accountsAtPosition(
            connection,
            positionId,
            timeZone,
          );
          let granted = 0;
          let revoked = 0;
          for (const accountId of accounts) {
            const synced = await syncAccountPositionPermissions(
              connection,
              accountId,
              timeZone,
              previousKeys,
            );
            granted += synced.granted;
            revoked += synced.revoked;
          }
          return {
            positionId,
            permissionSetKeys: keys,
            templateId,
            members: accounts.length,
            granted,
            revoked,
          };
        });
        return c.json({ data: result });
      },
    );

    router.put(
      '/:id/template',
      describeRoute({
        tags: ['Authorization'],
        summary: 'Link a position to a template and sync its members',
        operationId: 'savePositionTemplate',
        responses: {
          '200': dataResponse(z.record(z.string(), z.json())),
          ...apiErrorResponses,
        },
      }),
      apiValidator('param', params),
      apiValidator('json', templateLink),
      async (c) => {
        await permit(c, 'assign');
        const positionId = c.req.valid('param').id;
        const templateId = c.req.valid('json').templateId;
        const result = await db.transaction(async (connection) => {
          await lockOrgMutation(connection);
          const position = await connection
            .repository('orgPositions')
            .findOne({ filter: { id: positionId } });
          if (!position)
            throw new ApiError({
              status: 'NOT_FOUND',
              reason: 'POSITION_NOT_FOUND',
              domain: 'organization',
              message: 'Position was not found.',
            });
          if (text(position.status) !== 'active')
            throw new ApiError({
              status: 'FAILED_PRECONDITION',
              reason: 'ORG_POSITION_NOT_ACTIVE',
              domain: 'organization',
              message: 'Position is not active.',
            });
          if (templateId !== null) {
            const template = await connection
              .repository('orgPositionTemplates')
              .findOne({ filter: { id: templateId } });
            if (!template)
              throw new ApiError({
                status: 'NOT_FOUND',
                reason: 'POSITION_TEMPLATE_NOT_FOUND',
                domain: 'organization',
                message: 'Position template was not found.',
              });
          }
          // Keys granted by the old template must be revoked when the link is
          // removed; otherwise they stay assigned with no position behind them.
          const previousTemplateId = text(position.templateId);
          const previousTemplate = previousTemplateId
            ? await connection
                .repository('orgPositionTemplates')
                .findOne({ filter: { id: previousTemplateId } })
            : undefined;
          const previousTemplateKeys = keyList(
            previousTemplate?.permissionSetKeys,
          );
          // Bumping the revision makes a stale organization form fail instead
          // of silently overwriting the template link.
          await connection.repository('orgPositions').updateOne({
            filter: { id: positionId },
            values: {
              templateId,
              revision: Number(position.revision ?? 1) + 1,
              updatedAt: new Date(),
            },
          });
          const accounts = await accountsAtPosition(
            connection,
            positionId,
            timeZone,
          );
          let granted = 0;
          let revoked = 0;
          for (const accountId of accounts) {
            const synced = await syncAccountPositionPermissions(
              connection,
              accountId,
              timeZone,
              previousTemplateKeys,
            );
            granted += synced.granted;
            revoked += synced.revoked;
          }
          return {
            positionId,
            templateId,
            members: accounts.length,
            granted,
            revoked,
          };
        });
        return c.json({ data: result });
      },
    );

    router.post(
      '/templates',
      describeRoute({
        tags: ['Authorization'],
        summary: 'Create a position template',
        operationId: 'createPositionTemplate',
        responses: {
          '200': dataResponse(z.record(z.string(), z.json())),
          ...apiErrorResponses,
        },
      }),
      apiValidator('json', templateBody),
      async (c) => {
        await permit(c, 'assign');
        const input = c.req.valid('json');
        const code = input.code.trim().toUpperCase();
        const name = input.name.trim();
        const keys = [...new Set(input.permissionSetKeys)];
        const result = await db.transaction(async (connection) => {
          await lockOrgMutation(connection);
          const existing = await connection
            .repository('orgPositionTemplates')
            .findOne({ filter: { code } });
          if (existing)
            throw new ApiError({
              status: 'INVALID_ARGUMENT',
              reason: 'POSITION_TEMPLATE_CODE_TAKEN',
              domain: 'organization',
              message: 'A position template with this code already exists.',
            });
          await validateSetKeys(connection, keys);
          const now = new Date();
          const id = randomUUID();
          await connection.repository('orgPositionTemplates').createOne({
            values: {
              id,
              code,
              name,
              status: 'active',
              sortOrder: 0,
              permissionSetKeys: keys,
              notes: input.notes ?? null,
              revision: 1,
              createdAt: now,
              updatedAt: now,
            },
          });
          return { id, code, name, permissionSetKeys: keys };
        });
        return c.json({ data: result });
      },
    );

    router.put(
      '/templates/:id',
      describeRoute({
        tags: ['Authorization'],
        summary: 'Update a position template and sync the positions using it',
        operationId: 'savePositionTemplateKeys',
        responses: {
          '200': dataResponse(z.record(z.string(), z.json())),
          ...apiErrorResponses,
        },
      }),
      apiValidator('param', params),
      apiValidator('json', templateUpdate),
      async (c) => {
        await permit(c, 'assign');
        const id = c.req.valid('param').id;
        const input = c.req.valid('json');
        const result = await db.transaction(async (connection) => {
          await lockOrgMutation(connection);
          const template = await connection
            .repository('orgPositionTemplates')
            .findOne({ filter: { id } });
          if (!template)
            throw new ApiError({
              status: 'NOT_FOUND',
              reason: 'POSITION_TEMPLATE_NOT_FOUND',
              domain: 'organization',
              message: 'Position template was not found.',
            });
          const keys = input.permissionSetKeys
            ? [...new Set(input.permissionSetKeys)]
            : null;
          if (keys) await validateSetKeys(connection, keys);
          // A key removed from the template no longer appears in any mapping;
          // remember it so the sync below can revoke the stale assignment.
          const previousKeys = keyList(template.permissionSetKeys);
          await connection.repository('orgPositionTemplates').updateOne({
            filter: { id },
            values: {
              ...(input.name !== undefined ? { name: input.name.trim() } : {}),
              ...(keys ? { permissionSetKeys: keys } : {}),
              ...(input.notes !== undefined ? { notes: input.notes } : {}),
              revision: Number(template.revision ?? 1) + 1,
              updatedAt: new Date(),
            },
          });
          const positions = await connection
            .repository('orgPositions')
            .findMany({ filter: { templateId: id }, limit: 2000 });
          const accounts = new Set<string>();
          for (const position of positions)
            for (const accountId of await accountsAtPosition(
              connection,
              text(position.id),
              timeZone,
            ))
              accounts.add(accountId);
          let granted = 0;
          let revoked = 0;
          for (const accountId of accounts) {
            const synced = await syncAccountPositionPermissions(
              connection,
              accountId,
              timeZone,
              previousKeys,
            );
            granted += synced.granted;
            revoked += synced.revoked;
          }
          return {
            id,
            permissionSetKeys: keys,
            positions: positions.length,
            members: accounts.size,
            granted,
            revoked,
          };
        });
        return c.json({ data: result });
      },
    );

    router.delete(
      '/templates/:id',
      describeRoute({
        tags: ['Authorization'],
        summary: 'Delete a position template that no position uses',
        operationId: 'deletePositionTemplate',
        responses: {
          '200': dataResponse(z.record(z.string(), z.json())),
          ...apiErrorResponses,
        },
      }),
      apiValidator('param', params),
      async (c) => {
        await permit(c, 'assign');
        const id = c.req.valid('param').id;
        const result = await db.transaction(async (connection) => {
          await lockOrgMutation(connection);
          const template = await connection
            .repository('orgPositionTemplates')
            .findOne({ filter: { id } });
          if (!template)
            throw new ApiError({
              status: 'NOT_FOUND',
              reason: 'POSITION_TEMPLATE_NOT_FOUND',
              domain: 'organization',
              message: 'Position template was not found.',
            });
          const linked = await connection
            .repository('orgPositions')
            .findMany({ filter: { templateId: id }, limit: 1 });
          if (linked.length)
            throw new ApiError({
              status: 'INVALID_ARGUMENT',
              reason: 'POSITION_TEMPLATE_IN_USE',
              domain: 'organization',
              message:
                'Detach the template from every position before deleting it.',
            });
          await connection
            .repository('orgPositionTemplates')
            .deleteMany({ filter: { id } });
          return { id };
        });
        return c.json({ data: result });
      },
    );

    root.route('/position-permissions', router);
    return root;
  });
