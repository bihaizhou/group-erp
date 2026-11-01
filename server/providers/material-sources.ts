import type { Application } from '@nocobase/app-server/application';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import { userAdministrationServiceToken } from '@nocobase/app-plugin-authentication';
import { databaseManagerToken, type DatabaseConnection } from '@nocobase/db';
import {
  ServiceProvider,
  createServiceToken,
} from '@nocobase/service-provider';
import { materialServiceToken } from './materials.js';
import { purchaseRequestServiceToken } from './procurement.js';
import { issueRequestServiceToken } from './requisitions.js';
import { supplyChainMaterialServiceToken } from './supply-chain.js';
import { recordLifecycleToken } from './record-lifecycle.js';
import { MaterialSourceService } from './material-source-service.js';
import { materialSourceResource } from './material-source-resources.js';
import { sourceError, type SourceKind } from './material-source-model.js';
export const materialSourceServiceToken =
  createServiceToken<MaterialSourceService>('group-erp/material-sources');
export default class MaterialSourcesProvider extends ServiceProvider<Application> {
  readonly name = 'group-erp/material-sources';
  override register() {
    this.app.container.singleton(materialSourceServiceToken, () => {
      const authz = this.app.container.resolve(authorizationToken),
        users = this.app.container.resolve(userAdministrationServiceToken);
      const context = async (c: DatabaseConnection | undefined, id: string) => {
        const user = await (c ? users.withConnection(c) : users).get(id);
        if (!user || user.disabledAt || user.kind !== 'person')
          return sourceError('SUPPLY_FORBIDDEN', 'PERMISSION_DENIED');
        const principal = { type: 'user', id };
        return authz.for({
          principal,
          subjects: [
            { type: 'authenticated', id: '*' },
            ...(await authz.subjects.resolveFor(principal)),
          ],
        });
      };
      return new MaterialSourceService(
        this.app.container.resolve(databaseManagerToken),
        this.app.container.resolve(recordLifecycleToken),
        this.app.container.resolve(materialServiceToken),
        this.app.container.resolve(supplyChainMaterialServiceToken),
        async (c, kind: SourceKind, id) => {
          const ctx = await context(c, id),
            resource = {
              type: 'composite' as const,
              id:
                kind === 'purchaseRequestLine'
                  ? 'procurement.requests'
                  : 'requisitions.requests',
            };
          const decision = await ctx.authorize({
              resource,
              action: 'confirmMaterial',
            }),
            delegate = await ctx.authorize({ resource, action: 'delegate' });
          if (decision.effect === 'deny' || !decision.conditions?.database)
            return sourceError('SUPPLY_FORBIDDEN', 'PERMISSION_DENIED');
          return {
            policies: decision.conditions.database,
            delegate:
              delegate.effect === 'deny'
                ? null
                : (delegate.conditions?.database ?? null),
          };
        },
        async (id, action) => {
          const decision = await (
            await context(undefined, id)
          ).authorize({
            resource: { type: 'composite', id: 'materials.sources' },
            action,
          });
          if (decision.effect === 'deny' || !decision.conditions?.database)
            return sourceError('SUPPLY_FORBIDDEN', 'PERMISSION_DENIED');
          return decision.conditions.database;
        },
        async (c, id) => {
          const user = await users.withConnection(c).get(id);
          return !!user && !user.disabledAt && user.kind === 'person';
        },
        async (c, id) => {
          const user = await users.withConnection(c).get(id);
          return user?.name ?? user?.username ?? null;
        },
      );
    });
  }
  override async boot() {
    const authz = this.app.container.resolve(authorizationToken);
    authz.database.collections.add({
      name: 'materialRequestSources',
      title: { key: 'materialSources.title', ns: 'group-erp' },
    });
    authz.ui.place(authz.compositeResources.define(materialSourceResource), {
      section: 'group-erp.materials',
    });
    const service = this.app.container.resolve(materialSourceServiceToken);
    service.register(
      this.app.container
        .resolve(purchaseRequestServiceToken)
        .attachSources(service),
    );
    service.register(
      this.app.container
        .resolve(issueRequestServiceToken)
        .attachSources(service),
    );
    this.app.container.resolve(materialServiceToken).attachSources(service);
  }
}
