import {
  authenticationToken,
  type AuthEnv,
} from '@nocobase/app-plugin-authentication';
import {
  authorizationToken,
  type AuthorizationEnv,
} from '@nocobase/app-plugin-authorization/server';
import type { Application } from '@nocobase/app-server/application';
import { databaseManagerToken } from '@nocobase/db';
import {
  ApiError,
  apiErrorHandler,
  apiErrorResponse,
  apiErrorResponses,
  apiValidator,
  dataResponse,
  listResponse,
  defineApiRoutes,
  describeRoute,
  type AppApiRouteContribution,
} from '@nocobase/app-server/router';
import {
  LifecycleError,
  ParameterConfigurationError,
  lifecycleErrorFields,
} from '@nocobase/lifecycle';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { supplyChainMaterialServiceToken } from '../providers/supply-chain.js';
import { issuePurposeServiceToken } from '../providers/requisitions.js';
import {
  materialOptionsQuery,
  materialOptionsMeta,
  materialSelectionInput,
  materialSelectionOutput,
} from '../providers/supply-chain-model.js';
import {
  issuePurposeQuery,
  issuePurposeCreate,
  issuePurposeUpdate,
  issuePurposeMutation,
  issuePurposeView,
} from '../providers/issue-purpose-model.js';
import { MaterialError } from '../providers/material-model.js';
import { materialApiError } from './material-error.js';
import { createMiddleware } from 'hono/factory';
import { bodyLimit } from 'hono/body-limit';
import type { MaterialPolicies } from '../providers/material-service.js';
import { SupplyChainError } from '../providers/supply-chain-model.js';
import { issueRequestServiceToken } from '../providers/requisitions.js';
import {
  issueError,
  type IssueAccess,
} from '../providers/issue-request-service.js';
import type { IssuePermissionAction } from '../providers/issue-request-resources.js';
import {
  issueCreate,
  issueUpdate,
  issueAction,
  issueReceive,
  issueParams,
  issueQuery,
  issuePage,
  issueMeta,
  issueView,
  issueListView,
  issueAuditView,
  issueOptionQuery,
  issueOptionView,
  issueSettingsQuery,
  issueSettingsSave,
  issueSettingsView,
  issueCapabilityView,
  issueCompanyMeta,
} from '../providers/issue-request-model.js';
import {
  assertFieldsWritable,
  redactRecord,
  redactRows,
  type FieldPolicyView,
} from '../providers/field-access.js';
import { resourceFieldNames } from '../providers/field-catalog.js';
import {
  pageFieldPoliciesFor,
  pageKeyForRequest,
} from '../providers/page-field-visibility.js';

type Env = AuthEnv &
  AuthorizationEnv & { Variables: { issueAccess: IssueAccess } };
const errors = {
  ...apiErrorResponses,
  '400': apiErrorResponse(400),
  '404': apiErrorResponse(404),
  '409': apiErrorResponse(409),
  '413': apiErrorResponse(413),
};
/** Catalog resources that own the issue request fields. */
const HEAD_RESOURCE = 'issue.request';
const LINE_RESOURCE = 'issue.request.line';
const PURPOSE_RESOURCE = 'issue.purpose';
export const requisitionsRequestRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const service = app.container.resolve(issueRequestServiceToken),
      auth = app.container.resolve(authenticationToken),
      authz = app.container.resolve(authorizationToken),
      db = app.container.resolve(databaseManagerToken);
    const router = new Hono<Env>();
    for (const path of [
      '/requests',
      '/requests/*',
      '/requestOptions',
      '/requestCompanies',
      '/requestMaterialOptions',
      '/requestMaterialOptions/*',
      '/requestMaterialSelections',
      '/requestPurposeOptions',
      '/purposes',
      '/purposes/*',
      '/purposeCompanies',
      '/settings/companies',
      '/settings',
      '/settings/options',
    ])
      router.use(path, auth.required(), authz.middleware());
    const actor = (c: Context<Env>) => ({ id: c.get('auth')!.user.id });
    const access = (c: Context<Env>) => c.get('issueAccess');
    /**
     * The issue service only needs the account id; field policies are keyed by
     * the signed-in user, so the policy principal must carry `type: 'user'`.
     */
    const principal = (c: Context<Env>) => ({
      type: 'user' as const,
      id: c.get('auth')!.user.id,
    });
    const isProvided = (value: unknown): boolean =>
      value !== undefined && value !== null && value !== '';
    const asComparable = (field: string, value: unknown): string | null => {
      if (!isProvided(value)) return null;
      if (field === 'requestedQuantity' || field === 'baseQuantity') {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? String(numeric) : String(value);
      }
      if (field === 'neededOn') return String(value).slice(0, 10);
      return String(value);
    };
    /** View field names that a line selection writes onto the stored line. */
    const lineFieldValues = (line: Record<string, unknown>) => {
      const selection = (line.selection ?? {}) as Record<string, unknown>;
      return {
        originalName: line.originalName,
        originalSpecification: line.originalSpecification,
        requestedQuantity: selection.quantity,
        requestedUnitText: selection.requestedUnitText,
        baseQuantity: selection.baseQuantity,
        usage: line.usage,
        notes: line.notes,
      } as Record<string, unknown>;
    };
    const assertContentWritable = async (
      policies: FieldPolicyView[],
      content: Record<string, unknown>,
      previousLines?: readonly Record<string, unknown>[],
    ) => {
      const headFields = await resourceFieldNames(db, HEAD_RESOURCE);
      assertFieldsWritable(
        policies,
        HEAD_RESOURCE,
        headFields.filter(
          (field) => field in content && isProvided(content[field]),
        ),
      );
      const lineFields = await resourceFieldNames(db, LINE_RESOURCE);
      const previous = new Map(
        (previousLines ?? []).map((line) => [line.id, line]),
      );
      for (const line of Array.isArray(content.lines)
        ? (content.lines as Record<string, unknown>[])
        : []) {
        const values = lineFieldValues(line);
        const before = previous.get(line.id);
        assertFieldsWritable(
          policies,
          LINE_RESOURCE,
          lineFields.filter((field) => {
            if (!(field in values) || !isProvided(values[field])) return false;
            return (
              !before ||
              asComparable(field, values[field]) !==
                asComparable(field, before[field])
            );
          }),
        );
      }
    };
    const redactIssueView = (
      view: Record<string, unknown>,
      policies: FieldPolicyView[],
    ) => {
      const head = redactRecord({ ...view }, policies, HEAD_RESOURCE);
      if (Array.isArray(head.lines))
        head.lines = redactRows(
          head.lines as Record<string, unknown>[],
          policies,
          LINE_RESOURCE,
        );
      return head;
    };
    const assertPurposeFields = async (
      policies: FieldPolicyView[],
      content: Record<string, unknown>,
    ) => {
      const fields = await resourceFieldNames(db, PURPOSE_RESOURCE);
      assertFieldsWritable(
        policies,
        PURPOSE_RESOURCE,
        fields.filter(
          (field) => field in content && isProvided(content[field]),
        ),
      );
    };
    const allowed = (
      action: IssuePermissionAction | 'update',
      settings = false,
    ) =>
      createMiddleware<Env>(async (c, next) => {
        const context = c.get('authz');
        const result = await context.authorize({
          resource: {
            type: 'composite',
            id: settings ? 'requisitions.settings' : 'requisitions.requests',
          },
          action,
        });
        if (result.effect === 'deny' || !result.conditions?.database)
          return issueError('ISSUE_FORBIDDEN', 'PERMISSION_DENIED');
        const delegate = settings
          ? null
          : await context.authorize({
              resource: { type: 'composite', id: 'requisitions.requests' },
              action: 'delegate',
            });
        const source =
          !settings && action === 'submit'
            ? await context.authorize({
                resource: { type: 'composite', id: 'requisitions.requests' },
                action: 'requestGovernance',
              })
            : null;
        c.set('issueAccess', {
          policies: result.conditions.database,
          source:
            source && source.effect !== 'deny' && source.conditions?.database
              ? {
                  policies: source.conditions.database,
                  delegate:
                    delegate && delegate.effect !== 'deny'
                      ? (delegate.conditions?.database ?? null)
                      : null,
                }
              : undefined,
          delegate:
            delegate &&
            delegate.effect !== 'deny' &&
            delegate.conditions?.database
              ? (delegate.conditions.database as MaterialPolicies)
              : null,
        });
        await next();
      });
    const limit = bodyLimit({
      maxSize: 1048576,
      onError: () => {
        throw new ApiError({
          status: 'INVALID_ARGUMENT',
          httpStatus: 413,
          domain: 'requisitions',
          reason: 'BODY_TOO_LARGE',
          message: 'Payload too large.',
        });
      },
    });
    const describe = (
      operationId: string,
      summary: string,
      response: ReturnType<typeof dataResponse>,
      create = false,
    ) =>
      describeRoute({
        operationId,
        summary,
        tags: ['Issue requests'],
        responses: { [create ? '201' : '200']: response, ...errors },
      });
    router.onError((error, c) => {
      if (error instanceof MaterialError)
        return apiErrorHandler(materialApiError(error), c);
      if (error instanceof ParameterConfigurationError) {
        const conflict = [
          'CONFIGURATION_CONFLICT',
          'CONFIGURATION_REQUEST_REUSED',
        ].includes(error.code);
        return apiErrorHandler(
          new ApiError({
            status: conflict ? 'ABORTED' : 'FAILED_PRECONDITION',
            domain: 'requisitions',
            reason: error.code,
            message: 'The issue rule configuration could not be applied.',
          }),
          c,
        );
      }
      if (error instanceof SupplyChainError)
        return apiErrorHandler(
          new ApiError({
            status:
              error.reason === 'SUPPLY_FORBIDDEN'
                ? 'PERMISSION_DENIED'
                : 'INVALID_ARGUMENT',
            domain: 'requisitions',
            reason: error.reason,
            message: 'The material selection could not be applied.',
            ...(error.field
              ? {
                  fieldViolations: [
                    { field: error.field, description: error.reason },
                  ],
                }
              : {}),
          }),
          c,
        );
      const fields =
        error instanceof LifecycleError
          ? lifecycleErrorFields(error)
          : undefined;
      return apiErrorHandler(
        fields ? new ApiError({ ...fields, domain: 'requisitions' }) : error,
        c,
      );
    });
    router.get(
      '/requests/:id/capabilities',
      allowed('read'),
      describe(
        'issueRequestCapabilities',
        'Read current action eligibility without recording a transition or parameter snapshot',
        dataResponse(issueCapabilityView),
      ),
      apiValidator('param', issueParams),
      async (c) => {
        const context = c.get('authz');
        const decisions: Record<string, IssueAccess | null> = {};
        const sourceDecision = await context.authorize({
          resource: { type: 'composite', id: 'requisitions.requests' },
          action: 'requestGovernance',
        });
        for (const action of [
          'update',
          'submit',
          'approve',
          'return',
          'withdraw',
          'revise',
          'cancel',
          'reassign',
          'copy',
          'requestGovernance',
          'confirmMaterial',
          'rejectMaterial',
          'takeOverSource',
        ] as const) {
          const result = await context.authorize({
            resource: { type: 'composite', id: 'requisitions.requests' },
            action:
              action === 'copy'
                ? 'create'
                : action === 'approve' || action === 'return'
                  ? 'review'
                  : action,
          });
          decisions[action] =
            result.effect !== 'deny' && result.conditions?.database
              ? {
                  policies: result.conditions.database,
                  delegate: access(c).delegate,
                  source:
                    sourceDecision.effect !== 'deny' &&
                    sourceDecision.conditions?.database
                      ? {
                          policies: sourceDecision.conditions.database,
                          delegate: access(c).delegate,
                        }
                      : undefined,
                }
              : null;
        }
        return c.json({
          data: await service.capabilities(
            c.req.valid('param').id,
            actor(c),
            access(c),
            decisions,
          ),
        });
      },
    );
    const materialService = app.container.resolve(
      supplyChainMaterialServiceToken,
    );
    const purposeService = app.container.resolve(issuePurposeServiceToken);
    const projection = z.record(z.string(), z.json());
    router.get(
      '/requestMaterialOptions',
      allowed('read'),
      describe(
        'issueRequestMaterialOptions',
        'Search company eligible materials under issue request permissions',
        listResponse(projection, materialOptionsMeta),
      ),
      apiValidator('query', materialOptionsQuery),
      async (c) =>
        c.json(
          await materialService.options(
            'requisitions',
            c.req.valid('query'),
            access(c).policies,
          ),
        ),
    );
    router.get(
      '/requestMaterialOptions/:id',
      allowed('read'),
      describe(
        'issueRequestMaterialOption',
        'Read a company eligible material and its exact unit rules',
        dataResponse(projection),
      ),
      apiValidator('param', issueParams),
      apiValidator('query', issueSettingsQuery),
      async (c) =>
        c.json(
          await service.materialOption(
            c.req.valid('query').subjectId,
            c.req.valid('param').id,
            access(c).policies,
          ),
        ),
    );
    router.post(
      '/requestMaterialSelections',
      allowed('read'),
      limit,
      describe(
        'issueRequestMaterialSelection',
        'Preview demand quantity without creating a request or governance task',
        dataResponse(materialSelectionOutput),
      ),
      apiValidator('json', materialSelectionInput),
      async (c) =>
        c.json({
          data: await materialService.resolveSelection(
            'requisitions',
            c.req.valid('json'),
            access(c).policies,
          ),
        }),
    );
    router.get(
      '/requestPurposeOptions',
      allowed('read'),
      describe(
        'issueRequestPurposeOptions',
        'Read active issue purposes in the authorized company',
        listResponse(issueOptionView, issueMeta),
      ),
      apiValidator(
        'query',
        issuePurposeQuery.omit({ status: true, orderBy: true }),
      ),
      async (c) => {
        const result = await purposeService.list(
          { ...c.req.valid('query'), status: 'active', orderBy: 'code' },
          access(c).policies,
        );
        return c.json({
          data: result.data.map((row) => ({
            id: row.id,
            code: row.code,
            name: row.name,
          })),
          meta: result.meta,
        });
      },
    );
    router.get(
      '/requests',
      allowed('read'),
      describe(
        'issueRequests',
        'List issue requests in an authorized company',
        listResponse(issueListView, issueMeta),
      ),
      apiValidator('query', issueQuery),
      async (c) => {
        const policies = await pageFieldPoliciesFor(db, principal(c), 'requisitions-requests');
        const result = await service.list(
          c.req.valid('query'),
          actor(c),
          access(c).policies,
        );
        return c.json({
          ...result,
          data: redactRows(
            result.data as Record<string, unknown>[],
            policies,
            HEAD_RESOURCE,
          ),
        });
      },
    );
    router.post(
      '/requests',
      allowed('create'),
      limit,
      describe(
        'createIssueRequest',
        'Create a draft issue request and stable lines atomically',
        dataResponse(issueView),
        true,
      ),
      apiValidator('json', issueCreate),
      async (c) => {
        const policies = await pageFieldPoliciesFor(db, principal(c), 'requisitions-requests-new');
        const input = c.req.valid('json');
        if (policies.length)
          await assertContentWritable(
            policies,
            input.content as unknown as Record<string, unknown>,
          );
        const data = await service.create(input, actor(c), access(c));
        return c.json(
          {
            data: redactIssueView(
              data as unknown as Record<string, unknown>,
              policies,
            ),
          },
          201,
        );
      },
    );
    router.get(
      '/requests/:id',
      allowed('read'),
      describe(
        'issueRequestDetail',
        'Read a issue request, lines and immutable review history',
        dataResponse(issueView),
      ),
      apiValidator('param', issueParams),
      async (c) => {
        const policies = await pageFieldPoliciesFor(db, principal(c), 'requisitions-requests-detail');
        const data = await service.detail(
          c.req.valid('param').id,
          access(c).policies,
        );
        return c.json({
          data: redactIssueView(
            data as unknown as Record<string, unknown>,
            policies,
          ),
        });
      },
    );
    router.get(
      '/requests/:id/history',
      allowed('read'),
      describe(
        'issueRequestHistory',
        'Read scoped issue request audit history',
        listResponse(issueAuditView, issueMeta),
      ),
      apiValidator('param', issueParams),
      apiValidator('query', issuePage),
      async (c) =>
        c.json(
          await service.history(
            c.req.valid('param').id,
            c.req.valid('query'),
            access(c).policies,
          ),
        ),
    );
    router.patch(
      '/requests/:id',
      allowed('update'),
      limit,
      describe(
        'updateIssueRequest',
        'Save draft content with business and lifecycle version checks',
        dataResponse(issueView),
      ),
      apiValidator('param', issueParams),
      apiValidator('json', issueUpdate),
      async (c) => {
        const policies = await pageFieldPoliciesFor(db, principal(c), pageKeyForRequest(c, 'requisitions-requests-list-edit', 'requisitions-requests-edit'));
        const input = c.req.valid('json');
        if (policies.length) {
          const current = await service.detail(
            c.req.valid('param').id,
            access(c).policies,
          );
          await assertContentWritable(
            policies,
            input.content as unknown as Record<string, unknown>,
            (current as unknown as { lines?: Record<string, unknown>[] }).lines,
          );
        }
        const data = await service.update(
          c.req.valid('param').id,
          input,
          actor(c),
          access(c),
        );
        return c.json({
          data: redactIssueView(
            data as unknown as Record<string, unknown>,
            policies,
          ),
        });
      },
    );
    router.post(
      '/requests/:id/copy',
      allowed('create'),
      limit,
      describe(
        'copyCancelledIssueRequest',
        'Copy a cancelled request into a linked new draft using current rules',
        dataResponse(issueView),
        true,
      ),
      apiValidator('param', issueParams),
      apiValidator('json', issueUpdate),
      async (c) => {
        const policies = await pageFieldPoliciesFor(db, principal(c), 'requisitions-requests-new');
        const input = c.req.valid('json');
        if (policies.length)
          await assertContentWritable(
            policies,
            input.content as unknown as Record<string, unknown>,
          );
        const data = await service.copy(
          c.req.valid('param').id,
          input,
          actor(c),
          access(c),
        );
        return c.json(
          {
            data: redactIssueView(
              data as unknown as Record<string, unknown>,
              policies,
            ),
          },
          201,
        );
      },
    );
    router.post(
      '/requests/:id/receive',
      allowed('read'),
      limit,
      describe(
        'receiveIssueRequest',
        'Confirm receipt of the issued quantities as the designated recipient',
        dataResponse(issueView),
      ),
      apiValidator('param', issueParams),
      apiValidator('json', issueReceive),
      async (c) => {
        const policies = await pageFieldPoliciesFor(db, principal(c), 'requisitions-requests-action');
        const data = await service.receive(
          c.req.valid('param').id,
          c.req.valid('json'),
          actor(c),
          access(c).policies,
        );
        return c.json({
          data: redactIssueView(
            data as unknown as Record<string, unknown>,
            policies,
          ),
        });
      },
    );
    // The action name comes from a code-owned path. Permission checks precede body validation.
    for (const transition of [
      'submit',
      'approve',
      'return',
      'withdraw',
      'revise',
      'cancel',
      'reassign',
    ] as const)
      router.post(
        `/requests/:id/${transition}`,
        allowed(
          transition === 'approve' || transition === 'return'
            ? 'review'
            : transition,
        ),
        limit,
        describe(
          `issueRequest${transition[0].toUpperCase()}${transition.slice(1)}`,
          `Apply the ${transition} issue request action`,
          dataResponse(issueView),
        ),
        apiValidator('param', issueParams),
        apiValidator('json', issueAction.omit({ transition: true })),
        async (c) => {
          const policies = await pageFieldPoliciesFor(db, principal(c), 'requisitions-requests-action');
          const data = await service.fire(
            c.req.valid('param').id,
            { ...c.req.valid('json'), transition },
            actor(c),
            access(c),
          );
          return c.json({
            data: redactIssueView(
              data as unknown as Record<string, unknown>,
              policies,
            ),
          });
        },
      );
    for (const [path, settings] of [
      ['/requestCompanies', false],
      ['/settings/companies', true],
    ] as const)
      router.get(
        path,
        allowed('read', settings),
        describe(
          settings ? 'issueSettingsCompanies' : 'issueRequestCompanies',
          'Search authorized companies for issue requests or review rules',
          listResponse(issueOptionView, issueCompanyMeta),
        ),
        apiValidator('query', issuePage),
        async (c) =>
          c.json(
            await service.companies(c.req.valid('query'), access(c).policies),
          ),
      );
    router.get(
      '/requestOptions',
      allowed('read'),
      describe(
        'issueRequestOptions',
        'Search minimal authorized company personnel and organization options',
        listResponse(issueOptionView, issueMeta),
      ),
      apiValidator('query', issueOptionQuery),
      async (c) =>
        c.json(
          await service.options(c.req.valid('query'), actor(c), access(c)),
        ),
    );
    router.get(
      '/settings',
      allowed('read', true),
      describe(
        'issueSettings',
        'Read company issue review rules and their revision',
        dataResponse(issueSettingsView),
      ),
      apiValidator('query', issueSettingsQuery),
      async (c) =>
        c.json({
          data: await service.settings(
            c.req.valid('query').subjectId,
            access(c).policies,
          ),
        }),
    );
    router.put(
      '/settings',
      allowed('update', true),
      limit,
      describe(
        'saveIssueSettings',
        'Save the complete issue review rule group with CAS and replay',
        dataResponse(issueSettingsView),
      ),
      apiValidator('json', issueSettingsSave),
      async (c) =>
        c.json({
          data: await service.saveSettings(
            c.req.valid('json'),
            actor(c),
            access(c).policies,
          ),
        }),
    );
    router.get(
      '/settings/options',
      allowed('read', true),
      describe(
        'issueSettingsOptions',
        'Search scoped review positions or eligible human accounts',
        listResponse(issueOptionView, issueMeta),
      ),
      apiValidator('query', issueOptionQuery),
      async (c) =>
        c.json(
          await service.options(
            c.req.valid('query'),
            actor(c),
            access(c),
            true,
          ),
        ),
    );
    const purposeAllowed = (action: string) =>
      createMiddleware<Env>(async (c, next) => {
        const result = await c.get('authz').authorize({
          resource: { type: 'composite', id: 'requisitions.purposes' },
          action,
        });
        if (result.effect === 'deny' || !result.conditions?.database)
          return issueError('ISSUE_FORBIDDEN', 'PERMISSION_DENIED');
        c.set('issueAccess', {
          policies: result.conditions.database,
          delegate: null,
        });
        await next();
      });
    router.get(
      '/purposeCompanies',
      purposeAllowed('read'),
      describe(
        'issuePurposeCompanies',
        'Read authorized purpose companies',
        listResponse(issueOptionView, issueMeta),
      ),
      apiValidator('query', issuePage),
      async (c) =>
        c.json(
          await purposeService.companies(
            c.req.valid('query'),
            access(c).policies,
          ),
        ),
    );
    router.get(
      '/purposes',
      purposeAllowed('read'),
      describe(
        'issuePurposes',
        'List company issue purposes',
        listResponse(issuePurposeView, issueMeta),
      ),
      apiValidator('query', issuePurposeQuery),
      async (c) => {
        const policies = await pageFieldPoliciesFor(db, principal(c), 'requisitions-purposes');
        const result = await purposeService.list(
          c.req.valid('query'),
          access(c).policies,
        );
        return c.json({
          ...result,
          data: redactRows(
            result.data as Record<string, unknown>[],
            policies,
            PURPOSE_RESOURCE,
          ),
        });
      },
    );
    router.post(
      '/purposes',
      purposeAllowed('create'),
      limit,
      describe(
        'createIssuePurpose',
        'Create an issue purpose',
        dataResponse(issuePurposeView),
        true,
      ),
      apiValidator('json', issuePurposeCreate),
      async (c) => {
        const policies = await pageFieldPoliciesFor(db, principal(c), 'requisitions-purposes-new');
        const input = c.req.valid('json');
        if (policies.length)
          await assertPurposeFields(
            policies,
            input.content as unknown as Record<string, unknown>,
          );
        const data = await purposeService.save(
          undefined,
          input,
          actor(c),
          access(c).policies,
        );
        return c.json(
          {
            data: redactRecord(
              data as unknown as Record<string, unknown>,
              policies,
              PURPOSE_RESOURCE,
            ),
          },
          201,
        );
      },
    );
    router.get(
      '/purposes/:id',
      purposeAllowed('read'),
      describe(
        'issuePurposeDetail',
        'Read an issue purpose',
        dataResponse(issuePurposeView),
      ),
      apiValidator('param', issueParams),
      async (c) => {
        const policies = await pageFieldPoliciesFor(db, principal(c), 'requisitions-purposes-detail');
        const data = await purposeService.detail(
          c.req.valid('param').id,
          access(c).policies,
        );
        return c.json({
          data: redactRecord(
            data as unknown as Record<string, unknown>,
            policies,
            PURPOSE_RESOURCE,
          ),
        });
      },
    );
    router.patch(
      '/purposes/:id',
      purposeAllowed('update'),
      limit,
      describe(
        'updateIssuePurpose',
        'Update an issue purpose with version protection',
        dataResponse(issuePurposeView),
      ),
      apiValidator('param', issueParams),
      apiValidator('json', issuePurposeUpdate),
      async (c) => {
        const policies = await pageFieldPoliciesFor(db, principal(c), pageKeyForRequest(c, 'requisitions-purposes-edit', 'requisitions-purposes-detail'));
        const input = c.req.valid('json');
        if (policies.length)
          await assertPurposeFields(
            policies,
            input.content as unknown as Record<string, unknown>,
          );
        const data = await purposeService.save(
          c.req.valid('param').id,
          input,
          actor(c),
          access(c).policies,
        );
        return c.json({
          data: redactRecord(
            data as unknown as Record<string, unknown>,
            policies,
            PURPOSE_RESOURCE,
          ),
        });
      },
    );
    for (const transition of ['activate', 'deactivate'] as const)
      router.post(
        `/purposes/:id/${transition}`,
        purposeAllowed(transition),
        limit,
        describe(
          `issuePurpose${transition}`,
          'Change issue purpose availability',
          dataResponse(issuePurposeView),
        ),
        apiValidator('param', issueParams),
        apiValidator('json', issuePurposeMutation),
        async (c) => {
          const policies = await pageFieldPoliciesFor(db, principal(c), 'requisitions-purposes-action');
          const data = await purposeService.save(
            c.req.valid('param').id,
            { ...c.req.valid('json'), transition },
            actor(c),
            access(c).policies,
          );
          return c.json({
            data: redactRecord(
              data as unknown as Record<string, unknown>,
              policies,
              PURPOSE_RESOURCE,
            ),
          });
        },
      );
    const root = new Hono();
    root.route('/requisitions', router);
    return root;
  });
