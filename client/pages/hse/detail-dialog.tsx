import { useTranslation } from '@nocobase/i18n/client';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#components/ui/dialog';
import type { HseHazard, HseIncident } from './model.js';

type Props = {
  kind: 'incident' | 'hazard';
  row: HseIncident | HseHazard | null;
  onClose: () => void;
};

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className='text-muted-foreground'>{label}</span>
      <p className='whitespace-pre-wrap'>{value || '—'}</p>
    </div>
  );
}

export function HseDetailDialog({ kind, row, onClose }: Props) {
  const { t } = useTranslation();
  if (!row) return null;
  const incident = kind === 'incident' ? (row as HseIncident) : null;
  const hazard = kind === 'hazard' ? (row as HseHazard) : null;
  const title =
    kind === 'incident'
      ? `${t('hse.detailTitleIncident')} · ${incident?.incidentNo ?? ''}`
      : t('hse.detailTitleHazard');
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className='max-h-[85vh] overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {row.subjectName} · {t(`hse.status.${row.status}`)}
          </DialogDescription>
        </DialogHeader>
        <div className='grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2'>
          {incident ? (
            <>
              <Field label={t('hse.fields.type')} value={incident.type} />
              <Field
                label={t('hse.fields.severity')}
                value={incident.severity}
              />
              <Field
                label={t('hse.fields.occurredAt')}
                value={incident.occurredAt.slice(0, 10)}
              />
              <Field
                label={t('hse.fields.location')}
                value={incident.location}
              />
              <Field
                label={t('hse.fields.injuryCount')}
                value={String(incident.injuryCount)}
              />
              <Field
                label={t('hse.fields.lostDays')}
                value={String(incident.lostDays)}
              />
              <Field
                label={t('hse.fields.environmentalRelease')}
                value={
                  incident.environmentalRelease
                    ? t('hse.yes')
                    : t('hse.no')
                }
              />
              <Field label={t('hse.fields.owner')} value={incident.ownerName} />
              {incident.dueAt ? (
                <Field
                  label={t('hse.fields.dueAt')}
                  value={incident.dueAt.slice(0, 10)}
                />
              ) : null}
            </>
          ) : null}
          {hazard ? (
            <>
              <Field
                label={t('hse.fields.source')}
                value={t(`hse.hazardSource.${hazard.source}`)}
              />
              <Field label={t('hse.fields.level')} value={hazard.level} />
              <Field
                label={t('hse.fields.discoveredAt')}
                value={hazard.discoveredAt.slice(0, 10)}
              />
              {hazard.sourceRef ? (
                <Field
                  label={t('hse.fields.sourceRef')}
                  value={hazard.sourceRef}
                />
              ) : null}
              <Field
                label={t('hse.fields.location')}
                value={hazard.location}
              />
              <Field label={t('hse.fields.owner')} value={hazard.ownerName} />
              {hazard.dueAt ? (
                <Field
                  label={t('hse.fields.dueAt')}
                  value={hazard.dueAt.slice(0, 10)}
                />
              ) : null}
            </>
          ) : null}
        </div>
        <div className='mt-2'>
          <Field
            label={t('hse.fields.description')}
            value={incident?.description ?? hazard?.description ?? ''}
          />
        </div>
        {incident?.rootCause ? (
          <Field
            label={t('hse.fields.rootCause')}
            value={incident.rootCause}
          />
        ) : null}
        {incident?.actions ? (
          <Field label={t('hse.fields.correctiveActions')} value={incident.actions} />
        ) : null}
        {hazard?.rectification ? (
          <Field
            label={t('hse.fields.rectification')}
            value={hazard.rectification}
          />
        ) : null}
        <div>
          <h3 className='mb-2 text-sm font-medium'>{t('hse.history')}</h3>
          {row.history.length ? (
            <ol className='grid gap-2 text-xs'>
              {row.history.map((entry) => (
                <li
                  key={`${entry.at}-${entry.action}-${entry.to ?? ''}`}
                  className='rounded-md border p-2'
                >
                  <span className='font-medium'>
                    {t(`hse.action.${entry.action}`)}
                  </span>
                  {entry.from && entry.to ? (
                    <span className='ml-2 text-muted-foreground'>
                      {entry.from} → {entry.to}
                    </span>
                  ) : null}
                  <span className='ml-2 text-muted-foreground'>
                    {new Date(entry.at).toLocaleString()}
                  </span>
                  {entry.note ? (
                    <p className='mt-1 text-muted-foreground'>{entry.note}</p>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : (
            <p className='text-sm text-muted-foreground'>
              {t('hse.noHistory')}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
