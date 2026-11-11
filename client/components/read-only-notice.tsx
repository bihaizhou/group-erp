import { Lock } from 'lucide-react';
import { useTranslation } from '@nocobase/i18n/client';

/**
 * Banner shown on any module page the current account may read but not act on.
 * Pages disable or remove their write controls when `canManage` is false; this
 * tells the reader why nothing is clickable.
 */
export function ReadOnlyNotice({
  canManage,
  canApprove,
  hint,
}: {
  readonly canManage: boolean;
  readonly canApprove?: boolean;
  readonly hint?: string;
}) {
  const { t } = useTranslation();
  if (canManage) return null;
  const text =
    hint ?? (canApprove ? t('common.readOnlyFill') : t('common.readOnlyView'));
  return (
    <div className='flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground'>
      <Lock className='size-4 shrink-0' />
      <span>{text}</span>
    </div>
  );
}
