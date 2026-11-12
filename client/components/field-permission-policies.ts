export interface CatalogField {
  field: string;
  titleKey?: string;
  label: string;
  /**
   * False when the page renders the value but users can never edit it
   * directly (computed values, workflow status, auto numbers, audits). The
   * permission editor greys out the write option for such fields.
   */
  writable?: boolean;
}

export interface FieldPermissionResource {
  resource: string;
  titleKey: string;
  descriptionKey: string;
  fields: CatalogField[];
}

export type FieldAccess = 'hidden' | 'visible' | 'write';

export interface FieldPolicy {
  resource: string;
  field: string;
  access: Exclude<FieldAccess, 'hidden'>;
}

export const fieldPolicyKey = (resource: string, field: string) =>
  `${resource}.${field}`;

/**
 * Turn the editor's current levels into the policy payload. The payload
 * covers every catalog field, so saving one page can never erase another
 * page's policies. `undefined` (and the client-only `hidden` marker) mean
 * "not granted", which the server treats as hidden; only explicit grants
 * (visible/write) are stored — an unchecked field stays unchecked.
 */
export function buildFieldPolicies(
  resources: readonly FieldPermissionResource[],
  levelOf: (resource: string, field: string) => FieldAccess | undefined,
): FieldPolicy[] {
  const policies: FieldPolicy[] = [];
  for (const resource of resources) {
    for (const field of resource.fields) {
      const access = levelOf(resource.resource, field.field);
      if (access && access !== 'hidden') {
        policies.push({
          resource: resource.resource,
          field: field.field,
          access,
        });
      }
    }
  }
  return policies;
}
