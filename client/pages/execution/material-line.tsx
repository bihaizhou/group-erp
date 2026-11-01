import { useTranslation } from '@nocobase/i18n/client';
import { useApiClient } from '@nocobase/app-client';
import { useQuery } from '@tanstack/react-query';
import { Field, FieldLabel, FieldError } from '#components/ui/field';
import { Input } from '#components/ui/input';
import { formatStockQuantity } from '#lib/stock-quantity';
import {
  ReferencePicker,
  StaticSelect,
  ErrorNotice,
  Loading,
} from './controls.js';
import { useExecutionQuery, ui } from './hooks.js';
import type { InputLine, Selection, Snapshot } from './model.js';
interface Material {
  id: string;
  code: string;
  name: string;
  baseUnitId: string;
  baseUnitName: string;
  standardName?: string;
  attributeValues?: Record<string, string>;
  packages?: {
    id: string;
    name: string;
    unitId: string;
    unitName: string;
    numerator: string;
    denominator: string;
  }[];
  relationsTruncated?: boolean;
}
export function MaterialLine({
  apiPath,
  subjectId,
  line,
  onChange,
  snapshot,
  errors = {},
  disabled = false,
  count = false,
}: {
  apiPath: string;
  subjectId: string;
  line: InputLine;
  onChange: (line: InputLine) => void;
  snapshot?: Snapshot;
  errors?: Record<string, string>;
  disabled?: boolean;
  count?: boolean;
}) {
  const { t, i18n } = useTranslation(),
    api = useApiClient(),
    selection = line.selection,
    skuId = selection?.skuId ?? line.skuId ?? '',
    detail = useExecutionQuery<{ data: Material }>(
      `${apiPath}/materialOptions/${skuId}`,
      { subjectId },
      !!subjectId && !!skuId,
    ),
    material = detail.data?.data,
    ruleId = selection?.unitRuleId ?? 'base',
    previewSelection: Selection = {
      kind: 'known',
      subjectId,
      skuId,
      unitId: selection?.unitId ?? material?.baseUnitId ?? '',
      quantity: selection?.quantity ?? '',
      ...(selection?.unitRuleId ? { unitRuleId: selection.unitRuleId } : {}),
    },
    preview = useQuery({
      queryKey: ['execution-preview', apiPath, previewSelection],
      enabled:
        !count &&
        !!material &&
        !!previewSelection.unitId &&
        /^(0|[1-9]\d{0,17})(\.\d{1,6})?$/u.test(previewSelection.quantity) &&
        /[1-9]/u.test(previewSelection.quantity),
      retry: false,
      refetchOnWindowFocus: false,
      queryFn: ({ signal }) =>
        api.request<{
          data: { baseQuantity: string; materialSnapshot: Snapshot };
        }>({
          path: `${apiPath}/materialSelections`,
          method: 'POST',
          json: previewSelection,
          signal,
        }),
    });
  const selected =
      material ??
      (snapshot?.name
        ? { id: skuId, code: snapshot.code, name: snapshot.name }
        : null),
    prefix = `line-${line.id}-`;
  return (
    <div className='grid min-w-0 gap-4 md:grid-cols-2'>
      <div className='min-w-0 md:col-span-2'>
        <ReferencePicker<Material>
          id={`${prefix}selection`}
          label={t(ui('material'))}
          queryPath={`${apiPath}/materialOptions`}
          query={{ subjectId }}
          value={skuId}
          selected={selected as Material | null}
          disabled={disabled || !subjectId}
          error={
            errors[`${prefix}selection`]
              ? t(ui(errors[`${prefix}selection`]))
              : undefined
          }
          renderOption={(item) => (
            <span className='flex min-w-0 flex-col'>
              <span>
                {item.code} · {item.name}
              </span>
              {item.attributeValues && (
                <span className='text-xs text-muted-foreground'>
                  {Object.values(item.attributeValues).join(' · ')}
                </span>
              )}
            </span>
          )}
          onChange={(id, item) => {
            if (count)
              onChange({
                ...line,
                skuId: id,
                selection: undefined,
                actualQuantity: line.actualQuantity ?? null,
              });
            else
              onChange({
                ...line,
                selection: {
                  kind: 'known',
                  subjectId,
                  skuId: id,
                  unitId: item?.baseUnitId ?? '',
                  quantity: selection?.quantity ?? '',
                },
              });
          }}
        />
      </div>
      {detail.isFetching && !material && skuId && <Loading />}
      {detail.error && (
        <div className='md:col-span-2'>
          <ErrorNotice
            error={detail.error}
            retry={() => void detail.refetch()}
          />
        </div>
      )}
      {material && !count && (
        <Field>
          <FieldLabel>{t(ui('unit'))}</FieldLabel>
          <StaticSelect
            label={t(ui('unit'))}
            value={ruleId}
            selectedLabel={
              ruleId === 'base'
                ? material.baseUnitName
                : material.packages?.find((item) => item.id === ruleId)?.name
            }
            disabled={disabled}
            items={[
              { value: 'base', label: material.baseUnitName },
              ...(material.packages ?? []).map((item) => ({
                value: item.id,
                label: `${item.name} · ${item.unitName} · ${item.numerator}/${item.denominator} ${material.baseUnitName}`,
              })),
            ]}
            onChange={(value) => {
              const rule = material.packages?.find((item) => item.id === value);
              onChange({
                ...line,
                selection: {
                  kind: 'known',
                  subjectId,
                  skuId,
                  unitId: rule?.unitId ?? material.baseUnitId,
                  quantity: selection?.quantity ?? '',
                  ...(rule ? { unitRuleId: rule.id } : {}),
                },
              });
            }}
          />
        </Field>
      )}
      {!count && (
        <Field data-invalid={!!errors[`${prefix}quantity`]}>
          <FieldLabel htmlFor={`${prefix}quantity`}>
            {t(ui('quantity'))} *
          </FieldLabel>
          <Input
            id={`${prefix}quantity`}
            inputMode='decimal'
            value={selection?.quantity ?? ''}
            disabled={disabled}
            aria-invalid={!!errors[`${prefix}quantity`]}
            onChange={(event) =>
              onChange({
                ...line,
                selection: {
                  ...previewSelection,
                  quantity: event.target.value,
                },
              })
            }
          />
          {errors[`${prefix}quantity`] && (
            <FieldError>{t(ui(errors[`${prefix}quantity`]))}</FieldError>
          )}
        </Field>
      )}
      {!count && (preview.data || preview.error) && (
        <div className='md:col-span-2'>
          {preview.error ? (
            <ErrorNotice
              error={preview.error}
              retry={() => void preview.refetch()}
            />
          ) : (
            <p className='text-sm text-muted-foreground' aria-live='polite'>
              {t(ui('baseQuantity'))}:{' '}
              {preview.data
                ? formatStockQuantity(
                    preview.data.data.baseQuantity,
                    i18n.language,
                  )
                : '—'}{' '}
              {preview.data?.data.materialSnapshot.baseUnitName ?? ''}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
