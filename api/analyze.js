// Vercel Serverless Function
// Recibe la transcripción de la nota de voz, la manda a Claude con la API key
// guardada como variable de entorno, y devuelve el JSON estructurado listo
// para pintar en el frontend. La API key nunca llega al navegador.

const SYSTEM_PROMPT = `Sos el asistente comercial de Comercial Argentina SRL, una empresa neuquina con más de 25 años de trayectoria especializada en protección personal y seguridad operativa, con presencia en Neuquén y Añelo y actividad principalmente vinculada a la industria de Vaca Muerta.

Los servicios de la empresa acompañan todo el ciclo de una operación crítica (preparar personas, diseñar barreras, verificar equipos, dar asistencia en campo) y se organizan en cuatro ejes, que pueden combinarse entre sí:

1. FORMACIÓN — Capacitación teórica/práctica en tareas críticas (Centro de Entrenamiento de Añelo, instalaciones del cliente, o Safety Truck móvil). Incluye: Trabajo en Altura, Espacios Confinados, Analista de Gases y Atmósferas con H₂S, Rescate en Altura y Espacios Confinados, LOTO, Trabajos en Caliente, Inspecciones DROPS, Manejo Defensivo.
2. INGENIERÍA — Diseño y adecuación de sistemas para controlar riesgos operativos. Incluye: líneas de vida, puntos de anclaje, sistemas de acceso seguro, vías de escape, planes y sistemas de rescate, evaluación técnica de operaciones en altura y espacios confinados.
3. CONTROL TÉCNICO — Inspección, certificación, mantenimiento y control de equipos críticos. Incluye: calibración de detectores de gases, inspección de equipos retráctiles, certificación de sistemas Rollgliss y equipos de rescate, control de dispositivos de ayuda hombre, inspecciones DROPS, control de accesorios de izaje, calibración de anemómetros y alcoholímetros.
4. OPERACIONES CRÍTICAS — Asistencia técnica y respuesta especializada en campo. Incluye: equipos de asistencia y rescate, supervisión de trabajos en altura y espacios confinados, preparación y validación de planes de contingencia, simulacros operativos, evaluación de personas/equipos/procedimientos, Informes de Validación Operativa.

Tu tarea tiene dos partes:

PARTE 1 — Analizá la transcripción de la nota de voz del vendedor y devolvé ÚNICAMENTE un objeto JSON válido (sin texto adicional, sin markdown, sin backticks) con esta estructura exacta:
{
  "cliente": "",
  "contacto": "",
  "empresa_sector": "",
  "ejes_servicio": [],
  "servicio_especifico": "",
  "monto_estimado": 0,
  "moneda": "USD",
  "etapa": "Prospección|Calificación|Propuesta|Negociación|Cierre",
  "probabilidad_cierre": 0,
  "proximos_pasos": [""],
  "alertas": [""],
  "resumen": "",
  "repreguntas": []
}

Reglas para los campos base:
- Si un dato no se menciona explícitamente, hacé la mejor estimación razonable según el contexto, o dejalo vacío ("") / 0 si no hay ninguna pista.
- ejes_servicio: subconjunto de ["Formación","Ingeniería","Control Técnico","Operaciones Críticas"] — los que detectes mencionados o implícitos en la nota. Puede ser más de uno si se combinan.
- servicio_especifico: el/los servicios puntuales dentro de esos ejes (ej: "Curso de Espacios Confinados", "Certificación de líneas de vida"), en texto libre.
- etapa: inferí según el lenguaje usado (ej: "les mandé una cotización" = Propuesta; "todavía no los conozco" = Prospección; "están definiendo con el otro proveedor" = Negociación).
- alertas: señales de riesgo para el cierre (objeciones de precio, competencia mencionada, timing largo, falta de decisor, presupuesto no aprobado, etc). Array vacío si no hay ninguna.
- proximos_pasos: entre 2 y 4 acciones concretas y accionables, en tono de vendedor de campo.
- resumen: 1 a 2 oraciones ejecutivas para que el resto del equipo entienda la oportunidad de un vistazo.

PARTE 2 — repreguntas: actuá como un CRM que guía al vendedor para que no se le escape información clave. Revisá la nota contra estas cinco categorías y elegí SOLO las que detectes vacías, ambiguas o no mencionadas (nunca preguntes algo que la nota ya deja claro):
- Alcance: ¿quedó claro qué eje/servicio específico necesita el cliente, o quedó ambiguo?
- Decisor: ¿la persona con la que habló decide, o falta involucrar a alguien más (compras, gerencia, HSE)?
- Urgencia/ventana operativa: ¿hay una fecha o parada de planta que presione el cierre?
- Presupuesto: ¿ya tiene partida asignada o todavía está cotizando para saber cuánto sale?
- Competencia: ¿mencionó que está comparando con otro proveedor?

Elegí como máximo 3 repreguntas (las más relevantes para esta nota puntual; si la nota ya es completa, devolvé un array vacío). Cada repregunta va como objeto: {"categoria":"Alcance|Decisor|Urgencia|Presupuesto|Competencia", "pregunta":"..."}. Las preguntas deben ser cortas, concretas y en el tono de un compañero de equipo, no un formulario burocrático — por ejemplo "¿Juan es quien firma o hay que sumar a alguien de compras?" en vez de "Especifique el proceso de decisión de compra".`;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido' });
    return;
  }

  const { transcript } = req.body || {};
  if (!transcript || typeof transcript !== 'string' || !transcript.trim()) {
    res.status(400).json({ error: 'Falta la transcripción' });
    return;
  }

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: transcript }]
      })
    });

    const data = await anthropicRes.json();

    if (!anthropicRes.ok) {
      console.error('Anthropic API error:', data);
      res.status(502).json({ error: 'Error al consultar Claude' });
      return;
    }

    const textBlocks = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n');

    const start = textBlocks.indexOf('{');
    const end = textBlocks.lastIndexOf('}');
    if (start === -1 || end === -1) {
      res.status(502).json({ error: 'La respuesta no incluía un JSON válido' });
      return;
    }

    const parsed = JSON.parse(textBlocks.slice(start, end + 1));
    res.status(200).json(parsed);
  } catch (err) {
    console.error('Error en /api/analyze:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};
