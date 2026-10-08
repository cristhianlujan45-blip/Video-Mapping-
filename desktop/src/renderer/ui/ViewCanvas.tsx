import { useEffect, useRef, type ReactNode } from 'react';
import { show } from '../core/show';
import type { ViewSpec } from '../worker/protocol';

let counter = 0;

/**
 * A canvas whose pixels are produced by the render worker (OffscreenCanvas). The spec can
 * change (e.g. 3D view mode) without recreating the canvas.
 */
export function ViewCanvas({
  spec,
  label,
  labelClass,
  children,
  style,
  className,
  interactive,
}: {
  spec: Omit<ViewSpec, 'id'> & { id?: string };
  label?: string;
  labelClass?: string;
  children?: ReactNode;
  style?: React.CSSProperties;
  className?: string;
  /** Forward pointer/keyboard to the worker (3D viewport). */
  interactive?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const idRef = useRef<string>(spec.id ?? `view${++counter}`);
  const specKey = JSON.stringify(spec);

  useEffect(() => {
    const el = host.current!;
    const canvas = document.createElement('canvas');
    el.prepend(canvas);
    const id = idRef.current;
    show.render.attachCanvas(canvas, { ...spec, id, everyNth: spec.everyNth ?? previewEvery(spec.kind) });
    return () => {
      show.render.detach(id);
      canvas.remove();
    };
    // the canvas is created once per mount; spec updates go through updateView
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    show.render.updateView({ ...spec, id: idRef.current, everyNth: spec.everyNth ?? previewEvery(spec.kind) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specKey]);

  const forward = (kind: 'down' | 'move' | 'up' | 'wheel' | 'leave', e: React.PointerEvent | React.WheelEvent) => {
    const r = host.current!.getBoundingClientRect();
    show.render.send({
      type: 'pointer',
      viewId: idRef.current,
      event: {
        kind,
        x: (e.clientX - r.left) / r.width,
        y: (e.clientY - r.top) / r.height,
        button: 'button' in e ? e.button : 0,
        buttons: 'buttons' in e ? e.buttons : 0,
        shift: e.shiftKey,
        ctrl: e.ctrlKey,
        alt: e.altKey,
        deltaY: 'deltaY' in e ? e.deltaY : 0,
        width: r.width,
        height: r.height,
      },
    });
  };

  return (
    <div
      ref={host}
      className={`view ${className ?? ''}`}
      style={style}
      tabIndex={interactive ? 0 : undefined}
      onPointerDown={interactive ? (e) => {
        host.current?.focus();
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        forward('down', e);
      } : undefined}
      onPointerMove={interactive ? (e) => forward('move', e) : undefined}
      onPointerUp={interactive ? (e) => forward('up', e) : undefined}
      onPointerLeave={interactive ? (e) => forward('leave', e) : undefined}
      onWheel={interactive ? (e) => forward('wheel', e) : undefined}
      onContextMenu={interactive ? (e) => e.preventDefault() : undefined}
      onKeyDown={interactive ? (e) => {
        show.render.send({ type: 'key', viewId: idRef.current, key: e.key, code: e.code, shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, down: true });
        if (e.code.startsWith('Numpad') || ['KeyG', 'KeyR', 'KeyS', 'KeyX', 'KeyY', 'KeyZ', 'Escape', 'Enter'].includes(e.code)) e.preventDefault();
      } : undefined}
    >
      {label && <div className={`view-label ${labelClass ?? ''}`}>{label}</div>}
      {children}
    </div>
  );
}

function previewEvery(kind: ViewSpec['kind']) {
  if (kind === 'output' || kind === 'viewport3d') return 1;
  // UI previews run at the preview FPS (outputs are never reduced)
  return Math.max(1, Math.round(60 / Math.max(1, show.qualitySettings.previewFps)));
}
