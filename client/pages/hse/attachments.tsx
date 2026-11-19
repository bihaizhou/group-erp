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

export type HseAttachmentScope = 'incident' | 'hazard' | 'certificate';

type HseFile = {
  id: string;
  filename: string;
  ext: string;
  size: number;
  createdAt: string;
  contentUrl: string;
  ownerId?: string;
};

const formatSize = (size: number) =>
  size >= 1024 * 1024
    ? `${(size / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(size / 1024))} KB`;

export function HseAttachments({
  scope,
  scopeId,
  canWrite,
}: {
  scope: HseAttachmentScope;
  scopeId: string;
  canWrite: boolean;
}) {
  const { t } = useTranslation(),
    api = useApiClient(),
    queryClient = useQueryClient(),
    [open, setOpen] = useState(false),
    [failed, setFailed] = useState(''),
    inputRef = useRef<HTMLInputElement>(null);
  const files = useQuery({
    queryKey: ['hse-files', scope, scopeId],
    enabled: open,
    retry: false,
    queryFn: ({ signal }) =>
      api.request<{ data: HseFile[] }>({
        path: 'hseFiles/findMany',
        method: 'POST',
        query: { scope, scopeId },
        json: { limit: 100 },
        signal,
      }),
  });
  const upload = useMutation({
    mutationFn: async (selected: File[]) => {
      const body = new FormData();
      for (const file of selected) body.append('file', file);
      return api.request({
        path: 'hseFiles/uploadOne',
        method: 'POST',
        query: { scope, scopeId },
        body,
      });
    },
    onSuccess: () => {
      setFailed('');
      void queryClient.invalidateQueries({
        queryKey: ['hse-files', scope, scopeId],
      });
    },
    onError: (error) => setFailed(error instanceof Error ? error.message : ''),
  });
  const rows = files.data?.data ?? [];
  return (
    <>
      <Button
        size='sm'
        variant='ghost'
        onClick={() => setOpen(true)}
        aria-label={t('hse.attachments.open')}
      >
        <Paperclip className='size-4' />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className='max-w-lg'>
          <DialogHeader>
            <DialogTitle>{t('hse.attachments.title')}</DialogTitle>
            <DialogDescription>
              {t('hse.attachments.description')}
            </DialogDescription>
          </DialogHeader>
          <div className='grid gap-2'>
            {files.isLoading ? (
              <p className='text-sm text-muted-foreground'>
                {t('hse.attachments.loading')}
              </p>
            ) : rows.length ? (
              <ul className='grid max-h-64 gap-1 overflow-y-auto'>
                {rows.map((file) => (
                  <li key={file.id} className='flex items-center gap-2 text-sm'>
                    <a
                      className='min-w-0 flex-1 truncate underline-offset-4 hover:underline'
                      href={file.contentUrl}
                      target='_blank'
                      rel='noreferrer'
                    >
                      {file.filename}
                    </a>
                    <span className='text-xs text-muted-foreground'>
                      {formatSize(Number(file.size))}
                    </span>
                    <span className='text-xs text-muted-foreground'>
                      {file.createdAt.slice(0, 10)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className='text-sm text-muted-foreground'>
                {t('hse.attachments.empty')}
              </p>
            )}
            {canWrite ? (
              <div className='grid gap-1'>
                <input
                  ref={inputRef}
                  type='file'
                  multiple
                  accept='image/jpeg,image/png,image/webp,application/pdf'
                  className='text-sm'
                  onChange={(event) => {
                    const selected = [...(event.target.files ?? [])];
                    if (selected.length) upload.mutate(selected);
                    event.target.value = '';
                  }}
                />
                <p className='text-xs text-muted-foreground'>
                  {t('hse.attachments.hint')}
                </p>
              </div>
            ) : null}
            {failed ? (
              <p className='text-sm text-destructive' role='alert'>
                {t('hse.attachments.failed')}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setOpen(false)}>
              {t('hse.attachments.close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
