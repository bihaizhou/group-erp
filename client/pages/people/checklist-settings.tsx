import { useTranslation } from '@nocobase/i18n/client';
import { createUuid } from '@nocobase/app-client';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Input } from '#components/ui/input';
import { Label } from '#components/ui/label';
import { Checkbox } from '#components/ui/checkbox';
import { Button } from '#components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#components/ui/tooltip';
import { cn } from 'cn';

export type ChecklistItemConfig = {
  key: string;
  title: string;
  owner: string;
  assets?: boolean;
};

/** Edits the onboarding/offboarding work items of one change type. */
export function ChecklistSettings({
  value,
  onChange,
  invalidKey,
}: {
  value: ChecklistItemConfig[];
  onChange: (items: ChecklistItemConfig[]) => void;
  invalidKey?: string | null;
}) {
  const { t } = useTranslation();
  const update = (index: number, patch: Partial<ChecklistItemConfig>) =>
    onChange(
      value.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  const move = (index: number, delta: number) => {
    const next = [...value],
      target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  const add = () =>
    onChange([
      ...value,
      {
        key: `item-${createUuid()}`,
        title: t('people.checklist.newItem'),
        owner: '',
        assets: false,
      },
    ]);
  return (
    <div className='flex flex-col gap-3'>
      {!value.length ? (
        <p className='rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground'>
          {t('people.checklist.empty')}
        </p>
      ) : null}
      {value.map((item, index) => (
        <div
          key={item.key}
          className={cn(
            'rounded-lg border bg-card',
            invalidKey === item.key ? 'border-destructive' : 'border-border',
          )}
        >
          <div className='flex flex-wrap items-center gap-2 border-b border-border px-3 py-2'>
            <span className='flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium tabular-nums'>
              {index + 1}
            </span>
            <Input
              aria-label={t('people.checklist.itemTitle')}
              value={item.title}
              maxLength={100}
              onChange={(event) => update(index, { title: event.target.value })}
              className='h-8 min-w-0 flex-1 border-transparent bg-transparent px-1 font-medium shadow-none focus-visible:border-input'
            />
            <div className='flex items-center gap-1'>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant='ghost'
                      size='icon-sm'
                      disabled={index === 0}
                      aria-label={t('people.approvalMoveUp')}
                      onClick={() => move(index, -1)}
                    />
                  }
                >
                  <ArrowUp />
                </TooltipTrigger>
                <TooltipContent>{t('people.approvalMoveUp')}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant='ghost'
                      size='icon-sm'
                      disabled={index === value.length - 1}
                      aria-label={t('people.approvalMoveDown')}
                      onClick={() => move(index, 1)}
                    />
                  }
                >
                  <ArrowDown />
                </TooltipTrigger>
                <TooltipContent>{t('people.approvalMoveDown')}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant='ghost'
                      size='icon-sm'
                      aria-label={t('people.checklist.removeItem')}
                      onClick={() =>
                        onChange(value.filter((_, i) => i !== index))
                      }
                    />
                  }
                >
                  <Trash2 />
                </TooltipTrigger>
                <TooltipContent>
                  {t('people.checklist.removeItem')}
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
          <div className='flex flex-col gap-3 p-3 sm:flex-row sm:items-center'>
            <div className='sm:w-40'>
              <Label className='mb-2 block'>
                {t('people.checklist.owner')}
              </Label>
              <Input
                aria-label={t('people.checklist.owner')}
                value={item.owner}
                maxLength={30}
                placeholder={t('people.checklist.ownerPlaceholder')}
                onChange={(event) =>
                  update(index, { owner: event.target.value })
                }
              />
            </div>
            <label className='flex items-center gap-2 text-sm text-muted-foreground'>
              <Checkbox
                checked={item.assets === true}
                onCheckedChange={(checked) =>
                  update(index, { assets: checked === true })
                }
              />
              {t('people.checklist.assets')}
            </label>
          </div>
          {item.assets ? (
            <p className='px-3 pb-3 text-xs text-muted-foreground'>
              {t('people.checklist.assetsHint')}
            </p>
          ) : null}
          {invalidKey === item.key ? (
            <p className='px-3 pb-3 text-sm text-destructive' role='alert'>
              {t('people.checklist.itemTitleRequired')}
            </p>
          ) : null}
        </div>
      ))}
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <p className='text-xs text-muted-foreground'>
          {t('people.checklist.limit', { max: 20 })}
        </p>
        <Button
          variant='outline'
          size='sm'
          disabled={value.length >= 20}
          onClick={add}
        >
          <Plus />
          {t('people.checklist.addItem')}
        </Button>
      </div>
    </div>
  );
}
