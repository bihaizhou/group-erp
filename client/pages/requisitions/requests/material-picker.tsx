import { useState } from 'react';
import {
  useOutletContext,
  useParams,
  useLocation,
  useNavigate,
} from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { useApiClient, useToaster } from '@nocobase/app-client';
import { useQuery } from '@tanstack/react-query';
import { RouteDialog } from '#components/route-dialog';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { RadioGroup, RadioGroupItem } from '#components/ui/radio-group';
import { Label } from '#components/ui/label';
import { Field, FieldLabel } from '#components/ui/field';
import { useUrlSearch, withoutParams } from '#hooks/use-url-search';
import { ui, useIssueQuery, useConfirm } from './hooks.js';
import { Loading, ErrorNotice, Pagination, IssueSelect } from './controls.js';
import type { FormContext } from './request-form.js';
import type { Page, Preview, Selection } from './model.js';
interface Material {
  id: string;
  code: string;
  name: string;
  baseUnitId: string;
  baseUnitName?: string;
  standardName?: string;
  attributeValues?: Record<string, string>;
  attributeLabels?: Record<string, { title: string; unit: string }>;
  packages?: {
    id: string;
    unitId: string;
    unitName: string;
    name: string;
    numerator: string;
    denominator: string;
  }[];
  relationsTruncated?: boolean;
}
export default function MaterialPicker() {
  const parent = useOutletContext<FormContext>(),
    { lineId } = useParams(),
    { t } = useTranslation(),
    location = useLocation(),
    navigate = useNavigate(),
    api = useApiClient(),
    toast = useToaster(),
    confirm = useConfirm();
  const line = parent?.content.lines.find((l) => l.id === lineId),
    original = line?.selection;
  const { searchParams, search, inputProps, updateParams } = useUrlSearch({
    param: 'pickQ',
    resetParams: ['pickPage'],
  });
  const skuId =
      searchParams.get('pickSku') ??
      (original?.kind === 'known' ? original.skuId : ''),
    page = Math.max(1, Math.trunc(Number(searchParams.get('pickPage'))) || 1);
  const [quantity, setQuantity] = useState(original?.quantity ?? ''),
    [rule, setRule] = useState(
      original?.kind === 'known' ? (original.unitRuleId ?? 'base') : 'base',
    );
  const options = useIssueQuery<
    Page<Material> & {
      meta: Page<Material>['meta'] & {
        ambiguous: boolean;
        aliasMatch: { status: string; skuId: string | null };
      };
    }
  >(
    'requestMaterialOptions',
    {
      subjectId: parent?.content.subjectId ?? '',
      q: search,
      page,
      pageSize: 10,
    },
    !!line,
    true,
  );
  const detail = useIssueQuery<{ data: Material }>(
    `requestMaterialOptions/${skuId}`,
    { subjectId: parent?.content.subjectId ?? '' },
    !!skuId && !!line,
  );
  const material = detail.data?.data,
    unit = material?.packages?.find((p) => p.id === rule),
    unitId = rule === 'base' ? material?.baseUnitId : unit?.unitId;
  const selection: Selection = {
    kind: 'known',
    subjectId: parent?.content.subjectId ?? '',
    skuId,
    quantity,
    unitId: unitId ?? '',
    ...(rule !== 'base' ? { unitRuleId: rule } : {}),
  };
  const preview = useQuery({
    queryKey: ['issue-picker-preview', selection],
    retry: false,
    refetchOnWindowFocus: false,
    enabled:
      !!line &&
      !!material &&
      !!unitId &&
      /^(?:0|[1-9]\d{0,17})(?:\.\d{1,6})?$/.test(quantity) &&
      /[1-9]/.test(quantity),
    queryFn: ({ signal }) =>
      api.request<{ data: Preview }>({
        path: 'requisitions/requestMaterialSelections',
        method: 'POST',
        json: selection,
        signal,
      }),
  });
  const dirty =
    original?.kind !== 'known' ||
    skuId !== original.skuId ||
    quantity !== original.quantity ||
    rule !== (original.unitRuleId ?? 'base');
  const back = {
    pathname: '..',
    search: withoutParams(location.search, ['pickQ', 'pickPage', 'pickSku']),
  };
  const close = async () => {
    if (
      !dirty ||
      (await confirm.ask(
        t(ui('discardSelectionTitle')),
        t(ui('discardSelectionHint')),
      ))
    )
      void navigate(back, { replace: true, relative: 'route' });
  };
  const apply = () => {
    if (
      !lineId ||
      !line ||
      !preview.data ||
      preview.isFetching ||
      detail.isFetching
    )
      return;
    parent.setSelection(lineId, selection, preview.data.data);
    toast.show({ type: 'success', title: t(ui('notSavedSelection')) });
    void navigate(back, { replace: true, relative: 'route' });
  };
  return (
    <>
      <RouteDialog
        title={t(ui('selectMaterial'))}
        description={t(ui('notSavedSelection'))}
        beforeClose={() =>
          !dirty ||
          confirm.ask(
            t(ui('discardSelectionTitle')),
            t(ui('discardSelectionHint')),
          )
        }
        closeTo={back}
        footer={
          <>
            <Button variant='outline' onClick={() => void close()}>
              {t(ui('cancel'))}
            </Button>
            <Button
              disabled={
                !line ||
                !preview.data ||
                preview.isFetching ||
                detail.isFetching ||
                !!preview.error
              }
              onClick={apply}
            >
              {t(ui('use'))}
            </Button>
          </>
        }
      >
        {!line ? (
          <p>{t(ui('missingLine'))}</p>
        ) : (
          <div className='flex flex-col gap-4'>
            <Input
              {...inputProps}
              maxLength={200}
              aria-label={t(ui('materialSearch'))}
              placeholder={t(ui('materialSearch'))}
            />
            {Boolean(options.error && options.data) && (
              <ErrorNotice
                error={options.error}
                retry={() => void options.refetch()}
              />
            )}
            {options.isStaleFallback && (
              <p className='text-sm text-muted-foreground'>
                {t(ui('previousResults'))}
              </p>
            )}
            {options.error && !options.data ? (
              <ErrorNotice
                error={options.error}
                retry={() => void options.refetch()}
              />
            ) : options.isPending ? (
              <Loading />
            ) : (
              <>
                <RadioGroup
                  aria-label={t(ui('selectMaterial'))}
                  value={skuId}
                  onValueChange={(id: string) => {
                    setRule('base');
                    updateParams((p) => p.set('pickSku', id));
                  }}
                >
                  {options.data?.data.map((item) => (
                    <Label
                      key={item.id}
                      className='flex items-start gap-2 rounded-lg border p-4'
                    >
                      <RadioGroupItem value={item.id} />
                      <span className='break-words'>
                        {item.code} · {item.standardName ?? ''} · {item.name}
                      </span>
                    </Label>
                  ))}
                </RadioGroup>
                {!options.data?.data.length && (
                  <p className='text-sm text-muted-foreground'>
                    {t(ui('materialMissing'))}
                  </p>
                )}
                {options.data?.meta.aliasMatch?.status === 'ambiguous' && (
                  <p className='text-sm text-muted-foreground'>
                    {t(ui('ambiguous'))}
                  </p>
                )}
                <Pagination
                  page={page}
                  pageSize={10}
                  total={options.data?.meta.total ?? 0}
                  busy={options.isFetching}
                  onPage={(p) =>
                    updateParams((next) => next.set('pickPage', String(p)))
                  }
                />
              </>
            )}
            {detail.error && (
              <ErrorNotice
                error={detail.error}
                retry={() => void detail.refetch()}
              />
            )}{' '}
            {skuId && detail.isPending && <Loading />}
            {material && (
              <div className='flex flex-col gap-4 rounded-lg border p-4'>
                <p className='font-medium'>
                  {material.code} · {material.standardName} · {material.name}
                </p>
                <p className='text-sm text-muted-foreground'>
                  {Object.entries(material.attributeValues ?? {})
                    .map(
                      ([k, v]) =>
                        `${material.attributeLabels?.[k]?.title ?? k}: ${v}`,
                    )
                    .join(' · ')}
                </p>
                <Field>
                  <FieldLabel>
                    {t(ui('requestedUnit'))} / {t(ui('packaging'))}
                  </FieldLabel>
                  <IssueSelect
                    label={t(ui('packaging'))}
                    value={rule}
                    items={[
                      {
                        value: 'base',
                        label: `${material.baseUnitName ?? t(ui('baseUnit'))} · 1/1`,
                      },
                      ...(material.packages ?? []).map((p) => ({
                        value: p.id,
                        label: `${p.name} · ${p.unitName} · ${p.numerator}/${p.denominator} ${material.baseUnitName ?? ''}`,
                      })),
                    ]}
                    onChange={setRule}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor='issue-pick-quantity'>
                    {t(ui('quantity'))} *
                  </FieldLabel>
                  <Input
                    id='issue-pick-quantity'
                    inputMode='decimal'
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                  />
                </Field>
                {preview.error ? (
                  <ErrorNotice
                    error={preview.error}
                    retry={() => void preview.refetch()}
                  />
                ) : (
                  <p aria-live='polite'>
                    {t(ui('baseQuantity'))}:{' '}
                    {preview.data?.data.baseQuantity ?? '—'}{' '}
                    {preview.data?.data.materialSnapshot?.baseUnitName ?? ''}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </RouteDialog>
      {confirm.dialog}
    </>
  );
}
