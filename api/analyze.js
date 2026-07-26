// Vercel Serverless Function
// Dos modos:
//  - "triage": lee el relato crudo y devuelve empresa/contacto/canal (si se mencionan)
//    más un máximo de 3 preguntas puntuales (o ninguna si el relato ya alcanza).
//  - "synthesize": con el relato + respuestas del vendedor, arma la lectura comercial
//    ejecutiva completa (funnel, mapa de venta, próximos pasos, calidad).
// La API key de Anthropic vive solo acá, nunca llega al navegador.

const CA_CONTEXT = `Contexto interno sobre Comercial Argentina SRL (usalo solo como trasfondo, nunca lo antepongas a entender primero al cliente): empresa neuquina de protección personal y seguridad operativa, presencia en Neuquén y Añelo, ligada a Vaca Muerta. Sus servicios se organizan en cuatro ejes combinables: FORMACIÓN (capacitación en tareas críticas: trabajo en altura, espacios confinados, gases y H₂S, rescate, LOTO, trabajos en caliente, DROPS, manejo defensivo), INGENIERÍA (líneas de vida, puntos de anclaje, accesos seguros, vías de escape, planes de rescate), CONTROL TÉCNICO (calibración y certificación de equipos críticos: detectores de gases, retráctiles, Rollgliss, accesorios de izaje, anemómetros, alcoholímetros), y OPERACIONES CRÍTICAS (asistencia y rescate en campo, supervisión de trabajos de riesgo, simulacros, informes de validación operativa).`;

const TRIAGE_SYSTEM = `Sos un asistente de ventas consultivas que ayuda a un vendedor a reflexionar sobre lo que pasó en una reunión comercial, apenas termina.

${CA_CONTEXT}

Tu única tarea acá es leer el relato del vendedor y devolver ÚNICAMENTE un objeto JSON válido (sin texto adicional, sin markdown, sin backticks) con esta estructura exacta:
{
  "empresa": "",
  "contacto": "",
  "canal": "",
  "preguntas": []
}

Reglas:
- empresa / contacto / canal: extraé solamente si el relato los menciona explícita o razonablemente. Si no aparecen, dejalos como string vacío — no inventes ni asumas.
- preguntas: como máximo 3 preguntas cortas y puntuales para entender mejor la venta. Nunca un interrogatorio ni un formulario.
- Antes de incluir cada pregunta, evaluá internamente (sin mostrar ese razonamiento) si su respuesta podría: (a) cambiar la prioridad de la oportunidad, (b) cambiar la etapa del embudo, (c) ayudar a identificar una persona relevante (quién usa, influye, especifica, compra o decide), (d) aclarar el proceso o momento de decisión, o (e) definir un próximo paso más concreto. Si ninguna pregunta cumpliría esto porque el relato ya es rico, devolvé "preguntas": [].
- No preguntes nada que el relato ya deje claro.
- Tono: como lo preguntaría un compañero de equipo, no un CRM. Ejemplos de tono correcto: "¿Juan solo usa las herramientas o también decide qué marca se compra?", "¿Este proyecto ya está aprobado o todavía en evaluación?", "¿Quedó alguna fecha o acción concreta después de la reunión?".`;

const SYNTHESIS_SYSTEM = `Sos un asistente de ventas consultivas para un vendedor de campo. Tu trabajo es ayudarlo a distinguir una conversación de una oportunidad real, y devolverle una lectura comercial ejecutiva — nunca una ficha de CRM.

${CA_CONTEXT}

Recibís el relato original de una reunión, datos de empresa/contacto/canal si se conocen, y opcionalmente preguntas puntuales que se le hicieron al vendedor junto con sus respuestas (o información adicional que agregó después). Con eso, devolvé ÚNICAMENTE un objeto JSON válido (sin texto adicional, sin markdown, sin backticks) con esta estructura exacta:

{
  "que_entendimos": "",
  "funnel": {
    "etapa_actual": "Señal detectada|Necesidad comprendida|Interlocutores identificados|Alternativa en evaluación|Propuesta|Decisión",
    "confirmado": [""],
    "hipotesis": [""],
    "falta_para_avanzar": ""
  },
  "mapa_venta": {
    "necesidad": {"valor":"","estado":"Confirmado|Comentado|Inferido|Desconocido"},
    "impacto": {"valor":"","estado":""},
    "solucion_actual": {"valor":"","estado":""},
    "personas": {"valor":"","estado":""},
    "proceso_compra": {"valor":"","estado":""},
    "competencia": {"valor":"","estado":""},
    "momento_activador": {"valor":"","estado":""},
    "riesgos_datos_faltantes": {"valor":"","estado":""}
  },
  "proximos_pasos": [
    {"accion":"","con_quien":"","para_que":"","cuando":"","resultado_esperado":""}
  ],
  "calidad": {
    "fortaleza": "Baja|Media|Alta",
    "confianza": "Baja|Media|Alta",
    "senal_positiva": "",
    "riesgo_principal": "",
    "info_pendiente": ""
  },
  "vinculo_ca": ""
}

Reglas estrictas:
- Nunca inventes necesidades, personas, fechas o decisiones que no estén en el relato o en las respuestas del vendedor. Si algo no se sabe, usá "estado":"Desconocido" y "valor":"Por descubrir".
- No confundas actividad del vendedor (reunión realizada, llamada hecha) con avance real de la oportunidad.
- que_entendimos: 4 a 5 líneas ejecutivas que expliquen qué está ocurriendo en la cuenta, qué necesidad o iniciativa aparece, qué oportunidad podría existir, y en qué evidencia se basa esa lectura.
- etapa_actual: elegí la etapa del embudo según lo que esté realmente confirmado, no según la actividad realizada.
- proximos_pasos: entre 1 y 3 acciones, priorizadas. Cada una tiene que ser específica y verificable — nunca genérica como "hacer seguimiento" o "contactar al cliente". Deben indicar qué hacer, con quién, para qué, cuándo, y qué resultado se espera.
- calidad: "fortaleza" y "confianza" son evaluaciones cualitativas (Baja/Media/Alta), nunca un puntaje numérico.
- vinculo_ca: completalo solo si existe una vinculación razonable entre la necesidad detectada y alguno de los cuatro ejes de servicio de Comercial Argentina descriptos arriba. Si no hay vinculación clara, dejalo vacío — nunca fuerces una conexión con el catálogo.`;

function buildTriageUserMessage(relato) {
  return `Relato del vendedor:\n${relato}`;
}

function buildSynthesisUserMessage({ relato, empresa, contacto, canal, respuestas, informacion_adicional }) {
  let msg = `Relato original del vendedor:\n${relato}\n`;
  if (empresa) msg += `\nEmpresa: ${empresa}`;
  if (contacto) msg += `\nContacto: ${contacto}`;
  if (canal) msg += `\nCanal: ${canal}`;
  if (Array.isArray(respuestas) && respuestas.length) {
    msg += `\n\nPreguntas realizadas al vendedor y sus respuestas:\n`;
    respuestas.forEach((r, i) => {
      msg += `${i + 1}) ${r.pregunta}\n   Respuesta: ${r.respuesta}\n`;
    });
  }
  if (informacion_adicional && informacion_adicional.trim()) {
    msg += `\nInformación adicional que el vendedor agregó después de reflexionar:\n${informacion_adicional}`;
  }
  return msg;
}

async function callClaude(system, userMessage) {
  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1200,
      system,
      messages: [{ role: 'user', content: userMessage }]
    })
  });
  const data = await anthropicRes.json();
  if (!anthropicRes.ok) {
    console.error('Anthropic API error:', data);
    throw new Error('anthropic_error');
  }
  const textBlocks = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
  const start = textBlocks.indexOf('{');
  const end = textBlocks.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('no_json');
  return JSON.parse(textBlocks.slice(start, end + 1));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido' });
    return;
  }

  const { mode } = req.body || {};

  try {
    if (mode === 'triage') {
      const { relato } = req.body;
      if (!relato || !relato.trim()) {
        res.status(400).json({ error: 'Falta el relato' });
        return;
      }
      const parsed = await callClaude(TRIAGE_SYSTEM, buildTriageUserMessage(relato));
      res.status(200).json(parsed);
      return;
    }

    if (mode === 'synthesize') {
      const { relato } = req.body;
      if (!relato || !relato.trim()) {
        res.status(400).json({ error: 'Falta el relato' });
        return;
      }
      const parsed = await callClaude(SYNTHESIS_SYSTEM, buildSynthesisUserMessage(req.body));
      res.status(200).json(parsed);
      return;
    }

    res.status(400).json({ error: 'mode inválido (usar "triage" o "synthesize")' });
  } catch (err) {
    console.error('Error en /api/analyze:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};
