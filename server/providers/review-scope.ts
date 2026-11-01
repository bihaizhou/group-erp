/** The lifecycle parameter scope of one company's review rules: kind plus company. */
export function reviewScope(kind: string, subjectId: string): string {
  return `${kind}:${subjectId}`;
}
