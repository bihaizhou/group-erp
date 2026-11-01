import { ApiError } from '@nocobase/app-server/router';
import type { MaterialError } from '../providers/material-model.js';

export function materialApiError(error: MaterialError): ApiError {
  return new ApiError({
    status:
      error.reason === 'MATERIAL_NOT_FOUND'
        ? 'NOT_FOUND'
        : error.reason === 'MATERIAL_FORBIDDEN'
          ? 'PERMISSION_DENIED'
          : error.reason === 'MATERIAL_VERSION_CONFLICT'
            ? 'ABORTED'
            : error.reason.endsWith('_EXISTS')
              ? 'ALREADY_EXISTS'
              : error.field
                ? 'INVALID_ARGUMENT'
                : 'FAILED_PRECONDITION',
    reason: error.reason,
    domain: 'materials',
    message: error.reason,
    ...(error.field
      ? { fieldViolations: [{ field: error.field, description: error.reason }] }
      : {}),
  });
}
