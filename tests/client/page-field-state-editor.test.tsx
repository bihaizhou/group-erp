import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PageFieldStateEditor } from '../../client/pages/settings/page-field-state-editor.js';
import type {
  FieldPermissionResource,
} from '../../client/components/field-permission-policies.js';
import {
  stateOfValue,
  valueOfState,
} from '../../client/pages/settings/page-field-state.js';

const resources: FieldPermissionResource[] = [
  {
    resource: 'purchase.request',
    titleKey: '采购申请',
    descriptionKey: '采购申请',
    fields: [
      { field: 'notes', titleKey: '备注', label: '备注' },
      { field: 'usage', titleKey: '用途', label: '用途' },
    ],
  },
];

const buttonsOf = (label: string) =>
  screen.getAllByRole('button', { name: label });

describe('page field state editor', () => {
  it('converts between three states and their values', () => {
    expect(stateOfValue({ visible: false, writable: false })).toBe('hidden');
    expect(stateOfValue({ visible: true, writable: false })).toBe('readonly');
    expect(stateOfValue({ visible: true, writable: true })).toBe('editable');
    expect(valueOfState('hidden')).toEqual({ visible: false, writable: false });
    expect(valueOfState('readonly')).toEqual({ visible: true, writable: false });
    expect(valueOfState('editable')).toEqual({ visible: true, writable: true });
  });

  it('marks the current state with aria-pressed', () => {
    render(
      <PageFieldStateEditor
        resources={resources}
        stateOf={(resource, field) =>
          resource === 'purchase.request' && field === 'notes'
            ? { visible: true, writable: false }
            : { visible: false, writable: false }
        }
        onChange={vi.fn()}
      />,
    );
    expect(buttonsOf('pageFieldPermission.editable')[0]).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(buttonsOf('pageFieldPermission.readonly')[0]).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(buttonsOf('pageFieldPermission.hidden')[1]).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('reports a state change per field', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <PageFieldStateEditor
        resources={resources}
        stateOf={() => ({ visible: true, writable: true })}
        onChange={onChange}
      />,
    );
    await user.click(buttonsOf('pageFieldPermission.hidden')[0]!);
    expect(onChange).toHaveBeenCalledWith(
      'purchase.request',
      'notes',
      'hidden',
    );
  });

  it('keeps locked fields visible and badges them as required', () => {
    render(
      <PageFieldStateEditor
        resources={resources}
        stateOf={() => ({ visible: true, writable: true })}
        onChange={vi.fn()}
        lockedFields={new Set(['purchase.request.usage'])}
      />,
    );
    expect(screen.getByText('pageFieldPermission.required')).toBeInTheDocument();
    expect(buttonsOf('pageFieldPermission.hidden')[1]).toBeDisabled();
  });

  it('disables editable for never-writable fields and readonly for create-page required fields', () => {
    render(
      <PageFieldStateEditor
        resources={resources}
        stateOf={() => ({ visible: true, writable: true })}
        onChange={vi.fn()}
        neverWritableFields={new Set(['purchase.request.notes'])}
        readonlyForbiddenFields={new Set(['purchase.request.usage'])}
      />,
    );
    expect(buttonsOf('pageFieldPermission.editable')[0]).toBeDisabled();
    expect(buttonsOf('pageFieldPermission.readonly')[1]).toBeDisabled();
    expect(buttonsOf('pageFieldPermission.editable')[1]).not.toBeDisabled();
  });

  it('highlights modified rows and disables everything in read-only mode', () => {
    render(
      <PageFieldStateEditor
        resources={resources}
        stateOf={() => ({ visible: true, writable: true })}
        onChange={vi.fn()}
        modifiedOf={(resource, field) =>
          resource === 'purchase.request' && field === 'notes'
        }
        readOnly
      />,
    );
    const rows = document.querySelectorAll('[data-slot="page-field-state-row"]');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.className).toContain('bg-primarysoft');
    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeDisabled();
    }
  });
});
