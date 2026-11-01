import type { DatabaseManager } from '@nocobase/db';
import { businessDate } from './business-date.js';

// Identity evidence only: callers still need an explicit business permission.
export async function currentCompanyForUser(
  database: DatabaseManager,
  timeZone: string,
  principal: { type: string; id: string },
): Promise<string | null> {
  if (principal.type !== 'user') return null;
  const person = await database.repository('personnelEmployees').findOne({
    filter: { accountId: principal.id, status: 'active' },
  });
  if (!person || typeof person.subjectId !== 'string') return null;
  const today = businessDate(timeZone);
  const employments = await database
    .repository('personnelEmployments')
    .findMany({
      filter: {
        personId: typeof person.id === 'string' ? person.id : '',
        subjectId: person.subjectId,
      },
      limit: 10001,
    });
  if (employments.length > 10000) return null;
  return employments.some((employment) => {
    const data = employment.data as {
      startDate: string;
      endDate: string | null;
    };
    return data.startDate <= today && (!data.endDate || data.endDate > today);
  })
    ? person.subjectId
    : null;
}
