# Handoff desde learnkafka → learnclickhouse

Escrito el 2026-10-02 por la sesión que construyó **Kafka Express** (https://learnkafka.crafter.run, repo `crafter-games/learnkafka`, código local en `~/Documents/Jibaru/learnkafka`). El objetivo ahora es hacer **algo similar para ClickHouse**: un juego web muy gráfico que enseñe ClickHouse de verdad. **No copies el formato isométrico por inercia**: decide el tipo de juego **después** del research, según qué mecánicas de ClickHouse se vean mejor.

Lee esto entero antes de escribir código. Al final hay un plan paso a paso.

---

## 0. Quién es el usuario y cómo trabaja

- Habla **español** (escribe rápido, con typos). Responde y entrevista en español. El juego va en **inglés y español** (i18n).
- Da feedback visual concreto mirando la app. **Cada vez que algo cambie, mira capturas tú mismo** (Playwright) antes de decir "listo".
- Quiere que se sienta **como un videojuego potente**, no como una web con un quiz. Lo que pidió en Kafka, en orden (anticípalo desde el principio en ClickHouse):
  1. Interfaz pulida desde el primer día; usar las skills de UI (`game-ui-ux`, `ui-ux-pro-max`).
  2. **Música de fondo** desde el principio.
  3. **Assets reales**, nada que parezca "vibecoded" (usamos Kenney Factory Kit CC0 vía la skill `game-assets`).
  4. **Texto grande y legible**, pero que **quepa sin scroll** (no "zoom"); buen contraste; sin espacio vacío.
  5. **Selección de mundos tipo videojuego**: mapa con ruta/islas, carrusel, cámara que se desliza.
  6. Música estilo **Phoenix Wright** (heroica, con **subidas de tono** para dar intensidad)… y luego la pidió **más alegre** (pasamos de menor a mayor: nada de acordes tristes iv / ii°7).
  7. Código de desbloqueo **CRAFTER100** que completa todo con nota máxima (para probar).
  8. El panel de texto a la izquierda le obligaba a mover la vista → **cuadro de diálogo estilo visual novel abajo al centro**, poco texto por página, letra grande, efecto máquina de escribir, avanzar con clic/Espacio/Enter.
  9. **Que sea muy obvio cuando fallas** una respuesta (rojo sólido, sacudida, sello ✗ en pantalla, borde rojo en el diálogo).
  10. La escena no debe **encogerse de golpe**; si cambia el encuadre, que sea con transición.
  11. **El fondo no puede ser plano**: hicimos un fondo temático (cielo, nubes, siluetas de fábricas con humo, ventanas que parpadean, un cable con paquetes).
  12. **Landing**: el diagrama vivo de fondo, título grande, **un solo botón** "Empezar" y **transición** (iris) al mapa.
  13. Icono de **GitHub** (repo) y **"Hecho por Jibaru"** (https://github.com/Jibaru) en la landing.
  14. **OG image** por idioma.
  15. Pulir los mundos más antiguos para que tengan paneles tan visuales como los nuevos; **examen final** y **pantalla final con certificado** descargable.
- Org de GitHub: **crafter-games** (repo público). Commits con `git -c user.email=irueda@clerk.dev` y el trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Despliegue en su **VPS** con la skill `vps` (Dokploy). Ver §7.
- Le gusta que avances solo ("continua", "sigue") y que le reportes al final qué cambió, qué probaste y qué no.

---

## 1. Cómo hacer el research (en este orden)

### 1a. Ciencia del aprendizaje
Ya está hecho y aplica tal cual: `docs/research/learning-science.md` (copiado aquí). Reglas clave que **sí funcionaron** en Kafka:
- **Predecir y luego ver** (predict → watch): preguntar qué pasará *antes* de animarlo.
- **Recall check** al final de cada nivel, **con la escena oculta**, 4 preguntas + 1 de repaso de un nivel anterior. Puerta de maestría del **80%** (estrellas: <80% = 0, ≥80% = 1, ≥90% = 2, 100% = 3). Si fallas, reintentas con números nuevos (preguntas con `build(rng)` sembrado).
- **Espaciado** (cajas de Leitner por concepto) → modo "Turno de la mañana" con 3–5 preguntas de los conceptos que tocan.
- **Intercalado**: un nivel tipo "diagnostica el síntoma" que mezcla conceptos confundibles; el examen final reparte preguntas round-robin entre mundos.
- **Mapping card** (metáfora → concepto real) + nota de **"dónde se rompe la metáfora"**.
- **Concreteness fading**: metáfora → iconos → config/SQL real (bloques de código reales en los briefs).
- **Música atenuada (ducking)** mientras se lee; cada SFX significa un evento del sistema; nada de leaderboards globales.

### 1b. Research técnico de ClickHouse
Fuentes: **docs oficiales** (clickhouse.com/docs), el **changelog** y las release notes, el blog de ingeniería de ClickHouse, el código de ClickHouse en GitHub para los valores por defecto, y la ClickHouse Academy si existe. Usa WebSearch/WebFetch.
Produce `docs/research/clickhouse-curriculum.md` con la misma estructura que `learnkafka/docs/research/kafka-curriculum.md` (léelo como plantilla):
- **Cronología de versiones** relevante (qué cambió y cuándo; la versión actual a 2026).
- **Mundos → conceptos → configs/valores por defecto → misconceptions**, con fuente por cada dato. Marca **[unverified]** lo que no confirmes.
- **Backlog de mecánicas visualizables**: lo que se puede *ver* en una simulación. Es la sección que decide el tipo de juego.
- Lista de fuentes.

Temario candidato (verifícalo y reordénalo):
1. **Fila vs columna**: por qué leer 3 columnas de 100 es barato; compresión por columna.
2. **MergeTree**: inserts → **parts** inmutables → **merges** en segundo plano; muchos inserts pequeños = demasiadas parts ("Too many parts"); inserts por lotes y async inserts.
3. **Primary key / ORDER BY**: índice **disperso** por **granules** (index_granularity 8192 filas); cómo el orden decide cuánto se lee; la primary key no es única.
4. **Particiones** (PARTITION BY): para gestión de datos y TTL, no para velocidad; el error común de particionar demasiado fino.
5. **Skipping indexes** (minmax, set, bloom_filter), **projections**, **materialized views** (se disparan con el insert, no son caché) y **refreshable MVs**.
6. **Motores de la familia MergeTree**: ReplacingMergeTree (dedupe *eventual*, FINAL), SummingMergeTree, AggregatingMergeTree (estados `-State`/`-Merge`), CollapsingMergeTree.
7. **Ejecución de consultas**: vectorizada, en paralelo por threads; PREWHERE; leer `EXPLAIN indexes = 1` y `system.query_log` (filas y bytes leídos).
8. **JOINs**: tabla derecha en memoria (hash join), por qué el orden importa; diccionarios; algoritmos de join.
9. **Distribuido**: shards + réplicas, ReplicatedMergeTree, **ClickHouse Keeper** (Raft), tabla Distributed, inserts distribuidos y quórum.
10. **Ciclo de vida**: TTL, tiering de discos/S3, mutaciones (ALTER UPDATE/DELETE son pesadas), lightweight deletes.
11. (Opcional) Ingesta desde Kafka (motor Kafka + MV), formatos de entrada, tipos (LowCardinality, Nullable cuesta), codecs (Delta, DoubleDelta, ZSTD).

### 1c. Mira qué existe ya
Juegos o visualizaciones que enseñen bases de datos columnares; videos de ClickHouse que expliquen parts y merges. Úsalos solo para inspirarte en lo visual.

---

## 2. El tipo de juego: decide después del research

En Kafka funcionó una **fábrica isométrica** porque Kafka *es* un flujo (cintas = particiones, cajas = registros, robots = consumers). ClickHouse va de **almacenar y leer de forma inteligente**, así que quizá encaje mejor otra cosa. Propón 2–3 opciones al usuario, cada una con una maqueta:
- **Biblioteca / almacén de columnas** (estantes por columna; un robot lector que solo recorre los estantes que la consulta necesita; contador de "filas/bytes leídos" como marcador).
- **Puzzle de optimización**: el jugador elige ORDER BY, particiones, índices o projections; ejecuta la consulta y ve cuántos granules se saltó. La meta es leer lo menos posible. Encaja muy bien con *predecir → ver* y con niveles con número objetivo.
- **Simulador de merges tipo Tetris / 2048**: los inserts crean bloques (parts) que se fusionan; si insertas de uno en uno, la pantalla se llena ("Too many parts").
- **Tower defense de consultas**: llegan consultas, y construyes índices/MVs/projections para frenarlas antes de que superen el presupuesto de bytes.
- Se puede mezclar: un mapa de mundos tipo videojuego y un estilo de minijuego distinto por mundo.

El render puede ser **2D** (Canvas/SVG/Pixi/Phaser) en vez de Three.js si encaja mejor; la regla es "muy gráfico y que se sienta juego". Con la skill `game-design-doc` haz la entrevista por rondas y escribe `GDD.md`.

---

## 3. Cuestionario para el usuario (después del research, antes de codear)

Usa el formato de `game-design-doc`: preguntas numeradas, tu recomendación en cada una, y que pueda responder "ok". Pregunta **todo el frente de decisiones a la vez** (por rondas). Hechos que tienes que **verificar tú, no preguntarle**: versiones, valores por defecto, qué assets existen.

**Ronda 1 (la raíz)**
1. **Pitch**: "Eres X, haciendo Y, para Z" (propón 2 opciones según el tipo de juego).
2. **Tipo de juego / estilo visual**: las 2–3 opciones de §2, con capturas o maquetas ASCII.
3. **2D o 3D** y cámara.
4. **Alcance**: ¿cuántos mundos en la v1? (En Kafka: 4 mundos en la v1 y luego crecimos hasta 10.)
5. **Juegos de referencia** que quiere que recuerde (pista: le gustan Phoenix Wright y los juegos cozy/tycoon).
6. **Nombre** (Kafka Express → ¿"ClickHouse …"?), **dominio** (`learnclickhouse.crafter.run`) y **repo** (`crafter-games/learnclickhouse`).

**Ronda 2**
7. **Bucle principal** (qué hace cada 5–30 s) y **los primeros 30 segundos**.
8. **Metáfora central** (en Kafka: centro logístico/paquetes) y su mapping card.
9. **Progresión**: mundos y niveles, estrellas, puerta del 80%, ¿sandbox libre?, ¿modo diario?
10. **Personaje guía** (en Kafka "Oopi") y tono del texto.
11. **Música**: ¿la misma vibra alegre y heroica con subidas de tono, u otra? Y **SFX** ligados a eventos (insert, merge, granule saltado, consulta lenta…).
12. **Fondo temático** y **landing** (ya sabemos que quiere un solo botón con transición y el GitHub + "Hecho por Jibaru").
13. **Pantalla final, certificado y examen** desde la v1 o después.

**Ronda 3**
14. **Arte**: qué pack de assets encaja (búscalo con `game-assets` antes de recomendar).
15. **Controles**: ratón, teclado y táctil (móvil 390×844 tiene que funcionar).
16. **Fuera de alcance** para la v1.

---

## 4. Stack y arquitectura que funcionaron (reutiliza el código de learnkafka sin miedo)

- **Next.js 16** (App Router). **OJO**: `AGENTS.md` lo genera `next dev`: *"This is NOT the Next.js you know"*. Lee `node_modules/next/dist/docs/` antes de escribir código. `proxy.ts` en vez de middleware, tipos globales `PageProps<"/[locale]/…">` y `LayoutProps`, y `opengraph-image.tsx` puede devolver un `Response` con un PNG.
- **next-intl 4** con `[locale]` (en/es), `t.rich` y `t.markup` con las etiquetas `<b>` y `<code>`. **Nunca uses `{b}` ni `{code}` como placeholder**: chocan con las etiquetas (hay un test que lo impide).
- **Tailwind v4**, **motion** para animaciones, **@phosphor-icons/react**, **zustand persist** para el progreso (localStorage, con migraciones de versión).
- **Tone.js** para la música generativa (`src/audio/music.ts`: secuencia de 128 pasos, capas por intensidad 0/1/2, modulaciones cada 8 compases, limitador, ducking). **Howler** para SFX sintetizados por script (`scripts/gen-sfx.mjs`).
- **Three.js** con GLB de Kenney y etiquetas CSS2D. Si eliges 2D, la arquitectura igual sirve.
- **Simulación pura en TS** que emite eventos: la escena, el audio y el motor de niveles se suscriben. Todo testeado con **Vitest**.
- **DSL de niveles** (`src/levels/types.ts`): `Level` con `steps` de tipo `brief | watch | predict | task` y un `check` de preguntas `build(rng)`. Las tareas tienen `tools` (botones del dock), `progress(ctx,start)` y `success`, y opcionalmente `meters`, `onEnter` y un panel en vivo (`streams: "…"`). `LevelSession` crea la maquinaria por nivel. Un test de i18n escanea los archivos de mundos y exige cada clave en en/es.
- **Pantalla de nivel** (`src/components/level/LevelPlayer.tsx` y `dialogue.tsx`): cuadro de diálogo abajo; respuestas grandes arriba; durante las tareas una barra de objetivo arriba al centro, un panel en vivo a la derecha (arriba en móvil) y el dock abajo. La escena se encuadra en el espacio libre (`useInsets`) con transición suave.
- **Feedback**: `Verdict` (sello ✓/✗ a pantalla completa y destello en los bordes), la opción elegida en rojo/verde sólido con sacudida, y el diálogo con borde y banner de color.
- **Mapa de mundos** (`WorldMap.tsx` y `worldMapStage.ts`): islas, ruta punteada, cámara que se desliza, flechas/teclado/swipe, tarjeta inferior con los niveles.
- **Backdrop** temático (`src/components/ui/Backdrop.tsx`): SVG + CSS, respeta reduced-motion. Se monta en cada pantalla con `isolate` + `-z-10`.
- **Landing**: escena viva de fondo, un botón y un iris (clip-path) que se reabre en el mapa.
- **Examen** (`buildExam`, 20 preguntas round-robin) y **Finale** (confeti, nombre, certificado y descarga PNG dibujada en un canvas).
- **OG image**: captura de 1200×630 de la landing por idioma en `public/og/{en,es}.png`, servida por `app/[locale]/opengraph-image.tsx`, más `metadataBase` y las etiquetas og/twitter.

---

## 5. Playtesting (no lo saltes)

- Skill `game-playtest`: `node ~/.claude/skills/game-playtest/scripts/playtest-web.mjs <script.json> --url http://localhost:3000`. **Mira las capturas** a 1440×900, 1280×720 y 390×844.
- Hicimos un **driver de autoplay** (`learnkafka/playtest/driver.js`) que juega cada nivel hasta el final: avanza el diálogo, responde las predicciones con la respuesta real (`window.__TEST__`), resuelve las tareas y hace el recall check. Cada nivel nuevo debe pasar el autoplay antes de desplegarse. Expón `window.__TEST__` (fase, paso, predicción, pregunta) desde el principio.
- Prueba también una **respuesta incorrecta a propósito** y las vistas en móvil.

---

## 6. Errores que ya pagamos (evítalos)

- **React StrictMode** en dev monta → desmonta → monta: no destruyas timers de la sesión en el cleanup sin más. Usamos `retain()`/`release()` con un `setTimeout(0)`.
- Lint del **React compiler**: nada de leer refs en el render, nada de `setState` síncrono en effects ni funciones impuras en el render. Estado mutable en clases (`LevelSession`), `useSyncExternalStore` para saber si está montado, `useState` perezoso.
- **CSS2D**: no uses CSS `zoom` (rompe el posicionamiento); escala con `em` y `--stage-zoom`. Separa el elemento exterior (lo posiciona el renderer) del interior (lo animas tú). Borra las etiquetas al borrar objetos.
- **Tone.js**: "start time must be strictly greater" bajo carga → `lookAhead` 0.2, guarda de tiempo duplicado y try/catch en los triggers.
- `.card` usa box-shadow, así que `ring-*` no se ve: usa `outline-*`. Las clases de los botones pisan los fondos: usa `!bg-…` para los estados elegidos.
- En el shell del usuario (**zsh**), `for l in $L` no separa por palabras: lista los valores explícitamente.
- El dev badge de Next tapa la esquina inferior izquierda en capturas de dev: no pongas botones importantes ahí.
- Los conteos: verifica los números antes de decírselos al usuario (le dije 44 niveles y eran 40; antes dije 32 y eran 28).

---

## 7. Despliegue (VPS / Dokploy)

- Dockerfile standalone (cópialo de learnkafka): node 22 alpine, pnpm, `HOSTNAME=0.0.0.0`, `PORT=3000`, y copia `public/` y `.next/static`.
- Lee la memoria de learnkafka sobre la CLI de `vps` (Dokploy v0.30.7):
  - `vps project create <name> --json` devuelve `{project:{projectId}, environment:{environmentId}}`, **no** `.projectId` (si lo lees mal, un reintento crea un proyecto duplicado).
  - `vps github deploy … --build-type dockerfile` falla en `application.saveBuildType`. Arreglo: llama a `POST $domain/api/application.saveBuildType` con el header `x-api-key` (de `~/.vps/config.json`) y el body con `"herokuVersion":null,"railpackVersion":null`; luego `vps app deploy <id>`.
  - La cuenta de GitHub en Dokploy que ve `crafter-games` es `githubId k9WKsER-y3G7n-JYgDTbM`.
- Subdominio: `crafters domain add learnclickhouse --ip $(vps status --json | jq -r '.ip')` y luego `vps domain add learnclickhouse.crafter.run --app <id> --port 3000 --json`.
- Redeploy: `git push` y luego `vps app deploy <appId> --json`. Verifica en vivo con un playtest contra el dominio real.

---

## 8. Plan sugerido para la nueva sesión

1. Leer este archivo, `docs/research/learning-science.md` y, de learnkafka: `GDD.md` (sobre todo el Changelog: es la historia de decisiones), `docs/research/kafka-curriculum.md`, `src/levels/types.ts`, `src/levels/world1.ts` y `src/components/level/LevelPlayer.tsx`.
2. **Research técnico de ClickHouse** → `docs/research/clickhouse-curriculum.md`, con fuentes y backlog de mecánicas visualizables.
3. Proponer **2–3 tipos de juego** con maquetas y hacer la **entrevista** (§3) en español por rondas. Escribir `GDD.md` cuando el usuario confirme.
4. Assets (`game-assets`) → scaffold (Next 16 + i18n + audio desde el día 1) → M1: el verbo principal en pantalla, con música, fondo temático y texto grande.
5. Un mundo cada vez: sim + tests → niveles en en/es → panel en vivo por tarea → autoplay → capturas → commit → deploy → verificación en vivo.
6. Desde el principio: landing con un botón e iris, mapa tipo videojuego, cuadro de diálogo, feedback de error obvio, CRAFTER100, OG image, GitHub y "Hecho por Jibaru". Al final: examen y certificado.

Si algo de esto no encaja con lo que encuentres sobre ClickHouse, cámbialo y explica por qué. El objetivo es enseñar ClickHouse bien, no clonar Kafka Express.
