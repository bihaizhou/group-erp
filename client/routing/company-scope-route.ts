/**
 * A route that owns a company scope declares the company endpoint it is
 * allowed to use. The router gates the page, and the shell reads the same
 * declaration from the matched route — there is no global path table.
 *
 * `lockCompany` means the page may choose the company only before it opens:
 * the header switcher must not offer another company while the page is shown.
 */
declare module '@nocobase/app-client/plugins' {
  interface AppClientRoutePageDefinition {
    companyScope?: string;
    lockCompany?: boolean;
  }

  interface AppClientRouteGroupDefinition {
    companyScope?: string;
    lockCompany?: boolean;
  }

  interface AppClientRegisteredRoute {
    companyScope?: string;
    lockCompany?: boolean;
  }
}

export {};
