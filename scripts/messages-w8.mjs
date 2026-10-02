// Merges World 8 copy into messages/{en,es}.json (rerunnable).
// SQL quotes are doubled ('') inside rich text because an ICU apostrophe before < or { escapes it.
import { readFileSync, writeFileSync } from "node:fs";

const ui = {
  en: { map: { w8: { title: "Materialized views", body: "Incremental MVs as insert triggers, partial rows in the target, JOINs, backfills, refreshable MVs and the Kafka engine." } } },
  es: { map: { w8: { title: "Vistas materializadas", body: "MVs incrementales como triggers de insert, filas parciales en el destino, JOINs, backfills, MVs refrescables y el motor Kafka." } } },
};

const hallsViews = { en: { src: "page_views · source", mv: "views_per_page · target" }, es: { src: "page_views · origen", mv: "views_per_page · destino" } };
const hallsJoin = { en: { src: "page_views · source", dim: "pages · dimension", mv: "views_by_section · target" }, es: { src: "page_views · origen", dim: "pages · dimensión", mv: "views_by_section · destino" } };

const en = {
  "8-1": {
    title: "A trigger on inserts",
    summary: "An incremental MV runs its SELECT on each inserted block, nothing else.",
    halls: hallsViews.en,
    brief: {
      title: "Not a cached query",
      body: "An incremental <b>materialized view</b> is “just a <b>trigger</b> that runs a query on blocks of data as they're inserted”. It sees <b>only the inserted block</b> and writes the result <code>TO</code> a target table you own. It never re-reads the source: old rows, updates, deletes and drops on the source change nothing in the target.",
    },
    empty: { q: "The MV was just created; page_views already has 3 rows. How many rows does views_per_page have?", why: "0: creating an MV doesn't process rows that were already there." },
    fires: { q: "INSERT INTO page_views two views (page 1 and page 3). How many rows land in views_per_page?", why: "2: the MV ran count() GROUP BY page on that block only: one row for page 1, one for page 3." },
    backfill: {
      title: "Backfill the history",
      body: "The target is missing the 3 views from before the MV existed. Backfill it so sum(views) per page matches page_views, without counting anything twice, then check.",
      all: "INSERT … SELECT (all rows)",
      old: "INSERT … SELECT WHERE ts < MV created",
      truncate: "TRUNCATE views_per_page",
      check: "SELECT page, sum(views) … GROUP BY page",
      success: "Backfill with INSERT INTO target SELECT, limited to rows from before the MV (or truncate and backfill everything). Rows inserted after the MV are already in the target.",
    },
    check: {
      what: { q: "An incremental materialized view is…", trigger: "A trigger that transforms each inserted block", cache: "A cached query result that stays in sync", view: "A normal view computed on every SELECT", why: "A trigger on inserts into the source." },
      history: { q: "CREATE MATERIALIZED VIEW on a table that already has data processes…", nothing: "None of the existing rows", all: "All existing rows", recent: "The last hour", why: "Nothing old: backfill with INSERT INTO target SELECT." },
      block: { q: "One INSERT of {rows} rows covering {pages} different pages fires an MV with count() GROUP BY page. How many rows does it write?", why: "{pages}: one per page in that block." },
      delete: { q: "You DELETE rows from the source table. The MV's target…", unchanged: "Stays the same", updated: "Is updated too", error: "Raises an error", why: "MVs only react to inserts." },
    },
  },
  "8-2": {
    title: "Partial rows",
    summary: "A SummingMergeTree target keeps one row per insert until merges catch up.",
    halls: hallsViews.en,
    brief: {
      title: "One row per block, per key",
      body: "Every INSERT fires the MV, and every firing writes its own rows. With a <b>SummingMergeTree</b> target, rows for the same page are only summed when parts <b>merge</b>. Until then the target holds <b>several partial rows per key</b>. So always read it with <code>sum(views) … GROUP BY page</code>.",
    },
    partials: { q: "Three separate INSERTs, each with one view of page 1. How many rows for page 1 does SELECT * FROM views_per_page show?", why: "4: the old row plus one partial row per INSERT. They'll be summed when the parts merge, at an unknown time." },
    sum: { q: "SELECT page, sum(views) … GROUP BY page. What does page 1 show?", why: "4: the GROUP BY adds the partial rows, so the answer is right before and after merges." },
    read: {
      title: "Read it right",
      body: "Send another batch of views, then get correct totals per page while the target still holds partial rows.",
      insert: "INSERT a batch of views",
      star: "SELECT *",
      sum: "SELECT page, sum(views) … GROUP BY page",
      success: "SELECT * shows partial rows; sum() GROUP BY is right at any time. Don't count on merges having happened.",
    },
    check: {
      rows: { q: "Before merges, how many rows can a SummingMergeTree target have per key?", several: "Several partial rows", one: "Always exactly one", zero: "None until the merge", why: "One per insert (per part) until merges sum them." },
      query: { q: "How do you read totals from that target?", sum: "sum(views) … GROUP BY key", star: "SELECT *", count: "count()", why: "Aggregate again: partial rows add up." },
      inserts: { q: "{n} INSERTs touch the same page and no merge has run. How many rows for that page in the target?", why: "{n}: one per insert." },
      engine: { q: "A good target engine for an MV that counts per key?", summing: "SummingMergeTree (or AggregatingMergeTree)", plain: "A plain MergeTree with one row per key", replacing: "ReplacingMergeTree", why: "Summing or Aggregating, so merges combine the partial rows." },
    },
  },
  "8-3": {
    title: "JOINs fire on the left",
    summary: "An MV with a JOIN reacts to the left table only.",
    halls: hallsJoin.en,
    brief: {
      title: "The dimension is just looked up",
      body: "This MV joins each new block of <code>page_views</code> with <code>pages</code> to get the section. It fires <b>only on inserts into the left-most table</b>. Changing <code>pages</code> doesn't touch rows already in the target: history keeps the old section.",
    },
    dim: { q: "Page 1 moves from news to tech (INSERT INTO pages). Does views_by_section change?", no: "No", yes: "Yes, page 1's rows move to tech", later: "Yes, at the next merge", why: "No: inserts into the right-hand table don't fire the MV." },
    next: { q: "A new view of page 1 arrives. Under which section does the MV write it?", tech: "tech", news: "news", both: "Both", why: "tech: the JOIN runs at insert time with today's pages, so page 1 is now split between news and tech." },
    restate: {
      title: "Restate the history",
      body: "Page 1's old views still say news. Rebuild the target so every view is under today's section, then check.",
      view: "INSERT a view of page 2",
      rebuild: "TRUNCATE + INSERT … SELECT with the JOIN",
      check: "SELECT page, section, sum(views)",
      success: "To apply a dimension change to history you recompute (truncate + backfill), or use a refreshable MV or a dictionary for lookups.",
    },
    check: {
      fires: { q: "An MV selects FROM a JOIN b. Inserts into which table fire it?", left: "Only the left-most one (a)", both: "Both", right: "Only b", why: "The left-most table only." },
      dim: { q: "You update the dimension table of an MV with a JOIN. Rows already in the target…", nothing: "Stay as they were", rewrite: "Are rewritten", error: "Become invalid", why: "Nothing happens to them." },
      populate: { q: "The safest way to backfill an MV's target?", insertSelect: "INSERT INTO target SELECT … FROM source", populate: "CREATE … POPULATE", recreate: "Drop and recreate the MV", why: "POPULATE can miss rows inserted while it runs." },
      alt: { q: "The dimension changes often and history must follow. Better option?", refreshable: "A refreshable MV that recomputes the JOIN", bigger: "A bigger insert block", final: "SELECT … FINAL on the target", why: "A refresh re-runs the whole query with today's dimension." },
    },
  },
  "8-4": {
    title: "Refreshable MVs",
    summary: "Re-run the whole query on a schedule and swap the result in.",
    halls: hallsJoin.en,
    brief: {
      title: "A query on a timer",
      body: "A <b>refreshable</b> MV (production-ready since 24.10) doesn't react to inserts. <code>REFRESH EVERY 1 HOUR</code> re-runs the <b>whole query</b> and <b>atomically replaces</b> the target (or appends, with APPEND). Between refreshes the target is <b>stale</b>. It suits JOINs with changing dimensions and heavy aggregations.",
    },
    between: { q: "A new view arrives between two refreshes. Is it in views_by_section?", no: "No, not until the next refresh", yes: "Yes, at once", why: "No: a refreshable MV only writes when it refreshes." },
    refresh: { q: "The refresh runs. How many parts does the target have afterwards?", why: "1: the full result replaces the old content in one go." },
    fresh: {
      title: "Fresh enough",
      body: "Page 2 moves to tech and new views arrive. Make the target reflect both.",
      dim: "Page 2 → tech",
      views: "INSERT new views",
      refresh: "SYSTEM REFRESH VIEW",
      select: "SELECT page, section, sum(views)",
      success: "The refresh recomputed everything with today's dimension. You trade freshness (the interval) for simplicity.",
    },
    check: {
      how: { q: "A refreshable MV…", rerun: "Re-runs the full query on a schedule", incremental: "Processes each inserted block", trigger: "Fires on dimension changes", why: "Full query, on a schedule (REFRESH EVERY / AFTER)." },
      between: { q: "Between refreshes, the target is…", stale: "Possibly stale", live: "Always up to date", empty: "Empty", why: "It shows the last refresh." },
      swap: { q: "By default a refresh writes its result by…", atomic: "Atomically replacing the target", partial: "Updating changed rows", append: "Appending", why: "Atomic replace; APPEND is opt-in." },
      when: { q: "When does a refreshable MV fit better than an incremental one?", joins: "JOINs with changing dimensions, heavy recomputations", every: "Every per-row counter", never: "Never", why: "When the result depends on more than the newest block." },
    },
  },
  "8-5": {
    title: "The Kafka engine",
    summary: "A Kafka table is a consumer; at-least-once means duplicates can happen.",
    topic: "topic: {rows, plural, one {# message} other {# messages}}",
    brief: {
      title: "A consumer, not storage",
      body: "A <code>Kafka</code> engine table <b>stores nothing</b>: it's a consumer that reads a topic. A materialized view moves what it reads into a MergeTree table: <b>Kafka table → MV → MergeTree</b>. Delivery is <b>at-least-once</b>: if the consumer dies after writing a batch but before committing its offsets, it reads that batch again.",
    },
    where: { q: "4 messages arrive and the MV consumes them. Where are the rows stored?", target: "In the MergeTree target (events)", kafka: "In the Kafka table", both: "In both", why: "In the target: the Kafka table only reads the topic; selecting from it again won't give the same messages back." },
    crash: { q: "The consumer writes messages 5–7, then crashes before committing. After the restart, how many rows have id 5?", why: "2: the uncommitted batch is read and written again. At-least-once." },
    dedup: {
      title: "Duplicates, handled",
      body: "Crashes will happen. Pick a target engine so that reading with FINAL shows each message once, even after a crash.",
      engine: "Target engine",
      engines: { MergeTree: "MergeTree", ReplacingMergeTree: "ReplacingMergeTree(id)" },
      crash: "Messages + crash",
      final: "SELECT * FROM events (FINAL)",
      success: "ReplacingMergeTree keyed by the message id makes the replays harmless: FINAL (or merges) keep one row per id.",
    },
    check: {
      stores: { q: "A table with ENGINE = Kafka…", consumer: "Consumes a topic and stores nothing", storage: "Stores the messages", cache: "Caches recent messages", why: "A consumer; storage is the MV's target." },
      pipeline: { q: "The usual Kafka ingestion pipeline is…", kafkaMvTable: "Kafka table → MV → MergeTree", kafkaTable: "Kafka table only", tableKafka: "MergeTree → Kafka", why: "The MV moves rows from the consumer into storage." },
      delivery: { q: "The Kafka engine's delivery guarantee?", atLeast: "At-least-once", exactly: "Exactly-once", atMost: "At-most-once", why: "At-least-once: plan for duplicates." },
      dups: { q: "A batch of {n} messages is written, the consumer crashes before committing, and it's re-read. How many rows for that batch are in a plain MergeTree target?", why: "{n} × 2 = {total}." },
    },
  },
};

const es = {
  "8-1": {
    title: "Un trigger de inserts",
    summary: "Una MV incremental ejecuta su SELECT en cada bloque insertado, y nada más.",
    halls: hallsViews.es,
    brief: {
      title: "No es una consulta cacheada",
      body: "Una <b>vista materializada</b> incremental es “solo un <b>trigger</b> que ejecuta una consulta sobre los bloques de datos a medida que se insertan”. Ve <b>solo el bloque insertado</b> y escribe el resultado <code>TO</code> una tabla destino que es tuya. Nunca relee el origen: las filas viejas, los updates, deletes y drops en el origen no cambian nada en el destino.",
    },
    empty: { q: "La MV se acaba de crear; page_views ya tiene 3 filas. ¿Cuántas filas tiene views_per_page?", why: "0: crear una MV no procesa las filas que ya estaban." },
    fires: { q: "INSERT INTO page_views de dos visitas (página 1 y página 3). ¿Cuántas filas llegan a views_per_page?", why: "2: la MV ejecutó count() GROUP BY page solo sobre ese bloque: una fila para la página 1 y otra para la 3." },
    backfill: {
      title: "Rellena la historia",
      body: "Al destino le faltan las 3 visitas de antes de crear la MV. Haz el backfill para que sum(views) por página coincida con page_views, sin contar nada dos veces, y compruébalo.",
      all: "INSERT … SELECT (todas las filas)",
      old: "INSERT … SELECT WHERE ts < creación de la MV",
      truncate: "TRUNCATE views_per_page",
      check: "SELECT page, sum(views) … GROUP BY page",
      success: "El backfill se hace con INSERT INTO destino SELECT, limitado a las filas de antes de la MV (o vaciando el destino y rellenándolo todo). Las filas insertadas después de la MV ya están en el destino.",
    },
    check: {
      what: { q: "Una vista materializada incremental es…", trigger: "Un trigger que transforma cada bloque insertado", cache: "Un resultado cacheado que se mantiene sincronizado", view: "Una vista normal que se calcula en cada SELECT", why: "Un trigger sobre los inserts en el origen." },
      history: { q: "CREATE MATERIALIZED VIEW sobre una tabla que ya tiene datos procesa…", nothing: "Ninguna de las filas existentes", all: "Todas las filas existentes", recent: "La última hora", why: "Nada viejo: el backfill se hace con INSERT INTO destino SELECT." },
      block: { q: "Un INSERT de {rows} filas con {pages} páginas distintas dispara una MV con count() GROUP BY page. ¿Cuántas filas escribe?", why: "{pages}: una por página de ese bloque." },
      delete: { q: "Borras filas de la tabla origen. El destino de la MV…", unchanged: "Se queda igual", updated: "También se actualiza", error: "Da un error", why: "Las MVs solo reaccionan a los inserts." },
    },
  },
  "8-2": {
    title: "Filas parciales",
    summary: "Un destino SummingMergeTree guarda una fila por insert hasta que los merges se ponen al día.",
    halls: hallsViews.es,
    brief: {
      title: "Una fila por bloque y por clave",
      body: "Cada INSERT dispara la MV, y cada disparo escribe sus propias filas. Con un destino <b>SummingMergeTree</b>, las filas de una misma página solo se suman cuando las parts se <b>fusionan</b>. Mientras tanto el destino guarda <b>varias filas parciales por clave</b>. Por eso siempre se lee con <code>sum(views) … GROUP BY page</code>.",
    },
    partials: { q: "Tres INSERT separados, cada uno con una visita a la página 1. ¿Cuántas filas de la página 1 muestra SELECT * FROM views_per_page?", why: "4: la fila vieja más una fila parcial por INSERT. Se sumarán cuando se fusionen las parts, en un momento que nadie elige." },
    sum: { q: "SELECT page, sum(views) … GROUP BY page. ¿Qué muestra la página 1?", why: "4: el GROUP BY suma las filas parciales, así que la respuesta es correcta antes y después de los merges." },
    read: {
      title: "Léelo bien",
      body: "Manda otro lote de visitas y saca los totales correctos por página mientras el destino todavía tiene filas parciales.",
      insert: "INSERT de un lote de visitas",
      star: "SELECT *",
      sum: "SELECT page, sum(views) … GROUP BY page",
      success: "SELECT * enseña filas parciales; sum() GROUP BY acierta siempre. No cuentes con que los merges ya hayan pasado.",
    },
    check: {
      rows: { q: "Antes de los merges, ¿cuántas filas por clave puede tener un destino SummingMergeTree?", several: "Varias filas parciales", one: "Siempre exactamente una", zero: "Ninguna hasta el merge", why: "Una por insert (por part) hasta que los merges las suman." },
      query: { q: "¿Cómo lees los totales de ese destino?", sum: "sum(views) … GROUP BY clave", star: "SELECT *", count: "count()", why: "Agregando otra vez: las filas parciales se suman." },
      inserts: { q: "{n} INSERT tocan la misma página y no ha corrido ningún merge. ¿Cuántas filas de esa página hay en el destino?", why: "{n}: una por insert." },
      engine: { q: "¿Un buen motor destino para una MV que cuenta por clave?", summing: "SummingMergeTree (o AggregatingMergeTree)", plain: "Un MergeTree normal con una fila por clave", replacing: "ReplacingMergeTree", why: "Summing o Aggregating, para que los merges combinen las filas parciales." },
    },
  },
  "8-3": {
    title: "Los JOIN disparan por la izquierda",
    summary: "Una MV con JOIN solo reacciona a la tabla de la izquierda.",
    halls: hallsJoin.es,
    brief: {
      title: "La dimensión solo se consulta",
      body: "Esta MV cruza cada bloque nuevo de <code>page_views</code> con <code>pages</code> para sacar la sección. Solo se dispara con <b>inserts en la tabla de más a la izquierda</b>. Cambiar <code>pages</code> no toca las filas que ya están en el destino: la historia conserva la sección vieja.",
    },
    dim: { q: "La página 1 pasa de news a tech (INSERT INTO pages). ¿Cambia views_by_section?", no: "No", yes: "Sí, las filas de la página 1 pasan a tech", later: "Sí, en el siguiente merge", why: "No: los inserts en la tabla de la derecha no disparan la MV." },
    next: { q: "Llega una visita nueva a la página 1. ¿Bajo qué sección la escribe la MV?", tech: "tech", news: "news", both: "Las dos", why: "tech: el JOIN corre en el momento del insert con las páginas de hoy, así que la página 1 queda repartida entre news y tech." },
    restate: {
      title: "Reescribe la historia",
      body: "Las visitas viejas de la página 1 siguen diciendo news. Reconstruye el destino para que todas las visitas estén bajo la sección de hoy y compruébalo.",
      view: "INSERT de una visita a la página 2",
      rebuild: "TRUNCATE + INSERT … SELECT con el JOIN",
      check: "SELECT page, section, sum(views)",
      success: "Para llevar un cambio de dimensión a la historia hay que recalcular (truncate + backfill), o usar una MV refrescable o un diccionario para las búsquedas.",
    },
    check: {
      fires: { q: "Una MV hace SELECT FROM a JOIN b. ¿Los inserts en qué tabla la disparan?", left: "Solo en la de más a la izquierda (a)", both: "En las dos", right: "Solo en b", why: "Solo la de más a la izquierda." },
      dim: { q: "Actualizas la tabla de dimensión de una MV con JOIN. Las filas que ya están en el destino…", nothing: "Se quedan como estaban", rewrite: "Se reescriben", error: "Quedan inválidas", why: "No les pasa nada." },
      populate: { q: "¿La forma más segura de rellenar el destino de una MV?", insertSelect: "INSERT INTO destino SELECT … FROM origen", populate: "CREATE … POPULATE", recreate: "Borrar y recrear la MV", why: "POPULATE puede perder filas insertadas mientras corre." },
      alt: { q: "La dimensión cambia a menudo y la historia debe seguirla. ¿Mejor opción?", refreshable: "Una MV refrescable que recalcula el JOIN", bigger: "Bloques de insert más grandes", final: "SELECT … FINAL sobre el destino", why: "Un refresco vuelve a ejecutar toda la consulta con la dimensión de hoy." },
    },
  },
  "8-4": {
    title: "MVs refrescables",
    summary: "Volver a ejecutar la consulta entera cada cierto tiempo y cambiar el resultado de golpe.",
    halls: hallsJoin.es,
    brief: {
      title: "Una consulta con temporizador",
      body: "Una MV <b>refrescable</b> (lista para producción desde 24.10) no reacciona a los inserts. <code>REFRESH EVERY 1 HOUR</code> vuelve a ejecutar la <b>consulta entera</b> y <b>reemplaza el destino de forma atómica</b> (o añade, con APPEND). Entre refrescos el destino está <b>desactualizado</b>. Encaja con JOINs de dimensiones que cambian y con agregaciones pesadas.",
    },
    between: { q: "Llega una visita nueva entre dos refrescos. ¿Está en views_by_section?", no: "No, hasta el siguiente refresco", yes: "Sí, al instante", why: "No: una MV refrescable solo escribe cuando refresca." },
    refresh: { q: "Corre el refresco. ¿Cuántas parts tiene el destino después?", why: "1: el resultado completo sustituye al contenido viejo de una vez." },
    fresh: {
      title: "Suficientemente fresco",
      body: "La página 2 pasa a tech y llegan visitas nuevas. Haz que el destino refleje las dos cosas.",
      dim: "Página 2 → tech",
      views: "INSERT de visitas nuevas",
      refresh: "SYSTEM REFRESH VIEW",
      select: "SELECT page, section, sum(views)",
      success: "El refresco lo recalculó todo con la dimensión de hoy. Cambias frescura (el intervalo) por sencillez.",
    },
    check: {
      how: { q: "Una MV refrescable…", rerun: "Vuelve a ejecutar la consulta entera cada cierto tiempo", incremental: "Procesa cada bloque insertado", trigger: "Se dispara con los cambios de la dimensión", why: "Consulta completa, programada (REFRESH EVERY / AFTER)." },
      between: { q: "Entre refrescos, el destino está…", stale: "Posiblemente desactualizado", live: "Siempre al día", empty: "Vacío", why: "Muestra el último refresco." },
      swap: { q: "Por defecto, un refresco escribe su resultado…", atomic: "Reemplazando el destino de forma atómica", partial: "Actualizando las filas que cambiaron", append: "Añadiendo", why: "Reemplazo atómico; APPEND es opcional." },
      when: { q: "¿Cuándo encaja mejor una MV refrescable que una incremental?", joins: "JOINs con dimensiones que cambian, recálculos pesados", every: "Para cualquier contador por fila", never: "Nunca", why: "Cuando el resultado depende de algo más que el bloque más nuevo." },
    },
  },
  "8-5": {
    title: "El motor Kafka",
    summary: "Una tabla Kafka es un consumidor; at-least-once significa que puede haber duplicados.",
    topic: "topic: {rows, plural, one {# mensaje} other {# mensajes}}",
    brief: {
      title: "Un consumidor, no un almacén",
      body: "Una tabla con motor <code>Kafka</code> <b>no guarda nada</b>: es un consumidor que lee un topic. Una vista materializada mueve lo que lee a una tabla MergeTree: <b>tabla Kafka → MV → MergeTree</b>. La entrega es <b>at-least-once</b>: si el consumidor se cae después de escribir un lote pero antes de confirmar sus offsets, vuelve a leer ese lote.",
    },
    where: { q: "Llegan 4 mensajes y la MV los consume. ¿Dónde se guardan las filas?", target: "En la tabla MergeTree destino (events)", kafka: "En la tabla Kafka", both: "En las dos", why: "En el destino: la tabla Kafka solo lee el topic; volver a leerla no devuelve los mismos mensajes." },
    crash: { q: "El consumidor escribe los mensajes 5–7 y se cae antes de confirmar. Tras reiniciar, ¿cuántas filas tienen id 5?", why: "2: el lote sin confirmar se vuelve a leer y a escribir. At-least-once." },
    dedup: {
      title: "Duplicados bajo control",
      body: "Las caídas van a pasar. Elige un motor para el destino de forma que, leyendo con FINAL, cada mensaje salga una vez incluso tras una caída.",
      engine: "Motor del destino",
      engines: { MergeTree: "MergeTree", ReplacingMergeTree: "ReplacingMergeTree(id)" },
      crash: "Mensajes + caída",
      final: "SELECT * FROM events (FINAL)",
      success: "Un ReplacingMergeTree con el id del mensaje en la clave hace inofensivas las repeticiones: FINAL (o los merges) dejan una fila por id.",
    },
    check: {
      stores: { q: "Una tabla con ENGINE = Kafka…", consumer: "Consume un topic y no guarda nada", storage: "Guarda los mensajes", cache: "Cachea los mensajes recientes", why: "Un consumidor; el almacenamiento es el destino de la MV." },
      pipeline: { q: "La cadena habitual para ingerir de Kafka es…", kafkaMvTable: "Tabla Kafka → MV → MergeTree", kafkaTable: "Solo la tabla Kafka", tableKafka: "MergeTree → Kafka", why: "La MV mueve las filas del consumidor al almacenamiento." },
      delivery: { q: "¿Qué garantía de entrega tiene el motor Kafka?", atLeast: "At-least-once (al menos una vez)", exactly: "Exactly-once", atMost: "At-most-once", why: "At-least-once: cuenta con duplicados." },
      dups: { q: "Se escribe un lote de {n} mensajes, el consumidor se cae antes de confirmar y se vuelve a leer. ¿Cuántas filas de ese lote hay en un destino MergeTree normal?", why: "{n} × 2 = {total}." },
    },
  },
};

const merge = (a, b) => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = typeof v === "object" && v && typeof out[k] === "object" ? merge(out[k], v) : v;
  return out;
};

for (const [locale, levels] of [["en", en], ["es", es]]) {
  const file = new URL(`../messages/${locale}.json`, import.meta.url);
  const json = JSON.parse(readFileSync(file, "utf8"));
  for (const [ns, add] of Object.entries(ui[locale])) json[ns] = merge(json[ns] ?? {}, add);
  json.levels = { ...(json.levels ?? {}), ...levels };
  writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
  console.log(`updated ${locale}.json`);
}
