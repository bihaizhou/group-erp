import { describe, expect, it } from 'vitest';
import type { FieldPermissionResource } from '../../client/components/field-permission-policies.js';
import type { PermissionEditorNavigationNode } from '../../client/components/permission-editor.js';
import {
  collectPageDisplays,
  pageFieldResourcesForTarget,
  type PageTabLabels,
} from '../../client/pages/settings/page-settings.js';

const labels: PageTabLabels = {
  list: 'List',
  page: 'Page',
  new: 'New',
  edit: 'Edit',
  detail: 'Detail',
};

const catalog: readonly FieldPermissionResource[] = [
  {
    resource: 'purchase.request',
    titleKey: 'purchase.request',
    descriptionKey: 'purchase.request.description',
    fields: [
      { field: 'code', label: 'Code', titleKey: 'code' },
      { field: 'company', label: 'Company', titleKey: 'company' },
      {
        field: 'internalOnly',
        label: 'Internal only',
        titleKey: 'internalOnly',
      },
    ],
  },
];

describe('unified page settings', () => {
  it('collects the parent page and inherited child pages into numbered tabs', () => {
    const node: PermissionEditorNavigationNode = {
      id: 'procurement-requests',
      label: 'Purchase requests',
      rowId: 'procurement-requests',
      pageKey: 'procurement-requests',
      resourceId: 'procurement-requests',
      dataResources: ['purchase.request'],
      path: '/procurement/requests',
      children: [
        {
          id: 'new',
          label: 'Purchase requests · New',
          hint: 'Inherited from the parent page',
          pageKey: 'procurement-requests-new',
          resourceId: 'procurement-requests',
          path: '/procurement/requests/new',
        },
        {
          id: 'edit',
          label: 'Purchase requests · List · Edit',
          hint: 'Inherited from the parent page',
          pageKey: 'procurement-requests-list-edit',
          resourceId: 'procurement-requests',
          path: '/procurement/requests/edit/:requestId',
        },
        {
          id: 'detail',
          label: 'Purchase requests · Detail',
          hint: 'Inherited from the parent page',
          pageKey: 'procurement-requests-detail',
          resourceId: 'procurement-requests',
          path: '/procurement/requests/:requestId',
        },
        {
          id: 'duplicate',
          label: 'Purchase requests · Duplicate',
          hint: 'Inherited from the parent page',
          pageKey: 'procurement-requests-new',
          resourceId: 'procurement-requests',
        },
        {
          id: 'no-page-key',
          label: 'Purchase requests · Help',
          hint: 'Inherited from the parent page',
        },
        {
          id: 'materials',
          label: 'Purchase requests · New · Materials',
          hint: 'Inherited from the parent page',
          pageKey: 'procurement-requests-new-materials',
          resourceId: 'procurement-requests',
        },
        {
          id: 'nested',
          label: 'Purchase requests · Edit · Permissions',
          hint: 'Inherited from the parent page',
          pageKey: 'procurement-requests-edit-permissions',
          resourceId: 'procurement-requests',
        },
      ],
    };

    const displays = collectPageDisplays(node, labels);

    expect(
      displays.map((display) => [
        display.tabLabel,
        display.kind,
        display.advanced,
      ]),
    ).toEqual([
      ['List', 'parent', false],
      ['New', 'child', false],
      ['List · Edit', 'child', false],
      ['Detail', 'child', false],
      ['New / Materials', 'child', true],
      ['Edit / Permissions', 'child', true],
    ]);
    expect(displays.map((display) => display.pageKey)).toEqual([
      'procurement-requests',
      'procurement-requests-new',
      'procurement-requests-list-edit',
      'procurement-requests-detail',
      'procurement-requests-new-materials',
      'procurement-requests-edit-permissions',
    ]);
    expect(displays[2]?.fallbackPageKey).toBe('procurement-requests-new');
    expect(displays[0]?.resources).toEqual([
      'purchase.request',
      'purchase.request.line',
    ]);
    expect(displays[0]?.path).toBe('/procurement/requests');
  });

  it('keeps only declared fields for a registry page', () => {
    const resources = pageFieldResourcesForTarget(
      {
        pageKey: 'procurement-requests',
        resourceId: 'procurement-requests',
        label: 'Purchase requests',
        resources: ['purchase.request'],
        tabLabel: 'List',
        kind: 'parent',
        advanced: false,
      },
      catalog,
    );

    expect(resources).toHaveLength(1);
    const fieldNames = resources[0]?.fields.map((field) => field.field) ?? [];
    expect(fieldNames).toContain('code');
    expect(fieldNames).toContain('company');
    expect(fieldNames).not.toContain('internalOnly');
  });

  it('shows every catalogue field for a page without a declared field list', () => {
    const resources = pageFieldResourcesForTarget(
      {
        pageKey: 'a-page-added-tomorrow',
        resourceId: 'a-page-added-tomorrow',
        label: 'A page added tomorrow',
        resources: ['purchase.request'],
        tabLabel: 'Page',
        kind: 'parent',
        advanced: false,
      },
      catalog,
    );

    expect(resources[0]?.fields.map((field) => field.field)).toEqual([
      'code',
      'company',
      'internalOnly',
    ]);
  });

  it('includes the people policy resources so legacy hidden fields are mirrored', () => {
    const peopleCatalog: readonly FieldPermissionResource[] = [
      {
        resource: 'people.profile',
        titleKey: 'people.profile',
        descriptionKey: '',
        fields: [
          { field: 'name', label: 'Name', titleKey: 'name' },
          { field: 'code', label: 'Code', titleKey: 'code' },
          { field: 'internalOnly', label: 'Internal', titleKey: 'internalOnly' },
        ],
      },
      {
        resource: 'people.employee.contact',
        titleKey: 'people.employee.contact',
        descriptionKey: '',
        fields: [
          { field: 'phone', label: 'Phone', titleKey: 'phone' },
          { field: 'email', label: 'Email', titleKey: 'email' },
        ],
      },
      {
        resource: 'people.employee.grade',
        titleKey: 'people.employee.grade',
        descriptionKey: '',
        fields: [{ field: 'grade', label: 'Grade', titleKey: 'grade' }],
      },
    ];
    const resources = pageFieldResourcesForTarget(
      {
        pageKey: 'people-profiles',
        resourceId: 'people-profiles',
        label: 'People profiles',
        resources: [
          'people.profile',
          'people.employee.contact',
          'people.employee.grade',
        ],
        tabLabel: 'List',
        kind: 'parent',
        advanced: false,
      },
      peopleCatalog,
    );

    expect(resources.map((resource) => resource.resource)).toEqual([
      'people.profile',
      'people.employee.contact',
      'people.employee.grade',
    ]);
    expect(
      resources.find((resource) => resource.resource === 'people.profile')
        ?.fields.map((field) => field.field),
    ).not.toContain('internalOnly');
    expect(
      resources.find(
        (resource) => resource.resource === 'people.employee.contact',
      )?.fields.map((field) => field.field),
    ).toEqual(['phone', 'email']);
    expect(
      resources.find((resource) => resource.resource === 'people.employee.grade')
        ?.fields.map((field) => field.field),
    ).toEqual(['grade']);
  });
});
