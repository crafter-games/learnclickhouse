// Merges World 7 copy into messages/{en,es}.json (rerunnable).
// SQL quotes are doubled ('') inside rich text because an ICU apostrophe before < or { escapes it.
import { readFileSync, writeFileSync } from "node:fs";

const ui = {
  en: {
    panels: {
      skipIndex: "Skip index",
      noIndex: "No skip index on this table.",
      notBuilt: "Not built for this part: read in full",
      skipLegend: "– skipped · ✓ may match, read · FP false positive · ∞ too many values",
      cache: "Query condition cache",
      cacheMiss: "No entry yet: read in full",
      cacheSkipped: "{n, plural, one {# granule} other {# granules}} skipped by the cache",
    },
    map: { w7: { title: "Skip & project", body: "Data-skipping indexes (minmax, set, bloom_filter), GRANULARITY, projections and the query condition cache." } },
  },
  es: {
    panels: {
      skipIndex: "Índice de salto",
      noIndex: "Esta tabla no tiene índice de salto.",
      notBuilt: "No está construido en esta part: se lee entera",
      skipLegend: "– saltado · ✓ puede coincidir, se lee · FP falso positivo · ∞ demasiados valores",
      cache: "Query condition cache",
      cacheMiss: "Aún sin entrada: se lee entera",
      cacheSkipped: "{n, plural, one {# granule saltado} other {# granules saltados}} gracias a la caché",
    },
    map: { w7: { title: "Saltar y proyectar", body: "Índices de salto (minmax, set, bloom_filter), GRANULARITY, proyecciones y la query condition cache." } },
  },
};

const en = {
  "7-1": {
    title: "Skip a block, not a row",
    summary: "minmax skip indexes, and why correlation decides everything.",
    brief: {
      title: "Summaries that say “not here”",
      body: "The primary index only knows the ORDER BY columns. A <b>skip index</b> adds a tiny summary of another column per block of granules, e.g. <code>minmax</code>: the lowest and highest value. It can't find rows: it can only rule out blocks that <b>can't</b> match. So it only helps when the column is <b>correlated with the sorting key</b>; here <code>order_id</code> grows with the date, <code>total</code> is all over the place.",
    },
    order: { q: "SELECT … WHERE order_id = 3500, with minmax on order_id. How many of the 8 granules are read?", why: "1: each granule holds a narrow order_id range, so only the one with 3000–3999 can match." },
    total: { q: "SELECT … WHERE total = 500, with minmax on total. How many of the 8 granules are read?", why: "8: every granule has totals from ~0 to ~999, so 500 fits in all of them. The index is checked and skips nothing." },
    cleanup: {
      title: "An index that pays its way",
      body: "Run both queries and look at the index blocks. Then drop the index that never skips anything: it costs work on every INSERT and is checked on every read.",
      qOrder: "WHERE order_id = 6200",
      qTotal: "WHERE total = 120",
      drop: "DROP INDEX idx_total",
      success: "idx_order skips 7 of 8 granules; idx_total never skipped one. A skip index is a bet on correlation: measure before you keep it.",
    },
    check: {
      what: { q: "What does a skip index do?", blocks: "Rules out blocks of granules that can't match", rows: "Finds the matching rows directly", sort: "Keeps the column sorted", why: "It only skips blocks; matched blocks are still read in full." },
      correlation: { q: "When does a minmax skip index help?", correlated: "When the column is correlated with the sorting key", random: "When values are random", any: "Always", why: "Correlated values give narrow ranges per block, so most blocks can be ruled out." },
      random: { q: "A table has {n} granules and every granule spans the whole range of a column. With minmax on it, how many granules does an equality filter read?", why: "{n}: no block can be ruled out." },
      cost: { q: "What does a skip index that never skips cost?", cost: "Work on every INSERT, disk, and a check on every read", free: "Nothing", faster: "It still speeds things up a little", why: "It's built on insert and merge and evaluated on reads, for no gain." },
    },
  },
  "7-2": {
    title: "set and bloom_filter",
    summary: "Few values per block, or one needle: pick the index type.",
    brief: {
      title: "Three summaries",
      body: "<code>minmax</code> keeps a range. <code>set(N)</code> keeps the distinct values of the block, up to N (more than N and it gives up for that block). <code>bloom_filter</code> answers “<b>maybe</b>” or “<b>definitely not</b>” for one value, with a false-positive rate (default 0.025). For words in text there's the <b>text index</b>, GA since 26.2.",
    },
    set: { q: "status takes 3 values (info, error, warn) and errors appear in 1 granule out of 8. With set(10) on status, how many granules does WHERE status = error read?", why: "1: the set of every other block is [info, warn], so they're skipped. minmax would read all 8: error sits between info and warn." },
    bloom: { q: "trace_id = 42 lives in exactly one granule. With bloom_filter(0.25), how many granules are read?", one: "Exactly one", oneplus: "At least one, maybe a few more", all: "All of them", why: "The bloom filter never misses the right granule, but with a 25% false-positive rate other blocks can say “maybe” too. Here 2 false positives cost 2 extra granules." },
    pick: {
      title: "The right summary for each column",
      body: "Choose an index type for each column so both queries read at most 2 granules.",
      statusIdx: "Index on status",
      traceIdx: "Index on trace_id",
      types: { minmax: "minmax", set: "set(10)", bloom_filter: "bloom_filter" },
      qStatus: "WHERE status = 'error'",
      qTrace: "WHERE trace_id = 42",
      success: "Low cardinality per block → set. One needle among many values → bloom_filter (with the real default rate, 0.025). Ranges on correlated columns → minmax.",
    },
    check: {
      bloom: { q: "A bloom filter says a value is in a block. It means…", maybe: "Maybe: it could be a false positive", exact: "Definitely there", range: "The block's range contains it", why: "“Maybe”. Only “not there” is certain." },
      fpr: { q: "Default false-positive rate of bloom_filter()?", p025: "0.025", p0: "0 (exact)", p50: "0.5", why: "0.025 (2.5%)." },
      set: { q: "A block has more distinct values than set(N) allows. The index…", giveUp: "Can't skip that block", error: "Throws an error", sample: "Keeps a sample", why: "It stores nothing useful for that block, so the block is read." },
      text: { q: "To search words inside a text column, use…", text: "The text index (GA in 26.2)", minmax: "minmax", projection: "A projection", why: "The text (inverted) index maps tokens to rows." },
    },
  },
  "7-3": {
    title: "GRANULARITY and MATERIALIZE",
    summary: "How big an index block is, and why ADD INDEX doesn't touch old data.",
    brief: {
      title: "Blocks of granules",
      body: "<code>GRANULARITY 4</code> means one summary per <b>4 granules</b> (4 × 8,192 rows), not per 4 rows. Bigger blocks make a smaller index but skip in coarser steps. And <code>ADD INDEX</code> only builds the index for <b>new parts</b>: existing parts need <code>MATERIALIZE INDEX</code>, a mutation.",
    },
    added: { q: "ADD INDEX (minmax, GRANULARITY 4) on the existing table, then WHERE order_id = 3500. How many of 8 granules are read?", why: "8: the old part has no index yet. ADD INDEX only covers parts written from now on." },
    materialized: { q: "Now MATERIALIZE INDEX. Same query: how many granules?", why: "4: the index exists, but one summary covers 4 granules, so the whole block with order 3500 is read." },
    tune: {
      title: "Finer steps",
      body: "Pick a GRANULARITY so the query reads a single granule, then rebuild the index.",
      gran: "GRANULARITY",
      grans: { "8": "8", "4": "4", "2": "2", "1": "1" },
      rebuild: "Rebuild + query",
      success: "GRANULARITY 1: one summary per granule, the finest step. Coarser blocks are cheaper to store and check, so tune it to how selective your filters are.",
    },
    check: {
      rows: { q: "GRANULARITY {n} with the default index_granularity of 8,192: how many rows does one index block cover?", why: "{n} × 8,192 = {rows}." },
      add: { q: "ALTER TABLE … ADD INDEX on a table full of data…", newOnly: "Indexes only parts written from now on", all: "Indexes every part at once", none: "Does nothing until restart", why: "New parts only; MATERIALIZE INDEX builds it for the rest." },
      materialize: { q: "MATERIALIZE INDEX is…", mutation: "A mutation over the existing parts", instant: "Instant metadata", merge: "A merge of all parts", why: "A mutation (see system.mutations)." },
      tradeoff: { q: "A bigger GRANULARITY gives…", coarse: "A smaller index that skips in coarser steps", finer: "Finer skipping", same: "No difference", why: "Fewer summaries, but each block is bigger." },
    },
  },
  "7-4": {
    title: "Projections",
    summary: "A second sort order hidden inside every part.",
    brief: {
      title: "Another order, same table",
      body: "The table is sorted by date, but a dashboard filters by customer. A <b>projection</b> stores a hidden copy of some columns <b>inside each part</b>, sorted another way. You never query it by name: the optimizer picks it when it reads fewer granules. It costs disk and work on every insert. Here it shows up as two dashed aisles, empty until it's built for the old part.",
    },
    before: { q: "The projection was just added. SELECT total WHERE customer_id = 1234: how many of 8 granules are read?", why: "8: the existing part doesn't have the projection yet (empty aisles), and the base table is sorted by date." },
    after: { q: "After MATERIALIZE PROJECTION, which path does the query take?", proj: "The projection: 1 granule", base: "The base table: 8 granules", both: "Both at once", why: "The optimizer compares granules to read and takes the projection, sorted by customer_id." },
    paths: {
      title: "Which path?",
      body: "Run the three queries and check EXPLAIN: which ones use the projection, and why not the others?",
      qDate: "WHERE date = 3",
      qCustomer: "WHERE customer_id = 4321",
      qStatus: "SELECT status WHERE customer_id = 4321",
      success: "By date: the base order wins. By customer: the projection. status isn't in the projection, so that query falls back to the base table and reads everything.",
    },
    check: {
      what: { q: "A projection is…", hidden: "A hidden, differently sorted copy inside each part", view: "A separate table you query by name", index: "A skip index", why: "It lives inside every part and is kept in sync by inserts and merges." },
      query: { q: "How do you use a projection in a query?", auto: "You don't: the optimizer picks it", name: "SELECT … FROM the projection's name", hint: "With a mandatory hint", why: "Automatic, when it reads fewer granules." },
      cost: { q: "What does a projection cost?", both: "Extra disk and extra work on every insert", free: "Nothing", reads: "Slower reads", why: "The data is stored twice (in another order)." },
      missing: { q: "The query needs a column the projection doesn't have. ClickHouse…", base: "Uses the base table", error: "Throws an error", partial: "Mixes both", why: "The projection must contain every column the query needs." },
    },
  },
  "7-5": {
    title: "The query condition cache",
    summary: "Remember which granules can't match, per part and filter.",
    brief: {
      title: "One bit per granule",
      body: "<code>LIKE ''%timeout%''</code> can't use any index, so every granule is read. Since 25.4 the <b>query condition cache</b> (on by default) remembers, per part and filter, <b>one bit per granule</b>: 0 means no row there matched. Run the same filter again and the zeros are skipped. It doesn't store results (that's the query cache, off by default), and a <b>new part</b> has no bits yet.",
    },
    first: { q: "First run of WHERE message LIKE timeout. How many of 8 granules are read?", why: "8: no index can help with LIKE, and the cache is empty." },
    second: { q: "Timeouts only appear in 2 granules. Same query again: how many are read?", why: "2: the cache stored a 0 for the 6 granules without matches, so they're skipped." },
    fresh: {
      title: "New data arrives",
      body: "Insert a new part and run the query until it reads only the granules that can match, in both parts.",
      insert: "INSERT new logs",
      query: "WHERE message LIKE '%timeout%'",
      success: "The new part was read in full once, then its bits were cached too. Entries are per part, so merges and new inserts start fresh.",
    },
    check: {
      stores: { q: "What does the query condition cache store?", bits: "One bit per granule: can this filter match here?", results: "The query results", rows: "The matching rows", why: "Bits per (part, filter). The query cache is the one that stores results." },
      default: { q: "Is the query condition cache on by default?", on: "Yes, since 25.4", off: "No", cloud: "Only in ClickHouse Cloud", why: "On by default since 25.4." },
      second: { q: "A filter matches {hits} of {total} granules and the cache is warm. How many granules does the same query read?", why: "{hits}: the other {total} granules have a 0 bit." },
      newPart: { q: "A new part arrives. The next run reads it…", full: "In full: it has no bits yet", cached: "Using the old part's bits", skipped: "Not at all", why: "Entries are per part; a new part starts empty." },
    },
  },
};

const es = {
  "7-1": {
    title: "Saltar un bloque, no una fila",
    summary: "Índices de salto minmax, y por qué la correlación lo decide todo.",
    brief: {
      title: "Resúmenes que dicen “aquí no”",
      body: "El índice primario solo conoce las columnas del ORDER BY. Un <b>índice de salto</b> añade un resumen diminuto de otra columna por bloque de granules, por ejemplo <code>minmax</code>: el valor más bajo y el más alto. No encuentra filas: solo descarta bloques que <b>no pueden</b> coincidir. Por eso solo ayuda si la columna está <b>correlacionada con la clave de orden</b>; aquí <code>order_id</code> crece con la fecha y <code>total</code> está por todas partes.",
    },
    order: { q: "SELECT … WHERE order_id = 3500, con minmax sobre order_id. ¿Cuántos de los 8 granules se leen?", why: "1: cada granule tiene un rango estrecho de order_id, así que solo el de 3000–3999 puede coincidir." },
    total: { q: "SELECT … WHERE total = 500, con minmax sobre total. ¿Cuántos de los 8 granules se leen?", why: "8: todos los granules tienen totales de ~0 a ~999, así que 500 cabe en todos. El índice se consulta y no salta nada." },
    cleanup: {
      title: "Un índice que se gane el sueldo",
      body: "Lanza las dos consultas y mira los bloques del índice. Luego elimina el índice que nunca salta nada: cuesta trabajo en cada INSERT y se consulta en cada lectura.",
      qOrder: "WHERE order_id = 6200",
      qTotal: "WHERE total = 120",
      drop: "DROP INDEX idx_total",
      success: "idx_order salta 7 de 8 granules; idx_total no saltó ninguno. Un índice de salto es una apuesta por la correlación: mide antes de quedártelo.",
    },
    check: {
      what: { q: "¿Qué hace un índice de salto?", blocks: "Descarta bloques de granules que no pueden coincidir", rows: "Encuentra directamente las filas", sort: "Mantiene la columna ordenada", why: "Solo salta bloques; los que pasan se leen enteros." },
      correlation: { q: "¿Cuándo ayuda un índice minmax?", correlated: "Cuando la columna está correlacionada con la clave de orden", random: "Cuando los valores son aleatorios", any: "Siempre", why: "Con valores correlacionados cada bloque tiene un rango estrecho y casi todos se descartan." },
      random: { q: "Una tabla tiene {n} granules y cada uno abarca todo el rango de una columna. Con minmax sobre ella, ¿cuántos granules lee un filtro de igualdad?", why: "{n}: no se puede descartar ningún bloque." },
      cost: { q: "¿Qué cuesta un índice de salto que nunca salta?", cost: "Trabajo en cada INSERT, disco y una comprobación en cada lectura", free: "Nada", faster: "Igual acelera un poco", why: "Se construye al insertar y fusionar y se evalúa al leer, sin ganar nada." },
    },
  },
  "7-2": {
    title: "set y bloom_filter",
    summary: "Pocos valores por bloque, o una aguja: elige el tipo de índice.",
    brief: {
      title: "Tres resúmenes",
      body: "<code>minmax</code> guarda un rango. <code>set(N)</code> guarda los valores distintos del bloque, hasta N (si hay más, se rinde en ese bloque). <code>bloom_filter</code> responde “<b>quizá</b>” o “<b>seguro que no</b>” para un valor, con una tasa de falsos positivos (0.025 por defecto). Para palabras dentro de un texto está el <b>text index</b>, GA desde 26.2.",
    },
    set: { q: "status tiene 3 valores (info, error, warn) y los errores aparecen en 1 granule de 8. Con set(10) sobre status, ¿cuántos granules lee WHERE status = error?", why: "1: el set de los demás bloques es [info, warn], así que se saltan. minmax leería los 8: error está entre info y warn." },
    bloom: { q: "trace_id = 42 vive en un único granule. Con bloom_filter(0.25), ¿cuántos granules se leen?", one: "Exactamente uno", oneplus: "Al menos uno, quizá algunos más", all: "Todos", why: "El bloom filter nunca se salta el granule bueno, pero con un 25% de falsos positivos otros bloques también dicen “quizá”. Aquí 2 falsos positivos cuestan 2 granules de más." },
    pick: {
      title: "El resumen justo para cada columna",
      body: "Elige un tipo de índice para cada columna de modo que las dos consultas lean como mucho 2 granules.",
      statusIdx: "Índice en status",
      traceIdx: "Índice en trace_id",
      types: { minmax: "minmax", set: "set(10)", bloom_filter: "bloom_filter" },
      qStatus: "WHERE status = 'error'",
      qTrace: "WHERE trace_id = 42",
      success: "Pocos valores por bloque → set. Una aguja entre muchos valores → bloom_filter (con la tasa real por defecto, 0.025). Rangos en columnas correlacionadas → minmax.",
    },
    check: {
      bloom: { q: "Un bloom filter dice que un valor está en un bloque. Significa…", maybe: "Quizá: puede ser un falso positivo", exact: "Que seguro está", range: "Que el rango del bloque lo contiene", why: "“Quizá”. Solo el “no está” es seguro." },
      fpr: { q: "¿Tasa de falsos positivos por defecto de bloom_filter()?", p025: "0.025", p0: "0 (exacto)", p50: "0.5", why: "0.025 (2,5%)." },
      set: { q: "Un bloque tiene más valores distintos de los que permite set(N). El índice…", giveUp: "No puede saltar ese bloque", error: "Lanza un error", sample: "Guarda una muestra", why: "No guarda nada útil para ese bloque, así que se lee." },
      text: { q: "Para buscar palabras dentro de una columna de texto, usa…", text: "El text index (GA en 26.2)", minmax: "minmax", projection: "Una proyección", why: "El text index (invertido) relaciona tokens con filas." },
    },
  },
  "7-3": {
    title: "GRANULARITY y MATERIALIZE",
    summary: "Cuánto mide un bloque del índice, y por qué ADD INDEX no toca los datos viejos.",
    brief: {
      title: "Bloques de granules",
      body: "<code>GRANULARITY 4</code> significa un resumen cada <b>4 granules</b> (4 × 8.192 filas), no cada 4 filas. Bloques más grandes dan un índice más pequeño pero saltan a pasos más gruesos. Y <code>ADD INDEX</code> solo construye el índice para las <b>parts nuevas</b>: las que ya existen necesitan <code>MATERIALIZE INDEX</code>, que es una mutación.",
    },
    added: { q: "ADD INDEX (minmax, GRANULARITY 4) sobre la tabla existente y luego WHERE order_id = 3500. ¿Cuántos de 8 granules se leen?", why: "8: la part vieja aún no tiene índice. ADD INDEX solo cubre las parts que se escriban a partir de ahora." },
    materialized: { q: "Ahora MATERIALIZE INDEX. Misma consulta: ¿cuántos granules?", why: "4: el índice existe, pero un resumen cubre 4 granules, así que se lee el bloque entero donde está el pedido 3500." },
    tune: {
      title: "Pasos más finos",
      body: "Elige una GRANULARITY para que la consulta lea un solo granule y reconstruye el índice.",
      gran: "GRANULARITY",
      grans: { "8": "8", "4": "4", "2": "2", "1": "1" },
      rebuild: "Reconstruir + consultar",
      success: "GRANULARITY 1: un resumen por granule, el paso más fino. Los bloques gruesos cuestan menos de guardar y comprobar, así que ajústala a lo selectivos que sean tus filtros.",
    },
    check: {
      rows: { q: "GRANULARITY {n} con el index_granularity por defecto de 8.192: ¿cuántas filas cubre un bloque del índice?", why: "{n} × 8.192 = {rows}." },
      add: { q: "ALTER TABLE … ADD INDEX sobre una tabla llena de datos…", newOnly: "Indexa solo las parts que se escriban desde ahora", all: "Indexa todas las parts al instante", none: "No hace nada hasta reiniciar", why: "Solo parts nuevas; MATERIALIZE INDEX lo construye para las demás." },
      materialize: { q: "MATERIALIZE INDEX es…", mutation: "Una mutación sobre las parts existentes", instant: "Metadatos instantáneos", merge: "Un merge de todas las parts", why: "Una mutación (mira system.mutations)." },
      tradeoff: { q: "Una GRANULARITY mayor da…", coarse: "Un índice más pequeño que salta a pasos más gruesos", finer: "Saltos más finos", same: "Ninguna diferencia", why: "Menos resúmenes, pero cada bloque es más grande." },
    },
  },
  "7-4": {
    title: "Proyecciones",
    summary: "Un segundo orden escondido dentro de cada part.",
    brief: {
      title: "Otro orden, la misma tabla",
      body: "La tabla está ordenada por fecha, pero un dashboard filtra por cliente. Una <b>proyección</b> guarda una copia oculta de algunas columnas <b>dentro de cada part</b>, ordenada de otra forma. Nunca la consultas por su nombre: el optimizador la elige cuando lee menos granules. Cuesta disco y trabajo en cada insert. Aquí aparece como dos pasillos discontinuos, vacíos hasta que se construye para la part vieja.",
    },
    before: { q: "La proyección se acaba de añadir. SELECT total WHERE customer_id = 1234: ¿cuántos de 8 granules se leen?", why: "8: la part existente aún no tiene la proyección (pasillos vacíos) y la tabla base está ordenada por fecha." },
    after: { q: "Después de MATERIALIZE PROJECTION, ¿qué camino toma la consulta?", proj: "La proyección: 1 granule", base: "La tabla base: 8 granules", both: "Los dos a la vez", why: "El optimizador compara cuántos granules leería y elige la proyección, ordenada por customer_id." },
    paths: {
      title: "¿Qué camino?",
      body: "Lanza las tres consultas y mira EXPLAIN: ¿cuáles usan la proyección y por qué las otras no?",
      qDate: "WHERE date = 3",
      qCustomer: "WHERE customer_id = 4321",
      qStatus: "SELECT status WHERE customer_id = 4321",
      success: "Por fecha gana el orden base. Por cliente, la proyección. status no está en la proyección, así que esa consulta vuelve a la tabla base y lo lee todo.",
    },
    check: {
      what: { q: "Una proyección es…", hidden: "Una copia oculta y ordenada de otra forma dentro de cada part", view: "Una tabla aparte que consultas por nombre", index: "Un índice de salto", why: "Vive dentro de cada part y los inserts y merges la mantienen al día." },
      query: { q: "¿Cómo usas una proyección en una consulta?", auto: "No haces nada: la elige el optimizador", name: "SELECT … FROM el nombre de la proyección", hint: "Con una pista obligatoria", why: "Automático, cuando lee menos granules." },
      cost: { q: "¿Qué cuesta una proyección?", both: "Disco extra y trabajo extra en cada insert", free: "Nada", reads: "Lecturas más lentas", why: "Los datos se guardan dos veces (en otro orden)." },
      missing: { q: "La consulta necesita una columna que la proyección no tiene. ClickHouse…", base: "Usa la tabla base", error: "Lanza un error", partial: "Mezcla las dos", why: "La proyección debe tener todas las columnas que necesita la consulta." },
    },
  },
  "7-5": {
    title: "La query condition cache",
    summary: "Recordar qué granules no pueden coincidir, por part y filtro.",
    brief: {
      title: "Un bit por granule",
      body: "<code>LIKE ''%timeout%''</code> no puede usar ningún índice, así que se leen todos los granules. Desde 25.4 la <b>query condition cache</b> (activa por defecto) recuerda, por part y filtro, <b>un bit por granule</b>: 0 significa que ahí no coincidió ninguna fila. Repite el mismo filtro y los ceros se saltan. No guarda resultados (eso es la query cache, desactivada por defecto) y una <b>part nueva</b> aún no tiene bits.",
    },
    first: { q: "Primera ejecución de WHERE message LIKE timeout. ¿Cuántos de 8 granules se leen?", why: "8: ningún índice ayuda con LIKE y la caché está vacía." },
    second: { q: "Los timeouts solo aparecen en 2 granules. La misma consulta otra vez: ¿cuántos se leen?", why: "2: la caché guardó un 0 para los 6 granules sin coincidencias, así que se saltan." },
    fresh: {
      title: "Llegan datos nuevos",
      body: "Inserta una part nueva y lanza la consulta hasta que lea solo los granules que pueden coincidir, en las dos parts.",
      insert: "INSERT de logs nuevos",
      query: "WHERE message LIKE '%timeout%'",
      success: "La part nueva se leyó entera una vez y luego también se guardaron sus bits. Las entradas son por part, así que los merges y los inserts nuevos empiezan de cero.",
    },
    check: {
      stores: { q: "¿Qué guarda la query condition cache?", bits: "Un bit por granule: ¿puede coincidir aquí este filtro?", results: "Los resultados de la consulta", rows: "Las filas que coinciden", why: "Bits por (part, filtro). La que guarda resultados es la query cache." },
      default: { q: "¿Está activa por defecto la query condition cache?", on: "Sí, desde 25.4", off: "No", cloud: "Solo en ClickHouse Cloud", why: "Activa por defecto desde 25.4." },
      second: { q: "Un filtro coincide en {hits} de {total} granules y la caché está caliente. ¿Cuántos granules lee la misma consulta?", why: "{hits}: el resto de los {total} granules tiene un bit a 0." },
      newPart: { q: "Llega una part nueva. La siguiente ejecución la lee…", full: "Entera: aún no tiene bits", cached: "Con los bits de la part vieja", skipped: "Nada", why: "Las entradas son por part; una part nueva empieza vacía." },
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
