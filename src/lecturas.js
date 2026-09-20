/**
 * Set de lectura: las respuestas que ya preparaste, partidas en frases.
 *
 * Por qué existe este archivo aparte del banco de preguntas: son dos ejercicios distintos.
 * En modo entrevista improvisas y el sistema no sabe qué ibas a decir, así que solo puede
 * juzgar el resultado. En modo lectura el texto esperado existe, y eso es lo único que
 * permite señalar QUÉ palabra pronunciaste mal en vez de decirte que la frase sonó rara.
 *
 * El contenido no es genérico: son respuestas reales de entrevista. Practicar con material
 * propio sirve doble: entrena la boca y fija la respuesta.
 *
 * LARGO DE LAS FRASES. Entre ocho y veinte palabras, que es una respiración y un `final` de
 * Deepgram. Más largo y el endpointing parte la frase por la mitad, la alineación queda a
 * medias y el feedback culpa a palabras que sí dijiste. Si agregas contenido, respeta esto.
 */

'use strict';

const LECTURAS = [
  {
    id: 'lec-01', ronda: 'Apertura',
    pregunta: 'Tell me about yourself.',
    frases: [
      "I'm a data and AI engineer based in Santiago, Chile.",
      'Ten years in data engineering, the last seven on Google Cloud.',
      'I hold the Google Cloud Generative AI Leader certification.',
      "What I do that most data engineers don't is build the evaluation layer.",
      'When a system uses an LLM, I measure whether it is actually right.',
      'Golden datasets, and CI gates that block a release when quality drops.',
      'I have that running in production today, and I published the pattern as open source.',
    ],
  },
  {
    id: 'lec-02', ronda: 'Apertura',
    pregunta: 'What are you working on right now?',
    frases: [
      'An AI platform in production where I run RAGAS against real captured traffic.',
      'Weekly baselines, and five CI pipelines that block regressions before they ship.',
      'Alongside that, a visual inspection system for retail.',
      'A vision model judges whether a store display matches the brand standard.',
      'From photos taken in the field by people who are not photographers.',
    ],
  },
  {
    id: 'lec-03', ronda: 'Proyecto a fondo',
    pregunta: "Walk me through a project you're proud of.",
    frases: [
      'The visual inspection system. Field staff photograph a display.',
      'A vision-language model judges whether it matches the standard.',
      "The interesting part isn't the model, it's the guardrail.",
      'The evaluator rejects any claim that depends on a measurement',
      'the model cannot make from the image.',
      'That one rule is what made the output trustworthy enough to act on.',
    ],
  },
  {
    id: 'lec-04', ronda: 'Proyecto a fondo',
    pregunta: 'Tell me about a time an AI system failed in production.',
    frases: [
      'The same system, first version. It scored well on our test set.',
      'And it was wrong in a way the score never showed.',
      'It would agree a product was facing forward while the photo showed it rotated.',
      'The prompt let it answer from the overall look of the shelf,',
      'instead of from what it could actually see.',
      'Orientation is exactly what these models are worst at.',
      'On the DORI benchmark the best model reaches 64% on coarse orientation.',
      'And 43% on granular orientation.',
      'I rebuilt the golden dataset out of the failure modes instead of the happy path.',
      'It surfaced immediately.',
    ],
  },
  {
    id: 'lec-05', ronda: 'Evaluación de IA',
    pregunta: 'How do you evaluate an LLM system?',
    frases: [
      'Two layers, deliberately separate.',
      'Everything measurable is computed in code, never asked of the model.',
      'A model you ask to count will invent a number that sounds reasonable.',
      'The judgment does go to the LLM.',
      'On top of that, a golden dataset built from real failures.',
      'It runs on every prompt or model change, with a threshold that blocks the merge.',
      'Today I run RAGAS against real captured traffic with weekly baselines.',
      'Faithfulness sits at 0.96 median, context precision at 0.997.',
    ],
  },
  {
    id: 'lec-06', ronda: 'Evaluación de IA',
    pregunta: 'Name an eval you designed and a failure it caught.',
    frases: [
      'In the visual system, the rule that rejects any claim',
      'depending on a measurement the model cannot make from the image.',
      'It caught the orientation case.',
      'The model asserting a product was facing forward when it was rotated.',
      'Before that rule, it passed the check and reached the report.',
      'I extracted the pattern into an MIT-licensed repository.',
    ],
  },
  {
    id: 'lec-07', ronda: 'Evaluación de IA',
    pregunta: 'When is AI the wrong tool?',
    frases: [
      'When the answer has a closed form.',
      "If I can compute it, I compute it. Cheaper, faster, and it can't hallucinate.",
      'The visual case is the clean example.',
      'The model is good at describing a shelf and bad at orientation.',
      'So the system asks it only what it can answer, and derives the rest.',
    ],
  },
  {
    id: 'lec-08', ronda: 'Agentes y tooling',
    pregunta: 'How do you build with coding agents day to day?',
    frases: [
      'Claude Code daily, wired into scripts and pipelines, not just an editor.',
      "I've written and run MCP servers",
      'to connect agents to the systems that hold the context.',
      'And I build workflow automation in n8n.',
      'Where I intervene: anything touching production data or money.',
      'Where I let it run: scaffolding, tests, refactors with good coverage behind them.',
    ],
  },
  {
    id: 'lec-09', ronda: 'Backend y nube',
    pregunta: 'Describe a data architecture you designed.',
    frases: [
      'I redesigned a PostgreSQL to BigQuery ingestion architecture end to end.',
      'Pub/Sub for events, Apache Beam on Dataflow for transformation.',
      'Composer for orchestration, and medallion layering in BigQuery.',
      'On the transformation side I run about 2,700 Dataform models.',
      'Versioned SQL, an explicit dependency graph,',
      'and assertions acting as quality gates.',
      'A bad load fails the pipeline instead of reaching the warehouse.',
    ],
  },
  {
    id: 'lec-10', ronda: 'Backend y nube',
    pregunta: 'Tell me about a migration.',
    frases: [
      'SAP BW to BigQuery. The constraint was no regressions.',
      'The business had to see identical numbers.',
      'I built parity queries that compared source and warehouse row by row',
      'before anything was cut over.',
      'Runtime dropped 25% and cost dropped 50%.',
    ],
  },
  {
    id: 'lec-11', ronda: 'Backend y nube',
    pregunta: 'A pipeline breaks at 3am. What do you do?',
    frases: [
      'First: did it fail loudly or silently? Silent is worse.',
      'My pipelines alert on data quality, not just on exit code.',
      'A job that succeeds with wrong data is the expensive failure.',
      'Then I isolate: source, transformation or load, using the assertions to narrow it.',
      'Retry logic already handled anything transient.',
      "If it reached me, it wasn't transient.",
    ],
  },
  {
    id: 'lec-12', ronda: 'Backend y nube',
    pregunta: "What's your cloud experience?",
    frases: [
      "GCP is where I'm strongest, and where most of my production work runs.",
      'BigQuery, Dataform, Dataflow and Beam, Pub/Sub, Cloud Run, Cloud Functions, Composer.',
      'Docker for containerized services.',
      "On AWS I've only done S3 ingestion into BigQuery.",
      "So my depth there is limited, and I'd rather say that up front.",
      'The architecture patterns transfer.',
      "The service names I'd need a few weeks on.",
    ],
  },
  {
    id: 'lec-13', ronda: 'Criterio',
    pregunta: "Tell me a technical decision you'd make differently.",
    frases: [
      'In my English trainer I kept the microphone open the whole time.',
      "Deepgram was also transcribing the interviewer's synthetic voice",
      'coming out of the speakers, and those words counted as the user\'s.',
      'The metrics were measuring a conversation instead of one person speaking.',
      'Now the mic opens only after the speech finishes, plus a buffer.',
      'The lesson is that I should have questioned what the measurement included',
      'before trusting it.',
    ],
  },
  {
    id: 'lec-14', ronda: 'Comportamiento',
    pregunta: 'Tell me about a disagreement with a stakeholder.',
    frases: [
      'They wanted to roll the visual inspection out to more stores',
      'before the evaluation was ready.',
      'My argument was not that it was not ready.',
      'I showed them the error rate in the category they cared about most.',
      'We agreed on a limited pilot while I closed the guardrail.',
      'It shipped fully two weeks later, with the number on the table instead of a promise.',
    ],
  },
  {
    id: 'lec-15', ronda: 'Comportamiento',
    pregunta: 'Why are you looking for a new role?',
    frases: [
      'I want to work on AI systems full time,',
      'rather than as the part of my job that grew on its own.',
      'The evaluation work I do now started because nobody was measuring it.',
      "I'd like that to be the actual job.",
    ],
  },
  {
    id: 'lec-16', ronda: 'Cierre',
    pregunta: 'Where do you want to grow?',
    frases: [
      'Two things. Spoken English, honestly.',
      "I read and write it professionally and I'm working on the speaking.",
      'And depth on AWS,',
      'since most of the teams I want to work with are there.',
    ],
  },
];

/** Todas las rondas, en orden de aparición, para poblar el selector de la UI. */
function rondas() {
  const vistas = [];
  for (const l of LECTURAS) if (!vistas.includes(l.ronda)) vistas.push(l.ronda);
  return vistas;
}

/**
 * Arma una sesión de lectura.
 *
 * @param {object} [opts]
 * @param {string[]} [opts.ids]     ids concretos, en ese orden
 * @param {string}   [opts.ronda]   solo una ronda
 * @returns {Array} lecturas
 */
function armarLectura({ ids = null, ronda = null } = {}) {
  if (ids && ids.length) {
    const porId = new Map(LECTURAS.map((l) => [l.id, l]));
    return ids.map((id) => porId.get(id)).filter(Boolean);
  }
  if (ronda) return LECTURAS.filter((l) => l.ronda === ronda);
  return LECTURAS;
}

/** Total de frases de un conjunto, para la barra de progreso. */
function contarFrases(lecturas) {
  return (lecturas || []).reduce((a, l) => a + l.frases.length, 0);
}

module.exports = { LECTURAS, rondas, armarLectura, contarFrases };
