import type {
  DatabaseConnection,
  DatabaseManager,
  RepositoryRecord,
} from '@nocobase/db';
import { previewEmployeeId } from './identity-preview.js';

type Database = DatabaseManager | DatabaseConnection;

/**
 * The staff record behind the signed-in account.
 *
 * A root account may preview an existing employee's business identity for a
 * short window (see identity-preview.ts); for everyone else, and whenever no
 * preview is active, the employee card must carry the account id.
 */
export async function activeEmployeeForPrincipal(
  database: Database,
  principal: { type?: string; id?: string },
  now = new Date(),
): Promise<RepositoryRecord | null> {
  if (principal.type && principal.type !== 'user') return null;
  if (!principal.id) return null;
  const previewId = await previewEmployeeId(database, principal, now);
  if (previewId) {
    const preview = await database
      .repository('personnelEmployees')
      .findOne({ filter: { id: previewId, status: 'active' } });
    if (preview) return preview;
  }
  const direct = await database
    .repository('personnelEmployees')
    .findOne({ filter: { accountId: principal.id, status: 'active' } });
  return direct ?? null;
}
