import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { databaseManagerToken, type DatabaseConnection } from '@nocobase/db';
import { createTestApp } from '@nocobase/app-testing/server';
import { createStandaloneServer } from '../../../server/standalone.js';
import { recordLifecycleToken } from '../../../server/providers/record-lifecycle.js';
import { fixture, send } from '../../helpers/purchase-requests.js';

// Two separate processes, with an external restart of the disposable PostgreSQL
// container between prepare and verify. Never point this probe at a real app.
const directory = process.env.A22_PERSISTENCE_DIRECTORY ?? '';
assert(directory.startsWith('/tmp/group-erp-a22-verify/'));
assert.equal(process.env.NOCOBASE_TEST_DB_DIALECT, 'postgres');
const statePath = path.join(directory, 'persistence-state.json');
const databaseStart = async (connection: DatabaseConnection) => {
  const client = await connection.client<{
    raw(
      sql: string,
    ): Promise<{ rows: { started: Date; database: string; actor: string }[] }>;
  }>();
  const result = await client.raw(
    'select pg_postmaster_start_time() as started, current_database() as database, current_user as actor',
  );
  assert.equal(result.rows[0].database, 'group_erp_a22_verify_20261018');
  assert.equal(result.rows[0].actor, 'a22_runtime');
  return result.rows[0].started.toISOString();
};
const command = process.argv[2];
if (command === 'prepare') {
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
    assert.equal(app.connection.dialect, 'postgres');
    const postgresStartedAt = await databaseStart(app.connection);
    const f = await fixture(app, app.database);
    await f.authz.permissionSets.assign({
      permissionSet: 'materials-reviewer',
      subject: { type: 'user', id: f.reviewer.user.id },
    });
    const rules = await f.saveRules();
    const activate = async (
      kind: string,
      initial: { id: string; lifecycleVersion: number },
    ) => {
      let row = initial;
      for (const transition of ['submit', 'approve']) {
        const response = await send(
          transition === 'submit' ? f.admin : f.reviewer.session,
          `/materials/${kind}/${row.id}/${transition}`,
          {
            version: row.lifecycleVersion,
            requestKey: randomUUID(),
            reason: 'Isolated PostgreSQL persistence verification',
          },
        );
        assert.equal(response.status, 200);
        row = (await response.json()).data;
      }
      return row;
    };
    const template = await f.create('/materials/templates', {
      name: 'Persistence specification',
      fields: [
        {
          key: 'model',
          title: 'Model',
          type: 'text',
          identity: true,
          required: true,
        },
      ],
    });
    const name = await f.create('/materials/names', {
      name: 'Persistence gloves',
      templateId: template.id,
    });
    const each = await f.create('/materials/units', {
      name: 'Persistence fractional each',
      unitType: 'count',
      precision: 3,
    });
    const box = await f.create('/materials/units', {
      name: 'Persistence fractional box',
      unitType: 'package',
      precision: 3,
    });
    const sku = await activate(
      'skus',
      await f.create('/materials/skus', {
        name: 'Persistence model A',
        materialNameId: name.id,
        baseUnitId: String(each!.id),
        managementMode: 'stock',
        attributeValues: { model: 'A' },
      }),
    );
    await f.create('/materials/subjectSettings', {
      name: 'Persistence admission',
      subjectId: f.a.id,
      skuId: sku.id,
      canPurchase: true,
      canSell: false,
    });
    const pack = await activate(
      'unitRules',
      await f.create('/materials/unitRules', {
        name: 'Twelve each per box',
        skuId: sku.id,
        unitId: String(box!.id),
        numerator: '12',
        denominator: '1',
      }),
    );
    let row = await f.draft({
      ...f.content(),
      lines: [
        {
          ...f.line(),
          selection: {
            kind: 'known',
            subjectId: f.a.id,
            skuId: sku.id,
            unitId: String(box!.id),
            unitRuleId: pack.id,
            quantity: '3.125',
          },
        },
        {
          ...f.line(),
          selection: {
            ...f.line().selection,
            quantity: '9007199254740993.125',
          },
        },
      ],
    });
    row = await f.fire(row, 'submit');
    row = await f.fire(row, 'approve', f.reviewer.session);
    assert.equal(row.lines[0].baseQuantity, '37.5');
    assert.equal(row.lines[1].requestedQuantity, '9007199254740993.125');
    await f.saveRules(f.rules([f.agent.user.id], false), rules.revision);
    const history = await app.application.container
      .resolve(recordLifecycleToken)
      .history('purchaseRequests', row.id);
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
        history,
      }),
      { mode: 0o600 },
    );
    prepared = true;
    console.log(
      JSON.stringify({
        phase: 'prepared',
        dialect: app.connection.dialect,
        requestId: row.id,
        baseQuantity: '37.5',
        exactUnknownQuantity: '9007199254740993.125',
      }),
    );
  } finally {
    if (prepared) await app.server.close();
    else await app.close();
  }
} else if (command === 'verify') {
  const state = JSON.parse(await readFile(statePath, 'utf8')) as {
    configPath: string;
    configDirectory: string;
    cookie: string;
    row: { id: string };
    history: unknown;
    postgresStartedAt: string;
  };
  assert(state.configDirectory.startsWith('/tmp/nocobase-test-app-'));
  const server = await createStandaloneServer({
    viteDevUrl: false,
    configPath: state.configPath,
    env: { APP_STORAGE_DIR: path.join(state.configDirectory, 'storage') },
  });
  try {
    const postgresStartedAt = await databaseStart(
      server.application.container.resolve(databaseManagerToken).connection(),
    );
    assert.notEqual(
      postgresStartedAt,
      state.postgresStartedAt,
      'The isolated PostgreSQL server must actually restart between phases',
    );
    const response = await server.fetch(
      new Request(
        `http://localhost${server.application.publicBasePath}/api/procurement/requests/${state.row.id}`,
        { headers: { cookie: state.cookie } },
      ),
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as { data: unknown };
    assert.deepEqual(body.data, state.row);
    const history = await server.application.container
      .resolve(recordLifecycleToken)
      .history('purchaseRequests', state.row.id);
    // JSON normalizes the Date values saved by the first process.
    assert.deepEqual(JSON.parse(JSON.stringify(history)), state.history);
    const evidence = {
      verifiedAt: new Date().toISOString(),
      processRestarted: true,
      postgresRestartedExternally: true,
      authenticatedSessionPreserved: true,
      completeRequestUnchanged: true,
      frozenContentAndRulesUnchanged: true,
      lifecycleHistoryUnchanged: true,
      baseQuantity: '37.5',
      exactUnknownQuantity: '9007199254740993.125',
    };
    await writeFile(
      path.join(directory, 'persistence-result.json'),
      JSON.stringify(evidence, null, 2) + '\n',
    );
    console.log(JSON.stringify(evidence));
  } finally {
    await server.close();
  }
} else throw new Error('Expected prepare or verify');
