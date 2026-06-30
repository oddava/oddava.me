import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

type HorizontalEdge = 'left' | 'right';
type VerticalEdge = 'top' | 'bottom';

interface WidgetPosition {
  edgeX: HorizontalEdge;
  edgeY: VerticalEdge;
  offsetX: number;
  offsetY: number;
}

interface UseWidgetPositionOptions {
  isMinimized: boolean;
  onExpandFromDrag: () => void;
}

const POSITION_STORAGE_KEY = 'spotify-widget-pos-v2';
const DEFAULT_POSITION: WidgetPosition = {
  edgeX: 'left',
  edgeY: 'bottom',
  offsetX: 32,
  offsetY: 32,
};
const VIEWPORT_PADDING = 16;
const OFFSCREEN_BUFFER = 60;
const CLICK_MOVEMENT_THRESHOLD = 10;
const CLICK_SUPPRESSION_MS = 300;

function isWidgetPosition(value: unknown): value is WidgetPosition {
  const position = value as WidgetPosition;
  return (
    position?.edgeX &&
    position?.edgeY &&
    (position.edgeX === 'left' || position.edgeX === 'right') &&
    (position.edgeY === 'top' || position.edgeY === 'bottom') &&
    typeof position.offsetX === 'number' &&
    typeof position.offsetY === 'number'
  );
}

function clampPosition(position: WidgetPosition): WidgetPosition {
  return {
    ...position,
    offsetX:
      position.offsetX > window.innerWidth - OFFSCREEN_BUFFER
        ? VIEWPORT_PADDING
        : position.offsetX,
    offsetY:
      position.offsetY > window.innerHeight - OFFSCREEN_BUFFER
        ? VIEWPORT_PADDING
        : position.offsetY,
  };
}

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
  const [position, setPosition] = useState<WidgetPosition>(DEFAULT_POSITION);
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
    const savedPosition = localStorage.getItem(POSITION_STORAGE_KEY);
    if (savedPosition) {
      try {
        const parsed: unknown = JSON.parse(savedPosition);
        if (isWidgetPosition(parsed)) {
          const next = clampPosition(parsed);
          setPosition(next);
          positionRef.current = next;
        }
      } catch {
        /* Ignore invalid localStorage data. */
      }
    } else {
      setPosition((previous) => clampPosition(previous));
    }

    const handleResize = () => {
      setPosition((previous) => {
        const next = clampPosition(previous);
        positionRef.current = next;
        return next;
      });
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
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

        const maxLeft = window.innerWidth - rect.width - VIEWPORT_PADDING;
        const maxTop = window.innerHeight - rect.height - VIEWPORT_PADDING;
        const left = Math.max(
          VIEWPORT_PADDING,
          Math.min(event.clientX - dragOffsetRef.current.x, maxLeft),
        );
        const top = Math.max(
          VIEWPORT_PADDING,
          Math.min(event.clientY - dragOffsetRef.current.y, maxTop),
        );
        const centerX = left + rect.width / 2;
        const centerY = top + rect.height / 2;
        const edgeX: HorizontalEdge =
          centerX > window.innerWidth / 2 ? 'right' : 'left';
        const edgeY: VerticalEdge =
          centerY > window.innerHeight / 2 ? 'bottom' : 'top';
        const next: WidgetPosition = {
          edgeX,
          edgeY,
          offsetX:
            edgeX === 'left' ? left : window.innerWidth - (left + rect.width),
          offsetY:
            edgeY === 'top' ? top : window.innerHeight - (top + rect.height),
        };

        positionRef.current = next;
        setPosition(next);
      });
    };

    const handleUp = () => {
      setIsDragging(false);
      if (rAFRef.current) cancelAnimationFrame(rAFRef.current);
      rAFRef.current = null;

      localStorage.setItem(
        POSITION_STORAGE_KEY,
        JSON.stringify(positionRef.current),
      );

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

  return {
    handlePointerDown,
    isDragging,
    position,
    preventClickRef,
    widgetRef,
  };
}
