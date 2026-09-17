# sistema-helper-en

Entrenador de entrevistas técnicas en inglés para hispanohablantes.

Un entrevistador simulado te hace preguntas por voz, vos respondés **en voz alta en inglés**, y
al terminar cada respuesta obtenés feedback en español: qué se entendió, qué frases arreglar, y
la misma respuesta reescrita como la diría alguien con el inglés que querés tener.

No te ayuda durante una entrevista real. Te prepara para no necesitar ayuda.

```
┌──────────────────────┐
│ Entrevistador (LLM)  │  hace la pregunta, y repregunta sobre lo que dijiste
└──────────┬───────────┘
           │ texto
           ▼
   Cartesia TTS ──► parlantes          ← lo escuchás, como en un Meet
           │
           ▼  (el mic se abre RECIÉN acá)
   Tu micrófono ──► ffmpeg ──► Deepgram STT
           │
           ├──► metrics.js      palabras/min, muletillas, léxico   ← aritmética
           └──► Evaluador (LLM) contenido, inglés, reescritura     ← juicio
                       │
                       ▼
                 sesiones/*.jsonl  ──►  npm run reporte
```

---

## Por qué existe

Un ingeniero senior hispanohablante suele leer y escribir inglés técnico sin problema y trabarse
al hablarlo. Eso pone un techo directo sobre el sueldo: en el mercado remoto de LatAm, los
puestos que pagan en dólares piden C1 hablado y los que no lo piden pagan tarifa local. La
diferencia entre un lado y otro de esa línea son varios miles de dólares al mes por la misma
capacidad técnica.

La forma barata de cruzar la línea es aparentarlo. La forma que funciona es practicar contra un
entrevistador que repregunta, y medir si estás mejorando en vez de suponerlo.

---

## Qué mide, y qué no

La decisión de diseño central: **los números los calcula el código, el juicio lo da el modelo, y
se muestran por separado.**

| | Lo calcula | Por qué |
|---|---|---|
| palabras por minuto | `metrics.js` | Es una división. Un LLM al que le pedís que cuente, inventa. |
| muletillas y densidad | `metrics.js` | Idem, y el error del modelo no es aleatorio: redondea hacia lo que suena razonable. |
| riqueza léxica | `metrics.js` | `únicas / total`, baja cuando te repetís por falta de vocabulario. |
| silencio antes de arrancar | `metrics.js` | Se deriva de los bytes de audio, no de un reloj de red. |
| ¿contestó la pregunta? | LLM | No tiene forma cerrada. |
| ¿qué frase estuvo mal? | LLM | Idem. |
| la reescritura | LLM | Idem. |

Si la métrica con la que medís tu progreso puede alucinar, el progreso que ves es ruido. Por eso
la duración sale de los **bytes de PCM capturados** (32.000 bytes = 1 segundo a 16 kHz mono) y no
de timestamps, y por eso el reporte de progreso entre sesiones no toca el LLM en ningún punto.

**Lo que los números no dicen** está escrito al lado de cada uno, en el código y en la UI:

- **WPM alto no es mejor.** Un hispanohablante nervioso acelera. 190 wpm suele ser atropellado,
  no fluido. La banda cómoda en entrevista es 130–160, y el reporte compara por *distancia a esa
  banda*, no por "más es mejor".
- **La densidad de muletillas todavía tiene falsos positivos.** `like` y `actually` suman aunque
  estén bien usadas. Sirve para leer la tendencia entre sesiones, no para juzgar una respuesta.
- **El silencio antes de arrancar mide duda, pero también mide que estés pensando.** Tres
  segundos antes de una pregunta de arquitectura está bien; tres antes de "where are you from" no.

Un ejemplo de por qué esto importa: la lista de muletillas contaba `so`, `well` y `right` en
cualquier posición. Un test lo marcó y quedó a la vista que estaba penalizando `"it works **well**"`
y `"the **right** answer"` — la métrica estaba midiendo vocabulario disfrazada de fluidez. Ahora
esas tres cuentan solo al abrir la respuesta, que es donde sí son un tic. El test está en
`test/metrics.test.js`.

---

## Qué NO hace, por diseño

Este proyecto nació de otro que hacía exactamente lo contrario: escuchaba al entrevistador en un
Meet real y respondía por el candidato con su voz clonada. Funcionaba. También era una forma
eficiente de conseguir un puesto donde hay llamadas en inglés todos los días sin poder sostener
ninguna.

Así que las restricciones están en el código, no en el README:

- **No hay salida a micrófono virtual.** `audioPlayer.js` rechaza BlackHole, Loopback,
  Soundflower, VB-Cable y VoiceMeeter por nombre, y tira si lo apuntás a uno. Hay un test que lo
  verifica. Es lo único que hace que la restricción sobreviva a un fork.
- **No se clona tu voz.** La voz sintética es la del entrevistador, y conviene que suene distinta
  a la tuya.
- **El entrevistador no te corrige en vivo** y nunca ve el feedback. Si lo viera, empezaría a
  enseñar en vez de entrevistar, y practicarías contra algo que no se parece a una entrevista.
- **El evaluador no inventa.** El prompt le prohíbe agregar proyectos, empresas o datos que no
  dijiste: la reescritura es tu respuesta dicha mejor, no una respuesta mejor.

---

## Instalación

Requiere **Node ≥ 20**, **ffmpeg**, y tres claves de API. No requiere ningún dispositivo de audio
virtual.

```bash
brew install ffmpeg
git clone <este-repo> && cd sistema-helper-en
npm install
cp .env.example .env     # completá las tres claves
npm run check            # prueba cada API de verdad, no solo si la variable existe
npm start                # http://localhost:3002
```

En macOS, la terminal necesita permiso de **Micrófono**: Ajustes → Privacidad y seguridad →
Micrófono.

| Servicio | Para qué | Costo aproximado |
|---|---|---|
| [Deepgram](https://console.deepgram.com) nova-3 | transcribe tu inglés | ~US$0,004/min |
| [Groq](https://console.groq.com/keys) | entrevistador + evaluador | ~US$0,002 por respuesta |
| [Cartesia](https://play.cartesia.ai) sonic-3 | voz del entrevistador | ~US$0,015 por pregunta |

**Una sesión de 30 minutos cuesta alrededor de US$0,30.** Practicar todos los días un mes sale
menos que una clase particular.

---

## Cómo se usa

1. `npm start`, abrís `http://localhost:3002` y le das a **Empezar sesión**.
2. Escuchás la pregunta por los parlantes. (**Repetir** la vuelve a decir.)
3. Respondés en voz alta, en inglés. Ves el transcript en vivo mientras hablás.
4. Cuando terminás: **barra espaciadora**, o esperás 3 segundos de silencio.
5. Leés el feedback. **Leé la reescritura en voz alta** — esa es la parte que entrena.
6. **Siguiente pregunta** cuando estés listo.

El set son 7 preguntas con la forma de una entrevista real: screening, tres técnicas, una de
profundidad, una de comportamiento y el cierre. El entrevistador repregunta hasta dos veces sobre
el mismo tema si tu respuesta fue vaga — ahí es donde se cae un guion memorizado, y es el motivo
de practicar contra esto en vez de contra una lista de preguntas.

```bash
npm run reporte          # progreso entre sesiones
npm run reporte -- --json | jq   # si querés graficarlo aparte
```

Desde la cuarta sesión el reporte compara las primeras tres contra las últimas tres. Antes de eso
no muestra tendencia a propósito: el ruido entre días (cansancio, tema, hora) es más grande que la
mejora semanal, y una línea que sube dos días seguidos no significa nada.

---

## Configuración útil

Todo en `.env` (ver `.env.example` para la lista completa).

| Variable | Default | Para qué |
|---|---|---|
| `ROLES_OBJETIVO` | Senior Data Engineer, AI Engineer, Data Architect | ajusta el nivel y vocabulario de las preguntas |
| `CARTESIA_SPEED` | `1.0` | subilo a 1.2 cuando ya sigas al entrevistador cómodo |
| `SILENCIO_FIN_MS` | `3000` | subilo si te corta mientras pensás |
| `DEEPGRAM_ENDPOINTING` | `1200` | ms de silencio para cerrar un segmento de transcript |
| `GROQ_MODEL_EVAL` | = `GROQ_MODEL` | el evaluador puede ser más grande: corre cuando ya no esperás |

---

## Notas de implementación

Las decisiones que costaron tiempo y que un lector agradecería tener escritas:

- **El micrófono se abre recién cuando el TTS terminó, más 400 ms de colchón.** Con el mic
  abierto todo el tiempo, Deepgram transcribía también la voz del entrevistador saliendo por los
  parlantes y esas palabras se contaban como tuyas: las métricas medían una conversación en vez
  de tu habla. Es el bug que define la forma de `server.js`.
- **Al medir el ritmo se descuenta el silencio inicial.** Si tardaste 5 segundos en arrancar,
  esos 5 segundos no son parte de tu respuesta; contarlos hundiría las palabras por minuto sin
  que hayas hablado distinto.
- **Deepgram con `endpointing=1200`, no 800.** Al practicar hacés pausas más largas que un
  nativo; con 800 una respuesta se partía en dos y el conteo de palabras por respuesta quedaba mal.
- **nova-3 "arregla" un poco lo que decís** — completa artículos, corrige concordancias. Es un
  sesgo optimista conocido: el transcript se ve mejor que el audio. Las muletillas sí sobreviven,
  que es lo que más importa acá. Está anotado en `deepgramListener.js` para que nadie se pregunte
  por qué el feedback gramatical parece indulgente.
- **Entrevistador a temperatura 0.7, evaluador a 0.2.** El primero conviene variado para que no
  haga siempre la misma repregunta; el segundo conviene estable para que la misma respuesta no
  saque notas distintas en dos corridas.
- **Deepgram y Cartesia por WebSocket crudo, sin SDK.** El protocolo es estable y los SDK cambian
  de forma seguido.
- **ffmpeg en vez de `naudiodon` para todo el I/O de audio.** `naudiodon` es un binding nativo a
  PortAudio con build frágil en macOS reciente y Apple Silicon. ffmpeg ya está instalado y no
  compila nada.
- **Si el evaluador no devuelve JSON válido, el texto crudo se muestra igual.** Perder el feedback
  de una respuesta no puede cortar la sesión.

---

## Estructura

```
src/
  server.js           máquina de estados de la sesión (idle → preguntando → escuchando → evaluando)
  agents.js           los dos LLM: entrevistar() y evaluar(), con historiales separados
  metrics.js          todo lo determinístico
  questionBank.js     preguntas derivadas de avisos reales de Data/AI Engineer
  audioCapture.js     tu micrófono → PCM 16k mono (ffmpeg + avfoundation)
  audioPlayer.js      PCM → parlantes, con el guard anti-loopback
  deepgramListener.js STT por WebSocket
  cartesiaSpeaker.js  TTS por WebSocket
  sessionLog.js       JSONL por sesión — el set de evaluación, no un log de debug
  prompts/
    interviewer.js    pregunta y repregunta; nunca corrige
    evaluator.js      juzga y reescribe; recibe las métricas hechas
scripts/
  preflight.js        prueba cada API de verdad antes de practicar
  report.js           progreso entre sesiones, sin LLM
test/
  metrics.test.js     lo que tiene respuesta correcta
```

Solo macOS por ahora: el I/O de audio usa `avfoundation` y `audiotoolbox`. Portarlo a Linux es
cambiar dos strings en `audioCapture.js` y `audioPlayer.js` por `alsa`/`pulse`.

---

## Licencia

MIT — ver [LICENSE](LICENSE).
