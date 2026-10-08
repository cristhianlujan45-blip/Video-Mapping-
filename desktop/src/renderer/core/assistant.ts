import type { Action, Condition, Project, Rule } from '../../shared/project/model';
import { uid } from '../../shared/project/model';
import type { Param } from '../../shared/params/types';
import { FEATURE_LABELS } from '../../shared/tracking/pose';
import { EFFECT_LIST } from '../../shared/project/effects';
import { lujan } from '../api';

/** What the assistant can actually do. Every tool maps to a real engine operation. */
export interface AssistantHost {
  project(): Project;
  params(): Param[];
  addRule(rule: Rule): void;
  setParam(id: string, value: number): void;
  goScene(compId: string): void;
  addAudioMapping(feature: string, param: string, min: number, max: number): string;
  addZone(name: string, rect: { x: number; y: number; w: number; h: number }): string;
  addEffect(target: 'layer' | 'composition', targetId: string, kind: string): string | null;
  blackout(on: boolean): void;
  createMacro(name: string, actions: Action[], delaysMs: number[]): string;
}

interface ContentBlock {
  type: string;
  id?: string;
  name?: string;
  input?: unknown;
  text?: string;
}

type Msg = { role: 'user' | 'assistant'; content: string | unknown[] };

const ACTION_SCHEMA = {
  type: 'object',
  description:
    'Acción: {"type":"set","param":"<paramId>","value":n} | {"type":"ramp","param":"<paramId>","value":n,"durationMs":n} | {"type":"trigger","param":"<paramId trigger>"} | {"type":"scene","compId":"<id de escena>"} | {"type":"blackout","on":true|false} | {"type":"transport","command":"play"|"pause"|"stop"|"next"|"previous"} | {"type":"macro","macroId":"<id>"}',
  properties: { type: { type: 'string', enum: ['set', 'ramp', 'trigger', 'scene', 'blackout', 'transport', 'macro'] } },
  required: ['type'],
};

const TOOLS = [
  {
    name: 'create_rule',
    description:
      'Crea una regla real del show: cuando TODAS las condiciones se cumplen se ejecutan las acciones; opcionalmente acciones al dejar de cumplirse. Las condiciones leen señales del bus (tracking, audio, zonas). Úsala para frases tipo "cuando levante la mano…", "cuando haya dos personas…", "cuando suene el bajo…".',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        conditions: {
          type: 'array',
          items: {
            type: 'object',
            properties: { feature: { type: 'string' }, op: { type: 'string', enum: ['>', '>=', '<', '<=', '==', '!=', 'rising', 'falling'] }, value: { type: 'number' } },
            required: ['feature', 'op', 'value'],
          },
        },
        actions: { type: 'array', items: ACTION_SCHEMA },
        otherwise: { type: 'array', items: ACTION_SCHEMA, description: 'Acciones cuando la condición deja de cumplirse (p. ej. restaurar el color).' },
        cooldown_ms: { type: 'number' },
      },
      required: ['name', 'conditions', 'actions'],
    },
  },
  {
    name: 'set_parameter',
    description: 'Cambia ahora mismo el valor de un parámetro (en sus unidades).',
    input_schema: { type: 'object', properties: { param_id: { type: 'string' }, value: { type: 'number' } }, required: ['param_id', 'value'] },
  },
  {
    name: 'go_scene',
    description: 'Lleva una escena (composición) al Program.',
    input_schema: { type: 'object', properties: { comp_id: { type: 'string' } }, required: ['comp_id'] },
  },
  {
    name: 'map_audio',
    description: 'Mapea una banda de audio a un parámetro (Audio → Glow, Bass → Scale, Beat → Flash, Volume → Brightness…).',
    input_schema: {
      type: 'object',
      properties: { feature: { type: 'string', enum: ['rms', 'bass', 'mid', 'treble', 'beat', 'onset'] }, param_id: { type: 'string' }, min: { type: 'number' }, max: { type: 'number' } },
      required: ['feature', 'param_id', 'min', 'max'],
    },
  },
  {
    name: 'create_zone',
    description: 'Crea una zona interactiva en la imagen de la cámara de tracking (coordenadas normalizadas 0..1). Genera las señales zone.<id>.count y zone.<id>.occupied.',
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } },
      required: ['name', 'x', 'y', 'w', 'h'],
    },
  },
  {
    name: 'add_effect',
    description: 'Añade un efecto GPU a una capa o a una escena completa.',
    input_schema: {
      type: 'object',
      properties: { target: { type: 'string', enum: ['layer', 'composition'] }, target_id: { type: 'string' }, kind: { type: 'string', enum: EFFECT_LIST.map((e) => e.kind) } },
      required: ['target', 'target_id', 'kind'],
    },
  },
  {
    name: 'create_macro',
    description: 'Crea una macro: varias acciones en secuencia (p. ej. SHOW START: escena 1, play, preset DMX…). Queda disponible como trigger para MIDI/OSC/teclado.',
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string' }, actions: { type: 'array', items: ACTION_SCHEMA }, delays_ms: { type: 'array', items: { type: 'number' } } },
      required: ['name', 'actions'],
    },
  },
  {
    name: 'blackout',
    description: 'Activa o quita el BLACKOUT de todas las salidas de video e iluminación.',
    input_schema: { type: 'object', properties: { on: { type: 'boolean' } }, required: ['on'] },
  },
];

function context(host: AssistantHost): string {
  const p = host.project();
  const params = host
    .params()
    .filter((x) => x.group !== 'Dibujo')
    .slice(0, 400)
    .map((x) => `${x.id} | ${x.name} | ${x.type} ${x.min}..${x.max}`)
    .join('\n');
  const scenes = p.compositions.map((c) => `${c.id} | ${c.name} | capas: ${c.layers.map((l) => `${l.id}=${l.name}`).join(', ')}`).join('\n');
  const features = Object.entries(FEATURE_LABELS)
    .map(([k, v]) => `${k} — ${v}`)
    .concat(p.tracking.zones.map((z) => `zone.${z.id}.count / zone.${z.id}.occupied — zona «${z.name}»`))
    .join('\n');
  return `Eres el asistente de LUJAN MAPPING Studio (projection mapping, VJ, iluminación DMX, tracking y show control).
Tu trabajo es CONFIGURAR el show de verdad llamando a las herramientas, no explicar cómo hacerlo.
Usa solo ids que existan en las listas. Si falta algo imprescindible (p. ej. no hay escena 3), dilo en una frase y no inventes ids.
Colores: el tono (hue) en grados: rojo 0, naranja 30, amarillo 60, verde 120, cian 180, azul 220, violeta 280. Si piden "cambiar el color" y no existe un efecto Color en la capa/escena, primero añádelo con add_effect y luego usa su parámetro fx.<id>.hue.
Responde al final con 1–3 frases en español describiendo lo que configuraste.

ESCENAS (id | nombre | capas):
${scenes || '(ninguna)'}

SEÑALES DISPONIBLES PARA CONDICIONES:
${features}

PARÁMETROS (id | nombre | tipo rango):
${params}`;
}

export interface AssistantTurn {
  role: 'user' | 'assistant';
  text: string;
  actions: string[];
  error?: string;
}

export class Assistant {
  private messages: Msg[] = [];
  readonly turns: AssistantTurn[] = [];
  busy = false;

  constructor(private host: AssistantHost) {}

  reset() {
    this.messages = [];
    this.turns.length = 0;
  }

  async ask(text: string): Promise<AssistantTurn> {
    this.busy = true;
    this.turns.push({ role: 'user', text, actions: [] });
    this.messages.push({ role: 'user', content: text });
    const done: string[] = [];
    let finalText = '';
    try {
      for (let step = 0; step < 8; step++) {
        const res = (await lujan!.invoke('ai:request', { system: context(this.host), messages: this.messages, tools: TOOLS })) as { content?: ContentBlock[]; stopReason?: string; error?: string };
        if (res.error || !res.content) throw new Error(res.error ?? 'Respuesta vacía');
        this.messages.push({ role: 'assistant', content: res.content });
        const uses = res.content.filter((b) => b.type === 'tool_use');
        finalText = res.content
          .filter((b) => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
          .trim();
        if (uses.length === 0 || res.stopReason !== 'tool_use') break;
        const results = uses.map((u) => {
          try {
            const out = this.exec(u.name!, (u.input ?? {}) as Record<string, unknown>);
            done.push(out);
            return { type: 'tool_result', tool_use_id: u.id, content: out };
          } catch (e) {
            return { type: 'tool_result', tool_use_id: u.id, content: (e as Error).message, is_error: true };
          }
        });
        this.messages.push({ role: 'user', content: results });
      }
      const turn: AssistantTurn = { role: 'assistant', text: finalText || (done.length ? 'Hecho.' : ''), actions: done };
      this.turns.push(turn);
      return turn;
    } catch (e) {
      const turn: AssistantTurn = { role: 'assistant', text: '', actions: done, error: (e as Error).message };
      this.turns.push(turn);
      // drop the dangling user message so the next question starts clean
      this.messages = [];
      return turn;
    } finally {
      this.busy = false;
    }
  }

  private requireParam(id: unknown): string {
    const s = String(id);
    if (!this.host.params().some((p) => p.id === s)) throw new Error(`El parámetro ${s} no existe`);
    return s;
  }

  private validateActions(list: unknown): Action[] {
    if (!Array.isArray(list)) return [];
    const p = this.host.project();
    return list.map((raw) => {
      const a = raw as Action;
      switch (a.type) {
        case 'set':
        case 'ramp':
        case 'trigger':
          this.requireParam(a.param);
          break;
        case 'scene':
          if (!p.compositions.some((c) => c.id === a.compId)) throw new Error(`La escena ${a.compId} no existe`);
          break;
        case 'macro':
          if (!p.macros.some((m) => m.id === a.macroId)) throw new Error(`La macro ${a.macroId} no existe`);
          break;
        case 'blackout':
        case 'transport':
          break;
        default:
          throw new Error(`Acción desconocida: ${(a as { type: string }).type}`);
      }
      return a;
    });
  }

  private exec(name: string, input: Record<string, unknown>): string {
    switch (name) {
      case 'create_rule': {
        const conditions = (input.conditions as Condition[]) ?? [];
        if (!conditions.length) throw new Error('La regla necesita al menos una condición');
        const rule: Rule = {
          id: uid('rule'),
          name: String(input.name ?? 'Regla IA'),
          enabled: true,
          when: conditions.map((c) => ({ feature: String(c.feature), op: c.op, value: Number(c.value) })),
          then: this.validateActions(input.actions),
          otherwise: this.validateActions(input.otherwise ?? []),
          cooldownMs: Number(input.cooldown_ms ?? 500),
          origin: 'ai',
        };
        this.host.addRule(rule);
        return `Regla creada: ${rule.name}`;
      }
      case 'set_parameter': {
        const id = this.requireParam(input.param_id);
        this.host.setParam(id, Number(input.value));
        return `${id} = ${input.value}`;
      }
      case 'go_scene': {
        const c = this.host.project().compositions.find((x) => x.id === input.comp_id);
        if (!c) throw new Error('Escena inexistente');
        this.host.goScene(c.id);
        return `Escena ${c.name} al Program`;
      }
      case 'map_audio': {
        const id = this.requireParam(input.param_id);
        this.host.addAudioMapping(String(input.feature), id, Number(input.min), Number(input.max));
        return `Audio ${input.feature} → ${id}`;
      }
      case 'create_zone': {
        const zid = this.host.addZone(String(input.name), { x: Number(input.x), y: Number(input.y), w: Number(input.w), h: Number(input.h) });
        return `Zona creada (señales zone.${zid}.count / zone.${zid}.occupied)`;
      }
      case 'add_effect': {
        const fx = this.host.addEffect(input.target as 'layer' | 'composition', String(input.target_id), String(input.kind));
        if (!fx) throw new Error('No se encontró la capa/escena');
        return `Efecto ${input.kind} añadido (parámetros fx.${fx}.*)`;
      }
      case 'create_macro': {
        const actions = this.validateActions(input.actions);
        const id = this.host.createMacro(String(input.name), actions, (input.delays_ms as number[]) ?? []);
        return `Macro creada (trigger macro.${id}.run)`;
      }
      case 'blackout':
        this.host.blackout(!!input.on);
        return input.on ? 'BLACKOUT activado' : 'BLACKOUT desactivado';
      default:
        throw new Error(`Herramienta desconocida ${name}`);
    }
  }
}
