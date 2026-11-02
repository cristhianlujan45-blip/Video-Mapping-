// web/js/agent-tools.js
// Las herramientas que LumaMap ofrece a un agente de IA (Claude Code, Cursor, Claude Desktop…)
// por MCP. Solo datos: los usa el servidor MCP (server/mcp.js) para anunciarlas y la app
// (agent.js) para hacerlas. Nombres y descripciones pensados para que el agente sepa usarlas solo.

const str = (description) => ({ type: "string", description });
const num = (description) => ({ type: "number", description });
const bool = (description) => ({ type: "boolean", description });
const obj = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const NET = str("Red (nombre o id). Si no se dice, la última red usada; si no hay ninguna, se crea.");
const SURF = str("Superficie (nombre o id). Si no se dice, la elegida en el editor.");

export const TOOLS = [
  { name: "lumamap_status", description: "Estado de LumaMap: proyecto, superficies y lo que muestran, escenas, redes de nodos y si hay IA. Úsalo primero.",
    inputSchema: obj({}) },
  { name: "list_operators", description: "Catálogo de operadores de las redes de nodos (como TouchDesigner: TOP imagen, CHOP señales, SOP geometría, COMP objetos 3D, MAT materiales, DAT texto) con sus parámetros y rangos.",
    inputSchema: obj({ family: str("TOP, CHOP, SOP, COMP, MAT o DAT (opcional)"), query: str("Buscar por nombre (opcional)") }) },
  { name: "get_network", description: "Una red de nodos: cada nodo con su operador, entradas, parámetros cambiados y su error si lo tiene.",
    inputSchema: obj({ network: NET }) },
  { name: "build_from_text", description: "«Escribe y se construye»: describe en lenguaje normal lo que quieres ver y LumaMap arma la red sola (con su IA o, sin IA, con su planificador). Ej.: «colores que bailan con la música en caleidoscopio con estela».",
    inputSchema: obj({ text: str("Lo que quieres ver"), network: NET, new_network: bool("Crear una red nueva para esto") }, ["text"]) },
  { name: "apply_plan", description: "Construye una red a partir de un PLAN JSON que escribes tú: {title, say, nodes:[{id, op:'TOP/noise', p:{param: valor | {e:'expresión'}}}], wires:[{from, to, input}], moves:[{node, param, with:'music|beat|wave|random|hand|motion', range:[de,a]}]}. Se valida todo (operadores, rangos, cables) y se añade la Salida, cámara, luz y render si faltan. Mira list_operators para los nombres.",
    inputSchema: obj({ plan: { type: "object", description: "El plan" }, network: NET, new_network: bool("Crear una red nueva") }, ["plan"]) },
  { name: "create_node", description: "Crea un nodo (op 'FAM/tipo', p. ej. 'TOP/blur') con parámetros; con 'after' se conecta detrás de ese nodo.",
    inputSchema: obj({ op: str("Operador, p. ej. TOP/kaleido"), name: str("Nombre (opcional)"), params: { type: "object", description: "Parámetros" }, after: str("Nodo del que sale (opcional)"), network: NET }, ["op"]) },
  { name: "connect", description: "Conecta la salida de un nodo a la entrada (0, 1…) de otro.",
    inputSchema: obj({ from: str("Nodo de origen"), to: str("Nodo de destino"), input: num("Entrada (0 por defecto)"), network: NET }, ["from", "to"]) },
  { name: "set_params", description: "Cambia parámetros de un nodo. Valores dentro de su rango; una expresión es {e:'absTime.seconds * 30'} y puede usar otros nodos por su nombre (lfo1.chan1, audio1.bass).",
    inputSchema: obj({ node: str("Nodo"), params: { type: "object", description: "Parámetros" }, network: NET }, ["node", "params"]) },
  { name: "move_with", description: "Hace que un parámetro de un nodo se mueva solo: con la música, el golpe, una onda suave, al azar, la mano o el movimiento delante de la cámara.",
    inputSchema: obj({ node: str("Nodo"), param: str("Parámetro (si no, el principal)"), with: { type: "string", enum: ["music", "beat", "wave", "random", "hand", "motion"] }, range: { type: "array", items: { type: "number" }, description: "[de, a] (opcional)" }, network: NET }, ["node", "with"]) },
  { name: "delete_nodes", description: "Borra nodos de una red.",
    inputSchema: obj({ nodes: { type: "array", items: { type: "string" }, description: "Nombres o ids" }, network: NET }, ["nodes"]) },
  { name: "project_network", description: "Proyecta la salida de una red (o un nodo de imagen) en una superficie del mapping.",
    inputSchema: obj({ network: NET, node: str("Nodo TOP (si no, la Salida)"), surface: SURF }) },
  { name: "list_effects", description: "Efectos de las superficies: presets por categoría (incluye «Analógico y película») y cada parámetro con su rango.",
    inputSchema: obj({ category: str("Categoría (opcional)") }) },
  { name: "set_effects", description: "Efectos de una superficie: un preset por su nombre y/o parámetros sueltos (p. ej. {film: 1, grain: 0.4, vhs: 0.5, kaleido: 6}). reset quita los que tenía.",
    inputSchema: obj({ surface: SURF, preset: str("Nombre del preset"), effects: { type: "object", description: "Parámetros" }, reset: bool("Empezar sin efectos") }) },
  { name: "list_animations", description: "Animaciones de la biblioteca (generadores en la GPU) que puede mostrar una superficie.",
    inputSchema: obj({ query: str("Buscar (opcional)") }) },
  { name: "set_animation", description: "Pone una animación de la biblioteca en una superficie.",
    inputSchema: obj({ name: str("Nombre de la animación"), surface: SURF }, ["name"]) },
  { name: "go_scene", description: "Va a una escena (por nombre o número desde 1).",
    inputSchema: obj({ scene: str("Nombre o número") }, ["scene"]) },
  { name: "get_image", description: "Lo que se ve ahora: la proyección completa o la imagen de un nodo de una red (PNG). Úsalo para comprobar el resultado.",
    inputSchema: obj({ network: str("Red (para ver un nodo)"), node: str("Nodo TOP (opcional)"), height: num("Alto en píxeles (por defecto 360)") }) },
];

export const TOOL_NAMES = new Set(TOOLS.map(t => t.name));
