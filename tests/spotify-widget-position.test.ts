import { describe, expect, it } from 'vitest';
import { resolveInitialMinimized } from '../src/components/spotify/minimizedState';
import {
  calculateDraggedWidgetPosition,
  clampWidgetPosition,
  isWidgetPosition,
} from '../src/components/spotify/widgetPosition';

describe('Spotify widget position helpers', () => {
  it('accepts only finite persisted widget positions', () => {
    expect(
      isWidgetPosition({
        edgeX: 'left',
        edgeY: 'top',
        offsetX: 24,
        offsetY: 32,
      }),
    ).toBe(true);
    expect(
      isWidgetPosition({
        edgeX: 'middle',
        edgeY: 'top',
        offsetX: 24,
        offsetY: 32,
      }),
    ).toBe(false);
    expect(
      isWidgetPosition({
        edgeX: 'left',
        edgeY: 'top',
        offsetX: Number.POSITIVE_INFINITY,
        offsetY: 32,
      }),
    ).toBe(false);
  });

  it('moves persisted positions back onscreen when the viewport shrinks', () => {
    expect(
      clampWidgetPosition(
        {
          edgeX: 'right',
          edgeY: 'bottom',
          offsetX: 400,
          offsetY: 240,
        },
        {
          width: 320,
          height: 240,
        },
      ),
    ).toEqual({
      edgeX: 'right',
      edgeY: 'bottom',
      offsetX: 16,
      offsetY: 16,
    });
  });

  it('calculates left/top anchored drag positions', () => {
    expect(
      calculateDraggedWidgetPosition(
        {
          clientX: 120,
          clientY: 110,
          dragOffsetX: 20,
          dragOffsetY: 10,
        },
        {
          width: 200,
          height: 100,
        },
        {
          width: 1000,
          height: 800,
        },
      ),
    ).toEqual({
      edgeX: 'left',
      edgeY: 'top',
      offsetX: 100,
      offsetY: 100,
    });
  });

  it('calculates right/bottom anchored drag positions', () => {
    expect(
      calculateDraggedWidgetPosition(
        {
          clientX: 750,
          clientY: 500,
          dragOffsetX: 50,
          dragOffsetY: 50,
        },
        {
          width: 100,
          height: 100,
        },
        {
          width: 1000,
          height: 800,
        },
      ),
    ).toEqual({
      edgeX: 'right',
      edgeY: 'bottom',
      offsetX: 200,
      offsetY: 250,
    });
  });

  it('keeps dragged widgets inside the padded viewport', () => {
    expect(
      calculateDraggedWidgetPosition(
        {
          clientX: 900,
          clientY: 720,
          dragOffsetX: 20,
          dragOffsetY: 20,
        },
        {
          width: 200,
          height: 100,
        },
        {
          width: 1000,
          height: 800,
        },
      ),
    ).toEqual({
      edgeX: 'right',
      edgeY: 'bottom',
      offsetX: 16,
      offsetY: 16,
    });
  });
});

describe('Spotify widget initial minimized state', () => {
  it('honors a stored minimized preference on any viewport', () => {
    expect(resolveInitialMinimized('true', false)).toBe(true);
    expect(resolveInitialMinimized('true', true)).toBe(true);
  });

  it('honors a stored expanded preference even on small viewports', () => {
    expect(resolveInitialMinimized('false', true)).toBe(false);
  });

  it('defaults to minimized on small viewports without a preference', () => {
    expect(resolveInitialMinimized(null, true)).toBe(true);
  });

  it('defaults to expanded on large viewports without a preference', () => {
    expect(resolveInitialMinimized(null, false)).toBe(false);
  });

  it('treats corrupted stored values as no preference', () => {
    expect(resolveInitialMinimized('garbage', true)).toBe(true);
    expect(resolveInitialMinimized('garbage', false)).toBe(false);
  });
});
