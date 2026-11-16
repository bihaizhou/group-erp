import fs from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import enUS from '../../client/locales/en-US.ts';
import zhCN from '../../client/locales/zh-CN.ts';

/** Every addressable key of a locale, as the dot path `t()` resolves. */
function translationKeys(
  resource: Record<string, unknown>,
  prefix = '',
): Set<string> {
  const keys = new Set<string>();
  for (const [key, value] of Object.entries(resource)) {
    if (!prefix && key === 'overrides') continue;
    const keyPath = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object')
      for (const nested of translationKeys(
        value as Record<string, unknown>,
        keyPath,
      ))
        keys.add(nested);
    else keys.add(keyPath.replace(/_(?:zero|one|two|few|many|other)$/u, ''));
  }
  return keys;
}

/**
 * The field catalogue names locale keys for resource titles, field labels and
 * descriptions. They are rendered in the settings field-permission editor, so a
 * key that does not exist in the locale files shows up as a raw dot path.
 */
function catalogueKeys(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const keys = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node)) {
      const name = node.name.getText(source);
      if (name === 'titleKey' || name === 'descriptionKey') {
        if (ts.isStringLiteral(node.initializer))
          keys.add(node.initializer.text);
      }
      if (name === 'labels' && ts.isObjectLiteralExpression(node.initializer)) {
        for (const property of node.initializer.properties) {
          const value = ts.isPropertyAssignment(property)
            ? property.initializer
            : undefined;
          if (value && ts.isStringLiteral(value)) keys.add(value.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...keys];
}

const referenced = catalogueKeys(
  path.resolve(import.meta.dirname, '../../server/providers/field-catalog.ts'),
);

const english = translationKeys(enUS as Record<string, unknown>);
const chinese = translationKeys(zhCN as Record<string, unknown>);

const missing = (locale: Set<string>) =>
  referenced.filter(
    (key) => !locale.has(key) && !locale.has(key.replace(/\.[^.]+$/u, '')),
  );

describe('field catalogue locale keys', () => {
  it('names locale keys that exist in both locales', () => {
    const zhMissing = missing(chinese);
    const enMissing = missing(english);
    expect({ zh: zhMissing, en: enMissing }).toEqual({ zh: [], en: [] });
  });
});
