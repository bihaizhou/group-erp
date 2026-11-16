import { fireEvent, render, screen } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LAUNCHER_STORAGE_KEY } from '../../client/agents/launcher-position';
import { useLauncherDrag } from '../../client/agents/use-launcher-drag';

function Harness(): ReactElement {
  const [opened, setOpened] = useState(0);
  const { dragging, launcherProps } = useLauncherDrag(() =>
    setOpened((count) => count + 1),
  );

  return (
    <>
      <button type='button' data-testid='launcher' {...launcherProps}>
        chat
      </button>
      <output data-testid='opened'>{opened}</output>
      <output data-testid='dragging'>{String(dragging)}</output>
    </>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal('innerWidth', 1440);
  vi.stubGlobal('innerHeight', 900);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('draggable chat launcher', () => {
  it('opens when activated without moving', () => {
    render(<Harness />);
    const launcher = screen.getByTestId('launcher');

    expect(launcher).toHaveStyle({ left: '1368px', top: '828px' });
    fireEvent.click(launcher);

    expect(screen.getByTestId('opened')).toHaveTextContent('1');
  });

  it('measures the layout viewport instead of the scrollbar-wide window', () => {
    const width = vi
      .spyOn(document.documentElement, 'clientWidth', 'get')
      .mockReturnValue(1400);
    const height = vi
      .spyOn(document.documentElement, 'clientHeight', 'get')
      .mockReturnValue(880);

    render(<Harness />);

    expect(screen.getByTestId('launcher')).toHaveStyle({
      left: '1328px',
      top: '808px',
    });
    width.mockRestore();
    height.mockRestore();
  });

  it('follows the pointer, ignores the click that ends a drag, and remembers the place', () => {
    const first = render(<Harness />);
    const launcher = screen.getByTestId('launcher');

    fireEvent.pointerDown(launcher, {
      pointerId: 7,
      button: 0,
      clientX: 1400,
      clientY: 800,
    });
    fireEvent.pointerMove(launcher, {
      pointerId: 7,
      clientX: 1200,
      clientY: 700,
    });

    expect(screen.getByTestId('dragging')).toHaveTextContent('true');
    expect(launcher).toHaveStyle({ left: '1168px', top: '728px' });

    fireEvent.pointerUp(launcher, {
      pointerId: 7,
      button: 0,
      clientX: 1200,
      clientY: 700,
    });
    fireEvent.click(launcher);

    expect(screen.getByTestId('opened')).toHaveTextContent('0');
    expect(
      JSON.parse(
        window.localStorage.getItem(LAUNCHER_STORAGE_KEY) ?? 'null',
      ) as unknown,
    ).toEqual({ left: 1168, top: 728 });

    first.unmount();
    render(<Harness />);
    expect(screen.getByTestId('launcher')).toHaveStyle({
      left: '1168px',
      top: '728px',
    });
  });

  it('stops at the viewport edge while dragging', () => {
    render(<Harness />);
    const launcher = screen.getByTestId('launcher');

    fireEvent.pointerDown(launcher, {
      pointerId: 3,
      button: 0,
      clientX: 1400,
      clientY: 800,
    });
    fireEvent.pointerMove(launcher, {
      pointerId: 3,
      clientX: 5000,
      clientY: 5000,
    });

    expect(launcher).toHaveStyle({ left: '1384px', top: '844px' });

    fireEvent.pointerUp(launcher, {
      pointerId: 3,
      button: 0,
      clientX: 5000,
      clientY: 5000,
    });
    fireEvent.click(launcher);
    expect(screen.getByTestId('opened')).toHaveTextContent('0');
  });

  it('pulls a place back on screen when the window shrinks', () => {
    render(<Harness />);
    const launcher = screen.getByTestId('launcher');
    expect(launcher).toHaveStyle({ left: '1368px', top: '828px' });

    vi.stubGlobal('innerWidth', 400);
    vi.stubGlobal('innerHeight', 300);
    fireEvent(window, new Event('resize'));

    expect(launcher).toHaveStyle({ left: '344px', top: '244px' });
  });
});
