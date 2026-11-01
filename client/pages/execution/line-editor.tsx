import type { InventoryRow } from './inventory.js';
import { useState } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import { ArrowDown, ArrowUp, Trash2, Plus } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '#components/ui/card';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { Textarea } from '#components/ui/textarea';
import { Checkbox } from '#components/ui/checkbox';
import { Field, FieldLabel, FieldError } from '#components/ui/field';
import { formatStockQuantity } from '#lib/stock-quantity';
import { randomUuid } from '#lib/random-id';
import { useDiscard, useExecutionQuery, ui } from './hooks.js';
import {
  ReferencePicker,
  StaticSelect,
  EmptyState,
  Pagination,
  ErrorNotice,
} from './controls.js';
import { MaterialLine } from './material-line.js';
import {
  isOrder,
  quantityDifference,
  newLine,
  sourceLineField,
  type Draft,
  type InputLine,
  type ExecutionPage,
  type ExecutionRecord,
  type Source,
  type SourceLine,
  type Page,
  type Snapshot,
} from './model.js';
interface AllocationOption {
  id: string;
  requestId: string;
  requestVersionId: string;
  code: string;
  baseQuantity: string;
  allocatedQuantity: string;
  remainingQuantity: string;
  material: Snapshot;
}
function AllocationRow({
  apiPath,
  subjectId,
  orderId,
  line,
  allocation,
  onChange,
  onRemove,
  disabled,
}: {
  apiPath: string;
  subjectId: string;
  orderId?: string;
  line: InputLine;
  allocation: NonNullable<InputLine['allocations']>[number];
  onChange: (quantity: string) => void;
  onRemove: () => void;
  disabled: boolean;
}) {
  const { t, i18n } = useTranslation(),
    reference = useExecutionQuery<Page<AllocationOption>>(
      `${apiPath}/requestOptions`,
      {
        subjectId,
        skuId: line.selection?.skuId ?? '',
        requestLineId: allocation.requestLineId,
        page: 1,
        pageSize: 1,
        ...(orderId ? { excludeOrderId: orderId } : {}),
      },
    ),
    option = reference.data?.data[0];
  return (
    <div className='grid items-end gap-3 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_10rem_auto]'>
      <div className='min-w-0 text-sm'>
        <p className='font-medium'>{option?.code ?? t(ui('source'))}</p>
        {option && (
          <p className='mt-1 text-xs text-muted-foreground'>
            {t(ui('baseQuantity'))}:{' '}
            {formatStockQuantity(option.baseQuantity, i18n.language)} ·{' '}
            {t(ui('remainingQuantity'))}:{' '}
            {formatStockQuantity(option.remainingQuantity, i18n.language)}
          </p>
        )}
        {reference.error && (
          <ErrorNotice
            error={reference.error}
            retry={() => void reference.refetch()}
          />
        )}
      </div>
      <Field>
        <FieldLabel
          htmlFor={`allocation-${line.id}-${allocation.requestLineId}`}
        >
          {t(ui('baseQuantity'))}
        </FieldLabel>
        <Input
          id={`allocation-${line.id}-${allocation.requestLineId}`}
          inputMode='decimal'
          value={allocation.baseQuantity}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      </Field>
      <Button
        type='button'
        variant='ghost'
        size='icon'
        disabled={disabled}
        aria-label={t(ui('removeAllocation'), {
          name: option?.code ?? t(ui('source')),
        })}
        onClick={onRemove}
      >
        <Trash2 />
      </Button>
    </div>
  );
}
export function LineEditor({
  config,
  apiPath,
  draft,
  onChange,
  initial,
  source,
  errors,
  busy,
  orderId,
}: {
  config: ExecutionPage;
  apiPath: string;
  draft: Draft;
  onChange: (draft: Draft) => void;
  initial?: ExecutionRecord;
  source?: Source;
  errors: Record<string, string>;
  busy: boolean;
  orderId?: string;
}) {
  const { t, i18n } = useTranslation(),
    discard = useDiscard(),
    [page, setPage] = useState(1),
    count = config.kind === 'stockCounts',
    known =
      isOrder(config) ||
      config.kind === 'stockTransfers' ||
      ['initial', 'productionReceipt', 'productionIssue', 'loss'].includes(
        draft.kind,
      ),
    pageSize = count ? 50 : 100,
    replace = (line: InputLine) =>
      onChange({
        ...draft,
        lines: draft.lines.map((row) => (row.id === line.id ? line : row)),
      }),
    remove = async (line: InputLine) => {
      if (
        await discard.ask(
          t(ui('removeLine')),
          t(ui('removeLineHint')),
          t(ui('removeLine')),
        )
      )
        onChange({
          ...draft,
          lines: draft.lines.filter((row) => row.id !== line.id),
        });
    },
    sourceField = sourceLineField[draft.kind],
    sourceFor = (line: InputLine) =>
      source?.lines.find(
        (row) => row.id === line[sourceField as keyof InputLine],
      ),
    snapshot = (line: InputLine) =>
      sourceFor(line)?.materialSnapshot ??
      initial?.lines.find((row) => row.id === line.id)?.materialSnapshot,
    addSource = (value: SourceLine) => {
      if (!sourceField) return;
      onChange({
        ...draft,
        lines: [
          ...draft.lines,
          {
            id: randomUuid(),
            [sourceField]: value.id,
            quantity: '',
            quality:
              draft.kind === 'salesReturn'
                ? 'inspection'
                : (value.quality ?? 'qualified'),
            notes: '',
            condition: '',
            rejectedQuantity: '0',
            replenishmentRequested: false,
          },
        ],
      });
    },
    updateField = (
      line: InputLine,
      field: keyof InputLine,
      value: string | boolean | null,
    ) => replace({ ...line, [field]: value });
  return (
    <>
      <Card>
        <CardHeader>
          <div className='flex flex-wrap items-center justify-between gap-3'>
            <CardTitle>{t(ui('lines'))}</CardTitle>
            {(known || count || draft.kind === 'qualityTransfer') &&
              draft.kind !== 'reversal' &&
              (!count || initial?.status === 'counting') && (
                <Button
                  type='button'
                  variant='outline'
                  disabled={
                    busy ||
                    !draft.subjectId ||
                    draft.lines.length >= (count ? 10000 : 100)
                  }
                  onClick={() => {
                    const value = newLine(draft.subjectId);
                    if (count) {
                      value.actualQuantity = null;
                      value.skuId = '';
                      value.selection = undefined;
                      value.reason = '';
                    }
                    if (draft.kind === 'qualityTransfer') {
                      value.selection = undefined;
                      value.sourceBalanceId = '';
                      value.quantity = '';
                      value.targetQuality = 'qualified';
                    }
                    onChange({ ...draft, lines: [...draft.lines, value] });
                    if (count)
                      setPage(Math.ceil((draft.lines.length + 1) / pageSize));
                  }}
                >
                  <Plus />
                  {t(ui('addLine'))}
                </Button>
              )}
          </div>
        </CardHeader>
        <CardContent className='grid min-w-0 gap-5'>
          {errors.lines && <FieldError>{t(ui(errors.lines))}</FieldError>}
          {source && draft.kind !== 'reversal' && (
            <fieldset className='grid gap-3 rounded-lg border bg-muted/30 p-4'>
              <legend className='px-1 text-sm font-medium'>
                {t(ui('chooseSourceLines'))}
              </legend>
              {source.lines.map((item) => {
                const selected = draft.lines.find(
                  (line) => line[sourceField as keyof InputLine] === item.id,
                );
                return (
                  <label
                    key={item.id}
                    className='flex min-w-0 items-start gap-3 text-sm'
                  >
                    <Checkbox
                      checked={!!selected}
                      disabled={
                        busy || (item.remainingQuantity === '0' && !selected)
                      }
                      onCheckedChange={(checked) => {
                        if (checked && !selected) addSource(item);
                        else if (selected) void remove(selected);
                      }}
                    />
                    <span className='min-w-0'>
                      <span className='font-medium'>
                        {item.materialSnapshot.name}
                      </span>
                      <span className='mt-1 block text-xs text-muted-foreground'>
                        {item.materialSnapshot.code} ·{' '}
                        {t(ui('remainingQuantity'))}:{' '}
                        {formatStockQuantity(
                          item.remainingQuantity,
                          i18n.language,
                        )}{' '}
                        {item.materialSnapshot.baseUnitName} ·{' '}
                        {item.materialSnapshot.unitName}
                      </span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
          )}
          {!draft.lines.length && (
            <EmptyState type={source ? 'noSelection' : 'noLines'} />
          )}
          {draft.lines
            .slice((page - 1) * pageSize, page * pageSize)
            .map((line, index) => {
              const prefix = `line-${line.id}-`,
                stored = initial?.lines.find((row) => row.id === line.id),
                material = snapshot(line),
                label =
                  material?.name ??
                  t(ui('lineNumber'), {
                    number: (page - 1) * pageSize + index + 1,
                  }),
                quantity = line.selection?.quantity ?? line.quantity ?? '';
              return (
                <section
                  key={line.id}
                  className='grid min-w-0 gap-4 rounded-lg border p-4 sm:p-5'
                  aria-label={label}
                >
                  <div className='flex items-start justify-between gap-3'>
                    <h3 className='min-w-0 break-words text-sm font-medium'>
                      {t(ui('lineNumber'), {
                        number: (page - 1) * pageSize + index + 1,
                      })}
                      {material?.name ? ` · ${material.name}` : ''}
                    </h3>
                    <div className='flex shrink-0 gap-1'>
                      {!count && (
                        <>
                          {(['up', 'down'] as const).map((direction) => (
                            <Button
                              key={direction}
                              type='button'
                              variant='ghost'
                              size='icon'
                              disabled={
                                busy ||
                                (direction === 'up' && index === 0) ||
                                (direction === 'down' &&
                                  index === draft.lines.length - 1)
                              }
                              aria-label={t(
                                ui(direction === 'up' ? 'moveUp' : 'moveDown'),
                                { name: label },
                              )}
                              onClick={() => {
                                const lines = [...draft.lines],
                                  position = lines.findIndex(
                                    (row) => row.id === line.id,
                                  ),
                                  target =
                                    position + (direction === 'up' ? -1 : 1);
                                [lines[position], lines[target]] = [
                                  lines[target],
                                  lines[position],
                                ];
                                onChange({ ...draft, lines });
                              }}
                            >
                              {direction === 'up' ? <ArrowUp /> : <ArrowDown />}
                            </Button>
                          ))}
                        </>
                      )}
                      {(!count || !stored) && (
                        <Button
                          type='button'
                          variant='ghost'
                          size='icon'
                          disabled={busy}
                          aria-label={t(ui('removeNamedLine'), { name: label })}
                          onClick={() => void remove(line)}
                        >
                          <Trash2 />
                        </Button>
                      )}
                    </div>
                  </div>
                  {known ? (
                    <MaterialLine
                      apiPath={apiPath}
                      subjectId={draft.subjectId}
                      line={line}
                      onChange={replace}
                      snapshot={material}
                      errors={errors}
                      disabled={busy}
                    />
                  ) : draft.kind === 'qualityTransfer' ? (
                    <QualityLine
                      draft={draft}
                      line={line}
                      disabled={busy}
                      onChange={replace}
                      error={errors[`${prefix}quantity`]}
                    />
                  ) : count ? (
                    <>
                      {stored ? (
                        <div className='text-sm'>
                          <p className='font-medium'>
                            {stored.materialSnapshot.name} ·{' '}
                            {stored.materialSnapshot.code}
                          </p>
                          <p className='mt-1 text-muted-foreground'>
                            {t(ui('baselineQuantity'))}:{' '}
                            {formatStockQuantity(
                              stored.baselineQuantity ?? '0',
                              i18n.language,
                            )}{' '}
                            {stored.materialSnapshot.baseUnitName} ·{' '}
                            {t(ui(`qualities.${line.quality ?? 'qualified'}`))}
                          </p>
                        </div>
                      ) : (
                        <>
                          <MaterialLine
                            apiPath={apiPath}
                            subjectId={draft.subjectId}
                            line={line}
                            onChange={replace}
                            count
                            errors={errors}
                            disabled={busy}
                          />
                          <Field>
                            <FieldLabel>{t(ui('quality'))}</FieldLabel>
                            <StaticSelect
                              label={t(ui('quality'))}
                              value={line.quality ?? 'qualified'}
                              items={['qualified', 'inspection', 'frozen'].map(
                                (value) => ({
                                  value,
                                  label: t(ui(`qualities.${value}`)),
                                }),
                              )}
                              disabled={busy}
                              onChange={(value) =>
                                updateField(line, 'quality', value)
                              }
                            />
                          </Field>
                        </>
                      )}
                      {quantityDifference(
                        line.actualQuantity,
                        stored?.baselineQuantity ?? '0',
                      ) !== undefined && (
                        <p className='text-sm tabular-nums'>
                          {t(ui('difference'))}:{' '}
                          {formatStockQuantity(
                            quantityDifference(
                              line.actualQuantity,
                              stored?.baselineQuantity ?? '0',
                            )!,
                            i18n.language,
                          )}{' '}
                          {stored?.materialSnapshot.baseUnitName ?? ''}
                        </p>
                      )}
                      <div className='grid gap-4 sm:grid-cols-2'>
                        <Field data-invalid={!!errors[`${prefix}quantity`]}>
                          <FieldLabel htmlFor={`${prefix}quantity`}>
                            {t(ui('countedQuantity'))} *
                          </FieldLabel>
                          <Input
                            id={`${prefix}quantity`}
                            inputMode='decimal'
                            value={line.actualQuantity ?? ''}
                            disabled={busy}
                            aria-invalid={!!errors[`${prefix}quantity`]}
                            onChange={(event) =>
                              updateField(
                                line,
                                'actualQuantity',
                                event.target.value || null,
                              )
                            }
                          />
                          {errors[`${prefix}quantity`] && (
                            <FieldError>
                              {t(ui(errors[`${prefix}quantity`]))}
                            </FieldError>
                          )}
                        </Field>
                        <Field>
                          <FieldLabel htmlFor={`${prefix}reason`}>
                            {t(ui('reason'))}
                          </FieldLabel>
                          <Input
                            id={`${prefix}reason`}
                            maxLength={3000}
                            value={line.reason ?? ''}
                            disabled={busy}
                            onChange={(event) =>
                              updateField(line, 'reason', event.target.value)
                            }
                          />
                        </Field>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className='text-sm text-muted-foreground'>
                        {material?.code ?? '—'} · {material?.unitName ?? '—'}
                      </p>
                      <Field data-invalid={!!errors[`${prefix}quantity`]}>
                        <FieldLabel htmlFor={`${prefix}quantity`}>
                          {t(ui('quantity'))} ·{' '}
                          {material?.unitName ?? t(ui('unit'))} *
                        </FieldLabel>
                        <Input
                          id={`${prefix}quantity`}
                          inputMode='decimal'
                          value={quantity}
                          disabled={busy}
                          aria-invalid={!!errors[`${prefix}quantity`]}
                          onChange={(event) =>
                            updateField(line, 'quantity', event.target.value)
                          }
                        />
                        {errors[`${prefix}quantity`] && (
                          <FieldError>
                            {t(ui(errors[`${prefix}quantity`]))}
                          </FieldError>
                        )}
                      </Field>
                    </>
                  )}
                  {config.kind === 'purchaseOrders' &&
                    line.selection?.skuId && (
                      <div
                        id={`${prefix}allocations`}
                        tabIndex={-1}
                        className='grid gap-3 rounded-lg border p-4'
                      >
                        <p className='text-sm font-medium'>
                          {t(ui('allocations'))}
                        </p>
                        {line.allocations?.map((allocation) => (
                          <AllocationRow
                            key={allocation.requestLineId}
                            apiPath={apiPath}
                            subjectId={draft.subjectId}
                            orderId={orderId}
                            line={line}
                            allocation={allocation}
                            disabled={busy}
                            onChange={(value) =>
                              replace({
                                ...line,
                                allocations: line.allocations?.map((item) =>
                                  item.requestLineId ===
                                  allocation.requestLineId
                                    ? { ...item, baseQuantity: value }
                                    : item,
                                ),
                              })
                            }
                            onRemove={() =>
                              replace({
                                ...line,
                                allocations: line.allocations?.filter(
                                  (item) =>
                                    item.requestLineId !==
                                    allocation.requestLineId,
                                ),
                              })
                            }
                          />
                        ))}
                        <ReferencePicker<AllocationOption>
                          label={t(ui('addAllocation'))}
                          queryPath={`${apiPath}/requestOptions`}
                          query={{
                            subjectId: draft.subjectId,
                            skuId: line.selection.skuId,
                            ...(orderId ? { excludeOrderId: orderId } : {}),
                          }}
                          value=''
                          disabled={busy}
                          isOptionDisabled={(option) =>
                            option.remainingQuantity === '0' ||
                            !!line.allocations?.some(
                              (item) => item.requestLineId === option.id,
                            )
                          }
                          renderOption={(option) => (
                            <span>
                              {option.code} · {option.material.name}
                              <span className='block text-xs text-muted-foreground'>
                                {t(ui('remainingQuantity'))}:{' '}
                                {formatStockQuantity(
                                  option.remainingQuantity,
                                  i18n.language,
                                )}
                              </span>
                            </span>
                          )}
                          onChange={(_id, option) => {
                            if (option)
                              replace({
                                ...line,
                                allocations: [
                                  ...(line.allocations ?? []),
                                  {
                                    requestId: option.requestId,
                                    requestLineId: option.id,
                                    requestVersionId: option.requestVersionId,
                                    baseQuantity: '',
                                  },
                                ],
                              });
                          }}
                        />
                      </div>
                    )}
                  <div className='grid gap-4 sm:grid-cols-2'>
                    {isOrder(config) && (
                      <Field>
                        <FieldLabel htmlFor={`${prefix}unitPrice`}>
                          {t(ui('unitPrice'))}
                        </FieldLabel>
                        <Input
                          id={`${prefix}unitPrice`}
                          inputMode='decimal'
                          value={line.unitPrice ?? ''}
                          disabled={busy}
                          onChange={(event) =>
                            updateField(
                              line,
                              'unitPrice',
                              event.target.value || null,
                            )
                          }
                        />
                      </Field>
                    )}
                    {!isOrder(config) &&
                      !count &&
                      config.kind !== 'stockTransfers' &&
                      [
                        'initial',
                        'loss',
                        'productionReceipt',
                        'productionIssue',
                        'purchaseReceipt',
                        'purchaseReturn',
                        'issueReturn',
                      ].includes(draft.kind) && (
                        <Field>
                          <FieldLabel>{t(ui('quality'))}</FieldLabel>
                          <StaticSelect
                            label={t(ui('quality'))}
                            value={line.quality ?? 'qualified'}
                            disabled={busy}
                            items={(draft.kind === 'purchaseReceipt' ||
                            draft.kind === 'productionReceipt'
                              ? ['qualified', 'inspection']
                              : ['productionIssue'].includes(draft.kind)
                                ? ['qualified']
                                : ['qualified', 'inspection', 'frozen']
                            ).map((value) => ({
                              value,
                              label: t(ui(`qualities.${value}`)),
                            }))}
                            onChange={(value) =>
                              updateField(line, 'quality', value)
                            }
                          />
                        </Field>
                      )}{' '}
                    {draft.kind === 'purchaseReceipt' &&
                      !count &&
                      !isOrder(config) && (
                        <Field>
                          <FieldLabel htmlFor={`${prefix}rejectedQuantity`}>
                            {t(ui('rejectedQuantity'))}
                          </FieldLabel>
                          <Input
                            id={`${prefix}rejectedQuantity`}
                            inputMode='decimal'
                            value={line.rejectedQuantity ?? '0'}
                            disabled={busy}
                            onChange={(event) =>
                              updateField(
                                line,
                                'rejectedQuantity',
                                event.target.value,
                              )
                            }
                          />
                        </Field>
                      )}
                    {['issueReturn', 'salesReturn'].includes(draft.kind) &&
                      !isOrder(config) && (
                        <Field data-invalid={!!errors[`${prefix}condition`]}>
                          <FieldLabel htmlFor={`${prefix}condition`}>
                            {t(ui('condition'))} *
                          </FieldLabel>
                          <Textarea
                            id={`${prefix}condition`}
                            maxLength={3000}
                            value={line.condition ?? ''}
                            disabled={busy}
                            aria-invalid={!!errors[`${prefix}condition`]}
                            onChange={(event) =>
                              updateField(line, 'condition', event.target.value)
                            }
                          />
                          {errors[`${prefix}condition`] && (
                            <FieldError>
                              {t(ui(errors[`${prefix}condition`]))}
                            </FieldError>
                          )}
                        </Field>
                      )}
                    {draft.kind === 'purchaseReturn' && !isOrder(config) && (
                      <label className='flex items-center gap-2 text-sm'>
                        <Checkbox
                          checked={!!line.replenishmentRequested}
                          disabled={busy}
                          onCheckedChange={(value) =>
                            updateField(
                              line,
                              'replenishmentRequested',
                              value === true,
                            )
                          }
                        />
                        {t(ui('replenishmentRequested'))}
                      </label>
                    )}
                    <Field className='sm:col-span-2'>
                      <FieldLabel htmlFor={`${prefix}notes`}>
                        {t(ui('notes'))}
                      </FieldLabel>
                      <Textarea
                        id={`${prefix}notes`}
                        value={line.notes}
                        maxLength={6000}
                        disabled={busy}
                        onChange={(event) =>
                          updateField(line, 'notes', event.target.value)
                        }
                      />
                    </Field>
                  </div>
                </section>
              );
            })}
          {count && draft.lines.length > pageSize && (
            <Pagination
              page={page}
              pageSize={pageSize}
              total={draft.lines.length}
              busy={busy}
              onPage={setPage}
            />
          )}
        </CardContent>
      </Card>
      {discard.dialog}
    </>
  );
}

function QualityLine({
  draft,
  line,
  disabled,
  onChange,
  error,
}: {
  draft: Draft;
  line: InputLine;
  disabled: boolean;
  onChange: (line: InputLine) => void;
  error?: string;
}) {
  const { t, i18n } = useTranslation(),
    balance = useExecutionQuery<{ data: InventoryRow }>(
      `warehouse/inventory/balances/${line.sourceBalanceId}`,
      {},
      !!line.sourceBalanceId,
    ),
    current = balance.data?.data;
  return (
    <div className='grid gap-4'>
      <ReferencePicker<InventoryRow>
        label={t(ui('sourceBalance'))}
        queryPath='warehouse/inventory'
        query={{ subjectId: draft.subjectId, warehouseId: draft.warehouseId }}
        value={line.sourceBalanceId ?? ''}
        selected={current}
        disabled={disabled || !draft.warehouseId}
        selectedLabel={(value) =>
          `${value.material?.code ?? ''} · ${value.material?.name ?? ''} · ${t(ui(`qualities.${value.quality}`))}`
        }
        isOptionDisabled={(value) =>
          value.quantity === '0' || !!value.transferId
        }
        renderOption={(value) => (
          <span>
            {value.material?.code} · {value.material?.name}
            <span className='mt-1 block text-xs text-muted-foreground'>
              {t(ui(`qualities.${value.quality}`))} ·{' '}
              {formatStockQuantity(value.quantity, i18n.language)}{' '}
              {value.material?.baseUnitName}
            </span>
          </span>
        )}
        onChange={(id, item) =>
          onChange({
            ...line,
            sourceBalanceId: id,
            quality: item?.quality as InputLine['quality'],
            quantity: '',
            targetQuality:
              item?.quality === 'qualified' ? 'inspection' : 'qualified',
          })
        }
      />
      {balance.error && (
        <ErrorNotice
          error={balance.error}
          retry={() => void balance.refetch()}
        />
      )}
      <Field data-invalid={!!error}>
        <FieldLabel htmlFor={`line-${line.id}-quantity`}>
          {t(ui('baseQuantity'))} · {current?.material?.baseUnitName ?? ''} *
        </FieldLabel>
        <Input
          id={`line-${line.id}-quantity`}
          inputMode='decimal'
          value={line.quantity ?? ''}
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...line, quantity: event.target.value })
          }
        />
        {error && <FieldError>{t(ui(error))}</FieldError>}
      </Field>
      <Field>
        <FieldLabel>{t(ui('targetQuality'))} *</FieldLabel>
        <StaticSelect
          label={t(ui('targetQuality'))}
          value={line.targetQuality ?? ''}
          disabled={disabled || !current}
          items={['qualified', 'inspection', 'frozen']
            .filter((value) => value !== current?.quality)
            .map((value) => ({ value, label: t(ui(`qualities.${value}`)) }))}
          onChange={(value) =>
            onChange({
              ...line,
              targetQuality: value as InputLine['targetQuality'],
            })
          }
        />
      </Field>
    </div>
  );
}
