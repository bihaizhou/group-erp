import {
  PagedReferencePicker,
  type PagedReferencePickerProps,
} from '#components/paged-reference-picker';
interface Choice {
  id: string;
  code: string;
  name: string;
  availability?: string;
}
export interface DemandReferencePickerProps extends Omit<
  PagedReferencePickerProps<Choice>,
  'queryPath' | 'queryKeyPrefix' | 'cachePath'
> {
  domain: 'procurement' | 'requisitions';
  path: string;
}
/** Preserve the established two-domain contract and cache keys. */
export function DemandReferencePicker({
  domain,
  path,
  ...props
}: DemandReferencePickerProps) {
  return (
    <PagedReferencePicker<Choice>
      {...props}
      queryPath={`${domain}/${path}`}
      queryKeyPrefix={domain === 'procurement' ? 'purchase' : 'issue'}
      cachePath={path}
    />
  );
}
