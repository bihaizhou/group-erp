import { useTranslation } from '@nocobase/i18n/client';
import { useApiClient } from '@nocobase/app-client';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { Badge } from '#components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#components/ui/card';

type Stage = { title: string; mode: 'any' | 'all'; candidates: number };

/** Shows the approval chain a change will enter once it is submitted. */
export function ApprovalPreview({
  type,
  subjectId,
}: {
  type: string;
  subjectId: string;
}) {
  const { t } = useTranslation(),
    api = useApiClient();
  const query = useQuery({
    enabled: Boolean(type),
    queryKey: ['people-approval-preview', type, subjectId],
    queryFn: ({ signal }) =>
      api.request<{ data: { stages: Stage[] } }>({
        path: 'people/changes/approval-preview',
        query: { type, subjectId },
        signal,
      }),
  });
  if (!type) return null;
  const stages = query.data?.data.stages ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('people.approvalPreview')}</CardTitle>
        <CardDescription>
          {t('people.approvalPreviewDescription')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {query.isPending ? (
          <p className='text-sm text-muted-foreground'>{t('people.loading')}</p>
        ) : !stages.length ? (
          <p className='text-sm text-muted-foreground'>
            {t('people.approvalPreviewEmpty')}
          </p>
        ) : (
          <ol className='flex flex-wrap items-center gap-2'>
            {stages.map((stage, index) => (
              <li
                key={`${stage.title}-${stage.mode}`}
                className='flex items-center gap-2'
              >
                {index ? (
                  <ArrowRight
                    className='size-4 text-muted-foreground'
                    aria-hidden
                  />
                ) : null}
                <span className='flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm'>
                  <span className='flex size-5 items-center justify-center rounded-full bg-muted text-xs tabular-nums'>
                    {index + 1}
                  </span>
                  <span className='font-medium'>{stage.title}</span>
                  <Badge variant='secondary'>
                    {t(`people.approvalModes.${stage.mode}`)}
                  </Badge>
                  <span className='text-xs text-muted-foreground'>
                    {t('people.approvalPreviewPeople', {
                      count: stage.candidates,
                    })}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
