import { useEffect, useState } from 'react';
import { ApiClientError, useApiClient } from '@nocobase/app-client';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from '@nocobase/i18n/client';
import { X } from 'lucide-react';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { Textarea } from '#components/ui/textarea';
import { Field, FieldLabel, FieldError } from '#components/ui/field';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '#components/ui/collapsible';
import { ui, usePurchaseQuery } from './hooks.js';
import { ErrorNotice, ReferencePicker, PurchaseSelect } from './controls.js';
import type { DemandLine, Page, Preview, Selection } from './model.js';
interface MaterialMatch {
  id: string;
  code: string;
  name: string;
  standardName?: string;
  baseUnitId: string;
  baseUnitName?: string;
}
interface Material {
  id: string;
  code: string;
  name: string;
  baseUnitId: string;
  baseUnitName?: string;
  standardName?: string;
  packages?: {
    id: string;
    unitId: string;
    unitName: string;
    name: string;
    numerator: string;
    denominator: string;
  }[];
}
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
    [delayed, setDelayed] = useState(line.selection),
    [open, setOpen] = useState(false);
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
    s = line.selection,
    typed = s.kind === 'unknown' ? s.originalName.trim() : '',
    matches = usePurchaseQuery<Page<MaterialMatch>>(
      'requestMaterialOptions',
      { subjectId: s.subjectId, q: typed, page: 1, pageSize: 5 },
      s.kind === 'unknown' && typed.length >= 1,
    ),
    matchRows = matches.data?.data ?? [];
  const material = usePurchaseQuery<{ data: Material }>(
    `requestMaterialOptions/${s.kind === 'known' ? s.skuId : ''}`,
    { subjectId: s.subjectId },
    s.kind === 'known' && !!s.skuId,
  );
  const m = material.data?.data,
    rule = s.kind === 'known' ? (s.unitRuleId ?? 'base') : 'base';
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
  const chooseMatch = (match: MaterialMatch) => {
    setOpen(false);
    onChange({
      ...line,
      selection: {
        kind: 'known',
        subjectId: s.subjectId,
        skuId: match.id,
        unitId: match.baseUnitId,
        quantity: s.quantity,
      },
    });
  };
  const clearMaterial = () =>
    onChange({
      ...line,
      selection: {
        kind: 'unknown',
        subjectId: s.subjectId,
        originalName: '',
        originalSpecification: '',
        requestedUnitText: '',
        quantity: s.quantity,
      },
    });
  const setUnit = (value: string) => {
    if (s.kind !== 'known') return;
    const pkg = m?.packages?.find((p) => p.id === value);
    const selection: Selection =
      value === 'base'
        ? {
            kind: 'known',
            subjectId: s.subjectId,
            skuId: s.skuId,
            unitId: m?.baseUnitId ?? s.unitId,
            quantity: s.quantity,
          }
        : {
            kind: 'known',
            subjectId: s.subjectId,
            skuId: s.skuId,
            unitId: pkg?.unitId ?? s.unitId,
            unitRuleId: value,
            quantity: s.quantity,
          };
    onChange({ ...line, selection });
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
      <div className='flex flex-wrap items-center justify-end gap-2'>
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
      <Field>
        <FieldLabel htmlFor={`line-${line.id}-materialName`}>
          {t(ui('materialName'))} *
        </FieldLabel>
        {s.kind === 'known' ? (
          <div className='flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2'>
            <span
              id={`line-${line.id}-materialName`}
              className='min-w-0 flex-1 break-words text-sm'
            >
              {display?.materialSnapshot
                ? `${display.materialSnapshot.code} · ${display.materialSnapshot.standardName} · ${display.materialSnapshot.name}`
                : t(ui('noSelection'))}
            </span>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              aria-label={t(ui('clearSelection'))}
              onClick={clearMaterial}
            >
              <X />
              {t(ui('clearSelection'))}
            </Button>
            <Button type='button' variant='ghost' size='sm' onClick={onSelect}>
              {t(ui('changeMaterial'))}
            </Button>
          </div>
        ) : (
          <div className='relative'>
            <Input
              id={`line-${line.id}-materialName`}
              {...attributes('originalName')}
              autoComplete='off'
              placeholder={t(ui('materialSearch'))}
              value={s.originalName}
              onFocus={() => setOpen(true)}
              onBlur={() => setTimeout(() => setOpen(false), 150)}
              onChange={(e) =>
                onChange({
                  ...line,
                  selection: { ...s, originalName: e.target.value },
                })
              }
            />
            {open && typed.length >= 1 && (
              <div className='absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-md border bg-popover text-sm shadow-md'>
                {matches.isLoading ? (
                  <p className='px-3 py-2 text-muted-foreground'>
                    {t(ui('loading'))}
                  </p>
                ) : matchRows.length ? (
                  <ul className='max-h-64 overflow-auto py-1'>
                    {matchRows.map((match) => (
                      <li key={match.id}>
                        <button
                          type='button'
                          className='flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted'
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => chooseMatch(match)}
                        >
                          <span className='font-mono text-xs text-muted-foreground'>
                            {match.code}
                          </span>
                          <span className='min-w-0 flex-1 truncate'>
                            {match.standardName ?? match.name}
                          </span>
                          <span className='shrink-0 text-xs text-muted-foreground'>
                            {t(ui('useMaterialMatch'))}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className='px-3 py-2 text-muted-foreground'>
                    {t(ui('materialNoMatch'))}
                  </p>
                )}
                <button
                  type='button'
                  className='flex w-full items-center justify-center border-t px-3 py-2 text-muted-foreground hover:bg-muted'
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={onSelect}
                >
                  {t(ui('browseAllMaterials'))}
                </button>
              </div>
            )}
          </div>
        )}
        {fieldError(s.kind === 'known' ? 'selection' : 'originalName')}
      </Field>
      {s.kind === 'known' ? (
        <>
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
            <Field>
              <FieldLabel htmlFor={`line-${line.id}-unit`}>
                {t(ui('requestedUnit'))} / {t(ui('packaging'))}
              </FieldLabel>
              <PurchaseSelect
                label={t(ui('packaging'))}
                value={rule}
                items={[
                  {
                    value: 'base',
                    label: `${m?.baseUnitName ?? t(ui('baseUnit'))} · 1/1`,
                  },
                  ...(m?.packages ?? []).map((p) => ({
                    value: p.id,
                    label: `${p.name} · ${p.unitName} · ${p.numerator}/${p.denominator} ${m?.baseUnitName ?? ''}`,
                  })),
                ]}
                onChange={setUnit}
              />
            </Field>
          </div>
          <div className='flex flex-wrap gap-x-4 gap-y-1 text-sm'>
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
        </>
      ) : (
        <div className='grid gap-3 sm:grid-cols-2'>
          <Field className='sm:col-span-2'>
            <FieldLabel htmlFor={`line-${line.id}-originalSpecification`}>
              {t(ui('specification'))} *
            </FieldLabel>
            <Textarea
              id={`line-${line.id}-originalSpecification`}
              {...attributes('originalSpecification')}
              value={s.originalSpecification}
              onChange={(e) =>
                onChange({
                  ...line,
                  selection: { ...s, originalSpecification: e.target.value },
                })
              }
            />
            {fieldError('originalSpecification')}
          </Field>
          <Field>
            <FieldLabel htmlFor={`line-${line.id}-requestedUnitText`}>
              {t(ui('unknownUnit'))} *
            </FieldLabel>
            <Input
              id={`line-${line.id}-requestedUnitText`}
              {...attributes('requestedUnitText')}
              value={s.requestedUnitText}
              onChange={(e) =>
                onChange({
                  ...line,
                  selection: { ...s, requestedUnitText: e.target.value },
                })
              }
            />
            {fieldError('requestedUnitText')}
          </Field>
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
        </div>
      )}
      <ReferencePicker
        id={`line-${line.id}-supplier`}
        error={
          errors[`line-${line.id}-supplier`]
            ? t(ui(errors[`line-${line.id}-supplier`]))
            : undefined
        }
        path='requestSupplierOptions'
        query={{ subjectId: line.selection.subjectId }}
        label={`${t(ui('lineSupplier'))} (${t(ui('optional'))})`}
        value={line.supplierId ?? ''}
        selected={
          line.supplierId
            ? {
                id: line.supplierId,
                code: '',
                name: line.supplierName ?? line.supplierId,
              }
            : null
        }
        onChange={(id, item) =>
          onChange({
            ...line,
            supplierId: id || null,
            supplierName: item?.name ?? null,
          })
        }
      />
      <Collapsible>
        <CollapsibleTrigger
          render={<Button type='button' variant='ghost' size='sm' />}
        >
          {t(ui('lineDetails'))}
        </CollapsibleTrigger>
        <CollapsibleContent className='mt-3 grid gap-3 sm:grid-cols-2'>
          {text('usage', 'lineUsage', true)}
          {text('notes', 'lineNotes', true)}
        </CollapsibleContent>
      </Collapsible>
      {error && <FieldError>{t(ui(error))}</FieldError>}
    </fieldset>
  );
}
