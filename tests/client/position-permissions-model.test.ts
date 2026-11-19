import { describe, expect, it } from 'vitest';
import {
  effectivePermissionKeys,
  groupPermissionSets,
  isBroadPermissionSet,
  permissionKeyDiff,
  permissionSetModule,
} from '../../client/pages/organization/position-permissions-model.js';

const set = (key: string, title = key, pageCount = 2) => ({
  key,
  title,
  pageCount,
  actionCount: 3,
});

describe('position permission catalogue', () => {
  it('groups sets by their stable business prefix, longest prefix first', () => {
    expect(permissionSetModule('human-resources-reader')).toBe('people');
    expect(permissionSetModule('organization-reader')).toBe('organization');
    expect(permissionSetModule('asset-manager')).toBe('assets');
    expect(permissionSetModule('administrator')).toBe('system');
    expect(permissionSetModule('unknown-set')).toBe('other');
  });

  it('returns only non-empty groups in the preferred module order and sorts titles', () => {
    const groups = groupPermissionSets([
      set('warehouse-count', '仓库盘点'),
      set('organization-reader', '组织架构查看'),
      set('organization-maintainer', '组织架构维护'),
      set('administrator', '管理员'),
    ]);
    expect(groups.map((group) => group.id)).toEqual([
      'organization',
      'warehouse',
      'system',
    ]);
    expect(groups[0]?.sets.map((item) => item.title)).toEqual([
      '组织架构查看',
      '组织架构维护',
    ]);
  });

  it('merges direct and inherited keys into one effective set', () => {
    const effective = effectivePermissionKeys(
      ['organization-reader'],
      ['organization-reader', 'materials-reader'],
    );
    expect([...effective].sort()).toEqual([
      'materials-reader',
      'organization-reader',
    ]);
  });

  it('reports added and removed keys for the save bar', () => {
    expect(
      permissionKeyDiff(
        ['organization-reader', 'materials-reader'],
        ['materials-reader', 'warehouse-count-operator'],
      ),
    ).toEqual({
      added: ['warehouse-count-operator'],
      removed: ['organization-reader'],
    });
  });

  it('flags catalogue-wide sets as broad access from data, not a name list', () => {
    expect(isBroadPermissionSet({ pageCount: 40 })).toBe(true);
    expect(isBroadPermissionSet({ pageCount: 3 })).toBe(false);
  });
});
