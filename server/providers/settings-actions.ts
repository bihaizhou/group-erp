/**
 * Localized titles for the `settings` permission entries in the role editor.
 *
 * NocoBase defaults an action without a title to its raw name (`read`,
 * `manage`, …), which shows English in the permission tree. Every settings
 * action must therefore be declared through this helper; the union below makes
 * an unlabeled new action a type error.
 */
export type SettingsActionName =
  | 'read'
  | 'manage'
  | 'approve'
  | 'readAll'
  | 'report'
  | 'update';

const TITLE_KEYS: Readonly<Record<SettingsActionName, string>> = {
  read: 'permissionActions.read',
  manage: 'permissionActions.manage',
  approve: 'permissionActions.approve',
  readAll: 'permissionActions.readAll',
  report: 'permissionActions.report',
  update: 'permissionActions.update',
};

export interface SettingsActionDeclaration {
  readonly name: SettingsActionName;
  readonly title: { readonly key: string; readonly ns: 'group-erp' };
}

export const settingsActions = (
  names: readonly SettingsActionName[],
): SettingsActionDeclaration[] =>
  names.map((name) => ({
    name,
    title: { key: TITLE_KEYS[name], ns: 'group-erp' },
  }));
