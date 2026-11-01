import type { CompositeResource } from '@nocobase/authorization/core';
import { defineDatabasePermission } from '@nocobase/app-plugin-authorization/server';
import { materialBaseColumns, materialColumns } from './material-model.js';
import { sourceColumns } from './material-source-model.js';
export const sourceReadColumns: Record<string, string[]> = {
  materialRequestSources: sourceColumns,
  materialRequests: [...materialBaseColumns, ...materialColumns.requests],
};
export const materialSourceResource: CompositeResource = {
  name: 'materials.sources',
  title: { key: 'materialSources.title', ns: 'group-erp' },
  actions: ['read', 'resolve'].map((action) => {
    const parts = Object.entries(sourceReadColumns).map(([table, columns]) =>
      defineDatabasePermission((p) => p.collection(table).read(columns))
        .bind(table)
        .build(),
    );
    return {
      name: action,
      title: { key: `materialSources.${action}`, ns: 'group-erp' },
      grants: parts.flatMap((p) => p.grants),
      dataScopes: parts.flatMap((p) => p.dataScopes ?? []),
    };
  }),
};
