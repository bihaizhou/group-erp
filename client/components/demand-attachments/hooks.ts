import { useMemo, useCallback } from 'react';
import { ApiClientError, useApiClient, useService } from '@nocobase/app-client';
import {
  clientFileRepositoryManagerToken,
  type ClientFileRepository,
  type FileRecord,
} from '@nocobase/app-plugin-file/client';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from '@nocobase/i18n/client';
import { attachmentUi, type DemandAttachment } from './model.js';
import { demandPrefix } from '../demand-governance/hooks.js';
import type { DemandDomain } from '../demand-governance/model.js';
export function useAttachmentError() {
  const { t } = useTranslation();
  return useCallback(
    (error: unknown) => {
      if (error instanceof ApiClientError) {
        const reason = error.reason
          ? t(attachmentUi(`errors.${error.reason}`), { defaultValue: '' })
          : '';
        if (reason) return reason;
        if ([401, 403, 404].includes(error.status))
          return t(attachmentUi(`http${error.status}`));
      }
      return t(attachmentUi('failed'));
    },
    [t],
  );
}
export function useDemandAttachmentMetadata(
  domain: DemandDomain,
  requestId: string | undefined,
  value: readonly Pick<DemandAttachment, 'fileId'>[],
  governanceTaskId?: string,
) {
  const api = useApiClient(),
    ids = [...new Set(value.map((file) => file.fileId))].sort();
  const result = useQuery({
    queryKey: [
      demandPrefix(domain),
      'attachment-metadata',
      requestId,
      governanceTaskId,
      ids.join(','),
    ],
    enabled: !!requestId || !!governanceTaskId,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: ({ signal }) =>
      api.request<{ data: FileRecord[] }>({
        path: 'supplyChainFiles/findMany',
        method: 'POST',
        query: governanceTaskId
          ? { governanceTaskId }
          : { domain, requestId: requestId! },
        json: {
          limit: Math.max(10, ids.length),
          ...(governanceTaskId
            ? {}
            : {
                filter: ids.length
                  ? {
                      kind: 'filter',
                      version: 1,
                      root: {
                        kind: 'group',
                        logic: 'or',
                        items: ids.map((id) => ({
                          kind: 'condition',
                          path: ['id'],
                          operator: '$eq',
                          value: id,
                        })),
                      },
                    }
                  : { id: '__none__' },
              }),
        },
        signal,
      }),
  });
  const isDenied =
    result.error instanceof ApiClientError &&
    [401, 403, 404].includes(result.error.status);
  return { ...result, data: isDenied ? undefined : result.data, isDenied };
}
export function useDemandUploadRepository(
  domain: DemandDomain,
  requestId?: string,
) {
  const api = useApiClient(),
    manager = useService(clientFileRepositoryManagerToken),
    message = useAttachmentError();
  const { t } = useTranslation();
  return useMemo(() => {
    const repository = manager.repository('supplyChainFiles');
    // Standard Client File Repository has no query option for uploads. This
    // adapter only adds the saved parent to that same multipart endpoint. The
    // installed field uses uploadOne and never invokes metadata deletion.
    const overrides: Pick<ClientFileRepository, 'uploadOne' | 'uploadMany'> = {
      uploadOne: async ({ file }, options) => {
        if (!requestId) throw new Error(t(attachmentUi('saveFirst')));
        const body = new FormData();
        body.append('file', file);
        try {
          return (
            await api.request<{
              data: Awaited<ReturnType<ClientFileRepository['uploadOne']>>;
            }>({
              path: 'supplyChainFiles/uploadOne',
              method: 'POST',
              query: { domain, requestId },
              body,
              signal: options?.signal,
            })
          ).data;
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError')
            throw error;
          throw new Error(message(error), { cause: error });
        }
      },
      uploadMany: async ({ files }, options) => {
        if (!requestId) throw new Error(t(attachmentUi('saveFirst')));
        const body = new FormData();
        for (const file of files) body.append('file', file);
        try {
          return (
            await api.request<{
              data: Awaited<ReturnType<ClientFileRepository['uploadMany']>>;
            }>({
              path: 'supplyChainFiles/uploadMany',
              method: 'POST',
              query: { domain, requestId },
              body,
              signal: options?.signal,
            })
          ).data;
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError')
            throw error;
          throw new Error(message(error), { cause: error });
        }
      },
    };
    return Object.assign(repository, overrides);
    // All messages are normalized before the installed field can display them.
  }, [api, manager, domain, requestId, t, message]);
}
