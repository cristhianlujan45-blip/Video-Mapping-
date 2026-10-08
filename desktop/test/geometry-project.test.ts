import { describe, expect, it } from 'vitest';
import { homographyFromPoints, invert3, mapPoint, squareToQuad, type Quad } from '../src/shared/geometry/homography';
import { evalMesh, meshFromQuad, resampleMesh, tessellate } from '../src/shared/geometry/warp';
import { parseProject, serializeProject, ProjectFormatError } from '../src/shared/project/codec';
import { createLayer, createProject } from '../src/shared/project/defaults';

const trapezoid: Quad = [
  { x: 0.2, y: 0.1 },
  { x: 0.8, y: 0.2 },
  { x: 0.9, y: 0.9 },
  { x: 0.1, y: 0.8 },
];

describe('homography', () => {
  it('maps unit square corners to the quad', () => {
    const h = squareToQuad(trapezoid)!;
    const corners = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    corners.forEach(([u, v], i) => {
      const p = mapPoint(h, u, v)!;
      expect(p.x).toBeCloseTo(trapezoid[i].x, 9);
      expect(p.y).toBeCloseTo(trapezoid[i].y, 9);
    });
    const inv = invert3(h)!;
    const back = mapPoint(inv, 0.5, 0.5)!;
    const fwd = mapPoint(h, back.x, back.y)!;
    expect(fwd.x).toBeCloseTo(0.5, 9);
  });

  it('rejects twisted quads', () => {
    expect(squareToQuad([trapezoid[0], trapezoid[2], trapezoid[1], trapezoid[3]])).toBeNull();
  });

  it('DLT homography agrees with the square solution', () => {
    const sq = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    const a = homographyFromPoints(sq, trapezoid)!;
    const b = squareToQuad(trapezoid)!;
    const pa = mapPoint(a, 0.3, 0.7)!;
    const pb = mapPoint(b, 0.3, 0.7)!;
    expect(pa.x).toBeCloseTo(pb.x, 8);
    expect(pa.y).toBeCloseTo(pb.y, 8);
  });
});

describe('mesh warp', () => {
  it('a mesh built from a quad reproduces the homography', () => {
    const m = meshFromQuad(trapezoid, 4, 3);
    const h = squareToQuad(trapezoid)!;
    for (const [u, v] of [
      [0.1, 0.1],
      [0.5, 0.5],
      [0.93, 0.27],
    ]) {
      const a = evalMesh(m, u, v);
      const b = mapPoint(h, u, v)!;
      expect(a.x).toBeCloseTo(b.x, 6);
      expect(a.y).toBeCloseTo(b.y, 6);
    }
  });

  it('bezier interpolation passes through control points', () => {
    const m = { ...meshFromQuad(trapezoid, 3, 3), interpolation: 'bezier' as const };
    m.points[5] = { x: m.points[5].x + 0.05, y: m.points[5].y };
    const p = evalMesh(m, 1 / 3, 1 / 3);
    expect(p.x).toBeCloseTo(m.points[5].x, 6);
    expect(resampleMesh(m, 6, 6).points).toHaveLength(49);
  });

  it('tessellates into indexed triangles', () => {
    const t = tessellate(meshFromQuad(trapezoid, 2, 2), 4);
    expect(t.positions.length).toBe(9 * 9 * 2);
    expect(t.indices.length).toBe(8 * 8 * 6);
  });
});

describe('project codec', () => {
  it('round-trips and fills defaults for missing keys', () => {
    const p = createProject('Show');
    p.compositions[0].layers.push(createLayer({ type: 'solid', color: '#ff0000' }, 'Rojo'));
    const back = parseProject(serializeProject(p));
    expect(back.name).toBe('Show');
    expect(back.compositions[0].layers[0].name).toBe('Rojo');
    const partial = JSON.stringify({ format: 'lujan-studio-project', version: 1, id: 'x', name: 'Viejo' });
    const old = parseProject(partial);
    expect(old.dmx.outputFps).toBe(40);
    expect(old.compositions.length).toBeGreaterThan(0);
  });

  it('keeps unknown keys from newer versions', () => {
    const p = JSON.parse(serializeProject(createProject()));
    p.futureFeature = { a: 1 };
    const back = parseProject(JSON.stringify(p)) as unknown as Record<string, unknown>;
    expect(back.futureFeature).toEqual({ a: 1 });
  });

  it('rejects foreign files', () => {
    expect(() => parseProject('{"hello":1}')).toThrow(ProjectFormatError);
    expect(() => parseProject('not json')).toThrow(ProjectFormatError);
  });
});
