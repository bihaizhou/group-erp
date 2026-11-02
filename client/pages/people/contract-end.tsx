import { useState } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import { useApiClient, useToaster } from '@nocobase/app-client';
import { CalendarClock } from 'lucide-react';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { Label } from '#components/ui/label';
import { Textarea } from '#components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#components/ui/dialog';
import { usePeopleError } from './hooks.js';
import { textValue, type Row } from './model.js';

/**
 * Contract dates are data, not a workflow step: the employment row itself stays
 * immutable, so HR records the date through this audited endpoint.
 */
export function ContractEndAction({
  row,
  onSaved,
}: {
  row: Row;
  onSaved: () => void;
}) {
  const { t } = useTranslation(),
    api = useApiClient(),
    toaster = useToaster(),
    errorText = usePeopleError();
  const [open, setOpen] = useState(false),
    [value, setValue] = useState(''),
    [reason, setReason] = useState(''),
    [pending, setPending] = useState(false),
    [error, setError] = useState<unknown>();
  const start = () => {
    setValue(textValue(row.data.contractEnd));
    setReason('');
    setError(undefined);
    setOpen(true);
  };
  const save = async () => {
    setPending(true);
    setError(undefined);
    try {
      await api.request({
        path: `people/employments/${row.id}/contract-end`,
        method: 'POST',
        json: {
          contractEnd: value || null,
          reason,
          version: row.version,
        },
      });
      toaster.show({ type: 'success', title: t('people.contractEndSaved') });
      setOpen(false);
      onSaved();
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  };
  return (
    <>
      <Button variant='outline' onClick={start}>
        <CalendarClock />
        {t('people.contractEndAction')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>{t('people.contractEndTitle')}</DialogTitle>
            <DialogDescription>
              {t('people.contractEndDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className='flex flex-col gap-4'>
            <div className='flex flex-col gap-2'>
              <Label htmlFor='contract-end-date'>
                {t('people.fields.contractEnd')}
              </Label>
              <Input
                id='contract-end-date'
                type='date'
                value={value}
                min={textValue(row.data.startDate) || undefined}
                onChange={(event) => setValue(event.target.value)}
              />
            </div>
            <div className='flex flex-col gap-2'>
              <Label htmlFor='contract-end-reason'>
                {t('people.fields.reason')}
              </Label>
              <Textarea
                id='contract-end-reason'
                value={reason}
                maxLength={1000}
                rows={3}
                placeholder={t('people.contractEndReasonPlaceholder')}
                onChange={(event) => setReason(event.target.value)}
              />
            </div>
            <p className='text-xs text-muted-foreground'>
              {t('people.contractEndHint')}
            </p>
            {error ? (
              <p className='text-sm text-destructive' role='alert'>
                {errorText(error)}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setOpen(false)}>
              {t('people.cancel')}
            </Button>
            <Button
              disabled={pending || !reason.trim()}
              onClick={() => void save()}
            >
              {pending ? t('people.saving') : t('people.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
