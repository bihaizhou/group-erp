import { useEffect, useState } from 'react';
import { ApiClientError, useApiClient } from '@nocobase/app-client';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from '@nocobase/i18n/client';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { Textarea } from '#components/ui/textarea';
import { Field, FieldLabel, FieldError } from '#components/ui/field';
import { RadioGroup, RadioGroupItem } from '#components/ui/radio-group';
import { Label } from '#components/ui/label';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '#components/ui/collapsible';
import { ui, useConfirm } from './hooks.js';
import { ErrorNotice } from './controls.js';
import type { DemandLine, Preview } from './model.js';
export function LineEditor({
  line,
  index,
  preview,
  error,
  errors = {},
  busy,
  canUp,
  canDown,
  onMove,
  onChange,
  onRemove,
  onSelect,
}: {
  line: DemandLine;
  index: number;
  preview?: Preview;
  error?: string;
  errors?: Record<string, string>;
  saved: boolean;
  busy: boolean;
  canUp: boolean;
  canDown: boolean;
  onMove: (direction: number) => void;
  onChange: (line: DemandLine) => void;
  onRemove: () => Promise<void>;
  onSelect: () => void;
}) {
  const { t } = useTranslation(),
    api = useApiClient(),
    confirm = useConfirm(),
    [delayed, setDelayed] = useState(line.selection);
  useEffect(() => {
    const timer = setTimeout(() => setDelayed(line.selection), 300);
    return () => clearTimeout(timer);
  }, [line.selection]);
  const result = useQuery({
    queryKey: ['purchase-line-preview', delayed],
    enabled:
      delayed.kind === 'known' &&
      !!delayed.skuId &&
      !!delayed.unitId &&
      /^(?:0|[1-9]\d{0,17})(?:\.\d{1,6})?$/.test(delayed.quantity) &&
      /[1-9]/.test(delayed.quantity),
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: ({ signal }) =>
      api.request<{ data: Preview }>({
        path: 'procurement/requestMaterialSelections',
        method: 'POST',
        json: delayed,
        signal,
      }),
  });
  const current =
    JSON.stringify(delayed) === JSON.stringify(line.selection)
      ? result.data?.data
      : undefined;
  const display = current ?? preview,
    s = line.selection;
  const validation = (name: string) =>
    errors[`line-${line.id}-${name}`] ||
    (name === 'quantity' &&
    result.error instanceof ApiClientError &&
    sameSelection() &&
    result.error.reason?.includes('QUANTITY')
      ? result.error.reason.includes('OVERFLOW')
        ? 'overflow'
        : 'precision'
      : '');
  function sameSelection() {
    return JSON.stringify(delayed) === JSON.stringify(line.selection);
  }
  const attributes = (name: string) => ({
    'aria-invalid': !!validation(name),
    'aria-describedby': validation(name)
      ? `line-${line.id}-${name}-error`
      : undefined,
  });
  const fieldError = (name: string) =>
    validation(name) ? (
      <FieldError id={`line-${line.id}-${name}-error`}>
        {t(ui(validation(name)), {
          field: t(
            ui(
              name.replace(/^detail-/, '') === 'originalSpecification'
                ? 'specification'
                : name === 'requestedUnitText'
                  ? 'unknownUnit'
                  : name.replace(/^detail-/, ''),
            ),
          ),
        })}
      </FieldError>
    ) : null;
  const text = (
    name: 'originalName' | 'originalSpecification' | 'usage' | 'notes',
    label: string,
    multiline = false,
  ) => (
    <Field>
      <FieldLabel htmlFor={`line-${line.id}-detail-${name}`}>
        {t(ui(label))}
      </FieldLabel>
      {multiline ? (
        <Textarea
          id={`line-${line.id}-detail-${name}`}
          {...attributes(`detail-${name}`)}
          value={line[name]}
          onChange={(e) => onChange({ ...line, [name]: e.target.value })}
        />
      ) : (
        <Input
          id={`line-${line.id}-detail-${name}`}
          {...attributes(`detail-${name}`)}
          value={line[name]}
          onChange={(e) => onChange({ ...line, [name]: e.target.value })}
        />
      )}
      {fieldError(`detail-${name}`)}
    </Field>
  );
  const kind = async (value: string) => {
    if (s.kind === value) return;
    if (
      s.kind === 'known' &&
      s.skuId &&
      !(await confirm.ask(
        t(ui('changeLineKindTitle')),
        t(ui('changeLineKindHint')),
        t(ui('confirmCompanyChange')),
      ))
    )
      return;
    onChange({
      ...line,
      originalName:
        line.originalName || (s.kind === 'unknown' ? s.originalName : ''),
      originalSpecification:
        line.originalSpecification ||
        (s.kind === 'unknown' ? s.originalSpecification : ''),
      selection:
        value === 'known'
          ? {
              kind: 'known',
              subjectId: s.subjectId,
              skuId: '',
              unitId: '',
              quantity: s.quantity,
            }
          : {
              kind: 'unknown',
              subjectId: s.subjectId,
              originalName: line.originalName,
              originalSpecification: line.originalSpecification,
              requestedUnitText: '',
              quantity: s.quantity,
            },
    });
  };
  return (
    <fieldset
      id={`purchase-line-${line.id}`}
      tabIndex={-1}
      disabled={busy}
      className='min-w-0 flex flex-col gap-4 rounded-lg border p-4'
    >
      <legend className='px-1 font-medium'>
        {t(ui('lineTitle'), { number: index + 1 })}
      </legend>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <RadioGroup
          aria-label={t(ui('lineTitle'), { number: index + 1 })}
          value={s.kind}
          onValueChange={(v: string) => void kind(v)}
          className='flex flex-wrap gap-4'
        >
          {['known', 'unknown'].map((value) => (
            <Label key={value} className='flex items-center gap-2'>
              <RadioGroupItem value={value} />
              {t(ui(value))}
            </Label>
          ))}
        </RadioGroup>
        <div className='flex flex-wrap gap-2'>
          <Button
            type='button'
            size='sm'
            variant='outline'
            disabled={!canUp}
            onClick={() => onMove(-1)}
          >
            {t(ui('up'))}
          </Button>
          <Button
            type='button'
            size='sm'
            variant='outline'
            disabled={!canDown}
            onClick={() => onMove(1)}
          >
            {t(ui('down'))}
          </Button>
          <Button
            type='button'
            size='sm'
            variant='outline'
            onClick={() => void onRemove()}
          >
            {t(ui('removeLine'))}
          </Button>
        </div>
      </div>
      {s.kind === 'known' ? (
        <div className='flex flex-col gap-4'>
          <div className='flex flex-wrap items-center justify-between gap-3'>
            <span className='break-words text-sm'>
              {display?.materialSnapshot
                ? `${display.materialSnapshot.code} · ${display.materialSnapshot.standardName} · ${display.materialSnapshot.name}`
                : t(ui('noSelection'))}
            </span>
            <Button
              id={`line-${line.id}-selection`}
              {...attributes('selection')}
              type='button'
              variant='outline'
              onClick={onSelect}
            >
              {t(ui('selectMaterial'))}
            </Button>
          </div>
          {fieldError('selection')}
          <div className='grid gap-3 sm:grid-cols-2'>
            <Field>
              <FieldLabel htmlFor={`line-${line.id}-quantity`}>
                {t(ui('quantity'))} *
              </FieldLabel>
              <Input
                id={`line-${line.id}-quantity`}
                {...attributes('quantity')}
                inputMode='decimal'
                value={s.quantity}
                onChange={(e) =>
                  onChange({
                    ...line,
                    selection: { ...s, quantity: e.target.value },
                  })
                }
              />
              {fieldError('quantity')}
            </Field>
            <div className='flex flex-col gap-2 text-sm'>
              <p>
                {t(ui('requestedUnit'))}:{' '}
                {display?.materialSnapshot?.unitName ?? '—'}
              </p>
              <p>
                {t(ui('packaging'))}: {display?.numeratorSnapshot ?? '—'} /{' '}
                {display?.denominatorSnapshot ?? '—'}
              </p>
              <p aria-live='polite'>
                {t(ui('baseQuantity'))}:{' '}
                {current?.baseQuantity ??
                  (preview && s.quantity === preview.requestedQuantity
                    ? preview.baseQuantity
                    : '—')}{' '}
                {display?.materialSnapshot?.baseUnitName ?? ''}
              </p>
              {result.error && (
                <ErrorNotice
                  error={result.error}
                  retry={() => void result.refetch()}
                />
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className='grid gap-3 sm:grid-cols-2'>
          {(
            [
              'originalName',
              'originalSpecification',
              'requestedUnitText',
              'quantity',
            ] as const
          ).map((name) => (
            <Field key={name}>
              <FieldLabel htmlFor={`line-${line.id}-${name}`}>
                {t(
                  ui(
                    name === 'originalSpecification'
                      ? 'specification'
                      : name === 'requestedUnitText'
                        ? 'unknownUnit'
                        : name,
                  ),
                )}{' '}
                *
              </FieldLabel>
              {name === 'originalSpecification' ? (
                <Textarea
                  id={`line-${line.id}-${name}`}
                  {...attributes(name)}
                  value={s[name]}
                  onChange={(e) =>
                    onChange({
                      ...line,
                      selection: { ...s, [name]: e.target.value },
                    })
                  }
                />
              ) : (
                <Input
                  id={`line-${line.id}-${name}`}
                  {...attributes(name)}
                  value={s[name]}
                  inputMode={name === 'quantity' ? 'decimal' : undefined}
                  onChange={(e) =>
                    onChange({
                      ...line,
                      selection: { ...s, [name]: e.target.value },
                    })
                  }
                />
              )}
              {fieldError(name)}
            </Field>
          ))}
        </div>
      )}
      <Collapsible>
        <CollapsibleTrigger
          render={<Button type='button' variant='ghost' size='sm' />}
        >
          {t(ui('lineDetails'))}
        </CollapsibleTrigger>
        <CollapsibleContent className='mt-3 grid gap-3 sm:grid-cols-2'>
          {text('originalName', 'originalName')}
          {text('originalSpecification', 'specification', true)}
          {text('usage', 'lineUsage', true)}
          {text('notes', 'lineNotes', true)}
        </CollapsibleContent>
      </Collapsible>
      {error && <FieldError>{t(ui(error))}</FieldError>}
      {confirm.dialog}
    </fieldset>
  );
}
