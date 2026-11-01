import {
  TestI18nProvider,
  createTestI18nRuntime,
} from '@nocobase/i18n/testing';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import enUS from '../../client/locales/en-US.js';
import HomePage from '../../client/pages/home/index.js';
const permission = vi.hoisted(() => ({ can: true }));
vi.mock('../../client/hooks/use-module-access.js', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('../../client/hooks/use-module-access.js')
    >();
  const keys = [
    'settings:organization:read',
    'page:people-overview:access',
    'page:people-employees:access',
  ];
  return {
    ...actual,
    useModuleAccess: () => ({
      allowed: new Set(permission.can ? keys : []),
      isPending: false,
    }),
  };
});
const runtime = await createTestI18nRuntime({
  application: { namespace: 'group-erp', resources: enUS },
});
function Wrapper({ children }: { children: ReactNode }) {
  return (
    <TestI18nProvider runtime={runtime}>
      <MemoryRouter>{children}</MemoryRouter>
    </TestI18nProvider>
  );
}
describe('ERP home', () => {
  it('shows four domains and authorized implemented entries', () => {
    permission.can = true;
    render(<HomePage />, { wrapper: Wrapper });
    expect(
      screen.getByRole('heading', { level: 1, name: enUS.erp.title }),
    ).toBeVisible();
    for (const key of [
      'organization',
      'hr',
      'functions',
      'development',
    ] as const)
      expect(screen.getByText(enUS.erp[key], { exact: true })).toBeVisible();
    expect(screen.getAllByRole('button')).toHaveLength(3);
    expect(
      screen.getByRole('button', { name: enUS.people.openHr }),
    ).toHaveAttribute('href', '/human-resources');
    expect(
      screen.getByRole('button', { name: enUS.materials.open }),
    ).toHaveAttribute('href', '/functions');
    expect(screen.getByRole('button', { name: enUS.erp.open })).toHaveAttribute(
      'href',
      '/organization',
    );
  });
  it('hides the organization entry without read permission', () => {
    permission.can = false;
    render(<HomePage />, { wrapper: Wrapper });
    expect(
      screen.queryByRole('button', { name: enUS.erp.open }),
    ).not.toBeInTheDocument();
  });
});
