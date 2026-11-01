/**
 * Character-level search for existing standard names. The rules live apart from
 * the service and its database so candidate lookup and ranking share one
 * normalisation and the scoring can be tested directly.
 */
const separators = /[\s\-_/\\.,，。、·:：;；|+×*()（）【】[\]《》<>"'“”‘’]+/gu;
const maximumGrams = 24;

export type MaterialNameMatchReason = 'same' | 'contains' | 'similar';
export interface MaterialNameMatch {
  readonly score: number;
  readonly reason: MaterialNameMatchReason;
}
export interface MaterialNameSearchKeys {
  /** The normalised input; a candidate containing it keeps the input intact. */
  readonly primary: string;
  /** Overlapping two-character windows that catch names sharing only a phrase. */
  readonly grams: readonly string[];
}

export const materialNameSimilarityThreshold = 0.5;

// Width, case and punctuation are noise in material names: "DN-50" and "dn 50"
// describe one name. Keep letters, digits and ideographs.
export function normalizeMaterialName(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(separators, '');
}

export function materialNameSearchKeys(value: string): MaterialNameSearchKeys {
  const primary = normalizeMaterialName(value);
  if (primary.length < 2) return { primary: '', grams: [] };
  const windows = new Set<string>();
  for (
    let index = 0;
    index + 2 <= primary.length && windows.size < maximumGrams;
    index += 1
  )
    windows.add(primary.slice(index, index + 2));
  return { primary, grams: [...windows] };
}

const bigrams = (value: string) => {
  const result: string[] = [];
  for (let index = 0; index + 2 <= value.length; index += 1)
    result.push(value.slice(index, index + 2));
  return result;
};

function overlap(left: readonly string[], right: readonly string[]): number {
  const counts = new Map<string, number>();
  for (const item of left) counts.set(item, (counts.get(item) ?? 0) + 1);
  let shared = 0;
  for (const item of right) {
    const count = counts.get(item);
    if (!count) continue;
    counts.set(item, count - 1);
    shared += 1;
  }
  return shared;
}

// Sørensen–Dice over a multiset: order-insensitive and stable for short names.
function dice(left: readonly string[], right: readonly string[]): number {
  if (!left.length || !right.length) return 0;
  return (2 * overlap(left, right)) / (left.length + right.length);
}

// The longest shared phrase, not just shared characters: "测试砂粉" and
// "SAND 测试砂" share one phrase, while "碳钢法兰" and "碳钢弯头" share only
// the material family prefix. Capped so a long name stays cheap to compare.
function commonPhrase(left: string, right: string): number {
  const a = left.slice(0, 64),
    b = right.slice(0, 64);
  let best = 0,
    previous = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    const current = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j += 1) {
      if (a[i - 1] !== b[j - 1]) continue;
      current[j] = previous[j - 1] + 1;
      if (current[j] > best) best = current[j];
    }
    previous = current;
  }
  return best;
}

/**
 * Score `candidate` against the proposed `input`. Two-character windows weigh
 * most so shared words ("螺栓") beat shared letters, the longest shared phrase
 * keeps a latin prefix or suffix from diluting a match, and a name that contains
 * the other is always a strong hint.
 */
export function materialNameMatch(
  input: string,
  candidate: string,
): MaterialNameMatch | null {
  const proposed = normalizeMaterialName(input);
  const existing = normalizeMaterialName(candidate);
  if (proposed.length < 2 || existing.length < 2) return null;
  if (proposed === existing) return { score: 1, reason: 'same' };
  if (proposed.includes(existing) || existing.includes(proposed)) {
    const ratio =
      Math.min(proposed.length, existing.length) /
      Math.max(proposed.length, existing.length);
    return { score: 0.86 + ratio * 0.08, reason: 'contains' };
  }
  const phrase =
    commonPhrase(proposed, existing) /
    Math.min(proposed.length, existing.length);
  const score =
    dice(bigrams(proposed), bigrams(existing)) * 0.6 +
    dice([...proposed], [...existing]) * 0.2 +
    phrase * 0.2;
  return score >= materialNameSimilarityThreshold
    ? { score, reason: 'similar' }
    : null;
}
