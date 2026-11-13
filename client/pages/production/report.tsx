import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import { useApiClient } from '@nocobase/app-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Save, Trash2 } from 'lucide-react';
import { CompanyIdentity } from '#components/company-scope';
import { ReadOnlyNotice } from '#components/read-only-notice';
import { useFieldAccess } from '#hooks/use-field-access';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { Alert, AlertDescription } from '#components/ui/alert';
import { Button } from '#components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#components/ui/card';
import { Input } from '#components/ui/input';
import { Textarea } from '#components/ui/textarea';
import {
  nativeSelectClass,
  readOnlyValueClass,
} from '#components/native-controls';
import { Spinner } from '#components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#components/ui/table';
import { randomUuid } from '#lib/random-id';
import type {
  AttendanceRoster,
  AttendanceStatus,
  DowntimeCategory,
  DowntimeImpact,
  OvertimeType,
  ProductionReport,
  ProductionReportContext,
  ShiftReport,
} from './model.js';

type ReportForm = {
  runtimeMinutes: string;
  downtimeMinutes: string;
  notes: string;
};

type MaterialDraft = {
  quantity: string;
  stock: string;
};

type AttendanceDraft = {
  personId: string;
  personName: string;
  positionId: string;
  positionName: string;
  status: AttendanceStatus;
  absenceReason: string;
  overtimeHours: string;
  overtimeContent: string;
};

type DowntimeDraft = {
  id: string;
  time: string;
  category: DowntimeCategory;
  impact: DowntimeImpact;
  description: string;
};

type OvertimeDraft = {
  id: string;
  personId: string;
  hours: string;
  type: OvertimeType;
  reason: string;
};

type MaintenanceDraft = {
  id: string;
  equipmentId: string;
  kind: 'repair' | 'maintenance';
  description: string;
  assigneeName: string;
};

const statuses: AttendanceStatus[] = [
  'present',
  'absent',
  'leave',
  'rest',
  'unrecorded',
];
const downtimeCategories: DowntimeCategory[] = [
  'equipment',
  'production',
  'utility',
  'material',
  'quality',
  'other',
];
const downtimeImpacts: DowntimeImpact[] = ['stop', 'speed_loss', 'other'];
const overtimeTypes: OvertimeType[] = ['planned', 'temporary', 'holiday'];

const quantity = (value: string) => value.trim() || '0';
const shanghaiTime = () =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date());
/** A wall-clock time on the report date, read in the business timezone. */
const instant = (date: string, time: string) =>
  new Date(`${date}T${time}:00+08:00`).toISOString();
const clock = (value: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
const emptyForm = (report: ShiftReport | null): ReportForm => ({
  runtimeMinutes: String(report?.runtimeMinutes ?? 0),
  downtimeMinutes: String(report?.downtimeMinutes ?? 0),
  notes: report?.notes ?? '',
});

/** Physical count minus the book quantity snapshotted at submission time. */
const difference = (stock: string, book: string | null | undefined) => {
  if (!stock.trim() || book === null || book === undefined) return '—';
  const value = Number(stock) - Number(book);
  if (!Number.isFinite(value)) return '—';
  const formatted = value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  return `${value > 0 ? '+' : ''}${formatted === '-0' ? '0' : formatted}`;
};
const fromRoster = (roster: AttendanceRoster): AttendanceDraft[] =>
  roster.rows.map((row) => ({
    personId: row.personId,
    personName: row.personName,
    positionId: row.positionId,
    positionName: row.positionName,
    status: row.status,
    absenceReason: row.absenceReason ?? '',
    overtimeHours: row.overtimeMinutes ? String(row.overtimeMinutes / 60) : '',
    overtimeContent: row.overtimeContent ?? '',
  }));

export default function ProductionReportPage() {
  const { t } = useTranslation();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const context = useQuery({
    retry: false,
    queryKey: ['production-report-context'],
    queryFn: ({ signal }) =>
      api.request<{ data: ProductionReportContext }>({
        path: 'production/report-context',
        signal,
      }),
  });
  const identity = context.data?.data.identity ?? null;
  const units = identity?.units ?? [];
  const [unitId, setUnitId] = useState('');
  const [backfill, setBackfill] = useState(false);
  const [customDate, setCustomDate] = useState('');
  const [customShift, setCustomShift] = useState<'day' | 'night'>('day');
  const currentDate =
    context.data?.data.reportDate ?? context.data?.data.businessDate ?? '';
  const currentShift = context.data?.data.shift ?? 'day';
  const activeUnitId =
    units.find((unit) => unit.id === unitId)?.id ??
    identity?.defaultUnitId ??
    units[0]?.id ??
    '';
  const activeDate = (backfill && customDate) || currentDate;
  const activeShift = backfill ? customShift : currentShift;
  const toggleBackfill = () => {
    if (backfill) {
      setBackfill(false);
      return;
    }
    setCustomDate(currentDate);
    setCustomShift(currentShift);
    setBackfill(true);
  };
  const activeUnit = units.find((unit) => unit.id === activeUnitId) ?? null;
  const selectionKey = `${activeUnitId}:${activeDate}:${activeShift}`;

  const report = useQuery({
    retry: false,
    enabled: Boolean(activeUnitId && activeDate),
    queryKey: ['production-report', activeUnitId, activeDate, activeShift],
    queryFn: ({ signal }) =>
      api.request<{ data: ProductionReport }>({
        path: 'production/report',
        query: {
          unitId: activeUnitId,
          reportDate: activeDate,
          shift: activeShift,
        },
        signal,
      }),
  });
  const data = report.data?.data;
  const fieldAccess = useFieldAccess();
  const seeQuantity =
    fieldAccess.access('production.report.material', 'quantity') !== 'hidden';
  const seeStock =
    fieldAccess.access('production.report.material', 'stockQuantity') !==
    'hidden';
  const seeBook =
    fieldAccess.access('production.report.material', 'bookQuantity') !==
    'hidden';
  const writeQuantity =
    fieldAccess.access('production.report.material', 'quantity') === 'write';
  const writeStock =
    fieldAccess.access('production.report.material', 'stockQuantity') ===
    'write';

  const [form, setForm] = useState<ReportForm>(() => emptyForm(null));
  const [materialDrafts, setMaterialDrafts] = useState<
    Record<string, MaterialDraft>
  >({});
  const [rows, setRows] = useState<AttendanceDraft[]>([]);
  const [downtime, setDowntime] = useState<DowntimeDraft[]>([]);
  const [overtime, setOvertime] = useState<OvertimeDraft[]>([]);
  const [maintenance, setMaintenance] = useState<MaintenanceDraft[]>([]);
  const [notice, setNotice] = useState<{ key: string; text: string } | null>(
    null,
  );
  const noticeText = notice?.key === selectionKey ? notice.text : '';
  const hydratedRef = useRef('');

  useEffect(() => {
    if (!data) return;
    const key = `${data.unit.id}:${data.reportDate}:${data.shift}:${
      data.report?.version ?? 'new'
    }`;
    if (hydratedRef.current === key) return;
    hydratedRef.current = key;
    setForm(emptyForm(data.report));
    setMaterialDrafts(
      Object.fromEntries(
        (data.materials ?? []).map((material) => {
          const saved = data.report?.materials?.find(
            (line) => line.skuId === material.skuId,
          );
          return [
            material.skuId,
            {
              quantity: saved?.quantity ?? '',
              stock: saved?.stockQuantity ?? '',
            },
          ];
        }),
      ),
    );
    setRows(fromRoster(data.attendance));
    setDowntime([]);
    setOvertime([]);
    setMaintenance([]);
  }, [data]);

  const save = useMutation({
    retry: false,
    mutationFn: () => {
      const locked = data?.report && data.report.status !== 'draft';
      const payload = {
        unitId: activeUnitId,
        reportDate: activeDate,
        shift: activeShift,
        ...(locked
          ? {}
          : {
              report: {
                runtimeMinutes: Number(form.runtimeMinutes || 0),
                downtimeMinutes: Number(form.downtimeMinutes || 0),
                notes: form.notes.trim() || null,
                materials: (data?.materials ?? []).map((material) => {
                  const draft = materialDrafts[material.skuId] ?? {
                    quantity: '',
                    stock: '',
                  };
                  return {
                    skuId: material.skuId,
                    role: material.role,
                    ...(writeQuantity
                      ? { quantity: quantity(draft.quantity) }
                      : {}),
                    ...(writeStock
                      ? { stockQuantity: draft.stock.trim() || null }
                      : {}),
                    note: null,
                  };
                }),
                ...(data?.report ? { version: data.report.version } : {}),
              },
            }),
        attendance: rows
          .filter((row) => row.status !== 'unrecorded')
          .map((row) => ({
            personId: row.personId,
            positionId: row.positionId,
            status: row.status,
            absenceReason: row.absenceReason.trim() || null,
            overtimeMinutes: Math.round(Number(row.overtimeHours || 0) * 60),
            overtimeContent: row.overtimeContent.trim() || null,
          })),
        downtime: downtime.map((row) => ({
          id: row.id,
          startedAt: instant(activeDate, row.time),
          category: row.category,
          impact: row.impact,
          description: row.description.trim(),
        })),
        overtime: overtime.map((row) => ({
          id: row.id,
          personId: row.personId,
          hours: Number(row.hours),
          type: row.type,
          reason: row.reason.trim(),
          compensation: 'none',
        })),
        maintenance: maintenance.map((row) => ({
          id: row.id,
          equipmentId: row.equipmentId,
          kind: row.kind,
          description: row.description.trim(),
          assigneeName: row.assigneeName.trim() || null,
        })),
      };
      return api.request<{ data: ProductionReport }>({
        path: 'production/report',
        method: 'PUT',
        json: payload,
      });
    },
    onSuccess: (result) => {
      queryClient.setQueryData(
        [
          'production-report',
          result.data.unit.id,
          result.data.reportDate,
          result.data.shift,
        ],
        result,
      );
      setNotice({ key: selectionKey, text: t('production.reportSaved') });
    },
    onError: (error) => setNotice({ key: selectionKey, text: error.message }),
  });

  const title = t('production.reportTitle');
  const update = (patch: Partial<ReportForm>) =>
    setForm((current) => ({ ...current, ...patch }));
  const updateRow = (personId: string, patch: Partial<AttendanceDraft>) =>
    setRows((current) =>
      current.map((row) =>
        row.personId === personId ? { ...row, ...patch } : row,
      ),
    );
  const updateMaterial = (skuId: string, patch: Partial<MaterialDraft>) =>
    setMaterialDrafts((current) => ({
      ...current,
      [skuId]: { ...{ quantity: '', stock: '' }, ...current[skuId], ...patch },
    }));
  const materialGroups = (
    ['feedstock', 'product', 'byproduct', 'auxiliary'] as const
  )
    .map((role) => ({
      role,
      rows: (data?.materials ?? []).filter(
        (material) => material.role === role,
      ),
    }))
    .filter((group) => group.rows.length);

  if (context.isPending)
    return (
      <PageContainer>
        <PageHeader title={title} />
        <div className='flex items-center gap-2 text-sm text-muted-foreground'>
          <Spinner />
          {t('production.loading')}
        </div>
      </PageContainer>
    );

  const contextData = context.data?.data;

  if (context.error)
    return (
      <PageContainer>
        <PageHeader title={title} />
        <Alert variant='destructive'>
          <AlertDescription>{context.error.message}</AlertDescription>
        </Alert>
        <div>
          <Button variant='outline' onClick={() => void context.refetch()}>
            {t('production.refresh')}
          </Button>
        </div>
      </PageContainer>
    );

  if (!contextData) return null;

  if (!identity?.employee && !identity?.superAdmin)
    return (
      <PageContainer>
        <PageHeader title={title} />
        <Alert variant='destructive'>
          <AlertDescription>
            {t('production.reportNoEmployee')}
          </AlertDescription>
        </Alert>
      </PageContainer>
    );

  if (identity.reason === 'NO_PRODUCTION_POSITION' || units.length === 0)
    return (
      <PageContainer>
        <PageHeader title={title} />
        <Alert variant='destructive'>
          <AlertDescription>
            {t('production.reportNoPosition')}
          </AlertDescription>
        </Alert>
      </PageContainer>
    );

  const readOnly = !contextData.canManage;
  const locked =
    readOnly || Boolean(data?.report && data.report.status !== 'draft');
  const existingDowntime = data?.downtime.events ?? [];
  const existingOvertime = data?.overtime.records ?? [];
  const equipment = data?.equipment ?? [];
  const existingMaintenance = data?.maintenance ?? [];
  const totalMinutes = rows.reduce(
    (total, row) => total + Math.round(Number(row.overtimeHours || 0) * 60),
    0,
  );
  const addDowntime = (draft: Omit<DowntimeDraft, 'id'>) =>
    setDowntime((current) => [...current, { ...draft, id: randomUuid() }]);
  const addOvertime = (draft: Omit<OvertimeDraft, 'id'>) =>
    setOvertime((current) => [...current, { ...draft, id: randomUuid() }]);
  const addMaintenance = (draft: Omit<MaintenanceDraft, 'id'>) =>
    setMaintenance((current) => [...current, { ...draft, id: randomUuid() }]);

  return (
    <PageContainer>
      <PageHeader
        title={title}
        description={t('production.reportDescription')}
      />
      <Card>
        <CardHeader>
          <CardTitle>{t('production.reportIdentity')}</CardTitle>
          <CardDescription>
            {t('production.reportIdentityHint')}
          </CardDescription>
        </CardHeader>
        <CardContent className='grid gap-4 sm:grid-cols-3'>
          <div className='space-y-1'>
            <div className='text-xs text-muted-foreground'>
              {t('production.reportCompany')}
            </div>
            <CompanyIdentity
              company={identity.company}
              hint={t('companyScope.fromIdentity')}
            />
          </div>
          <div className='space-y-1'>
            <div className='text-xs text-muted-foreground'>
              {t('production.position')}
            </div>
            <div className='text-sm font-medium'>
              {activeUnit?.positionName ?? identity.position?.name ?? '—'}
            </div>
            <div className='text-xs text-muted-foreground'>
              {activeUnit?.positionCode ?? identity.position?.code ?? ''}
            </div>
          </div>
          <div className='space-y-1'>
            <div className='text-xs text-muted-foreground'>
              {t('production.reportReporter')}
            </div>
            <div className='text-sm font-medium'>
              {identity.employee?.name ?? '—'}
            </div>
          </div>
        </CardContent>
      </Card>

      <ReadOnlyNotice canManage={contextData.canManage} canApprove={false} />

      <Card>
        <CardHeader>
          <CardTitle>{t('production.reportShift')}</CardTitle>
          <CardDescription>{t('production.reportShiftHint')}</CardDescription>
        </CardHeader>
        <CardContent className='grid gap-3 sm:grid-cols-3'>
          <div className='space-y-1 text-sm'>
            <span>{t('production.unit')}</span>
            {units.length > 1 ? (
              <select
                className={nativeSelectClass}
                value={activeUnitId}
                onChange={(event) => setUnitId(event.target.value)}
              >
                {units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.code} · {unit.name}
                  </option>
                ))}
              </select>
            ) : (
              <div className={readOnlyValueClass}>
                {activeUnit ? `${activeUnit.code} · ${activeUnit.name}` : '—'}
              </div>
            )}
          </div>
          <div className='space-y-1 text-sm'>
            <span>{t('production.reportDate')}</span>
            {backfill ? (
              <Input
                type='date'
                max={contextData.businessDate}
                value={customDate}
                onChange={(event) => setCustomDate(event.target.value)}
              />
            ) : (
              <div className={readOnlyValueClass}>{activeDate}</div>
            )}
          </div>
          <div className='space-y-1 text-sm'>
            <span>{t('production.shift')}</span>
            {backfill ? (
              <select
                className={nativeSelectClass}
                value={customShift}
                onChange={(event) =>
                  setCustomShift(event.target.value as 'day' | 'night')
                }
              >
                <option value='day'>{t('production.shifts.day')}</option>
                <option value='night'>{t('production.shifts.night')}</option>
              </select>
            ) : (
              <div className={readOnlyValueClass}>
                {activeShift === 'night'
                  ? t('production.shifts.night')
                  : t('production.shifts.day')}
              </div>
            )}
          </div>
          <div className='flex flex-wrap items-center justify-between gap-2 sm:col-span-3'>
            <p className='text-xs text-muted-foreground'>
              {backfill ? t('production.reportBackfillHint') : null}
            </p>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              disabled={readOnly}
              onClick={toggleBackfill}
            >
              {backfill
                ? t('production.reportBackfillReset')
                : t('production.reportBackfill')}
            </Button>
          </div>
        </CardContent>
      </Card>

      {report.isPending ? (
        <div className='flex items-center gap-2 text-sm text-muted-foreground'>
          <Spinner />
          {t('production.loading')}
        </div>
      ) : report.error ? (
        <Alert variant='destructive'>
          <AlertDescription>{report.error.message}</AlertDescription>
        </Alert>
      ) : null}

      {data ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{t('production.reportOutput')}</CardTitle>
              <CardDescription>
                {data.report && data.report.status !== 'draft'
                  ? t('production.reportLocked')
                  : readOnly
                    ? t('production.reportReadOnly')
                    : t('production.reportOutputHint')}
              </CardDescription>
            </CardHeader>
            <CardContent className='space-y-4'>
              {!data.materials.length ? (
                <p className='text-sm text-muted-foreground'>
                  {t('production.reportNoMaterials')}
                </p>
              ) : null}
              {materialGroups.map((group) => (
                <div key={group.role} className='space-y-2'>
                  <p className='text-sm font-medium'>
                    {t(`production.materialRoles.${group.role}`)}
                  </p>
                  <div className='overflow-x-auto rounded-lg border'>
                    <table className='w-full text-sm'>
                      <thead className='bg-muted/50 text-left'>
                        <tr>
                          <th className='px-3 py-2'>
                            {t('production.materialName')}
                          </th>
                          {seeQuantity ? (
                            <th className='px-3 py-2'>
                              {t('production.materialQuantity')}
                            </th>
                          ) : null}
                          {seeStock ? (
                            <th className='px-3 py-2'>
                              {t('production.materialStock')}
                            </th>
                          ) : null}
                          {seeBook ? (
                            <>
                              <th className='px-3 py-2'>
                                {t('production.materialBook')}
                              </th>
                              <th className='px-3 py-2'>
                                {t('production.materialDifference')}
                              </th>
                            </>
                          ) : null}
                        </tr>
                      </thead>
                      <tbody>
                        {group.rows.map((material) => {
                          const draft = materialDrafts[material.skuId] ?? {
                            quantity: '',
                            stock: '',
                          };
                          const saved = data.report?.materials?.find(
                            (line) => line.skuId === material.skuId,
                          );
                          const book =
                            saved?.bookQuantity ?? material.bookQuantity;
                          return (
                            <tr key={material.skuId} className='border-t'>
                              <td className='px-3 py-2'>
                                {material.skuCode} {material.skuName}
                                <span className='ml-1 text-xs text-muted-foreground'>
                                  {material.unit}
                                </span>
                              </td>
                              {seeQuantity ? (
                                <td className='px-3 py-2'>
                                  <Input
                                    inputMode='decimal'
                                    disabled={locked || !writeQuantity}
                                    value={draft.quantity}
                                    onChange={(event) =>
                                      updateMaterial(material.skuId, {
                                        quantity: event.target.value,
                                      })
                                    }
                                  />
                                </td>
                              ) : null}
                              {seeStock ? (
                                <td className='px-3 py-2'>
                                  <Input
                                    inputMode='decimal'
                                    disabled={locked || !writeStock}
                                    value={draft.stock}
                                    onChange={(event) =>
                                      updateMaterial(material.skuId, {
                                        stock: event.target.value,
                                      })
                                    }
                                  />
                                </td>
                              ) : null}
                              {seeBook ? (
                                <>
                                  <td className='px-3 py-2 text-muted-foreground'>
                                    {book ?? '—'}
                                  </td>
                                  <td className='px-3 py-2'>
                                    {difference(draft.stock, book)}
                                  </td>
                                </>
                              ) : null}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
              <div className='grid max-w-2xl gap-3 sm:grid-cols-2'>
                <label className='space-y-1 text-sm'>
                  <span>{t('production.runtimeMinutes')}</span>
                  <Input
                    type='number'
                    min='0'
                    max='1440'
                    disabled={locked}
                    value={form.runtimeMinutes}
                    onChange={(event) =>
                      update({ runtimeMinutes: event.target.value })
                    }
                  />
                </label>
                <label className='space-y-1 text-sm'>
                  <span>{t('production.downtimeMinutes')}</span>
                  <Input
                    type='number'
                    min='0'
                    max='1440'
                    disabled={locked}
                    value={form.downtimeMinutes}
                    onChange={(event) =>
                      update({ downtimeMinutes: event.target.value })
                    }
                  />
                </label>
              </div>
              <label className='space-y-1 text-sm'>
                <span>{t('production.notes')}</span>
                <Textarea
                  disabled={locked}
                  value={form.notes}
                  onChange={(event) => update({ notes: event.target.value })}
                />
              </label>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('production.reportAttendance')}</CardTitle>
              <CardDescription>
                {t('production.reportAttendanceHint')}
              </CardDescription>
            </CardHeader>
            <CardContent className='space-y-3'>
              {rows.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('production.person')}</TableHead>
                      <TableHead>{t('production.position')}</TableHead>
                      <TableHead>{t('production.statusLabel')}</TableHead>
                      <TableHead>{t('production.absenceReason')}</TableHead>
                      <TableHead>{t('production.overtimeHours')}</TableHead>
                      <TableHead>{t('production.overtimeContent')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.personId}>
                        <TableCell>{row.personName}</TableCell>
                        <TableCell className='text-muted-foreground'>
                          {row.positionName}
                        </TableCell>
                        <TableCell>
                          <select
                            className={`${nativeSelectClass} min-w-24`}
                            disabled={locked}
                            value={row.status}
                            onChange={(event) => {
                              const status = event.target
                                .value as AttendanceStatus;
                              updateRow(row.personId, {
                                status,
                                ...(status === 'present' || status === 'rest'
                                  ? {}
                                  : {
                                      overtimeHours: '',
                                      overtimeContent: '',
                                    }),
                              });
                            }}
                          >
                            {statuses.map((value) => (
                              <option key={value} value={value}>
                                {t(`production.status.${value}`)}
                              </option>
                            ))}
                          </select>
                        </TableCell>
                        <TableCell>
                          <Input
                            disabled={locked}
                            value={row.absenceReason}
                            placeholder={t(
                              'production.absenceReasonPlaceholder',
                            )}
                            onChange={(event) =>
                              updateRow(row.personId, {
                                absenceReason: event.target.value,
                              })
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type='number'
                            min='0'
                            max='24'
                            step='0.5'
                            disabled={locked}
                            value={row.overtimeHours}
                            onChange={(event) =>
                              updateRow(row.personId, {
                                overtimeHours: event.target.value,
                              })
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            disabled={locked}
                            value={row.overtimeContent}
                            placeholder={t(
                              'production.overtimeContentPlaceholder',
                            )}
                            onChange={(event) =>
                              updateRow(row.personId, {
                                overtimeContent: event.target.value,
                              })
                            }
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className='text-sm text-muted-foreground'>
                  {t('production.empty')}
                </p>
              )}
              <p className='text-xs text-muted-foreground'>
                {t('production.reportOvertimeSummary', {
                  people: rows.filter(
                    (row) => Number(row.overtimeHours || 0) > 0,
                  ).length,
                  hours: totalMinutes / 60,
                })}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('production.reportDowntime')}</CardTitle>
              <CardDescription>
                {t('production.reportDowntimeHint')}
              </CardDescription>
            </CardHeader>
            <CardContent className='space-y-3'>
              {readOnly ? null : <DowntimeComposer onAdd={addDowntime} />}
              {downtime.length ? (
                <ul className='space-y-1 text-sm'>
                  {downtime.map((row) => (
                    <li
                      key={row.id}
                      className='flex items-center justify-between gap-2 rounded-md border px-3 py-2'
                    >
                      <span>
                        {row.time} ·{' '}
                        {t(`production.downtimeCategory_${row.category}`)}
                        {' · '}
                        {row.description}
                      </span>
                      <Button
                        type='button'
                        size='sm'
                        variant='ghost'
                        onClick={() =>
                          setDowntime((current) =>
                            current.filter((item) => item.id !== row.id),
                          )
                        }
                      >
                        <Trash2 className='size-4' />
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {existingDowntime.length ? (
                <div className='space-y-1'>
                  <p className='text-xs font-medium text-muted-foreground'>
                    {t('production.reportDowntimeExisting')}
                  </p>
                  {existingDowntime.slice(0, 8).map((row) => (
                    <div
                      key={row.id}
                      className='flex items-center justify-between gap-2 border-t py-1.5 text-sm'
                    >
                      <span className='truncate'>
                        {clock(row.startedAt)} · {row.description}
                      </span>
                      <span className='shrink-0 text-xs text-muted-foreground'>
                        {row.durationMinutes} min ·{' '}
                        {t(`production.downtimeStatus_${row.status}`)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('production.reportMaintenance')}</CardTitle>
              <CardDescription>
                {t('production.reportMaintenanceHint')}
              </CardDescription>
            </CardHeader>
            <CardContent className='space-y-3'>
              {readOnly || !equipment.length ? null : (
                <MaintenanceComposer
                  equipment={equipment}
                  onAdd={addMaintenance}
                />
              )}
              {!equipment.length ? (
                <p className='text-sm text-muted-foreground'>
                  {t('production.reportNoEquipment')}
                </p>
              ) : null}
              {maintenance.length ? (
                <ul className='space-y-1 text-sm'>
                  {maintenance.map((row) => {
                    const device = equipment.find(
                      (item) => item.id === row.equipmentId,
                    );
                    return (
                      <li
                        key={row.id}
                        className='flex items-center justify-between gap-2 rounded-md border px-3 py-2'
                      >
                        <span>
                          {device?.name ?? row.equipmentId} ·{' '}
                          {t(
                            row.kind === 'maintenance'
                              ? 'production.reportMaintenanceKind_maintenance'
                              : 'production.reportMaintenanceKind_repair',
                          )}
                          {' · '}
                          {row.description}
                        </span>
                        <Button
                          type='button'
                          size='sm'
                          variant='ghost'
                          onClick={() =>
                            setMaintenance((current) =>
                              current.filter((item) => item.id !== row.id),
                            )
                          }
                        >
                          <Trash2 className='size-4' />
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              {existingMaintenance.length ? (
                <div className='space-y-1'>
                  <p className='text-xs font-medium text-muted-foreground'>
                    {t('production.reportMaintenanceExisting')}
                  </p>
                  {existingMaintenance.slice(0, 8).map((row) => (
                    <div
                      key={row.id}
                      className='flex items-center justify-between gap-2 border-t py-1.5 text-sm'
                    >
                      <span className='truncate'>
                        {row.equipmentName} ·{' '}
                        {row.type === 'preventive'
                          ? t('production.maintenanceType_preventive')
                          : t('production.maintenanceType_repair')}
                        {' · '}
                        {row.description}
                      </span>
                      <span className='shrink-0 text-xs text-muted-foreground'>
                        {row.orderNo}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('production.reportOvertime')}</CardTitle>
              <CardDescription>
                {t('production.reportOvertimeHint')}
              </CardDescription>
            </CardHeader>
            <CardContent className='space-y-3'>
              {readOnly ? null : (
                <OvertimeComposer
                  people={rows.map((row) => ({
                    personId: row.personId,
                    personName: row.personName,
                  }))}
                  onAdd={addOvertime}
                />
              )}
              {overtime.length ? (
                <ul className='space-y-1 text-sm'>
                  {overtime.map((row) => {
                    const person = rows.find(
                      (item) => item.personId === row.personId,
                    );
                    return (
                      <li
                        key={row.id}
                        className='flex items-center justify-between gap-2 rounded-md border px-3 py-2'
                      >
                        <span>
                          {person?.personName ?? ''} · {row.hours}h ·{' '}
                          {row.reason}
                        </span>
                        <Button
                          type='button'
                          size='sm'
                          variant='ghost'
                          onClick={() =>
                            setOvertime((current) =>
                              current.filter((item) => item.id !== row.id),
                            )
                          }
                        >
                          <Trash2 className='size-4' />
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              {existingOvertime.length ? (
                <div className='space-y-1'>
                  <p className='text-xs font-medium text-muted-foreground'>
                    {t('production.reportOvertimeExisting')}
                  </p>
                  {existingOvertime.slice(0, 8).map((row) => (
                    <div
                      key={row.id}
                      className='flex items-center justify-between gap-2 border-t py-1.5 text-sm'
                    >
                      <span className='truncate'>
                        {row.personName} · {row.hours}h · {row.reason}
                      </span>
                      <span className='shrink-0 text-xs text-muted-foreground'>
                        {t(`production.overtimeStatus_${row.status}`)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <div className='flex flex-wrap items-center gap-3'>
            {!readOnly ? (
              <Button disabled={save.isPending} onClick={() => save.mutate()}>
                <Save className='size-4' />
                {save.isPending
                  ? t('production.saving')
                  : t('production.reportSubmit')}
              </Button>
            ) : (
              <p className='text-sm text-muted-foreground'>
                {t('production.reportReadOnly')}
              </p>
            )}
            {noticeText ? (
              <p className='text-sm text-muted-foreground' role='status'>
                {noticeText}
              </p>
            ) : null}
          </div>
        </>
      ) : null}
    </PageContainer>
  );
}

function DowntimeComposer({
  onAdd,
}: {
  readonly onAdd: (draft: Omit<DowntimeDraft, 'id'>) => void;
}) {
  const { t } = useTranslation();
  const [time, setTime] = useState(shanghaiTime);
  const [category, setCategory] = useState<DowntimeCategory>('equipment');
  const [impact, setImpact] = useState<DowntimeImpact>('stop');
  const [description, setDescription] = useState('');
  return (
    <div className='space-y-2 rounded-md border p-3'>
      <div className='grid gap-2 sm:grid-cols-3'>
        <label className='space-y-1 text-sm'>
          <span>{t('production.downtimeStartedAt')}</span>
          <Input
            type='time'
            value={time}
            onChange={(event) => setTime(event.target.value)}
          />
        </label>
        <label className='space-y-1 text-sm'>
          <span>{t('production.downtimeCategory')}</span>
          <select
            className={nativeSelectClass}
            value={category}
            onChange={(event) =>
              setCategory(event.target.value as DowntimeCategory)
            }
          >
            {downtimeCategories.map((value) => (
              <option key={value} value={value}>
                {t(`production.downtimeCategory_${value}`)}
              </option>
            ))}
          </select>
        </label>
        <label className='space-y-1 text-sm'>
          <span>{t('production.downtimeImpact')}</span>
          <select
            className={nativeSelectClass}
            value={impact}
            onChange={(event) =>
              setImpact(event.target.value as DowntimeImpact)
            }
          >
            {downtimeImpacts.map((value) => (
              <option key={value} value={value}>
                {t(`production.downtimeImpact_${value}`)}
              </option>
            ))}
          </select>
        </label>
        <label className='space-y-1 text-sm sm:col-span-3'>
          <span>{t('production.downtimeDescription')}</span>
          <Input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
      </div>
      <Button
        type='button'
        size='sm'
        variant='outline'
        disabled={!description.trim()}
        onClick={() => {
          onAdd({ time, category, impact, description: description.trim() });
          setDescription('');
          setTime(shanghaiTime());
        }}
      >
        <Plus className='size-4' />
        {t('production.reportAdd')}
      </Button>
    </div>
  );
}

function OvertimeComposer({
  people,
  onAdd,
}: {
  readonly people: { personId: string; personName: string }[];
  readonly onAdd: (draft: Omit<OvertimeDraft, 'id'>) => void;
}) {
  const { t } = useTranslation();
  const [personId, setPersonId] = useState('');
  const [hours, setHours] = useState('1');
  const [type, setType] = useState<OvertimeType>('temporary');
  const [reason, setReason] = useState('');
  const selected = people.some((person) => person.personId === personId)
    ? personId
    : (people[0]?.personId ?? '');
  return (
    <div className='space-y-2 rounded-md border p-3'>
      <div className='grid gap-2 sm:grid-cols-4'>
        <label className='space-y-1 text-sm'>
          <span>{t('production.person')}</span>
          <select
            className={nativeSelectClass}
            value={selected}
            onChange={(event) => setPersonId(event.target.value)}
          >
            {people.map((person) => (
              <option key={person.personId} value={person.personId}>
                {person.personName}
              </option>
            ))}
          </select>
        </label>
        <label className='space-y-1 text-sm'>
          <span>{t('production.overtimeHours')}</span>
          <Input
            type='number'
            min='0.5'
            max='24'
            step='0.5'
            value={hours}
            onChange={(event) => setHours(event.target.value)}
          />
        </label>
        <label className='space-y-1 text-sm'>
          <span>{t('production.overtimeType')}</span>
          <select
            className={nativeSelectClass}
            value={type}
            onChange={(event) => setType(event.target.value as OvertimeType)}
          >
            {overtimeTypes.map((value) => (
              <option key={value} value={value}>
                {t(`production.overtimeType_${value}`)}
              </option>
            ))}
          </select>
        </label>
        <label className='space-y-1 text-sm'>
          <span>{t('production.overtimeReason')}</span>
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
      </div>
      <Button
        type='button'
        size='sm'
        variant='outline'
        disabled={!selected || !reason.trim() || Number(hours) < 0.5}
        onClick={() => {
          onAdd({ personId: selected, hours, type, reason: reason.trim() });
          setReason('');
        }}
      >
        <Plus className='size-4' />
        {t('production.reportAdd')}
      </Button>
    </div>
  );
}

function MaintenanceComposer({
  equipment,
  onAdd,
}: {
  readonly equipment: { id: string; code: string; name: string }[];
  readonly onAdd: (draft: Omit<MaintenanceDraft, 'id'>) => void;
}) {
  const { t } = useTranslation();
  const [equipmentId, setEquipmentId] = useState('');
  const [kind, setKind] = useState<'repair' | 'maintenance'>('repair');
  const [description, setDescription] = useState('');
  const [assigneeName, setAssigneeName] = useState('');
  const selected = equipment.some((item) => item.id === equipmentId)
    ? equipmentId
    : (equipment[0]?.id ?? '');
  return (
    <div className='space-y-2 rounded-md border p-3'>
      <div className='grid gap-2 sm:grid-cols-4'>
        <label className='space-y-1 text-sm'>
          <span>{t('production.equipmentName')}</span>
          <select
            className={nativeSelectClass}
            value={selected}
            onChange={(event) => setEquipmentId(event.target.value)}
          >
            {equipment.map((item) => (
              <option key={item.id} value={item.id}>
                {item.code} {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className='space-y-1 text-sm'>
          <span>{t('production.maintenanceType')}</span>
          <select
            className={nativeSelectClass}
            value={kind}
            onChange={(event) =>
              setKind(event.target.value as 'repair' | 'maintenance')
            }
          >
            <option value='repair'>
              {t('production.maintenanceType_repair')}
            </option>
            <option value='maintenance'>
              {t('production.maintenanceType_preventive')}
            </option>
          </select>
        </label>
        <label className='space-y-1 text-sm sm:col-span-2'>
          <span>{t('production.faultDescription')}</span>
          <Input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <label className='space-y-1 text-sm sm:col-span-2'>
          <span>{t('production.assignee')}</span>
          <Input
            value={assigneeName}
            onChange={(event) => setAssigneeName(event.target.value)}
          />
        </label>
      </div>
      <Button
        type='button'
        size='sm'
        variant='outline'
        disabled={!selected || !description.trim()}
        onClick={() => {
          onAdd({
            equipmentId: selected,
            kind,
            description: description.trim(),
            assigneeName: assigneeName.trim(),
          });
          setDescription('');
          setAssigneeName('');
        }}
      >
        <Plus className='size-4' />
        {t('production.reportAdd')}
      </Button>
    </div>
  );
}
