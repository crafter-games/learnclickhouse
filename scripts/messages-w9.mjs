// Merges World 9 copy into messages/{en,es}.json (rerunnable).
// SQL quotes are doubled ('') inside rich text because an ICU apostrophe before < or { escapes it.
import { readFileSync, writeFileSync } from "node:fs";

const ui = {
  en: {
    panels: { spilled: "Over the memory limit: the hash join spills to disk (slower)." },
    map: { w9: { title: "Query execution", body: "Parallel threads, PREWHERE, lazy materialization, hash joins and the build side, dictionaries and query_log." } },
  },
  es: {
    panels: { spilled: "Por encima del límite de memoria: el hash join vuelca a disco (más lento)." },
    map: { w9: { title: "Ejecución de consultas", body: "Hilos en paralelo, PREWHERE, lazy materialization, hash joins y su lado de construcción, diccionarios y query_log." } },
  },
};

const en = {
  "9-1": {
    title: "Many hands",
    summary: "Vectorized blocks and granule ranges spread over max_threads.",
    brief: {
      title: "One Pico per core",
      body: "ClickHouse processes <b>blocks of column values</b> at a time (vectorized), not row by row. And it splits the granules to read into ranges, one per thread: <code>max_threads</code> defaults to the number of cores. <code>system.query_log</code> tells you what each query cost: <code>read_rows</code>, <code>read_bytes</code>, <code>query_duration_ms</code>. Here one granule takes a thread 40 ms.",
    },
    one: { q: "SELECT sum(total) reads the total column: 16 granules. With max_threads = 1, what's query_duration_ms?", why: "640: one thread reads all 16 granules, 40 ms each." },
    four: { q: "Same query with max_threads = 4. query_duration_ms?", why: "160: each thread reads 4 granules at the same time as the others." },
    sla: {
      title: "Under 100 ms",
      body: "The dashboard needs this query under 100 ms. Choose max_threads and run it.",
      threads: "max_threads",
      counts: { "1": "1", "2": "2", "4": "4", "8": "8" },
      run: "SELECT sum(total) FROM hits",
      success: "8 threads, 2 granules each: 80 ms. More threads make one query faster but use more cores, which other queries then don't get.",
    },
    check: {
      vector: { q: "ClickHouse executes operators on…", blocks: "Blocks of column values (vectorized)", rows: "One row at a time", pages: "Disk pages", why: "Blocks of column arrays, so CPUs work on many values per instruction." },
      split: { q: "A query reads {granules} granules with max_threads = {threads}. How many granules does each thread read (evenly split)?", why: "{granules} ÷ {threads} = {n}." },
      default: { q: "Default max_threads?", cores: "The number of CPU cores", one: "1", unlimited: "Unlimited", why: "As many as cores." },
      log: { q: "Where do you find read_rows, read_bytes and query_duration_ms of past queries?", queryLog: "system.query_log", parts: "system.parts", settings: "system.settings", why: "system.query_log, one row per query." },
    },
  },
  "9-2": {
    title: "PREWHERE",
    summary: "Read the filter first; the wide columns only where rows match.",
    brief: {
      title: "Filter, then fetch",
      body: "With <b>PREWHERE</b> ClickHouse reads the <b>filter columns first</b>, and the other columns only for the granules where some row matched. You rarely write it: <code>optimize_move_to_prewhere = 1</code> (the default) moves the right conditions from WHERE automatically. It pays off when the filter is narrow and the selected columns are wide, like <code>payload</code> here.",
    },
    off: { q: "With the optimization off: SELECT payload WHERE status = error. In how many of 16 granules is payload read?", why: "16: without PREWHERE every column is read for every candidate granule, and filtered afterwards." },
    on: { q: "With PREWHERE (the default), errors only occur in 2 granules. How many payload granules are read?", why: "2: status is read everywhere (it's tiny), payload only where a row matched." },
    budget: {
      title: "Someone turned it off",
      body: "This server has optimize_move_to_prewhere = 0. Make the query read at most 15% of the table's bytes.",
      setting: "optimize_move_to_prewhere",
      values: { "0": "0", "1": "1" },
      run: "SELECT payload WHERE total > 9000",
      success: "PREWHERE read total everywhere and payload in a single granule. Leave the default on.",
    },
    check: {
      what: { q: "PREWHERE…", filterFirst: "Reads filter columns first, the rest only where rows match", index: "Builds an index", cache: "Caches the result", why: "It postpones reading the other columns." },
      auto: { q: "Do you need to write PREWHERE by hand?", auto: "Rarely: optimize_move_to_prewhere moves it automatically", manual: "Always", never: "It's not supported", why: "On by default." },
      count: { q: "A filter matches rows in {hit} of {total} granules. With PREWHERE, in how many granules is a wide selected column read?", why: "{hit}: only where rows match." },
      best: { q: "PREWHERE helps most when the selected columns are…", wide: "Wide (big strings) and the filter is selective", narrow: "Tiny", key: "The sorting key", why: "It saves reading big columns for granules that don't match." },
    },
  },
  "9-3": {
    title: "Lazy materialization",
    summary: "For ORDER BY … LIMIT, read the wide columns last, only for the top rows.",
    brief: {
      title: "Sort first, fetch later",
      body: "<code>SELECT * … ORDER BY total DESC LIMIT 3</code> needs every <code>total</code> to find the top 3, but only 3 rows of the other columns. <b>Lazy materialization</b> (on by default since 25.4) reads the sort column first and the remaining columns only for the rows that make the cut. It works for small LIMITs.",
    },
    off: { q: "Lazy materialization off: in how many of 16 granules is payload read?", why: "16: every column of every granule is read, then sorted, and almost everything is thrown away." },
    on: { q: "On (the default): the top 3 totals are all in one granule. How many payload granules are read?", why: "1: total is read everywhere, payload only for the granule holding the top 3." },
    top: {
      title: "Top 3, cheaply",
      body: "Get the top orders by total reading payload in at most one granule.",
      lazy: "lazy materialization",
      values: { "0": "off", "1": "on" },
      limit: "LIMIT",
      limits: { "100000": "100000", "3": "3" },
      run: "SELECT * ORDER BY total DESC",
      success: "Lazy materialization plus a small LIMIT: payload from one granule. With a huge LIMIT, almost every granule makes the cut anyway.",
    },
    check: {
      what: { q: "Lazy materialization reads the non-sort columns…", topRows: "Only for the rows that end up in the result", allRows: "For all rows", cache: "From a cache", why: "After sorting, only for the top rows." },
      when: { q: "Which query benefits?", limit: "ORDER BY … LIMIT n with wide columns", groupBy: "GROUP BY without LIMIT", insert: "INSERT", why: "Top-n queries." },
      default: { q: "Is lazy materialization on by default?", on: "Yes, since 25.4", off: "No", cloud: "Only in Cloud", why: "On since 25.4." },
      big: { q: "With LIMIT 100000 instead of 3, the savings are…", less: "Much smaller: most granules make the cut", same: "The same", more: "Bigger", why: "More rows in the result, more granules to fetch." },
    },
  },
  "9-4": {
    title: "Hash joins",
    summary: "Which side becomes the in-memory hash table, and who decides.",
    hash: "hash table: {rows} rows",
    halls: { orders: "orders · 64k rows", customers: "customers · 5k rows" },
    brief: {
      title: "Build, then probe",
      body: "A <b>hash join</b> reads one side into an in-memory <b>hash table</b> (the build side, normally the right-hand table) and streams the other side through it. The old rule says “put the small table on the right”. Since 24.12 the planner <b>swaps sides</b> on its own (<code>query_plan_join_swap_table = ''auto''</code>), and since 26.5 a hash join over its memory budget <b>spills to disk</b> instead of failing. The default <code>join_algorithm</code> is <code>direct,parallel_hash,hash,ie_join</code>.",
    },
    auto: { q: "customers JOIN orders: the big table is on the right. With the planner's swap on (auto), which table becomes the hash table?", customers: "customers", orders: "orders", why: "customers: the planner estimates both sides and builds the smaller one, whatever the SQL order." },
    legacy: { q: "Same query with query_plan_join_swap_table = false. Which table becomes the hash table?", customers: "customers", orders: "orders", why: "orders, the right-hand table: 64k rows don't fit the 1 MiB budget, so the join spills to disk and slows down." },
    fit: {
      title: "The legacy rule",
      body: "On a server with the swap turned off, get the join to fit in memory (1 MiB). Choose the table order, then run it.",
      order: "FROM",
      orders: { co: "customers JOIN orders", oc: "orders JOIN customers" },
      swap: "join swap",
      swaps: { auto: "auto", false: "false" },
      run: "Run the JOIN",
      success: "Without the swap, the small table must be on the right. With the default (auto) the planner does it for you, and since 25.9 it even reorders joins of several tables using statistics.",
    },
    check: {
      build: { q: "Without the planner's swap, which side of a hash join becomes the hash table?", right: "The right-hand table", left: "The left-hand table", both: "Both", why: "The right side is the build side." },
      swap: { q: "query_plan_join_swap_table = 'auto' (since 24.12)…", swaps: "Lets the planner make the smaller side the build side", never: "Never swaps", random: "Picks randomly", why: "It uses size estimates." },
      spill: { q: "A hash join exceeds its memory budget (26.5+). It…", spill: "Spills to disk and keeps going, slower", crash: "Always fails with MEMORY_LIMIT_EXCEEDED", skip: "Skips rows", why: "It spills at 50% of memory (max_bytes_ratio_before_external_join)." },
      memory: { q: "A build side of {k} rows at 48 bytes per entry needs how many bytes?", why: "{k} × 48 = {n}." },
    },
  },
  "9-5": {
    title: "Dictionaries",
    summary: "In-memory lookups with dictGet, reloaded every LIFETIME.",
    dict: "dictionary: {rows, plural, one {# key} other {# keys}}",
    halls: { orders: "orders", customers: "customers" },
    brief: {
      title: "A map in memory",
      body: "A <b>dictionary</b> loads a key → attributes map into memory, and <code>dictGet</code> looks values up without a JOIN. It's reloaded from its source every <code>LIFETIME</code> (here 300–360 s), so between reloads it can be <b>stale</b>. For plain filtering, <code>IN (subquery)</code> builds a set and is often cheaper than a JOIN.",
    },
    stale: { q: "Customer 2 moves from Madrid to Lima (INSERT INTO customers). Right after, what does dictGet return for customer 2?", madrid: "Madrid", lima: "Lima", error: "An error", why: "Madrid: the dictionary in memory hasn't reloaded yet." },
    join: { q: "And a JOIN with customers at the same moment?", lima: "Lima", madrid: "Madrid", why: "Lima: the JOIN reads the table now." },
    reload: {
      title: "Fresh lookups",
      body: "Make dictGet return today's cities for every order.",
      move: "Customer 3 → Bogotá",
      reload: "SYSTEM RELOAD DICTIONARY",
      query: "SELECT dictGet(…)",
      success: "Reloaded: the lookups match the table again. Pick LIFETIME by how stale you can afford to be.",
    },
    check: {
      what: { q: "A dictionary is…", memory: "A key → attributes map kept in memory", table: "A MergeTree table", index: "A skip index", why: "In memory, queried with dictGet." },
      fresh: { q: "After the source table changes, a dictionary shows the change…", lifetime: "At the next reload (LIFETIME or SYSTEM RELOAD)", always: "Immediately", never: "Never", why: "It's a snapshot until it reloads." },
      in: { q: "To filter orders by a list of customers from another table, often cheaper is…", in: "WHERE customer IN (SELECT …)", join: "A JOIN", same: "No difference", why: "IN builds a set; no columns from the other table are needed." },
      default: { q: "The default join_algorithm in 26.8 is…", list: "direct,parallel_hash,hash,ie_join", hash: "hash", merge: "full_sorting_merge", why: "A list, tried in order (direct needs a dictionary-like right side)." },
    },
  },
};

const es = {
  "9-1": {
    title: "Muchas manos",
    summary: "Bloques vectorizados y rangos de granules repartidos entre max_threads.",
    brief: {
      title: "Un Pico por núcleo",
      body: "ClickHouse procesa <b>bloques de valores de columna</b> de una vez (vectorizado), no fila a fila. Y reparte los granules a leer en rangos, uno por hilo: <code>max_threads</code> vale por defecto el número de núcleos. <code>system.query_log</code> te dice lo que costó cada consulta: <code>read_rows</code>, <code>read_bytes</code>, <code>query_duration_ms</code>. Aquí un granule le cuesta a un hilo 40 ms.",
    },
    one: { q: "SELECT sum(total) lee la columna total: 16 granules. Con max_threads = 1, ¿cuánto vale query_duration_ms?", why: "640: un solo hilo lee los 16 granules, 40 ms cada uno." },
    four: { q: "La misma consulta con max_threads = 4. ¿query_duration_ms?", why: "160: cada hilo lee 4 granules a la vez que los demás." },
    sla: {
      title: "Por debajo de 100 ms",
      body: "El dashboard necesita esta consulta por debajo de 100 ms. Elige max_threads y lánzala.",
      threads: "max_threads",
      counts: { "1": "1", "2": "2", "4": "4", "8": "8" },
      run: "SELECT sum(total) FROM hits",
      success: "8 hilos, 2 granules cada uno: 80 ms. Más hilos aceleran una consulta pero ocupan más núcleos, que luego no tienen las demás.",
    },
    check: {
      vector: { q: "ClickHouse ejecuta los operadores sobre…", blocks: "Bloques de valores de columna (vectorizado)", rows: "Una fila cada vez", pages: "Páginas de disco", why: "Bloques de arrays de columna, para que la CPU trabaje con muchos valores por instrucción." },
      split: { q: "Una consulta lee {granules} granules con max_threads = {threads}. ¿Cuántos granules lee cada hilo (reparto parejo)?", why: "{granules} ÷ {threads} = {n}." },
      default: { q: "¿Valor por defecto de max_threads?", cores: "El número de núcleos de CPU", one: "1", unlimited: "Ilimitado", why: "Tantos como núcleos." },
      log: { q: "¿Dónde encuentras read_rows, read_bytes y query_duration_ms de consultas pasadas?", queryLog: "system.query_log", parts: "system.parts", settings: "system.settings", why: "system.query_log, una fila por consulta." },
    },
  },
  "9-2": {
    title: "PREWHERE",
    summary: "Leer primero el filtro; las columnas anchas solo donde hay filas que coinciden.",
    brief: {
      title: "Filtrar y después traer",
      body: "Con <b>PREWHERE</b> ClickHouse lee <b>primero las columnas del filtro</b>, y las demás solo en los granules donde alguna fila coincidió. Casi nunca lo escribes: <code>optimize_move_to_prewhere = 1</code> (por defecto) mueve automáticamente las condiciones adecuadas desde el WHERE. Compensa cuando el filtro es estrecho y las columnas pedidas son anchas, como <code>payload</code> aquí.",
    },
    off: { q: "Con la optimización desactivada: SELECT payload WHERE status = error. ¿En cuántos de los 16 granules se lee payload?", why: "16: sin PREWHERE se leen todas las columnas de cada granule candidato y se filtra después." },
    on: { q: "Con PREWHERE (por defecto), los errores solo aparecen en 2 granules. ¿Cuántos granules de payload se leen?", why: "2: status se lee entero (es diminuto) y payload solo donde coincidió alguna fila." },
    budget: {
      title: "Alguien lo desactivó",
      body: "Este servidor tiene optimize_move_to_prewhere = 0. Haz que la consulta lea como mucho el 15% de los bytes de la tabla.",
      setting: "optimize_move_to_prewhere",
      values: { "0": "0", "1": "1" },
      run: "SELECT payload WHERE total > 9000",
      success: "PREWHERE leyó total entero y payload en un solo granule. Deja el valor por defecto.",
    },
    check: {
      what: { q: "PREWHERE…", filterFirst: "Lee primero las columnas del filtro y el resto solo donde hay coincidencias", index: "Construye un índice", cache: "Cachea el resultado", why: "Aplaza la lectura de las demás columnas." },
      auto: { q: "¿Hay que escribir PREWHERE a mano?", auto: "Rara vez: optimize_move_to_prewhere lo mueve solo", manual: "Siempre", never: "No está soportado", why: "Activo por defecto." },
      count: { q: "Un filtro encuentra filas en {hit} de {total} granules. Con PREWHERE, ¿en cuántos granules se lee una columna ancha pedida?", why: "{hit}: solo donde hay coincidencias." },
      best: { q: "PREWHERE ayuda más cuando las columnas pedidas son…", wide: "Anchas (strings grandes) y el filtro es selectivo", narrow: "Diminutas", key: "La clave de orden", why: "Se ahorra leer columnas grandes en granules que no coinciden." },
    },
  },
  "9-3": {
    title: "Lazy materialization",
    summary: "En ORDER BY … LIMIT, leer las columnas anchas al final y solo para las primeras filas.",
    brief: {
      title: "Ordenar primero, traer después",
      body: "<code>SELECT * … ORDER BY total DESC LIMIT 3</code> necesita todos los <code>total</code> para encontrar los 3 primeros, pero solo 3 filas de las demás columnas. La <b>lazy materialization</b> (activa por defecto desde 25.4) lee primero la columna de orden y el resto solo para las filas que quedan dentro. Funciona con LIMITs pequeños.",
    },
    off: { q: "Lazy materialization desactivada: ¿en cuántos de los 16 granules se lee payload?", why: "16: se leen todas las columnas de todos los granules, se ordena y se tira casi todo." },
    on: { q: "Activada (por defecto): los 3 totales más altos están en un granule. ¿Cuántos granules de payload se leen?", why: "1: total se lee entero y payload solo del granule que tiene el top 3." },
    top: {
      title: "Top 3, barato",
      body: "Saca los pedidos con mayor total leyendo payload como mucho en un granule.",
      lazy: "lazy materialization",
      values: { "0": "off", "1": "on" },
      limit: "LIMIT",
      limits: { "100000": "100000", "3": "3" },
      run: "SELECT * ORDER BY total DESC",
      success: "Lazy materialization y un LIMIT pequeño: payload de un solo granule. Con un LIMIT enorme casi todos los granules entran igualmente.",
    },
    check: {
      what: { q: "La lazy materialization lee las columnas que no son de orden…", topRows: "Solo para las filas que acaban en el resultado", allRows: "Para todas las filas", cache: "Desde una caché", why: "Después de ordenar, solo para las primeras filas." },
      when: { q: "¿Qué consulta se beneficia?", limit: "ORDER BY … LIMIT n con columnas anchas", groupBy: "GROUP BY sin LIMIT", insert: "INSERT", why: "Consultas de top-n." },
      default: { q: "¿Está activa por defecto la lazy materialization?", on: "Sí, desde 25.4", off: "No", cloud: "Solo en Cloud", why: "Activa desde 25.4." },
      big: { q: "Con LIMIT 100000 en vez de 3, el ahorro es…", less: "Mucho menor: casi todos los granules entran", same: "El mismo", more: "Mayor", why: "Más filas en el resultado, más granules que traer." },
    },
  },
  "9-4": {
    title: "Hash joins",
    summary: "Qué lado se convierte en la tabla hash en memoria, y quién lo decide.",
    hash: "tabla hash: {rows} filas",
    halls: { orders: "orders · 64k filas", customers: "customers · 5k filas" },
    brief: {
      title: "Construir y luego sondear",
      body: "Un <b>hash join</b> carga un lado en una <b>tabla hash</b> en memoria (el lado de construcción, normalmente la tabla de la derecha) y hace pasar el otro lado por ella. La regla de siempre dice “pon la tabla pequeña a la derecha”. Desde 24.12 el planificador <b>intercambia los lados</b> por su cuenta (<code>query_plan_join_swap_table = ''auto''</code>), y desde 26.5 un hash join que se pasa de memoria <b>vuelca a disco</b> en vez de fallar. El <code>join_algorithm</code> por defecto es <code>direct,parallel_hash,hash,ie_join</code>.",
    },
    auto: { q: "customers JOIN orders: la tabla grande está a la derecha. Con el intercambio del planificador activo (auto), ¿qué tabla se convierte en la tabla hash?", customers: "customers", orders: "orders", why: "customers: el planificador estima los dos lados y construye con el pequeño, da igual el orden del SQL." },
    legacy: { q: "La misma consulta con query_plan_join_swap_table = false. ¿Qué tabla se convierte en la tabla hash?", customers: "customers", orders: "orders", why: "orders, la de la derecha: 64k filas no caben en 1 MiB, así que el join vuelca a disco y se vuelve lento." },
    fit: {
      title: "La regla de siempre",
      body: "En un servidor con el intercambio desactivado, haz que el join quepa en memoria (1 MiB). Elige el orden de las tablas y lánzalo.",
      order: "FROM",
      orders: { co: "customers JOIN orders", oc: "orders JOIN customers" },
      swap: "intercambio",
      swaps: { auto: "auto", false: "false" },
      run: "Lanzar el JOIN",
      success: "Sin el intercambio, la tabla pequeña tiene que ir a la derecha. Con el valor por defecto (auto) lo hace el planificador, y desde 25.9 incluso reordena joins de varias tablas usando estadísticas.",
    },
    check: {
      build: { q: "Sin el intercambio del planificador, ¿qué lado de un hash join se convierte en la tabla hash?", right: "La tabla de la derecha", left: "La tabla de la izquierda", both: "Las dos", why: "El lado derecho es el de construcción." },
      swap: { q: "query_plan_join_swap_table = 'auto' (desde 24.12)…", swaps: "Deja que el planificador construya con el lado más pequeño", never: "Nunca intercambia", random: "Elige al azar", why: "Usa estimaciones de tamaño." },
      spill: { q: "Un hash join se pasa de su presupuesto de memoria (26.5+). Entonces…", spill: "Vuelca a disco y sigue, más lento", crash: "Siempre falla con MEMORY_LIMIT_EXCEEDED", skip: "Se salta filas", why: "Vuelca al 50% de la memoria (max_bytes_ratio_before_external_join)." },
      memory: { q: "Un lado de construcción de {k} filas, a 48 bytes por entrada, ¿cuántos bytes necesita?", why: "{k} × 48 = {n}." },
    },
  },
  "9-5": {
    title: "Diccionarios",
    summary: "Búsquedas en memoria con dictGet, recargadas cada LIFETIME.",
    dict: "diccionario: {rows, plural, one {# clave} other {# claves}}",
    halls: { orders: "orders", customers: "customers" },
    brief: {
      title: "Un mapa en memoria",
      body: "Un <b>diccionario</b> carga en memoria un mapa clave → atributos, y <code>dictGet</code> busca valores sin hacer JOIN. Se recarga desde su origen cada <code>LIFETIME</code> (aquí 300–360 s), así que entre recargas puede estar <b>desactualizado</b>. Para filtrar sin más, <code>IN (subconsulta)</code> construye un conjunto y suele salir más barato que un JOIN.",
    },
    stale: { q: "El cliente 2 se muda de Madrid a Lima (INSERT INTO customers). Justo después, ¿qué devuelve dictGet para el cliente 2?", madrid: "Madrid", lima: "Lima", error: "Un error", why: "Madrid: el diccionario en memoria aún no se ha recargado." },
    join: { q: "¿Y un JOIN con customers en ese mismo momento?", lima: "Lima", madrid: "Madrid", why: "Lima: el JOIN lee la tabla en ese momento." },
    reload: {
      title: "Búsquedas al día",
      body: "Haz que dictGet devuelva las ciudades de hoy para todos los pedidos.",
      move: "Cliente 3 → Bogotá",
      reload: "SYSTEM RELOAD DICTIONARY",
      query: "SELECT dictGet(…)",
      success: "Recargado: las búsquedas vuelven a coincidir con la tabla. Elige el LIFETIME según cuánto desfase te puedes permitir.",
    },
    check: {
      what: { q: "Un diccionario es…", memory: "Un mapa clave → atributos guardado en memoria", table: "Una tabla MergeTree", index: "Un índice de salto", why: "En memoria, consultado con dictGet." },
      fresh: { q: "Cuando cambia la tabla origen, un diccionario muestra el cambio…", lifetime: "En la siguiente recarga (LIFETIME o SYSTEM RELOAD)", always: "Al instante", never: "Nunca", why: "Es una foto fija hasta que se recarga." },
      in: { q: "Para filtrar pedidos por una lista de clientes de otra tabla, suele ser más barato…", in: "WHERE customer IN (SELECT …)", join: "Un JOIN", same: "Da igual", why: "IN construye un conjunto; no hacen falta columnas de la otra tabla." },
      default: { q: "El join_algorithm por defecto en 26.8 es…", list: "direct,parallel_hash,hash,ie_join", hash: "hash", merge: "full_sorting_merge", why: "Una lista que se prueba en orden (direct necesita un lado derecho tipo diccionario)." },
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
