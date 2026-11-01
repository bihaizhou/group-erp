import { useRef, useState, useEffect } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from '#components/ui/alert-dialog';
import { Button } from '#components/ui/button';

export function useDiscardConfirm() {
  const { t } = useTranslation(),
    [open, setOpen] = useState(false),
    resolveRef = useRef<((value: boolean) => void) | null>(null);
  useEffect(
    () => () => {
      resolveRef.current?.(false);
    },
    [],
  );
  const finish = (value: boolean) => {
    setOpen(false);
    resolveRef.current?.(value);
    resolveRef.current = null;
  };
  const confirm = () =>
    new Promise<boolean>((done) => {
      resolveRef.current = done;
      setOpen(true);
    });
  const dialog = (
    <AlertDialog
      open={open}
      onOpenChange={(value) => {
        if (!value) finish(false);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('people.discardTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('people.unsaved')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant='outline' onClick={() => finish(false)}>
            {t('people.keepEditing')}
          </Button>
          <Button variant='destructive' onClick={() => finish(true)}>
            {t('people.discard')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  return { confirm, dialog };
}
