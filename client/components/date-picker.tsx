import { useState, useSyncExternalStore } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import { CalendarIcon } from 'lucide-react';
import { enUS, zhCN } from 'react-day-picker/locale';
import { addDays, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { Button } from './ui/button.js';
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover.js';
import { Calendar } from './ui/calendar.js';
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parse = (value: string | undefined) =>
  value && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00`)
    : undefined;
export function DatePicker({
  value,
  onChange,
  label,
  id,
  disabled,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  id?: string;
  disabled?: boolean;
  placeholder?: string;
}) {
  const { t, i18n } = useTranslation(),
    [open, setOpen] = useState(false),
    date = parse(value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            id={id}
            type='button'
            variant='outline'
            className='w-full justify-start'
            disabled={disabled}
            aria-label={label}
          />
        }
      >
        <CalendarIcon />
        {date
          ? date.toLocaleDateString(i18n.language)
          : (placeholder ?? t('procurement.requestUi.chooseDate'))}
      </PopoverTrigger>
      <PopoverContent className='w-auto p-0'>
        <Calendar
          mode='single'
          selected={date}
          locale={i18n.language.startsWith('zh') ? zhCN : enUS}
          onSelect={(next) => {
            onChange(next ? iso(next) : '');
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
const subscribe = (notify: () => void) => {
  const q = window.matchMedia('(min-width: 640px)');
  q.addEventListener('change', notify);
  return () => q.removeEventListener('change', notify);
};
export function DateRangePicker({
  from,
  to,
  onChange,
  businessDate,
}: {
  from?: string;
  to?: string;
  onChange: (from: string, to: string) => void;
  businessDate?: string;
}) {
  const { t, i18n } = useTranslation(),
    [open, setOpen] = useState(false),
    wide = useSyncExternalStore(
      subscribe,
      () => window.matchMedia('(min-width: 640px)').matches,
      () => false,
    );
  const today = parse(businessDate),
    start = parse(from),
    end = parse(to),
    key = (s: string) => t(`procurement.requestUi.${s}`);
  const presets = today
    ? ([
        ['last7', addDays(today, -6), today],
        ['last30', addDays(today, -29), today],
        ['thisMonth', startOfMonth(today), endOfMonth(today)],
        [
          'lastMonth',
          startOfMonth(subMonths(today, 1)),
          endOfMonth(subMonths(today, 1)),
        ],
        ['last90', addDays(today, -89), today],
      ] as const)
    : [];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type='button'
            variant='outline'
            aria-label={key('dateRange')}
          />
        }
      >
        <CalendarIcon />
        {start || end
          ? `${start?.toLocaleDateString(i18n.language) ?? '—'} – ${end?.toLocaleDateString(i18n.language) ?? '—'}`
          : key('dateRange')}
      </PopoverTrigger>
      <PopoverContent className='w-auto max-w-(--available-width) p-3'>
        <div className='flex flex-wrap gap-2'>
          {presets.map(([name, a, b]) => (
            <Button
              key={name}
              size='sm'
              variant='outline'
              onClick={() => {
                onChange(iso(a), iso(b));
                setOpen(false);
              }}
            >
              {key(name)}
            </Button>
          ))}
        </div>
        <Calendar
          mode='range'
          selected={{ from: start, to: end }}
          numberOfMonths={wide ? 2 : 1}
          locale={i18n.language.startsWith('zh') ? zhCN : enUS}
          onSelect={(range) =>
            onChange(
              range?.from ? iso(range.from) : '',
              range?.to ? iso(range.to) : '',
            )
          }
        />
        <Button size='sm' variant='outline' onClick={() => onChange('', '')}>
          {key('clearDateRange')}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
