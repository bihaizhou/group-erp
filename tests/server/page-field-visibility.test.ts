import { describe, expect, it } from 'vitest';
import { mergePageFieldVisibility } from '../../server/providers/page-field-visibility.js';

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
    });
  });

  it('keeps a page configured when every field is hidden', () => {
    expect(mergePageFieldVisibility([row('notes', false)])).toEqual({
      configured: true,
      visible: [],
    });
  });

  it('shows a field when any permission set shows it', () => {
    expect(
      mergePageFieldVisibility([row('notes', false), row('notes', true)]),
    ).toEqual({ configured: true, visible: ['purchase.request.notes'] });
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
    });
  });

  it('does not let a false row remove another set’s visible row', () => {
    expect(
      mergePageFieldVisibility([row('period', false), row('period', true)]),
    ).toEqual({ configured: true, visible: ['purchase.request.period'] });
  });
});
