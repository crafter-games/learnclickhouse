# Column Depot — Learn ClickHouse (no oficial)

> Eres el nuevo jefe de almacén de **Column Depot**: guardas millones de pedidos en estanterías por columna y despachas consultas leyendo lo mínimo, para que los informes salgan en milisegundos. Los jefes de cada mundo son **casos** en clave Phoenix Wright.

| | |
| --- | --- |
| Engine | Next.js 16 (App Router, TS) + **Three.js** (cámara en perspectiva) + React/motion para la UI |
| Platform | Web; escritorio primero, móvil 390×844 jugable |
| View | 3D en perspectiva: plano general a tres cuartos (FOV ~35°, tune) + planos de acción que siguen a Pico; transiciones suaves, nunca de golpe |
| Scope | Small release. v1 = Mundos 1–4 (18 niveles) + Almacén libre + Turno de mañana + examen y certificado |
| References | Mini Motorways / Islanders (diorama cozy), Opus Magnum (métrica a optimizar contra tu mejor marca), Phoenix Wright (casos y jefes), Learn Git Branching (fantasma del estado objetivo) |
| Languages | Inglés + español (`/en`, `/es`) |
| Domain / repo | `learnclickhouse.crafter.run` · `crafter-games/learnclickhouse` (público) |

Las reglas de diseño salen de `docs/research/learning-science.md`. Los hechos de ClickHouse salen de `docs/research/clickhouse-curriculum.md` (**ClickHouse 26.9 / 26.8 LTS**). Nombre: "ClickHouse" es marca registrada, así que solo va en el subtítulo, con la nota "proyecto no oficial" en el pie.

## Core loop

Cada nivel dura 3–6 min: **Brief → Predice → Mira → Reto → Recall check**.
1. Pico explica en el cuadro de diálogo (1–2 frases por página) y enseña una **mapping card** con su nota de "dónde se rompe la metáfora".
2. Antes de cada simulación el jugador **predice**: cuántas cajas abrirá Pico, en qué sección cae el insert, cuántas parts quedarán.
3. La simulación lo enseña con la cámara en plano de acción. Un acierto suena a clic y brilla. Un fallo es muy obvio (rojo sólido, sacudida, sello ✗) y repite la animación con un *porqué* de una línea.
4. **Reto**: mover una palanca (ORDER BY, tamaño del batch, partición…) para llegar al objetivo de lectura, que se ve como un fantasma con contador de filas/bytes.
5. **Recall check** con la escena oculta: 4 preguntas + 1 de repaso; puerta del 80%.

Cada 5–30 s el jugador elige una palanca, lanza el insert o la consulta y compara el contador con el objetivo.

## First 30 seconds

1. **Landing**: el almacén 3D en modo demo (la cámara pasea por los pasillos y llegan camiones), el título grande *Column Depot*, un solo botón **Empezar**, GitHub y "Hecho por Jibaru". La música arranca con el primer gesto. Iris hacia el mapa.
2. **Mapa**: el polígono industrial 3D. La nave 1 está encendida; las demás, apagadas.
3. **Nivel 1-1**: los pedidos están guardados *por filas*, mezclados en una estantería larga. Llega `SELECT sum(total) FROM orders`. Predicción: "¿cuántas cajas abrirá Pico?". Las abre **todas**: 100%.
4. Pico: "¿y si reorganizamos?". Cinemática: la estantería **gira y se separa en un pasillo por columna**. Se repite la consulta: Pico solo entra al pasillo `total`, y el contador baja de **100% a 8%** con un "clic". Primera estrella.

## Controls

| Acción | Ratón / teclado | Táctil |
| --- | --- | --- |
| Avanzar diálogo | clic / `Espacio` / `Enter` | tap |
| Responder predicción | clic / `1–4`, `Enter` | tap |
| Ejecutar consulta / insertar | botón ▶ / `R` | botón |
| Palancas (ORDER BY, batch, partición, async) | arrastrar chips, segmentados, `←→` | arrastrar / tap |
| Cámara libre (solo en el Almacén libre) | arrastrar para orbitar, rueda para zoom | un dedo orbita, pellizcar hace zoom |
| Música / SFX | `M` / `Shift+M` | dos botones del HUD, siempre visibles |
| Pausa / atrás | `Esc` | ☰ |

En los niveles la cámara la dirige el juego. En móvil los paneles se apilan arriba, el dock queda abajo y la cámara encuadra el espacio libre (`useInsets`).

## Mechanics

### Simulación (determinista, por ticks, sin ClickHouse real)
- Una `Table` en TS puro con columnas, parts (inmutables, con nombre `partition_min_max_level`), granules, índice disperso (primera clave de cada granule), particiones y un selector de merges. Emite eventos (`inserted`, `partCreated`, `mergeStart`, `merged`, `partOutdated`, `granuleSkipped`, `granuleRead`, `tooManyParts`, `queryDone`…) a los que se suscriben la escena, el audio y el motor de niveles. Todo se prueba con Vitest.
- **Escala visual**: 1 caja = 1 granule (8192 filas reales). La escena muestra 12–48 cajas por pasillo y el panel enseña el número real (p. ej. 1083 granules). Los umbrales reales se muestran tal cual (1000/3000 parts, 8192 filas, 200 ms / 10 MiB / 450, 100 particiones por insert), pero el tiempo de la simulación se acelera o se ralentiza (se dice en el brief).
- Defaults que se enseñan (26.x): `index_granularity=8192`, `async_insert=1` y `wait_for_async_insert=1` (desde 26.2), `parts_to_delay_insert=1000`, `parts_to_throw_insert=3000`, `max_partitions_per_insert_block=100`, `old_parts_lifetime=480`, codec LZ4 < 100 MB / ZSTD(3) ≥ 100 MB (26.9). Notas "Cloud" donde difiere.

### Verbos del almacén
- **Escribir**: un camión llega al muelle → el palé se sella como una **sección** (part) en todos los pasillos → la **prensa** fusiona secciones contiguas de la misma nave (merge, nivel +1); las viejas se desvanecen.
- **Leer**: Pico recibe el albarán (consulta), consulta el **tablero de la entrada** (índice disperso), recorre solo los pasillos de las columnas pedidas y abre solo las cajas necesarias. Las cajas saltadas se apagan, y el contador muestra cajas/filas/bytes leídos.

### Mapping card (metáfora → ClickHouse)
almacén = tabla · pasillo = columna · sección sellada = part · caja = granule · cartel de la primera caja en el tablero = índice disperso · prensa = merge · nave = partición · Pico + albarán = consulta · cajas abiertas / kg cargados = filas / bytes leídos.
**Dónde se rompe**: una part es una carpeta de archivos, no un mueble; "abrir una caja" es descomprimir un bloque; las parts no tienen sitio físico fijo.

### Concreteness fading por mundo
Al principio la metáfora (camiones, cajas). En medio, iconos (bloques y contadores). El último nivel de cada mundo usa SQL real (`CREATE TABLE … ORDER BY`, `EXPLAIN indexes = 1`, `system.parts`, `system.columns`), que el jugador lee, completa o elige; no lo escribe a mano.

### Maestría y espaciado
Leitner por concepto (1, 2, 4, 8 y 16 días, tune). Los conceptos vuelven en N+2 y N+5. El **Turno de mañana** son 3–5 preguntas de los conceptos que tocan. Los casos mezclan conceptos confundibles (partición contra ORDER BY, merge contra mutación, dedup de insert contra PRIMARY KEY).

### Niveles v1

| # | Mundo | Nivel | Enseña | Reto / incidente |
|---|---|---|---|---|
| 1-1 | Columnas | Filas contra columnas | almacenamiento por columna | cinemática de giro; 100% → 8% |
| 1-2 | | Solo lo que pides | solo se leen las columnas nombradas | `SELECT a,b,c` contra `*`, objetivo de bytes |
| 1-3 | | Pasillos que encogen | compresión por columna; ordenar comprime más | elegir el orden que más encoge; LZ4/ZSTD (26.9) |
| 1-4 | | Analítica, no ventanilla | OLAP frente a OLTP | final abstracto: `CREATE TABLE` + `system.columns` |
| 2-1 | Inserts, parts y merges | Cada camión, una sección | cada insert crea una part inmutable (`all_1_1_0`) | predecir nombres de parts |
| 2-2 | | La prensa | merges en segundo plano, niveles, parts contiguas, 480 s | predecir el nombre tras el merge |
| 2-3 | | Too many parts | *primero el reto*: inserts de 1 fila; 1000 / 3000 | el tablero se llena; arreglarlo |
| 2-4 | | Lotes y async inserts | 10k–100k filas, ~1 insert/s; async (26.2): 200 ms / 10 MiB / 450 | mantener las parts bajo el umbral con la tolva async |
| 2-5 | | **Caso: el camión que repite** | dedup de inserts por bloque (hash, ventana) + repaso | ¡Objeción!: diagnosticar duplicados contra reintentos |
| 3-1 | ORDER BY e índice | Cajas de 8192 | granule = unidad mínima; orden dentro de cada part | predecir cuántas cajas se abren |
| 3-2 | | El tablero de la entrada | índice disperso, búsqueda binaria (1/1083) | encontrar `customer='acme'` abriendo ≤ 2 cajas |
| 3-3 | | El segundo de la fila | la segunda columna de la clave (1076/1083); baja cardinalidad primero | puzzle de reordenar la clave |
| 3-4 | | La clave no es única | PRIMARY KEY no es única y es prefijo del ORDER BY | insertar el mismo id dos veces |
| 3-5 | | **Caso EXPLAIN** | embudo de `EXPLAIN indexes = 1`; LIMIT no corta el escaneo | elegir el ORDER BY para 3 consultas |
| 4-1 | Particiones | Naves separadas | las parts no se fusionan entre particiones; poda (436 → 1) | predecir qué naves se apagan |
| 4-2 | | Particionar no acelera | partición frente a ORDER BY | *primero el reto*: particionar no baja el contador |
| 4-3 | | Demasiadas naves | por día o por cliente: límite de 100 por insert y Too many parts | elegir una clave de partición sana (mensual) |
| 4-4 | | **Caso: borrar septiembre** | DROP PARTITION frente a `DELETE` frente a `ALTER DELETE` | elegir el borrado más barato |

**Almacén libre**: sandbox con las palancas desbloqueadas y la cámara libre, sin puntuación.

## Win, fail, restart

- **Fallo en el recall** (<80%) → variante con números nuevos (`build(rng)` sembrado), sin pantalla de castigo.
- **Fallo en un reto** (Too many parts, presupuesto de lectura superado) → repetición a cámara lenta de la causa y reintento desde el inicio del reto.
- **Victoria** → 1–3 estrellas por el recall (<80% = 0, ≥80% = 1, ≥90% = 2, 100% = 3) y una **medalla de eficiencia** si se llega al objetivo de lectura, comparada con tu propia mejor marca.
- **Reiniciar** el nivel es instantáneo desde la pausa. **CRAFTER100** (mapa → Código) completa todo con 3 estrellas.

## Challenge and progression

- La dificultad sube añadiendo palancas y modos de fallo, no velocidad: cada mundo añade ~2 palancas y 1 modo de fallo.
- Mapa: polígono 3D con una nave por mundo a lo largo de una carretera; la cámara vuela entre naves; las completadas tienen bandera.
- Dificultad adaptativa: dos fallos seguidos añaden una pista; con tres aciertos perfectos se salta el "Mira".
- Sin leaderboards globales ni XP por entrar. La racha cuenta solo repasos completados.
- **Examen final** (20 preguntas round-robin entre los mundos jugados, 80% para aprobar) y **Final** con confeti, nombre y certificado descargable en PNG.

## Game feel

- Palé sellado → squash & stretch (1.15 → 1, 120 ms), sello con el nombre de la part y *thunk*.
- Merge → la prensa baja, las secciones se deslizan juntas y aparece la nueva etiqueta; *clunk + whoosh*.
- Lectura → Pico avanza; cada caja saltada se apaga con un *tic* que baja de tono y cada caja leída se abre con un *bip*. La campanita final suena más aguda cuanto menos se lee.
- Too many parts → alarma, luz roja en la nave y sacudida de 150 ms (4 px, tune).
- Cámara: el general → acción con dolly suave de 600–900 ms (tune).
- **Presupuesto de juice**: efectos solo en eventos de ClickHouse; nada decorativo mientras se aprende. `prefers-reduced-motion` desactiva sacudidas y destellos y acorta los vuelos de cámara.

## Art direction

- **Estilo**: low-poly cozy con modelos Kenney (CC0) renderizados en vivo, cámara en perspectiva, sombras suaves y tone mapping neutro.
- **Modelos**:
  - Estanterías: `shelf-boxes`/`shelf-end` (Mini Market).
  - Granules: cajas `box-small` del Factory Kit sobre rodillos `conveyor-bars-high` (naranja = sin leer, turquesa = leída, gris = saltada).
  - Muelle, prensa y escáner: cintas, `hopper`, `scanner-high`, `screen-wide` (Factory Kit).
  - Camiones: `delivery`/`truck` (Car Kit).
  - Mapa: naves y chimeneas (City Kit Industrial).
  - **Pico**: robot propio hecho con primitivas al estilo Kenney (cuerpo redondeado, cara-pantalla con expresiones).
- **Paleta** (tema "almacén de noche / consola SQL"): fondo `#0e0f13`, superficies `#18191f` / `#23252d`, texto `#f3f2ec`, **acento amarillo estilo ClickHouse** `#faff69` (siempre con texto casi negro `#121214` encima), secundario violeta `#8a8cff`, leído menta `#3ddbb8`, saltado gris oscuro, peligro `#ff5a5f`. Colores de columna brillantes para fondo oscuro.
- **Legibilidad**: los números importantes (granules o bytes leídos, objetivo) van en el HUD, no en la escena. Las etiquetas CSS2D escalan con la distancia y se ocultan las lejanas. Solo se anima lo que cambia.
- **UI**: paneles como ventanas de consola (vidrio oscuro, borde fino, etiquetas en mono), motivo de barras (un mini gráfico de columnas) en el logo y los kickers, botones de esquinas más marcadas. Diálogo visual-novel abajo al centro (24–28 px, máquina de escribir), respuestas grandes encima, barra de objetivo arriba al centro durante los retos, panel en vivo a la derecha (arriba en móvil), dock abajo. Fuentes: Space Grotesk / Manrope / IBM Plex Mono. Iconos Phosphor.
- **Fondo** (menús y mapa): polígono logístico de noche (estrellas, luna, naves con ventanas amarillas, grúas, camiones con faros). SVG + CSS.

## Audio

- **Buses**: master / music / sfx / ui. La música baja (ducking) durante el brief, las predicciones y el recall, y suena a volumen normal en menús, sandbox y retos.
- **Música**: tres loops CC0 de Juhani Junkala (JRPG Music Packs), todos en modo mayor (comprobado con detección de tonalidad), con fundido cruzado por intensidad: lectura = *Home Town*, menús/mapa/resultados = *Sunshine Coast*, retos = *Preparing For Battle*. Ducking mientras se lee.
- **SFX** (cada uno es un evento): `insert`, `seal`, `merge`, `granule_skip`, `granule_read`, `query_done`, `too_many_parts`, `dedupe_pop`, `partition_drop`, `correct`, `wrong`, `unlock`, `ui_click`.

## Assets

| Key | Description | Source | Status |
| --- | --- | --- | --- |
| shelves | estanterías, paredes, suelo, columnas | kenney:mini-market | downloaded |
| boxes | cajas-granule sobre rodillos | kenney:factory-kit | done |
| factory | rodillos, postes, muros, tolva (muelle y prensa) | kenney:factory-kit | done |
| trucks | camiones de reparto (inserts) | kenney:car-kit | done |
| depot_map | naves, chimeneas, contenedores del mapa | kenney:city-kit-industrial | downloaded |
| pico | robot guía con cara-pantalla | primitivas Three.js (`src/stage/pico.ts`) | done |
| fonts | Bricolage Grotesque / Figtree / JetBrains Mono | Google Fonts vía `next/font` | todo |
| icons | iconos del HUD | @phosphor-icons/react (MIT) | todo |
| sfx_* | los SFX de la sección Audio | sintetizados (`scripts/gen-sfx.mjs`) | done |
| music | todas las capas | procedural (Tone.js) | done |
| og_en / og_es | 1200×630 de la landing | captura (Playwright) | todo |

## Milestones

1. **M1: El verbo en pantalla, desplegado**:
   - almacén 3D con 4 pasillos;
   - **Insertar** trae un camión y sella una part;
   - **Consultar** hace que Pico lea solo el pasillo pedido, con el contador de cajas/bytes;
   - música, SFX, fondo temático, EN/ES, texto grande.

   En vivo en `learnclickhouse.crafter.run`.
2. **M2: Bucle de nivel + Mundo 1**: motor de niveles (DSL de learnkafka), diálogo, predicciones, retos, recall con puerta del 80%, progreso en localStorage, landing con iris, mapa 3D, CRAFTER100, `window.__TEST__` + autoplay.
3. **M3: Contenido**: Mundos 2–4, Almacén libre, Turno de mañana.
4. **M4: Pulido y lanzamiento**: examen y certificado, OG por idioma, pase de accesibilidad y reduced-motion, CREDITS, autoplay de los 18 niveles y playtest del build en producción.

## Out of scope for v1

- Mundos 5–11 → v1.1+: motores de merge (Replacing/Summing/Aggregating/Collapsing/Coalescing, FINAL), cambiar y expirar datos (mutaciones, lightweight DELETE/UPDATE, TTL, tiering), skip indexes y projections, materialized views e ingesta, ejecución y JOINs, tipos y codecs, replicación y sharding.
- Un ClickHouse real detrás y un editor SQL libre.
- Cuentas y sincronización, leaderboards (nunca globales), narración por voz, multijugador.

## Changelog

- 2026-10-02: Research (`docs/research/clickhouse-curriculum.md`, ClickHouse 26.9) y entrevista en 3 rondas. GDD creado: opción C (un almacén con escritura y lectura), 3D en perspectiva en vez de isométrico, v1 de 4 mundos y 18 niveles; se aceptaron todas las demás recomendaciones.
- 2026-10-02: Assets: se descarta el Furniture Kit (su estilo plano y de madera no encaja con Factory Kit / Mini Market / Car Kit); los granules son las cajas del Factory Kit sobre rodillos. Una caja leída o saltada pierde la textura y pasa a un color plano (turquesa / gris), porque teñir la textura naranja no se distinguía.
- 2026-10-02: M1 — almacén 3D en perspectiva (cámara general encuadrada en el espacio libre con `setViewOffset`, plano de seguimiento a Pico al leer), 4 pasillos (`orders`: date, customer_id, city, total), Insertar = camión + sección sellada `all_N_N_0`, Consultar = Pico recorre solo los pasillos pedidos con contador de cajas/bytes, `system.parts`. Sim `Table` (parts, merges, Too many parts, poda por la primera clave) con tests. Tema musical original nuevo en Sol mayor, SFX por evento, fondo de polígono logístico, EN/ES.
- 2026-10-02: Feedback "el bot atraviesa cosas": Pico only moves along walkways and two cross aisles (left by the signs, right after the racks) and reads aisles zig-zag; walkways widened.
- 2026-10-02: M2 — level engine for ClickHouse (`src/levels/`: brief / watch / predict / task + seeded recall check, 80% gate, Leitner progress, CRAFTER100), visual-novel dialogue with Pico (SVG portrait), unmistakable right/wrong feedback, task dock (insert / pick columns + run / ORDER BY), live panels (what Pico read, system.parts, system.columns). Stage: row vs column layout with the "rotate the depot" cinematic (every box flies to its column's aisle by its sticker), compression shown as box size. World 1 (4 levels, EN/ES): Rows vs columns, Only what you ask for, Shrinking aisles, Analytics not a ticket window. Landing (live depot in attract mode, one button, iris) and a 3D logistics-park world map (one City Kit warehouse per world, trucks on the road, camera glides between plots). Autoplay driver (`playtest/driver.js`) passes all 4 levels.
- 2026-10-02: M3 — Worlds 2–4 (14 levels, EN/ES). Sim: background merge selector (contiguous runs, size cap), scaled TOO_MANY_PARTS thresholds (5/15 standing in for 1000/3000), insert dedup by block token (window), multi-column sorting keys with the generic-exclusion rule (2nd key column prunes only where the 1st is constant: 4/6 vs 24/1 granules), partitions (one part per partition per INSERT, max_partitions_per_insert_block, minmax pruning + EXPLAIN funnel), DROP PARTITION / lightweight DELETE / mutation. Stage: sections grouped into partition halls (tinted floor + sign), animated relayout, quick drops for bursts, the merge press (Factory Kit piston), trucks turned away with REJECTED / DUPLICATE stamps, async-insert buffer over the hopper, box masks and rewrites. Panels: active parts meter, primary.idx, EXPLAIN. Morning Shift (/review) spaced review. ICU test compiles every message (an apostrophe before a tag broke 3-3).
- 2026-10-02: Feedback "la música no me gusta" y "la UI se parece mucho a la de Kafka": música → loops CC0 de Juhani Junkala (mayor, crossfade por intensidad, Howler; el botón de SFX ya no silencia la música). UI → tema oscuro de consola con el amarillo ClickHouse como único acento (texto negro encima), Space Grotesk / Manrope / IBM Plex Mono, motivo de barras en el logo, almacén y polígono de noche (suelo oscuro, franjas amarillas, luz de luna + lámpara cálida), Pico amarillo.
