import { describe, expect, it } from 'vitest';
import {
  mergePageFieldVisibility,
  pageFieldVisibilityFallbackFor,
  pageKeyForRequest,
  resolvePageFieldVisibility,
} from '../../server/providers/page-field-visibility.js';

const row = (
  field: string,
  visible: boolean,
  writable = visible,
) => ({
  resource: 'purchase.request',
  field,
  visible,
  writable,
});

describe('page field visibility', () => {
  it('treats a page without rows as unconfigured', () => {
    expect(mergePageFieldVisibility([])).toEqual({
      configured: false,
      visible: [],
      writable: [],
      fields: [],
    });
  });

  it('keeps a page configured when every field is hidden', () => {
    expect(mergePageFieldVisibility([row('notes', false)])).toEqual({
      configured: true,
      visible: [],
      writable: [],
      fields: [row('notes', false)],
    });
  });

  it('shows a field when any permission set shows it', () => {
    expect(
      mergePageFieldVisibility([row('notes', false), row('notes', true)]),
    ).toEqual({
      configured: true,
      visible: ['purchase.request.notes'],
      writable: ['purchase.request.notes'],
      fields: [row('notes', true)],
    });
  });

  it('keeps a field readonly when every set denies writing', () => {
    expect(
      mergePageFieldVisibility([
        row('notes', true, false),
        row('notes', true, false),
      ]),
    ).toEqual({
      configured: true,
      visible: ['purchase.request.notes'],
      writable: [],
      fields: [row('notes', true, false)],
    });
  });

  it('makes a field writable when any set allows writing', () => {
    expect(
      mergePageFieldVisibility([
        row('notes', true, false),
        row('notes', true, true),
      ]),
    ).toEqual({
      configured: true,
      visible: ['purchase.request.notes'],
      writable: ['purchase.request.notes'],
      fields: [row('notes', true, true)],
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
          writable: true,
        },
      ]),
    ).toEqual({
      configured: true,
      visible: [
        'purchase.request.sourceDoc',
        'purchase.request.notes',
        'purchase.request.line.notes',
      ],
      writable: [
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
          writable: true,
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
      writable: ['purchase.request.period'],
      fields: [row('period', true)],
    });
  });

  it('only honors an x-page-key header that names a served page', () => {
    const c = (claimed?: string) => ({
      req: { header: () => claimed },
    });
    const claimed = pageKeyForRequest(
      c('procurement-requests-list-edit'),
      'procurement-requests',
      'procurement-requests-list-edit',
    );
    expect(claimed).toBe('procurement-requests-edit');
    expect(
      pageKeyForRequest(
        c('procurement-requests-new'),
        'procurement-requests',
        'procurement-requests-list-edit',
      ),
    ).toBe('procurement-requests');
    expect(
      pageKeyForRequest(
        c(undefined),
        'procurement-requests',
        'procurement-requests-list-edit',
      ),
    ).toBe('procurement-requests');
  });

  it('maps edit, detail and material-line pages to their create page', () => {
    expect(
      pageFieldVisibilityFallbackFor('procurement-requests-list-edit'),
    ).toBe('procurement-requests-new');
    expect(
      pageFieldVisibilityFallbackFor('procurement-requests-edit'),
    ).toBe('procurement-requests-new');
    expect(
      pageFieldVisibilityFallbackFor('procurement-requests-detail'),
    ).toBe('procurement-requests-new');
    expect(
      pageFieldVisibilityFallbackFor('procurement-requests-detail-edit'),
    ).toBe('procurement-requests-new');
    expect(
      pageFieldVisibilityFallbackFor('procurement-requests-new-materials'),
    ).toBe('procurement-requests-new');
    expect(
      pageFieldVisibilityFallbackFor('procurement-requests-list-edit-materials'),
    ).toBe('procurement-requests-new');
    expect(
      pageFieldVisibilityFallbackFor('procurement-requests-new-action'),
    ).toBe('procurement-requests-new');
    expect(pageFieldVisibilityFallbackFor('procurement-requests')).toBeUndefined();
    expect(
      pageFieldVisibilityFallbackFor('procurement-requests-new'),
    ).toBeUndefined();
  });
});
