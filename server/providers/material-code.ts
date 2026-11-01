import { pinyin } from 'pinyin-pro';

const cjkCharacter = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u;
const tokenPattern =
  /([\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff])|([A-Za-z]+)|([0-9]+)/gu;

// Short enough to scan in lists, long enough to stay recognizable; the
// service appends a counter when two names share the same abbreviation.
export const materialCodeLength = 24;

/**
 * Uppercase abbreviation of a standard name: one pinyin initial per Chinese
 * character, the first letter of every Latin word (short tokens such as DN or
 * PN are usually codes and stay whole), and digit runs as-is. Returns an empty
 * string when the name has no usable characters.
 */
export function materialNameAbbreviation(name: string): string {
  const normalized = name.normalize('NFKC');
  const characters = [...normalized].filter((character) =>
    cjkCharacter.test(character),
  );
  const initials = new Map<string, string>();
  if (characters.length > 0) {
    const letters = pinyin(characters.join(''), {
      pattern: 'first',
      toneType: 'none',
      type: 'array',
    });
    characters.forEach((character, index) => {
      const letter = letters[index] ?? '';
      if (/^[a-z]$/i.test(letter))
        initials.set(character, letter.toUpperCase());
    });
  }
  let code = '';
  for (const match of normalized.matchAll(tokenPattern)) {
    const [, han, word, digits] = match;
    code += han
      ? (initials.get(han) ?? '')
      : word
        ? word.length <= 3
          ? word.toUpperCase()
          : word.slice(0, 1).toUpperCase()
        : digits;
    if (code.length >= materialCodeLength) break;
  }
  return code.slice(0, materialCodeLength);
}
