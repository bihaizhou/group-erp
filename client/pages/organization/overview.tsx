import { useOptions } from './hooks.js';
import { useTranslation } from '@nocobase/i18n/client';
import { Link } from 'react-router';
import {
  Building2,
  Layers,
  BriefcaseBusiness,
  ChevronRightIcon,
} from 'lucide-react';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from '#components/ui/card';
import { Button } from '#components/ui/button';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from '#components/ui/empty';
import { ErrorNotice, Loading, OrgStatus } from './shared.js';
import type { OrgRecord } from './model.js';

export default function OrganizationOverview() {
  const { t, i18n } = useTranslation();
  const options = useOptions();
  const data = options.data?.data;
  return (
    <PageContainer>
      <PageHeader
        title={t('org.overview')}
        description={t('org.structureDescription')}
      />
      {options.isError ? (
        <ErrorNotice
          error={options.error}
          retry={() => void options.refetch()}
        />
      ) : !data ? (
        <Loading />
      ) : (
        <>
          <div className='grid gap-4 sm:grid-cols-3'>
            {(['subjects', 'units', 'positions'] as const).map((kind) => (
              <Card key={kind}>
                <CardHeader>
                  <CardDescription>{t(`org.${kind}`)}</CardDescription>
                  <CardTitle className='text-3xl'>
                    {data[kind].total.toLocaleString(i18n.language)}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Link
                    className='text-sm text-primary hover:underline'
                    to={`/organization/${kind}`}
                  >
                    {t('org.goList', { kind: t(`org.${kind}`) })}
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
          {Object.values(data).some((v) => v.truncated) ? (
            <p className='text-sm text-muted-foreground'>
              {t('org.cap', { limit: 1000 })}
            </p>
          ) : null}
          {!data.subjects.rows.length ? (
            <Empty className='min-h-48 border border-dashed'>
              <EmptyHeader>
                <EmptyMedia variant='icon'>
                  <Building2 />
                </EmptyMedia>
                <EmptyTitle>{t('org.emptyTree')}</EmptyTitle>
                <EmptyDescription>{t('org.emptyTreeHint')}</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button
                  nativeButton={false}
                  render={<Link to='/organization/subjects' />}
                >
                  {t('org.goList', { kind: t('org.subjects') })}
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>{t('org.structure')}</CardTitle>
                <CardDescription>{t('org.start')}</CardDescription>
              </CardHeader>
              <CardContent>
                <SubjectTree
                  subjects={data.subjects.rows}
                  units={data.units.rows}
                  positions={data.positions.rows}
                />
              </CardContent>
            </Card>
          )}
        </>
      )}
    </PageContainer>
  );
}
function SubjectTree({
  subjects,
  units,
  positions,
  parentId,
}: {
  subjects: OrgRecord[];
  units: OrgRecord[];
  positions: OrgRecord[];
  parentId?: string;
}) {
  const nodes = subjects.filter((row) =>
    parentId
      ? row.parentId === parentId
      : !row.parentId || !subjects.some((p) => p.id === row.parentId),
  );
  return (
    <ul className='flex flex-col gap-2'>
      {nodes.map((row) => (
        <li key={row.id}>
          <details open className='group'>
            <summary className='flex cursor-pointer list-none items-center gap-2 rounded-lg p-2 hover:bg-muted'>
              <ChevronRightIcon className='size-4 shrink-0 transition-transform group-open:rotate-90' />
              <Building2 className='size-4 shrink-0' />
              <span className='min-w-0 break-words text-sm font-medium'>
                {row.name}
              </span>
              <OrgStatus status={row.status} />
            </summary>
            <div className='ml-4 border-l pl-3'>
              <UnitTree
                units={units.filter((unit) => unit.subjectId === row.id)}
                positions={positions}
              />
              <SubjectTree
                subjects={subjects}
                units={units}
                positions={positions}
                parentId={row.id}
              />
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}
function UnitTree({
  units,
  positions,
  parentId,
}: {
  units: OrgRecord[];
  positions: OrgRecord[];
  parentId?: string;
}) {
  return (
    <ul className='flex flex-col gap-2'>
      {units
        .filter((row) =>
          parentId
            ? row.parentId === parentId
            : !row.parentId || !units.some((p) => p.id === row.parentId),
        )
        .map((row) => (
          <li key={row.id}>
            <details open>
              <summary className='flex cursor-pointer items-center gap-2 p-2 text-sm'>
                <Layers className='size-4 shrink-0' />
                <span className='break-words'>{row.name}</span>
                <OrgStatus status={row.status} />
              </summary>
              <div className='ml-4 border-l pl-3'>
                <ul className='flex flex-col gap-2'>
                  {positions
                    .filter((p) => p.unitId === row.id)
                    .map((p) => (
                      <li
                        className='flex items-center gap-2 p-2 text-sm'
                        key={p.id}
                      >
                        <BriefcaseBusiness className='size-4 shrink-0' />
                        <span className='break-words'>{p.name}</span>
                        <OrgStatus status={p.status} />
                      </li>
                    ))}
                </ul>
                <UnitTree
                  units={units}
                  positions={positions}
                  parentId={row.id}
                />
              </div>
            </details>
          </li>
        ))}
    </ul>
  );
}
