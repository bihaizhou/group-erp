/**
 * A route that owns a company scope declares the company endpoint it is
 * allowed to use. The router gates the page, and the shell reads the same
 * declaration from the matched route — there is no global path table.
 */
declare module '@nocobase/app-client/plugins' {
  interface AppClientRoutePageDefinition {
    companyScope?: string;
  }

  interface AppClientRouteGroupDefinition {
    companyScope?: string;
  }

  interface AppClientRegisteredRoute {
    companyScope?: string;
  }
}

export {};
