export const MEDIA_SCHEME = 'lujan-media';

/**
 * URL for a local file served by the media protocol. Every path segment is encoded
 * separately so relative references (glTF .bin, textures) resolve next to the file.
 */
export function mediaUrl(absPath: string): string {
  const norm = absPath.replace(/\\/g, '/');
  const segs = norm.split('/').filter((s) => s.length > 0);
  // Windows network share (\\server\share\…)
  if (norm.startsWith('//')) segs.unshift('~unc');
  return `${MEDIA_SCHEME}://file/${segs.map(encodeURIComponent).join('/')}`;
}
