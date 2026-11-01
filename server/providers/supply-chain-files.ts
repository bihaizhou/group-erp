import type { Application } from '@nocobase/app-server/application';
import {
  ServiceProvider,
  createServiceToken,
} from '@nocobase/service-provider';
import { databaseManagerToken } from '@nocobase/db';
import { purchaseRequestServiceToken } from './procurement.js';
import { issueRequestServiceToken } from './requisitions.js';
import { materialSourceServiceToken } from './material-sources.js';
import { SupplyChainFileService } from './supply-chain-file-service.js';
export const supplyChainFileServiceToken =
  createServiceToken<SupplyChainFileService>('group-erp/supply-chain-files');
export default class SupplyChainFilesProvider extends ServiceProvider<Application> {
  readonly name = 'group-erp/supply-chain-files';
  override register() {
    this.app.container.singleton(
      supplyChainFileServiceToken,
      () =>
        new SupplyChainFileService(
          this.app.container.resolve(databaseManagerToken),
          this.app.container.resolve(materialSourceServiceToken),
        ),
    );
  }
  override async boot() {
    const files = this.app.container.resolve(supplyChainFileServiceToken);
    this.app.container
      .resolve(materialSourceServiceToken)
      .attachFileReader(async (c, kind, id, lineId) =>
        (
          await files.read(
            c,
            kind === 'purchaseRequestLine'
              ? 'purchaseRequest'
              : 'materialIssueRequest',
            id,
          )
        )
          .filter((file) => file.lineId === lineId && file.shareWithGovernance)
          .map((file) => file.fileId),
      );
    files.register(
      'purchaseRequest',
      this.app.container
        .resolve(purchaseRequestServiceToken)
        .attachFiles(files),
    );
    files.register(
      'materialIssueRequest',
      this.app.container.resolve(issueRequestServiceToken).attachFiles(files),
    );
  }
}
