import { useTranslation } from '@nocobase/i18n/client';
import { cn } from 'cn';
import type { ReactElement } from 'react';
import { LongText } from '#components/long-text';
import {
  type Data,
  type Kind,
  type Options,
  type Value,
  textValue,
} from './model.js';
import { type FieldChange, fieldChanges, isEmpty } from './field-changes.js';

type Rendered = {
  text: string;
  detail?: boolean;
  unresolved?: boolean;
  long?: boolean;
};

function format(
  change: FieldChange,
  value: Value,
  options: Options | undefined,
  t: ReturnType<typeof useTranslation>['t'],
  locale: string,
): Rendered {
  if (isEmpty(value)) return { text: '—' };
  if (change.field.source) {
    const id = textValue(value);
    const name = options?.[change.field.source]?.rows.find(
      (row) => row.id === id,
    )?.name;
    return { text: name ?? '', unresolved: !name };
  }
  if (change.key === 'status')
    return {
      text: t(`people.states.${textValue(value)}`, {
        defaultValue: textValue(value),
      }),
    };
  if (Array.isArray(value) || (value && typeof value === 'object'))
    return { text: '', detail: true };
  if (change.field.type === 'boolean')
    return { text: t(value ? 'people.yes' : 'people.no') };
  if (change.field.choices)
    return {
      text: t(`people.values.${textValue(value)}`, {
        defaultValue: textValue(value),
      }),
    };
  if (change.field.type === 'date') {
    const raw = textValue(value);
    const date = new Date(raw.includes('T') ? raw : `${raw}T00:00:00`);
    return {
      text: Number.isNaN(date.getTime())
        ? raw
        : date.toLocaleDateString(locale),
    };
  }
  if (change.field.type === 'number' || typeof value === 'number')
    return { text: Number(value).toLocaleString(locale) };
  const text = textValue(value);
  return {
    text,
    long:
      change.field.type === 'long' || text.includes('\n') || text.length > 80,
  };
}

function DetailValue({
  change,
  t,
}: {
  readonly change: FieldChange;
  readonly t: ReturnType<typeof useTranslation>['t'];
}): ReactElement {
  const beforeCount = Array.isArray(change.before)
    ? change.before.length
    : null;
  const afterCount = Array.isArray(change.after) ? change.after.length : null;
  const text =
    beforeCount !== null && afterCount !== null && beforeCount !== afterCount
      ? `${t('people.audit.itemCount', { count: beforeCount })} → ${t(
          'people.audit.itemCount',
          { count: afterCount },
        )}`
      : t('people.audit.detailUpdated');
  return <span className='text-muted-foreground'>{text}</span>;
}

export function ChangeList({
  kind,
  before,
  after,
  options,
  className,
}: {
  readonly kind: Kind;
  readonly before: Data | null | undefined;
  readonly after: Data | null | undefined;
  readonly options?: Options;
  readonly className?: string;
}): ReactElement | null {
  const { t, i18n } = useTranslation();
  const changes = fieldChanges(kind, before, after);
  if (!changes.length) return null;
  return (
    <dl className={cn('flex flex-col gap-3', className)}>
      {changes.map((change) => {
        const previous = format(
          change,
          change.before,
          options,
          t,
          i18n.language,
        );
        const next = format(change, change.after, options, t, i18n.language);
        const label = t(`people.fields.${change.key}`, {
          defaultValue: change.key,
        });
        let body: ReactElement;
        if (previous.unresolved || next.unresolved)
          body = (
            <dd className='text-sm text-muted-foreground'>
              {t('people.audit.referenceChanged')}
            </dd>
          );
        else if (previous.detail || next.detail)
          body = (
            <dd>
              <DetailValue change={change} t={t} />
            </dd>
          );
        else if (previous.long || next.long)
          body = (
            <dd className='flex flex-col gap-1'>
              {previous.text !== '—' ? (
                <LongText lines={2} className='text-muted-foreground'>
                  {previous.text}
                </LongText>
              ) : null}
              {next.text !== '—' ? (
                <LongText lines={4}>{next.text}</LongText>
              ) : null}
            </dd>
          );
        else
          body = (
            <dd className='flex flex-wrap items-baseline gap-1.5 text-sm'>
              {previous.text !== '—' ? (
                <>
                  <span className='text-muted-foreground line-through decoration-muted-foreground/50'>
                    {previous.text}
                  </span>
                  <span aria-hidden='true' className='text-muted-foreground'>
                    →
                  </span>
                </>
              ) : null}
              <span
                className={next.text === '—' ? 'text-muted-foreground' : ''}
              >
                {next.text}
              </span>
            </dd>
          );
        return (
          <div
            key={change.key}
            className='grid gap-1 sm:grid-cols-[8rem_1fr] sm:gap-3'
          >
            <dt className='text-xs text-muted-foreground sm:pt-0.5'>{label}</dt>
            {body}
          </div>
        );
      })}
    </dl>
  );
}
