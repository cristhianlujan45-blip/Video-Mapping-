import { useEffect, useReducer, useRef, useSyncExternalStore } from 'react';
import { show } from '../core/show';

let version = 0;
const subs = new Set<() => void>();
function bump() {
  version++;
  for (const s of subs) s();
}
let wired = false;
function wire() {
  if (wired) return;
  wired = true;
  show.subscribe(bump);
  show.store.subscribe(bump);
}

/** Re-renders when the show/project changes (structure, selection, device state). */
export function useShow() {
  wire();
  useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => version,
  );
  return show;
}

export function useProject() {
  return useShow().project;
}

// ------------------------------------------------------------------ live params

const paramSubs = new Map<string, Set<() => void>>();
let paramWired = false;
function wireParams() {
  if (paramWired) return;
  paramWired = true;
  show.engine.onChange((changes) => {
    for (const c of changes) paramSubs.get(c.id)?.forEach((f) => f());
  });
}

/** Live value of a parameter (follows MIDI/OSC/DMX/audio/tracking/timeline modulation). */
export function useParamValue(id: string): number {
  wireParams();
  return useSyncExternalStore(
    (cb) => {
      let s = paramSubs.get(id);
      if (!s) paramSubs.set(id, (s = new Set()));
      s.add(cb);
      return () => s!.delete(cb);
    },
    () => show.engine.value(id),
  );
}

export function useInterval(fn: () => void, ms: number) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const h = setInterval(() => ref.current(), ms);
    return () => clearInterval(h);
  }, [ms]);
}

/** Re-render every `ms` (monitors, meters). */
export function useTicker(ms: number) {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useInterval(force, ms);
}
