import { Paperclip } from 'lucide-react';
import { useState } from 'react';
import { StatusBadge } from '#components/status-badge';
import { useTranslation } from '@nocobase/i18n/client';
import {
  FileUploadField,
  FileList,
  type FileRecord,
} from '#extensions/nocobase-file-component-ui/index';
import { Card, CardHeader, CardTitle, CardContent } from '#components/ui/card';
import { Field, FieldLabel } from '#components/ui/field';
import { Checkbox } from '#components/ui/checkbox';
import { Alert, AlertDescription } from '#components/ui/alert';
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyMedia,
} from '#components/ui/empty';
import { PeopleSelect } from '#pages/people/controls';
import { useConfirm } from '#pages/procurement/requests/hooks';
import {
  SourceError,
  SourceLoading,
} from '#components/demand-governance/controls';
import type { DemandDomain } from '#components/demand-governance/model';
import { attachmentUi, type DemandAttachment } from './model.js';
import {
  useDemandUploadRepository,
  useAttachmentError,
  useDemandAttachmentMetadata,
} from './hooks.js';
export function DemandAttachments({
  domain,
  requestId,
  value = [],
  lines = [],
  onChange,
  onBusyChange,
  disabled = false,
  governanceTaskId,
}: {
  domain: DemandDomain;
  requestId?: string;
  value?: DemandAttachment[];
  lines?: { id: string; label: string }[];
  onChange?: (files: DemandAttachment[]) => void;
  onBusyChange?: (busy: boolean) => void;
  disabled?: boolean;
  governanceTaskId?: string;
}) {
  const { t } = useTranslation(),
    repository = useDemandUploadRepository(domain, requestId),
    message = useAttachmentError(),
    confirmation = useConfirm();
  const [uploaded, setUploaded] = useState<ReadonlyMap<string, FileRecord>>(
      () => new Map(),
    ),
    [error, setError] = useState('');
  const [initialBindings] = useState(
    () => new Map(value.map((file) => [file.fileId, { ...file }])),
  );
  const query = useDemandAttachmentMetadata(
    domain,
    requestId,
    value,
    governanceTaskId,
  );
  const terminal = query.isDenied;
  const records = terminal
    ? []
    : [...(query.data?.data ?? []), ...uploaded.values()];
  const selected = terminal
    ? []
    : governanceTaskId
      ? (query.data?.data ?? [])
      : value.flatMap((link) => {
          const file = records.find((f) => f.id === link.fileId);
          return file ? [file] : [];
        });
  const editable = !!onChange;
  const apply = async (next: readonly FileRecord[]) => {
    const removed = value.find(
      (item) => !next.some((file) => file.id === item.fileId),
    );
    if (
      removed &&
      !(await confirmation.ask(
        t(attachmentUi('removeTitle'), {
          name: records.find((f) => f.id === removed.fileId)?.filename ?? '—',
        }),
        t(attachmentUi('removeHint')),
        t(attachmentUi('remove')),
      ))
    )
      return;
    setUploaded(
      (old) =>
        new Map([...old, ...next.map((file) => [file.id, file] as const)]),
    );
    onChange?.(
      next.map(
        (file) =>
          value.find((item) => item.fileId === file.id) ?? {
            fileId: file.id,
            lineId: null,
            shareWithGovernance: false,
          },
      ),
    );
    setError('');
    if (removed)
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLButtonElement>(
            '[data-demand-attachment-upload] button',
          )
          ?.focus(),
      );
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t(attachmentUi('title'))}</CardTitle>
      </CardHeader>
      <CardContent className='flex flex-col gap-4'>
        {query.error && (
          <SourceError error={query.error} retry={() => void query.refetch()} />
        )}
        {error && (
          <Alert variant='destructive'>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {editable && !requestId ? (
          <p className='text-sm text-muted-foreground'>
            {t(attachmentUi('saveFirst'))}
          </p>
        ) : editable ? (
          <>
            <p className='text-sm text-muted-foreground'>
              {t(attachmentUi('limits'))} {t(attachmentUi('pendingHint'))}
            </p>
            <div data-demand-attachment-upload>
              <FileUploadField
                repository={repository}
                value={selected}
                onChange={(next) => void apply(next)}
                multiple
                maxFiles={10}
                maxSize={5 * 1024 * 1024}
                accept={[
                  '.jpg',
                  '.jpeg',
                  '.png',
                  '.webp',
                  '.pdf',
                  '.docx',
                  '.xlsx',
                  '.pptx',
                ]}
                disabled={disabled || !!query.error || query.isPending}
                onStatusChange={(status) =>
                  onBusyChange?.(status === 'uploading')
                }
                onError={(cause) => setError(cause.message)}
                removeOnDelete={false}
                labels={{
                  choose: t(attachmentUi('choose')),
                  remove: t(attachmentUi('remove')),
                  retry: t(attachmentUi('retry')),
                }}
              />
            </div>
            {selected.map((file) => {
              const link = value.find((f) => f.fileId === file.id)!;
              return (
                <div
                  key={file.id}
                  className='flex flex-col gap-4 rounded-lg border p-4'
                >
                  <p className='text-sm font-medium [overflow-wrap:anywhere]'>
                    {file.filename}
                  </p>
                  {JSON.stringify(initialBindings.get(file.id)) !==
                    JSON.stringify(link) && (
                    <StatusBadge tone='warning'>
                      {t(attachmentUi('pending'))}
                    </StatusBadge>
                  )}
                  <Field>
                    <FieldLabel htmlFor={`attachment-line-${file.id}`}>
                      {t(attachmentUi('belongsTo'))}
                    </FieldLabel>
                    <PeopleSelect
                      id={`attachment-line-${file.id}`}
                      label={t(attachmentUi('belongsTo'))}
                      value={link.lineId ?? 'document'}
                      disabled={disabled}
                      items={[
                        {
                          value: 'document',
                          label: t(attachmentUi('document')),
                        },
                        ...lines.map((line) => ({
                          value: line.id,
                          label: line.label,
                        })),
                      ]}
                      onChange={(lineId) =>
                        onChange(
                          value.map((f) =>
                            f.fileId === file.id
                              ? {
                                  ...f,
                                  lineId: lineId === 'document' ? null : lineId,
                                  shareWithGovernance:
                                    lineId === 'document'
                                      ? false
                                      : f.shareWithGovernance,
                                }
                              : f,
                          ),
                        )
                      }
                    />
                  </Field>
                  <Field orientation='horizontal'>
                    <Checkbox
                      id={`attachment-share-${file.id}`}
                      disabled={disabled || !link.lineId}
                      checked={link.shareWithGovernance}
                      onCheckedChange={(checked) =>
                        onChange(
                          value.map((f) =>
                            f.fileId === file.id
                              ? { ...f, shareWithGovernance: checked === true }
                              : f,
                          ),
                        )
                      }
                    />
                    <FieldLabel htmlFor={`attachment-share-${file.id}`}>
                      {t(attachmentUi('share'))}
                    </FieldLabel>
                  </Field>
                </div>
              );
            })}
          </>
        ) : null}
        {query.isPending && (requestId || governanceTaskId) ? (
          <SourceLoading />
        ) : selected.length ? (
          <FileList
            files={selected}
            renderDescription={(file) => {
              const link = value.find((item) => item.fileId === file.id);
              return governanceTaskId
                ? t(attachmentUi('shared'))
                : link?.lineId
                  ? `${lines.find((line) => line.id === link.lineId)?.label ?? t(attachmentUi('unavailableLine'))} · ${t(attachmentUi(link.shareWithGovernance ? 'shared' : 'notShared'))}`
                  : t(attachmentUi('document'));
            }}
            labels={{
              preview: t(attachmentUi('preview')),
              download: t(attachmentUi('download')),
            }}
            onError={(cause) => setError(message(cause))}
          />
        ) : (
          !editable && (
            <Empty className='min-h-40 border border-dashed p-6 md:p-6'>
              <EmptyHeader>
                <EmptyMedia variant='icon'>
                  <Paperclip />
                </EmptyMedia>
                <EmptyTitle>{t(attachmentUi('empty'))}</EmptyTitle>
                <EmptyDescription>
                  {t(
                    attachmentUi(
                      governanceTaskId ? 'governanceEmptyHint' : 'emptyHint',
                    ),
                  )}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )
        )}
        {confirmation.dialog}
      </CardContent>
    </Card>
  );
}
