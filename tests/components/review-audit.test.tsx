import {
  createTestI18nRuntime,
  TestI18nProvider,
} from '@nocobase/i18n/testing';
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ReviewAudit } from '../../client/components/review-audit.js';
import enUS from '../../client/locales/en-US.js';

const runtime = await createTestI18nRuntime({
  application: { namespace: 'group-erp', resources: enUS },
});

const task = {
  id: 'task-1',
  round: 2,
  status: 'returned',
  versionId: 'v-2',
  createdAt: '2026-10-01T08:00:00.000Z',
  decidedAt: '2026-10-02T09:30:00.000Z',
  candidates: ['u-1', 'u-2'],
  decidedBy: 'u-3',
  reason: 'Quantity is missing.',
};

it('shows every review round with time, candidates and decision', () => {
  render(
    <TestI18nProvider runtime={runtime}>
      <ReviewAudit
        tasks={[task]}
        accounts={{
          'u-1': { name: 'Alice' },
          'u-2': { name: 'Bob' },
          'u-3': { name: 'Carol' },
        }}
        versionNumber={() => 3}
        ruleRevision={() => 7}
      />
    </TestI18nProvider>,
  );
  expect(screen.getByText('Round 2')).toBeInTheDocument();
  expect(screen.getByText('Returned')).toBeInTheDocument();
  expect(screen.getByText('Document version 3')).toBeInTheDocument();
  expect(screen.getByText('Review rule version 7')).toBeInTheDocument();
  expect(screen.getByText('Alice、Bob')).toBeInTheDocument();
  expect(screen.getByText('Carol')).toBeInTheDocument();
  expect(screen.getByText('Quantity is missing.')).toBeInTheDocument();
  expect(screen.getByText('Decided')).toBeInTheDocument();
});

it('shows an empty state instead of an empty section', () => {
  render(
    <TestI18nProvider runtime={runtime}>
      <ReviewAudit tasks={[]} accounts={{}} />
    </TestI18nProvider>,
  );
  expect(screen.getByText('No review rounds yet')).toBeInTheDocument();
});
