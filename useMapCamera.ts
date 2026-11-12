import { ComponentRef, useLayoutEffect, useRef, useState } from 'react';
import { GestureResponderEvent, PanResponder, View } from 'react-native';
import { boundMapCamera, centreMapOn, MapCamera, MapViewport, mapScreenCentre, MIN_MAP_ZOOM, moveMapCamera } from './mapCamera';
import type { MapPoint } from './campusLocation';

type Touch = GestureResponderEvent['nativeEvent']['touches'][number];

function touchSample(touches: readonly Touch[]) {
  const [first, second] = touches;
  if (!first) return null;
  if (!second) return { key: String(first.identifier), x: first.pageX, y: first.pageY, span: 0 };
  return {
    key: [first.identifier, second.identifier].sort().join(':'),
    x: (first.pageX + second.pageX) / 2,
    y: (first.pageY + second.pageY) / 2,
    span: Math.hypot(first.pageX - second.pageX, first.pageY - second.pageY),
  };
}

export default function useMapCamera(
  viewport: MapViewport, zoom: number, centerTick: number, focus: MapPoint, onZoomChange?: (zoom: number) => void,
  onMapTap?: (point: MapPoint, camera: MapCamera) => void,
) {
  const [camera, setCamera] = useState(() => boundMapCamera({ x: 0, y: 146, zoom }, viewport));
  const surface = useRef<ComponentRef<typeof View>>(null);
  const pageOrigin = useRef({ x: 0, y: 0 });
  const current = useRef(camera);
  const inputs = useRef({ viewport, onZoomChange, onMapTap });
  inputs.current = { viewport, onZoomChange, onMapTap };
  const baseline = useRef<{ camera: MapCamera; sample: NonNullable<ReturnType<typeof touchSample>> } | null>(null);
  const lastCenterTick = useRef(0);

  const update = (next: MapCamera) => {
    const previous = current.current;
    if (next.zoom === previous.zoom && next.x === previous.x && next.y === previous.y) return;
    current.current = next;
    setCamera(next);
  };

  useLayoutEffect(() => {
    surface.current?.measure((_x, _y, _width, _height, pageX, pageY) => {
      pageOrigin.current = { x: pageX, y: pageY };
    });
  }, [viewport.width, viewport.height]);

  useLayoutEffect(() => {
    const centre = mapScreenCentre(viewport);
    const next = lastCenterTick.current !== centerTick
      ? centreMapOn(focus, zoom, viewport)
      : moveMapCamera(current.current, zoom, centre, centre, viewport);
    lastCenterTick.current = centerTick;
    update(next);
  }, [viewport.width, viewport.height, zoom, centerTick]);

  const responder = useRef<ReturnType<typeof PanResponder.create> | null>(null);
  if (!responder.current) {
    let tap: MapPoint | null = null;
    const rebase = (sample: ReturnType<typeof touchSample>) => {
      baseline.current = sample ? { camera: current.current, sample } : null;
    };
    const move = (sample: ReturnType<typeof touchSample>) => {
      if (!sample) return;
      const start = baseline.current;
      if (!start || start.sample.key !== sample.key) {
        rebase(sample);
        return;
      }
      const local = (point: MapPoint) => ({ x: point.x - pageOrigin.current.x, y: point.y - pageOrigin.current.y });
      const ratio = start.sample.span > 0 ? sample.span / start.sample.span : 1;
      const next = moveMapCamera(start.camera, start.camera.zoom * ratio, local(start.sample), local(sample), inputs.current.viewport);
      const zoomChanged = next.zoom !== current.current.zoom;
      update(next);
      if (zoomChanged) inputs.current.onZoomChange?.(next.zoom);
    };

    responder.current = PanResponder.create({
      onStartShouldSetPanResponderCapture: event => {
        rebase(touchSample(event.nativeEvent.touches));
        return event.nativeEvent.touches.length >= 2 || Boolean(inputs.current.onMapTap && current.current.zoom > MIN_MAP_ZOOM);
      },
      onMoveShouldSetPanResponderCapture: (event, gesture) => event.nativeEvent.touches.length >= 2 ||
        (!inputs.current.onMapTap && Math.hypot(gesture.dx, gesture.dy) > 5),
      onPanResponderGrant: event => {
        const { locationX, locationY, touches } = event.nativeEvent;
        tap = inputs.current.onMapTap && touches.length === 1 ? { x: locationX, y: locationY } : null;
        const sample = touchSample(event.nativeEvent.touches);
        if (sample && baseline.current?.sample.key !== sample.key) {
          rebase(sample);
        }
        surface.current?.measure((_x, _y, _width, _height, pageX, pageY) => {
          pageOrigin.current = { x: pageX, y: pageY };
        });
      },
      onPanResponderStart: ({ nativeEvent: { touches } }) => {
        if (touches.length >= 2) tap = null;
        const sample = touchSample(touches);
        if (sample && baseline.current?.sample.key !== sample.key) rebase(sample);
      },
      onPanResponderMove: (event, gesture) => {
        if (Math.hypot(gesture.dx, gesture.dy) > 5) tap = null;
        if (!tap) move(touchSample(event.nativeEvent.touches));
      },
      onPanResponderEnd: ({ nativeEvent: { touches, changedTouches } }) => {
        // The native event queue can coalesce the final move before a finger lifts.
        const finalTouches = new Map([...touches, ...changedTouches].map(touch => [touch.identifier, touch]));
        const sample = touchSample([...finalTouches.values()]);
        if (!tap && sample && baseline.current?.sample.key === sample.key) move(sample);
        rebase(touchSample(touches));
      },
      onPanResponderTerminationRequest: () => !inputs.current.onMapTap,
      onPanResponderRelease: () => {
        if (tap) inputs.current.onMapTap?.(tap, current.current);
        tap = null;
        baseline.current = null;
      },
      onPanResponderTerminate: () => { tap = null; baseline.current = null; },
    });
  }
  return { camera, surface, handlers: responder.current.panHandlers };
}
