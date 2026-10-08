/**
 * Parameter Engine types.
 *
 * Every controllable value in the application (layer opacity, effect amount, projector
 * brightness, DMX master, crossfader, "next cue" trigger…) is a Parameter registered in
 * ONE engine. MIDI, OSC, DMX input, audio analysis, tracking, timeline/automation, the
 * UI, macros, remote control and the AI assistant all write to parameters through the
 * same path, so there is a single mapping/learn/automation system instead of one per
 * protocol.
 */

export type ParamType = 'float' | 'int' | 'bool' | 'enum' | 'color' | 'trigger';

/**
 * How contributions from several sources are combined.
 *  - override: last value received from any source wins (LTP).
 *  - merge:    weighted average of all active sources (weight = mapping amount).
 *  - add:      base value + Σ(modulation − mapping.min) of every modulating source.
 *  - multiply: base value × Π(normalized modulation) of every modulating source.
 *  - max:      highest value among all active sources (HTP).
 *  - min:      lowest value among all active sources.
 */
export type MergeMode = 'override' | 'merge' | 'add' | 'multiply' | 'max' | 'min';

export type SourceKind =
  | 'ui'
  | 'midi'
  | 'osc'
  | 'dmx'
  | 'audio'
  | 'tracking'
  | 'timeline'
  | 'automation'
  | 'macro'
  | 'keyboard'
  | 'gamepad'
  | 'remote'
  | 'ai'
  | 'rule';

export interface ParamDef {
  id: string;
  name: string;
  type: ParamType;
  min: number;
  max: number;
  default: number;
  /** Grouping for UI / MIDI banks: "layer", "effect", "output", "dmx", "show"… */
  group?: string;
  unit?: string;
  /** For enum params: labels for the integer values 0..n-1. */
  options?: string[];
  merge?: MergeMode;
  /** Owner object id (layer id, output id…) so params can be removed with it. */
  owner?: string;
}

export interface Param extends ParamDef {
  merge: MergeMode;
  /** Final value after merging every contribution. */
  value: number;
}

/** Address of a physical/remote control that produced an input event. */
export interface InputAddress {
  kind: Extract<SourceKind, 'midi' | 'osc' | 'dmx' | 'keyboard' | 'gamepad' | 'audio' | 'tracking'>;
  /** MIDI: device name. DMX: "artnet"/"sacn". OSC: "osc". Audio: "audio". */
  device: string;
  /**
   * Protocol-specific control id.
   *  MIDI:  "cc:<ch>:<num>" | "note:<ch>:<num>" | "pb:<ch>" | "nrpn:<ch>:<num>" | "cc14:<ch>:<num>"
   *  OSC:   the address pattern, e.g. "/layer/1/opacity"
   *  DMX:   "<universe>:<channel>"  (channel 1..512)
   *  Audio: "rms" | "bass" | "mid" | "treble" | "beat" | "onset" | "band:<n>"
   *  Tracking: "<feature>" e.g. "person.count", "hand.left.raised", "joint.0.leftWrist.y"
   *  Keyboard: key code, e.g. "KeyB"
   */
  control: string;
}

export function addressKey(a: InputAddress): string {
  return `${a.kind}|${a.device}|${a.control}`;
}

export type ControlMode = 'absolute' | 'relative' | 'toggle' | 'momentary';

export type RelativeEncoding = 'twos-complement' | 'binary-offset' | 'signed-bit';

export interface Mapping {
  id: string;
  name?: string;
  enabled: boolean;
  source: InputAddress;
  /** Device name may be "*" to accept the control from any device. */
  target: string;
  /** Output range in parameter units. */
  min: number;
  max: number;
  invert: boolean;
  mode: ControlMode;
  relativeEncoding?: RelativeEncoding;
  /** Sensitivity for relative encoders (fraction of range per tick). */
  step?: number;
  /** Response curve exponent (1 = linear). */
  curve: number;
  /** Soft takeover / pickup for absolute controls. */
  softTakeover: boolean;
  /** Weight for the "merge" mode. */
  amount: number;
  /** Optional modifier that must be held (e.g. "SHIFT") for this mapping to be active. */
  modifier?: string;
  /** Bank/page this mapping belongs to ("" = always active). */
  bank?: string;
  /** Send value back to the controller (LEDs, motor faders) when the param changes. */
  feedback: boolean;
}

export interface Contribution {
  value: number;
  /** Monotonic sequence number: the latest write wins in override mode. */
  seq: number;
  weight: number;
  /** Lower bound of the mapping that produced it (used by add mode). */
  base: number;
}

export interface ParamChange {
  id: string;
  value: number;
  source: string;
}

export type FeedbackSink = (mapping: Mapping, normalized: number) => void;
