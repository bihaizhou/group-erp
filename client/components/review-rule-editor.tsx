import { useRef, useState } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import { Button } from '#components/ui/button';
import { FieldError } from '#components/ui/field';
import { PeopleSelect } from '../pages/people/controls.js';
import {
  PagedReferencePicker,
  type PagedReferenceChoice,
} from './paged-reference-picker.js';

export interface ReviewSelection {
  group: number;
  type: 'position' | 'user';
  referenceId: string;
}
export interface ReviewReference {
  type: 'position' | 'user';
  referenceId: string;
  code?: string | null;
  name?: string | null;
  availability?: string;
}
export type ReviewRuleValues = Record<string, unknown> & {
  reviewerSelections: ReviewSelection[];
};
export type ReviewRuleField =
  | { kind: 'reviewers'; key: string; optionsPath: string }
  | {
      kind: 'boolean';
      key: string;
      label: string;
      trueLabel: string;
      falseLabel: string;
    };
interface Props {
  id: string;
  fields: ReviewRuleField[];
  values: { reviewerSelections: ReviewSelection[] };
  references: ReviewReference[];
  subjectId: string;
  canEdit: boolean;
  disabled?: boolean;
  invalid?: boolean;
  error?: string;
  onChange: (patch: Partial<ReviewRuleValues>) => void;
}
const nextGroup = (used: number[]) =>
  Array.from({ length: 100 }, (_, i) => i + 1).find((n) => !used.includes(n));
/** One editor for every lifecycle `reviewers` field and its boolean companions. */
export function ReviewRuleEditor({
  id,
  fields,
  values,
  references,
  subjectId,
  canEdit,
  disabled,
  invalid,
  error,
  onChange,
}: Props) {
  const { t } = useTranslation(),
    [local, setLocal] = useState<Record<string, PagedReferenceChoice>>({}),
    conditionButtonRef = useRef<Record<number, HTMLButtonElement | null>>({}),
    addGroupRef = useRef<HTMLButtonElement>(null),
    selections = values.reviewerSelections,
    groups = [...new Set(selections.map((s) => s.group))].sort((a, b) => a - b),
    locked = disabled || !canEdit,
    update = (next: ReviewSelection[]) =>
      onChange({ reviewerSelections: next }),
    known = (selection: ReviewSelection) => {
      const reference = references.find(
        (r) =>
          r.type === selection.type && r.referenceId === selection.referenceId,
      );
      if (!reference) return undefined;
      return {
        id: reference.referenceId,
        code: reference.code ?? '',
        name: reference.name ?? t('reviewRules.unavailable'),
        availability: reference.availability,
      };
    };
  return (
    <fieldset
      id={id}
      tabIndex={-1}
      aria-invalid={invalid || Boolean(error)}
      aria-describedby={error ? `${id}-error` : undefined}
      disabled={locked}
      className='flex flex-col gap-4 focus-visible:ring-2 focus-visible:ring-ring'
    >
      {fields.map((field) =>
        field.kind === 'boolean' ? (
          <PeopleSelect
            key={field.key}
            label={field.label}
            value={String(
              (values as unknown as Record<string, unknown>)[field.key],
            )}
            items={[
              { value: 'true', label: field.trueLabel },
              { value: 'false', label: field.falseLabel },
            ]}
            onChange={(value) => onChange({ [field.key]: value === 'true' })}
          />
        ) : (
          <div key={field.key} className='flex flex-col gap-4'>
            {groups.length === 0 && (
              <p className='text-sm text-muted-foreground'>
                {t('reviewRules.unconfigured')}
              </p>
            )}
            {groups.map((group) => (
              <div
                key={group}
                className='flex flex-col gap-4 rounded-lg border p-4'
              >
                <p className='text-sm font-medium'>
                  {t('reviewRules.candidateGroup', { number: group })} ·{' '}
                  {t('reviewRules.allConditions')}
                </p>
                {selections.map((selection, index) =>
                  selection.group === group ? (
                    <div
                      key={`${group}-${selection.type}-${selection.referenceId}`}
                      className='grid gap-3'
                    >
                      <PeopleSelect
                        label={t('reviewRules.ruleType')}
                        value={selection.type}
                        items={[
                          {
                            value: 'position',
                            label: t('reviewRules.position'),
                          },
                          { value: 'user', label: t('reviewRules.account') },
                        ]}
                        onChange={(type) =>
                          update(
                            selections.map((row, i) =>
                              i === index
                                ? {
                                    ...row,
                                    type: type as 'position' | 'user',
                                    referenceId: '',
                                  }
                                : row,
                            ),
                          )
                        }
                      />
                      <PagedReferencePicker<PagedReferenceChoice>
                        queryPath={field.optionsPath}
                        queryKeyPrefix='reviewRules'
                        cachePath={field.optionsPath}
                        uiNamespace='companyScope'
                        label={t(
                          selection.type === 'position'
                            ? 'reviewRules.position'
                            : 'reviewRules.account',
                        )}
                        query={{
                          subjectId,
                          kind:
                            selection.type === 'position'
                              ? 'positions'
                              : 'reviewers',
                        }}
                        value={selection.referenceId}
                        selected={
                          known(selection) ?? local[selection.referenceId]
                        }
                        disabled={locked}
                        renderLoading={() => (
                          <p className='text-sm text-muted-foreground'>
                            {t('reviewRules.loading')}
                          </p>
                        )}
                        renderError={(loadError, retry) => (
                          <div className='flex items-center gap-2 text-sm'>
                            <span className='text-destructive'>
                              {loadError instanceof Error
                                ? loadError.message
                                : String(loadError)}
                            </span>
                            <Button
                              type='button'
                              size='sm'
                              variant='outline'
                              onClick={retry}
                            >
                              {t('reviewRules.retry')}
                            </Button>
                          </div>
                        )}
                        renderPagination={({
                          page,
                          total,
                          pageSize,
                          onPage,
                          busy,
                        }) =>
                          total > pageSize ? (
                            <div className='flex items-center gap-2'>
                              <Button
                                type='button'
                                size='sm'
                                variant='outline'
                                disabled={busy || page <= 1}
                                onClick={() => onPage(page - 1)}
                              >
                                {t('reviewRules.previous')}
                              </Button>
                              <span className='text-sm'>{page}</span>
                              <Button
                                type='button'
                                size='sm'
                                variant='outline'
                                disabled={busy || page * pageSize >= total}
                                onClick={() => onPage(page + 1)}
                              >
                                {t('reviewRules.next')}
                              </Button>
                            </div>
                          ) : null
                        }
                        onChange={(referenceId, item) => {
                          if (item)
                            setLocal((old) => ({
                              ...old,
                              [referenceId]: item,
                            }));
                          update(
                            selections.map((row, i) =>
                              i === index ? { ...row, referenceId } : row,
                            ),
                          );
                        }}
                      />
                      {canEdit && (
                        <Button
                          type='button'
                          variant='outline'
                          size='sm'
                          onClick={() => {
                            update(selections.filter((_, i) => i !== index));
                            setTimeout(
                              () => conditionButtonRef.current[group]?.focus(),
                              0,
                            );
                          }}
                        >
                          {t('reviewRules.removeCondition')}
                        </Button>
                      )}
                    </div>
                  ) : null,
                )}
                {canEdit && (
                  <div className='flex flex-wrap gap-2'>
                    <Button
                      type='button'
                      variant='outline'
                      disabled={selections.length >= 100}
                      ref={(node) => {
                        conditionButtonRef.current[group] = node;
                      }}
                      onClick={() =>
                        update([
                          ...selections,
                          { group, type: 'position', referenceId: '' },
                        ])
                      }
                    >
                      {t('reviewRules.addCondition')}
                    </Button>
                    <Button
                      type='button'
                      variant='outline'
                      onClick={() => {
                        update(selections.filter((s) => s.group !== group));
                        setTimeout(() => addGroupRef.current?.focus(), 0);
                      }}
                    >
                      {t('reviewRules.removeGroup')}
                    </Button>
                  </div>
                )}
              </div>
            ))}
            {canEdit && (
              <Button
                type='button'
                variant='outline'
                disabled={selections.length >= 100}
                ref={addGroupRef}
                title={t('reviewRules.newGroupLimit')}
                onClick={() => {
                  const group = nextGroup(groups);
                  if (group)
                    update([
                      ...selections,
                      { group, type: 'position', referenceId: '' },
                    ]);
                }}
              >
                {t('reviewRules.addGroup')}
              </Button>
            )}
            <p className='text-sm text-muted-foreground'>
              {t('reviewRules.anyGroup')}
            </p>
          </div>
        ),
      )}
      {invalid && <FieldError>{t('reviewRules.emptyGroup')}</FieldError>}
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
    </fieldset>
  );
}
