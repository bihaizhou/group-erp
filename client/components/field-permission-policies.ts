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

export type FieldAccess = 'hidden' | 'readonly' | 'write';

export interface FieldPolicy {
  resource: string;
  field: string;
  access: FieldAccess;
}

export const fieldPolicyKey = (resource: string, field: string) =>
  `${resource}.${field}`;

/**
 * Turn the editor's current levels into the policy payload. The payload covers
 * every catalog field, so saving one page can never erase another page's
 * policies; `write` is the default and is not stored.
 */
export function buildFieldPolicies(
  resources: readonly FieldPermissionResource[],
  levelOf: (resource: string, field: string) => FieldAccess,
): FieldPolicy[] {
  return resources
    .flatMap((resource) =>
      resource.fields.map((field) => ({
        resource: resource.resource,
        field: field.field,
        access: levelOf(resource.resource, field.field),
      })),
    )
    .filter((policy) => policy.access !== 'write');
}
