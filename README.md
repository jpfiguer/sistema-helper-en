# sistema-helper-en

Entrenador de entrevistas técnicas en inglés para hispanohablantes.

Un entrevistador simulado te hace preguntas por voz, respondes **en voz alta en inglés**, y
al terminar cada respuesta obtienes feedback en español: qué se entendió, qué frases arreglar, y
la misma respuesta reescrita como la diría alguien con el inglés que quieres tener.

```
┌──────────────────────┐
│ Entrevistador (LLM)  │  hace la pregunta, y repregunta sobre lo que dijiste
└──────────┬───────────┘
           │ texto
           ▼
   Cartesia TTS ──► parlantes          ← lo escuchas, como en un Meet
           │
           ▼  (el mic se abre cuando el audio terminó de sonar)
   Tu micrófono ──► ffmpeg ──► Deepgram STT
           │
           ├──► metrics.js      palabras/min, muletillas, léxico   ← aritmética
           └──► Evaluador (LLM) contenido, inglés, reescritura     ← juicio
                       │
                       ▼
                 sesiones/*.jsonl  ──►  npm run reporte
```

---

## Para quién es

Para quien lee y escribe inglés técnico sin problema pero se traba al hablarlo. Practicas
contra un entrevistador que repregunta sobre lo que dijiste, y cada sesión queda guardada para
comparar tu avance entre días.

---

## Qué mide, y qué no

La decisión de diseño central: **los números los calcula el código, el juicio lo da el modelo, y
se muestran por separado.**

| | Lo calcula | Detalle |
|---|---|---|
| palabras por minuto | `metrics.js` | palabras del transcript divididas por la duración de la respuesta |
| muletillas y densidad | `metrics.js` | conteo sobre listas fijas de muletillas |
| riqueza léxica | `metrics.js` | `únicas / total`; baja cuando repites las mismas palabras |
| silencio antes de arrancar | `server.js` | reloj local, desde que se abre el micrófono hasta el primer resultado de Deepgram |
| ¿contestó la pregunta? | LLM | no tiene forma cerrada |
| ¿qué frase estuvo mal? | LLM | tampoco |
| la reescritura | LLM | tampoco |

Contar y dividir es determinístico, así que lo hace el código. Al evaluador le llegan los
números ya calculados y solo aporta el juicio.

### Cómo se mide la duración

La duración de una respuesta sale de los **bytes de PCM capturados** (32.000 bytes = 1 segundo
a 16 kHz mono), menos el silencio inicial. Tiene tres imprecisiones conocidas:

- **El silencio inicial es de reloj.** Va desde que se abre el micrófono hasta que llega el
  primer resultado de Deepgram (`Date.now()` en `server.js`), así que también suma el arranque
  de ffmpeg y la latencia de red y de reconocimiento. Ese tiempo se resta completo de la
  duración, aunque parte de él no tenga audio capturado.
- **El silencio del final queda dentro.** Si la respuesta se cierra por silencio, la espera
  (3 s, o 5 s cuando hay texto esperado, con hasta dos prórrogas si falta texto por leer)
  cuenta como parte de la respuesta y baja las palabras por minuto, más en respuestas cortas.
  Si cierras con la barra espaciadora, solo cuenta la pausa hasta que la aprietas.
- **Lo que dices antes de que abra la conexión con Deepgram no se transcribe.**
  `deepgramListener.js` descarta ese audio, aunque sus bytes sí entran en la cuenta.

Como estos sesgos se repiten de una sesión a otra si respondes y cierras igual, las palabras por
minuto sirven más para comparar sesiones entre sí que como valor absoluto.

### Lo que los números no dicen

- **Más palabras por minuto no es mejor.** El código usa 130 a 160 wpm como banda de
  referencia para una entrevista, y el reporte compara por *distancia a esa banda*.
- **La densidad de muletillas tiene falsos positivos.** `like` y `actually` suman aunque estén
  bien usadas. Sirve para ver la tendencia entre sesiones; en una respuesta suelta puede
  exagerar.
- **El silencio antes de arrancar mide duda, pero también tiempo para pensar.** Una pausa
  antes de una pregunta de arquitectura es normal. La bandera aparece sobre 6 s.

Las palabras de apertura (`so`, `well`, `okay`, `right` y el resto de `RELLENOS_APERTURA` en
`metrics.js`) cuentan como muletilla solo si abren la respuesta. En medio de una frase suelen ser
vocabulario, como en *"it works **well**"* o *"the **right** answer"*. `test/metrics.test.js`
lo verifica.

---

## Qué NO hace, por diseño

- **No manda audio a un micrófono virtual.** Si `OUTPUT_DEVICE` apunta a un dispositivo de
  audio virtual conocido (BlackHole, Loopback, Soundflower, VB-Cable, VoiceMeeter),
  `audioPlayer.js` se niega a reproducir, y un test lo verifica. El chequeo mira solo esa
  variable: si la salida por defecto del sistema ya es un dispositivo virtual, no lo detecta.
- **No clona tu voz.** La voz sintética es la del entrevistador, y conviene que suene distinta
  a la tuya.
- **El entrevistador nunca ve el feedback.** Su historial solo tiene sus preguntas y tus
  respuestas; el feedback sale de otro prompt, que no comparte historial con él. Que no te
  corrija durante la entrevista es una instrucción de su prompt.
- **El evaluador no debería inventar.** Su prompt le prohíbe agregar en la reescritura
  proyectos, empresas o datos que no dijiste. Es una instrucción al modelo; el código no lo
  verifica.

---

## Los modos

**Entrevista.** Un entrevistador simulado te pregunta, improvisas, y el feedback llega al final
de cada respuesta, nunca durante. Si fuiste vago puede repreguntar sobre el mismo tema; después
de dos repreguntas, el mensaje de turno le pide pasar a la siguiente pregunta.

**Entrevista con apoyo** (la casilla «con apoyo» en la UI). La pregunta llega por voz y la
respuesta preparada del set de lectura aparece en pantalla para leerla. Al cerrar corren dos
evaluaciones: la alineación contra ese texto, que dice qué palabra salió mal, y el evaluador de
siempre. No hay repreguntas, y en el reporte estas sesiones van en una tabla aparte.

**Lectura.** El texto está en pantalla, lo lees en voz alta, y te corrige **frase por frase,
en el momento**. No usa el entrevistador ni el evaluador.

### Por qué la corrección de pronunciación necesita texto esperado

Para señalar qué palabra pronunciaste mal hay que saber **qué palabra ibas a decir**. Improvisando
no se puede: un transcript raro puede ser una mala pronunciación o puede ser que cambiaste de idea
a mitad de frase. Con el texto esperado delante, la diferencia entre los dos es medible.

`alignment.js` alinea lo esperado contra lo que Deepgram oyó (Needleman-Wunsch sobre tokens) y
clasifica cada palabra:

| | |
|---|---|
| **cambiada** | la pronunciaste tan distinto que se volvió otra; te dice cuál se oyó |
| **omitida** | te la comiste entera |
| **dudosa** | es la correcta, pero el modelo apenas la reconoció |
| **agregada** | repetición o autocorrección; no baja tu precisión |

Al final de una sesión de lectura ves las palabras ordenadas por cuántas veces fallaron.

### Qué NO detecta

Deepgram es un transcriptor, no un evaluador de pronunciación, y nova-3 además "arregla" lo que
dices. Entonces:

- **Sí** detecta palabras que se convierten en otra (`ship` que se oye `sheep`, `full` que se
  oye `fool`), palabras comidas, palabras apenas reconocidas y repeticiones.
- **No** detecta acento sobre la palabra correcta, duración de vocales, sílaba tónica corrida ni
  entonación. Si dices `development` con el acento mal pero se entiende, pasa limpio.

Para eso hace falta una API que puntúe fonema por fonema (Azure Speech tiene una); este
proyecto no la usa.

**Dos ajustes en la comparación:** las contracciones se expanden en ambos lados, con apóstrofo
recto o curvo (si no, cada `don't` aparecería como omitida más agregada), y los números escritos
con dígitos no se evalúan: el texto dice `2,700` y tú dices *twenty-seven hundred*, y las dos
lecturas son correctas.

**Largo de las frases: hasta 20 palabras.** Es una respiración y un `final` de Deepgram. Más
largo y el endpointing parte la frase, la alineación queda a medias y el feedback culpa a
palabras que sí dijiste. `test/alignment.test.js` verifica ese tope de 20.

### Atajo

En modo lectura la **barra espaciadora** hace todo el ciclo: arranca la frase, la cierra, y pasa a
la siguiente. Lees una respuesta entera sin soltarla.

---

## Instalación

Requiere **macOS**, **Node ≥ 20**, **ffmpeg** y claves de API de Deepgram y Groq. La de
Cartesia es opcional: con `TTS_PROVIDER=say` la voz del entrevistador sale del sintetizador de
macOS. No requiere ningún dispositivo de audio virtual.

```bash
brew install ffmpeg
git clone <este-repo> && cd sistema-helper-en
npm install
cp .env.example .env     # completa las claves
npm run check            # prueba micrófono, claves y voz con llamadas reales
npm test                 # tests locales, sin APIs ni audio
npm start                # http://localhost:3002
```

En macOS, la terminal necesita permiso de **Micrófono**: Ajustes > Privacidad y seguridad >
Micrófono.

El servidor escucha solo en `127.0.0.1`, y el WebSocket acepta únicamente conexiones desde la
propia página (`http://localhost:PUERTO` o `http://127.0.0.1:PUERTO`).

| Servicio | Para qué | Precios |
|---|---|---|
| [Deepgram](https://console.deepgram.com) nova-3 | transcribe tu inglés | [deepgram.com/pricing](https://deepgram.com/pricing) |
| [Groq](https://console.groq.com/keys) | entrevistador y evaluador | [groq.com/pricing](https://groq.com/pricing) |
| [Cartesia](https://play.cartesia.ai) sonic-3 | voz del entrevistador (opcional) | [cartesia.ai/pricing](https://cartesia.ai/pricing) |

El audio sintetizado se guarda en `cache/tts/`, así que repetir una pregunta o una frase ya
dicha no vuelve a llamar a Cartesia.

---

## Cómo se usa

1. `npm start`, abres `http://localhost:3002` y le das a **Empezar sesión**.
2. Escuchas la pregunta por los parlantes. El micrófono se abre cuando termina de sonar.
3. Respondes en voz alta, en inglés. Ves el transcript en vivo mientras hablas.
4. Cuando terminas: **barra espaciadora**, o esperas 3 segundos de silencio (5 con apoyo).
5. Lees el feedback y **lees la reescritura en voz alta**.
6. **Repetir pregunta** la vuelve a decir, **↻ Intentar de nuevo** la repite y abre el
   micrófono para otro intento, y **Siguiente pregunta** avanza. Repetir no está disponible
   mientras el micrófono está abierto, porque la pregunta entraría al transcript.

El set son 7 preguntas con la forma de una entrevista: screening, tres técnicas, una de
profundidad, una de comportamiento y el cierre.

```bash
npm run reporte                  # progreso entre sesiones
npm run reporte -- --json | jq   # los mismos datos en JSON, para graficarlos aparte
```

El reporte muestra una fila por sesión y, desde la cuarta sesión de entrevista, compara el
promedio de las primeras contra el de las últimas: dos contra dos con cuatro o cinco sesiones,
tres contra tres desde la sexta. Con menos sesiones no muestra comparación, porque un día suelto
varía con el cansancio, el tema y la hora. Las sesiones con apoyo van en una tabla aparte y no
entran en la comparación.

El reporte no llama al modelo: promedia lo que quedó guardado. Ritmo, muletillas y léxico son
aritmética; las notas de contenido e inglés son las que puso el evaluador en su momento, y en la
comparación la nota de inglés aparece marcada como juicio del modelo.

---

## Configuración útil

Todo va en `.env`. `.env.example` tiene la lista completa de variables, cada una con su
comentario.

| Variable | Default | Para qué |
|---|---|---|
| `TTS_PROVIDER` | `cartesia` | `say` usa la voz de macOS: gratis, sin red y sin clave de Cartesia, con peor calidad |
| `ROLES_OBJETIVO` | Senior Data Engineer, AI Engineer, Data Architect | ajusta el nivel y vocabulario de las preguntas |
| `CARTESIA_SPEED` | `1.0` | súbelo a 1.2 cuando ya sigas al entrevistador cómodo |
| `SILENCIO_FIN_MS` | `3000` | súbelo si te corta mientras piensas |
| `SILENCIO_FIN_GUIADO_MS` | `5000` | lo mismo cuando hay texto esperado (lectura y apoyo) |
| `DEEPGRAM_ENDPOINTING` | `1200` | ms de silencio para cerrar un segmento de transcript |
| `GROQ_MODEL_EVAL` | = `GROQ_MODEL` | el evaluador puede ser más grande: corre cuando ya no esperas |

---

## Notas de implementación

- **El micrófono se abre cuando el audio del entrevistador terminó de sonar, más 400 ms.**
  `hablar()` espera a que salga el proceso de ffmpeg que reproduce, no a que termine la
  síntesis: desde el caché el audio llega de una vez y todavía suena varios segundos. Con el
  micrófono abierto durante la pregunta, Deepgram transcribiría la voz del entrevistador como si
  fuera tuya. Todo el audio pasa por una fila, un clip a la vez, y con el micrófono abierto no se
  acepta audio extra.
- **Al medir el ritmo se descuenta el silencio inicial**, con los límites que describe
  «Cómo se mide la duración».
- **Deepgram con `endpointing=1200`.** Es el silencio que espera para cerrar un segmento. Con
  valores bajos, una pausa a mitad de frase la parte en segmentos, y cada uno se transcribe sin
  el contexto del resto de la oración.
- **nova-3 "arregla" un poco lo que dices**: completa artículos y corrige concordancias, así que
  el transcript puede sonar mejor que el audio y el feedback gramatical queda indulgente. Está
  anotado en `deepgramListener.js`.
- **Entrevistador a temperatura 0.7, evaluador a 0.2.** El primero conviene variado para que no
  haga siempre la misma repregunta; el segundo conviene estable para que la misma respuesta no
  saque notas distintas en dos corridas.
- **Deepgram y Cartesia por WebSocket crudo, sin SDK.** El protocolo es estable y los SDK cambian
  de forma seguido.
- **ffmpeg en vez de `naudiodon` para todo el I/O de audio.** `naudiodon` es un binding nativo a
  PortAudio que hay que compilar; ffmpeg se instala con Homebrew y no compila nada en tu máquina.
- **Si el evaluador no devuelve JSON válido, el texto crudo se muestra igual.** Si la llamada a
  la API falla, la respuesta queda registrada sin evaluación y la sesión sigue.

---

## Estructura

```
src/
  server.js           servidor HTTP y WebSocket, y la máquina de estados de la sesión
  agents.js           los dos LLM: entrevistar() y evaluar(), con historiales separados
  metrics.js          métricas por respuesta: ritmo, muletillas, léxico y banderas
  alignment.js        alineación entre el texto esperado y lo que oyó Deepgram
  lecturas.js         set de lectura: 16 respuestas partidas en frases
  questionBank.js     banco de preguntas de entrevista
  audioCapture.js     micrófono a PCM 16 kHz mono (ffmpeg + avfoundation)
  audioPlayer.js      PCM a parlantes (ffmpeg + audiotoolbox); rechaza salidas virtuales
  deepgramListener.js STT por WebSocket
  cartesiaSpeaker.js  TTS por WebSocket
  saySpeaker.js       voz de respaldo con `say` de macOS
  ttsCache.js         caché en disco del audio sintetizado
  sessionLog.js       un JSONL por sesión, que es lo que lee el reporte
  prompts/
    interviewer.js    pregunta y repregunta; no corrige
    evaluator.js      juzga y reescribe; recibe las métricas hechas
public/
  index.html          la interfaz
scripts/
  preflight.js        npm run check: prueba cada API de verdad antes de practicar
  report.js           npm run reporte: progreso entre sesiones
test/
  alignment.test.js   alineación y set de lectura
  metrics.test.js     métricas, salidas virtuales, entrevistador y evaluador
  report.test.js      qué sesiones entran en la comparación del reporte
  server.test.js      solo loopback, y el WebSocket solo desde la propia página
  ttsCache.test.js    un clip solo se sirve con la voz con que se generó
```

---

## Plataforma

Solo macOS. La captura lista los micrófonos con AVFoundation y parsea la salida de ffmpeg
(`audioCapture.js`), la reproducción usa `audiotoolbox`, el chequeo de micrófono de
`npm run check` también usa AVFoundation, y la voz de respaldo usa `say`, que solo existe en
macOS. Portarlo a Linux requiere reescribir la detección de dispositivos, la captura y la
reproducción, por ejemplo con ALSA o PulseAudio. Los tests no tocan audio y corren en cualquier
sistema.

---

## Licencia

MIT. Ver [LICENSE](LICENSE).
