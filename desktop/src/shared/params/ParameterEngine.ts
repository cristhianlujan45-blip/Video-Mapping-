import { decodeRelative } from '../midi/midi';
import {
  addressKey,
  type Contribution,
  type FeedbackSink,
  type InputAddress,
  type Mapping,
  type MergeMode,
  type Param,
  type ParamChange,
  type ParamDef,
} from './types';

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

interface MappingState {
  /** Last normalized input value (for soft takeover crossing detection and edges). */
  lastInput: number | null;
  pickedUp: boolean;
  toggled: boolean;
}

export interface LearnResult {
  address: InputAddress;
  param: string;
  mapping: Mapping;
}

export type ChangeListener = (changes: ParamChange[]) => void;
export type TriggerListener = (paramId: string, source: string) => void;
export type InputListener = (address: InputAddress, normalized: number) => void;
export type ContributionListener = (paramId: string, value: number, source: string) => void;

let idCounter = 0;
export const newMappingId = () => `map_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;

/**
 * The single parameter engine. Not thread-bound: it runs where the control UI runs and
 * pushes batched changes to the render worker, DMX service, remote clients, etc.
 */
export class ParameterEngine {
  private params = new Map<string, Param>();
  private contributions = new Map<string, Map<string, Contribution>>();
  private mappings = new Map<string, Mapping>();
  private mappingsByAddress = new Map<string, Set<string>>();
  private wildcardMappings = new Map<string, Set<string>>();
  private mappingState = new Map<string, MappingState>();
  private seq = 0;
  private pending = new Map<string, ParamChange>();
  private listeners = new Set<ChangeListener>();
  private triggerListeners = new Set<TriggerListener>();
  private inputListeners = new Set<InputListener>();
  private contributionListeners = new Set<ContributionListener>();
  private feedbackSinks = new Set<FeedbackSink>();
  private modifiers = new Set<string>();
  private learnTarget: string | null = null;
  private learnCallback: ((r: LearnResult) => void) | null = null;
  private learnKinds: Set<string> = new Set(['midi', 'osc', 'dmx', 'keyboard', 'gamepad']);
  activeBank = '';

  // ---------------------------------------------------------------- registration

  register(def: ParamDef): Param {
    const existing = this.params.get(def.id);
    if (existing) {
      // Re-registering keeps the current value (e.g. after a project reload).
      Object.assign(existing, { ...def, merge: def.merge ?? existing.merge, value: existing.value });
      existing.value = clamp(existing.value, def.min, def.max);
      return existing;
    }
    const p: Param = { ...def, merge: def.merge ?? 'override', value: clamp(def.default, def.min, def.max) };
    this.params.set(def.id, p);
    this.contributions.set(def.id, new Map([['ui', { value: p.value, seq: 0, weight: 1, base: def.min }]]));
    return p;
  }

  unregister(id: string) {
    this.params.delete(id);
    this.contributions.delete(id);
  }

  /** Removes every parameter owned by an object (layer, output, fixture…). Mappings stay so they come back on undo. */
  unregisterOwner(owner: string) {
    for (const [id, p] of this.params) if (p.owner === owner) this.unregister(id);
  }

  has(id: string) {
    return this.params.has(id);
  }

  get(id: string): Param | undefined {
    return this.params.get(id);
  }

  /** Base value written by the UI (what gets saved), without live modulation. */
  baseValue(id: string): number | undefined {
    return this.contributions.get(id)?.get('ui')?.value;
  }

  value(id: string, fallback = 0): number {
    return this.params.get(id)?.value ?? fallback;
  }

  normalized(id: string): number {
    const p = this.params.get(id);
    if (!p || p.max === p.min) return 0;
    return (p.value - p.min) / (p.max - p.min);
  }

  list(): Param[] {
    return [...this.params.values()];
  }

  setMergeMode(id: string, mode: MergeMode) {
    const p = this.params.get(id);
    if (!p) return;
    p.merge = mode;
    this.recompute(id, 'merge');
  }

  // ---------------------------------------------------------------- writes

  /**
   * Writes a value from a source. `source` is a free key such as "ui", "timeline",
   * "macro", "ai", "remote" or "midi:<mappingId>".
   */
  set(id: string, value: number, source = 'ui', weight = 1) {
    const p = this.params.get(id);
    if (!p) return;
    if (p.type === 'trigger') {
      if (value >= 0.5) this.fireTrigger(id, source);
      return;
    }
    let v = clamp(value, p.min, p.max);
    if (p.type === 'int' || p.type === 'enum') v = Math.round(v);
    if (p.type === 'bool') v = v >= 0.5 ? 1 : 0;
    const contribs = this.contributions.get(id)!;
    contribs.set(source, { value: v, seq: ++this.seq, weight, base: p.min });
    for (const l of this.contributionListeners) l(id, v, source);
    this.recompute(id, source);
  }

  /** Removes a source's contribution (timeline stopped, tracking lost, mapping deleted). */
  release(id: string, source: string) {
    const contribs = this.contributions.get(id);
    if (!contribs || source === 'ui' || !contribs.delete(source)) return;
    this.recompute(id, source);
  }

  /** Releases every contribution whose source key starts with a prefix (e.g. "timeline"). */
  releaseSource(prefix: string) {
    for (const [id, contribs] of this.contributions) {
      let changed = false;
      for (const key of [...contribs.keys()]) {
        if (key !== 'ui' && key.startsWith(prefix)) {
          contribs.delete(key);
          changed = true;
        }
      }
      if (changed) this.recompute(id, prefix);
    }
  }

  /** Resets a param to its default and drops every modulation. */
  reset(id: string) {
    const p = this.params.get(id);
    if (!p) return;
    this.contributions.set(id, new Map([['ui', { value: p.default, seq: ++this.seq, weight: 1, base: p.min }]]));
    this.recompute(id, 'reset');
  }

  fireTrigger(id: string, source = 'ui') {
    for (const l of this.triggerListeners) l(id, source);
  }

  private recompute(id: string, source: string) {
    const p = this.params.get(id);
    const contribs = this.contributions.get(id);
    if (!p || !contribs) return;
    const next = mergeContributions(p, contribs);
    if (next === p.value) return;
    p.value = next;
    this.pending.set(id, { id, value: next, source });
    // A change from any other source invalidates pickup of soft-takeover mappings.
    for (const m of this.mappings.values()) {
      if (m.target !== id || !m.softTakeover) continue;
      if (source === `${m.source.kind}:${m.id}`) continue;
      const st = this.mappingState.get(m.id);
      if (st) st.pickedUp = false;
    }
    this.sendFeedback(id, source);
  }

  // ---------------------------------------------------------------- change delivery

  /** Delivers every pending change since the last flush (call once per frame / tick). */
  flush(): ParamChange[] {
    if (this.pending.size === 0) return [];
    const changes = [...this.pending.values()];
    this.pending.clear();
    for (const l of this.listeners) l(changes);
    return changes;
  }

  onChange(l: ChangeListener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  onTrigger(l: TriggerListener) {
    this.triggerListeners.add(l);
    return () => this.triggerListeners.delete(l);
  }

  /** Every raw input event (MIDI monitor, learn UIs, rule engine). */
  onInput(l: InputListener) {
    this.inputListeners.add(l);
    return () => this.inputListeners.delete(l);
  }

  /** Every write with its source (automation recording). */
  onContribution(l: ContributionListener) {
    this.contributionListeners.add(l);
    return () => this.contributionListeners.delete(l);
  }

  onFeedback(sink: FeedbackSink) {
    this.feedbackSinks.add(sink);
    return () => this.feedbackSinks.delete(sink);
  }

  /** Sends the current value of every feedback mapping (after a controller reconnects). */
  resendFeedback(device?: string) {
    for (const m of this.mappings.values()) {
      if (!m.feedback || !m.enabled) continue;
      if (device && m.source.device !== device) continue;
      this.feedbackFor(m);
    }
  }

  private sendFeedback(paramId: string, source: string) {
    if (this.feedbackSinks.size === 0) return;
    for (const m of this.mappings.values()) {
      if (m.target !== paramId || !m.feedback || !m.enabled) continue;
      if (source === `${m.source.kind}:${m.id}`) continue;
      this.feedbackFor(m);
    }
  }

  private feedbackFor(m: Mapping) {
    const p = this.params.get(m.target);
    if (!p) return;
    const span = m.max - m.min;
    let n = span === 0 ? 0 : clamp((p.value - m.min) / span, 0, 1);
    if (m.curve !== 1 && m.curve > 0) n = Math.pow(n, 1 / m.curve);
    if (m.invert) n = 1 - n;
    for (const s of this.feedbackSinks) s(m, n);
  }

  // ---------------------------------------------------------------- mappings

  addMapping(partial: Partial<Mapping> & Pick<Mapping, 'source' | 'target'>): Mapping {
    const p = this.params.get(partial.target);
    const m: Mapping = {
      id: partial.id ?? newMappingId(),
      enabled: true,
      min: p?.min ?? 0,
      max: p?.max ?? 1,
      invert: false,
      mode: p?.type === 'bool' ? 'toggle' : p?.type === 'trigger' ? 'momentary' : 'absolute',
      curve: 1,
      softTakeover: false,
      amount: 1,
      feedback: true,
      ...partial,
    };
    this.mappings.set(m.id, m);
    this.indexMapping(m);
    this.mappingState.set(m.id, { lastInput: null, pickedUp: !m.softTakeover, toggled: false });
    return m;
  }

  updateMapping(id: string, patch: Partial<Mapping>) {
    const m = this.mappings.get(id);
    if (!m) return;
    this.unindexMapping(m);
    Object.assign(m, patch);
    this.indexMapping(m);
    if (patch.softTakeover !== undefined) {
      const st = this.mappingState.get(id);
      if (st) st.pickedUp = !m.softTakeover;
    }
  }

  removeMapping(id: string) {
    const m = this.mappings.get(id);
    if (!m) return;
    this.unindexMapping(m);
    this.mappings.delete(id);
    this.mappingState.delete(id);
    this.release(m.target, `${m.source.kind}:${m.id}`);
  }

  getMappings(): Mapping[] {
    return [...this.mappings.values()];
  }

  mappingsFor(paramId: string): Mapping[] {
    return this.getMappings().filter((m) => m.target === paramId);
  }

  setMappings(list: Mapping[]) {
    for (const id of [...this.mappings.keys()]) this.removeMapping(id);
    for (const m of list) this.addMapping(m);
  }

  private indexMapping(m: Mapping) {
    const index = m.source.device === '*' ? this.wildcardMappings : this.mappingsByAddress;
    const key = m.source.device === '*' ? `${m.source.kind}|${m.source.control}` : addressKey(m.source);
    let set = index.get(key);
    if (!set) index.set(key, (set = new Set()));
    set.add(m.id);
  }

  private unindexMapping(m: Mapping) {
    const index = m.source.device === '*' ? this.wildcardMappings : this.mappingsByAddress;
    const key = m.source.device === '*' ? `${m.source.kind}|${m.source.control}` : addressKey(m.source);
    index.get(key)?.delete(m.id);
  }

  // ---------------------------------------------------------------- modifiers / banks

  setModifier(name: string, held: boolean) {
    if (held) this.modifiers.add(name);
    else this.modifiers.delete(name);
  }

  isModifierHeld(name: string) {
    return this.modifiers.has(name);
  }

  // ---------------------------------------------------------------- learn

  /** Arms learn mode: the next input event creates a mapping to `paramId`. */
  startLearn(paramId: string, cb: (r: LearnResult) => void, kinds?: InputAddress['kind'][]) {
    this.learnTarget = paramId;
    this.learnCallback = cb;
    // Continuous sources (audio, tracking) are only learned when explicitly requested.
    this.learnKinds = new Set(kinds ?? ['midi', 'osc', 'dmx', 'keyboard', 'gamepad']);
  }

  cancelLearn() {
    this.learnTarget = null;
    this.learnCallback = null;
  }

  get learning(): string | null {
    return this.learnTarget;
  }

  // ---------------------------------------------------------------- input

  /**
   * Feeds a normalized (0..1) input. `extra.raw` is the raw 7-bit value (relative
   * encoders decode it with the mapping's encoding); `extra.ticks` is an already-signed
   * delta (OSC/gamepad relative inputs). Returns the number of mappings that consumed it.
   */
  input(address: InputAddress, normalized: number, extra?: { raw?: number; ticks?: number }): number {
    const relativeTicks = extra?.ticks;
    for (const l of this.inputListeners) l(address, normalized);

    if (this.learnTarget && this.learnKinds.has(address.kind)) {
      // Ignore note-off / zero values so releasing a pad does not learn twice.
      const isRelease = address.control.startsWith('note:') && normalized === 0;
      if (!isRelease && this.params.has(this.learnTarget)) {
        const target = this.learnTarget;
        const cb = this.learnCallback;
        this.learnTarget = null;
        this.learnCallback = null;
        // Relearning replaces the previous mapping from the same control to the same param.
        for (const m of this.getMappings()) {
          if (m.target === target && addressKey(m.source) === addressKey(address)) this.removeMapping(m.id);
        }
        const p = this.params.get(target)!;
        const isButton = address.control.startsWith('note:');
        const mode = relativeTicks !== undefined ? 'relative' : p.type === 'trigger' ? 'momentary' : p.type === 'bool' && isButton ? 'toggle' : 'absolute';
        const mapping = this.addMapping({ source: { ...address }, target, mode, bank: this.activeBank || undefined });
        cb?.({ address, param: target, mapping });
      }
      return 0;
    }

    const ids = new Set<string>();
    for (const id of this.mappingsByAddress.get(addressKey(address)) ?? []) ids.add(id);
    for (const id of this.wildcardMappings.get(`${address.kind}|${address.control}`) ?? []) ids.add(id);
    let consumed = 0;
    for (const id of ids) {
      const m = this.mappings.get(id);
      if (!m || !m.enabled) continue;
      if (m.bank && m.bank !== this.activeBank) continue;
      if (m.modifier && !this.modifiers.has(m.modifier)) continue;
      // A mapping without modifier is shadowed while a modifier mapping for the same control is active.
      if (!m.modifier && this.hasActiveModifierTwin(m, ids)) continue;
      this.applyMapping(m, normalized, extra);
      consumed++;
    }
    return consumed;
  }

  private hasActiveModifierTwin(m: Mapping, ids: Set<string>) {
    for (const id of ids) {
      const o = this.mappings.get(id);
      if (o && o !== m && o.enabled && o.modifier && this.modifiers.has(o.modifier)) return true;
    }
    return false;
  }

  private applyMapping(m: Mapping, normalizedIn: number, extra?: { raw?: number; ticks?: number }) {
    const p = this.params.get(m.target);
    if (!p) return;
    const st = this.mappingState.get(m.id)!;
    const sourceKey = `${m.source.kind}:${m.id}`;
    let n = clamp(normalizedIn, 0, 1);
    if (m.invert) n = 1 - n;
    const prevInput = st.lastInput;
    st.lastInput = n;

    switch (m.mode) {
      case 'relative': {
        const ticks = extra?.ticks ?? (extra?.raw !== undefined ? decodeRelative(extra.raw, m.relativeEncoding) : 0);
        if (ticks === 0) return;
        const step = (m.step ?? 1 / 128) * (m.max - m.min);
        this.set(m.target, p.value + ticks * step, sourceKey, m.amount);
        return;
      }
      case 'toggle': {
        const pressed = n >= 0.5;
        const wasPressed = (prevInput ?? 0) >= 0.5;
        if (!pressed || wasPressed) return;
        if (p.type === 'trigger') {
          this.fireTrigger(m.target, sourceKey);
          return;
        }
        st.toggled = !(p.value > (m.min + m.max) / 2);
        this.set(m.target, st.toggled ? m.max : m.min, sourceKey, m.amount);
        return;
      }
      case 'momentary': {
        const pressed = n >= 0.5;
        if (p.type === 'trigger') {
          if (pressed && (prevInput ?? 0) < 0.5) this.fireTrigger(m.target, sourceKey);
          return;
        }
        this.set(m.target, pressed ? m.max : m.min, sourceKey, m.amount);
        return;
      }
      case 'absolute':
      default: {
        if (p.type === 'trigger') {
          if (n >= 0.5 && (prevInput ?? 0) < 0.5) this.fireTrigger(m.target, sourceKey);
          return;
        }
        const shaped = m.curve !== 1 && m.curve > 0 ? Math.pow(n, m.curve) : n;
        const value = m.min + shaped * (m.max - m.min);
        if (m.softTakeover && !st.pickedUp) {
          const span = Math.abs(m.max - m.min) || 1;
          const current = p.value;
          const close = Math.abs(value - current) / span <= 0.03;
          let crossed = false;
          if (prevInput !== null) {
            const prevShaped = m.curve !== 1 && m.curve > 0 ? Math.pow(prevInput, m.curve) : prevInput;
            const prevValue = m.min + prevShaped * (m.max - m.min);
            crossed = (prevValue - current) * (value - current) <= 0;
          }
          if (!close && !crossed) return;
          st.pickedUp = true;
        }
        this.set(m.target, value, sourceKey, m.amount);
        // Our own write must not drop our pickup.
        st.pickedUp = true;
      }
    }
  }

  /** For tests and UIs: whether a soft-takeover mapping currently controls its param. */
  isPickedUp(mappingId: string) {
    return this.mappingState.get(mappingId)?.pickedUp ?? false;
  }

  // ---------------------------------------------------------------- persistence

  /** Base ("ui") values of every param, for saving into the project. */
  snapshotValues(filter?: (p: Param) => boolean): Record<string, number> {
    const out: Record<string, number> = {};
    for (const p of this.params.values()) {
      if (p.type === 'trigger') continue;
      if (filter && !filter(p)) continue;
      out[p.id] = this.contributions.get(p.id)?.get('ui')?.value ?? p.value;
    }
    return out;
  }

  restoreValues(values: Record<string, number>, source = 'ui') {
    for (const [id, v] of Object.entries(values)) if (this.params.has(id)) this.set(id, v, source);
  }
}

export function mergeContributions(p: Param, contribs: Map<string, Contribution>): number {
  const all = [...contribs.values()];
  if (all.length === 0) return p.default;
  const ui = contribs.get('ui')?.value ?? p.default;
  let v: number;
  switch (p.merge) {
    case 'override': {
      let best = all[0];
      for (const c of all) if (c.seq > best.seq) best = c;
      v = best.value;
      break;
    }
    case 'merge': {
      let sum = 0;
      let w = 0;
      for (const c of all) {
        sum += c.value * c.weight;
        w += c.weight;
      }
      v = w > 0 ? sum / w : ui;
      break;
    }
    case 'add': {
      v = ui;
      for (const [k, c] of contribs) if (k !== 'ui') v += (c.value - c.base) * c.weight;
      break;
    }
    case 'multiply': {
      v = ui;
      const span = p.max - p.min || 1;
      for (const [k, c] of contribs) {
        if (k === 'ui') continue;
        const factor = (c.value - p.min) / span;
        v *= 1 + (factor - 1) * c.weight;
      }
      break;
    }
    case 'max':
      v = Math.max(...all.map((c) => c.value));
      break;
    case 'min':
      v = Math.min(...all.map((c) => c.value));
      break;
  }
  v = clamp(v, p.min, p.max);
  if (p.type === 'int' || p.type === 'enum') v = Math.round(v);
  if (p.type === 'bool') v = v >= 0.5 ? 1 : 0;
  return v;
}
