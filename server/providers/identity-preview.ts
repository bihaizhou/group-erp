import type {
  DatabaseConnection,
  DatabaseManager,
  RepositoryRecord,
} from '@nocobase/db';
import { isSuperAdmin } from './super-admin.js';

/** How long one preview stays in force before it silently expires. */
export const PREVIEW_TTL_MS = 2 * 60 * 60 * 1000;

export const PREVIEW_COLLECTION = 'appIdentityPreviewSessions';

type Database = DatabaseManager | DatabaseConnection;

const text = (value: unknown): string =>
  typeof value === 'string' ? value : '';

export interface IdentityPreviewSession {
  id: string;
  userId: string;
  employeeId: string;
  employeeName: string;
  startedAt: string;
  expiresAt: string;
}

const asSession = (row: RepositoryRecord): IdentityPreviewSession | null => {
  const id = text(row.id);
  const userId = text(row.userId);
  const employeeId = text(row.employeeId);
  const startedAt = text(row.startedAt);
  const expiresAt = text(row.expiresAt);
  if (!id || !userId || !employeeId || !expiresAt) return null;
  return {
    id,
    userId,
    employeeId,
    employeeName: text(row.employeeName),
    startedAt,
    expiresAt,
  };
};

/**
 * The unexpired preview session of one account, if any. Expired rows are left
 * for the next start/stop call to close so a read never has to write.
 */
export async function activePreviewSession(
  database: Database,
  userId: string,
  now = new Date(),
): Promise<IdentityPreviewSession | null> {
  if (!userId) return null;
  const row = await database.repository(PREVIEW_COLLECTION).findOne({
    filter: { userId, status: 'active' },
  });
  const session = row ? asSession(row) : null;
  if (!session) return null;
  const expiresAt = Date.parse(session.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > now.getTime()
    ? session
    : null;
}

/**
 * The employee a root account is previewing, or null. Only root may preview:
 * every other account's business identity keeps coming from its own employee
 * card, so this can never be used to borrow someone else's staff records.
 */
export async function previewEmployeeId(
  database: Database,
  principal: { type?: string; id?: string },
  now = new Date(),
): Promise<string | null> {
  if (principal.type && principal.type !== 'user') return null;
  if (!principal.id) return null;
  if (!(await isSuperAdmin(database as DatabaseManager, principal))) {
    return null;
  }
  const session = await activePreviewSession(database, principal.id, now);
  return session?.employeeId ?? null;
}
