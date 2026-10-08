import Anthropic from '@anthropic-ai/sdk';
import { log } from '../log';

/**
 * One turn of the show-control assistant. The renderer owns the tool loop: it sends the
 * conversation + tool definitions describing the REAL actions it can execute (create a
 * rule, set a parameter, go to a scene…), executes the returned tool_use blocks against
 * the engine and sends tool_result blocks back. The API key never leaves the main process.
 */
export interface AiRequest {
  system: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  tools: Anthropic.Beta.BetaTool[];
}

export type AiResponse =
  | { content: Anthropic.Beta.BetaContentBlock[]; stopReason: string | null; model: string }
  | { error: string };

export async function callClaude(apiKey: string, req: AiRequest): Promise<AiResponse> {
  const client = new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000 });
  try {
    const res = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      // Re-run on a fallback model if a safety classifier declines (category-routed).
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium' },
      system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
      tools: req.tools,
      messages: req.messages,
    });
    if (res.stop_reason === 'refusal') {
      return { error: 'El asistente no pudo procesar esta petición. Reformúlala como una acción concreta del show.' };
    }
    return { content: res.content, stopReason: res.stop_reason, model: res.model };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { error: 'Clave de API de Anthropic inválida.' };
    if (e instanceof Anthropic.RateLimitError) return { error: 'Límite de peticiones alcanzado. Intenta de nuevo en unos segundos.' };
    if (e instanceof Anthropic.APIConnectionError) return { error: 'Sin conexión con la API de Anthropic (el asistente IA necesita Internet).' };
    if (e instanceof Anthropic.APIError) {
      log.error('ai', `API ${e.status}`, e.message);
      return { error: `Error de la API (${e.status}): ${e.message}` };
    }
    log.error('ai', 'Fallo inesperado', e);
    return { error: (e as Error).message };
  }
}
