export interface DemandAttachment {
  fileId: string;
  lineId: string | null;
  shareWithGovernance: boolean;
}
export const attachmentUi = (key: string) => `demandAttachments.${key}`;
