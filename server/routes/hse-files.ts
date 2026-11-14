import type { Application } from '@nocobase/app-server/application';
import {
  authenticationToken,
  type AuthEnv,
} from '@nocobase/app-plugin-authentication';
import {
  authorizationToken,
  type AuthorizationEnv,
} from '@nocobase/app-plugin-authorization/server';
import {
  defineFileRepositoryApiRoutes,
  FILE_COLUMNS,
} from '@nocobase/app-plugin-file/server';
import { databaseManagerToken } from '@nocobase/db';
import {
  ApiError,
  apiErrorHandler,
  defineApiRoutes,
  defineRootRoutes,
} from '@nocobase/app-server/router';
import { Hono } from 'hono';
import { z } from 'zod';
import type { RepositoryPolicy } from '@nocobase/db';
import { HseError, hseServiceToken } from '../providers/hse-service.js';
import { materialIdFilter } from '../providers/material-filters.js';

type FilePrincipal = {
  ids: string[];
  create: RepositoryPolicy['create'];
};
type Env = AuthEnv &
  AuthorizationEnv & { Variables: { hseFilePrincipal: FilePrincipal } };

const parentQuery = z.object({
  scope: z.enum(['incident', 'hazard', 'certificate']),
  scopeId: z.string().uuid(),
});

const denied = () =>
  new ApiError({
    status: 'PERMISSION_DENIED',
    reason: 'HSE_FORBIDDEN',
    domain: 'hse',
    message: 'Not permitted.',
  });

const invalid = (reason: string, message: string) =>
  new ApiError({
    status: 'INVALID_ARGUMENT',
    reason,
    domain: 'hse',
    message,
  });

const allowedTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

function scopeFrom(path: string) {
  const id = path.split('/').at(-1)?.split('.')[0];
  return id && /^[\da-f-]{36}$/i.test(id) ? id : undefined;
}

/** Resolve the caller's HSE scope exactly like the HSE API routes do. */
async function hseScope(context: {
  authorize: (input: {
    resource: { type: 'settings'; id: string };
    action: string;
  }) => Promise<{ effect: string }>;
}) {
  const result = async (action: string) =>
    (
      await context.authorize({
        resource: { type: 'settings', id: 'hse' },
        action,
      })
    ).effect !== 'deny';
  return {
    readAll: await result('readAll'),
    manage: await result('manage'),
    approve: await result('approve'),
    report: await result('report'),
  };
}

export const hseFileApiGuard = defineApiRoutes<Application>((app) => {
  const auth = app.container.resolve(authenticationToken),
    authz = app.container.resolve(authorizationToken),
    hse = app.container.resolve(hseServiceToken),
    router = new Hono<Env>();
  router.use(
    '/hseFiles/*',
    auth.required(),
    authz.middleware(),
    async (c, next) => {
      const read = await c.get('authz').authorize({
        resource: { type: 'settings', id: 'hse' },
        action: 'read',
      });
      if (read.effect === 'deny') throw denied();
      const upload = /\/upload(?:One|Many)$/.test(c.req.path);
      const scope = await hseScope(c.get('authz'));
      if (upload && !scope.manage && !scope.report) throw denied();
      const parsed = parentQuery.safeParse(c.req.query());
      if (!parsed.success)
        throw invalid(
          'HSE_FILE_PARENT_REQUIRED',
          'A saved incident, hazard or certificate is required.',
        );
      const actor = { type: 'user', id: c.get('auth')!.user.id },
        { scope: kind, scopeId } = parsed.data;
      let subjectId: string;
      try {
        subjectId = await hse.fileSubject(actor, scope, kind, scopeId);
      } catch (error) {
        if (error instanceof HseError && error.code === 'HSE_FORBIDDEN')
          throw denied();
        throw new ApiError({
          status: 'NOT_FOUND',
          reason: 'HSE_FILE_PARENT_NOT_FOUND',
          domain: 'hse',
          message: 'The parent record was not found.',
        });
      }
      if (upload) {
        c.set('hseFilePrincipal', {
          ids: [],
          create: {
            scope: { ownerId: actor.id, scopeId },
            defaults: {
              ownerId: actor.id,
              scope: kind,
              scopeId,
              subjectId,
            },
          },
        });
        // Inspect a bounded clone: consuming the request body here would lock
        // the stream before the standard file upload middleware reads it.
        const copy = c.req.raw.clone();
        const reader = copy.body?.getReader();
        if (!reader)
          throw invalid('HSE_FILE_FORMAT', 'Invalid upload payload.');
        const chunks: Uint8Array[] = [];
        let length = 0;
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          if (!(part.value instanceof Uint8Array))
            throw invalid('HSE_FILE_FORMAT', 'Invalid upload payload.');
          length += part.value.byteLength;
          if (length > 6 * 1024 * 1024) {
            void reader.cancel();
            throw new ApiError({
              status: 'INVALID_ARGUMENT',
              httpStatus: 413,
              reason: 'BODY_TOO_LARGE',
              domain: 'hse',
              message: 'Evidence files are limited to 6 MB.',
            });
          }
          chunks.push(part.value);
        }
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.length;
        }
        let body: FormData;
        try {
          body = await new Response(bytes, {
            headers: {
              'content-type': c.req.header('content-type') ?? '',
            },
          }).formData();
        } catch {
          throw invalid('HSE_FILE_FORMAT', 'Invalid upload payload.');
        }
        const files = body.getAll('file');
        if (
          !files.length ||
          files.length > 5 ||
          files.some((file) => !(file instanceof File))
        )
          throw invalid(
            'HSE_FILE_FORMAT',
            'Choose between one and five evidence files.',
          );
        for (const file of files) {
          if (!(file instanceof File)) continue;
          if (!allowedTypes.has(file.type))
            throw new ApiError({
              status: 'INVALID_ARGUMENT',
              httpStatus: 415,
              reason: 'HSE_FILE_TYPE',
              domain: 'hse',
              message: 'Attach image or PDF files only.',
            });
        }
      } else {
        const rows = await app.container
          .resolve(databaseManagerToken)
          .repository('hseFiles')
          .findMany({
            filter: { scope: kind, scopeId },
            limit: 1000,
          });
        c.set('hseFilePrincipal', {
          ids: rows.map((row) => String(row.id)),
          create: false,
        });
      }
      await next();
      c.header('Cache-Control', 'private, no-store');
    },
  );
  const root = new Hono();
  router.onError(apiErrorHandler);
  root.route('/', router);
  return root;
});

export const hseFileContentGuard = defineRootRoutes<Application>((app) => {
  const auth = app.container.resolve(authenticationToken),
    authz = app.container.resolve(authorizationToken),
    db = app.container.resolve(databaseManagerToken),
    hse = app.container.resolve(hseServiceToken);
  const router = new Hono<AuthEnv & AuthorizationEnv>();
  router.use(
    '/uploads/hseFiles/*',
    auth.required(),
    authz.middleware(),
    async (c, next) => {
      const id = scopeFrom(c.req.path);
      if (!id) throw denied();
      const file = await db.repository('hseFiles').findOne({ filter: { id } });
      if (!file)
        throw new ApiError({
          status: 'NOT_FOUND',
          reason: 'HSE_NOT_FOUND',
          domain: 'hse',
          message: 'Not found.',
        });
      const scope = await hseScope(c.get('authz'));
      try {
        await hse.fileSubject(
          { type: 'user', id: c.get('auth')!.user.id },
          scope,
          file.scope === 'hazard'
            ? 'hazard'
            : file.scope === 'certificate'
              ? 'certificate'
              : 'incident',
          String(file.scopeId),
        );
      } catch {
        throw denied();
      }
      await next();
      c.header('Cache-Control', 'private, no-store');
    },
  );
  const root = new Hono();
  root.route('/', router);
  return root;
});

export const hseFileRoutes: ReturnType<
  typeof defineFileRepositoryApiRoutes
> = defineFileRepositoryApiRoutes<FilePrincipal>({
  principal: (c) => c.get('hseFilePrincipal') as FilePrincipal,
  repositories: [
    {
      name: 'hseFiles',
      collection: 'hseFiles',
      disk: 'local',
      accessPath: '/uploads/hseFiles',
      accessMode: 'stream',
      policy: (principal) => ({
        read: {
          scope: (f) => materialIdFilter(f, 'id', principal.ids),
          fields: FILE_COLUMNS.filter((c) => c !== 'disk' && c !== 'key'),
        },
        create: principal.create,
        update: false,
        delete: false,
      }),
      actions: {
        findOne: {},
        findMany: { maxLimit: 100 },
        uploadOne: { maxSize: 6 * 1024 * 1024 },
        uploadMany: { maxSize: 31 * 1024 * 1024 },
      },
    },
  ],
});
