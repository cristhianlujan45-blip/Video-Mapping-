import { useEffect, useRef, useState, type ReactNode } from 'react';
import { show } from '../core/show';
import { useParamValue, useShow } from './hooks';
import { Icon } from './icons';

const fmt = (v: number, step?: number) => {
  if (step !== undefined && step >= 1) return String(Math.round(v));
  const a = Math.abs(v);
  return a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2);
};

/** Plain slider (local value). Drag horizontally, Shift = fine, double click = reset. */
export function Slider({
  value,
  min,
  max,
  onChange,
  onStart,
  onEnd,
  label,
  base,
  step,
  def,
  unit,
  modulated,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  onStart?: () => void;
  onEnd?: () => void;
  label?: string;
  base?: number;
  step?: number;
  def?: number;
  unit?: string;
  modulated?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const span = max - min || 1;
  const frac = Math.max(0, Math.min(1, (value - min) / span));
  const set = (clientX: number, fine: boolean, startX: number, startV: number) => {
    const r = ref.current!.getBoundingClientRect();
    let v = fine ? startV + ((clientX - startX) / r.width) * span * 0.1 : min + ((clientX - r.left) / r.width) * span;
    if (step) v = Math.round(v / step) * step;
    onChange(Math.max(min, Math.min(max, v)));
  };
  return (
    <div
      ref={ref}
      className={`slider${modulated ? ' mod' : ''}`}
      title={label}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        const startX = e.clientX;
        const startV = value;
        onStart?.();
        if (!e.shiftKey) set(e.clientX, false, startX, startV);
        const move = (ev: PointerEvent) => set(ev.clientX, ev.shiftKey, startX, startV);
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          onEnd?.();
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      }}
      onDoubleClick={() => {
        if (def === undefined) return;
        onStart?.();
        onChange(def);
        onEnd?.();
      }}
      onWheel={(e) => {
        const d = (e.deltaY < 0 ? 1 : -1) * (step ?? span / 100) * (e.shiftKey ? 0.1 : 1);
        onChange(Math.max(min, Math.min(max, value + d)));
      }}
    >
      <div className="fill" style={{ width: `${frac * 100}%` }} />
      {base !== undefined && Math.abs(base - value) > span * 0.002 && <div className="base" style={{ left: `${((base - min) / span) * 100}%` }} />}
      {label && <span className="name">{label}</span>}
      <span className="val">
        {fmt(value, step)}
        {unit ? ` ${unit}` : ''}
      </span>
    </div>
  );
}

/** Learn button for any parameter: arm → move a MIDI/OSC/DMX control → mapped. */
export function LearnButton({ param }: { param: string }) {
  const s = useShow();
  const armed = s.ui.learnTarget === param;
  const mapped = s.engine.mappingsFor(param).length;
  return (
    <button
      className={`btn icon sm learn${armed ? ' armed' : mapped ? ' mapped' : ''}`}
      title={armed ? 'Mueve un control MIDI / OSC / DMX… (clic para cancelar)' : mapped ? `${mapped} asignación(es). Clic: aprender otra` : 'MIDI/OSC/DMX Learn'}
      onClick={() => s.learn(armed ? null : param)}
    >
      <Icon name="learn" size={13} />
    </button>
  );
}

/** Slider bound to an engine parameter: shows live (modulated) value, saves base value, has Learn. */
export function ParamSlider({ id, label, learn = true }: { id: string; label?: string; learn?: boolean }) {
  const s = useShow();
  const value = useParamValue(id);
  const p = s.engine.get(id);
  if (!p) return null;
  const base = s.engine.baseValue(id);
  const step = p.type === 'int' || p.type === 'enum' ? 1 : undefined;
  return (
    <div className="row">
      <Slider
        value={value}
        min={p.min}
        max={p.max}
        base={base}
        def={p.default}
        step={step}
        unit={p.unit}
        label={label ?? p.name}
        modulated={base !== undefined && Math.abs(base - value) > (p.max - p.min) * 0.002}
        onStart={() => s.beginEdit()}
        onEnd={() => s.commitEdit()}
        onChange={(v) => s.setParam(id, v)}
      />
      {learn && <LearnButton param={id} />}
    </div>
  );
}

export function ParamToggle({ id, label }: { id: string; label?: string }) {
  const s = useShow();
  const v = useParamValue(id);
  const p = s.engine.get(id);
  if (!p) return null;
  return (
    <div className="row">
      <button className={`btn sm ${v >= 0.5 ? 'on' : ''}`} style={{ flex: 1, justifyContent: 'flex-start' }} onClick={() => s.setParam(id, v >= 0.5 ? 0 : 1)}>
        <span className="status-dot" style={{ background: v >= 0.5 ? 'var(--accent)' : undefined }} />
        {label ?? p.name}
      </button>
      <LearnButton param={id} />
    </div>
  );
}

export function TriggerButton({ id, label, className = '', icon }: { id: string; label: string; className?: string; icon?: string }) {
  const s = useShow();
  return (
    <span style={{ display: 'inline-flex', gap: 2 }}>
      <button className={`btn ${className}`} onClick={() => s.engine.fireTrigger(id, 'ui')}>
        {icon && <Icon name={icon} />}
        {label}
      </button>
      {s.ui.mode === 'pro' && <LearnButton param={id} />}
    </span>
  );
}

export function Section({ title, children, right }: { title: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="section">
      <h4>
        {title}
        <span className="spacer" />
        {right}
      </h4>
      {children}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="row">
      <label title={label}>{label}</label>
      {children}
    </div>
  );
}

export function NumberInput({ value, onChange, min, max, step = 1, width = 70 }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; width?: number }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(Math.round(value * 10000) / 10000)), [value]);
  const commit = () => {
    const v = Number(text);
    if (!Number.isFinite(v)) return setText(String(value));
    onChange(Math.max(min ?? -Infinity, Math.min(max ?? Infinity, v)));
  };
  return (
    <input
      type="number"
      style={{ width }}
      value={text}
      step={step}
      min={min}
      max={max}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
    />
  );
}

export function TextInput({ value, onChange, placeholder, style }: { value: string; onChange: (v: string) => void; placeholder?: string; style?: React.CSSProperties }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return <input type="text" value={text} placeholder={placeholder} style={{ flex: 1, ...style }} onChange={(e) => setText(e.target.value)} onBlur={() => text !== value && onChange(text)} onKeyDown={(e) => e.key === 'Enter' && onChange(text)} />;
}

export function Select<T extends string | number>({ value, options, onChange, style }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; style?: React.CSSProperties }) {
  return (
    <select value={String(value)} style={{ flex: 1, ...style }} onChange={(e) => onChange((typeof value === 'number' ? Number(e.target.value) : e.target.value) as T)}>
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Check({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="checkbox">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ title, children, onClose, footer }: { title: string; children: ReactNode; onClose: () => void; footer?: ReactNode }) {
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3>{title}</h3>
        <div className="mbody">{children}</div>
        <div className="mfoot">{footer ?? <button className="btn" onClick={onClose}>Cerrar</button>}</div>
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ value, tabs, onChange }: { value: T; tabs: { id: T; label: string; badge?: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="tabs">
      {tabs.map((t) => (
        <button key={t.id} className={t.id === value ? 'on' : ''} onClick={() => onChange(t.id)}>
          {t.label} {t.badge}
        </button>
      ))}
    </div>
  );
}

/** Honest marker for features that are not implemented yet. */
export function InDevelopment({ children }: { children: ReactNode }) {
  return (
    <div className="dev-note">
      <span className="badge dev">EN DESARROLLO</span> {children}
    </div>
  );
}

export function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />;
}

export { show };
