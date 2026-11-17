/**
 * A page declares the field-catalogue resources it reads. The permission
 * editor uses the same declaration to build the page's field drawer, so a
 * brand-new module does not need a second registry entry in settings.
 */
declare module '@nocobase/app-client/plugins' {
  interface AppClientRoutePageDefinition {
    dataResources?: readonly string[];
  }

  interface AppClientRegisteredRoute {
    dataResources?: readonly string[];
  }
}

export {};
