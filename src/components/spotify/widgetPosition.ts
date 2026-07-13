type HorizontalEdge = 'left' | 'right';
type VerticalEdge = 'top' | 'bottom';

export interface WidgetPosition {
  edgeX: HorizontalEdge;
  edgeY: VerticalEdge;
  offsetX: number;
  offsetY: number;
}

export interface ViewportBounds {
  width: number;
  height: number;
}

export interface WidgetSize {
  width: number;
  height: number;
}

export interface PointerDragState {
  clientX: number;
  clientY: number;
  dragOffsetX: number;
  dragOffsetY: number;
}

export const POSITION_STORAGE_KEY = 'spotify-widget-pos-v2';
export const DEFAULT_WIDGET_POSITION: WidgetPosition = {
  edgeX: 'left',
  edgeY: 'bottom',
  offsetX: 32,
  offsetY: 32,
};

const VIEWPORT_PADDING = 16;
const OFFSCREEN_BUFFER = 60;

export function isWidgetPosition(value: unknown): value is WidgetPosition {
  if (!value || typeof value !== 'object') return false;
  const position = value as Partial<WidgetPosition>;
  return (
    (position.edgeX === 'left' || position.edgeX === 'right') &&
    (position.edgeY === 'top' || position.edgeY === 'bottom') &&
    typeof position.offsetX === 'number' &&
    Number.isFinite(position.offsetX) &&
    typeof position.offsetY === 'number' &&
    Number.isFinite(position.offsetY)
  );
}

export function clampWidgetPosition(
  position: WidgetPosition,
  viewport: ViewportBounds,
): WidgetPosition {
  return {
    ...position,
    offsetX:
      position.offsetX > viewport.width - OFFSCREEN_BUFFER
        ? VIEWPORT_PADDING
        : position.offsetX,
    offsetY:
      position.offsetY > viewport.height - OFFSCREEN_BUFFER
        ? VIEWPORT_PADDING
        : position.offsetY,
  };
}

export function calculateDraggedWidgetPosition(
  pointer: PointerDragState,
  widget: WidgetSize,
  viewport: ViewportBounds,
): WidgetPosition {
  const maxLeft = viewport.width - widget.width - VIEWPORT_PADDING;
  const maxTop = viewport.height - widget.height - VIEWPORT_PADDING;
  const left = Math.max(
    VIEWPORT_PADDING,
    Math.min(pointer.clientX - pointer.dragOffsetX, maxLeft),
  );
  const top = Math.max(
    VIEWPORT_PADDING,
    Math.min(pointer.clientY - pointer.dragOffsetY, maxTop),
  );
  const centerX = left + widget.width / 2;
  const centerY = top + widget.height / 2;
  const edgeX: HorizontalEdge = centerX > viewport.width / 2 ? 'right' : 'left';
  const edgeY: VerticalEdge = centerY > viewport.height / 2 ? 'bottom' : 'top';

  return {
    edgeX,
    edgeY,
    offsetX: edgeX === 'left' ? left : viewport.width - (left + widget.width),
    offsetY: edgeY === 'top' ? top : viewport.height - (top + widget.height),
  };
}
