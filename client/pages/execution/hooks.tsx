import { ApiClientError, useApiClient } from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRetainedQueryData } from '#hooks/use-retained-query-data';
export {
  useRequestKey,
  useLeaveGuard,
  useIssueReturnFocus as useReturnFocus,
  useConfirm as useDiscard,
} from '../requisitions/requests/hooks.js';
export const ui = (key: string) => `execution.${key}`;
export function useExecutionCan(resource: string, action: string) {
  return useCan({ resource: { type: 'composite', id: resource }, action });
}
export function useExecutionQuery<T>(
  path: string,
  query: Record<string, string | number> = {},
  enabled = true,
  previous = false,
) {
  const api = useApiClient(),
    result = useQuery({
      queryKey: ['execution', path, query],
      enabled,
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnMount: 'always',
      queryFn: ({ signal }) => api.request<T>({ path, query, signal }),
      placeholderData: previous
        ? (old, prior) => {
            const previousQuery = prior?.queryKey[2] as
              typeof query | undefined;
            return previousQuery?.subjectId === query.subjectId &&
              previousQuery?.warehouseId === query.warehouseId &&
              previousQuery?.direction === query.direction
              ? old
              : undefined;
          }
        : undefined,
    }),
    retained = useRetainedQueryData(
      JSON.stringify([
        path,
        query.subjectId,
        query.warehouseId,
        query.direction,
      ]),
      result,
      previous && enabled,
    );
  return {
    ...result,
    data: retained.data,
    isStaleFallback: retained.isStaleFallback,
    isPlaceholderData: result.isPlaceholderData || retained.isStaleFallback,
  };
}
export function useExecutionRefresh() {
  const cache = useQueryClient();
  return () =>
    cache.invalidateQueries({ queryKey: ['execution'], refetchType: 'active' });
}
const messages: Record<string, string> = {
  STOCK_VERSION_CONFLICT: 'conflict',
  CONFIGURATION_CONFLICT: 'conflict',
  STOCK_COUNT_FROZEN: 'frozen',
  STOCK_INSUFFICIENT: 'insufficient',
  STOCK_RESERVED_BY_OTHER: 'reservedOther',
  STOCK_SOURCE_REMAINING_EXCEEDED: 'sourceExceeded',
  STOCK_RESERVATIONS_ACTIVE: 'reservationsActive',
  STOCK_REVERSE_DEPENDENCIES: 'reverseDependencies',
  STOCK_TRANSFER_IN_TRANSIT: 'inTransit',
  STOCK_MASTER_IN_USE: 'masterInUse',
  SUPPLIER_IN_USE: 'masterInUse',
  CUSTOMER_IN_USE: 'masterInUse',
  STOCK_QUANTITY_PRECISION: 'precision',
  STOCK_QUANTITY_OVERFLOW: 'overflow',
  SUPPLY_QUANTITY_PRECISION: 'precision',
  SUPPLY_QUANTITY_OVERFLOW: 'overflow',
  SUPPLY_REFERENCE_QUANTITY_REQUIRED: 'referenceQuantityRequired',
  SUPPLY_REFERENCE_VARIANCE_EXCEEDED: 'varianceExceeded',
  SUPPLY_BASE_QUANTITY_INVALID: 'baseQuantityInvalid',
  STOCK_REFERENCE_REJECTION_UNSUPPORTED: 'referenceRejection',
  STOCK_QUANTITY_INVALID: 'quantityInvalid',
  STOCK_REVIEWERS_EMPTY: 'noReviewer',
  STOCK_REVIEW_NOT_CONFIGURED: 'noReviewer',
  STOCK_REVIEWERS_STILL_AVAILABLE: 'reviewersAvailable',
  STOCK_REVIEW_FORBIDDEN: 'notReviewer',
  STOCK_COUNT_INCOMPLETE: 'countIncomplete',
  STOCK_COUNT_REASON_REQUIRED: 'countReasonRequired',
  STOCK_POSTING_REQUIRED: 'actionUnavailable',
  STOCK_ALREADY_REVERSED: 'alreadyReversed',
  STOCK_EXECUTED_LINE_FROZEN: 'executedFrozen',
  STOCK_QUANTITY_BELOW_FULFILLED: 'belowFulfilled',
  STOCK_REQUEST_KEY_REUSED: 'requestKeyReused',
};
export function useExecutionError() {
  const { t } = useTranslation();
  return (error: unknown) => {
    if (error instanceof ApiClientError) {
      if (error.status === 401) return t(ui('sessionEnded'));
      if (error.status === 403) return t(ui('restricted'));
      if (error.status === 404) return t(ui('notFound'));
      if (error.reason && messages[error.reason])
        return t(ui(messages[error.reason]));
      if (
        error.reason?.includes('SOURCE_') ||
        error.reason?.includes('MATERIAL_') ||
        error.reason?.includes('UNAVAILABLE') ||
        error.reason?.includes('INACTIVE')
      )
        return t(ui('unavailable'));
    }
    return t(ui('failed'));
  };
}
