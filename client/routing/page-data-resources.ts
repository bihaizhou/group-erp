const pageDataResources = new Map<string, readonly string[]>();

/**
 * A page declares the field-catalogue resources it reads. The route resolver
 * only keeps known routing keys, so the declaration lives in this side map
 * instead of on the route object.
 */
export function declarePageDataResources(
  pageKey: string,
  resources: readonly string[],
): void {
  pageDataResources.set(pageKey, resources);
}

export function pageDataResourcesFor(
  pageKey: string | undefined,
): readonly string[] | undefined {
  return pageKey ? pageDataResources.get(pageKey) : undefined;
}
