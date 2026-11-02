// web/js/agent-connect.js
// ☰ → Ayuda y sistema → «🤖 Conectar un agente de IA (MCP)»: los comandos listos para copiar
// para que Claude Code, Cursor o Claude Desktop manejen LumaMap (server/mcp.js).
import { h, btn, hint, dialog, toast } from "./ui.js";
import { TOOLS } from "./agent-tools.js";

const q = (s) => /[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s;
/** Los comandos para cada agente. info: { command, script, env } (app de escritorio) o null (web). */
export function agentCommands(info) {
  const command = info?.command || "node", script = info?.script || "/ruta/a/lumamap/server/mcp.js", env = info?.env || {};
  const envFlags = Object.entries(env).map(([k, v]) => `-e ${k}=${v} `).join("");
  const json = JSON.stringify({ mcpServers: { lumamap: { command, args: [script], ...(Object.keys(env).length ? { env } : {}) } } }, null, 2);
  return { claude: `claude mcp add lumamap ${envFlags}-- ${q(command)} ${q(script)}`, json };
}

export async function openAgentConnect(app) {
  let info = null;
  try { info = await window.LumaDesktop?.agentInfo?.(); } catch {}
  const c = agentCommands(info);
  const copy = (text) => async () => { try { await navigator.clipboard.writeText(text); toast("Copiado"); } catch { toast("Selecciónalo y cópialo a mano", "warn"); } };
  const code = (text) => h("pre", { class: "codebox" }, text);
  const online = !!app.remote?.ws && app.remote.ws.readyState === 1;
  dialog({ title: "🤖 Conectar un agente de IA (MCP)", wide: true, content: h("div", { class: "col" },
    hint("Con MCP, un agente como Claude Code, Cursor o Claude Desktop maneja LumaMap: le pides «hazme un túnel de neón que lata con la música» y construye la red de nodos, la ajusta, pone efectos, mira el resultado y lo proyecta. Todo se puede deshacer (Ctrl+Z)."),
    h("p", {}, online ? "✅ LumaMap está listo para recibir al agente en este equipo." : "⚠ Para que el agente llegue, LumaMap tiene que estar abierto (en la app de escritorio, o en el navegador con «node server/index.js»)."),
    h("h4", {}, "Claude Code"), code(c.claude), btn({ label: "📋 Copiar el comando", kind: "small", onClick: copy(c.claude) }),
    h("h4", {}, "Cursor, Claude Desktop y otros (configuración MCP)"), code(c.json), btn({ label: "📋 Copiar la configuración", kind: "small", onClick: copy(c.json) }),
    info ? null : hint("En la versión web cambia «/ruta/a/lumamap» por la carpeta donde está LumaMap (necesita Node.js 18 o más)."),
    h("details", {}, h("summary", {}, `Lo que puede hacer el agente (${TOOLS.length} herramientas)`),
      h("ul", {}, ...TOOLS.map(t => h("li", {}, h("b", {}, t.name), " — ", t.description.split(". ")[0] + ".")))),
    hint("Seguridad: solo un programa de este mismo equipo puede conectarse, y necesita la clave secreta que LumaMap guarda en tu carpeta de usuario (.lumamap/agent.json). Nadie de la red ni ninguna página web puede usarlo.")) });
}
