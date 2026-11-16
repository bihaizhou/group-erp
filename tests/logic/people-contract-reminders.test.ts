// @vitest-environment node
import { expect, test } from 'vitest';
import { ContractReminders } from '../../server/providers/people-contract-reminders.js';

const employment = (
  id: string,
  employeeId: string,
  contractEnd: string,
  extra: Record<string, unknown> = {},
) => ({
  id,
  employeeId,
  name: `Employee ${id}`,
  subjectId: 'company',
  data: { contractEnd, startDate: '2024-01-01', ...extra },
});

const reminderApp = (
  employments: unknown[],
  employees: unknown[],
  deliveries: unknown[],
) =>
  new ContractReminders(
    {
      repository: (name: string) => ({
        findMany: async () =>
          name === 'personnelEmployments' ? employments : employees,
      }),
    } as never,
    {
      deliver: async (input: unknown) => {
        deliveries.push(input);
        return input;
      },
    } as never,
    'Asia/Shanghai',
  );

test('delivers one reminder per expiring contract and skips the rest', async () => {
  const deliveries: any[] = [];
  const reminders = reminderApp(
    [
      employment('soon', 'emp-1', '2026-12-01'),
      employment('no-account', 'emp-2', '2026-12-02'),
      employment('too-far', 'emp-3', '2027-06-01'),
      employment('ended', 'emp-4', '2026-12-03', { endDate: '2026-11-01' }),
    ],
    [
      { id: 'emp-1', data: { accountId: 'account-1' } },
      { id: 'emp-2', data: {} },
      { id: 'emp-3', data: { accountId: 'account-3' } },
      { id: 'emp-4', data: { accountId: 'account-4' } },
    ],
    deliveries,
  );
  const result = await reminders.run(new Date('2026-11-20T02:00:00Z'));
  expect(result).toEqual({ delivered: 1, skipped: false });
  expect(deliveries).toHaveLength(1);
  expect(deliveries[0]).toMatchObject({
    deliveryId: 'contract-expiry:soon:2026-12-01',
    userId: 'account-1',
  });
  expect(String(deliveries[0].message.body)).toContain('2026-12-01');
  const again = await reminders.run(new Date('2026-11-20T03:00:00Z'));
  expect(again).toEqual({ delivered: 0, skipped: true });
});

test('ignores contracts whose employment has not started yet', async () => {
  const deliveries: any[] = [];
  const reminders = reminderApp(
    [
      employment('future', 'emp-1', '2026-12-01', {
        startDate: '2026-12-05',
      }),
    ],
    [{ id: 'emp-1', data: { accountId: 'account-1' } }],
    deliveries,
  );
  expect(await reminders.run(new Date('2026-11-20T02:00:00Z'))).toEqual({
    delivered: 0,
    skipped: false,
  });
  expect(deliveries).toHaveLength(0);
});
