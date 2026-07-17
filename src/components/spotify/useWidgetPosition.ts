import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { TargetedPointerEvent } from 'preact';
import {
  calculateDraggedWidgetPosition,
  clampWidgetPosition,
  DEFAULT_WIDGET_POSITION,
  isWidgetPosition,
  POSITION_STORAGE_KEY,
} from './widgetPosition';

interface UseWidgetPositionOptions {
  isMinimized: boolean;
  onExpandFromDrag: () => void;
}

const CLICK_MOVEMENT_THRESHOLD = 10;
const CLICK_SUPPRESSION_MS = 300;

function suppressClicks(preventClickRef: { current: boolean }) {
  preventClickRef.current = true;
  window.setTimeout(() => {
    preventClickRef.current = false;
  }, CLICK_SUPPRESSION_MS);
}

export function useWidgetPosition({
  isMinimized,
  onExpandFromDrag,
}: UseWidgetPositionOptions) {
  const widgetRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(DEFAULT_WIDGET_POSITION);
  const [isDragging, setIsDragging] = useState(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const initialPointerRef = useRef({ x: 0, y: 0 });
  const positionRef = useRef(position);
  const rAFRef = useRef<number | null>(null);
  const totalMovementRef = useRef(0);
  const preventClickRef = useRef(false);

  useEffect(() => {
    positionRef.current = position;
  }, [position]);

  useEffect(() => {
    // Reading localStorage can throw when storage is blocked (private mode,
    // hardened settings). Never let that crash the whole widget island.
    let savedPosition: string | null = null;
    try {
      savedPosition = localStorage.getItem(POSITION_STORAGE_KEY);
    } catch {
      /* Storage unavailable — fall back to the default position. */
    }
    if (savedPosition) {
      try {
        const parsed: unknown = JSON.parse(savedPosition);
        if (isWidgetPosition(parsed)) {
          const next = clampWidgetPosition(parsed, {
            width: window.innerWidth,
            height: window.innerHeight,
          });
          setPosition(next);
          positionRef.current = next;
        }
      } catch {
        /* Ignore invalid localStorage data. */
      }
    } else {
      setPosition((previous) =>
        clampWidgetPosition(previous, {
          width: window.innerWidth,
          height: window.innerHeight,
        }),
      );
    }

    const handleResize = () => {
      setPosition((previous) => {
        const next = clampWidgetPosition(previous, {
          width: window.innerWidth,
          height: window.innerHeight,
        });
        positionRef.current = next;
        return next;
      });
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handlePointerDown = useCallback(
    (event: TargetedPointerEvent<HTMLElement>) => {
      if ((event.target as HTMLElement).closest('.action-btn')) return;

      const currentTarget = event.currentTarget as HTMLElement;
      if (event.pointerType === 'touch') {
        currentTarget.setPointerCapture(event.pointerId);
      }

      const rect = currentTarget.getBoundingClientRect();
      setIsDragging(true);
      totalMovementRef.current = 0;
      dragOffsetRef.current = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      initialPointerRef.current = { x: event.clientX, y: event.clientY };
    },
    [],
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMove = (event: PointerEvent) => {
      if (rAFRef.current) return;

      rAFRef.current = requestAnimationFrame(() => {
        rAFRef.current = null;

        const deltaX = Math.abs(event.clientX - initialPointerRef.current.x);
        const deltaY = Math.abs(event.clientY - initialPointerRef.current.y);
        totalMovementRef.current = deltaX + deltaY;

        const rect = widgetRef.current?.getBoundingClientRect();
        if (!rect) return;

        const next = calculateDraggedWidgetPosition(
          {
            clientX: event.clientX,
            clientY: event.clientY,
            dragOffsetX: dragOffsetRef.current.x,
            dragOffsetY: dragOffsetRef.current.y,
          },
          {
            width: rect.width,
            height: rect.height,
          },
          {
            width: window.innerWidth,
            height: window.innerHeight,
          },
        );

        positionRef.current = next;
        setPosition(next);
      });
    };

    const handleUp = () => {
      setIsDragging(false);
      if (rAFRef.current) cancelAnimationFrame(rAFRef.current);
      rAFRef.current = null;

      try {
        localStorage.setItem(
          POSITION_STORAGE_KEY,
          JSON.stringify(positionRef.current),
        );
      } catch {
        /* Ignore storage failures — the position just won't persist. */
      }

      const totalMovement = totalMovementRef.current;
      if (totalMovement < CLICK_MOVEMENT_THRESHOLD && isMinimized) {
        onExpandFromDrag();
        suppressClicks(preventClickRef);
      } else if (totalMovement >= CLICK_MOVEMENT_THRESHOLD) {
        suppressClicks(preventClickRef);
      }
    };

    window.addEventListener('pointermove', handleMove, { passive: true });
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);

    return () => {
      if (rAFRef.current) cancelAnimationFrame(rAFRef.current);
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [isDragging, isMinimized, onExpandFromDrag]);

  const nudgeBy = useCallback((deltaX: number, deltaY: number) => {
    setPosition((current) => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      // `offset*` is measured from the anchored edge, so a right/bottom anchor
      // grows the offset in the opposite direction to the visual nudge. Flip the
      // delta for those edges so arrow keys always move the widget the way they
      // point — otherwise ArrowDown moves the default (bottom-anchored) widget up.
      const directionX = current.edgeX === 'right' ? -1 : 1;
      const directionY = current.edgeY === 'bottom' ? -1 : 1;
      const next = clampWidgetPosition(
        {
          ...current,
          offsetX: current.offsetX + deltaX * directionX,
          offsetY: current.offsetY + deltaY * directionY,
        },
        { width, height },
      );
      positionRef.current = next;
      try {
        localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* Ignore storage failures. */
      }
      return next;
    });
  }, []);

  const resetPosition = useCallback(() => {
    const next = clampWidgetPosition(DEFAULT_WIDGET_POSITION, {
      width: window.innerWidth,
      height: window.innerHeight,
    });
    positionRef.current = next;
    setPosition(next);
    try {
      localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* Ignore storage failures. */
    }
  }, []);

  return {
    handlePointerDown,
    isDragging,
    nudgeBy,
    preventClickRef,
    position,
    resetPosition,
    widgetRef,
  };
}
