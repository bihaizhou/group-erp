import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import {
  TestI18nProvider,
  createTestI18nRuntime,
} from '@nocobase/i18n/testing';
import { beforeEach, expect, it, vi } from 'vitest';
import enUS from '../../client/locales/en-US.js';
import Workbench from '../../client/pages/materials/workbench.js';

const { permissions } = vi.hoisted(() => ({
  permissions: { pages: new Set<string>(), pending: false },
}));
vi.mock('../../client/hooks/use-module-access.js', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('../../client/hooks/use-module-access.js')
    >();
  return {
    ...actual,
    useModuleAccess: () => ({
      allowed: new Set([...permissions.pages].map((id) => `page:${id}:access`)),
      isPending: permissions.pending,
    }),
  };
});
const runtime = await createTestI18nRuntime({
  application: { namespace: 'group-erp', resources: enUS },
});
beforeEach(() => {
  permissions.pages.clear();
  permissions.pending = false;
});
function mount() {
  render(
    <TestI18nProvider runtime={runtime}>
      <MemoryRouter initialEntries={['/functions']}>
        <Workbench />
      </MemoryRouter>
    </TestI18nProvider>,
  );
}
function cardLink(title: string) {
  const card = screen.getByText(title).closest('[data-slot=card]');
  expect(card).not.toBeNull();
  return within(card as HTMLElement).getByRole('button', {
    name: 'Open module',
  });
}

it('shows one card per module, not its function entries', () => {
  permissions.pages.add('warehouse-materials');
  permissions.pages.add('warehouse-material-warehouses');
  permissions.pages.add('people-employees');
  mount();
  expect(screen.getAllByRole('button', { name: 'Open module' })).toHaveLength(
    3,
  );
  expect(cardLink(enUS.materials.center)).toHaveAttribute(
    'href',
    '/functions/warehouse/materials',
  );
  expect(cardLink(enUS.materials.warehouse)).toHaveAttribute(
    'href',
    '/functions/warehouse/settings/warehouses',
  );
  expect(cardLink(enUS.people.personnel)).toHaveAttribute(
    'href',
    '/functions/personnel/employees',
  );
  expect(screen.queryByText(enUS.materials.catalog)).not.toBeInTheDocument();
  expect(screen.queryByText('Warehouse settings')).not.toBeInTheDocument();
});

it('keeps one warehouse card and uses the first authorized entry', () => {
  permissions.pages.add('warehouse-inbounds');
  permissions.pages.add('warehouse-material-warehouses');
  mount();
  expect(screen.getAllByRole('button', { name: 'Open module' })).toHaveLength(
    1,
  );
  expect(cardLink(enUS.materials.warehouse)).toHaveAttribute(
    'href',
    '/functions/warehouse/inbounds',
  );
  expect(screen.queryByText(enUS.materials.catalog)).not.toBeInTheDocument();
});

it('shows the procurement module with only a supplier page grant', () => {
  permissions.pages.add('procurement-suppliers');
  mount();
  expect(cardLink(enUS.procurement.title)).toHaveAttribute(
    'href',
    '/functions/procurement/suppliers',
  );
  expect(screen.queryByText('Suppliers')).not.toBeInTheDocument();
});

it('collapses requisition pages into one module card', () => {
  for (const id of [
    'requisitions-requests',
    'requisitions-purposes',
    'requisitions-settings',
  ])
    permissions.pages.add(id);
  mount();
  expect(screen.getAllByRole('button', { name: 'Open module' })).toHaveLength(
    1,
  );
  expect(cardLink(enUS.requisitions.title)).toHaveAttribute(
    'href',
    '/functions/requisitions/requests',
  );
});

it('uses the first authorized production and operations entry', () => {
  permissions.pages.add('production-setup');
  permissions.pages.add('operations-targets');
  mount();
  expect(cardLink(enUS.production.title)).toHaveAttribute(
    'href',
    '/functions/production/setup',
  );
  expect(cardLink(enUS.operations.title)).toHaveAttribute(
    'href',
    '/functions/operations/targets',
  );
});

it('shows the empty state when no modules are authorized', () => {
  mount();
  expect(screen.getByText('No modules available')).toBeVisible();
  expect(
    screen.queryByRole('button', { name: 'Open module' }),
  ).not.toBeInTheDocument();
});

it('waits for authorization before showing an empty state', () => {
  permissions.pending = true;
  mount();
  expect(screen.queryByText('No modules available')).not.toBeInTheDocument();
});
