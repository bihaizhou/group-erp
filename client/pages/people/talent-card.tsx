import { textValue } from './model.js';
import { useState } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import { useApiClient } from '@nocobase/app-client';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router';
import { UserRound, Star, Target, Award, TrendingUp } from 'lucide-react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '#components/ui/card';
import { StatusBadge } from '#components/status-badge';
import { LongText } from '#components/long-text';
import {
  Table,
  TableBody,
  TableRow,
  TableCell,
  TableHead,
  TableHeader,
} from '#components/ui/table';
import { PeopleSelect, PeopleLoading, PeopleErrorNotice } from './controls.js';
import { TalentRadar } from './talent-radar.js';
import { type Row, type Data, type Options } from './model.js';

type Related = { rows: Row[]; total: number; truncated: boolean };
export type TalentPhase = {
  phase: 'pending' | 'probation' | 'regular' | 'due' | 'departed';
  since?: string | null;
  probationEnd?: string | null;
};
const phaseTones: Record<
  TalentPhase['phase'],
  'neutral' | 'info' | 'warning' | 'success'
> = {
  pending: 'neutral',
  probation: 'info',
  due: 'warning',
  regular: 'success',
  departed: 'neutral',
};
type Talent = {
  asOf: string;
  photoUrl: string | null;
  person: Row;
  phase?: TalentPhase;
  profiles: Related;
  employments: Related;
  assignments: Related;
  evaluations: Related;
  developmentPlans: Related;
  options: Options;
};
export function TalentCard({ profile }: { profile: Row }) {
  const { t, i18n } = useTranslation(),
    api = useApiClient(),
    location = useLocation(),
    [benchmark, setBenchmark] = useState('snapshot');
  const query = useQuery({
    retry: false,
    queryKey: ['people-talent', profile.personId],
    queryFn: ({ signal }) =>
      api.request<{ data: Talent }>({
        path: `people/talent/${profile.personId}`,
        signal,
      }),
  });
  if (query.isError)
    return (
      <PeopleErrorNotice
        error={query.error}
        retry={() => void query.refetch()}
      />
    );
  if (!query.data) return <PeopleLoading />;
  const talent = query.data.data,
    phase = talent.phase,
    d = profile.data;
  const name = (source: string, id: unknown) =>
    talent.options[source]?.rows.find((r) => r.id === id)?.name ?? '—';
  const current = talent.assignments.rows.filter(
    (r) =>
      textValue(r.data.startDate) <= talent.asOf &&
      (!r.data.endDate || textValue(r.data.endDate) > talent.asOf),
  );
  const primary = current.find((r) => r.data.type === 'primary');
  const unitId = (
    talent.options.orgPositions?.rows.find(
      (r) => r.id === primary?.positionId,
    ) as unknown as Data | undefined
  )?.unitId;
  const latest = talent.evaluations.rows
    .filter((r) => r.status === 'confirmed')
    .sort(
      (a, b) =>
        textValue(b.data.evaluationDate).localeCompare(
          textValue(a.data.evaluationDate),
        ) || b.updatedAt.localeCompare(a.updatedAt),
    )[0];
  const dimensions = (latest?.snapshot?.dimensions as Data[] | undefined) ?? [];
  const ratings = (latest?.data.ratings as Data[] | undefined) ?? [];
  const targetModel = talent.options.models?.rows.find(
    (r) => r.id === d.targetModelId,
  );
  const targetItems = (targetModel?.data.items as Data[] | undefined) ?? [];
  const table = dimensions.map((dimension) => {
    const rating = ratings.find((r) => r.dimensionId === dimension.dimensionId);
    const target =
      benchmark === 'target'
        ? targetItems.find((r) => r.dimensionId === dimension.dimensionId)
            ?.target
        : dimension.target;
    return {
      id: textValue(dimension.dimensionId),
      name: textValue(dimension.name),
      score:
        typeof rating?.confirmedScore === 'number'
          ? rating.confirmedScore
          : null,
      target: typeof target === 'number' ? target : null,
      evidence: textValue(rating?.confirmedScoreEvidence ?? ''),
      standards: dimension.standards as string[],
    };
  });
  const scored = table
    .filter((r): r is typeof r & { score: number } => r.score !== null)
    .slice(0, 8);
  const values = [
    ['code', talent.person.code],
    ['subjectId', name('orgSubjects', talent.person.subjectId)],
    ['unit', name('orgUnits', unitId)],
    ['positionId', name('orgPositions', primary?.positionId)],
    [
      'grade',
      profile.grade ? t('people.gradeValue', { grade: profile.grade }) : '—',
    ],
    [
      'startDate',
      talent.employments.rows.find((r) => !r.data.endDate)?.data.startDate,
    ],
    ['location', primary?.data.location || talent.person.data.location],
  ];
  const textCard = (key: string, icon: React.ReactNode) => (
    <Card>
      <CardHeader>
        <CardTitle className='flex items-center gap-2'>
          {icon}
          {t(`people.fields.${textValue(key)}`)}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <LongText>{textValue(d[key] || t('people.notRecorded'))}</LongText>
      </CardContent>
    </Card>
  );
  return (
    <div className='flex flex-col gap-6'>
      <div className='grid gap-6 lg:grid-cols-2'>
        <Card>
          <CardHeader>
            <div className='flex items-center gap-4'>
              <div className='flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-foreground'>
                {talent.person.data.photoId ? (
                  <img
                    className='size-full object-cover'
                    src={talent.photoUrl ?? undefined}
                    alt={talent.person.name}
                  />
                ) : (
                  <UserRound className='size-10' />
                )}
              </div>
              <div className='min-w-0'>
                <CardTitle className='break-words text-2xl'>
                  {talent.person.name}
                </CardTitle>
                <CardDescription>{talent.person.code}</CardDescription>
                <div className='mt-2 flex flex-wrap items-center gap-2'>
                  {phase ? (
                    <StatusBadge tone={phaseTones[phase.phase]}>
                      {t(`people.phases.${phase.phase}`)}
                    </StatusBadge>
                  ) : (
                    <StatusBadge tone={current.length ? 'success' : 'neutral'}>
                      {t(
                        current.length
                          ? 'people.inService'
                          : 'people.noActiveAssignment',
                      )}
                    </StatusBadge>
                  )}
                  {phase && phase.phase === 'departed' && phase.since ? (
                    <span className='text-xs text-muted-foreground'>
                      {t('people.leftOn', { date: phase.since })}
                    </span>
                  ) : null}
                  {phase &&
                  (phase.phase === 'probation' || phase.phase === 'due') &&
                  phase.probationEnd ? (
                    <span className='text-xs text-muted-foreground'>
                      {t('people.probationUntil', {
                        date: phase.probationEnd,
                      })}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <dl className='flex flex-col gap-3'>
              {values.map(([key, value]) => (
                <div
                  key={textValue(key)}
                  className='grid grid-cols-[8rem_1fr] gap-3 border-b pb-3 last:border-0'
                >
                  <dt className='text-sm text-muted-foreground'>
                    {t(`people.fields.${textValue(key)}`)}
                  </dt>
                  <dd className='text-sm break-words'>
                    {textValue(value || '—')}
                  </dd>
                </div>
              ))}
            </dl>
            {current
              .filter((r) => r.data.type === 'partTime')
              .map((r) => (
                <p key={r.id} className='mt-3 text-sm text-muted-foreground'>
                  {t('people.values.partTime')} ·{' '}
                  {name('orgSubjects', r.subjectId)} ·{' '}
                  {name('orgPositions', r.positionId)}
                </p>
              ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className='flex items-center gap-2'>
              <Star className='size-4 text-primary' />
              {t('people.capabilities')}
            </CardTitle>
            <CardDescription>
              {latest
                ? t('people.evaluatedOn', {
                    date: new Date(
                      `${textValue(latest.data.evaluationDate)}T00:00:00`,
                    ).toLocaleDateString(i18n.language),
                  })
                : t('people.noEvaluation')}
            </CardDescription>
            {targetModel ? (
              <PeopleSelect
                label={t('people.benchmark')}
                value={benchmark}
                onChange={setBenchmark}
                items={[
                  { value: 'snapshot', label: t('people.snapshotBenchmark') },
                  {
                    value: 'target',
                    label: t('people.targetBenchmark', {
                      name: targetModel.name,
                    }),
                  },
                ]}
              />
            ) : null}
          </CardHeader>
          <CardContent>
            {scored.length >= 3 ? (
              <TalentRadar items={scored} />
            ) : (
              <p className='rounded-lg bg-muted p-6 text-sm text-muted-foreground'>
                {t('people.radarNeedsScores')}
              </p>
            )}
            {table.length > scored.length ? (
              <p className='text-sm text-muted-foreground'>
                {t('people.radarSubset')}
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>
      <div className='grid gap-4 md:grid-cols-3'>
        <Card>
          <CardHeader>
            <CardTitle>{t('people.recentPerformance')}</CardTitle>
          </CardHeader>
          <CardContent className='flex flex-wrap gap-4'>
            {(d.performance as Data[]).length ? (
              (d.performance as Data[]).slice(0, 2).map((p) => (
                <div key={JSON.stringify(p)}>
                  <p className='text-2xl font-semibold'>
                    {textValue(p.result)}
                  </p>
                  <p className='text-sm text-muted-foreground'>
                    {textValue(p.period)}
                  </p>
                </div>
              ))
            ) : (
              <p className='text-sm text-muted-foreground'>
                {t('people.notRecorded')}
              </p>
            )}
          </CardContent>
        </Card>
        {textCard('strengths', <Award className='size-4 text-primary' />)}
        {textCard('improvements', <Target className='size-4 text-primary' />)}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t('people.dimensionTable')}</CardTitle>
          <CardDescription>
            {t('people.dimensionTableDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {table.length ? (
            <div className='overflow-x-auto'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('people.fields.dimensionId')}</TableHead>
                    <TableHead className='text-right'>
                      {t('people.employeeScore')}
                    </TableHead>
                    <TableHead className='text-right'>
                      {t('people.modelTarget')}
                    </TableHead>
                    <TableHead>{t('people.fields.evidence')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {table.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{r.name}</TableCell>
                      <TableCell className='text-right tabular-nums'>
                        {r.score === null
                          ? t('people.unrated')
                          : r.score.toLocaleString(i18n.language, {
                              minimumFractionDigits: 1,
                            })}
                      </TableCell>
                      <TableCell className='text-right tabular-nums'>
                        {r.target ?? '—'}
                      </TableCell>
                      <TableCell>
                        <LongText>{r.evidence || '—'}</LongText>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className='text-sm text-muted-foreground'>
              {t('people.noEvaluation')}
            </p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('people.fields.achievements')}</CardTitle>
        </CardHeader>
        <CardContent className='grid gap-4 md:grid-cols-3'>
          {(d.achievements as Data[]).length ? (
            (d.achievements as Data[]).map((a) => (
              <div
                key={JSON.stringify(a)}
                className='flex flex-col gap-2 rounded-lg border p-4'
              >
                <p className='text-sm font-medium'>{textValue(a.title)}</p>
                <p className='text-xs text-muted-foreground'>
                  {textValue(a.date)}
                </p>
                <LongText>{textValue(a.contribution || '—')}</LongText>
                <LongText>{textValue(a.result || '—')}</LongText>
                <LongText>{textValue(a.evidence || '—')}</LongText>
              </div>
            ))
          ) : (
            <p className='text-sm text-muted-foreground'>
              {t('people.notRecorded')}
            </p>
          )}
        </CardContent>
      </Card>
      <div className='grid gap-4 md:grid-cols-2'>
        {textCard(
          'careerDirection',
          <TrendingUp className='size-4 text-primary' />,
        )}
        {textCard('potential', <Target className='size-4 text-primary' />)}
        {textCard(
          'potentialEvidence',
          <Award className='size-4 text-primary' />,
        )}
        {textCard('toValidate', <Star className='size-4 text-primary' />)}
      </div>
      {(['evaluations', 'developmentPlans'] as const).map((kind) => (
        <Card key={kind}>
          <CardHeader>
            <CardTitle>{t(`people.${kind}`)}</CardTitle>
            <CardDescription>{t('people.relatedHistory')}</CardDescription>
          </CardHeader>
          <CardContent className='flex flex-col gap-3'>
            {talent[kind].rows.slice(0, 10).map((row) => (
              <div
                key={row.id}
                className='flex items-center justify-between gap-3'
              >
                <Link
                  className='min-w-0 truncate text-sm font-medium text-primary underline-offset-4 hover:underline'
                  to={{
                    pathname: `${kind}/${row.id}`,
                    search: location.search,
                  }}
                >
                  {row.name}
                </Link>
                <StatusBadge>{t(`people.states.${row.status}`)}</StatusBadge>
              </div>
            ))}
            {!talent[kind].rows.length ? (
              <p className='text-sm text-muted-foreground'>
                {t('people.notRecorded')}
              </p>
            ) : null}
            <Link
              className='text-sm text-primary hover:underline'
              to={`/human-resources/${kind}`}
            >
              {t('people.viewAll')}
            </Link>
            {talent[kind].truncated ? (
              <p className='text-sm text-muted-foreground'>
                {t('people.relatedCap')}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
