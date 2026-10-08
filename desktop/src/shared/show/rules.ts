import type { Action, Condition, Macro, Rule } from '../project/model';

/**
 * Feature bus: named numeric signals produced by tracking, audio, zones, timecode, DMX
 * input… ("tracking.person.count", "tracking.hand.any.raised", "audio.beat",
 * "zone.<id>.count"). Rules read features; they never poll devices directly.
 */
export class FeatureBus {
  private values = new Map<string, number>();
  private listeners = new Set<(changed: string[]) => void>();
  private changed = new Set<string>();

  set(key: string, v: number) {
    if (this.values.get(key) === v) return;
    this.values.set(key, v);
    this.changed.add(key);
  }

  get(key: string): number {
    return this.values.get(key) ?? 0;
  }

  has(key: string) {
    return this.values.has(key);
  }

  keys(): string[] {
    return [...this.values.keys()].sort();
  }

  /** Removes every feature with a prefix (camera/tracker gone). */
  clear(prefix: string) {
    for (const k of [...this.values.keys()]) {
      if (k.startsWith(prefix)) {
        this.values.delete(k);
        this.changed.add(k);
      }
    }
  }

  flush() {
    if (this.changed.size === 0) return;
    const c = [...this.changed];
    this.changed.clear();
    for (const l of this.listeners) l(c);
  }

  onChange(l: (changed: string[]) => void) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  snapshot(): Record<string, number> {
    return Object.fromEntries(this.values);
  }
}

function test(c: Condition, v: number, prev: number): boolean {
  switch (c.op) {
    case '>':
      return v > c.value;
    case '>=':
      return v >= c.value;
    case '<':
      return v < c.value;
    case '<=':
      return v <= c.value;
    case '==':
      return v === c.value;
    case '!=':
      return v !== c.value;
    case 'rising':
      return prev < c.value && v >= c.value;
    case 'falling':
      return prev >= c.value && v < c.value;
  }
}

/**
 * Evaluates rules on every feature change. A rule fires its `then` actions when all its
 * conditions become true (edge-triggered, with cooldown) and its `otherwise` actions
 * when they stop being true.
 */
export class RuleEngine {
  private active = new Map<string, boolean>();
  private lastFire = new Map<string, number>();
  private prev = new Map<string, number>();
  rules: Rule[] = [];

  constructor(
    private bus: FeatureBus,
    private exec: (a: Action, rule: Rule) => void,
    private now: () => number = () => performance.now(),
  ) {}

  setRules(rules: Rule[]) {
    this.rules = rules;
    for (const id of [...this.active.keys()]) if (!rules.some((r) => r.id === id)) this.active.delete(id);
  }

  /** Call after features changed (once per tick). */
  evaluate() {
    const t = this.now();
    for (const r of this.rules) {
      if (!r.enabled || r.when.length === 0) continue;
      const ok = r.when.every((c) => test(c, this.bus.get(c.feature), this.prev.get(c.feature) ?? 0));
      const edgeOnly = r.when.some((c) => c.op === 'rising' || c.op === 'falling');
      const was = this.active.get(r.id) ?? false;
      if (ok && (!was || edgeOnly)) {
        const last = this.lastFire.get(r.id) ?? -Infinity;
        if (t - last >= r.cooldownMs) {
          this.lastFire.set(r.id, t);
          for (const a of r.then) this.exec(a, r);
        }
      } else if (!ok && was && !edgeOnly) {
        for (const a of r.otherwise) this.exec(a, r);
      }
      this.active.set(r.id, ok && !edgeOnly);
    }
    for (const r of this.rules) for (const c of r.when) this.prev.set(c.feature, this.bus.get(c.feature));
  }

  isActive(ruleId: string) {
    return this.active.get(ruleId) ?? false;
  }
}

/** Runs macro steps with their delays; cancellable. */
export class MacroRunner {
  private timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(private exec: (a: Action) => void) {}

  run(m: Macro) {
    let t = 0;
    for (const step of m.steps) {
      t += Math.max(0, step.delayMs);
      if (t === 0) {
        this.exec(step.action);
        continue;
      }
      const h = setTimeout(() => {
        this.timers.delete(h);
        this.exec(step.action);
      }, t);
      this.timers.add(h);
    }
  }

  cancelAll() {
    for (const h of this.timers) clearTimeout(h);
    this.timers.clear();
  }
}

/** Human-readable description of an action (UI lists, AI assistant confirmations). */
export function describeAction(a: Action, names: { param?: (id: string) => string; comp?: (id: string) => string } = {}): string {
  const pn = (id: string) => names.param?.(id) ?? id;
  switch (a.type) {
    case 'set':
      return `${pn(a.param)} = ${a.value}`;
    case 'ramp':
      return `${pn(a.param)} → ${a.value} en ${a.durationMs} ms`;
    case 'trigger':
      return `Disparar ${pn(a.param)}`;
    case 'scene':
      return `Escena ${names.comp?.(a.compId) ?? a.compId}`;
    case 'cue':
      return `Cue ${a.cueId}`;
    case 'macro':
      return `Macro ${a.macroId}`;
    case 'dmxSnapshot':
      return `Snapshot DMX ${a.snapshotId}`;
    case 'blackout':
      return a.on ? 'BLACKOUT' : 'Quitar blackout';
    case 'transport':
      return { play: 'Play', pause: 'Pausa', stop: 'Stop', next: 'Siguiente', previous: 'Anterior' }[a.command];
  }
}
