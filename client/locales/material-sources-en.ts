export const materialSources = {
  readOnlyHint:
    'This view is read-only. Expand this line’s identification history to see its progress.',
  resultReadFailed:
    'The result could not be loaded. Select “Read operation result”. The operation succeeded; do not submit again.',
  title: 'Material identification',
  read: 'Read demand source',
  resolve: 'Offer a material to the source',
  requestGovernance: 'Request identification',
  resubmit: 'Resubmit for identification',
  confirmMaterial: 'Confirm material',
  rejectMaterial: 'Reject candidate',
  takeOverSource: 'Take over',
  lineTitle: 'Material identification · Line {{number}}',
  attempt: 'Round {{number}}',
  previousCandidate: 'Previous candidate (invalidated)',
  appliedMaterial: 'Confirmed material',
  candidate: 'Candidate',
  candidateHint:
    'This candidate has not changed the demand. Confirming it returns the request to draft for a new review.',
  handler: 'Current handler',
  unavailable: 'Unavailable',
  noSourceHint:
    'Save and submit the demand, or request identification for this saved line.',
  alreadyIdentified: 'The line already has an identified material.',
  history: 'Identification history',
  historyEmpty: 'No identification history',
  historyEmptyHint:
    'A saved unknown line can be sent for identification. Each round is kept here.',
  states: {
    pending: 'In progress',
    needsInformation: 'More information needed',
    offered: 'Awaiting confirmation',
    applied: 'Confirmed',
    invalidated: 'Invalidated',
  },
  loading: 'Loading…',
  refreshing: 'Refreshing identification progress…',
  refresh: 'Refresh',
  refreshBeforeAction: 'Refresh the latest record before continuing.',
  notEligible:
    'You currently cannot perform this action. Check your responsibilities and the request status.',
  http401: 'Your session has ended. Sign in again to continue.',
  http403: 'You no longer have access to this operation.',
  http404: 'This request or line is no longer available.',
  http409:
    'The record changed. Read the latest record and confirm your action again.',
  failed:
    'The operation could not be completed. Keep your input and try again.',
  signIn: 'Sign in again',
  retry: 'Retry',
  actionTitle: '{{action}} · {{code}} · Line {{number}}',
  actionDescription:
    'The saved demand and current permissions are checked before applying this action.',
  cancel: 'Cancel',
  reason: 'Reason',
  reasonInvalid: 'Enter a reason of 1–3000 characters.',
  missingLine: 'This demand line is no longer available.',
  confirmHint:
    'Confirming the material replaces the current line selection, returns the request to draft and closes any unfinished review. Previous submitted versions remain available; submit the new content for review again.',
  rejectHint:
    'The candidate will remain in history. Give a reason and explicitly resubmit the line for a new identification round.',
  takeOverHint:
    'You will become the source handler using your current responsibilities. This does not grant access to other requests or companies.',
  resubmitHint:
    'The previous source and any unfinished task will be invalidated. A new identification round will use the currently saved demand.',
  unit: 'Unit / Packaging',
  baseQuantity: 'Base quantity',
  done: '{{action}} completed · {{code}} · Line {{number}}',
  completedRefresh:
    'The action completed. Load the latest record to view the result; do not submit the action again.',
  loadResult: 'Load result',
  conflictHint:
    'Your input is retained. Read the latest record, compare the line and candidate, then explicitly use it before confirming again.',
  readLatest: 'Read latest record',
  latestHint: 'Latest saved line and identification status:',
  useLatest: 'Use this record and confirm again',
  sourceDemand: 'Source demand',
  sourcePurchase: 'Purchase demand',
  sourceIssue: 'Material issue demand',
  standalone: 'Standalone identification task',
  standaloneHint: 'This task has no linked demand line.',
  sourceEditHint:
    'Change the original demand line and explicitly resubmit for identification. A linked task cannot edit the source demand.',
  originalName: 'Original name',
  originalSpecification: 'Original specification',
  quantity: 'Demand quantity',
  usage: 'Purpose',
  reasons: {
    SYSTEM_SOURCE_LINE_REMOVED: 'The demand line was removed.',
    SYSTEM_SOURCE_INPUT_CHANGED: 'The saved demand input changed.',
    SYSTEM_SOURCE_SHARED_FILES_CHANGED:
      'The line attachments shared for identification changed.',
  },
  errors: {
    SUPPLY_SOURCE_ACTIVE:
      'This line already has an active identification round. Refresh its progress.',
    SUPPLY_SOURCE_ALREADY_IDENTIFIED:
      'This line already has an identified material.',
    SUPPLY_SOURCE_EDIT_REQUIRED:
      'Update the original demand line and explicitly resubmit for identification.',
    SUPPLY_SOURCE_NOT_FOUND: 'The demand source is no longer available.',
    SUPPLY_SOURCE_NOT_OFFERED:
      'No current candidate can be confirmed. Refresh identification progress.',
    SUPPLY_SOURCE_PERMISSION_REQUIRED:
      'Identification responsibilities are required to submit unknown material lines. Contact your administrator.',
    SUPPLY_SOURCE_RETRY_REQUIRED:
      'Explicitly resubmit the line to start a new identification round.',
    SUPPLY_SOURCE_SAME_HANDLER: 'You are already the source handler.',
    SUPPLY_SOURCE_STALE:
      'The source no longer matches the current demand. Refresh the line and explicitly resubmit if needed.',
    SUPPLY_SOURCE_TOO_LARGE:
      'The number of demand lines exceeds the supported limit.',
    SUPPLY_SOURCE_UNAVAILABLE:
      'Material identification is currently unavailable.',
    SUPPLY_SOURCE_VERSION_CONFLICT:
      'The demand or candidate changed. Read the latest record and confirm again.',
    SUPPLY_REQUEST_CONFLICT:
      'This request key was used for different input. Read the latest record before continuing.',
    SUPPLY_FORBIDDEN:
      'Your current responsibilities do not permit this action.',
    SUPPLY_MATERIAL_UNAVAILABLE:
      'The candidate is no longer available for this company.',
    SUPPLY_INVALID_UNIT:
      'The selected unit or package is no longer available. Select a current option.',
    SUPPLY_QUANTITY_PRECISION:
      'The converted quantity exceeds the permitted precision. Select an exact unit or package.',
    SUPPLY_QUANTITY_OVERFLOW:
      'The converted quantity exceeds the supported range.',
  },
};
