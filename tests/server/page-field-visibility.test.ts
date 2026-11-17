import { describe, expect, it } from 'vitest';
import {
  mergePageFieldVisibility,
  resolvePageFieldVisibility,
} from '../../server/providers/page-field-visibility.js';

const row = (field: string, visible: boolean) => ({
  resource: 'purchase.request',
  field,
  visible,
});

describe('page field visibility', () => {
  it('treats a page without rows as unconfigured', () => {
    expect(mergePageFieldVisibility([])).toEqual({
      configured: false,
      visible: [],
      fields: [],
    });
  });

  it('keeps a page configured when every field is hidden', () => {
    expect(mergePageFieldVisibility([row('notes', false)])).toEqual({
      configured: true,
      visible: [],
      fields: [row('notes', false)],
    });
  });

  it('shows a field when any permission set shows it', () => {
    expect(
      mergePageFieldVisibility([row('notes', false), row('notes', true)]),
    ).toEqual({
      configured: true,
      visible: ['purchase.request.notes'],
      fields: [row('notes', true)],
    });
  });

  it('unions fields across permission sets without duplicates', () => {
    expect(
      mergePageFieldVisibility([
        row('sourceDoc', true),
        row('notes', true),
        {
          resource: 'purchase.request.line',
          field: 'notes',
          visible: true,
        },
      ]),
    ).toEqual({
      configured: true,
      visible: [
        'purchase.request.sourceDoc',
        'purchase.request.notes',
        'purchase.request.line.notes',
      ],
      fields: [
        row('sourceDoc', true),
        row('notes', true),
        {
          resource: 'purchase.request.line',
          field: 'notes',
          visible: true,
        },
      ],
    });
  });

  it('keeps a page without a fallback independent even when it has rows', () => {
    expect(
      resolvePageFieldVisibility([row('notes', false)], [], undefined),
    ).toEqual({
      mode: 'independent',
      configured: true,
      fields: [row('notes', false)],
    });
  });

  it('makes an edit page inherit its create page until it has its own rows', () => {
    expect(
      resolvePageFieldVisibility([], [row('notes', false)], 'orders-new'),
    ).toEqual({
      mode: 'inherit',
      configured: true,
      inheritedFrom: 'orders-new',
      fields: [row('notes', false)],
    });
    expect(
      resolvePageFieldVisibility([row('period', true)], [], 'orders-new'),
    ).toEqual({
      mode: 'override',
      configured: true,
      fields: [row('period', true)],
    });
  });

  it('keeps an edit page unconfigured when neither page has rows', () => {
    expect(resolvePageFieldVisibility([], [], 'orders-new')).toEqual({
      mode: 'inherit',
      configured: false,
      inheritedFrom: 'orders-new',
      fields: [],
    });
  });

  it('does not let a false row remove another set’s visible row', () => {
    expect(
      mergePageFieldVisibility([row('period', false), row('period', true)]),
    ).toEqual({
      configured: true,
      visible: ['purchase.request.period'],
      fields: [row('period', true)],
    });
  });
});
