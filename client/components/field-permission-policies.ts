export interface CatalogField {
  field: string;
  titleKey?: string;
  label: string;
}

export interface FieldPermissionResource {
  resource: string;
  titleKey: string;
  descriptionKey: string;
  fields: CatalogField[];
}

/** `auto` leaves a field unstored so the default field access applies. */
export type FieldAccess = 'auto' | 'hidden' | 'readonly' | 'write';

export interface FieldPolicy {
  resource: string;
  field: string;
  access: Exclude<FieldAccess, 'auto'>;
}

export const fieldPolicyKey = (resource: string, field: string) =>
  `${resource}.${field}`;

/**
 * Turn the editor's current levels into the policy payload. The payload covers
 * every catalog field, so saving one page can never erase another page's
 * policies; `auto` and `write` are defaults and are not stored.
 */
export function buildFieldPolicies(
  resources: readonly FieldPermissionResource[],
  levelOf: (resource: string, field: string) => FieldAccess,
): FieldPolicy[] {
  const policies: FieldPolicy[] = [];
  for (const resource of resources) {
    for (const field of resource.fields) {
      const access = levelOf(resource.resource, field.field);
      if (access === 'hidden' || access === 'readonly') {
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
