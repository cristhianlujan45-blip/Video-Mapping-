import { describe, expect, it } from 'vitest';
import { bitsFor, camToProj, correspondences, decodeGray, grayBit, largestContour, quadCorners, ransacHomography, simplifyPolygon, type GrayCapture } from '../src/shared/calibration/structuredLight';
import { mapPoint, squareToQuad } from '../src/shared/geometry/homography';

/**
 * Simulates a camera looking at a projected wall: camera pixel → projector pixel through
 * a known homography; the test checks that the decoder recovers it.
 */
describe('structured light calibration', () => {
  const PW = 1024;
  const PH = 768;
  const CW = 320;
  const CH = 240;
  // where the projector image lands in the camera (a keystoned trapezoid)
  const projQuadInCam = [
    { x: 40, y: 30 },
    { x: 290, y: 20 },
    { x: 300, y: 220 },
    { x: 30, y: 210 },
  ] as [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }];
  const unitToCam = squareToQuad(projQuadInCam)!;
  // camera → projector pixel
  const camToProjTrue = (x: number, y: number) => {
    // invert by sampling (numerical) — build inverse homography
    const inv = invert(unitToCam);
    const u = mapPoint(inv, x, y)!;
    return { x: u.x * PW, y: u.y * PH, inside: u.x >= 0 && u.y >= 0 && u.x < 1 && u.y < 1 };
  };

  function render(pattern: (px: number, py: number) => number): Uint8Array {
    const img = new Uint8Array(CW * CH);
    for (let y = 0; y < CH; y++)
      for (let x = 0; x < CW; x++) {
        const p = camToProjTrue(x + 0.5, y + 0.5);
        // ambient 30, projector adds 180 * pattern, surface albedo varies
        const albedo = 0.6 + 0.4 * Math.sin(x * 0.05) ** 2;
        img[y * CW + x] = Math.min(255, Math.round(30 + (p.inside ? 180 * pattern(Math.floor(p.x), Math.floor(p.y)) * albedo : 0)));
      }
    return img;
  }

  it('decodes projector coordinates and recovers the homography', () => {
    const bx = bitsFor(PW);
    const by = bitsFor(PH);
    const white = render(() => 1);
    const black = render(() => 0);
    const xCaps: GrayCapture[] = [];
    const yCaps: GrayCapture[] = [];
    for (let b = 0; b < bx; b++) xCaps.push({ normal: render((px) => grayBit(px, b)), inverted: render((px) => 1 - grayBit(px, b)) });
    for (let b = 0; b < by; b++) yCaps.push({ normal: render((_, py) => grayBit(py, b)), inverted: render((_, py) => 1 - grayBit(py, b)) });
    const d = decodeGray(CW, CH, white, black, xCaps, yCaps);
    expect(d.validCount).toBeGreaterThan(CW * CH * 0.5);
    // a decoded pixel matches the ground truth within a few projector pixels
    const p = camToProj(d, { x: 160, y: 120 })!;
    const t = camToProjTrue(160.5, 120.5);
    expect(Math.abs(p.x - t.x)).toBeLessThan(6);
    expect(Math.abs(p.y - t.y)).toBeLessThan(6);
    const { cam, proj } = correspondences(d, 6);
    let seed = 7;
    const r = ransacHomography(cam, proj, 300, 4, () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646)!;
    expect(r.inliers / cam.length).toBeGreaterThan(0.9);
    const q = mapPoint(r.h, 100, 100)!;
    const tq = camToProjTrue(100, 100);
    expect(Math.abs(q.x - tq.x)).toBeLessThan(3);
    expect(Math.abs(q.y - tq.y)).toBeLessThan(3);
  });

  it('finds the lit area contour and its 4 corners', () => {
    const white = render(() => 1);
    const black = render(() => 0);
    const mask = new Uint8Array(CW * CH);
    for (let i = 0; i < mask.length; i++) mask[i] = white[i] - black[i] > 40 ? 1 : 0;
    const contour = largestContour(mask, CW, CH);
    expect(contour.length).toBeGreaterThan(100);
    const simple = simplifyPolygon(contour, 2);
    expect(simple.length).toBeLessThan(20);
    const c = quadCorners(simple)!;
    c.forEach((p, i) => {
      expect(Math.abs(p.x - projQuadInCam[i].x)).toBeLessThan(5);
      expect(Math.abs(p.y - projQuadInCam[i].y)).toBeLessThan(5);
    });
  });
});

function invert(m: number[]) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map((x) => x / det) as never;
}
