// @vitest-environment node
import { ParameterConfigurationError } from '@nocobase/lifecycle';
import { describe, expect, it } from 'vitest';
import { withPeopleApprovalGrants } from '../../database/main/migrations/202611020002_people_approval_pages.js';
import {
  approvalChangeTypes,
  defaultApprovalChains,
  defaultChecklists,
  parseApprovalChains,
  parseChecklists,
} from '../../server/providers/people-approval.js';

const stage = (key: string) => ({
  key,
  title: '人事复核',
  mode: 'any',
  selections: [{ type: 'role', referenceId: 'personnel-reviewer' }],
  subjectIds: [],
});

describe('people approval chains', () => {
  it('defaults every change type to one HR review stage', () => {
    const chains = defaultApprovalChains();
    for (const type of approvalChangeTypes) {
      expect(chains[type].stages).toHaveLength(1);
      expect(chains[type].stages[0]).toMatchObject({
        key: 'hr-review',
        mode: 'any',
        selections: [{ type: 'role', referenceId: 'personnel-reviewer' }],
      });
    }
  });

  it('keeps missing change types on the default chain', () => {
    const parsed = parseApprovalChains({
      entry: { stages: [stage('a'), stage('b')] },
    }) as Record<string, { stages: unknown[] }>;
    expect(parsed.entry.stages).toHaveLength(2);
    expect(parsed.exit).toEqual(defaultApprovalChains().exit);
  });

  it('accepts role, account and position approvers', () => {
    const parsed = parseApprovalChains({
      transfer: {
        stages: [
          {
            ...stage('a'),
            mode: 'all',
            selections: [
              { type: 'role', referenceId: 'personnel-reviewer' },
              { type: 'user', referenceId: 'account-1' },
              { type: 'position', referenceId: 'position-1' },
            ],
            subjectIds: ['00000000-0000-4000-8000-000000000001'],
          },
        ],
      },
    }) as Record<string, { stages: { mode: string }[] }>;
    expect(parsed.transfer.stages[0]?.mode).toBe('all');
    expect(parsed.entry).toEqual(defaultApprovalChains().entry);
  });

  it('rejects duplicate stage keys, a sixth stage and unknown sources', () => {
    expect(() =>
      parseApprovalChains({ entry: { stages: [stage('a'), stage('a')] } }),
    ).toThrow(ParameterConfigurationError);
    expect(() =>
      parseApprovalChains({
        entry: {
          stages: Array.from({ length: 6 }, (_, index) => stage(`s${index}`)),
        },
      }),
    ).toThrow(ParameterConfigurationError);
    expect(() =>
      parseApprovalChains({
        entry: {
          stages: [
            {
              ...stage('a'),
              selections: [{ type: 'team', referenceId: 'x' }],
            },
          ],
        },
      }),
    ).toThrow(ParameterConfigurationError);
    expect(() =>
      parseApprovalChains({
        entry: { stages: [{ ...stage('a'), title: ' ' }] },
      }),
    ).toThrow(ParameterConfigurationError);
  });
});

describe('people approval page grants', () => {
  const changes = {
    resource: { type: 'page', id: 'people-changes' },
    actions: [{ action: 'access' }],
  };

  it('adds the inbox page to every change role', () => {
    const grants = withPeopleApprovalGrants([changes], 'personnel-reviewer');
    expect(grants).toHaveLength(2);
    expect(grants[1]?.resource).toEqual({
      type: 'page',
      id: 'people-approvals',
    });
  });

  it('adds the settings page to the personnel maintainer only', () => {
    expect(
      withPeopleApprovalGrants([changes], 'personnel-maintainer').map(
        (grant) => grant.resource?.id,
      ),
    ).toEqual([
      'people-changes',
      'people-approvals',
      'people-approval-settings',
    ]);
    expect(
      withPeopleApprovalGrants([changes], 'company-personnel-maintainer'),
    ).toHaveLength(2);
  });

  it('leaves roles without the changes page alone and is idempotent', () => {
    expect(withPeopleApprovalGrants([], 'personnel-maintainer')).toEqual([]);
    const once = withPeopleApprovalGrants([changes], 'personnel-maintainer');
    expect(withPeopleApprovalGrants(once, 'personnel-maintainer')).toBe(once);
  });
});

describe('people change checklists', () => {
  it('keeps missing change types on the default checklist', () => {
    const parsed = parseChecklists({
      entry: [{ key: 'custom', title: 'Custom item', owner: 'Admin' }],
    }) as Record<string, unknown[]>;
    expect(parsed.entry).toHaveLength(1);
    expect(parsed.exit).toHaveLength(defaultChecklists().exit.length);
  });

  it('keeps an explicitly empty checklist empty', () => {
    const parsed = parseChecklists({ entry: [] }) as Record<string, unknown[]>;
    expect(parsed.entry).toEqual([]);
    expect(parsed.transfer).toHaveLength(defaultChecklists().transfer.length);
  });

  it('rejects duplicate item keys and unsafe keys', () => {
    expect(() =>
      parseChecklists({
        entry: [
          { key: 'a', title: 'One', owner: '' },
          { key: 'a', title: 'Two', owner: '' },
        ],
      }),
    ).toThrow(ParameterConfigurationError);
    expect(() =>
      parseChecklists({
        entry: [{ key: 'A B', title: 'One', owner: '' }],
      }),
    ).toThrow(ParameterConfigurationError);
    expect(() =>
      parseChecklists({ entry: [{ key: 'ok', title: '', owner: '' }] }),
    ).toThrow(ParameterConfigurationError);
  });

  it('defaults the asset flag to false', () => {
    const parsed = parseChecklists({
      entry: [{ key: 'ok', title: 'One', owner: '' }],
    }) as Record<string, { assets: boolean }[]>;
    expect(parsed.entry[0].assets).toBe(false);
  });
});
