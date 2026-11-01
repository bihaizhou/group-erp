// @vitest-environment node
import { describe, expect, test } from 'vitest';
import {
  materialNameMatch,
  materialNameSearchKeys,
  normalizeMaterialName,
} from '../../server/providers/material-name-similarity.js';

describe('material name similarity', () => {
  test('normalises width, case and separators', () => {
    expect(normalizeMaterialName(' 碳钢 法兰 ')).toBe('碳钢法兰');
    expect(normalizeMaterialName('DN-50')).toBe('dn50');
  });

  test('treats separator-only differences as the same name', () => {
    expect(materialNameMatch('碳钢 法兰', '碳钢-法兰')).toEqual({
      score: 1,
      reason: 'same',
    });
  });

  test('keeps names that contain the input or extend it', () => {
    expect(materialNameMatch('碳钢法兰', '碳钢法兰盘')).toMatchObject({
      reason: 'contains',
    });
    expect(materialNameMatch('碳钢法兰', '碳钢法兰盘')!.score).toBeGreaterThan(
      0.85,
    );
  });

  test('finds names that share only a phrase', () => {
    expect(materialNameMatch('碳钢法兰', '不锈钢法兰')).toMatchObject({
      reason: 'similar',
    });
  });

  test('is not diluted by a latin prefix on the existing name', () => {
    expect(materialNameMatch('测试砂粉', 'SAND 测试砂')).toMatchObject({
      reason: 'similar',
    });
  });

  test('rejects names that are merely in the same family', () => {
    expect(materialNameMatch('碳钢法兰', '碳钢弯头')).toBeNull();
    expect(materialNameMatch('六角螺栓', '螺母')).toBeNull();
  });

  test('ignores input shorter than two characters after normalisation', () => {
    expect(materialNameMatch(' 钢 ', '钢管')).toBeNull();
    expect(materialNameSearchKeys(' 钢 ')).toEqual({ primary: '', grams: [] });
  });

  test('builds overlapping windows for fuzzy candidates', () => {
    expect(materialNameSearchKeys('碳钢法兰')).toEqual({
      primary: '碳钢法兰',
      grams: ['碳钢', '钢法', '法兰'],
    });
  });
});
