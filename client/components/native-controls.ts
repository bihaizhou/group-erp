/**
 * Class strings for the few native controls the app draws itself. They mirror the shadcn
 * `Input`/`SelectTrigger` geometry (`client/components/ui/input.tsx`, `select.tsx`) so a native
 * `<select>` can sit in the same row as those primitives without a height or radius mismatch.
 */

/** Native `<select>`: same height, radius, border and focus ring as `Input` and `SelectTrigger`. */
export const nativeSelectClass =
  'h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30';

/** A read-only value that stands where a control would: same box, muted background. */
export const readOnlyValueClass =
  'flex h-8 w-full min-w-0 items-center truncate rounded-lg border border-input bg-muted/40 px-2.5 text-sm';
