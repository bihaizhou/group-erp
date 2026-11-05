import { useState } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import { ApiClientError, useApiClient, useToaster } from '@nocobase/app-client';
import { Check, MessageSquare, X } from 'lucide-react';
import { Badge } from '#components/ui/badge';
import { Button } from '#components/ui/button';
import { Checkbox } from '#components/ui/checkbox';
import { Textarea } from '#components/ui/textarea';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#components/ui/card';
import { usePeopleError } from './hooks.js';

export type ChecklistItem = {
  id: string;
  key: string;
  title: string;
  owner: string;
  done: boolean;
  doneBy: string | null;
  doneAt: string | null;
  note: string;
};
export type Checklist = {
  total: number;
  done: number;
  items: ChecklistItem[];
};

/** The on/offboarding work checklist of one personnel change. */
export function ChangeChecklist({
  changeId,
  checklist,
  canEdit,
}: {
  changeId: string;
  checklist: Checklist;
  canEdit: boolean;
}) {
  const { t } = useTranslation(),
    api = useApiClient(),
    toaster = useToaster(),
    errorText = usePeopleError();
  const [items, setItems] = useState<ChecklistItem[]>(checklist.items);
  const [editing, setEditing] = useState<string | null>(null),
    [draft, setDraft] = useState(''),
    [pending, setPending] = useState<string | null>(null);
  const done = items.filter((item) => item.done).length,
    total = items.length,
    percent = total ? Math.round((done / total) * 100) : 0;
  const save = async (
    item: ChecklistItem,
    values: { done?: boolean; note?: string },
  ) => {
    const before = items;
    setPending(item.id);
    if (values.done !== undefined)
      setItems((current) =>
        current.map((entry) =>
          entry.id === item.id ? { ...entry, done: values.done! } : entry,
        ),
      );
    try {
      const response = await api.request<{ data: Checklist }>({
        path: `people/changes/${changeId}/checklist/${item.id}`,
        method: 'POST',
        json: {
          done: values.done ?? item.done,
          ...(values.note !== undefined ? { note: values.note } : {}),
        },
      });
      setItems(response.data.items);
      if (values.note !== undefined) setEditing(null);
    } catch (error) {
      setItems(before);
      toaster.show({
        type: 'error',
        title:
          error instanceof ApiClientError
            ? errorText(error)
            : t('people.requestFailed'),
      });
    } finally {
      setPending(null);
    }
  };
  // Titles and owners come from the configured template, so they are shown
  // verbatim instead of being looked up by key.
  const label = (item: ChecklistItem) => item.title;
  return (
    <Card>
      <CardHeader className='flex flex-row flex-wrap items-start justify-between gap-3'>
        <div className='flex min-w-0 flex-col gap-1.5'>
          <CardTitle>{t('people.checklist.title')}</CardTitle>
          <CardDescription>{t('people.checklist.description')}</CardDescription>
        </div>
        <Badge variant={done === total && total > 0 ? 'default' : 'secondary'}>
          {t('people.checklist.progress', { done, total })}
        </Badge>
      </CardHeader>
      <CardContent className='flex flex-col gap-4'>
        <div
          className='h-1.5 overflow-hidden rounded-full bg-muted'
          role='progressbar'
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <div
            className='h-full rounded-full bg-primary transition-all'
            style={{ width: `${percent}%` }}
          />
        </div>
        <ul className='flex flex-col divide-y divide-border'>
          {items.map((item) => (
            <li
              key={item.id}
              className='flex flex-col gap-2 py-3 first:pt-0 last:pb-0'
            >
              <div className='flex items-start gap-3'>
                <Checkbox
                  id={`checklist-${item.id}`}
                  checked={item.done}
                  disabled={!canEdit || pending === item.id}
                  onCheckedChange={(checked) =>
                    void save(item, { done: checked === true })
                  }
                  className='mt-0.5'
                />
                <div className='flex min-w-0 flex-1 flex-col gap-1'>
                  <label
                    htmlFor={`checklist-${item.id}`}
                    className={
                      item.done
                        ? 'text-sm text-muted-foreground line-through'
                        : 'text-sm font-medium'
                    }
                  >
                    {label(item)}
                  </label>
                  <div className='flex flex-wrap items-center gap-2 text-xs text-muted-foreground'>
                    <Badge variant='outline' className='font-normal'>
                      {item.owner || '—'}
                    </Badge>
                    {item.note ? (
                      <span className='min-w-0 break-words'>{item.note}</span>
                    ) : null}
                  </div>
                </div>
                {canEdit ? (
                  <Button
                    variant='ghost'
                    size='icon-sm'
                    aria-label={t('people.checklist.note')}
                    onClick={() => {
                      setEditing(editing === item.id ? null : item.id);
                      setDraft(item.note);
                    }}
                  >
                    {editing === item.id ? <X /> : <MessageSquare />}
                  </Button>
                ) : null}
              </div>
              {editing === item.id ? (
                <div className='ms-7 flex flex-col gap-2'>
                  <Textarea
                    value={draft}
                    maxLength={2000}
                    placeholder={t('people.checklist.notePlaceholder')}
                    onChange={(event) => setDraft(event.target.value)}
                    rows={2}
                  />
                  <div className='flex gap-2'>
                    <Button
                      size='sm'
                      disabled={pending === item.id}
                      onClick={() => void save(item, { note: draft.trim() })}
                    >
                      <Check />
                      {t('people.save')}
                    </Button>
                    <Button
                      size='sm'
                      variant='ghost'
                      onClick={() => setEditing(null)}
                    >
                      {t('people.cancel')}
                    </Button>
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
        <p className='text-xs text-muted-foreground'>
          {t('people.checklist.hint')}
        </p>
      </CardContent>
    </Card>
  );
}
