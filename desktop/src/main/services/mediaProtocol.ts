import { protocol } from 'electron';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

import { MEDIA_SCHEME } from '../../shared/media';

export { MEDIA_SCHEME };

const MIME: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  ogv: 'video/ogg',
  avi: 'video/x-msvideo',
  ts: 'video/mp2t',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  aac: 'audio/aac',
  m4a: 'audio/mp4',
  opus: 'audio/ogg',
  glb: 'model/gltf-binary',
  gltf: 'model/gltf+json',
  obj: 'text/plain',
  stl: 'model/stl',
  fbx: 'application/octet-stream',
  bin: 'application/octet-stream',
};

/** Must run before app 'ready'. */
export function registerMediaScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, bypassCSP: false } },
  ]);
}

/**
 * Serves local media files to the renderer with HTTP Range support so <video> can seek
 * and stream large files without loading them in RAM. URL: see shared/media.ts mediaUrl().
 * Relative URLs inside a model (glTF .bin / textures) resolve against the same folder.
 */
export function handleMediaProtocol() {
  protocol.handle(MEDIA_SCHEME, async (req) => {
    try {
      const url = new URL(req.url);
      const rawPath = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
      const filePath = rawPath.startsWith('~unc/')
        ? path.normalize('//' + rawPath.slice(5))
        : path.normalize(process.platform === 'win32' ? rawPath : '/' + rawPath.replace(/^\/+/, ''));
      const st = await fsp.stat(filePath);
      if (!st.isFile()) return new Response('Not found', { status: 404 });
      const type = MIME[path.extname(filePath).slice(1).toLowerCase()] ?? 'application/octet-stream';
      const range = req.headers.get('range');
      const headers: Record<string, string> = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*' };
      if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range);
        let start = m && m[1] ? parseInt(m[1], 10) : 0;
        let end = m && m[2] ? parseInt(m[2], 10) : st.size - 1;
        if (m && !m[1] && m[2]) {
          start = Math.max(0, st.size - parseInt(m[2], 10));
          end = st.size - 1;
        }
        end = Math.min(end, st.size - 1);
        if (start > end || start >= st.size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${st.size}` } });
        const stream = fs.createReadStream(filePath, { start, end });
        return new Response(Readable.toWeb(stream) as ReadableStream, {
          status: 206,
          headers: { ...headers, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${st.size}` },
        });
      }
      const stream = fs.createReadStream(filePath);
      return new Response(Readable.toWeb(stream) as ReadableStream, { status: 200, headers: { ...headers, 'Content-Length': String(st.size) } });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

