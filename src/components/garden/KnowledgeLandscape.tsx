import type {
  TargetedInputEvent,
  TargetedKeyboardEvent,
  TargetedPointerEvent,
  TargetedWheelEvent,
} from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  LANDSCAPE_VIEW_HEIGHT,
  LANDSCAPE_VIEW_WIDTH,
  createLandscapeLayout,
  landscapeHash,
  landscapeRoutePath,
  type LandscapeBounds,
  type LandscapePlace as PositionedPlace,
  type LandscapeRegion,
} from '@lib/garden/landscape-layout';

export type KnowledgePlace = {
  id: string;
  title: string;
  summary: string;
  href: string;
  parentId: string | null;
  childIds: string[];
  tags: string[];
  linkCount: number;
};

export type KnowledgePath = {
  sourceId: string;
  targetId: string;
  kind: 'reference' | 'affinity';
};

type Props = {
  places: KnowledgePlace[];
  paths: KnowledgePath[];
};

type Camera = {
  x: number;
  y: number;
  scale: number;
};

type ViewSize = {
  width: number;
  height: number;
};

type GesturePointer = {
  viewX: number;
  viewY: number;
};

type Gesture = {
  pointers: Map<number, GesturePointer>;
  startCamera: Camera;
  startCenter: { x: number; y: number };
  anchorWorld: { x: number; y: number };
  startDistance: number;
  pressedPlaceId: string | null;
  moved: boolean;
  hadPinch: boolean;
  lastCenter: { x: number; y: number };
  lastTime: number;
  velocityX: number;
  velocityY: number;
};

type ZoomLevel = 'world' | 'region' | 'place';

const DEFAULT_VIEW: ViewSize = {
  width: LANDSCAPE_VIEW_WIDTH,
  height: LANDSCAPE_VIEW_HEIGHT,
};
const MAX_SCALE = 3.2;
const TONE_COUNT = 5;
// How quickly the camera eases toward its target, per second. A pure
// exponential approach is critically damped — it glides in and settles
// without the spring overshoot that read as a bouncy jiggle.
const CAMERA_EASE = 7.5;
// Must stay in step with the landscape-card-out animation in _atlas.css.
const CARD_EXIT_MS = 140;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function cameraForBounds(
  bounds: LandscapeBounds,
  view: ViewSize,
  padding: number,
  maximum = Number.POSITIVE_INFINITY,
): Camera {
  const width = Math.max(bounds.width, 1);
  const height = Math.max(bounds.height, 1);
  const scale = Math.min(
    Math.max((view.width - padding * 2) / width, 0.01),
    Math.max((view.height - padding * 2) / height, 0.01),
    maximum,
  );
  return {
    x: view.width / 2 - bounds.centerX * scale,
    y: view.height / 2 - bounds.centerY * scale,
    scale,
  };
}

function searchScore(place: KnowledgePlace, query: string): number {
  if (!query) return 1;
  const title = place.title.toLowerCase();
  const summary = place.summary.toLowerCase();
  const tags = place.tags.join(' ').toLowerCase();
  if (title === query) return 100;
  if (title.startsWith(query)) return 80;
  if (title.includes(query)) return 60;
  if (tags.includes(query)) return 35;
  if (summary.includes(query)) return 20;
  return 0;
}

function pathKey(path: KnowledgePath): string {
  return [path.sourceId, path.targetId].toSorted().join('::');
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
  current: PositionedPlace<KnowledgePlace>,
  places: PositionedPlace<KnowledgePlace>[],
  key: string,
): PositionedPlace<KnowledgePlace> | undefined {
  const direction =
    key === 'ArrowLeft'
      ? { x: -1, y: 0 }
      : key === 'ArrowRight'
        ? { x: 1, y: 0 }
        : key === 'ArrowUp'
          ? { x: 0, y: -1 }
          : { x: 0, y: 1 };

  return places
    .filter((place) => place.id !== current.id)
    .map((place) => {
      const dx = place.x - current.x;
      const dy = place.y - current.y;
      const forward = dx * direction.x + dy * direction.y;
      const sideways = Math.abs(dx * direction.y - dy * direction.x);
      return { place, forward, score: forward + sideways * 1.4 };
    })
    .filter((candidate) => candidate.forward > 10)
    .toSorted((left, right) => left.score - right.score)[0]?.place;
}

function parsePlaceHash(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.hash.slice(1)).get('place');
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="8.5" cy="8.5" r="4.75" />
      <path d="m12.1 12.1 4.15 4.15" />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 7.75 10 3l6 4.75" />
      <path d="M5.5 6.75V16h9V6.75" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="m5 5 10 10M15 5 5 15" />
    </svg>
  );
}

export default function KnowledgeLandscape({ places, paths }: Props) {
  const layout = useMemo(() => createLandscapeLayout(places), [places]);
  const placeById = useMemo(
    () => new Map(layout.places.map((place) => [place.id, place])),
    [layout],
  );
  const regionById = useMemo(
    () => new Map(layout.regions.map((region) => [region.id, region])),
    [layout],
  );
  const sourceById = useMemo(
    () => new Map(places.map((place) => [place.id, place])),
    [places],
  );
  const initialCamera = useMemo(
    () => cameraForBounds(layout.bounds, DEFAULT_VIEW, 74),
    [layout],
  );
  const routeByKey = useMemo(() => {
    const routes = new Map<string, string>();
    for (const path of paths) {
      const source = placeById.get(path.sourceId);
      const target = placeById.get(path.targetId);
      if (!source || !target) continue;
      routes.set(
        `${pathKey(path)}:${path.kind}`,
        landscapeRoutePath(layout, source, target, path.kind),
      );
    }
    return routes;
  }, [layout, paths, placeById]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState(layout.rootPlaceId);
  const [journeyKey, setJourneyKey] = useState<string | null>(null);
  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>('world');
  const [viewWidth, setViewWidth] = useState(DEFAULT_VIEW.width);
  const [isPanning, setIsPanning] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [searchIndex, setSearchIndex] = useState(0);
  const [hintVisible, setHintVisible] = useState(false);
  // The card keeps rendering its last place while it animates out, so closing
  // doesn't rip the content away mid-transition.
  const [lingeringPlace, setLingeringPlace] =
    useState<PositionedPlace<KnowledgePlace> | null>(null);

  const viewportRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const worldRef = useRef<SVGGElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchPanelRef = useRef<HTMLElement>(null);
  const searchTriggerRef = useRef<HTMLButtonElement>(null);
  const viewRef = useRef<ViewSize>(DEFAULT_VIEW);
  const overviewRef = useRef(initialCamera);
  const cameraRef = useRef(initialCamera);
  const targetCameraRef = useRef(initialCamera);
  const frameRef = useRef<number | null>(null);
  const previousFrameRef = useRef(0);
  const reducedMotionRef = useRef(false);
  const zoomLevelRef = useRef<ZoomLevel>('world');
  const gestureRef = useRef<Gesture | null>(null);
  const measuredRef = useRef(false);
  const searchOpenRef = useRef(searchOpen);
  searchOpenRef.current = searchOpen;

  const activeId = hoveredId ?? selectedId;
  const selectedPlace = selectedId ? placeById.get(selectedId) : undefined;
  const normalizedQuery = query.trim().toLowerCase();
  const cardOpen = Boolean(selectedPlace);
  const cardPlace = cardOpen ? selectedPlace : lingeringPlace;

  const results = useMemo(
    () =>
      places
        .map((place, position) => ({
          place,
          position,
          score: searchScore(place, normalizedQuery),
        }))
        .filter((result) => result.score > 0)
        .toSorted(
          (left, right) =>
            right.score - left.score || left.position - right.position,
        )
        .slice(0, 8)
        .map((result) => result.place),
    [normalizedQuery, places],
  );
  const resultIds = useMemo(
    () => new Set(results.map((result) => result.id)),
    [results],
  );

  // Notes are weighted by how many links they carry, so the map shows where its
  // centres of gravity are. Logarithmic, because one note with 30 links should
  // not flatten everything else to a dot.
  const maxLinkCount = useMemo(
    () => Math.max(...places.map((place) => place.linkCount), 0),
    [places],
  );

  const relatedIds = useMemo(() => {
    const related = new Set<string>();
    if (!activeId) return related;
    related.add(activeId);
    const active = sourceById.get(activeId);
    if (active?.parentId) related.add(active.parentId);
    active?.childIds.forEach((id) => related.add(id));
    for (const path of paths) {
      if (path.sourceId === activeId) related.add(path.targetId);
      if (path.targetId === activeId) related.add(path.sourceId);
    }
    return related;
  }, [activeId, paths, sourceById]);

  const contextualRegionIds = useMemo(() => {
    const ids = new Set<string>();
    const active = activeId ? placeById.get(activeId) : undefined;
    let regionId: string | null = active?.regionId ?? null;
    while (regionId !== null) {
      ids.add(regionId);
      regionId = regionById.get(regionId)?.parentId ?? null;
    }
    if (active?.isRegionAnchor) {
      for (const region of layout.regions) {
        if (
          region.id === active.regionId ||
          region.id.startsWith(`${active.regionId}/`)
        ) {
          ids.add(region.id);
        }
      }
    }
    return ids;
  }, [activeId, layout.regions, placeById, regionById]);

  const onwardPlaces = useMemo(() => {
    if (!cardPlace) return [];
    const rows: { place: KnowledgePlace; relation: 'within' | 'path' }[] = [];
    const seen = new Set<string>();
    for (const childId of cardPlace.childIds) {
      const child = sourceById.get(childId);
      if (!child || seen.has(child.id)) continue;
      seen.add(child.id);
      rows.push({ place: child, relation: 'within' });
    }
    for (const path of paths) {
      const id =
        path.sourceId === cardPlace.id
          ? path.targetId
          : path.targetId === cardPlace.id
            ? path.sourceId
            : null;
      if (!id || seen.has(id)) continue;
      const target = sourceById.get(id);
      if (!target) continue;
      seen.add(id);
      rows.push({ place: target, relation: 'path' });
    }
    return rows.slice(0, 6);
  }, [cardPlace, paths, sourceById]);

  const breadcrumbs = useMemo(() => {
    if (!selectedPlace) return [];
    const rows: {
      region: LandscapeRegion;
      place: PositionedPlace<KnowledgePlace>;
    }[] = [];
    let regionId: string | null = selectedPlace.regionId;
    while (regionId !== null) {
      const region = regionById.get(regionId);
      if (!region) break;
      const anchor = region.anchorPlaceId
        ? placeById.get(region.anchorPlaceId)
        : undefined;
      if (anchor) rows.unshift({ region, place: anchor });
      regionId = region.parentId;
    }
    return rows;
  }, [placeById, regionById, selectedPlace]);

  useEffect(() => {
    reducedMotionRef.current = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    try {
      if (sessionStorage.getItem('landscape-hint-seen') !== 'yes') {
        setHintVisible(true);
        sessionStorage.setItem('landscape-hint-seen', 'yes');
      }
    } catch {
      setHintVisible(true);
    }
    const hintTimer = window.setTimeout(() => setHintVisible(false), 7200);

    const onGlobalKeyDown = (event: KeyboardEvent) => {
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
        setSearchOpen(true);
      }
      if (event.key === 'Escape') {
        if (searchOpenRef.current) setSearchOpen(false);
        else closeSelection(true);
      }
      if (event.key === '0' && !typing) {
        event.preventDefault();
        resetWorld();
      }
    };
    const onHistory = () => {
      const id = parsePlaceHash();
      if (id && placeById.has(id)) selectPlace(id, false);
      else closeSelection(false);
    };

    window.addEventListener('keydown', onGlobalKeyDown);
    window.addEventListener('popstate', onHistory);
    const initialId = parsePlaceHash();
    if (initialId && placeById.has(initialId)) {
      requestAnimationFrame(() => selectPlace(initialId, false));
    }
    return () => {
      window.clearTimeout(hintTimer);
      window.removeEventListener('keydown', onGlobalKeyDown);
      window.removeEventListener('popstate', onHistory);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [placeById]);

  useEffect(() => {
    if (!searchOpen) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusFrame = requestAnimationFrame(() => searchRef.current?.focus());
    const keepFocusInside = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const panel = searchPanelRef.current;
      if (!panel) return;
      const focusable = [
        ...panel.querySelectorAll<HTMLElement>('input, button'),
      ];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', keepFocusInside);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', keepFocusInside);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
      else searchTriggerRef.current?.focus();
    };
  }, [searchOpen]);

  useEffect(() => setSearchIndex(0), [normalizedQuery]);

  useEffect(() => {
    if (cardOpen && selectedPlace) {
      setLingeringPlace(selectedPlace);
      return;
    }
    if (!lingeringPlace) return;
    const timer = window.setTimeout(
      () => setLingeringPlace(null),
      CARD_EXIT_MS,
    );
    return () => window.clearTimeout(timer);
  }, [cardOpen, lingeringPlace, selectedPlace]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width <= 0 || height <= 0) return;
      const nextView = {
        width: clamp((LANDSCAPE_VIEW_HEIGHT * width) / height, 460, 1900),
        height: LANDSCAPE_VIEW_HEIGHT,
      };
      viewRef.current = nextView;
      setViewWidth(nextView.width);
      const overview = cameraForBounds(layout.bounds, nextView, 68);
      overviewRef.current = overview;

      if (!measuredRef.current) {
        measuredRef.current = true;
        if (!selectedId) setCameraImmediate(overview);
        return;
      }
      if (selectedId) {
        const place = placeById.get(selectedId);
        if (place) travelCamera(cameraTargetForPlace(place));
      } else {
        travelCamera(overview);
      }
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [layout.bounds, placeById, selectedId]);

  function zoomForScale(scale: number): ZoomLevel {
    const fit = Math.max(overviewRef.current.scale, 0.01);
    if (scale < fit * 1.42) return 'world';
    if (scale < fit * 2.55) return 'region';
    return 'place';
  }

  function commitCamera(camera: Camera): void {
    cameraRef.current = camera;
    worldRef.current?.setAttribute(
      'transform',
      `translate(${camera.x} ${camera.y}) scale(${camera.scale})`,
    );
    const nextZoom = zoomForScale(camera.scale);
    if (nextZoom !== zoomLevelRef.current) {
      zoomLevelRef.current = nextZoom;
      setZoomLevel(nextZoom);
    }
  }

  function finishTravel(): void {
    setJourneyKey(null);
  }

  function animateCamera(): void {
    if (frameRef.current !== null) return;
    previousFrameRef.current = performance.now();

    const tick = (now: number) => {
      // Seconds since the last frame, clamped so a dropped frame or a
      // background tab can't produce a jarring jump.
      const dt = clamp((now - previousFrameRef.current) / 1000, 0, 0.05);
      previousFrameRef.current = now;
      const current = cameraRef.current;
      const target = targetCameraRef.current;
      // Frame-rate independent exponential ease: fraction of the remaining
      // distance to close this frame. No velocity term, so it cannot overshoot.
      const t = 1 - Math.exp(-dt * CAMERA_EASE);
      const next = {
        x: current.x + (target.x - current.x) * t,
        y: current.y + (target.y - current.y) * t,
        scale: current.scale + (target.scale - current.scale) * t,
      };
      const distance =
        Math.abs(target.x - next.x) +
        Math.abs(target.y - next.y) +
        Math.abs(target.scale - next.scale) * 180;

      if (distance < 0.4) {
        commitCamera(target);
        frameRef.current = null;
        finishTravel();
        return;
      }
      commitCamera(next);
      frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);
  }

  function travelCamera(camera: Camera): void {
    const minimum = Math.max(overviewRef.current.scale * 0.56, 0.16);
    const target = {
      ...camera,
      scale: clamp(camera.scale, minimum, MAX_SCALE),
    };
    targetCameraRef.current = target;
    if (reducedMotionRef.current) {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      commitCamera(target);
      finishTravel();
      return;
    }
    animateCamera();
  }

  function setCameraImmediate(camera: Camera): void {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    targetCameraRef.current = camera;
    commitCamera(camera);
  }

  function cameraTargetForPlace(
    place: PositionedPlace<KnowledgePlace>,
  ): Camera {
    const view = viewRef.current;
    if (place.id === layout.rootPlaceId) return overviewRef.current;
    if (place.isRegionAnchor) {
      const region = regionById.get(place.regionId);
      if (region) {
        return cameraForBounds(
          region.bounds,
          view,
          view.width < 700 ? 54 : 112,
          Math.max(overviewRef.current.scale * 2.05, 1.08),
        );
      }
    }

    const scale = clamp(
      Math.max(cameraRef.current.scale, overviewRef.current.scale * 2.65, 1.34),
      overviewRef.current.scale,
      2.25,
    );
    return {
      x: view.width * 0.52 - place.x * scale,
      y: view.height * (view.width < 700 ? 0.36 : 0.47) - place.y * scale,
      scale,
    };
  }

  function updateHistory(id: string | null, push: boolean): void {
    const url = new URL(window.location.href);
    url.hash = id ? `place=${encodeURIComponent(id)}` : '';
    if (push) window.history.pushState({ place: id }, '', url);
    else window.history.replaceState({ place: id }, '', url);
  }

  function selectPlace(id: string, pushHistory = true): void {
    const place = placeById.get(id);
    if (!place) return;
    if (selectedId && selectedId !== id) {
      setJourneyKey([selectedId, id].toSorted().join('::'));
    }
    setSelectedId(id);
    setHoveredId(null);
    setFocusedId(id);
    setHintVisible(false);
    travelCamera(cameraTargetForPlace(place));
    if (pushHistory) updateHistory(id, true);
  }

  function closeSelection(updateUrl = true): void {
    setSelectedId(null);
    setJourneyKey(null);
    if (updateUrl && typeof window !== 'undefined') updateHistory(null, false);
  }

  function resetWorld(): void {
    closeSelection(true);
    travelCamera(overviewRef.current);
  }

  function pointFromClient(
    clientX: number,
    clientY: number,
  ): { x: number; y: number } {
    const svg = svgRef.current;
    if (!svg)
      return { x: viewRef.current.width / 2, y: viewRef.current.height / 2 };
    const matrix = svg.getScreenCTM();
    if (!matrix)
      return { x: viewRef.current.width / 2, y: viewRef.current.height / 2 };
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    return point.matrixTransform(matrix.inverse());
  }

  function zoomAt(factor: number, center?: { x: number; y: number }): void {
    const target = targetCameraRef.current;
    const anchor = center ?? {
      x: viewRef.current.width / 2,
      y: viewRef.current.height / 2,
    };
    const minimum = Math.max(overviewRef.current.scale * 0.56, 0.16);
    const scale = clamp(target.scale * factor, minimum, MAX_SCALE);
    const worldX = (anchor.x - target.x) / target.scale;
    const worldY = (anchor.y - target.y) / target.scale;
    travelCamera({
      x: anchor.x - worldX * scale,
      y: anchor.y - worldY * scale,
      scale,
    });
  }

  function rebaseGesture(gesture: Gesture): void {
    const center = pointerCenter(gesture.pointers);
    const camera = cameraRef.current;
    gesture.startCamera = camera;
    gesture.startCenter = center;
    gesture.anchorWorld = {
      x: (center.x - camera.x) / camera.scale,
      y: (center.y - camera.y) / camera.scale,
    };
    gesture.startDistance = pointerDistance(gesture.pointers);
    gesture.lastCenter = center;
    gesture.lastTime = performance.now();
    gesture.velocityX = 0;
    gesture.velocityY = 0;
  }

  function onPointerDown(event: TargetedPointerEvent<SVGSVGElement>): void {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setHintVisible(false);
    const point = pointFromClient(event.clientX, event.clientY);
    const target = event.target instanceof Element ? event.target : null;
    const placeId =
      target?.closest<SVGGElement>('[data-place-id]')?.dataset.placeId;
    const pointer = { viewX: point.x, viewY: point.y };
    const current = gestureRef.current;

    if (current) {
      current.pointers.set(event.pointerId, pointer);
      current.hadPinch = current.pointers.size > 1;
      current.pressedPlaceId = null;
      rebaseGesture(current);
      setIsPanning(true);
      return;
    }

    const pointers = new Map([[event.pointerId, pointer]]);
    const center = pointerCenter(pointers);
    const camera = cameraRef.current;
    gestureRef.current = {
      pointers,
      startCamera: camera,
      startCenter: center,
      anchorWorld: {
        x: (center.x - camera.x) / camera.scale,
        y: (center.y - camera.y) / camera.scale,
      },
      startDistance: 1,
      pressedPlaceId: placeId ?? null,
      moved: false,
      hadPinch: false,
      lastCenter: center,
      lastTime: performance.now(),
      velocityX: 0,
      velocityY: 0,
    };
  }

  function onPointerMove(event: TargetedPointerEvent<SVGSVGElement>): void {
    const gesture = gestureRef.current;
    if (!gesture?.pointers.has(event.pointerId)) return;
    const point = pointFromClient(event.clientX, event.clientY);
    gesture.pointers.set(event.pointerId, { viewX: point.x, viewY: point.y });
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
      const minimum = Math.max(overviewRef.current.scale * 0.56, 0.16);
      const scale = clamp(
        gesture.startCamera.scale *
          (pointerDistance(gesture.pointers) / gesture.startDistance),
        minimum,
        MAX_SCALE,
      );
      setCameraImmediate({
        x: center.x - gesture.anchorWorld.x * scale,
        y: center.y - gesture.anchorWorld.y * scale,
        scale,
      });
      return;
    }

    setCameraImmediate({
      x: gesture.startCamera.x + center.x - gesture.startCenter.x,
      y: gesture.startCamera.y + center.y - gesture.startCenter.y,
      scale: gesture.startCamera.scale,
    });
  }

  function finishPointer(event: TargetedPointerEvent<SVGSVGElement>): void {
    const gesture = gestureRef.current;
    if (!gesture?.pointers.has(event.pointerId)) return;
    gesture.pointers.delete(event.pointerId);
    if (gesture.pointers.size > 0) {
      gesture.pressedPlaceId = null;
      rebaseGesture(gesture);
      return;
    }

    if (!gesture.moved && gesture.pressedPlaceId) {
      selectPlace(gesture.pressedPlaceId);
    } else if (!gesture.moved) {
      closeSelection(true);
    } else if (!gesture.hadPinch) {
      const camera = cameraRef.current;
      travelCamera({
        ...camera,
        x: camera.x + gesture.velocityX * 165,
        y: camera.y + gesture.velocityY * 165,
      });
    }
    gestureRef.current = null;
    setIsPanning(false);
  }

  function cancelPointer(): void {
    gestureRef.current = null;
    setIsPanning(false);
  }

  function onWheel(event: TargetedWheelEvent<SVGSVGElement>): void {
    event.preventDefault();
    setHintVisible(false);
    zoomAt(
      Math.exp(-event.deltaY * 0.0011),
      pointFromClient(event.clientX, event.clientY),
    );
  }

  function onPlaceKeyDown(
    event: TargetedKeyboardEvent<SVGGElement>,
    place: PositionedPlace<KnowledgePlace>,
  ): void {
    if (event.key.startsWith('Arrow')) {
      event.preventDefault();
      const next = nearestInDirection(place, layout.places, event.key);
      if (!next) return;
      setFocusedId(next.id);
      document.getElementById(`landscape-place-${next.id}`)?.focus();
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectPlace(place.id);
      return;
    }
    if (event.key.toLowerCase() === 'o') {
      window.location.assign(place.href);
    }
  }

  function chooseSearchResult(place: KnowledgePlace): void {
    setSearchOpen(false);
    setQuery('');
    selectPlace(place.id);
  }

  function onSearchKeyDown(
    event: TargetedKeyboardEvent<HTMLInputElement>,
  ): void {
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
      setSearchOpen(false);
    }
  }

  if (places.length === 0) {
    return (
      <p className="knowledge-landscape__empty">
        Nothing has settled here yet.
      </p>
    );
  }

  const density =
    places.length > 80 ? 'dense' : places.length > 32 ? 'medium' : 'sparse';
  // Hovering is a preview, so the rest of the map only recedes; selecting is a
  // commitment, so it isolates. A search keeps the strong dim either way, since
  // there the point is to see only the matches.
  const focus =
    hoveredId && !normalizedQuery ? 'hover' : activeId ? 'select' : 'none';

  return (
    <section
      className={`knowledge-landscape${selectedPlace ? ' has-place' : ''}`}
      data-zoom={zoomLevel}
      data-density={density}
      data-focus={focus}
      aria-label="A living landscape of notes"
    >
      <div ref={viewportRef} className="knowledge-landscape__viewport">
        <svg
          ref={svgRef}
          className={`knowledge-landscape__surface${isPanning ? ' is-panning' : ''}`}
          viewBox={`0 0 ${viewWidth} ${LANDSCAPE_VIEW_HEIGHT}`}
          role="group"
          aria-label="A spatial map of notes and folders. Drag to travel, scroll or pinch to zoom, and select a place to explore it."
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finishPointer}
          onPointerCancel={cancelPointer}
          onWheel={onWheel}
          onDblClick={(event) => {
            const target =
              event.target instanceof Element ? event.target : null;
            if (target?.closest('[data-place-id]')) return;
            zoomAt(1.42, pointFromClient(event.clientX, event.clientY));
          }}
        >
          <defs>
            <pattern
              id="landscape-field-marks"
              width="176"
              height="176"
              patternUnits="userSpaceOnUse"
            >
              <path d="M0 9V0h9M176 167v9h-9" />
            </pattern>
          </defs>

          <rect
            className="knowledge-landscape__ground"
            width={viewWidth}
            height={LANDSCAPE_VIEW_HEIGHT}
          />
          <g
            ref={worldRef}
            className="knowledge-landscape__world"
            transform={`translate(${initialCamera.x} ${initialCamera.y}) scale(${initialCamera.scale})`}
          >
            <rect
              className="knowledge-landscape__field"
              x="-50000"
              y="-50000"
              width="100000"
              height="100000"
            />
            <rect
              className="knowledge-landscape__field-marks"
              x="-50000"
              y="-50000"
              width="100000"
              height="100000"
              fill="url(#landscape-field-marks)"
            />

            <g className="knowledge-landscape__regions" aria-hidden="true">
              {layout.regions
                .filter((region) => region.id !== layout.rootRegionId)
                .map((region) => {
                  const tone =
                    landscapeHash(region.id.split('/')[0] ?? region.id) %
                    TONE_COUNT;
                  const context = contextualRegionIds.has(region.id);
                  return (
                    <g
                      key={region.id}
                      className={`knowledge-landscape__region depth-${Math.min(region.depth, 4)} tone-${tone}${context ? ' is-context' : ''}${activeId && !context ? ' is-muted' : ''}`}
                    >
                      <path d={region.path} />
                      {!region.anchorPlaceId && (
                        <text x={region.centerX} y={region.centerY}>
                          {region.title}
                        </text>
                      )}
                    </g>
                  );
                })}
            </g>

            <g className="knowledge-landscape__paths" aria-hidden="true">
              {paths.map((path) => {
                const d = routeByKey.get(`${pathKey(path)}:${path.kind}`);
                if (!d) return null;
                const connected = Boolean(
                  activeId &&
                  (path.sourceId === activeId || path.targetId === activeId),
                );
                const searching = Boolean(normalizedQuery);
                const searchVisible =
                  !searching ||
                  resultIds.has(path.sourceId) ||
                  resultIds.has(path.targetId);
                const journey = journeyKey === pathKey(path);
                return (
                  <g
                    key={`${pathKey(path)}:${path.kind}`}
                    className={`knowledge-landscape__path is-${path.kind}${connected ? ' is-active' : ''}${journey ? ' is-journey' : ''}${!searchVisible || (activeId && !connected && !journey) ? ' is-muted' : ''}`}
                  >
                    <path d={d} />
                    {(connected || journey) && (
                      <path
                        className="knowledge-landscape__path-trace"
                        d={d}
                        pathLength="1"
                      />
                    )}
                  </g>
                );
              })}
            </g>

            <g className="knowledge-landscape__places">
              {layout.places.map((place) => {
                const isRoot = place.id === layout.rootPlaceId;
                const region = regionById.get(place.regionId);
                const isActive = place.id === activeId;
                const isSelected = place.id === selectedId;
                const searchMatch = !normalizedQuery || resultIds.has(place.id);
                const dimmed =
                  !searchMatch ||
                  Boolean(activeId && !relatedIds.has(place.id));
                const topRegion = place.regionId.split('/')[0] || place.id;
                const tone = landscapeHash(topRegion) % TONE_COUNT;
                const longestLine = Math.max(
                  ...place.labelLines.map((line) => line.length),
                );
                const labelWidth = clamp(
                  longestLine * (place.isRegionAnchor ? 10 : 7.8),
                  place.isRegionAnchor ? 116 : 72,
                  place.isRegionAnchor ? 270 : 225,
                );
                const hitX =
                  place.labelSide === 'start' ? -20 : -labelWidth - 36;
                const textX = place.labelSide === 'start' ? 18 : -18;
                const weight =
                  maxLinkCount > 0
                    ? Math.log1p(place.linkCount) / Math.log1p(maxLinkCount)
                    : 0;
                const markRadius = 3.5 + weight * 3.8;
                const isHub = !place.isRegionAnchor && weight >= 0.62;
                return (
                  <g
                    key={place.id}
                    style={{ '--landscape-hub': weight.toFixed(3) }}
                    id={`landscape-place-${place.id}`}
                    className={`knowledge-landscape__place tone-${tone}${isRoot ? ' is-root' : ''}${place.isRegionAnchor ? ' is-region-anchor' : ' is-note'}${isHub ? ' is-hub' : ''}${place.depth > 1 ? ' is-deep' : ''}${isActive ? ' is-active' : ''}${isSelected ? ' is-selected' : ''}${dimmed ? ' is-muted' : ''}${searchMatch && normalizedQuery ? ' is-match' : ''}`}
                    transform={`translate(${place.x} ${place.y})`}
                    data-place-id={place.id}
                    role="button"
                    tabIndex={focusedId === place.id ? 0 : -1}
                    aria-pressed={isSelected}
                    aria-label={`${place.title}. ${place.summary || 'No summary yet.'} Press Enter to explore or O to open.`}
                    onPointerEnter={(event) => {
                      if (event.pointerType !== 'touch') setHoveredId(place.id);
                    }}
                    onPointerLeave={(event) => {
                      if (event.pointerType !== 'touch') setHoveredId(null);
                    }}
                    onFocus={() => {
                      setFocusedId(place.id);
                      setHoveredId(place.id);
                    }}
                    onBlur={() => setHoveredId(null)}
                    onKeyDown={(event) => onPlaceKeyDown(event, place)}
                  >
                    <title>{place.title}</title>
                    {isRoot ? (
                      <>
                        <rect
                          className="knowledge-landscape__place-hit"
                          x="-24"
                          y="-52"
                          width="220"
                          height="118"
                          rx="4"
                        />
                        <text
                          className="knowledge-landscape__root-title"
                          x="0"
                          y="0"
                        >
                          notes
                        </text>
                        <text
                          className="knowledge-landscape__root-meta"
                          x="0"
                          y="38"
                        >
                          {places.length} notes · {layout.regions.length - 1}{' '}
                          folders
                        </text>
                      </>
                    ) : place.isRegionAnchor ? (
                      <>
                        <rect
                          className="knowledge-landscape__place-hit"
                          x={hitX}
                          y="-38"
                          width={labelWidth + 52}
                          height={Math.max(
                            72,
                            place.labelLines.length * 25 + 36,
                          )}
                          rx="4"
                        />
                        <path
                          className="knowledge-landscape__region-rule"
                          d={
                            place.labelSide === 'start' ? 'M0 0h11' : 'M0 0h-11'
                          }
                        />
                        <text
                          className="knowledge-landscape__region-name"
                          x={textX}
                          y={place.labelLines.length > 1 ? -10 : 0}
                          textAnchor={place.labelSide}
                        >
                          {place.labelLines.map((line, lineIndex) => (
                            <tspan
                              key={`${place.id}:${line}`}
                              x={textX}
                              dy={lineIndex === 0 ? 0 : 25}
                            >
                              {line}
                            </tspan>
                          ))}
                        </text>
                        <text
                          className="knowledge-landscape__region-count"
                          x={textX}
                          y={place.labelLines.length > 1 ? 43 : 24}
                          textAnchor={place.labelSide}
                        >
                          {region?.count ?? 1} places
                        </text>
                      </>
                    ) : (
                      <>
                        <rect
                          className="knowledge-landscape__place-hit"
                          x={hitX}
                          y="-28"
                          width={labelWidth + 50}
                          height={Math.max(
                            55,
                            place.labelLines.length * 19 + 28,
                          )}
                          rx="3"
                        />
                        <path
                          className="knowledge-landscape__place-mark"
                          d={`M0 ${-markRadius} ${markRadius} 0 0 ${markRadius} ${-markRadius} 0Z`}
                        />
                        <text
                          className="knowledge-landscape__place-name"
                          x={textX}
                          y={place.labelLines.length > 1 ? -5 : 5}
                          textAnchor={place.labelSide}
                        >
                          {place.labelLines.map((line, lineIndex) => (
                            <tspan
                              key={`${place.id}:${line}`}
                              x={textX}
                              dy={lineIndex === 0 ? 0 : 18}
                            >
                              {line}
                            </tspan>
                          ))}
                        </text>
                      </>
                    )}
                  </g>
                );
              })}
            </g>
          </g>
        </svg>
      </div>

      <nav className="knowledge-landscape__nav" aria-label="Garden navigation">
        <a href="/" className="knowledge-landscape__brand">
          oddava
        </a>
        <span aria-hidden="true">/</span>
        <a href="/notes">notes</a>
      </nav>

      <button
        ref={searchTriggerRef}
        type="button"
        className="knowledge-landscape__search-trigger"
        onClick={() => setSearchOpen(true)}
        aria-label="Find a note"
        aria-haspopup="dialog"
        aria-expanded={searchOpen}
      >
        <SearchIcon />
        <span>find</span>
        <kbd>/</kbd>
      </button>

      {selectedPlace && breadcrumbs.length > 0 && (
        <nav
          className="knowledge-landscape__context"
          aria-label="Current location"
        >
          {breadcrumbs.map(({ region, place }, index) => (
            <span key={region.id || 'root'}>
              {index > 0 && <i aria-hidden="true">/</i>}
              <button type="button" onClick={() => selectPlace(place.id)}>
                {region.title}
              </button>
            </span>
          ))}
          {!selectedPlace.isRegionAnchor && (
            <span>
              <i aria-hidden="true">/</i>
              <b>{selectedPlace.title}</b>
            </span>
          )}
        </nav>
      )}

      <div
        className="knowledge-landscape__controls"
        role="group"
        aria-label="Landscape controls"
      >
        <button
          type="button"
          onClick={() => zoomAt(1.24)}
          aria-label="Move closer"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => zoomAt(1 / 1.24)}
          aria-label="Move farther away"
        >
          −
        </button>
        <button
          type="button"
          onClick={resetWorld}
          aria-label="Return to the whole landscape"
        >
          <HomeIcon />
        </button>
      </div>

      {hintVisible && (
        <p className="knowledge-landscape__hint" aria-hidden="true">
          drag to wander <span>·</span> scroll or pinch to move closer
        </p>
      )}

      {cardPlace && (
        <article
          key={cardPlace.id}
          className={`knowledge-landscape__card${cardOpen ? '' : ' is-leaving'}`}
          aria-live="polite"
          aria-hidden={!cardOpen}
          inert={!cardOpen}
        >
          <button
            type="button"
            className="knowledge-landscape__card-close"
            onClick={() => closeSelection(true)}
            aria-label="Close place details"
          >
            <CloseIcon />
          </button>
          <p className="knowledge-landscape__card-location">
            {regionById.get(cardPlace.regionId)?.title ?? 'notes'}
          </p>
          <h1>{cardPlace.title}</h1>
          <p className="knowledge-landscape__card-summary">
            {cardPlace.summary ||
              'This place is still waiting for a first line.'}
          </p>
          <a className="knowledge-landscape__read" href={cardPlace.href}>
            read the note <span aria-hidden="true">↗</span>
          </a>

          {onwardPlaces.length > 0 && (
            <div className="knowledge-landscape__onward">
              <p>Related</p>
              <ul>
                {onwardPlaces.map(({ place, relation }) => (
                  <li key={place.id}>
                    <button type="button" onClick={() => selectPlace(place.id)}>
                      <span>{place.title}</span>
                      {relation === 'path' && <small>linked</small>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </article>
      )}

      {searchOpen && (
        <div
          className="knowledge-landscape__search-layer"
          role="dialog"
          aria-modal="true"
          aria-label="Find a note"
        >
          <button
            type="button"
            className="knowledge-landscape__search-dismiss"
            onClick={() => setSearchOpen(false)}
            aria-label="Close search"
            tabIndex={-1}
          />
          <section
            ref={searchPanelRef}
            className="knowledge-landscape__search-panel"
          >
            <label htmlFor="landscape-search">
              <SearchIcon />
              <input
                ref={searchRef}
                id="landscape-search"
                type="search"
                value={query}
                placeholder="find a thought"
                autoComplete="off"
                aria-controls="landscape-search-results"
                aria-activedescendant={
                  results[searchIndex]
                    ? `landscape-search-${results[searchIndex].id}`
                    : undefined
                }
                onInput={(event: TargetedInputEvent<HTMLInputElement>) =>
                  setQuery(event.currentTarget.value)
                }
                onKeyDown={onSearchKeyDown}
              />
              <button
                type="button"
                onClick={() => setSearchOpen(false)}
                aria-label="Close search"
              >
                <CloseIcon />
              </button>
            </label>
            <p aria-live="polite">
              {normalizedQuery
                ? `${results.length} ${results.length === 1 ? 'place' : 'places'}`
                : 'start anywhere'}
            </p>
            <ul id="landscape-search-results" role="listbox">
              {results.map((result, index) => (
                <li key={result.id} role="presentation">
                  <button
                    id={`landscape-search-${result.id}`}
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
                      {
                        regionById.get(placeById.get(result.id)?.regionId ?? '')
                          ?.title
                      }
                    </small>
                  </button>
                </li>
              ))}
              {results.length === 0 && (
                <li className="is-empty">nothing has settled there yet</li>
              )}
            </ul>
          </section>
        </div>
      )}

      <p className="knowledge-landscape__sr-status" aria-live="polite">
        {selectedPlace
          ? `${selectedPlace.title} selected.`
          : 'Exploring the notes landscape.'}
      </p>
    </section>
  );
}
