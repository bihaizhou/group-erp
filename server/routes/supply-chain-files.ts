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
import {
  defineApiRoutes,
  defineRootRoutes,
  ApiError,
  apiErrorHandler,
} from '@nocobase/app-server/router';
import { Hono } from 'hono';
import { z } from 'zod';
import type { RepositoryPolicy } from '@nocobase/db';
import { supplyChainFileServiceToken } from '../providers/supply-chain-files.js';
import {
  fileKind,
  type FileKind,
} from '../providers/supply-chain-file-model.js';
import { validateDemandFile } from '../providers/supply-chain-file-format.js';
import { fileError } from '../providers/supply-chain-file-service.js';
import type { SourceAccess } from '../providers/material-source-model.js';
import { materialIdFilter } from '../providers/material-filters.js';
type FilePrincipal = { ids: string[]; create: RepositoryPolicy['create'] };
type Env = AuthEnv &
  AuthorizationEnv & { Variables: { supplyFilePrincipal: FilePrincipal } };
const query = z.object({
  domain: z.enum(['procurement', 'requisitions']),
  requestId: z.string().uuid(),
  lineId: z.string().uuid().optional(),
});
async function access(
  c: import('hono').Context<Env>,
  domain: string,
  action: 'read' | 'update',
): Promise<SourceAccess | undefined> {
  const resource = { type: 'composite' as const, id: `${domain}.requests` },
    ctx = c.get('authz');
  const decision = await ctx.authorize({ resource, action });
  if (decision.effect === 'deny' || !decision.conditions?.database) return;
  const delegate = await ctx.authorize({ resource, action: 'delegate' });
  return {
    policies: decision.conditions.database,
    delegate:
      delegate.effect === 'deny'
        ? null
        : (delegate.conditions?.database ?? null),
  };
}
export const supplyChainFileApiGuard = defineApiRoutes<Application>((app) => {
  const auth = app.container.resolve(authenticationToken),
    authz = app.container.resolve(authorizationToken),
    files = app.container.resolve(supplyChainFileServiceToken),
    router = new Hono<Env>();
  router.use(
    '/supplyChainFiles/*',
    auth.required(),
    authz.middleware(),
    async (c, next) => {
      const upload = /\/upload(?:One|Many)$/.test(c.req.path),
        actor = { id: c.get('auth')!.user.id };
      const task = z.string().uuid().safeParse(c.req.query('governanceTaskId'));
      if (task.success && !upload) {
        const grant = await c.get('authz').authorize({
          resource: { type: 'composite', id: 'materials.sources' },
          action: 'read',
        });
        if (grant.effect === 'deny' || !grant.conditions?.database)
          return fileError('SUPPLY_FILE_FORBIDDEN', 'PERMISSION_DENIED');
        c.set('supplyFilePrincipal', {
          ids: await files.governanceIds(task.data, grant.conditions.database),
          create: false,
        });
      } else {
        // Decide the domain action before parsing an attacker-supplied parent ID.
        const domain = c.req.query('domain');
        if (domain !== 'procurement' && domain !== 'requisitions')
          return fileError('SUPPLY_FILE_FORBIDDEN', 'PERMISSION_DENIED');
        const read = await access(c, domain, upload ? 'update' : 'read');
        if (!read)
          return fileError('SUPPLY_FILE_FORBIDDEN', 'PERMISSION_DENIED');
        const parsed = query.safeParse(c.req.query());
        if (!parsed.success)
          throw new ApiError({
            status: 'INVALID_ARGUMENT',
            domain: 'supplyChain',
            reason: 'SUPPLY_FILE_PARENT_REQUIRED',
            message: 'A saved parent is required.',
          });
        const { requestId } = parsed.data,
          kind = fileKind(domain),
          head = await files.parent(kind, requestId, actor, read, upload);
        if (upload) {
          // No caller business fields reach the official upload. Parent ownership
          // is stamped using the currently authorized saved document.
          const defaults = {
            ownerId: actor.id,
            kind,
            documentId: requestId,
            subjectId: typeof head.subjectId === 'string' ? head.subjectId : '',
            purchaseRequestId: kind === 'purchaseRequest' ? requestId : null,
            issueRequestId: kind === 'materialIssueRequest' ? requestId : null,
          };
          c.set('supplyFilePrincipal', {
            ids: [],
            create: {
              scope: { ownerId: actor.id, documentId: requestId },
              defaults,
            },
          });
        } else
          c.set('supplyFilePrincipal', {
            ids: await files.parentFileIds(
              kind,
              requestId,
              actor,
              read,
              await access(c, domain, 'update'),
            ),
            create: false,
          });
      }
      if (upload) {
        const copy = c.req.raw.clone(),
          reader = copy.body?.getReader();
        if (!reader) return fileError('SUPPLY_FILE_FORMAT', 'INVALID_ARGUMENT');
        const chunks: Uint8Array[] = [];
        let size = 0;
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          if (!(part.value instanceof Uint8Array))
            return fileError('SUPPLY_FILE_FORMAT', 'INVALID_ARGUMENT');
          size += part.value.byteLength;
          if (size > 51 * 1024 * 1024) {
            void reader.cancel();
            throw new ApiError({
              status: 'INVALID_ARGUMENT',
              httpStatus: 413,
              reason: 'BODY_TOO_LARGE',
              domain: 'supplyChain',
              message: 'Payload too large.',
            });
          }
          chunks.push(part.value);
        }
        let body: FormData;
        try {
          body = await new Response(Buffer.concat(chunks), {
            headers: { 'content-type': c.req.header('content-type') ?? '' },
          }).formData();
        } catch {
          return fileError('SUPPLY_FILE_FORMAT', 'INVALID_ARGUMENT');
        }
        const many = c.req.path.endsWith('/uploadMany'),
          items = body.getAll('file');
        if (
          !items.length ||
          items.length > (many ? 10 : 1) ||
          items.some((f) => !(f instanceof File))
        )
          return fileError('SUPPLY_FILE_LIMIT', 'INVALID_ARGUMENT');
        for (const file of items) await validateDemandFile(file as File);
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
export const supplyChainFileContentGuard = defineRootRoutes<Application>(
  (app) => {
    const auth = app.container.resolve(authenticationToken),
      authz = app.container.resolve(authorizationToken),
      files = app.container.resolve(supplyChainFileServiceToken),
      router = new Hono<Env>();
    router.use(
      '/uploads/supplyChainFiles/*',
      auth.required(),
      authz.middleware(),
      async (c, next) => {
        const parsed = z
          .string()
          .uuid()
          .safeParse(c.req.path.split('/').at(-1)?.split('.')[0]);
        if (!parsed.success)
          return fileError('SUPPLY_FILE_NOT_FOUND', 'NOT_FOUND');
        const file = await files.file(parsed.data);
        if (!file) return fileError('SUPPLY_FILE_NOT_FOUND', 'NOT_FOUND');
        const kind = file.kind as FileKind,
          domain = kind === 'purchaseRequest' ? 'procurement' : 'requisitions',
          actor = { id: c.get('auth')!.user.id };
        let permitted = false;
        try {
          const read = await access(c, domain, 'read');
          if (read)
            permitted = (
              await files.parentFileIds(
                kind,
                typeof file.documentId === 'string' ? file.documentId : '',
                actor,
                read,
                await access(c, domain, 'update'),
              )
            ).includes(parsed.data);
        } catch (error) {
          if (!(error instanceof ApiError)) throw error;
        }
        if (!permitted) {
          const grant = await c.get('authz').authorize({
            resource: { type: 'composite', id: 'materials.sources' },
            action: 'read',
          });
          if (grant.effect !== 'deny' && grant.conditions?.database) {
            // Only the shared file IDs of actual, still-current authorized sources
            // are eligible. Metadata UUID knowledge never authorizes content.
            const taskId = await files.currentTaskForFile(parsed.data);
            if (taskId)
              permitted = (
                await files.governanceIds(taskId, grant.conditions.database)
              ).includes(parsed.data);
          }
        }
        if (!permitted)
          return fileError('SUPPLY_FILE_FORBIDDEN', 'PERMISSION_DENIED');
        await next();
        c.header('Cache-Control', 'private, no-store');
      },
    );
    const root = new Hono();
    router.onError(apiErrorHandler);
    root.route('/', router);
    return root;
  },
);
export const supplyChainFileRoutes: ReturnType<
  typeof defineFileRepositoryApiRoutes
> = defineFileRepositoryApiRoutes<FilePrincipal>({
  principal: (c) => c.get('supplyFilePrincipal') as FilePrincipal,
  repositories: [
    {
      name: 'supplyChainFiles',
      collection: 'supplyChainFiles',
      disk: 'local',
      accessPath: '/uploads/supplyChainFiles',
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
        uploadMany: { maxSize: 51 * 1024 * 1024 },
      },
    },
  ],
});
