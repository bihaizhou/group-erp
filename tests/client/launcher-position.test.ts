import { describe, expect, it } from 'vitest';

import {
  LAUNCHER_STORAGE_KEY,
  chatWindowOffset,
  clampLauncherPosition,
  defaultLauncherPosition,
  readLauncherPosition,
  writeLauncherPosition,
} from '../../client/agents/launcher-position';

const viewport = { width: 1440, height: 900 };

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe('launcher position', () => {
  it('rests at the old bottom-right corner and stays inside the viewport', () => {
    expect(defaultLauncherPosition(viewport)).toEqual({ left: 1368, top: 828 });
    expect(clampLauncherPosition({ left: -10, top: 2000 }, viewport)).toEqual({
      left: 8,
      top: 844,
    });
    expect(clampLauncherPosition({ left: 9999, top: -9999 }, viewport)).toEqual(
      { left: 1384, top: 8 },
    );
  });

  it('saves a place and clamps a stale one to the current viewport', () => {
    const storage = memoryStorage();
    expect(readLauncherPosition(storage, viewport)).toBeNull();

    writeLauncherPosition(storage, { left: 120, top: 340 });
    expect(storage.values.get(LAUNCHER_STORAGE_KEY)).toBe(
      '{"left":120,"top":340}',
    );
    expect(readLauncherPosition(storage, viewport)).toEqual({
      left: 120,
      top: 340,
    });

    storage.values.set(
      LAUNCHER_STORAGE_KEY,
      JSON.stringify({ left: 9999, top: 9999 }),
    );
    expect(readLauncherPosition(storage, viewport)).toEqual({
      left: 1384,
      top: 844,
    });
  });

  it('ignores unreadable or unavailable storage', () => {
    const storage = memoryStorage();
    for (const raw of [
      '',
      'not json',
      'null',
      '[]',
      '{"left":"1","top":2}',
      '{"left":1}',
    ]) {
      storage.values.set(LAUNCHER_STORAGE_KEY, raw);
      expect(readLauncherPosition(storage, viewport)).toBeNull();
    }

    expect(
      readLauncherPosition(
        {
          getItem: () => {
            throw new Error('blocked');
          },
        },
        viewport,
      ),
    ).toBeNull();
    expect(() =>
      writeLauncherPosition(
        {
          setItem: () => {
            throw new Error('full');
          },
        },
        { left: 1, top: 2 },
      ),
    ).not.toThrow();
  });

  it('opens the chat window beside the launcher and keeps it on screen', () => {
    expect(
      chatWindowOffset(defaultLauncherPosition(viewport), viewport),
    ).toEqual({ right: 24, bottom: 24 });
    expect(chatWindowOffset({ left: 8, top: 8 }, viewport)).toEqual({
      right: 1080,
      bottom: 252,
    });

    const wide = { width: 1536, height: 900 };
    expect(chatWindowOffset(defaultLauncherPosition(wide), wide)).toEqual({
      right: 24,
      bottom: 24,
    });
    expect(chatWindowOffset({ left: 8, top: 8 }, wide)).toEqual({
      right: 1108,
      bottom: 252,
    });

    const small = { width: 768, height: 600 };
    expect(chatWindowOffset({ left: 8, top: 8 }, small)).toEqual({
      right: 408,
      bottom: 104,
    });
  });
});
