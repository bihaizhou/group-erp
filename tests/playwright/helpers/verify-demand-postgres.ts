import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { databaseManagerToken, type DatabaseConnection } from '@nocobase/db';
import { createTestApp } from '@nocobase/app-testing/server';
import { createStandaloneServer } from '../../../server/standalone.js';
import { recordLifecycleToken } from '../../../server/providers/record-lifecycle.js';
import {
  fixture,
  purchaseMaterial,
  send,
  mutation,
} from '../../helpers/purchase-requests.js';

// Run prepare and verify in separate processes around an external restart of
// the task-owned PostgreSQL container. No other test may clean this schema
// between the two phases. This deliberately refuses the real ERP database.
const directory = process.env.A24_PERSISTENCE_DIRECTORY ?? '';
assert(directory.startsWith('/tmp/group-erp-a24-persistence-'));
assert.equal(process.env.NOCOBASE_TEST_DB_DIALECT, 'postgres');
const statePath = path.join(directory, 'state.json');
async function started(c: DatabaseConnection) {
  const client = await c.client<{
    raw(
      sql: string,
    ): Promise<{ rows: { started: Date; database: string; actor: string }[] }>;
  }>();
  const { rows } = await client.raw(
    'select pg_postmaster_start_time() as started, current_database() as database, current_user as actor',
  );
  assert.equal(rows[0].database, 'group_erp_a23_verify_20261018');
  assert.equal(rows[0].actor, 'a23_runtime');
  return rows[0].started.toISOString();
}
if (process.argv[2] === 'prepare') {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const app = await createTestApp({
    createServer: createStandaloneServer,
    config: {
      app: { publicOrigin: 'http://localhost' },
      secrets: { keys: [{ version: 1, key: randomBytes(32).toString('hex') }] },
      jobs: { default: 'memory' },
      queue: { default: 'memory' },
      logging: { console: { enabled: false }, file: { enabled: false } },
    },
  });
  let prepared = false;
  try {
    const postgresStartedAt = await started(app.connection),
      f = await fixture(app, app.database),
      m = await purchaseMaterial(f, app.database);
    for (const [permissionSet, id] of [
      ['requisitions-requester', f.applicant.user.id],
      ['requisitions-source-requester', f.applicant.user.id],
      ['requisitions-request-reviewer', f.reviewer.user.id],
    ] as const)
      await f.authz.permissionSets.assign({
        permissionSet,
        subject: { type: 'user', id },
      });
    const purpose = await f.create('/requisitions/purposes', {
      content: {
        subjectId: f.a.id,
        code: 'PERSIST',
        name: 'Restart verification',
        description: 'Synthetic isolated fixture',
      },
      requestKey: randomUUID(),
    });
    const configured = await send(
      f.admin,
      '/requisitions/settings',
      {
        subjectId: f.a.id,
        version: 0,
        requestKey: randomUUID(),
        values: f.rules(),
      },
      'PUT',
    );
    assert.equal(configured.status, 200);
    const original = f.content(),
      { suggestedSupplierId: _supplier, ...base } = original;
    const content = {
      ...base,
      recipientEmployeeId: f.applicant.employee.id,
      purposeId: purpose.id,
      lines: [...m.content.lines, f.line()],
    };
    const created = await send(f.applicant.session, '/requisitions/requests', {
      content,
      requestKey: randomUUID(),
    });
    assert.equal(created.status, 201);
    let row = (await created.json()).data;
    const bytes = await readFile(
      new URL(
        '../../fixtures/demand-files/specification.docx',
        import.meta.url,
      ),
    );
    const form = new FormData();
    form.set(
      'file',
      new File([bytes], 'restart.docx', {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
    );
    const upload = await f.applicant.session.fetch(
      `/supplyChainFiles/uploadOne?domain=requisitions&requestId=${row.id}`,
      { method: 'POST', headers: { origin: 'http://localhost' }, body: form },
    );
    assert.equal(upload.status, 201);
    const file = (await upload.json()).data.record;
    const saved = await send(
      f.applicant.session,
      `/requisitions/requests/${row.id}`,
      {
        ...mutation(row),
        content: {
          ...content,
          attachments: [
            {
              fileId: file.id,
              lineId: row.lines[1].id,
              shareWithGovernance: true,
            },
          ],
        },
      },
      'PATCH',
    );
    assert.equal(saved.status, 200);
    row = (await saved.json()).data;
    for (const action of ['submit', 'approve']) {
      const response = await send(
        action === 'submit' ? f.applicant.session : f.reviewer.session,
        `/requisitions/requests/${row.id}/${action}`,
        mutation(row),
      );
      assert.equal(response.status, 200);
      row = (await response.json()).data;
    }
    const sourcesBefore = (
      await (
        await f.applicant.session.fetch(
          `/requisitions/requests/${row.id}/sources`,
        )
      ).json()
    ).data;
    const source = sourcesBefore[0];
    assert.ok(source);
    const task = (
      await (
        await f.admin.fetch(`/materials/requests/${source.requestId}`)
      ).json()
    ).data;
    const resolved = await send(
      f.admin,
      `/materials/requests/${task.id}/resolve`,
      {
        version: task.lifecycleVersion,
        requestKey: randomUUID(),
        resolvedSkuId: m.sku.id,
        reason: 'Restart candidate verification',
      },
    );
    assert.equal(resolved.status, 200);
    row = (
      await (
        await f.applicant.session.fetch(`/requisitions/requests/${row.id}`)
      ).json()
    ).data;
    assert.equal(row.status, 'approved');
    assert.equal(row.lines[1].skuId, null);
    assert.equal(row.lines[1].identificationStatus, 'awaitingConfirmation');
    const sources = (
      await (
        await f.applicant.session.fetch(
          `/requisitions/requests/${row.id}/sources`,
        )
      ).json()
    ).data;
    const history = await app.application.container
      .resolve(recordLifecycleToken)
      .history('materialIssueRequests', row.id);
    const config = JSON.parse(await readFile(app.config.path, 'utf8')) as {
      database: { connections: { main: { schema: string } } };
    };
    await writeFile(
      statePath,
      JSON.stringify({
        configPath: app.config.path,
        configDirectory: app.config.directory,
        schema: config.database.connections.main.schema,
        postgresStartedAt,
        cookie: f.applicant.session.cookie,
        row,
        sources,
        history,
        file: { id: file.id, contentUrl: file.contentUrl },
        bytes: bytes.toString('base64'),
      }),
      { mode: 0o600 },
    );
    prepared = true;
    console.log(
      JSON.stringify({
        phase: 'prepared',
        dialect: 'postgres',
        requestKind: 'materialIssueRequest',
        status: row.status,
        sourceStatus: sources[0].status,
        frozenVersions: row.versions.length,
        privateFile: true,
      }),
    );
  } finally {
    if (prepared) await app.server.close();
    else await app.close();
  }
} else if (process.argv[2] === 'verify') {
  const state = JSON.parse(await readFile(statePath, 'utf8')) as {
    configPath: string;
    configDirectory: string;
    schema: string;
    postgresStartedAt: string;
    cookie: string;
    row: { id: string };
    sources: unknown;
    history: unknown;
    file: { id: string; contentUrl: string };
    bytes: string;
  };
  assert(state.configDirectory.startsWith('/tmp/nocobase-test-app-'));
  const server = await createStandaloneServer({
    viteDevUrl: false,
    configPath: state.configPath,
    env: { APP_STORAGE_DIR: path.join(state.configDirectory, 'storage') },
  });
  try {
    const c = server.application.container
      .resolve(databaseManagerToken)
      .connection();
    assert.notEqual(await started(c), state.postgresStartedAt);
    const get = async (url: string) =>
      server.fetch(
        new Request(new URL(url, 'http://localhost'), {
          headers: { cookie: state.cookie },
        }),
      );
    const prefix = `${server.application.publicBasePath}/api/requisitions/requests/${state.row.id}`;
    const response = await get(prefix);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).data, state.row);
    const sources = await get(prefix + '/sources');
    assert.equal(sources.status, 200);
    assert.deepEqual((await sources.json()).data, state.sources);
    const file = await get(state.file.contentUrl);
    assert.equal(file.status, 200);
    assert.equal(file.headers.get('Cache-Control'), 'private, no-store');
    assert.deepEqual(
      Buffer.from(await file.arrayBuffer()),
      Buffer.from(state.bytes, 'base64'),
    );
    const history = await server.application.container
      .resolve(recordLifecycleToken)
      .history('materialIssueRequests', state.row.id);
    assert.deepEqual(JSON.parse(JSON.stringify(history)), state.history);
    const evidence = {
      verifiedAt: new Date().toISOString(),
      processRestarted: true,
      postgresRestartedExternally: true,
      originalSessionPreserved: true,
      completeIssueRequestUnchanged: true,
      frozenContentAndRulesUnchanged: true,
      currentCandidateUnchanged: true,
      privateFileBytesUnchanged: true,
      lifecycleHistoryUnchanged: true,
    };
    await writeFile(
      path.join(directory, 'result.json'),
      JSON.stringify(evidence, null, 2) + '\n',
    );
    console.log(JSON.stringify(evidence));
  } finally {
    await server.close();
  }
} else throw new Error('Expected prepare or verify');
