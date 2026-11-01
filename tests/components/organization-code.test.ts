import { describe, expect, it } from 'vitest';

import {
  codePrefix,
  initialCode,
  reparentCode,
} from '../../client/pages/organization/code.js';
import type {
  OrgOptions,
  OrgRecord,
} from '../../client/pages/organization/model.js';

function row(
  id: string,
  code: string,
  fields: Partial<OrgRecord> = {},
): OrgRecord {
  return {
    id,
    code,
    name: id,
    status: 'active',
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    sortOrder: 0,
    ...fields,
  };
}

const options: OrgOptions = {
  subjects: {
    rows: [row('group', 'GROUP'), row('company', 'CO')],
    total: 2,
    truncated: false,
  },
  units: {
    rows: [row('ops', 'GROUP-OPS'), row('finance', 'CO-FIN')],
    total: 2,
    truncated: false,
  },
  positions: { rows: [], total: 0, truncated: false },
  sectors: { rows: [row('energy', 'ENERGY')], total: 1, truncated: false },
  regions: { rows: [row('cn', 'CN')], total: 1, truncated: false },
  relations: { rows: [], total: 0, truncated: false },
};

describe('organization code inheritance', () => {
  it('uses the parent unit, then the owning subject, for units', () => {
    expect(
      codePrefix('units', { parentId: 'ops', subjectId: 'company' }, options),
    ).toBe('GROUP-OPS');
    expect(
      codePrefix('units', { parentId: '', subjectId: 'company' }, options),
    ).toBe('CO');
  });

  it('uses the unit for positions and the parent for other hierarchies', () => {
    expect(codePrefix('positions', { unitId: 'finance' }, options)).toBe(
      'CO-FIN',
    );
    expect(codePrefix('subjects', { parentId: 'group' }, options)).toBe(
      'GROUP',
    );
    expect(codePrefix('sectors', { parentId: 'energy' }, options)).toBe(
      'ENERGY',
    );
    expect(codePrefix('regions', { parentId: 'cn' }, options)).toBe('CN');
  });

  it('does not give relations a parent prefix', () => {
    expect(
      codePrefix(
        'relations',
        { sourceId: 'group', targetId: 'company' },
        options,
      ),
    ).toBe('');
  });

  it('prefills a new code with the parent prefix', () => {
    expect(
      initialCode('positions', { unitId: 'finance', code: '' }, options),
    ).toBe('CO-FIN-');
    expect(initialCode('subjects', { parentId: '', code: '' }, options)).toBe(
      '',
    );
  });

  it('rewrites the prefix when the parent changes and keeps the local code', () => {
    expect(
      reparentCode(
        'units',
        { parentId: '', subjectId: 'company', code: 'CO-' },
        { parentId: 'finance', subjectId: 'company', code: 'CO-' },
        options,
      ),
    ).toBe('CO-FIN-');
    expect(
      reparentCode(
        'units',
        { parentId: '', subjectId: 'company', code: 'CO-OPS' },
        { parentId: 'finance', subjectId: 'company', code: 'CO-OPS' },
        options,
      ),
    ).toBe('CO-FIN-OPS');
  });

  it('removes the prefix when the record becomes top level', () => {
    expect(
      reparentCode(
        'subjects',
        { parentId: 'group', code: 'GROUP-CO' },
        { parentId: '', code: 'GROUP-CO' },
        options,
      ),
    ).toBe('CO');
  });

  it('treats a legacy code as the local part when the parent changes', () => {
    expect(
      reparentCode(
        'positions',
        { unitId: '', code: 'LEGACY' },
        { unitId: 'finance', code: 'LEGACY' },
        options,
      ),
    ).toBe('CO-FIN-LEGACY');
  });
});
