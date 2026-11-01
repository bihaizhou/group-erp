import { ApiError } from '@nocobase/app-server/router';
import {
  LifecycleError,
  lifecycleErrorFields,
  ParameterConfigurationError,
} from '@nocobase/lifecycle';
import { MaterialError } from '../providers/material-model.js';
import { SupplyChainError } from '../providers/supply-chain-model.js';
import { materialApiError } from './material-error.js';

export function executionApiError(error: unknown): unknown {
  if (error instanceof MaterialError) return materialApiError(error);
  if (error instanceof LifecycleError) {
    const fields = lifecycleErrorFields(error);
    return fields ? new ApiError({ ...fields, domain: 'inventory' }) : error;
  }
  if (error instanceof ParameterConfigurationError)
    return new ApiError({
      status: [
        'CONFIGURATION_CONFLICT',
        'CONFIGURATION_REQUEST_REUSED',
      ].includes(error.code)
        ? 'ABORTED'
        : 'FAILED_PRECONDITION',
      domain: 'inventory',
      reason: error.code,
      message: 'The review settings could not be applied.',
    });
  if (error instanceof SupplyChainError)
    return new ApiError({
      status:
        error.reason === 'SUPPLY_FORBIDDEN'
          ? 'PERMISSION_DENIED'
          : 'INVALID_ARGUMENT',
      domain: 'inventory',
      reason: error.reason,
      message: 'The material selection could not be applied.',
      ...(error.field
        ? {
            fieldViolations: [
              { field: error.field, description: error.reason },
            ],
          }
        : {}),
    });
  return error;
}
