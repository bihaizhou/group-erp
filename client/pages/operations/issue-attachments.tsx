import { useRef, useState } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import { useApiClient } from '@nocobase/app-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Paperclip } from 'lucide-react';
import { Button } from '#components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#components/ui/dialog';

type IssueFile = {
  id: string;
  filename: string;
  ext: string;
  size: number;
  createdAt: string;
  contentUrl: string;
};

const formatSize = (size: number) =>
  size >= 1024 * 1024
    ? `${(size / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(size / 1024))} KB`;

/** Evidence files attached to one operations issue. */
export function OperationsIssueAttachments({
  issueId,
  canWrite,
}: {
  issueId: string;
  canWrite: boolean;
}) {
  const { t } = useTranslation(),
    api = useApiClient(),
    queryClient = useQueryClient(),
    [open, setOpen] = useState(false),
    [failed, setFailed] = useState(''),
    input = useRef<HTMLInputElement>(null);
  const files = useQuery({
    queryKey: ['operations-issue-files', issueId],
    enabled: open,
    retry: false,
    queryFn: ({ signal }) =>
      api.request<{ data: IssueFile[] }>({
        path: 'operationsFiles/findMany',
        method: 'POST',
        query: { issueId },
        json: { limit: 100 },
        signal,
      }),
  });
  const upload = useMutation({
    mutationFn: async (selected: File[]) => {
      const body = new FormData();
      for (const file of selected) body.append('file', file);
      return api.request({
        path: 'operationsFiles/uploadOne',
        method: 'POST',
        query: { issueId },
        body,
      });
    },
    onSuccess: () => {
      setFailed('');
      void queryClient.invalidateQueries({
        queryKey: ['operations-issue-files', issueId],
      });
    },
    onError: (error) => setFailed(error instanceof Error ? error.message : ''),
  });
  const rows = files.data?.data ?? [];
  return (
    <>
      <Button
        variant='outline'
        size='sm'
        onClick={() => {
          setFailed('');
          setOpen(true);
        }}
      >
        <Paperclip className='mr-1 size-3.5' />
        {t('operations.attachments')}
        {rows.length ? ` (${rows.length})` : ''}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className='sm:max-w-lg'>
          <DialogHeader>
            <DialogTitle>{t('operations.attachmentsTitle')}</DialogTitle>
            <DialogDescription>
              {t('operations.attachmentsHint')}
            </DialogDescription>
          </DialogHeader>
          <div className='space-y-2'>
            {rows.length ? (
              <ul className='divide-y rounded-md border text-sm'>
                {rows.map((file) => (
                  <li
                    key={file.id}
                    className='flex items-center justify-between gap-3 px-3 py-2'
                  >
                    <a
                      className='min-w-0 truncate text-primary underline-offset-4 hover:underline'
                      href={file.contentUrl}
                      target='_blank'
                      rel='noreferrer'
                    >
                      {file.filename}
                    </a>
                    <span className='shrink-0 text-xs text-muted-foreground'>
                      {formatSize(file.size)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className='py-6 text-center text-sm text-muted-foreground'>
                {t('operations.attachmentsEmpty')}
              </p>
            )}
            {failed ? (
              <p className='text-sm text-destructive'>{failed}</p>
            ) : null}
          </div>
          <DialogFooter>
            {canWrite ? (
              <>
                <input
                  ref={input}
                  type='file'
                  multiple
                  accept='image/png,image/jpeg,image/webp,application/pdf'
                  className='hidden'
                  onChange={(event) => {
                    const selected = Array.from(event.target.files ?? []);
                    if (selected.length) upload.mutate(selected);
                    event.target.value = '';
                  }}
                />
                <Button
                  variant='outline'
                  disabled={upload.isPending}
                  onClick={() => input.current?.click()}
                >
                  {upload.isPending
                    ? t('operations.attachmentsUploading')
                    : t('operations.attachmentsUpload')}
                </Button>
              </>
            ) : null}
            <Button variant='outline' onClick={() => setOpen(false)}>
              {t('operations.cancel')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
