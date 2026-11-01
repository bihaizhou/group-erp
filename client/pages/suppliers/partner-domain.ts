import { createContext, useContext } from 'react';
import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
const configs = {
  supplier: {
    resource: 'procurement.suppliers',
    namespace: 'procurement',
    cache: 'suppliers',
    rootPath: '/functions/procurement/suppliers',
  },
  customer: {
    resource: 'sales.customers',
    namespace: 'customers',
    cache: 'customers',
    rootPath: '/functions/sales/customers',
  },
} as const;
export const PartnerContext = createContext<keyof typeof configs>('supplier');
/** Share the existing counterparty presentation while roles, grants and caches stay independent. */
export function usePartnerConfig() {
  const role = useContext(PartnerContext);
  return { ...configs[role], role };
}
export function usePartnerTranslation() {
  const translation = useTranslation(),
    config = usePartnerConfig();
  return {
    ...translation,
    t: (key: string, options?: Record<string, unknown>) =>
      translation.t(
        config.role === 'customer'
          ? key
              .replace(/^procurement\./u, 'customers.')
              .replace(/CUSTOMER_/gu, 'SUPPLIER_')
          : key,
        options,
      ),
  };
}
export function usePartnerApi() {
  const api = useApiClient(),
    { role } = usePartnerConfig();
  return {
    request: <T>(options: Parameters<typeof api.request>[0]) =>
      api.request<T>({
        ...options,
        path:
          role === 'customer'
            ? options.path.replace(/^procurement\/supplier/u, 'sales/customer')
            : options.path,
      }),
  };
}
