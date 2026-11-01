import type { Application } from '@nocobase/app-server/application';
import {
  authenticationToken,
  type AuthEnv,
} from '@nocobase/app-plugin-authentication';
import {
  authorizationToken,
  type AuthorizationEnv,
} from '@nocobase/app-plugin-authorization/server';
import { defineFileRepositoryApiRoutes } from '@nocobase/app-plugin-file/server';
import { databaseManagerToken } from '@nocobase/db';
import {
  ApiError,
  defineApiRoutes,
  defineRootRoutes,
} from '@nocobase/app-server/router';
import { Hono } from 'hono';

const denied = () =>
  new ApiError({
    status: 'PERMISSION_DENIED',
    reason: 'PEOPLE_FORBIDDEN',
    domain: 'people',
    message: 'Not permitted.',
  });
export const peoplePhotoApiGuard = defineApiRoutes<Application>((app) => {
  const auth = app.container.resolve(authenticationToken),
    authz = app.container.resolve(authorizationToken);
  const router = new Hono<AuthEnv & AuthorizationEnv>();
  router.use(
    '/peoplePhotos/*',
    auth.required(),
    authz.middleware(),
    async (c, next) => {
      const action = c.req.path.endsWith('/uploadOne') ? 'update' : 'read';
      const decision = await c.get('authz').authorize({
        resource: { type: 'composite', id: 'people.employees' },
        action,
      });
      if (
        decision.effect === 'deny' ||
        !decision.conditions?.database?.personnelEmployees
      )
        throw denied();
      await next();
    },
  );
  router.use('/peoplePhotos/uploadOne', async (c, next) => {
    // Inspect a bounded clone: consuming the original would lock the stream before
    // the standard File Repository's own bodyLimit/upload middleware can read it.
    const copy = c.req.raw.clone();
    const reader = copy.body?.getReader();
    if (!reader)
      throw new ApiError({
        status: 'INVALID_ARGUMENT',
        reason: 'PEOPLE_PHOTO_TYPE',
        domain: 'people',
        message: 'Missing image.',
      });
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      if (!(part.value instanceof Uint8Array))
        throw new ApiError({
          status: 'INVALID_ARGUMENT',
          reason: 'PEOPLE_PHOTO_TYPE',
          domain: 'people',
          message: 'Invalid upload.',
        });
      length += part.value.byteLength;
      if (length > 5 * 1024 * 1024) {
        void reader.cancel();
        throw new ApiError({
          status: 'INVALID_ARGUMENT',
          httpStatus: 413,
          reason: 'BODY_TOO_LARGE',
          domain: 'people',
          message: 'Image is too large.',
        });
      }
      chunks.push(part.value);
    }
    const bytesBody = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytesBody.set(chunk, offset);
      offset += chunk.length;
    }
    const body = await new Response(bytesBody, {
      headers: { 'content-type': c.req.header('content-type') ?? '' },
    }).formData();
    const file = body.get('file');
    if (
      !(file instanceof File) ||
      !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)
    )
      throw new ApiError({
        status: 'INVALID_ARGUMENT',
        httpStatus: 415,
        reason: 'PEOPLE_PHOTO_TYPE',
        domain: 'people',
        message: 'Choose JPEG, PNG or WebP.',
      });
    const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    const valid =
      file.type === 'image/jpeg'
        ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : file.type === 'image/png'
          ? bytes[0] === 137 &&
            bytes[1] === 80 &&
            bytes[2] === 78 &&
            bytes[3] === 71
          : bytes[0] === 82 &&
            bytes[1] === 73 &&
            bytes[2] === 70 &&
            bytes[3] === 70 &&
            bytes[8] === 87 &&
            bytes[9] === 69 &&
            bytes[10] === 66 &&
            bytes[11] === 80;
    if (!valid)
      throw new ApiError({
        status: 'INVALID_ARGUMENT',
        reason: 'PEOPLE_PHOTO_TYPE',
        domain: 'people',
        message: 'Invalid image.',
      });
    await next();
  });
  const root = new Hono();
  root.route('/', router);
  return root;
});
export const peoplePhotoContentGuard = defineRootRoutes<Application>((app) => {
  const auth = app.container.resolve(authenticationToken),
    authz = app.container.resolve(authorizationToken),
    db = app.container.resolve(databaseManagerToken);
  const router = new Hono<AuthEnv & AuthorizationEnv>();
  router.use(
    '/uploads/peoplePhotos/*',
    auth.required(),
    authz.middleware(),
    async (c, next) => {
      const id = c.req.path.split('/').at(-1)?.split('.')[0];
      if (!id || !/^[\da-f-]{36}$/i.test(id)) throw denied();
      const file = await db
        .repository('peopleFiles')
        .findOne({ filter: { id } });
      if (!file)
        throw new ApiError({
          status: 'NOT_FOUND',
          reason: 'PEOPLE_NOT_FOUND',
          domain: 'people',
          message: 'Not found.',
        });
      const user = c.get('auth')!.user;
      let visible = false;
      for (const kind of ['employees', 'profiles']) {
        const decision = await c.get('authz').authorize({
          resource: { type: 'composite', id: `people.${kind}` },
          action: 'read',
        });
        const policy = decision.conditions?.database?.personnelEmployees;
        if (decision.effect === 'deny' || !policy) continue;
        visible = await db
          .repository('personnelEmployees')
          .withPolicy(policy)
          .exists({ filter: { photoId: id } });
        if (visible) break;
      }
      if (
        !visible &&
        file.ownerId === user.id &&
        !(await db
          .repository('personnelEmployees')
          .exists({ filter: { photoId: id } }))
      ) {
        const decision = await c.get('authz').authorize({
          resource: { type: 'composite', id: 'people.employees' },
          action: 'update',
        });
        visible =
          decision.effect !== 'deny' &&
          Boolean(decision.conditions?.database?.personnelEmployees);
      }
      if (!visible) throw denied();
      await next();
      c.header('Cache-Control', 'private, no-store');
    },
  );
  const root = new Hono();
  root.route('/', router);
  return root;
});
export const peoplePhotoRoutes: ReturnType<
  typeof defineFileRepositoryApiRoutes
> = defineFileRepositoryApiRoutes<{ id: string }>({
  principal: (c) => ({
    id: (c.get('auth') as AuthEnv['Variables']['auth'])!.user.id,
  }),
  repositories: [
    {
      name: 'peoplePhotos',
      collection: 'peopleFiles',
      disk: 'local',
      accessPath: '/uploads/peoplePhotos',
      accessMode: 'stream',
      policy: (principal) => ({
        read: {
          scope: { ownerId: principal.id },
          fields: [
            'id',
            'filename',
            'ext',
            'mimeType',
            'size',
            'createdAt',
            'updatedAt',
          ],
        },
        create: {
          scope: { ownerId: principal.id },
          defaults: { ownerId: principal.id },
        },
        update: false,
        delete: false,
      }),
      actions: {
        findOne: {},
        findMany: { maxLimit: 100 },
        uploadOne: { maxSize: 5 * 1024 * 1024 },
      },
    },
  ],
});
