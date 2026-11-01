import { useRef, useState, type ReactNode } from 'react';
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
import { Spinner } from '#components/ui/spinner';

/** Business actions choose their own emphasis; discard confirmation stays separate. */
export function ActionConfirmation({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive = false,
  disabled = false,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  disabled?: boolean;
  onConfirm: () => Promise<boolean>;
  children?: ReactNode;
}) {
  const { t } = useTranslation(),
    lockRef = useRef(false),
    [busy, setBusy] = useState(false);
  const confirm = async () => {
    if (lockRef.current || disabled) return;
    lockRef.current = true;
    setBusy(true);
    try {
      if (await onConfirm()) onOpenChange(false);
    } finally {
      lockRef.current = false;
      setBusy(false);
    }
  };
  return (
    <AlertDialog
      open={open}
      onOpenChange={(value) => {
        if (!lockRef.current) onOpenChange(value);
      }}
    >
      <AlertDialogContent aria-busy={busy}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          <Button
            type='button'
            variant='outline'
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            {t('execution.cancel')}
          </Button>
          <Button
            type='button'
            variant={destructive ? 'destructive' : 'default'}
            disabled={busy || disabled}
            onClick={() => void confirm()}
          >
            {busy && <Spinner />}
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
