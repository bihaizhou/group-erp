import type { Application } from '@nocobase/app-server/application';
import {
  defineApiRoutes,
  type AppApiRouteContribution,
} from '@nocobase/app-server/router';
import {
  authenticationToken,
  type AuthEnv,
} from '@nocobase/app-plugin-authentication';
import { databaseManagerToken } from '@nocobase/db';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { createMiddleware } from 'hono/factory';
import {
  assertFieldsWritable,
  redactRecord,
  type FieldPolicyView,
} from '../providers/field-access.js';
import { resourceFieldNames } from '../providers/field-catalog.js';
import {
  pageFieldPoliciesFor,
  pageKeyForRequest,
} from '../providers/page-field-visibility.js';
import { createPartnerRoutes } from './procurement-suppliers.js';
import { customerServiceToken } from '../providers/execution.js';

const CUSTOMER_RESOURCE = 'sales.customer';

type Env = AuthEnv & {
  Variables: { customerFieldRules: FieldPolicyView[] | undefined };
};

const isProvided = (value: unknown) =>
  value !== undefined && value !== null && value !== '';

const comparable = (field: string, value: unknown): string | null => {
  if (value === undefined || value === null || value === '') return null;
  if (
    typeof value !== 'string' &&
    typeof value !== 'number' &&
    typeof value !== 'boolean'
  )
    return null;
  const string = String(value).trim();
  if (field === 'code' || field === 'registrationCode')
    return string.toUpperCase();
  return string;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const isRelationship = (value: Record<string, unknown>) =>
  isObject(value.identity) && 'partnerRole' in value;

const isIdentity = (value: Record<string, unknown>) =>
  !('identity' in value) &&
  ('registrationCode' in value || ('code' in value && 'name' in value));

export const salesCustomerRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const partner = createPartnerRoutes(
      app,
      app.container.resolve(customerServiceToken),
      'customer',
    );
    const auth = app.container.resolve(authenticationToken);
    const db = app.container.resolve(databaseManagerToken);
    const router = new Hono<Env>();

    const principal = (c: Context<Env>) => ({
      type: 'user' as const,
      id: c.get('auth')!.user.id,
    });
    const fieldRules = async (c: Context<Env>) => {
      const cached = c.get('customerFieldRules');
      if (cached) return cached;
      const rules = await pageFieldPoliciesFor(db, principal(c), pageKeyForRequest(c, 'sales-customers', 'sales-customers-new', 'sales-customers-edit', 'sales-customers-detail', 'sales-customers-action'));
      c.set('customerFieldRules', rules);
      return rules;
    };
    const readJson = async (c: Context<Env>) => {
      try {
        const raw = await c.req.raw.clone().json();
        return isObject(raw) ? raw : undefined;
      } catch {
        return undefined;
      }
    };
    const assertCreateWritable = async (c: Context<Env>) => {
      const rules = await fieldRules(c);
      if (!rules.length) return;
      const input = (await readJson(c)) ?? {},
        fields = await resourceFieldNames(db, CUSTOMER_RESOURCE);
      assertFieldsWritable(
        rules,
        CUSTOMER_RESOURCE,
        fields.filter((field) => field in input && isProvided(input[field])),
      );
    };
    const assertIdentityWritable = async (c: Context<Env>) => {
      const rules = await fieldRules(c);
      if (!rules.length) return;
      const input = (await readJson(c)) ?? {},
        id = c.req.param('id'),
        current = id
          ? ((await db
              .repository('businessPartners')
              .findOne({ filter: { id } })) as Record<string, unknown> | null)
          : null,
        fields = await resourceFieldNames(db, CUSTOMER_RESOURCE);
      assertFieldsWritable(
        rules,
        CUSTOMER_RESOURCE,
        fields.filter((field) => {
          if (field === 'status') return false;
          const next =
            field === 'registrationCode'
              ? 'registrationCode' in input
                ? (input.registrationCode ?? null)
                : null
              : input[field];
          if (next === undefined) return false;
          if (!isProvided(next) && field !== 'registrationCode') return false;
          return (
            comparable(field, next) !==
            comparable(field, current ? current[field] : null)
          );
        }),
      );
    };
    const redactRelationship = (
      row: Record<string, unknown>,
      rules: readonly FieldPolicyView[],
    ) =>
      isRelationship(row)
        ? {
            ...row,
            identity: redactRecord(
              row.identity as Record<string, unknown>,
              rules,
              CUSTOMER_RESOURCE,
            ),
          }
        : row;
    const redactPayload = (
      payload: unknown,
      rules: readonly FieldPolicyView[],
    ) => {
      if (!isObject(payload) || !('data' in payload)) return payload;
      const data = payload.data;
      if (Array.isArray(data)) {
        return {
          ...payload,
          data: data.map((row: unknown) =>
            isObject(row) ? redactRelationship(row, rules) : row,
          ),
        };
      }
      if (!isObject(data)) return payload;
      if (isRelationship(data)) {
        return { ...payload, data: redactRelationship(data, rules) };
      }
      if (isIdentity(data)) {
        return {
          ...payload,
          data: redactRecord(data, rules, CUSTOMER_RESOURCE),
        };
      }
      return payload;
    };
    const redactResponse = async (c: Context<Env>) => {
      if (!c.get('auth')) return;
      const rules = await fieldRules(c);
      if (!rules.length || !c.res) return;
      let payload: unknown;
      try {
        payload = await c.res.clone().json();
      } catch {
        return;
      }
      const redacted = redactPayload(payload, rules);
      if (redacted === payload) return;
      const headers = new Headers(c.res.headers);
      headers.delete('content-length');
      c.res = new Response(JSON.stringify(redacted), {
        status: c.res.status,
        statusText: c.res.statusText,
        headers,
      });
    };

    router.use(
      '/sales/customers',
      createMiddleware<Env>(async (c, next) => {
        if (c.req.method === 'POST') {
          await auth.required()(c as unknown as Parameters<MiddlewareHandler<AuthEnv>>[0], async () => {
            await assertCreateWritable(c);
            await next();
          });
        } else {
          await next();
        }
        await redactResponse(c);
      }),
    );
    router.use(
      '/sales/customers/:id',
      createMiddleware<Env>(async (c, next) => {
        await next();
        await redactResponse(c);
      }),
    );
    router.use(
      '/sales/customerIdentities/:id',
      createMiddleware<Env>(async (c, next) => {
        if (c.req.method === 'PATCH') {
          await auth.required()(c as unknown as Parameters<MiddlewareHandler<AuthEnv>>[0], async () => {
            await assertIdentityWritable(c);
            await next();
          });
        } else {
          await next();
        }
        await redactResponse(c);
      }),
    );

    router.route('/', partner);
    return router as unknown as Hono;
  });
