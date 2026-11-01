export const demandAttachments = {
  shared: 'Shared with governance',
  notShared: 'Not shared with governance',
  unavailableLine: 'Unavailable line',
  unavailable: 'Attachment unavailable',
  title: 'Demand attachments',
  saveFirst: 'Save the draft first, then add attachments to the saved request.',
  limits:
    'JPG, PNG, WebP, PDF, DOCX, XLSX or PPTX; up to 5 MiB each and 10 files per request.',
  pendingHint:
    'Uploads are private. Save the request to associate these files; uploaded files are retained if saving fails.',
  choose: 'Choose attachments',
  remove: 'Unlink attachment',
  retry: 'Retry',
  preview: 'Preview',
  download: 'Download',
  belongsTo: 'Attachment belongs to',
  document: 'Whole request',
  share: 'Share with material governance',
  removeTitle: 'Unlink “{{name}}”?',
  removeHint:
    'The file will be removed from this version when you save. Previous submitted versions keep their references.',
  empty: 'No attachments',
  emptyHint: 'Files can be added while editing a saved draft.',
  governanceEmptyHint:
    'Only line attachments explicitly shared by the applicant are shown.',
  failed:
    'The file could not be loaded. Keep the file list and try again, or download it if available.',
  http401: 'Your session has ended. Sign in again to access these attachments.',
  http403: 'You currently cannot access these attachments.',
  http404: 'This attachment or its parent request is no longer available.',
  lineHasAttachments:
    'This line has attachments. Reassign them to the whole request or another line, or unlink them before removing the line.',
  pending: 'Association not saved',
  errors: {
    SUPPLY_FILE_FORMAT:
      'Choose a supported file whose contents match its format. Office files must be valid DOCX, XLSX or PPTX documents.',
    SUPPLY_FILE_SIZE: 'Choose a nonempty file no larger than 5 MiB.',
    SUPPLY_FILE_LIMIT: 'A request can contain up to 10 attachments.',
    SUPPLY_FILE_DUPLICATE: 'The same file cannot be attached more than once.',
    SUPPLY_FILE_FORBIDDEN:
      'You no longer have permission to access or associate this file.',
    SUPPLY_FILE_NOT_FOUND:
      'The attachment is unavailable or belongs to another request.',
    SUPPLY_FILE_DRAFT_REQUIRED:
      'Revise this request to draft before changing attachments.',
    SUPPLY_FILE_PARENT_REQUIRED: 'Save a draft before uploading attachments.',
    SUPPLY_FILE_LINE_INVALID:
      'Choose an active line belonging to this request.',
    BODY_TOO_LARGE:
      'The upload exceeds the supported size. Choose smaller files.',
    FILE_COMMIT_UNCERTAIN:
      'The upload result is uncertain. Refresh the attachment list before retrying.',
    FILE_CLEANUP_FAILED:
      'The upload could not be completed. Refresh the attachment list before retrying.',
  },
};
