// @vitest-environment node
import { describe, expect, test } from 'vitest';
import {
  materialCodeLength,
  materialNameAbbreviation,
} from '../../server/providers/material-code.js';

describe('material name abbreviation', () => {
  test('uses pinyin initials for Chinese names', () => {
    expect(materialNameAbbreviation('测试砂')).toBe('CSS');
    expect(materialNameAbbreviation('碳钢法兰')).toBe('TGFL');
    expect(materialNameAbbreviation('不锈钢法兰 DN80')).toBe('BXGFLDN80');
  });

  test('uses the first letter of each latin word', () => {
    expect(materialNameAbbreviation('Stainless Steel Flange')).toBe('SSF');
    expect(materialNameAbbreviation('SAND 测试')).toBe('SCS');
  });

  test('normalises width, drops punctuation and keeps digit runs', () => {
    expect(materialNameAbbreviation('法兰（PN16）')).toBe('FLPN16');
    expect(materialNameAbbreviation('50号钢')).toBe('50HG');
    expect(materialNameAbbreviation('  ')).toBe('');
  });

  test('caps the generated code', () => {
    expect(materialNameAbbreviation('超'.repeat(40))).toHaveLength(
      materialCodeLength,
    );
  });
});
