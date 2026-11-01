import { useTranslation } from '@nocobase/i18n/client';
const systemReasons = new Set([
  'SYSTEM_SOURCE_LINE_REMOVED',
  'SYSTEM_SOURCE_INPUT_CHANGED',
  'SYSTEM_SOURCE_SHARED_FILES_CHANGED',
]);
/** Translate application-generated reason codes; user-entered reasons remain data. */
export function useSourceReason() {
  const { t } = useTranslation();
  return (reason: unknown) => {
    const value = typeof reason === 'string' ? reason : '';
    return systemReasons.has(value)
      ? t(`materialSources.reasons.${value}`)
      : value;
  };
}
