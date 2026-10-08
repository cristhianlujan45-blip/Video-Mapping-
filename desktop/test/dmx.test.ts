import { describe, expect, it } from 'vitest';
import {
  decodeArtDmx,
  decodeArtPollReply,
  encodeArtDmx,
  encodeArtPoll,
  encodeArtPollReply,
  isArtNet,
  opcode,
  OP_POLL,
  portAddress,
  splitPortAddress,
} from '../src/shared/dmx/artnet';
import { decodeSacnData, encodeSacnData, multicastAddress, randomCid } from '../src/shared/dmx/sacn';
import { encodePixel, patchPixels, pixelPositions, universesUsed, writePixelMap } from '../src/shared/dmx/pixelmap';
import { createPixelMap } from '../src/shared/project/defaults';

describe('Art-Net', () => {
  it('encodes ArtDmx per spec and decodes it back', () => {
    const data = new Uint8Array(512).map((_, i) => i & 0xff);
    const pkt = encodeArtDmx(portAddress(1, 2, 3), data, 7);
    expect(pkt.length).toBe(530);
    expect(new TextDecoder().decode(pkt.subarray(0, 7))).toBe('Art-Net');
    expect(pkt[8]).toBe(0x00);
    expect(pkt[9]).toBe(0x50);
    expect(pkt[11]).toBe(14);
    expect(pkt[14]).toBe(0x23); // SubUni
    expect(pkt[15]).toBe(1); // Net
    expect((pkt[16] << 8) | pkt[17]).toBe(512);
    const d = decodeArtDmx(pkt)!;
    expect(d.portAddress).toBe(portAddress(1, 2, 3));
    expect(d.sequence).toBe(7);
    expect(d.data[300]).toBe(300 & 0xff);
  });

  it('pads odd lengths to even', () => {
    expect(encodeArtDmx(0, new Uint8Array(3), 0).length).toBe(18 + 4);
  });

  it('ArtPoll and ArtPollReply', () => {
    const poll = encodeArtPoll();
    expect(isArtNet(poll)).toBe(true);
    expect(opcode(poll)).toBe(OP_POLL);
    const reply = encodeArtPollReply({ ip: '10.0.0.42', shortName: 'Node A', longName: 'Test node 4 ports', netSwitch: 0, subSwitch: 1, outputs: [0, 1, 2, 3] });
    const r = decodeArtPollReply(reply)!;
    expect(r.ip).toBe('10.0.0.42');
    expect(r.shortName).toBe('Node A');
    expect(r.numPorts).toBe(4);
    expect(r.outputUniverses).toEqual([16, 17, 18, 19]);
    expect(splitPortAddress(17)).toEqual({ net: 0, subnet: 1, universe: 1 });
  });
});

describe('sACN E1.31', () => {
  it('builds a 638-byte data packet with correct layers', () => {
    const cid = randomCid();
    const data = new Uint8Array(512).fill(9);
    const pkt = encodeSacnData({ universe: 258, data, sequence: 3, cid, sourceName: 'LUJAN', priority: 120 });
    expect(pkt.length).toBe(638);
    expect(((pkt[16] & 0x0f) << 8) | pkt[17]).toBe(622);
    expect(((pkt[38] & 0x0f) << 8) | pkt[39]).toBe(600);
    expect(((pkt[115] & 0x0f) << 8) | pkt[116]).toBe(523);
    expect((pkt[123] << 8) | pkt[124]).toBe(513);
    const d = decodeSacnData(pkt)!;
    expect(d.universe).toBe(258);
    expect(d.priority).toBe(120);
    expect(d.sourceName).toBe('LUJAN');
    expect(d.data.length).toBe(512);
    expect(multicastAddress(258)).toBe('239.255.1.2');
  });
});

describe('pixel map', () => {
  it('serpentine grid wiring', () => {
    const m = { ...createPixelMap('u'), cols: 3, rows: 2, order: 'serpentine' as const };
    const p = pixelPositions(m);
    expect(p).toHaveLength(6);
    expect(p[0].x).toBeLessThan(p[1].x);
    expect(p[3].x).toBeGreaterThan(p[4].x); // second row runs back
    expect(p[3].y).toBeGreaterThan(p[0].y);
  });

  it('auto span + align: RGB fits 170 pixels per universe', () => {
    const patch = patchPixels(256, 'RGB', 1, { autoSpan: true, alignPixels: true, pixelsPerUniverse: 0 });
    expect(patch[169]).toEqual({ universeOffset: 0, channel: 508 });
    expect(patch[170]).toEqual({ universeOffset: 1, channel: 1 });
    expect(universesUsed(patch)).toBe(2);
  });

  it('without align a pixel is split across universes', () => {
    const patch = patchPixels(200, 'RGB', 1, { autoSpan: true, alignPixels: false, pixelsPerUniverse: 0 });
    expect(patch[170]).toEqual({ universeOffset: 0, channel: 511, split: { universeOffset: 1, channel: 1, firstBytes: 2 } });
    expect(patch[171]).toEqual({ universeOffset: 1, channel: 2 });
  });

  it('without auto span pixels that do not fit are dropped', () => {
    const patch = patchPixels(200, 'RGBW', 1, { autoSpan: false, alignPixels: true, pixelsPerUniverse: 0 });
    expect(patch.filter(Boolean)).toHaveLength(128);
  });

  it('pixels-per-universe limit', () => {
    const patch = patchPixels(20, 'RGB', 1, { autoSpan: true, alignPixels: true, pixelsPerUniverse: 10 });
    expect(patch[10]).toEqual({ universeOffset: 1, channel: 1 });
  });

  it('RGBW white extraction and channel order', () => {
    const out = new Uint8Array(4);
    encodePixel(1, 1, 0.5, 'RGBW', { brightness: 1, gamma: 1, saturation: 1, contrast: 1, whiteExtraction: true }, out, 0);
    expect([...out]).toEqual([128, 128, 0, 128]);
    const grb = new Uint8Array(3);
    encodePixel(1, 0, 0, 'GRB', { brightness: 1, gamma: 1, saturation: 1, contrast: 1, whiteExtraction: false }, grb, 0);
    expect([...grb]).toEqual([0, 255, 0]);
  });

  it('writes colors into universe buffers', () => {
    const m = { ...createPixelMap('u'), cols: 2, rows: 1, format: 'RGB' as const };
    const patch = patchPixels(2, 'RGB', 1, m);
    const colors = new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]);
    const unis = [new Uint8Array(512)];
    writePixelMap(m, patch, colors, unis);
    expect([...unis[0].subarray(0, 6)]).toEqual([255, 0, 0, 0, 0, 255]);
  });
});
