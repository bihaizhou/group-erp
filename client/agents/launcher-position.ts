/**
 * Geometry for the floating agent chat launcher.
 *
 * The launcher floats above the page instead of sitting in it, so its place is a pair of viewport coordinates from
 * the top-left corner. A drag is then only a pointer delta added to those coordinates, and the chat window can be
 * anchored to the same point. Everything here is pure so the clamping and persistence rules are testable without a
 * browser.
 */

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

export interface LauncherPosition {
  readonly left: number;
  readonly top: number;
}

export interface ChatWindowOffset {
  readonly right: number;
  readonly bottom: number;
}

export const LAUNCHER_SIZE = 48;

/** The resting distance from the bottom-right corner, matching the `right-6 bottom-6` the launcher shipped with. */
export const LAUNCHER_INSET = 24;

/** How close the launcher, and the window it opens, may get to a viewport edge. */
export const LAUNCHER_MARGIN = 8;

/** The launcher's saved place is a browser-local detail, not application data. */
export const LAUNCHER_STORAGE_KEY = 'group-erp.agent-chat-launcher';

// These mirror the chat window's classes in floating-chat.tsx (`w-[22rem]`, `2xl:w-[26.25rem]`,
// `h-[min(40rem,calc(100dvh-7rem))]`); change them together.
const CHAT_WINDOW_WIDTH = 352;
const CHAT_WINDOW_WIDE_WIDTH = 420;
const CHAT_WINDOW_MAX_HEIGHT = 640;
const CHAT_WINDOW_INSET = 112;
const CHAT_WINDOW_WIDE_FROM = 1536;
const CHAT_WINDOW_MARGIN = 8;

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(Math.max(value, minimum), maximum);

/** The largest `left` and `top` that still leave the whole launcher inside the viewport. */
export function launcherBounds(viewport: Viewport): LauncherPosition {
  return {
    left: Math.max(
      LAUNCHER_MARGIN,
      viewport.width - LAUNCHER_SIZE - LAUNCHER_MARGIN,
    ),
    top: Math.max(
      LAUNCHER_MARGIN,
      viewport.height - LAUNCHER_SIZE - LAUNCHER_MARGIN,
    ),
  };
}

/** Round a position to whole pixels and keep it inside the viewport. */
export function clampLauncherPosition(
  position: LauncherPosition,
  viewport: Viewport,
): LauncherPosition {
  const bounds = launcherBounds(viewport);
  return {
    left: clamp(Math.round(position.left), LAUNCHER_MARGIN, bounds.left),
    top: clamp(Math.round(position.top), LAUNCHER_MARGIN, bounds.top),
  };
}

/** The bottom-right resting place: `right-6 bottom-6`, expressed from the top-left corner. */
export function defaultLauncherPosition(viewport: Viewport): LauncherPosition {
  return clampLauncherPosition(
    {
      left: viewport.width - LAUNCHER_SIZE - LAUNCHER_INSET,
      top: viewport.height - LAUNCHER_SIZE - LAUNCHER_INSET,
    },
    viewport,
  );
}

function isPosition(value: unknown): value is LauncherPosition {
  if (typeof value !== 'object' || value === null) return false;
  const { left, top } = value as { left?: unknown; top?: unknown };
  return (
    typeof left === 'number' &&
    Number.isFinite(left) &&
    typeof top === 'number' &&
    Number.isFinite(top)
  );
}

/**
 * The stored place, or `null` when there is none or it cannot be read. Stored coordinates are clamped to the current
 * viewport, so a place saved on a large screen still lands on a smaller one.
 */
export function readLauncherPosition(
  storage: Pick<Storage, 'getItem'> | null | undefined,
  viewport: Viewport,
): LauncherPosition | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(LAUNCHER_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isPosition(parsed) ? clampLauncherPosition(parsed, viewport) : null;
  } catch {
    return null;
  }
}

/** Save the place; storage being full or disabled must not break dragging. */
export function writeLauncherPosition(
  storage: Pick<Storage, 'setItem'> | null | undefined,
  position: LauncherPosition,
): void {
  if (!storage) return;
  try {
    storage.setItem(
      LAUNCHER_STORAGE_KEY,
      JSON.stringify({
        left: Math.round(position.left),
        top: Math.round(position.top),
      }),
    );
  } catch {
    // A browser may refuse storage (private mode, quota); the launcher still moves for this page.
  }
}

/**
 * Where the floating chat window goes so that its bottom-right corner meets the launcher's. The window is larger
 * than the launcher, so near the top or left edge it is held `CHAT_WINDOW_MARGIN` from the viewport instead.
 */
export function chatWindowOffset(
  position: LauncherPosition,
  viewport: Viewport,
): ChatWindowOffset {
  const width =
    viewport.width >= CHAT_WINDOW_WIDE_FROM
      ? CHAT_WINDOW_WIDE_WIDTH
      : CHAT_WINDOW_WIDTH;
  const height = Math.max(
    0,
    Math.min(CHAT_WINDOW_MAX_HEIGHT, viewport.height - CHAT_WINDOW_INSET),
  );
  const maxRight = Math.max(
    CHAT_WINDOW_MARGIN,
    viewport.width - width - CHAT_WINDOW_MARGIN,
  );
  const maxBottom = Math.max(
    CHAT_WINDOW_MARGIN,
    viewport.height - height - CHAT_WINDOW_MARGIN,
  );
  return {
    right: clamp(
      viewport.width - position.left - LAUNCHER_SIZE,
      CHAT_WINDOW_MARGIN,
      maxRight,
    ),
    bottom: clamp(
      viewport.height - position.top - LAUNCHER_SIZE,
      CHAT_WINDOW_MARGIN,
      maxBottom,
    ),
  };
}
