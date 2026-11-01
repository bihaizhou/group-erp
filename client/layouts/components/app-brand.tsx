import { useTranslation } from '@nocobase/i18n/client';
import { resolveAssetUrl } from '@nocobase/app-client';
import { cn } from 'cn';
import type { ReactElement } from 'react';
import { Link } from 'react-router';

export interface AppBrandProps {
  readonly compact?: boolean;
}

/**
 * The application's lockup: the 秦望科技 mark beside a two-line wordmark. The wordmark carries the mark's greens
 * through `brand-wordmark` in `styles.css`, with a muted English line underneath so the name still reads as the
 * product's own mark rather than a navigation label. Compact mode is the icon-width desktop sidebar, where the mark
 * alone stands in; the sidebar's phone sheet keeps the full lockup.
 */
export function AppBrand(inputProps: AppBrandProps): ReactElement {
  const { t } = useTranslation();
  const { compact = false } = inputProps;

  return (
    <Link
      aria-label={t('brand.homeLabel', { defaultValue: '秦望科技首页' })}
      className='flex min-w-0 items-center gap-2.5 text-foreground transition-opacity hover:opacity-85'
      to='/'
    >
      {/* Both variants are in the document; the theme decides which one paints. */}
      <span className={cn('relative shrink-0', compact ? 'size-9' : 'size-10')}>
        <img
          alt=''
          className='size-full object-contain dark:hidden'
          src={resolveAssetUrl('/assets/logo-qinwang.png')}
        />
        <img
          alt=''
          className='hidden size-full object-contain dark:block'
          src={resolveAssetUrl('/assets/logo-qinwang-dark.png')}
        />
      </span>
      {compact ? null : (
        <span className='flex min-w-0 flex-col justify-center'>
          {/* Brand geometry rather than the page type scale: a 20px name over a 9px tracked tagline, fixed so the
              lockup keeps its proportion in every density preset. */}
          <span className='brand-wordmark truncate text-xl leading-none font-bold tracking-[0.08em] whitespace-nowrap'>
            {t('brand.name', { defaultValue: '秦望科技' })}
          </span>
          <span className='mt-1 truncate text-[9px] leading-none font-semibold tracking-[0.18em] text-muted-foreground uppercase'>
            {t('brand.tagline', { defaultValue: 'QINWANG TECH' })}
          </span>
        </span>
      )}
    </Link>
  );
}
