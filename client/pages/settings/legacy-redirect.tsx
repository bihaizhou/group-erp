import { Navigate, useLocation } from 'react-router';

/**
 * Legacy top-level URLs from before the settings section moved under `/settings`.
 * A bare `/users` or `/roles` used to fall through to the home page with no explanation.
 */
export default function LegacySettingsRedirect() {
  const { pathname } = useLocation();
  const target = pathname.endsWith('/roles')
    ? '/settings/roles'
    : '/settings/users';
  return <Navigate to={target} replace />;
}
