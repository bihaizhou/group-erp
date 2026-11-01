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
import { isCurrentAssignment } from '../providers/position-permission-sync.js';
import { z } from 'zod';

type Env = AuthEnv & AuthorizationEnv;
const params = z.object({ id: z.string().length(36) });
const body = z.object({
  permissionSetKeys: z.array(z.string().min(1).max(64)).max(50),
});
const text = (value: unknown) => (typeof value === 'string' ? value : '');

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

function grantCount(raw: unknown): number {
  if (typeof raw !== 'string') return 0;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

/**
 * Position → permission-set configuration.
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
        const [positions, units, sets, mappings, employees, assignments] =
          await Promise.all([
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
            db
              .repository('orgPositionPermissionSets')
              .findMany({ limit: 5000 }),
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
        for (const assignment of assignments) {
          if (!isCurrentAssignment(assignment)) continue;
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
              return {
                id,
                code: text(position.code),
                name: text(position.name),
                unitName: unitNames.get(text(position.unitId)) ?? '',
                permissionSetKeys: keys.sort(),
                memberCount: membersByPosition.get(id) ?? 0,
              };
            }),
            permissionSets: sets
              .filter(
                (set) => !text(set.key).startsWith('permissionSets.builtin.'),
              )
              .map((set) => ({
                key: text(set.key),
                title: titleOf(set.title) || text(set.key),
                grantCount: grantCount(set.grants),
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
        summary: 'Replace a position permission-set mapping and sync members',
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
        const keys = [...new Set(c.req.valid('json').permissionSetKeys)];
        const position = await db
          .repository('orgPositions')
          .findOne({ filter: { id: positionId } });
        if (!position)
          throw new ApiError({
            status: 'NOT_FOUND',
            reason: 'POSITION_NOT_FOUND',
            domain: 'organization',
            message: 'Position was not found.',
          });
        const sets = await db
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

        const [
          previous,
          allEmployees,
          allMappings,
          setAssignments,
          allAssignments,
        ] = await Promise.all([
          db
            .repository('orgPositionPermissionSets')
            .findMany({ filter: { positionId }, limit: 200 }),
          db
            .repository('personnelEmployees')
            .findMany({ filter: { status: 'active' }, limit: 10000 }),
          db.repository('orgPositionPermissionSets').findMany({ limit: 10000 }),
          db
            .repository('authorizationPermissionSetAssignments')
            .findMany({ limit: 10000 }),
          db
            .repository('personnelAssignments')
            .findMany({ filter: { status: 'active' }, limit: 10000 }),
        ]);
        const before = previous
          .map((row) => text(row.permissionSetKey))
          .filter(Boolean);
        const nextSet = new Set(keys);
        const removed = before.filter((key) => !nextSet.has(key));
        const currentAssignments = allAssignments.filter((assignment) =>
          isCurrentAssignment(assignment),
        );
        const positionsByPerson = new Map<string, Set<string>>();
        for (const assignment of currentAssignments) {
          const personId = text(assignment.personId);
          const id = text(assignment.positionId);
          if (!personId || !id) continue;
          const positions =
            positionsByPerson.get(personId) ?? new Set<string>();
          positions.add(id);
          positionsByPerson.set(personId, positions);
        }
        const memberPersonIds = new Set(
          currentAssignments
            .filter((assignment) => text(assignment.positionId) === positionId)
            .map((assignment) => text(assignment.personId))
            .filter(Boolean),
        );
        const employees = allEmployees.filter((employee) =>
          memberPersonIds.has(text(employee.id)),
        );
        const positionsByAccount = new Map<string, Set<string>>();
        for (const employee of allEmployees) {
          const accountId = text(employee.accountId);
          if (!accountId) continue;
          const positions =
            positionsByAccount.get(accountId) ?? new Set<string>();
          for (const id of positionsByPerson.get(text(employee.id)) ?? [])
            positions.add(id);
          positionsByAccount.set(accountId, positions);
        }
        const keysAtPosition = new Map<string, Set<string>>();
        for (const mapping of allMappings) {
          const id = text(mapping.positionId);
          const keysAt = keysAtPosition.get(id) ?? new Set<string>();
          keysAt.add(text(mapping.permissionSetKey));
          keysAtPosition.set(id, keysAt);
        }
        const assigned = new Set(
          setAssignments.map(
            (row) =>
              `${text(row.subjectType)}:${text(row.subjectId)}:${text(row.permissionSetKey)}`,
          ),
        );
        const accounts = [
          ...new Set(
            employees
              .map((employee) => text(employee.accountId))
              .filter(Boolean),
          ),
        ];
        const now = new Date();
        let granted = 0;
        let revoked = 0;
        for (const accountId of accounts) {
          const otherPositions = [
            ...(positionsByAccount.get(accountId) ?? []),
          ].filter((id) => id !== positionId);
          const keptByOther = new Set<string>();
          for (const other of otherPositions)
            for (const key of keysAtPosition.get(other) ?? [])
              if (key !== '') keptByOther.add(key);
          for (const key of removed) {
            if (keptByOther.has(key)) continue;
            if (!assigned.has(`user:${accountId}:${key}`)) continue;
            await db
              .repository('authorizationPermissionSetAssignments')
              .deleteMany({
                filter: {
                  subjectType: 'user',
                  subjectId: accountId,
                  permissionSetKey: key,
                },
              });
            assigned.delete(`user:${accountId}:${key}`);
            revoked += 1;
          }
          for (const key of keys) {
            if (assigned.has(`user:${accountId}:${key}`)) continue;
            await db
              .repository('authorizationPermissionSetAssignments')
              .createOne({
                values: {
                  id: `user:${accountId}:${key}`,
                  subjectType: 'user',
                  subjectId: accountId,
                  permissionSetKey: key,
                  createdAt: now,
                  updatedAt: now,
                },
              });
            assigned.add(`user:${accountId}:${key}`);
            granted += 1;
          }
        }
        const mappingRepo = db.repository('orgPositionPermissionSets');
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
        return c.json({
          data: {
            positionId,
            permissionSetKeys: keys,
            members: accounts.length,
            granted,
            revoked,
          },
        });
      },
    );

    root.route('/position-permissions', router);
    return root;
  });
