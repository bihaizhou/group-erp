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
import {
  OperationsError,
  operationsServiceToken,
} from '../providers/operations-service.js';
import { materialIdFilter } from '../providers/material-filters.js';

type FilePrincipal = {
  ids: string[];
  create: RepositoryPolicy['create'];
};
type Env = AuthEnv &
  AuthorizationEnv & { Variables: { operationsFilePrincipal: FilePrincipal } };

const parentQuery = z.object({ issueId: z.string().uuid() });

const denied = () =>
  new ApiError({
    status: 'PERMISSION_DENIED',
    reason: 'OPERATIONS_FORBIDDEN',
    domain: 'operations',
    message: 'Not permitted.',
  });

const notFound = () =>
  new ApiError({
    status: 'NOT_FOUND',
    reason: 'OPERATIONS_NOT_FOUND',
    domain: 'operations',
    message: 'The issue was not found.',
  });

const invalid = (reason: string, message: string) =>
  new ApiError({
    status: 'INVALID_ARGUMENT',
    reason,
    domain: 'operations',
    message,
  });

const allowedTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

function fileIdFrom(path: string) {
  const id = path.split('/').at(-1)?.split('.')[0];
  return id && /^[\da-f-]{36}$/i.test(id) ? id : undefined;
}

/** Resolve the caller's operations scope exactly like the operations routes. */
async function operationsScope(context: {
  authorize: (input: {
    resource: { type: 'settings'; id: string };
    action: string;
  }) => Promise<{ effect: string }>;
}) {
  const readAll = async () =>
    (
      await context.authorize({
        resource: { type: 'settings', id: 'operations' },
        action: 'readAll',
      })
    ).effect !== 'deny';
  return { readAll: await readAll() };
}

export const operationsFileApiGuard = defineApiRoutes<Application>((app) => {
  const auth = app.container.resolve(authenticationToken),
    authz = app.container.resolve(authorizationToken),
    operations = app.container.resolve(operationsServiceToken),
    router = new Hono<Env>();
  router.use(
    '/operationsFiles/*',
    auth.required(),
    authz.middleware(),
    async (c, next) => {
      const read = await c.get('authz').authorize({
        resource: { type: 'settings', id: 'operations' },
        action: 'read',
      });
      if (read.effect === 'deny') throw denied();
      const upload = /\/upload(?:One|Many)$/.test(c.req.path);
      if (upload) {
        const manage = await c.get('authz').authorize({
          resource: { type: 'settings', id: 'operations' },
          action: 'manage',
        });
        if (manage.effect === 'deny') throw denied();
      }
      const parsed = parentQuery.safeParse(c.req.query());
      if (!parsed.success)
        throw invalid(
          'OPERATIONS_FILE_ISSUE_REQUIRED',
          'A saved issue is required.',
        );
      const actor = { type: 'user', id: c.get('auth')!.user.id };
      const { issueId } = parsed.data;
      let subjectId: string | null;
      try {
        subjectId = await operations.fileSubject(
          actor,
          await operationsScope(c.get('authz')),
          issueId,
        );
      } catch (error) {
        if (
          error instanceof OperationsError &&
          error.code === 'OPERATIONS_FORBIDDEN'
        )
          throw denied();
        throw error;
      }
      if (!subjectId) throw notFound();
      const company = subjectId;
      if (upload) {
        c.set('operationsFilePrincipal', {
          ids: [],
          create: {
            scope: { ownerId: actor.id, issueId },
            defaults: {
              ownerId: actor.id,
              issueId,
              subjectId: company,
            },
          },
        });
        // Inspect a bounded clone: consuming the request body here would lock
        // the stream before the standard file upload middleware reads it.
        const copy = c.req.raw.clone();
        const reader = copy.body?.getReader();
        if (!reader)
          throw invalid('OPERATIONS_FILE_FORMAT', 'Invalid upload payload.');
        const chunks: Uint8Array[] = [];
        let length = 0;
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          if (!(part.value instanceof Uint8Array))
            throw invalid('OPERATIONS_FILE_FORMAT', 'Invalid upload payload.');
          length += part.value.byteLength;
          if (length > 6 * 1024 * 1024) {
            void reader.cancel();
            throw new ApiError({
              status: 'INVALID_ARGUMENT',
              httpStatus: 413,
              reason: 'BODY_TOO_LARGE',
              domain: 'operations',
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
          throw invalid('OPERATIONS_FILE_FORMAT', 'Invalid upload payload.');
        }
        const files = body.getAll('file');
        if (
          !files.length ||
          files.length > 5 ||
          files.some((file) => !(file instanceof File))
        )
          throw invalid(
            'OPERATIONS_FILE_FORMAT',
            'Choose between one and five evidence files.',
          );
        for (const file of files) {
          if (!(file instanceof File)) continue;
          if (!allowedTypes.has(file.type))
            throw new ApiError({
              status: 'INVALID_ARGUMENT',
              httpStatus: 415,
              reason: 'OPERATIONS_FILE_TYPE',
              domain: 'operations',
              message: 'Attach image or PDF files only.',
            });
        }
      } else {
        const rows = await app.container
          .resolve(databaseManagerToken)
          .repository('operationsIssueFiles')
          .findMany({ filter: { issueId }, limit: 1000 });
        c.set('operationsFilePrincipal', {
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

export const operationsFileContentGuard = defineRootRoutes<Application>(
  (app) => {
    const auth = app.container.resolve(authenticationToken),
      authz = app.container.resolve(authorizationToken),
      db = app.container.resolve(databaseManagerToken),
      operations = app.container.resolve(operationsServiceToken);
    const router = new Hono<AuthEnv & AuthorizationEnv>();
    router.use(
      '/uploads/operationsIssueFiles/*',
      auth.required(),
      authz.middleware(),
      async (c, next) => {
        const id = fileIdFrom(c.req.path);
        if (!id) throw denied();
        const file = await db
          .repository('operationsIssueFiles')
          .findOne({ filter: { id } });
        if (!file) throw notFound();
        try {
          const subjectId = await operations.fileSubject(
            { type: 'user', id: c.get('auth')!.user.id },
            await operationsScope(c.get('authz')),
            String(file.issueId),
          );
          if (!subjectId) throw denied();
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
  },
);

export const operationsFileRoutes: ReturnType<
  typeof defineFileRepositoryApiRoutes
> = defineFileRepositoryApiRoutes<FilePrincipal>({
  principal: (c) => c.get('operationsFilePrincipal') as FilePrincipal,
  repositories: [
    {
      name: 'operationsFiles',
      collection: 'operationsIssueFiles',
      disk: 'local',
      accessPath: '/uploads/operationsIssueFiles',
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
