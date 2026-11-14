import { ApiClientError } from '@nocobase/app-client';

/**
 * Maps a thrown request error to a locale key under `operations.error.*`.
 * The API client puts the server's specific business code (the ApiError
 * `message`) on `error.message` and the generic reason on `error.reason`,
 * so code branches use `error.message`; HTTP 403 maps to the forbidden key.
 */
const codeKeys: Record<string, string> = {
  OPERATIONS_FORBIDDEN: 'forbidden',
  ISSUE_NOT_FOUND: 'issueNotFound',
  ISSUE_CLOSED_IMMUTABLE: 'issueClosedImmutable',
  ISSUE_TRANSITION_INVALID: 'issueTransitionInvalid',
  RESOLUTION_REQUIRED: 'resolutionRequired',
  VERSION_CONFLICT: 'versionConflict',
  SUBJECT_REQUIRED: 'subjectRequired',
  SUBJECT_NOT_FOUND: 'subjectNotFound',
  UNIT_NOT_FOUND: 'unitNotFound',
  OWNER_NOT_FOUND: 'ownerNotFound',
  OWNER_NOT_IN_COMPANY: 'ownerNotInCompany',
};

export function operationsErrorKey(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.status === 403) return 'forbidden';
    const key = codeKeys[error.message];
    if (key) return key;
  }
  return 'fallback';
}
