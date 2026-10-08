import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** Keeps a child at a fixed aspect ratio, centered and as large as possible. */
export function FitBox({ aspect, children, style }: { aspect: number; children: ReactNode; style?: React.CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => {
      const W = el.clientWidth;
      const H = el.clientHeight;
      if (W / H > aspect) setSize({ w: Math.floor(H * aspect), h: H });
      else setSize({ w: W, h: Math.floor(W / aspect) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [aspect]);
  return (
    <div ref={ref} style={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', ...style }}>
      {size.w > 0 && <div style={{ width: size.w, height: size.h, position: 'relative' }}>{children}</div>}
    </div>
  );
}
