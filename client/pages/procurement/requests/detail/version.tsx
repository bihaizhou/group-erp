import { DemandGovernance } from '#components/demand-governance/index';
import { DemandAttachments } from '#components/demand-attachments/index';
import { useOutletContext, useParams } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { RouteChildPage } from '#components/route-child-page';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { BackButton } from '#components/back-button';
import { ui, useRequest } from '../hooks.js';
import { ErrorNotice, Loading } from '../controls.js';
import {
  RequestInformation,
  DemandLines,
  type DetailContext,
} from './index.js';
export default function SubmittedVersion() {
  const { t } = useTranslation(),
    { versionId } = useParams(),
    context = useOutletContext<DetailContext>(),
    result = useRequest(context.recordId),
    row = result.data?.data,
    version = row?.versions.find((v) => v.id === versionId),
    rules = version?.payload.parameterSnapshot?.values;
  return (
    <RouteChildPage>
      <PageContainer>
        <BackButton />
        <PageHeader
          title={`${t(ui('version'))} ${version?.contentVersion ?? ''}`}
          description={t(ui('submittedName'))}
        />
        {result.error ? (
          <ErrorNotice
            error={result.error}
            retry={() => void result.refetch()}
          />
        ) : !row ? (
          <Loading kind='detail' />
        ) : !version ? (
          <p>{t(ui('notFound'))}</p>
        ) : (
          <div className='flex flex-col gap-6'>
            <RequestInformation row={row} snapshot={version} />
            <DemandGovernance domain='procurement' request={row} readonly>
              <DemandLines lines={version.payload.lines} />
            </DemandGovernance>
            <DemandAttachments
              domain='procurement'
              requestId={row.id}
              value={version.payload.attachments ?? []}
              lines={version.payload.lines.map((line, index) => ({
                id: line.id,
                label: t(ui('lineTitle'), { number: index + 1 }),
              }))}
            />
            <section className='flex flex-col gap-4'>
              <h2 className='text-base font-medium'>{t(ui('frozenRules'))}</h2>
              <p className='text-sm'>
                {t(
                  ui(
                    rules?.allowParallelGovernance
                      ? 'parallelAllowed'
                      : 'identificationFirst',
                  ),
                )}
              </p>
              {rules?.reviewerSelections.map((s) => (
                <p
                  key={`${s.group}-${s.type}-${s.referenceId}`}
                  className='text-sm'
                >
                  {t(ui('candidateGroup'), { number: s.group })} ·{' '}
                  {t(ui(s.type === 'user' ? 'account' : 'position'))} ·{' '}
                  {t(ui('nameNotRecorded'))}
                </p>
              ))}
            </section>
          </div>
        )}
      </PageContainer>
    </RouteChildPage>
  );
}
