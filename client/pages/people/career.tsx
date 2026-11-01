import { useTranslation } from '@nocobase/i18n/client';
import { ArrowRight } from 'lucide-react';
import { cn } from 'cn';
import type { ReactElement, ReactNode } from 'react';
import { LongText } from '#components/long-text';
import { StatusBadge } from '#components/status-badge';
import { Badge } from '#components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#components/ui/card';
import { ChangeList } from './change-list.js';
import { fieldChanges } from './field-changes.js';
import { PeopleErrorNotice, PeopleLoading } from './controls.js';
import { usePeopleCareer } from './hooks.js';
import {
  textValue,
  type AuditRow,
  type Career,
  type Options,
  type Row,
} from './model.js';

type Translate = ReturnType<typeof useTranslation>['t'];

const dateText = (value: unknown) => textValue(value);

function activeOn(row: Row, date: string): boolean {
  const start = dateText(row.data.startDate),
    end = dateText(row.data.endDate);
  return Boolean(start) && start <= date && (!end || end > date);
}
function covers(row: Row, date: string): boolean {
  const start = dateText(row.data.startDate),
    end = dateText(row.data.endDate);
  return Boolean(start) && start <= date && (!end || end >= date);
}
function referenceName(
  options: Options | undefined,
  source: string,
  id: unknown,
): string {
  const key = textValue(id);
  if (!key) return '';
  return options?.[source]?.rows.find((row) => row.id === key)?.name ?? '';
}
function assignmentSubject(assignment: Row | undefined, options?: Options) {
  if (!assignment) return '';
  return (
    textValue(assignment.snapshot?.subjectName) ||
    referenceName(options, 'orgSubjects', assignment.subjectId)
  );
}
function assignmentPosition(assignment: Row | undefined, options?: Options) {
  if (!assignment) return '';
  return (
    textValue(assignment.snapshot?.positionName) ||
    referenceName(options, 'orgPositions', assignment.positionId)
  );
}
function assignmentLabel(assignment: Row | undefined, options?: Options) {
  return [
    assignmentSubject(assignment, options),
    assignmentPosition(assignment, options),
  ]
    .filter(Boolean)
    .join(' · ');
}
function targetLabel(change: Row, options?: Options) {
  return [
    referenceName(options, 'orgSubjects', change.data.targetSubjectId),
    referenceName(options, 'orgPositions', change.data.targetPositionId),
  ]
    .filter(Boolean)
    .join(' · ');
}
function assignmentOf(change: Row, assignments: Row[]): Row | undefined {
  return assignments.find(
    (assignment) => textValue(assignment.snapshot?.changeId) === change.id,
  );
}
function previousPrimary(change: Row, assignments: Row[]): Row | undefined {
  const effective = dateText(change.data.effectiveDate),
    own = assignmentOf(change, assignments),
    bound = textValue(own?.createdAt ?? change.updatedAt);
  return assignments
    .filter((assignment) => assignment.id !== own?.id)
    .filter((assignment) => dateText(assignment.data.type) === 'primary')
    .filter((assignment) => covers(assignment, effective))
    .filter((assignment) => textValue(assignment.createdAt) < bound)
    .sort((left, right) =>
      textValue(right.createdAt).localeCompare(textValue(left.createdAt)),
    )[0];
}
function endedPartTime(change: Row, assignments: Row[]): Row | undefined {
  const id = dateText(change.data.assignmentId),
    effective = dateText(change.data.effectiveDate);
  return (
    assignments.find((assignment) => assignment.id === id) ??
    assignments
      .filter(
        (assignment) =>
          dateText(assignment.data.type) === 'partTime' &&
          covers(assignment, effective),
      )
      .sort((left, right) =>
        textValue(right.createdAt).localeCompare(textValue(left.createdAt)),
      )[0]
  );
}
function tenure(start: string, end: string, t: Translate): string {
  if (!start || !end) return '—';
  const from = new Date(`${start}T00:00:00Z`),
    to = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return '—';
  const days = Math.floor((to.getTime() - from.getTime()) / 86400000);
  if (days < 0) return '—';
  let months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    to.getUTCMonth() -
    from.getUTCMonth();
  if (to.getUTCDate() < from.getUTCDate()) months--;
  if (months < 1) return t('people.career.tenureDays', { days });
  if (months < 12) return t('people.career.tenureMonthCount', { months });
  const years = Math.floor(months / 12),
    rest = months % 12;
  return rest
    ? t('people.career.tenureMonths', { years, months: rest })
    : t('people.career.tenureYears', { years });
}
function dateLabel(at: string, locale: string): string {
  const date = new Date(at.length === 10 ? `${at}T00:00:00` : at);
  if (Number.isNaN(date.getTime())) return at;
  return date.toLocaleDateString(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}
function timeLabel(at: string, locale: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
  });
}
function clock(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '00:00:00'
    : date.toISOString().slice(11, 23);
}
function SummaryItem({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div className='flex flex-col gap-1'>
      <p className='text-xs text-muted-foreground'>{label}</p>
      <div className='text-sm font-medium break-words'>{children}</div>
    </div>
  );
}

function changeTitle(change: Row, t: Translate): string {
  const type = dateText(change.data.type);
  return t(`people.career.change.${type}`, {
    defaultValue: t(`people.values.${type}`, { defaultValue: type }),
  });
}
function auditTitle(audit: AuditRow, t: Translate): string {
  if (audit.kind === 'employees' || audit.kind === 'profiles')
    return t('people.audit.updated');
  return t(`people.transitions.${audit.operation}`, {
    defaultValue: audit.operation,
  });
}

function CareerSummary({
  career,
  options,
}: {
  readonly career: Career;
  readonly options?: Options;
}): ReactElement {
  const { t, i18n } = useTranslation();
  const { person, asOf } = career;
  const employments = [...career.employments.rows].sort((a, b) =>
    dateText(b.data.startDate).localeCompare(dateText(a.data.startDate)),
  );
  const assignments = career.assignments.rows;
  const employment = employments[0];
  const primary = assignments
    .filter(
      (assignment) =>
        dateText(assignment.data.type) === 'primary' &&
        activeOn(assignment, asOf),
    )
    .sort((a, b) =>
      dateText(b.data.startDate).localeCompare(dateText(a.data.startDate)),
    )[0];
  const company =
    assignmentSubject(primary, options) ||
    referenceName(options, 'orgSubjects', person.subjectId) ||
    '—';
  const position = assignmentPosition(primary, options);
  const joined = employment ? dateText(employment.data.startDate) : '';
  const ended = employment ? dateText(employment.data.endDate) : '';
  const end = person.status === 'active' ? asOf : ended || asOf;
  const employmentType = employment ? dateText(employment.data.type) : '';
  return (
    <div className='grid gap-4 rounded-lg border bg-muted/30 p-4 sm:grid-cols-3'>
      <SummaryItem label={t('people.career.company')}>{company}</SummaryItem>
      <SummaryItem label={t('people.career.currentPosition')}>
        {position || (
          <span className='font-normal text-muted-foreground'>
            {t('people.career.noCurrentAssignment')}
          </span>
        )}
      </SummaryItem>
      <SummaryItem label={t('people.fields.status')}>
        <StatusBadge>{t(`people.states.${person.status}`)}</StatusBadge>
      </SummaryItem>
      <SummaryItem label={t('people.career.joined')}>
        {joined ? dateLabel(joined, i18n.language) : '—'}
      </SummaryItem>
      <SummaryItem label={t('people.career.tenure')}>
        {tenure(joined, end, t)}
      </SummaryItem>
      <SummaryItem label={t('people.fields.employmentType')}>
        {employmentType
          ? t(`people.values.${employmentType}`, {
              defaultValue: employmentType,
            })
          : '—'}
      </SummaryItem>
    </div>
  );
}

type TimelineEvent =
  | { key: string; at: string; sortAt: string; type: 'change'; change: Row }
  | { key: string; at: string; sortAt: string; type: 'audit'; audit: AuditRow }
  | { key: string; at: string; sortAt: string; type: 'present' };

function ChangeBody({
  change,
  assignments,
  audits,
  options,
}: {
  readonly change: Row;
  readonly assignments: Row[];
  readonly audits: AuditRow[];
  readonly options?: Options;
}): ReactElement {
  const { t, i18n } = useTranslation();
  const type = dateText(change.data.type);
  const own = assignmentOf(change, assignments);
  const target = assignmentLabel(own, options) || targetLabel(change, options);
  const approval = audits
    .filter(
      (audit) =>
        audit.kind === 'changes' &&
        audit.recordId === change.id &&
        audit.operation === 'approve',
    )
    .at(-1);
  let from = '',
    to = target;
  if (type === 'transfer')
    from = assignmentLabel(previousPrimary(change, assignments), options);
  if (type === 'endPartTime') {
    from = assignmentLabel(endedPartTime(change, assignments), options);
    to = t('people.career.change.endPartTime');
  }
  if (type === 'exit') {
    from = assignmentLabel(previousPrimary(change, assignments), options);
    to = t('people.career.change.exit');
  }
  const probationEnd =
    type === 'regularize' ? dateText(change.data.probationEnd) : '';
  return (
    <div className='flex flex-col gap-1.5'>
      <p className='text-sm font-medium'>{changeTitle(change, t)}</p>
      {from || to ? (
        <div className='flex flex-wrap items-center gap-1.5 text-sm'>
          {from ? (
            <>
              <span className='text-muted-foreground'>{from}</span>
              <ArrowRight className='size-3.5 shrink-0 text-muted-foreground' />
            </>
          ) : null}
          {to ? <span className='font-medium'>{to}</span> : null}
        </div>
      ) : null}
      {probationEnd ? (
        <p className='text-xs text-muted-foreground'>
          {t('people.fields.probationEnd')} ·{' '}
          {dateLabel(probationEnd, i18n.language)}
        </p>
      ) : null}
      {dateText(change.data.explanation) ? (
        <LongText lines={3} className='text-sm text-muted-foreground'>
          {dateText(change.data.explanation)}
        </LongText>
      ) : null}
      {approval ? (
        <p className='text-xs text-muted-foreground'>
          {t('people.career.approvedBy', { name: approval.actorName })}
        </p>
      ) : null}
    </div>
  );
}

function AuditBody({
  audit,
  options,
}: {
  readonly audit: AuditRow;
  readonly options?: Options;
}): ReactElement {
  const { t } = useTranslation();
  const reason = dateText(audit.reason).trim();
  const showReason =
    reason && !['create', 'save', 'update'].includes(reason.toLowerCase());
  return (
    <div className='flex flex-col gap-2'>
      <div className='flex flex-wrap items-center gap-2'>
        <p className='text-sm font-medium'>{auditTitle(audit, t)}</p>
        <Badge variant='outline'>{t(`people.${audit.kind}`)}</Badge>
      </div>
      {audit.kind === 'employees' || audit.kind === 'profiles' ? (
        <ChangeList
          kind={audit.kind}
          before={audit.beforeValue}
          after={audit.afterValue}
          options={options}
        />
      ) : null}
      {showReason ? (
        <LongText lines={2} className='text-sm text-muted-foreground'>
          {reason}
        </LongText>
      ) : null}
      <p className='text-xs text-muted-foreground'>{audit.actorName}</p>
    </div>
  );
}

function TimelineBody({
  career,
  options,
}: {
  readonly career: Career;
  readonly options?: Options;
}): ReactElement {
  const { t, i18n } = useTranslation();
  const person = career.person,
    audits = career.audits?.rows ?? [];
  const events: TimelineEvent[] = [];
  for (const change of career.changes.rows)
    if (dateText(change.status) === 'effective')
      events.push({
        key: `change-${change.id}`,
        at: dateText(change.data.effectiveDate),
        sortAt: `${dateText(change.data.effectiveDate)}T${clock(
          dateText(change.createdAt),
        )}`,
        type: 'change',
        change,
      });
  for (const audit of audits) {
    if (!audit.beforeValue) continue;
    if (audit.kind === 'employees' || audit.kind === 'profiles') {
      if (audit.operation !== 'save') continue;
      if (!fieldChanges(audit.kind, audit.beforeValue, audit.afterValue).length)
        continue;
    } else if (audit.kind === 'evaluations') {
      if (audit.operation !== 'confirm') continue;
    } else if (audit.kind === 'developmentPlans') {
      if (!['activate', 'complete'].includes(audit.operation)) continue;
    } else continue;
    events.push({
      key: `audit-${audit.id}`,
      at: dateText(audit.createdAt),
      sortAt: dateText(audit.createdAt),
      type: 'audit',
      audit,
    });
  }
  events.sort(
    (left, right) =>
      left.sortAt.localeCompare(right.sortAt) ||
      left.key.localeCompare(right.key),
  );
  if (events.length && person.status === 'active')
    events.push({
      key: 'present',
      at: career.asOf,
      sortAt: `${career.asOf}T23:59:59`,
      type: 'present',
    });
  const current = career.assignments.rows
    .filter(
      (assignment) =>
        dateText(assignment.data.type) === 'primary' &&
        activeOn(assignment, career.asOf),
    )
    .sort((a, b) =>
      dateText(b.data.startDate).localeCompare(dateText(a.data.startDate)),
    )[0];
  const currentLabel = assignmentLabel(current, options);
  const truncated =
    career.changes.truncated ||
    career.employments.truncated ||
    career.assignments.truncated ||
    Boolean(career.audits?.truncated);
  return (
    <div className='flex flex-col gap-6'>
      <CareerSummary career={career} options={options} />
      {!events.length ? (
        <div className='flex flex-col items-center gap-1 rounded-lg border border-dashed p-6 text-center'>
          <p className='text-sm font-medium'>{t('people.career.empty')}</p>
          <p className='text-xs text-muted-foreground'>
            {t('people.career.emptyDescription')}
          </p>
        </div>
      ) : (
        <ol className='flex flex-col'>
          {events.map((event, index) => {
            const last = index === events.length - 1;
            return (
              <li
                key={event.key}
                className='grid gap-1 sm:grid-cols-[7rem_1fr] sm:gap-4'
              >
                <div className='text-xs text-muted-foreground sm:pt-0.5 sm:text-right'>
                  <p>{dateLabel(event.at, i18n.language)}</p>
                  {event.type === 'audit' ? (
                    <p className='text-[11px]'>
                      {timeLabel(event.at, i18n.language)}
                    </p>
                  ) : null}
                </div>
                <div
                  className={cn(
                    'relative border-l border-muted-foreground/25 pl-6',
                    last ? 'pb-0' : 'pb-6',
                  )}
                >
                  <span
                    className={cn(
                      'absolute -left-[5px] top-1 size-2.5 rounded-full border-2',
                      event.type === 'audit'
                        ? 'border-muted-foreground bg-card'
                        : 'border-primary bg-primary',
                    )}
                  />
                  {event.type === 'change' ? (
                    <ChangeBody
                      change={event.change}
                      assignments={career.assignments.rows}
                      audits={audits}
                      options={options}
                    />
                  ) : event.type === 'audit' ? (
                    <AuditBody audit={event.audit} options={options} />
                  ) : (
                    <div className='flex flex-col gap-1'>
                      <div className='flex flex-wrap items-center gap-2'>
                        <p className='text-sm font-medium'>
                          {t('people.career.present')}
                        </p>
                        <Badge variant='secondary'>
                          {t('people.career.current')}
                        </Badge>
                      </div>
                      <p className='text-sm text-muted-foreground'>
                        {currentLabel || t('people.career.noCurrentAssignment')}
                      </p>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {truncated ? (
        <p className='text-xs text-muted-foreground'>
          {t('people.career.truncated')}
        </p>
      ) : null}
    </div>
  );
}

export function CareerTimeline({
  personId,
  options,
}: {
  readonly personId: string;
  readonly options?: Options;
}): ReactElement {
  const { t } = useTranslation();
  const query = usePeopleCareer(personId);
  const career = query.data?.data;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('people.career.title')}</CardTitle>
        <CardDescription>{t('people.career.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {query.isError ? (
          <PeopleErrorNotice
            error={query.error}
            retry={() => void query.refetch()}
          />
        ) : !career ? (
          <PeopleLoading />
        ) : (
          <TimelineBody career={career} options={options} />
        )}
      </CardContent>
    </Card>
  );
}
