import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEventHandler,
  type PointerEventHandler,
} from 'react';

import {
  chatWindowOffset,
  clampLauncherPosition,
  defaultLauncherPosition,
  readLauncherPosition,
  writeLauncherPosition,
  type ChatWindowOffset,
  type LauncherPosition,
  type Viewport,
} from './launcher-position';

/** How far a press must move before it becomes a drag instead of a click. */
const DRAG_THRESHOLD = 4;

/**
 * Releasing after a drag still produces a click, because press and release share the launcher. Ignore that click for
 * a moment so dropping the launcher does not also open the chat.
 */
const CLICK_AFTER_DRAG_MS = 250;

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  originLeft: number;
  originTop: number;
  dragged: boolean;
}

export interface LauncherDrag {
  /** The launcher's place, in viewport pixels from the top-left corner. */
  readonly position: LauncherPosition;
  /** The viewport the place was clamped to; the chat window lands relative to the same one. */
  readonly viewport: Viewport;
  /** `true` while the pointer is moving the launcher. */
  readonly dragging: boolean;
  /** Inline `right`/`bottom` for the floating chat window, so it stays next to the launcher. */
  readonly chatWindow: ChatWindowOffset;
  /** Everything the launcher button needs, besides its variants and labels. */
  readonly launcherProps: {
    readonly style: CSSProperties;
    readonly onPointerDown: PointerEventHandler<HTMLElement>;
    readonly onPointerMove: PointerEventHandler<HTMLElement>;
    readonly onPointerUp: PointerEventHandler<HTMLElement>;
    readonly onPointerCancel: PointerEventHandler<HTMLElement>;
    readonly onClick: MouseEventHandler<HTMLElement>;
  };
}

function currentViewport(): Viewport {
  if (typeof window === 'undefined') return { width: 0, height: 0 };
  // Fixed positioning is measured against the layout viewport, which excludes
  // scrollbars, while `innerWidth`/`innerHeight` include them. `clientWidth` keeps
  // the resting place exactly at `right-6 bottom-6`; jsdom reports 0, so fall back.
  const root = document.documentElement;
  return {
    width: root.clientWidth || window.innerWidth,
    height: root.clientHeight || window.innerHeight,
  };
}

/** Reading `localStorage` itself throws in some privacy modes; the launcher works without persistence. */
function browserStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Drag behavior for the floating chat launcher: pointer events move it, the place survives page loads, and the click
 * that ends a drag does not open the chat. The button stays a normal button, so Enter, Space and the panel's own
 * controls behave as before.
 */
export function useLauncherDrag(onActivate: () => void): LauncherDrag {
  const [viewport, setViewport] = useState<Viewport>(currentViewport);
  const [position, setPosition] = useState<LauncherPosition>(() => {
    const initial = currentViewport();
    return (
      readLauncherPosition(browserStorage(), initial) ??
      defaultLauncherPosition(initial)
    );
  });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);
  const suppressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A smaller window must not leave the launcher, or the window it opens, off-screen.
  useEffect(() => {
    const onResize = (): void => {
      const next = currentViewport();
      setViewport(next);
      setPosition((current) => {
        const clamped = clampLauncherPosition(current, next);
        return clamped.left === current.left && clamped.top === current.top
          ? current
          : clamped;
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Save once the drag settles instead of on every pointer move. A resize while idle writes the clamped place too.
  useEffect(() => {
    if (dragging) return;
    writeLauncherPosition(browserStorage(), position);
  }, [dragging, position]);

  useEffect(
    () => () => {
      if (suppressTimerRef.current !== null) {
        clearTimeout(suppressTimerRef.current);
        suppressTimerRef.current = null;
      }
    },
    [],
  );

  const onPointerDown: PointerEventHandler<HTMLElement> = (event) => {
    if (event.button !== 0 || dragRef.current) return;

    if (suppressTimerRef.current !== null) {
      clearTimeout(suppressTimerRef.current);
      suppressTimerRef.current = null;
    }
    suppressClickRef.current = false;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originLeft: position.left,
      originTop: position.top,
      dragged: false,
    };

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // jsdom and a few embedded browsers do not implement pointer capture; moving with the pointer still works when
      // the pointer stays over the button, and releasing outside it simply ends in pointercancel.
    }
  };

  const onPointerMove: PointerEventHandler<HTMLElement> = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (!drag.dragged) {
      if (Math.hypot(deltaX, deltaY) < DRAG_THRESHOLD) return;
      drag.dragged = true;
      setDragging(true);
    }

    const next = clampLauncherPosition(
      {
        left: drag.originLeft + deltaX,
        top: drag.originTop + deltaY,
      },
      viewport,
    );
    setPosition((current) =>
      current.left === next.left && current.top === next.top ? current : next,
    );
  };

  const onPointerUp: PointerEventHandler<HTMLElement> = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Nothing was captured (see onPointerDown); there is nothing to release.
    }
    setDragging(false);

    if (!drag.dragged) return;
    suppressClickRef.current = true;
    if (suppressTimerRef.current !== null)
      clearTimeout(suppressTimerRef.current);
    suppressTimerRef.current = setTimeout(() => {
      suppressClickRef.current = false;
      suppressTimerRef.current = null;
    }, CLICK_AFTER_DRAG_MS);
  };

  const onPointerCancel: PointerEventHandler<HTMLElement> = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
  };

  const onClick: MouseEventHandler<HTMLElement> = (event) => {
    if (suppressClickRef.current) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onActivate();
  };

  return {
    position,
    viewport,
    dragging,
    chatWindow: chatWindowOffset(position, viewport),
    launcherProps: {
      style: {
        left: `${position.left}px`,
        top: `${position.top}px`,
        touchAction: 'none',
        cursor: dragging ? 'grabbing' : 'grab',
      },
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onClick,
    },
  };
}
