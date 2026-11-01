import { render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import {
  accessKey,
  useModuleAccess,
} from '../../client/hooks/use-module-access.js';

vi.mock('@nocobase/app-plugin-authorization/client', () => ({
  useAuthorizationClient: () => ({
    can: async ({ resource }: { resource: { type: string; id: string } }) =>
      resource.id !== 'denied',
  }),
  useAuthorizationRevision: () => 0,
}));

const checks = [
  { type: 'page', id: 'allowed', action: 'access' },
  { type: 'page', id: 'denied', action: 'access' },
] as const;

function Probe() {
  const { allowed, isPending } = useModuleAccess(checks);
  return (
    <p>
      {isPending ? 'pending' : 'ready'}:
      {[...allowed]
        .map((key) => (accessKey(checks[0]) === key ? 'first' : key))
        .join(',')}
    </p>
  );
}

it('resolves every check once and reports only allowed keys', async () => {
  render(<Probe />);
  await waitFor(() => expect(screen.getByText(/ready:/)).toBeVisible());
  const text = screen.getByText(/ready:/).textContent ?? '';
  expect(text).toContain('first');
  expect(text).not.toContain('denied');
});
