import * as THREE from 'three';
import type { Mask } from '../../shared/project/model';

/**
 * Rasterizes masks (defined in content UV space) into an alpha texture, only when they
 * change. Masks intersect: each one can only hide more.
 */
export class MaskCache {
  private cache = new Map<string, { key: string; tex: THREE.CanvasTexture }>();
  private white: THREE.DataTexture;

  constructor() {
    this.white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    this.white.needsUpdate = true;
  }

  get identity() {
    return this.white;
  }

  get(ownerKey: string, masks: Mask[], aspect: number): THREE.Texture {
    const active = masks.filter((m) => m.enabled && m.opacity > 0);
    if (active.length === 0) return this.white;
    const key = JSON.stringify(active) + aspect.toFixed(3);
    const e = this.cache.get(ownerKey);
    if (e && e.key === key) return e.tex;
    const W = aspect >= 1 ? 1024 : Math.round(1024 * aspect);
    const H = aspect >= 1 ? Math.round(1024 / aspect) : 1024;
    const canvas = new OffscreenCanvas(Math.max(8, W), Math.max(8, H));
    const c = canvas.getContext('2d')!;
    c.fillStyle = '#fff';
    c.fillRect(0, 0, canvas.width, canvas.height);
    const tmp = new OffscreenCanvas(canvas.width, canvas.height);
    const t = tmp.getContext('2d')!;
    for (const m of active) {
      t.globalCompositeOperation = 'source-over';
      t.filter = 'none';
      t.clearRect(0, 0, tmp.width, tmp.height);
      const featherPx = Math.max(0, m.feather) * Math.max(tmp.width, tmp.height);
      if (!m.inverted) {
        t.fillStyle = `rgba(255,255,255,${1 - m.opacity})`;
        t.fillRect(0, 0, tmp.width, tmp.height);
        t.filter = featherPx > 0.5 ? `blur(${featherPx.toFixed(1)}px)` : 'none';
        t.fillStyle = '#fff';
        this.path(t, m, tmp.width, tmp.height);
        t.fill();
      } else {
        t.fillStyle = '#fff';
        t.fillRect(0, 0, tmp.width, tmp.height);
        t.globalCompositeOperation = 'destination-out';
        t.filter = featherPx > 0.5 ? `blur(${featherPx.toFixed(1)}px)` : 'none';
        t.fillStyle = `rgba(0,0,0,${m.opacity})`;
        this.path(t, m, tmp.width, tmp.height);
        t.fill();
      }
      c.globalCompositeOperation = 'destination-in';
      c.drawImage(tmp, 0, 0);
    }
    e?.tex.dispose();
    const tex = new THREE.CanvasTexture(canvas as unknown as HTMLCanvasElement);
    tex.flipY = false;
    tex.colorSpace = THREE.NoColorSpace;
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    this.cache.set(ownerKey, { key, tex });
    return tex;
  }

  private path(c: OffscreenCanvasRenderingContext2D, m: Mask, W: number, H: number) {
    c.beginPath();
    const p = m.points;
    if (m.shape === 'rectangle' && p.length >= 2) {
      const x = Math.min(p[0].x, p[1].x) * W;
      const y = Math.min(p[0].y, p[1].y) * H;
      c.rect(x, y, Math.abs(p[1].x - p[0].x) * W, Math.abs(p[1].y - p[0].y) * H);
    } else if (m.shape === 'ellipse' && p.length >= 2) {
      const cx = ((p[0].x + p[1].x) / 2) * W;
      const cy = ((p[0].y + p[1].y) / 2) * H;
      c.ellipse(cx, cy, (Math.abs(p[1].x - p[0].x) / 2) * W, (Math.abs(p[1].y - p[0].y) / 2) * H, 0, 0, Math.PI * 2);
    } else if (p.length >= 3) {
      c.moveTo(p[0].x * W, p[0].y * H);
      for (let i = 1; i < p.length; i++) c.lineTo(p[i].x * W, p[i].y * H);
      c.closePath();
    }
  }

  drop(ownerKey: string) {
    this.cache.get(ownerKey)?.tex.dispose();
    this.cache.delete(ownerKey);
  }
}
