// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  COMPANY_STORAGE_KEY,
  isCompanyId,
  readCompanyId,
  writeCompanyId,
} from '../../client/lib/company-scope';

const companyId = '3f6e2c1a-4b5d-4c8e-9f0a-1b2c3d4e5f60';

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    values,
  };
}

describe('remembered company', () => {
  it('accepts organization subject ids only', () => {
    expect(isCompanyId(companyId)).toBe(true);
    expect(isCompanyId('not-a-company')).toBe(false);
    expect(isCompanyId('')).toBe(false);
  });

  it('reads back what was written', () => {
    const storage = memoryStorage();
    writeCompanyId(storage, companyId);
    expect(storage.values.get(COMPANY_STORAGE_KEY)).toBe(companyId);
    expect(readCompanyId(storage)).toBe(companyId);
  });

  it('ignores a stored value that is not an id', () => {
    const storage = memoryStorage({ [COMPANY_STORAGE_KEY]: 'stale' });
    expect(readCompanyId(storage)).toBeNull();
  });

  it('survives storage that throws', () => {
    const storage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readCompanyId(storage)).toBeNull();
    expect(() => writeCompanyId(storage, companyId)).not.toThrow();
  });
});
