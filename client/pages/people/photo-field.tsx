import { textValue } from './model.js';
import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { useService } from '@nocobase/app-client';
import { clientFileRepositoryManagerToken } from '@nocobase/app-plugin-file/client';
import { useTranslation } from '@nocobase/i18n/client';
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
} from '#components/ui/field';
import { Button } from '#components/ui/button';
import { usePeopleError } from './hooks.js';

export function PhotoField({
  value,
  onChange,
  disabled,
  onBusy,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
}) {
  const { t } = useTranslation(),
    files = useService(clientFileRepositoryManagerToken),
    message = usePeopleError();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [fileName, setFileName] = useState<string>(),
    inputRef = useRef<HTMLInputElement>(null);
  return (
    <Field>
      <FieldLabel htmlFor='people-photo'>
        {t('people.fields.photoId')}
      </FieldLabel>
      <div className='flex items-center gap-2'>
        <input
          ref={inputRef}
          id='people-photo'
          type='file'
          accept='image/jpeg,image/png,image/webp'
          disabled={disabled || busy}
          className='sr-only'
          onChange={(event) => {
            void (async () => {
              const file = event.target.files?.[0];
              if (!file) return;
              setFileName(file.name);
              setError(undefined);
              if (
                file.size > 5 * 1024 * 1024 ||
                !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)
              ) {
                setError(new Error('invalid'));
                return;
              }
              setBusy(true);
              onBusy(true);
              try {
                const result = await files
                  .repository('peoplePhotos')
                  .uploadOne({ file });
                onChange(textValue(result.record.id));
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
                onBusy(false);
              }
            })();
          }}
        />
        <Button
          type='button'
          variant='outline'
          disabled={disabled || busy}
          onClick={() => inputRef.current?.click()}
        >
          <Upload className='size-4' />
          {t('people.choosePhoto')}
        </Button>
        <span className='truncate text-sm text-muted-foreground'>
          {fileName ||
            (value ? t('people.photoAttached') : t('people.noFileChosen'))}
        </span>
      </div>
      <FieldDescription>
        {t(busy ? 'people.uploading' : 'people.photoHint')}
      </FieldDescription>
      {value ? (
        <div className='flex items-center gap-2'>
          <span className='text-sm text-muted-foreground'>
            {t('people.photoAttached')}
          </span>
          <Button
            type='button'
            variant='outline'
            size='sm'
            disabled={disabled || busy}
            onClick={() => onChange(null)}
          >
            {t('people.removeItem')}
          </Button>
        </div>
      ) : null}
      {error ? <FieldError>{message(error)}</FieldError> : null}
    </Field>
  );
}
