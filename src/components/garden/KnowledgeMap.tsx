import type {
  TargetedInputEvent,
  TargetedKeyboardEvent,
  TargetedPointerEvent,
  TargetedWheelEvent,
} from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  ATLAS_VIEW_HEIGHT,
  ATLAS_VIEW_WIDTH,
  ATLAS_WORLD_HEIGHT,
  ATLAS_WORLD_WIDTH,
  atlasConnectionPath,
  createAtlasLayout,
  type AtlasPoint,
} from '@lib/garden/atlas-layout';

export type KnowledgeMapNode = {
  id: string;
  title: string;
  summary: string;
  href: string;
  parentId: string | null;
  childIds: string[];
  tags: string[];
  featured: boolean;
  degree: number;
  outboundCount: number;
};

export type KnowledgeMapEdge = {
  sourceId: string;
  targetId: string;
  kind: 'branch' | 'reference' | 'affinity';
};

type Props = {
  nodes: KnowledgeMapNode[];
  edges: KnowledgeMapEdge[];
};

type Camera = {
  x: number;
  y: number;
  scale: number;
};

type GesturePointer = {
  clientX: number;
  clientY: number;
  viewX: number;
  viewY: number;
};

type Gesture = {
  pointers: Map<number, GesturePointer>;
  startCamera: Camera;
  startCenter: { x: number; y: number };
  anchorWorld: { x: number; y: number };
  startDistance: number;
  pressedNodeId: string | null;
  moved: boolean;
  hadPinch: boolean;
  lastCenter: { x: number; y: number };
  lastTime: number;
  velocityX: number;
  velocityY: number;
};

const FIT_SCALE = Math.min(
  (ATLAS_VIEW_WIDTH - 18) / ATLAS_WORLD_WIDTH,
  (ATLAS_VIEW_HEIGHT - 18) / ATLAS_WORLD_HEIGHT,
);
const OVERVIEW_CAMERA: Camera = {
  x: (ATLAS_VIEW_WIDTH - ATLAS_WORLD_WIDTH * FIT_SCALE) / 2,
  y: (ATLAS_VIEW_HEIGHT - ATLAS_WORLD_HEIGHT * FIT_SCALE) / 2,
  scale: FIT_SCALE,
};
const MIN_SCALE = FIT_SCALE * 0.86;
const MAX_SCALE = 2.05;
const CAMERA_CENTER = { x: ATLAS_VIEW_WIDTH / 2, y: ATLAS_VIEW_HEIGHT / 2 };

const TONE_COUNT = 5;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function connectionKey(edge: KnowledgeMapEdge): string {
  return [edge.sourceId, edge.targetId].toSorted().join('::');
}

function constrainCamera(camera: Camera): Camera {
  const scale = clamp(camera.scale, MIN_SCALE, MAX_SCALE);
  const scaledWidth = ATLAS_WORLD_WIDTH * scale;
  const scaledHeight = ATLAS_WORLD_HEIGHT * scale;
  const breathingRoom = 86;
  const x =
    scaledWidth <= ATLAS_VIEW_WIDTH - breathingRoom
      ? (ATLAS_VIEW_WIDTH - scaledWidth) / 2
      : clamp(
          camera.x,
          ATLAS_VIEW_WIDTH - scaledWidth - breathingRoom,
          breathingRoom,
        );
  const y =
    scaledHeight <= ATLAS_VIEW_HEIGHT - breathingRoom
      ? (ATLAS_VIEW_HEIGHT - scaledHeight) / 2
      : clamp(
          camera.y,
          ATLAS_VIEW_HEIGHT - scaledHeight - breathingRoom,
          breathingRoom,
        );
  return { x, y, scale };
}

function searchScore(node: KnowledgeMapNode, query: string): number {
  if (!query) return 1;
  const title = node.title.toLowerCase();
  const summary = node.summary.toLowerCase();
  const tags = node.tags.join(' ').toLowerCase();
  if (title === query) return 100;
  if (title.startsWith(query)) return 80;
  if (title.includes(query)) return 60;
  if (tags.includes(query)) return 35;
  if (summary.includes(query)) return 20;
  return 0;
}

function pointerCenter(pointers: Map<number, GesturePointer>): {
  x: number;
  y: number;
} {
  const values = [...pointers.values()];
  return {
    x:
      values.reduce((total, pointer) => total + pointer.viewX, 0) /
      values.length,
    y:
      values.reduce((total, pointer) => total + pointer.viewY, 0) /
      values.length,
  };
}

function pointerDistance(pointers: Map<number, GesturePointer>): number {
  const [first, second] = [...pointers.values()];
  if (!first || !second) return 1;
  return Math.max(
    Math.hypot(first.viewX - second.viewX, first.viewY - second.viewY),
    1,
  );
}

function nearestInDirection(
  current: AtlasPoint<KnowledgeMapNode>,
  points: AtlasPoint<KnowledgeMapNode>[],
  key: string,
): AtlasPoint<KnowledgeMapNode> | undefined {
  const vector =
    key === 'ArrowLeft'
      ? { x: -1, y: 0 }
      : key === 'ArrowRight'
        ? { x: 1, y: 0 }
        : key === 'ArrowUp'
          ? { x: 0, y: -1 }
          : { x: 0, y: 1 };

  return points
    .filter((point) => point.id !== current.id)
    .map((point) => {
      const dx = point.x - current.x;
      const dy = point.y - current.y;
      const forward = dx * vector.x + dy * vector.y;
      const sideways = Math.abs(dx * vector.y - dy * vector.x);
      return {
        point,
        forward,
        score: forward + sideways * 1.45,
      };
    })
    .filter((candidate) => candidate.forward > 12)
    .toSorted((left, right) => left.score - right.score)[0]?.point;
}

function CompassIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 2.75v2.5M10 14.75v2.5M2.75 10h2.5M14.75 10h2.5" />
      <path d="m12.4 7.6-1.15 3.65-3.65 1.15 1.15-3.65 3.65-1.15Z" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="8.5" cy="8.5" r="4.75" />
      <path d="m12.1 12.1 4.15 4.15" />
    </svg>
  );
}

function NodeMark({
  point,
  rootId,
}: {
  point: AtlasPoint<KnowledgeMapNode>;
  rootId: string;
}) {
  if (point.id === rootId) {
    return (
      <g className="knowledge-atlas__landmark knowledge-atlas__landmark--origin">
        <path d="M-22 0h13M9 0h13M0-22v13M0 9v13" />
        <path d="m0-7 7 7-7 7-7-7Z" />
        <path
          className="knowledge-atlas__landmark-index"
          d="M-15-15h7M-15-15v7M15 15H8M15 15V8"
        />
      </g>
    );
  }

  if (point.childIds.length > 0) {
    return (
      <g className="knowledge-atlas__landmark knowledge-atlas__landmark--gate">
        <path d="M-9 9V-9H9" />
        <path d="m0-5 5 5-5 5-5-5Z" />
        <path
          className="knowledge-atlas__landmark-index"
          d="M-13 13h6M13-13v6"
        />
      </g>
    );
  }

  return (
    <g className="knowledge-atlas__landmark knowledge-atlas__landmark--note">
      <path d="m0-5.5 5.5 5.5L0 5.5-5.5 0Z" />
      {point.featured && (
        <path className="knowledge-atlas__landmark-index" d="M-9-9h5M9 9H4" />
      )}
    </g>
  );
}

export default function KnowledgeMap({ nodes, edges }: Props) {
  const layout = useMemo(() => createAtlasLayout(nodes), [nodes]);
  const pointById = useMemo(
    () => new Map(layout.points.map((point) => [point.id, point])),
    [layout],
  );
  const nodeById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState(layout.rootId);
  const [query, setQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchIndex, setSearchIndex] = useState(0);
  const [cameraTarget, setCameraTarget] = useState<Camera>(OVERVIEW_CAMERA);
  const [zoomLevel, setZoomLevel] = useState<
    'overview' | 'neighborhood' | 'detail'
  >('overview');
  const [isPanning, setIsPanning] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const worldRef = useRef<SVGGElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchWrapRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef(OVERVIEW_CAMERA);
  const cameraTargetRef = useRef(cameraTarget);
  const zoomLevelRef = useRef(zoomLevel);
  const cameraVelocityRef = useRef({ x: 0, y: 0, scale: 0 });
  const gestureRef = useRef<Gesture | null>(null);
  const reducedMotionRef = useRef(false);

  const activeId = hoveredId ?? selectedId;
  const activePoint = activeId ? pointById.get(activeId) : undefined;
  const selectedNode = selectedId ? nodeById.get(selectedId) : undefined;
  const selectedPoint = selectedId ? pointById.get(selectedId) : undefined;
  const normalizedQuery = query.trim().toLowerCase();

  const results = useMemo(
    () =>
      nodes
        .map((node, position) => ({
          node,
          position,
          score: searchScore(node, normalizedQuery),
        }))
        .filter((result) => result.score > 0)
        .toSorted(
          (left, right) =>
            right.score - left.score || left.position - right.position,
        )
        .slice(0, 7)
        .map((result) => result.node),
    [nodes, normalizedQuery],
  );
  const resultIds = useMemo(
    () => new Set(results.map((result) => result.id)),
    [results],
  );

  const relatedIds = useMemo(() => {
    const related = new Set<string>();
    if (!activeId) return related;
    related.add(activeId);
    for (const edge of edges) {
      if (edge.sourceId === activeId) related.add(edge.targetId);
      if (edge.targetId === activeId) related.add(edge.sourceId);
    }
    return related;
  }, [activeId, edges]);

  const nearby = useMemo(() => {
    if (!selectedId) return [];
    const ids: string[] = [];
    for (const edge of edges) {
      if (edge.sourceId === selectedId) ids.push(edge.targetId);
      if (edge.targetId === selectedId) ids.push(edge.sourceId);
    }
    return [...new Set(ids)]
      .map((id) => nodeById.get(id))
      .filter((node): node is KnowledgeMapNode => Boolean(node))
      .slice(0, 5);
  }, [edges, nodeById, selectedId]);

  useEffect(() => {
    reducedMotionRef.current = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable;
      if (
        ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') ||
        (event.key === '/' && !typing)
      ) {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === 'Escape' && !searchRef.current?.matches(':focus')) {
        setSelectedId(null);
        setHoveredId(null);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    cameraTargetRef.current = cameraTarget;
    if (reducedMotionRef.current) {
      cameraVelocityRef.current = { x: 0, y: 0, scale: 0 };
      commitCamera(cameraTarget);
      return;
    }

    let frame = 0;
    let previous = performance.now();
    const tick = (now: number) => {
      const elapsed = clamp((now - previous) / 16.667, 0.45, 2.2);
      previous = now;
      const current = cameraRef.current;
      const velocity = cameraVelocityRef.current;
      const stiffness = 0.115 * elapsed;
      const damping = Math.pow(0.73, elapsed);
      velocity.x =
        (velocity.x + (cameraTarget.x - current.x) * stiffness) * damping;
      velocity.y =
        (velocity.y + (cameraTarget.y - current.y) * stiffness) * damping;
      velocity.scale =
        (velocity.scale + (cameraTarget.scale - current.scale) * stiffness) *
        damping;
      const next = {
        x: current.x + velocity.x * elapsed,
        y: current.y + velocity.y * elapsed,
        scale: current.scale + velocity.scale * elapsed,
      };
      const distance =
        Math.abs(cameraTarget.x - next.x) +
        Math.abs(cameraTarget.y - next.y) +
        Math.abs(cameraTarget.scale - next.scale) * 180;

      if (
        distance < 0.08 &&
        Math.abs(velocity.x) + Math.abs(velocity.y) < 0.04
      ) {
        cameraVelocityRef.current = { x: 0, y: 0, scale: 0 };
        commitCamera(cameraTarget);
        return;
      }

      commitCamera(next);
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [cameraTarget.x, cameraTarget.y, cameraTarget.scale]);

  useEffect(() => setSearchIndex(0), [normalizedQuery]);

  function commitCamera(next: Camera): void {
    cameraRef.current = next;
    worldRef.current?.setAttribute(
      'transform',
      `translate(${next.x} ${next.y}) scale(${next.scale})`,
    );
    const nextZoomLevel =
      next.scale < FIT_SCALE * 1.08
        ? 'overview'
        : next.scale < 1.32
          ? 'neighborhood'
          : 'detail';
    if (nextZoomLevel !== zoomLevelRef.current) {
      zoomLevelRef.current = nextZoomLevel;
      setZoomLevel(nextZoomLevel);
    }
  }

  const setTargetCamera = (next: Camera, immediate = false) => {
    const constrained = constrainCamera(next);
    cameraTargetRef.current = constrained;
    setCameraTarget(constrained);
    if (!immediate) return;
    cameraVelocityRef.current = { x: 0, y: 0, scale: 0 };
    commitCamera(constrained);
  };

  const pointFromClient = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return CAMERA_CENTER;
    const matrix = svg.getScreenCTM();
    if (!matrix) return CAMERA_CENTER;
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    return point.matrixTransform(matrix.inverse());
  };

  const zoomAt = (factor: number, center = CAMERA_CENTER) => {
    const current = cameraTargetRef.current;
    const scale = clamp(current.scale * factor, MIN_SCALE, MAX_SCALE);
    const worldX = (center.x - current.x) / current.scale;
    const worldY = (center.y - current.y) / current.scale;
    setTargetCamera({
      x: center.x - worldX * scale,
      y: center.y - worldY * scale,
      scale,
    });
  };

  const resetView = () => {
    setSelectedId(null);
    setHoveredId(null);
    setTargetCamera(OVERVIEW_CAMERA);
  };

  const focusPoint = (point: AtlasPoint<KnowledgeMapNode>, scale = 1.12) => {
    setTargetCamera({
      x: ATLAS_VIEW_WIDTH * 0.5 - point.x * scale,
      y: ATLAS_VIEW_HEIGHT * 0.49 - point.y * scale,
      scale,
    });
  };

  const selectNode = (id: string, moveCamera = true) => {
    const point = pointById.get(id);
    if (!point) return;
    setSelectedId(id);
    setHoveredId(null);
    setFocusedId(id);
    if (moveCamera) focusPoint(point, point.depth === 0 ? 0.92 : 1.12);
  };

  const focusRegion = (regionId: string) => {
    const region = layout.regions.find(
      (candidate) => candidate.id === regionId,
    );
    const point = pointById.get(regionId);
    if (!region || !point) return;
    setSelectedId(regionId);
    setHoveredId(null);
    setFocusedId(regionId);
    const scale = 0.88;
    setTargetCamera({
      x: ATLAS_VIEW_WIDTH * 0.5 - region.centerX * scale,
      y: ATLAS_VIEW_HEIGHT * 0.48 - region.centerY * scale,
      scale,
    });
  };

  const rebaseGesture = (gesture: Gesture) => {
    const center = pointerCenter(gesture.pointers);
    const current = cameraRef.current;
    gesture.startCamera = current;
    gesture.startCenter = center;
    gesture.anchorWorld = {
      x: (center.x - current.x) / current.scale,
      y: (center.y - current.y) / current.scale,
    };
    gesture.startDistance = pointerDistance(gesture.pointers);
    gesture.lastCenter = center;
    gesture.lastTime = performance.now();
    gesture.velocityX = 0;
    gesture.velocityY = 0;
  };

  const onPointerDown = (event: TargetedPointerEvent<SVGSVGElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const viewPoint = pointFromClient(event.clientX, event.clientY);
    const target = event.target instanceof Element ? event.target : null;
    const nodeId =
      target?.closest<SVGGElement>('[data-atlas-node]')?.dataset.atlasNode;
    const pointer: GesturePointer = {
      clientX: event.clientX,
      clientY: event.clientY,
      viewX: viewPoint.x,
      viewY: viewPoint.y,
    };
    const current = gestureRef.current;

    if (current) {
      current.pointers.set(event.pointerId, pointer);
      current.hadPinch = current.pointers.size > 1;
      current.pressedNodeId = null;
      rebaseGesture(current);
      setIsPanning(true);
      return;
    }

    const pointers = new Map([[event.pointerId, pointer]]);
    const center = pointerCenter(pointers);
    const currentCamera = cameraRef.current;
    gestureRef.current = {
      pointers,
      startCamera: currentCamera,
      startCenter: center,
      anchorWorld: {
        x: (center.x - currentCamera.x) / currentCamera.scale,
        y: (center.y - currentCamera.y) / currentCamera.scale,
      },
      startDistance: 1,
      pressedNodeId: nodeId ?? null,
      moved: false,
      hadPinch: false,
      lastCenter: center,
      lastTime: performance.now(),
      velocityX: 0,
      velocityY: 0,
    };
  };

  const onPointerMove = (event: TargetedPointerEvent<SVGSVGElement>) => {
    const gesture = gestureRef.current;
    if (!gesture?.pointers.has(event.pointerId)) return;
    const viewPoint = pointFromClient(event.clientX, event.clientY);
    gesture.pointers.set(event.pointerId, {
      clientX: event.clientX,
      clientY: event.clientY,
      viewX: viewPoint.x,
      viewY: viewPoint.y,
    });
    const center = pointerCenter(gesture.pointers);
    const now = performance.now();
    const elapsed = Math.max(now - gesture.lastTime, 1);
    gesture.velocityX = (center.x - gesture.lastCenter.x) / elapsed;
    gesture.velocityY = (center.y - gesture.lastCenter.y) / elapsed;
    gesture.lastCenter = center;
    gesture.lastTime = now;

    const travel = Math.hypot(
      center.x - gesture.startCenter.x,
      center.y - gesture.startCenter.y,
    );
    if (travel > 4 || gesture.pointers.size > 1) {
      gesture.moved = true;
      setIsPanning(true);
    }

    if (gesture.pointers.size > 1) {
      const scale = clamp(
        gesture.startCamera.scale *
          (pointerDistance(gesture.pointers) / gesture.startDistance),
        MIN_SCALE,
        MAX_SCALE,
      );
      setTargetCamera(
        {
          x: center.x - gesture.anchorWorld.x * scale,
          y: center.y - gesture.anchorWorld.y * scale,
          scale,
        },
        true,
      );
      return;
    }

    setTargetCamera(
      {
        x: gesture.startCamera.x + center.x - gesture.startCenter.x,
        y: gesture.startCamera.y + center.y - gesture.startCenter.y,
        scale: gesture.startCamera.scale,
      },
      true,
    );
  };

  const finishPointer = (event: TargetedPointerEvent<SVGSVGElement>) => {
    const gesture = gestureRef.current;
    if (!gesture?.pointers.has(event.pointerId)) return;
    gesture.pointers.delete(event.pointerId);

    if (gesture.pointers.size > 0) {
      gesture.pressedNodeId = null;
      rebaseGesture(gesture);
      return;
    }

    if (!gesture.moved && gesture.pressedNodeId) {
      selectNode(gesture.pressedNodeId);
    } else if (!gesture.moved) {
      setSelectedId(null);
    } else if (!gesture.hadPinch) {
      const current = cameraRef.current;
      setTargetCamera({
        ...current,
        x: current.x + gesture.velocityX * 145,
        y: current.y + gesture.velocityY * 145,
      });
    }

    gestureRef.current = null;
    setIsPanning(false);
  };

  const cancelPointer = () => {
    gestureRef.current = null;
    setIsPanning(false);
  };

  const onWheel = (event: TargetedWheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const center = pointFromClient(event.clientX, event.clientY);
    zoomAt(Math.exp(-event.deltaY * 0.00115), center);
  };

  const onNodeKeyDown = (
    event: TargetedKeyboardEvent<SVGGElement>,
    point: AtlasPoint<KnowledgeMapNode>,
  ) => {
    if (event.key.startsWith('Arrow')) {
      event.preventDefault();
      const next = nearestInDirection(point, layout.points, event.key);
      if (!next) return;
      setFocusedId(next.id);
      document.getElementById(`atlas-node-${next.id}`)?.focus();
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectNode(point.id);
      return;
    }
    if (event.key.toLowerCase() === 'o') {
      window.location.assign(point.href);
    }
  };

  const chooseSearchResult = (node: KnowledgeMapNode) => {
    selectNode(node.id);
    setQuery('');
    setSearchFocused(false);
    searchRef.current?.blur();
  };

  const onSearchKeyDown = (event: TargetedKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSearchIndex((current) =>
        Math.min(current + 1, Math.max(results.length - 1, 0)),
      );
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSearchIndex((current) => Math.max(current - 1, 0));
    }
    if (event.key === 'Enter' && results[searchIndex]) {
      event.preventDefault();
      chooseSearchResult(results[searchIndex]);
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setQuery('');
      setSearchFocused(false);
      event.currentTarget.blur();
    }
  };

  if (nodes.length === 0) {
    return (
      <p className="knowledge-atlas__empty">
        Nothing has found its place here yet.
      </p>
    );
  }

  const zoomPercent = Math.round((cameraTarget.scale / FIT_SCALE) * 100);
  const showResults = searchFocused && normalizedQuery.length > 0;
  const density =
    nodes.length > 80 ? 'dense' : nodes.length > 32 ? 'medium' : 'sparse';

  return (
    <section
      className="knowledge-atlas"
      data-zoom={zoomLevel}
      data-density={density}
      aria-label="Interactive atlas of notes"
    >
      <header className="knowledge-atlas__toolbar">
        <div className="knowledge-atlas__edition" aria-hidden="true">
          <span>field study 01</span>
          <span>{nodes.length.toString().padStart(2, '0')} notes</span>
          <span>
            {layout.regions.length.toString().padStart(2, '0')} neighborhoods
          </span>
        </div>

        <div ref={searchWrapRef} className="knowledge-atlas__search-wrap">
          <label className="knowledge-atlas__search" htmlFor="atlas-search">
            <SearchIcon />
            <span className="garden-visually-hidden">
              Find a note on the map
            </span>
            <input
              ref={searchRef}
              id="atlas-search"
              type="search"
              value={query}
              placeholder="find a thought"
              autoComplete="off"
              aria-controls="atlas-search-results"
              aria-expanded={showResults}
              aria-activedescendant={
                showResults && results[searchIndex]
                  ? `atlas-search-${results[searchIndex].id}`
                  : undefined
              }
              onFocus={() => setSearchFocused(true)}
              onBlur={() => {
                requestAnimationFrame(() => {
                  if (
                    !searchWrapRef.current?.contains(document.activeElement)
                  ) {
                    setSearchFocused(false);
                    setHoveredId(null);
                  }
                });
              }}
              onInput={(event: TargetedInputEvent<HTMLInputElement>) =>
                setQuery(event.currentTarget.value)
              }
              onKeyDown={onSearchKeyDown}
            />
            <kbd>/</kbd>
          </label>

          {showResults && (
            <div
              id="atlas-search-results"
              className="knowledge-atlas__search-results"
              role="listbox"
            >
              <p aria-live="polite">
                {results.length === 0
                  ? 'no places found'
                  : `${results.length} ${results.length === 1 ? 'place' : 'places'} found`}
              </p>
              {results.map((result, index) => (
                <button
                  key={result.id}
                  id={`atlas-search-${result.id}`}
                  type="button"
                  role="option"
                  aria-selected={index === searchIndex}
                  className={index === searchIndex ? 'is-active' : undefined}
                  onPointerEnter={() => {
                    setSearchIndex(index);
                    setHoveredId(result.id);
                  }}
                  onPointerLeave={() => setHoveredId(null)}
                  onClick={() => chooseSearchResult(result)}
                >
                  <span>{result.title}</span>
                  <small>
                    {pointById.get(result.id)?.groupId.replaceAll('-', ' ')}
                  </small>
                </button>
              ))}
            </div>
          )}
        </div>

        <div
          className="knowledge-atlas__controls"
          role="group"
          aria-label="Map scale"
        >
          <button
            type="button"
            onClick={() => zoomAt(1 / 1.24)}
            aria-label="Zoom out"
          >
            <span aria-hidden="true">−</span>
          </button>
          <output aria-label={`Map scale ${zoomPercent} percent`}>
            {zoomPercent}%
          </output>
          <button
            type="button"
            onClick={() => zoomAt(1.24)}
            aria-label="Zoom in"
          >
            <span aria-hidden="true">+</span>
          </button>
          <button
            type="button"
            onClick={resetView}
            aria-label="Show the whole atlas"
          >
            <CompassIcon />
          </button>
        </div>
      </header>

      <div className="knowledge-atlas__body">
        <div className="knowledge-atlas__viewport">
          <svg
            ref={svgRef}
            className={`knowledge-atlas__surface${isPanning ? ' is-panning' : ''}`}
            viewBox={`0 0 ${ATLAS_VIEW_WIDTH} ${ATLAS_VIEW_HEIGHT}`}
            role="group"
            aria-label="Thought atlas. Drag to move, pinch or scroll to zoom, and select a place to inspect it. Arrow keys move between places."
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={finishPointer}
            onPointerCancel={cancelPointer}
            onWheel={onWheel}
          >
            <defs>
              <pattern
                id="atlas-grid-minor"
                width="40"
                height="40"
                patternUnits="userSpaceOnUse"
              >
                <path d="M40 0H0V40" />
              </pattern>
              <pattern
                id="atlas-grid-major"
                width="200"
                height="200"
                patternUnits="userSpaceOnUse"
              >
                <path d="M200 0H0V200" />
                <path d="M8 0H0V8M192 0h8v8M8 200H0v-8M192 200h8v-8" />
              </pattern>
            </defs>

            <rect
              className="knowledge-atlas__plate"
              width={ATLAS_VIEW_WIDTH}
              height={ATLAS_VIEW_HEIGHT}
            />

            <g
              ref={worldRef}
              className="knowledge-atlas__world"
              transform={`translate(${OVERVIEW_CAMERA.x} ${OVERVIEW_CAMERA.y}) scale(${OVERVIEW_CAMERA.scale})`}
            >
              <rect
                className="knowledge-atlas__world-ground"
                width={ATLAS_WORLD_WIDTH}
                height={ATLAS_WORLD_HEIGHT}
              />
              <rect
                className="knowledge-atlas__grid knowledge-atlas__grid--minor"
                width={ATLAS_WORLD_WIDTH}
                height={ATLAS_WORLD_HEIGHT}
                fill="url(#atlas-grid-minor)"
              />
              <rect
                className="knowledge-atlas__grid knowledge-atlas__grid--major"
                width={ATLAS_WORLD_WIDTH}
                height={ATLAS_WORLD_HEIGHT}
                fill="url(#atlas-grid-major)"
              />
              <rect
                className="knowledge-atlas__world-boundary"
                x="20"
                y="20"
                width={ATLAS_WORLD_WIDTH - 40}
                height={ATLAS_WORLD_HEIGHT - 40}
              />

              <g className="knowledge-atlas__regions" aria-hidden="true">
                {layout.regions.map((region) => (
                  <g
                    key={region.id}
                    className={`knowledge-atlas__region tone-${region.index % TONE_COUNT}${
                      activePoint &&
                      activePoint.depth > 0 &&
                      activePoint.groupId !== region.id
                        ? ' is-muted'
                        : ''
                    }`}
                  >
                    <path
                      className="knowledge-atlas__region-boundary"
                      d={region.path}
                    />
                    <path
                      className="knowledge-atlas__region-contour"
                      d={region.innerPath}
                    />
                    <text
                      className="knowledge-atlas__region-label"
                      x={region.labelX}
                      y={region.labelY}
                    >
                      <tspan>{String(region.index + 1).padStart(2, '0')}</tspan>
                      <tspan dx="10">{region.title}</tspan>
                      <tspan dx="8">· {region.count}</tspan>
                    </text>
                  </g>
                ))}
              </g>

              <g className="knowledge-atlas__connections" aria-hidden="true">
                {edges.map((edge) => {
                  const source = pointById.get(edge.sourceId);
                  const target = pointById.get(edge.targetId);
                  if (!source || !target) return null;
                  const connected = Boolean(
                    activeId &&
                    (edge.sourceId === activeId || edge.targetId === activeId),
                  );
                  const searchVisible =
                    !normalizedQuery ||
                    resultIds.has(edge.sourceId) ||
                    resultIds.has(edge.targetId);
                  const dimmed =
                    !searchVisible || Boolean(activeId && !connected);
                  const path = atlasConnectionPath(source, target, edge.kind);
                  return (
                    <g
                      key={`${connectionKey(edge)}:${edge.kind}`}
                      className={`knowledge-atlas__connection-set is-${edge.kind}${
                        connected ? ' is-active' : ''
                      }${dimmed ? ' is-dimmed' : ''}`}
                    >
                      <path className="knowledge-atlas__connection" d={path} />
                      {connected && (
                        <path
                          className="knowledge-atlas__connection-trace"
                          d={path}
                          pathLength="1"
                        />
                      )}
                    </g>
                  );
                })}
              </g>

              <g className="knowledge-atlas__nodes">
                {layout.points.map((point, index) => {
                  const isActive = point.id === activeId;
                  const isSelected = point.id === selectedId;
                  const searchMatch =
                    !normalizedQuery || resultIds.has(point.id);
                  const dimmed =
                    !searchMatch ||
                    Boolean(activeId && !relatedIds.has(point.id));
                  const longestLine = Math.max(
                    ...point.labelLines.map((line) => line.length),
                  );
                  const labelWidth = clamp(longestLine * 7.6, 76, 224);
                  const hitX =
                    point.labelSide === 'start' ? -16 : -labelWidth - 32;
                  const textX = point.labelSide === 'start' ? 18 : -18;
                  const nodeCode = `N${String(index + 1).padStart(2, '0')}`;

                  return (
                    <g
                      key={point.id}
                      id={`atlas-node-${point.id}`}
                      className={`knowledge-atlas__node tone-${Math.max(point.groupIndex, 0) % TONE_COUNT}${
                        isActive ? ' is-active' : ''
                      }${isSelected ? ' is-selected' : ''}${
                        dimmed ? ' is-dimmed' : ''
                      }${searchMatch && normalizedQuery ? ' is-match' : ''}${
                        point.id === layout.rootId ? ' is-origin' : ''
                      }${point.childIds.length > 0 ? ' is-branch' : ''}${
                        point.depth > 2 ? ' is-deep' : ''
                      }`}
                      transform={`translate(${point.x} ${point.y})`}
                      style={`--atlas-order: ${index}`}
                      data-atlas-node={point.id}
                      role="button"
                      tabIndex={focusedId === point.id ? 0 : -1}
                      aria-pressed={isSelected}
                      aria-label={`${point.title}. ${point.summary || 'No summary yet.'} Press Enter to inspect, or O to open.`}
                      onPointerEnter={(event) => {
                        if (event.pointerType !== 'touch')
                          setHoveredId(point.id);
                      }}
                      onPointerLeave={(event) => {
                        if (event.pointerType !== 'touch') setHoveredId(null);
                      }}
                      onFocus={() => {
                        setFocusedId(point.id);
                        setHoveredId(point.id);
                      }}
                      onBlur={() => setHoveredId(null)}
                      onDblClick={() => window.location.assign(point.href)}
                      onKeyDown={(event) => onNodeKeyDown(event, point)}
                    >
                      <title>{point.title}</title>
                      <rect
                        className="knowledge-atlas__node-hit"
                        x={hitX}
                        y={-30}
                        width={labelWidth + 48}
                        height={Math.max(58, point.labelLines.length * 19 + 31)}
                        rx="3"
                      />
                      <NodeMark point={point} rootId={layout.rootId} />
                      <text
                        className="knowledge-atlas__node-label"
                        x={textX}
                        y={point.labelLines.length > 1 ? -5 : 5}
                        textAnchor={point.labelSide}
                      >
                        {point.labelLines.map((line, lineIndex) => (
                          <tspan
                            key={`${point.id}:${line}`}
                            x={textX}
                            dy={lineIndex === 0 ? 0 : 18}
                          >
                            {line}
                          </tspan>
                        ))}
                      </text>
                      <text
                        className="knowledge-atlas__node-code"
                        x={textX}
                        y={point.labelLines.length > 1 ? 37 : 25}
                        textAnchor={point.labelSide}
                      >
                        {nodeCode}
                      </text>
                      <path
                        className="knowledge-atlas__selection-bracket"
                        d={
                          point.labelSide === 'start'
                            ? `M 13 -20V-25H${labelWidth + 22}V-18`
                            : `M -13 -20V-25H${-labelWidth - 22}V-18`
                        }
                      />
                    </g>
                  );
                })}
              </g>
            </g>

            <g className="knowledge-atlas__reticle" aria-hidden="true">
              <path d="M18 34V18h16M1146 18h16v16M18 726v16h16M1146 742h16v-16" />
              <path d="M590 18v7M590 735v7M18 380h7M1155 380h7" />
            </g>
          </svg>

          <div className="knowledge-atlas__coordinates" aria-hidden="true">
            <span>48° 27′ n</span>
            <span>
              {isPanning ? 'surveying field…' : 'living index / local time'}
            </span>
            <span>69° 12′ e</span>
          </div>

          <p className="garden-visually-hidden" aria-live="polite">
            {selectedNode
              ? `${selectedNode.title} selected.`
              : 'No note selected.'}
          </p>
        </div>

        <aside className="knowledge-atlas__inspector" aria-live="polite">
          {selectedNode && selectedPoint ? (
            <div className="knowledge-atlas__place">
              <div className="knowledge-atlas__place-topline">
                <span>
                  place{' '}
                  {String(layout.points.indexOf(selectedPoint) + 1).padStart(
                    2,
                    '0',
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  aria-label="Close note details"
                >
                  close
                </button>
              </div>
              <p className="knowledge-atlas__place-neighborhood">
                {selectedPoint.groupId === selectedPoint.id
                  ? 'neighborhood marker'
                  : (nodeById.get(selectedPoint.groupId)?.title ??
                    'open field')}
              </p>
              <h2>{selectedNode.title}</h2>
              <p className="knowledge-atlas__place-summary">
                {selectedNode.summary ||
                  'This place is still waiting for a first line.'}
              </p>

              <dl className="knowledge-atlas__place-facts">
                <div>
                  <dt>paths</dt>
                  <dd>{selectedNode.degree}</dd>
                </div>
                <div>
                  <dt>branches</dt>
                  <dd>{selectedNode.childIds.length}</dd>
                </div>
                <div>
                  <dt>links out</dt>
                  <dd>{selectedNode.outboundCount}</dd>
                </div>
              </dl>

              {nearby.length > 0 && (
                <div className="knowledge-atlas__nearby">
                  <h3>paths from here</h3>
                  <ul>
                    {nearby.map((node) => (
                      <li key={node.id}>
                        <button
                          type="button"
                          onClick={() => selectNode(node.id)}
                        >
                          <span aria-hidden="true">↗</span>
                          {node.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <a className="knowledge-atlas__open" href={selectedNode.href}>
                <span>read this note</span>
                <span aria-hidden="true">↗</span>
              </a>
            </div>
          ) : (
            <div className="knowledge-atlas__key">
              <p className="knowledge-atlas__key-kicker">field key</p>
              <h2>Every thought has a neighborhood.</h2>
              <p>
                Folder branches shape the terrain. Hand-written links cut paths
                between places that would otherwise stay apart.
              </p>

              <div className="knowledge-atlas__legend" aria-label="Map legend">
                <div>
                  <span className="is-branch" aria-hidden="true"></span>
                  <p>
                    <strong>branch</strong>
                    <small>where a note lives</small>
                  </p>
                </div>
                <div>
                  <span className="is-reference" aria-hidden="true"></span>
                  <p>
                    <strong>trail</strong>
                    <small>a link written by hand</small>
                  </p>
                </div>
                <div>
                  <span className="is-affinity" aria-hidden="true"></span>
                  <p>
                    <strong>echo</strong>
                    <small>a quieter shared theme</small>
                  </p>
                </div>
              </div>

              <div className="knowledge-atlas__districts">
                <h3>neighborhoods</h3>
                <ol>
                  {layout.regions.map((region) => (
                    <li key={region.id}>
                      <button
                        type="button"
                        onClick={() => focusRegion(region.id)}
                      >
                        <span>{String(region.index + 1).padStart(2, '0')}</span>
                        <strong>{region.title}</strong>
                        <small>{region.count}</small>
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )}

          <footer className="knowledge-atlas__instructions">
            <span>drag to travel</span>
            <span>scroll / pinch to scale</span>
            <span>double-click to open</span>
          </footer>
        </aside>
      </div>
    </section>
  );
}
