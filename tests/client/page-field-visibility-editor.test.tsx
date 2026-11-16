import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PageFieldVisibilityEditor } from '../../client/pages/settings/page-field-visibility-editor.js';

const resources = [
  {
    resource: 'purchase.request',
    titleKey: '采购申请',
    fields: [
      { field: 'notes', titleKey: '备注' },
      { field: 'usage', titleKey: '用途' },
    ],
  },
];

describe('page field visibility editor', () => {
  it('shows the page resource and its fields', () => {
    render(
      <PageFieldVisibilityEditor
        resources={resources}
        visibleOf={(resource, field) =>
          resource === 'purchase.request' && field === 'notes'
        }
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText('采购申请')).toBeInTheDocument();
    const [notes, usage] = screen.getAllByRole('checkbox');
    expect(notes).toBeChecked();
    expect(usage).not.toBeChecked();
  });

  it('locks required fields so the form stays sendable', () => {
    render(
      <PageFieldVisibilityEditor
        resources={resources}
        visibleOf={() => false}
        onChange={vi.fn()}
        lockedFields={new Set(['purchase.request.usage'])}
      />,
    );
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(
      screen.getByText('pageFieldVisibility.requiredBadge'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('pageFieldVisibility.requiredBadge'),
    ).toHaveAttribute('title', 'pageFieldVisibility.requiredField');
  });

  it('reports a field the administrator hides', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <PageFieldVisibilityEditor
        resources={resources}
        visibleOf={() => true}
        onChange={onChange}
      />,
    );
    await user.click(screen.getAllByRole('checkbox')[0]!);
    expect(onChange).toHaveBeenCalledWith('purchase.request', 'notes', false);
  });

  it('disables every control in read-only mode', () => {
    render(
      <PageFieldVisibilityEditor
        resources={resources}
        visibleOf={() => true}
        onChange={vi.fn()}
        readOnly
      />,
    );
    for (const checkbox of screen.getAllByRole('checkbox')) {
      expect(checkbox).toBeDisabled();
    }
  });
});
