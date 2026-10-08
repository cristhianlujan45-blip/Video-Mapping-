import type { ReactElement } from 'react';

const P = (d: string) => <path d={d} />;

const ICONS: Record<string, ReactElement> = {
  play: P('M7 5v14l11-7z'),
  pause: P('M7 5h4v14H7zM13 5h4v14h-4z'),
  stop: P('M6 6h12v12H6z'),
  next: P('M6 5l9 7-9 7zM16 5h2v14h-2z'),
  prev: P('M18 5l-9 7 9 7zM6 5h2v14H6z'),
  media: P('M4 5h16v14H4zM10 9v6l5-3z'),
  layers: P('M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17l9 5 9-5'),
  mapping: P('M4 6l7-2 9 3-2 13-12-2zM11 4l-1 16'),
  cube: P('M12 2l9 5v10l-9 5-9-5V7zM12 12l9-5M12 12v10M12 12L3 7'),
  camera: P('M4 7h3l2-2h6l2 2h3v12H4zM12 10a3.5 3.5 0 100 7 3.5 3.5 0 000-7z'),
  draw: P('M4 20l4-1 11-11-3-3L5 16zM14 6l3 3'),
  midi: P('M3 6h18v12H3zM7 6v7M11 6v7M15 6v7M7 13h1M11 13h1M15 13h1'),
  light: P('M9 18h6M10 21h4M12 3a6 6 0 00-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0012 3z'),
  audio: P('M3 10v4M7 7v10M11 4v16M15 8v8M19 11v2'),
  show: P('M4 4h16v4H4zM4 10h10v4H4zM4 16h16v4H4z'),
  remote: P('M7 2h10v20H7zM11 18h2'),
  ai: P('M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2zM18 15l1 2 2 1-2 1-1 2-1-2-2-1 2-1z'),
  perf: P('M3 18l5-6 4 3 5-8 4 5M3 21h18'),
  system: P('M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2'),
  video: P('M3 6h13v12H3zM16 10l5-3v10l-5-3z'),
  plus: P('M12 5v14M5 12h14'),
  trash: P('M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13'),
  copy: P('M8 8h12v12H8zM4 4h12v4M4 4v12h4'),
  eye: P('M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 100 6 3 3 0 000-6z'),
  eyeoff: P('M3 3l18 18M10.6 6.1A9.8 9.8 0 0112 6c6 0 10 6 10 6a17 17 0 01-3.2 3.8M6.2 7.6C3.7 9.4 2 12 2 12s4 7 10 7c1.8 0 3.4-.6 4.7-1.4'),
  lock: P('M6 11h12v10H6zM8 11V7a4 4 0 018 0v4'),
  unlock: P('M6 11h12v10H6zM8 11V7a4 4 0 017.5-2'),
  up: P('M12 5l-7 7h14z'),
  down: P('M12 19l-7-7h14z'),
  save: P('M5 4h11l3 3v13H5zM8 4v5h7V4M8 14h8v6H8z'),
  folder: P('M3 6h7l2 2h9v11H3z'),
  file: P('M6 3h8l4 4v14H6zM14 3v4h4'),
  undo: P('M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3'),
  redo: P('M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3'),
  learn: P('M4 12a8 8 0 0116 0M8 12a4 4 0 018 0M12 12v8'),
  close: P('M6 6l12 12M18 6L6 18'),
  check: P('M5 12l5 5 9-10'),
  warn: P('M12 3l10 18H2zM12 10v5M12 18v.5'),
  live: P('M12 9a3 3 0 100 6 3 3 0 000-6zM5.6 5.6a9 9 0 000 12.8M18.4 5.6a9 9 0 010 12.8M8.5 8.5a5 5 0 000 7M15.5 8.5a5 5 0 010 7'),
  output: P('M3 5h18v11H3zM8 20h8M12 16v4'),
  projector: P('M3 8h14v8H3zM17 10l4-2v8l-4-2M7 12a2 2 0 104 0 2 2 0 00-4 0'),
  grid: P('M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18'),
  export: P('M12 3v12M7 8l5-5 5 5M4 15v6h16v-6'),
  wand: P('M4 20L16 8M14 4v3M18 6h3M20 10v-3M15 2h0'),
  zone: P('M4 4h7v7H4zM13 13h7v7h-7zM4 15l3-3 3 3M15 7l3-3 3 3'),
  keyboard: P('M2 7h20v10H2zM6 11h1M10 11h1M14 11h1M18 11h1M7 14h10'),
  settings: P('M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H3a2 2 0 110-4h.1a1.6 1.6 0 001.5-1 1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H9a1.6 1.6 0 001-1.5V3a2 2 0 114 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V9a1.6 1.6 0 001.5 1H21a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z'),
};

export function Icon({ name, size = 16, title }: { name: keyof typeof ICONS | string; size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden={!title}>
      {title && <title>{title}</title>}
      {ICONS[name] ?? ICONS.file}
    </svg>
  );
}
