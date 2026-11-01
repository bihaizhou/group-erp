import {
  resolveAppClientContributions,
  type AppClientRegisteredRoute,
} from '@nocobase/app-client/plugins';
import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import applicationRoutes from '../../client/routes.ts';

/**
 * This is a report generator, not a CI test: it signs in to a running local app,
 * creates a throwaway user, assigns one permission set at a time and records what
 * that user can actually open. Enable it explicitly:
 *
 *   ROLE_MATRIX=1 ERP_BASE=http://127.0.0.1:13000/main pnpm vitest run tests/logic/role-matrix.test.ts
 */
const enabled = Boolean(process.env.ROLE_MATRIX);
const base = process.env.ERP_BASE ?? 'http://127.0.0.1:13000/main';
const adminEmail = process.env.ERP_ADMIN_EMAIL ?? 'admin@nocobase.com';
const adminPassword = process.env.ERP_ADMIN_PASSWORD ?? 'Erp-Local-2026!';

interface Permission {
  resource: { type: string; id: string };
  actions: string[];
}
interface Snapshot {
  unrestricted: boolean;
  permissions: Permission[];
}
interface Page {
  name: string;
  path: string;
  authz: { resource: { type: string; id: string }; action: string };
}
interface SetInfo {
  key: string;
  title: string;
  grants: {
    resource: { type: string; id: string };
    actions: { action: string }[];
  }[];
}

function cookiesFrom(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
}

async function signIn(email: string, password: string): Promise<string> {
  const response = await fetch(`${base}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: base.replace(/\/main$/, ''),
    },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok)
    throw new Error(`sign-in failed for ${email}: ${response.status}`);
  return cookiesFrom(response);
}

async function api(
  cookie: string,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<Response> {
  return fetch(`${base}/api/${path}`, {
    method: init.method ?? 'GET',
    headers: {
      ...(init.body === undefined
        ? {}
        : { 'Content-Type': 'application/json' }),
      Cookie: cookie,
      Origin: base.replace(/\/main$/, ''),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

function pageList(): Page[] {
  const resolved = resolveAppClientContributions([
    {
      packageName: '@nocobase/app-template-default',
      routes: applicationRoutes,
      source: 'application',
    },
  ]);
  const pages: Page[] = [];
  const walk = (routes: readonly AppClientRegisteredRoute[]) => {
    for (const route of routes) {
      const authz = route.authz as Page['authz'] | undefined;
      if (route.componentLoader && authz?.resource && authz.action) {
        pages.push({ name: route.name, path: route.path, authz });
      }
      if (route.children) walk(route.children);
    }
  };
  walk(resolved.routes);
  return pages.sort((a, b) => a.path.localeCompare(b.path));
}

function allowed(snapshot: Snapshot, page: Page): boolean {
  if (snapshot.unrestricted) return true;
  const { type, id } = page.authz.resource;
  return snapshot.permissions.some(
    (permission) =>
      permission.resource.type === type &&
      (permission.resource.id === '*' || permission.resource.id === id) &&
      permission.actions.includes(page.authz.action),
  );
}

function grantsToSnapshot(grants: SetInfo['grants']): Snapshot {
  return {
    unrestricted: false,
    permissions: grants.map((grant) => ({
      resource: grant.resource,
      actions: grant.actions.map((action) => action.action),
    })),
  };
}

describe.skipIf(!enabled)('role matrix', () => {
  it('writes the effective page matrix for every permission set', async () => {
    const admin = await signIn(adminEmail, adminPassword);
    const stamp = Date.now();
    const email = `role-matrix-${stamp}@test.local`;
    const password = `Matrix-${stamp}!`;
    const created = await api(admin, 'users', {
      method: 'POST',
      body: { name: 'role matrix probe', email, password },
    });
    expect(created.status).toBe(201);
    const userId = ((await created.json()) as { data: { id: string } }).data.id;

    try {
      const session = await signIn(email, password);
      const pages = pageList();
      const setsResponse = await api(admin, 'authorization/permissionSets');
      const sets = ((await setsResponse.json()) as { data: SetInfo[] }).data;
      const business = sets.filter(
        (set) => set.key !== 'root' && set.grants.length > 0,
      );
      const assignments = await Promise.all(
        sets.map(async (set) => {
          const response = await api(
            admin,
            `authorization/permissionSets/${set.key}/assignments`,
          );
          const data = ((await response.json()) as { data: unknown[] }).data;
          return [set.key, data.length] as const;
        }),
      );
      const memberCount = new Map(assignments);

      const rows: {
        set: SetInfo;
        pages: Page[];
        expected: Page[];
        actual: Page[];
        mismatch: boolean;
        skip?: string;
      }[] = [];
      for (const set of business) {
        const assignment = await api(
          admin,
          `authorization/permissionSets/${set.key}/assignments`,
          {
            method: 'POST',
            body: { subject: { type: 'user', id: userId } },
          },
        );
        if (!assignment.ok) {
          rows.push({
            set,
            pages: [],
            expected: [],
            actual: [],
            mismatch: false,
            skip: `${assignment.status}`,
          });
          continue;
        }
        const assignmentId = (
          (await assignment.json()) as { data: { id: string } }
        ).data.id;
        const snapshot = (
          (await (await api(session, 'authorization/permissions')).json()) as {
            data: Snapshot;
          }
        ).data;
        const expected = pages.filter((page) =>
          allowed(grantsToSnapshot(set.grants), page),
        );
        const actual = pages.filter((page) => allowed(snapshot, page));
        const expectedPaths = expected.map((page) => page.path).join('\n');
        const actualPaths = actual.map((page) => page.path).join('\n');
        rows.push({
          set,
          pages,
          expected,
          actual,
          mismatch: expectedPaths !== actualPaths,
        });
        await api(
          admin,
          `authorization/permissionSets/${set.key}/assignments/${assignmentId}`,
          {
            method: 'DELETE',
          },
        );
      }

      const granted = new Set(
        rows.flatMap((row) => row.actual.map((page) => page.path)),
      );
      const rootOnly = pages.filter((page) => !granted.has(page.path));
      const mismatches = rows.filter((row) => row.mismatch);
      const noMembers = rows.filter(
        (row) => (memberCount.get(row.set.key) ?? 0) === 0,
      );
      const lines: string[] = [];
      lines.push('# 角色权限矩阵', '');
      lines.push(
        `生成时间：${new Date().toISOString()}；本地库：${base}。`,
        '',
      );
      lines.push(
        '由临时账号逐个授予权限集后读取 `authorization/permissions` 得到，不是按 grants 推断。',
        '',
      );
      lines.push('## 摘要', '');
      lines.push(
        `- 权限集：${sets.length} 个；参与校验：${rows.length} 个；空 grants 跳过：${sets.length - business.length - 1} 个。`,
      );
      lines.push(
        `- 已登录页面：${pages.length} 个；没有任何参与校验的权限集可访问：${rootOnly.length} 个。`,
      );
      lines.push(`- 期望与实际不一致：${mismatches.length} 个。`);
      lines.push(`- 有 grants 但没有任何成员：${noMembers.length} 个。`, '');
      if (mismatches.length) {
        lines.push('## 不一致', '');
        for (const row of mismatches) lines.push(`- \`${row.set.key}\``);
        lines.push('');
      }
      if (rootOnly.length) {
        lines.push('## 仅 root 可访问的页面', '');
        for (const page of rootOnly)
          lines.push(`- \`${page.path}\`（${page.name}）`);
        lines.push('');
      }
      lines.push('## 角色 → 页面', '');
      for (const row of rows) {
        if (row.skip) {
          lines.push(
            `### ${row.set.title || row.set.key}（\`${row.set.key}\`）`,
            '',
            `未参与：分配失败 ${row.skip}`,
            '',
          );
          continue;
        }
        lines.push(
          `### ${row.set.title || row.set.key}（\`${row.set.key}\`）`,
          '',
          `成员 ${memberCount.get(row.set.key) ?? 0}；可访问 ${row.actual.length} 页。`,
          '',
        );
        for (const page of row.actual) lines.push(`- \`${page.path}\``);
        lines.push('');
      }
      writeFileSync(
        'docs/角色权限矩阵-2026-10-23.md',
        lines.join('\n'),
        'utf8',
      );
      expect(mismatches).toHaveLength(0);
    } finally {
      await api(admin, `users/${userId}`, { method: 'DELETE' });
    }
  }, 180_000);
});
