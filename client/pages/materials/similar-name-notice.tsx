import { useTranslation } from '@nocobase/i18n/client';
import { Link } from 'react-router';
import { Search, TriangleAlert } from 'lucide-react';
import { cn } from 'cn';
import { Alert, AlertDescription, AlertTitle } from '#components/ui/alert';
import { StatusBadge } from '#components/status-badge';
import { useSimilarMaterialNames } from './hooks.js';
import { pathFor } from './model.js';

/**
 * Non-blocking duplicate hint under the standard-name input: the form stays
 * usable because a genuinely new material may legitimately resemble an old one,
 * but the maintainer sees the records it may repeat before creating another.
 */
export function SimilarNameNotice({
  name,
  excludeId,
}: {
  readonly name: string;
  readonly excludeId?: string;
}) {
  const { t } = useTranslation();
  const { data, isFetching, isPlaceholderData } = useSimilarMaterialNames(
    name,
    excludeId,
  );
  const rows = data?.data.rows ?? [];
  if (!rows.length) return null;
  const duplicate = rows.find((row) => row.reason === 'same');
  const hidden = data ? data.data.total - rows.length : 0;
  return (
    <Alert
      role='status'
      aria-live='polite'
      variant={duplicate ? 'destructive' : 'default'}
      className={cn(
        'transition-opacity',
        (isFetching || isPlaceholderData) && 'opacity-70',
      )}
    >
      {duplicate ? (
        <TriangleAlert aria-hidden='true' />
      ) : (
        <Search aria-hidden='true' />
      )}
      <AlertTitle>
        {duplicate
          ? t('materials.similarSameTitle')
          : t('materials.similarTitle')}
      </AlertTitle>
      <AlertDescription>
        <ul className='flex flex-col gap-1.5'>
          {rows.map((row) => (
            <li
              key={row.id}
              className='flex flex-wrap items-center gap-x-2 gap-y-1'
            >
              <Link
                className='font-medium text-foreground underline underline-offset-4'
                to={`${pathFor('names')}/${row.id}`}
                target='_blank'
                rel='noreferrer'
                aria-label={t('materials.similarOpen', { name: row.name })}
              >
                {row.name}
              </Link>
              <span className='font-mono text-xs text-muted-foreground'>
                {row.code}
              </span>
              <StatusBadge
                size='sm'
                tone={row.status === 'active' ? 'success' : 'neutral'}
              >
                {t(`materials.states.${row.status}`)}
              </StatusBadge>
              <span className='text-xs text-muted-foreground'>
                {t(`materials.similarReasons.${row.reason}`)}
              </span>
            </li>
          ))}
        </ul>
        {hidden > 0 ? (
          <p className='mt-1'>
            {t('materials.similarLimit', { limit: rows.length, hidden })}
          </p>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
