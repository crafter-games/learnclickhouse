// Merges World 6 copy into messages/{en,es}.json (rerunnable).
// SQL quotes are doubled ('') because an ICU apostrophe before < or { escapes it.
import { readFileSync, writeFileSync } from "node:fs";

const ui = {
  en: {
    panels: { masked: "−{n} hidden", noMutations: "No mutations yet.", rewritten: "Rows rewritten (total)", rowsShort: "{n} rows", today: "Today", day: "day {n}", expired: "Expired rows still stored", disk: { hot: "SSD (hot)", s3: "S3 (cold)" } },
    stage: { hallDisk: "{p} · {disk}", full: "REJECTED · SSD full", disk: { hot: "SSD", s3: "S3" } },
    map: { w6: { title: "Change & expire", body: "Mutations, lightweight DELETE and UPDATE, TTL and tiered storage: changing or removing data in immutable parts." } },
  },
  es: {
    panels: { masked: "−{n} ocultas", noMutations: "Aún no hay mutaciones.", rewritten: "Filas reescritas (total)", rowsShort: "{n} filas", today: "Hoy", day: "día {n}", expired: "Filas vencidas aún guardadas", disk: { hot: "SSD (caliente)", s3: "S3 (frío)" } },
    stage: { hallDisk: "{p} · {disk}", full: "RECHAZADO · SSD lleno", disk: { hot: "SSD", s3: "S3" } },
    map: { w6: { title: "Cambiar y expirar", body: "Mutaciones, DELETE y UPDATE ligeros, TTL y almacenamiento por niveles: cambiar o borrar datos en parts inmutables." } },
  },
};

const en = {
  "6-1": {
    title: "Mutations",
    summary: "ALTER TABLE … UPDATE/DELETE rewrites whole parts.",
    brief: {
      title: "Parts never change",
      body: "Parts are <b>immutable</b>: nobody edits a box in place. So <code>ALTER TABLE … UPDATE</code> or <code>DELETE</code> is a <b>mutation</b>: in the background, every part that holds at least one matching row is <b>rewritten whole</b> as a new part, and the new name gets the mutation version as a suffix. The ALTER returns at once; <code>system.mutations</code> tells you when it is really done.",
    },
    one: { q: "Customer 5 moves to Cusco. Each part holds 3 customers. How many rows does the mutation rewrite?", why: "3: the whole part all_2_2_0 is rewritten, not just the one row. The new part is all_2_2_0_4 (4 is the mutation version)." },
    three: { q: "Now three separate ALTERs, one per customer 1, 2 and 3, who all live in the same part. How many rows get rewritten in total?", why: "9: each mutation rewrites that 3-row part again. One ALTER with WHERE id IN (1, 2, 3) would rewrite it once. Batch your changes." },
    purge: {
      title: "Purge the cancelled",
      body: "Delete every customer with <code>plan = ''cancelled''</code> with a mutation. Watch <code>parts_to_do</code> count down in system.mutations, then check the table.",
      delete: "ALTER TABLE … DELETE WHERE plan = 'cancelled'",
      select: "SELECT *",
      success: "Two parts held a cancelled customer, so two parts were rewritten whole. Mutations are for rare, large fixes, not for everyday changes.",
    },
    check: {
      cost: { q: "{n} separate ALTER … UPDATEs each hit the same part of {rows} rows. How many rows are rewritten?", why: "{n} × {rows} = {total}: each mutation rewrites the part again." },
      async: { q: "The ALTER returned instantly. Where do you check whether it has finished?", mutations: "system.mutations (parts_to_do, is_done)", done: "Nowhere: if it returned, it's done", parts: "system.merges only", why: "Mutations are asynchronous by default; system.mutations shows parts_to_do and is_done." },
      key: { q: "What happens with ALTER TABLE … UPDATE on an ORDER BY column?", error: "It's refused: key columns can't be updated", resort: "The part is re-sorted", fine: "It works like any other column", why: "Key columns can't be updated by a mutation; insert a corrected row instead." },
      name: { q: "Part all_2_2_0 is rewritten by mutation 4. Its new name is…", suffix: "all_2_2_0_4", same: "all_2_2_0", level: "all_2_2_1", why: "The mutation version is appended; the level doesn't change because it's not a merge." },
    },
  },
  "6-2": {
    title: "Lightweight DELETE",
    summary: "DELETE FROM hides rows at once; merges remove them later.",
    brief: {
      title: "A mask, not a rewrite",
      body: "<code>DELETE FROM</code> (GA since 23.3) doesn't rewrite parts. It sets a hidden <code>_row_exists</code> mask so the rows <b>disappear from queries at once</b>. The data is still on disk: it's removed for real when the part is <b>merged</b>. Here, masked rows turn pink.",
    },
    cost: { q: "DELETE FROM customers WHERE plan = cancelled hits 2 rows in 2 parts. How many rows are rewritten right now?", why: "0: only the mask changes. The rows are hidden, not removed." },
    space: { q: "Right after that DELETE, how much disk space was freed?", none: "None yet", some: "The size of the deleted rows", all: "The size of the parts touched", why: "None: the rows are still in the parts. The space comes back when those parts merge." },
    clean: {
      title: "Delete and reclaim",
      body: "Delete every customer in Madrid with a lightweight DELETE, then force a merge so the hidden rows actually leave the disk.",
      delete: "DELETE FROM … WHERE city = 'Madrid'",
      optimize: "OPTIMIZE TABLE … FINAL",
      select: "SELECT *",
      success: "The DELETE hid the rows at once; the merge wrote them out of the new part. In production you let background merges do it.",
    },
    check: {
      how: { q: "How does a lightweight DELETE remove rows?", mask: "It marks them in a hidden _row_exists mask", rewrite: "It rewrites every part at once", tombstone: "It inserts a row with sign −1", why: "A mask: queries skip masked rows; merges drop them." },
      disk: { q: "When do lightweight-deleted rows leave the disk?", merge: "When their part is merged", now: "Immediately", never: "Never", why: "On the next merge of that part." },
      count: { q: "A table has {total} rows. DELETE FROM hides {gone}. What does SELECT count() return?", why: "{total} − {gone} = {n}: masked rows are filtered out right away." },
      best: { q: "You must delete all of last year's data from a table partitioned by month. The cheapest way?", drop: "DROP PARTITION, one month at a time", lightweight: "DELETE FROM … WHERE year = 2025", mutation: "ALTER TABLE … DELETE", why: "Dropping a partition removes whole parts: no mask, no rewrite." },
    },
  },
  "6-3": {
    title: "Lightweight UPDATE",
    summary: "UPDATE … SET writes a small patch part (Beta).",
    brief: {
      title: "A patch on top",
      body: "Since 25.8, <code>UPDATE … SET</code> is a <b>lightweight UPDATE</b> (still <b>Beta</b> in 26.9). Instead of rewriting parts it writes a tiny <b>patch part</b> with only the key and the changed columns of the matching rows. Queries apply the patch <b>on read</b>; a later merge absorbs it into the real part. Meant for small changes (up to ~10% of a table).",
    },
    size: { q: "UPDATE customers SET plan = pro WHERE id = 4. How many boxes does the patch part carry?", why: "2: one row, with its key (id) and the changed column (plan). Nothing else is copied." },
    read: { q: "Before any merge, what plan does SELECT show for customer 4?", pro: "pro (the patch is applied on read)", free: "free (until the merge)", both: "Both rows", why: "The patch is applied while reading, so the new value shows right away." },
    absorb: {
      title: "Patch, then absorb",
      body: "Move every customer in Lima to the <code>pro</code> plan with a lightweight UPDATE, then force a merge so the patches are absorbed into the parts.",
      patch: "UPDATE … SET plan = 'pro' WHERE city = 'Lima'",
      optimize: "OPTIMIZE TABLE … FINAL",
      select: "SELECT *",
      success: "The patch was visible at once and the merge folded it into the data: no part was rewritten just for the update.",
    },
    check: {
      what: { q: "What does a lightweight UPDATE write?", patch: "A small patch part with the key and the changed columns", rewrite: "A rewritten copy of every touched part", mask: "A _row_exists mask", why: "A patch part, applied on read and absorbed by merges." },
      status: { q: "What is the status of lightweight UPDATE in 26.9?", beta: "Beta", ga: "GA", removed: "Removed", why: "Beta since 25.8." },
      boxes: { q: "A lightweight UPDATE changes {changed} column(s) in {rows} rows (key: one column). How many values does the patch hold?", why: "{rows} × ({changed} + 1 key) = {n}." },
      when: { q: "When does a patch part stop existing?", merge: "When a merge absorbs it into the data", never: "Never", select: "After the first SELECT", why: "Merges apply it to the parts and drop it." },
    },
  },
  "6-4": {
    title: "TTL: data with an expiry date",
    summary: "Expired rows go on merges, not at the instant they expire.",
    brief: {
      title: "A rule, applied late",
      body: "<code>TTL day + INTERVAL 30 DAY</code> says rows expire 30 days after their day. But nothing watches the clock: expired rows are removed by a <b>TTL merge</b>, which runs at most every <code>merge_with_ttl_timeout</code> (4 hours by default). Until then they are still stored <b>and still returned</b>. A part whose rows all expired is dropped whole.",
    },
    before: { q: "Today is day 40. Rows with day ≤ 10 have expired, but no TTL merge has run yet. How many rows does SELECT return? (There are 8.)", why: "8: TTL doesn't hide rows; it removes them when a merge runs." },
    merge: { q: "Now a TTL merge runs. Part 1 (days 1–3) is fully expired, part 2 (8, 25, 38) is partly expired, part 3 (36, 39) is fresh. How many parts remain?", why: "2: part 1 is dropped whole, part 2 is rewritten without day 8 (level +1), part 3 stays." },
    calendar: {
      title: "Keep up with the calendar",
      body: "Move the calendar to day 70 (new events arrive every 10 days) and leave no expired rows stored.",
      advance: "+10 days (new events)",
      ttl: "TTL merge",
      select: "SELECT *",
      success: "Rows expire on the calendar but leave on merges. If you need them gone exactly on time, also filter by date in your queries.",
    },
    check: {
      when: { q: "When are expired rows physically removed?", merge: "During a TTL merge", instant: "The instant they expire", select: "The next time they are read", why: "On merges (every merge_with_ttl_timeout at most)." },
      expires: { q: "TTL day + INTERVAL {days} DAY. A row of day {day} expires on day…", why: "{day} + {days} = {n}." },
      timeout: { q: "Default merge_with_ttl_timeout?", h4: "4 hours", s1: "1 second", d1: "1 day", why: "14400 s = 4 hours between TTL merges." },
      dropParts: { q: "With ttl_only_drop_parts = 1, TTL removes…", whole: "Only whole parts whose rows all expired", rows: "Single rows", never: "Nothing", why: "Only whole parts: cheap, and a good fit for time partitions." },
    },
  },
  "6-5": {
    title: "Hot and cold storage",
    summary: "Move old parts from SSD to S3 with a storage policy and TTL.",
    brief: {
      title: "Disks, volumes, policies",
      body: "A <b>storage policy</b> lists volumes, e.g. a fast <b>SSD</b> (hot) and <b>S3</b> (cold). <code>TTL … TO VOLUME</code> moves <b>whole parts</b> to the next volume as they age, and when the hot disk gets too full (<code>move_factor</code> = 0.1, under 10% free) parts move too. Queries read every volume transparently; cold data is just slower.",
    },
    move: { q: "January's part moves to S3. What happens to its rows?", copy: "The part is copied as-is to the other disk", rewrite: "The rows are rewritten and recompressed", delete: "The rows are deleted from the table", why: "Moves are part-level copies: same part, another disk." },
    query: { q: "SELECT * FROM metrics after the move: what comes back?", all: "Every month, from both disks", hot: "Only the months on the SSD", error: "An error until the move is undone", why: "The table spans both volumes; the query reads both." },
    months: {
      title: "Room for new months",
      body: "The SSD fits {cap} monthly parts. Bring in 3 new months without the SSD rejecting any: apply the TTL move to send old months to S3.",
      newMonth: "A new month arrives",
      ttlMove: "TTL … TO VOLUME 'cold'",
      select: "SELECT *",
      success: "Recent months stay on the fast SSD, old ones live on cheap S3, and the table still answers for all of them.",
    },
    check: {
      unit: { q: "What does tiered storage move between disks?", parts: "Whole parts", rows: "Single rows", columns: "Single columns", why: "Whole parts (or partitions)." },
      query: { q: "Querying a month that lives on S3…", transparent: "works as usual, only slower", restore: "needs a manual restore first", lost: "is impossible", why: "Volumes are transparent to queries." },
      factor: { q: "move_factor = 0.1 on a {size} GB hot disk: parts start moving when free space drops below how many GB?", why: "10% of {size} = {n} GB." },
      actions: { q: "Which of these is a TTL action?", volume: "TO VOLUME (move parts)", update: "UPDATE a column", index: "ADD INDEX", why: "TTL can DELETE, move TO DISK/VOLUME, GROUP BY (roll up) or RECOMPRESS." },
    },
  },
};

const es = {
  "6-1": {
    title: "Mutaciones",
    summary: "ALTER TABLE … UPDATE/DELETE reescribe parts enteras.",
    brief: {
      title: "Las parts no cambian",
      body: "Las parts son <b>inmutables</b>: nadie edita una caja en su sitio. Por eso <code>ALTER TABLE … UPDATE</code> o <code>DELETE</code> es una <b>mutación</b>: en segundo plano, cada part que tenga al menos una fila afectada se <b>reescribe entera</b> como una part nueva, y su nombre lleva la versión de la mutación como sufijo. El ALTER responde al instante; <code>system.mutations</code> te dice cuándo terminó de verdad.",
    },
    one: { q: "El cliente 5 se muda a Cusco. Cada part tiene 3 clientes. ¿Cuántas filas reescribe la mutación?", why: "3: se reescribe la part all_2_2_0 entera, no solo la fila. La part nueva es all_2_2_0_4 (4 es la versión de la mutación)." },
    three: { q: "Ahora tres ALTER separados, uno por los clientes 1, 2 y 3, que viven en la misma part. ¿Cuántas filas se reescriben en total?", why: "9: cada mutación vuelve a reescribir esa part de 3 filas. Un solo ALTER con WHERE id IN (1, 2, 3) la reescribiría una vez. Agrupa tus cambios." },
    purge: {
      title: "Fuera los cancelados",
      body: "Borra con una mutación a todos los clientes con <code>plan = ''cancelled''</code>. Mira cómo baja <code>parts_to_do</code> en system.mutations y luego revisa la tabla.",
      delete: "ALTER TABLE … DELETE WHERE plan = 'cancelled'",
      select: "SELECT *",
      success: "Dos parts tenían un cliente cancelado, así que se reescribieron dos parts enteras. Las mutaciones son para arreglos raros y grandes, no para el día a día.",
    },
    check: {
      cost: { q: "{n} ALTER … UPDATE separados caen en la misma part de {rows} filas. ¿Cuántas filas se reescriben?", why: "{n} × {rows} = {total}: cada mutación reescribe la part otra vez." },
      async: { q: "El ALTER respondió al instante. ¿Dónde compruebas si ya terminó?", mutations: "system.mutations (parts_to_do, is_done)", done: "En ningún lado: si respondió, ya está", parts: "Solo en system.merges", why: "Las mutaciones son asíncronas por defecto; system.mutations muestra parts_to_do e is_done." },
      key: { q: "¿Qué pasa con ALTER TABLE … UPDATE sobre una columna del ORDER BY?", error: "Se rechaza: las columnas clave no se pueden actualizar", resort: "La part se reordena", fine: "Funciona como cualquier columna", why: "Una mutación no puede actualizar columnas clave; inserta una fila corregida." },
      name: { q: "La mutación 4 reescribe la part all_2_2_0. Su nombre nuevo es…", suffix: "all_2_2_0_4", same: "all_2_2_0", level: "all_2_2_1", why: "Se añade la versión de la mutación; el nivel no cambia porque no es un merge." },
    },
  },
  "6-2": {
    title: "DELETE ligero",
    summary: "DELETE FROM oculta filas al instante; los merges las quitan después.",
    brief: {
      title: "Una máscara, no una reescritura",
      body: "<code>DELETE FROM</code> (GA desde 23.3) no reescribe parts. Pone una máscara oculta <code>_row_exists</code> y las filas <b>desaparecen de las consultas al instante</b>. Los datos siguen en disco: se quitan de verdad cuando la part se <b>fusiona</b>. Aquí las filas enmascaradas se ponen rosas.",
    },
    cost: { q: "DELETE FROM customers WHERE plan = cancelled afecta a 2 filas en 2 parts. ¿Cuántas filas se reescriben ahora mismo?", why: "0: solo cambia la máscara. Las filas quedan ocultas, no eliminadas." },
    space: { q: "Justo después de ese DELETE, ¿cuánto espacio en disco se liberó?", none: "Nada todavía", some: "Lo que ocupaban las filas borradas", all: "Lo que ocupaban las parts tocadas", why: "Nada: las filas siguen en las parts. El espacio vuelve cuando esas parts se fusionan." },
    clean: {
      title: "Borrar y recuperar espacio",
      body: "Borra a todos los clientes de Madrid con un DELETE ligero y luego fuerza un merge para que las filas ocultas salgan del disco de verdad.",
      delete: "DELETE FROM … WHERE city = 'Madrid'",
      optimize: "OPTIMIZE TABLE … FINAL",
      select: "SELECT *",
      success: "El DELETE ocultó las filas al instante; el merge ya no las escribió en la part nueva. En producción dejas que lo hagan los merges de fondo.",
    },
    check: {
      how: { q: "¿Cómo quita filas un DELETE ligero?", mask: "Las marca en una máscara oculta _row_exists", rewrite: "Reescribe todas las parts a la vez", tombstone: "Inserta una fila con sign −1", why: "Una máscara: las consultas se saltan esas filas y los merges las eliminan." },
      disk: { q: "¿Cuándo salen del disco las filas borradas con DELETE ligero?", merge: "Cuando su part se fusiona", now: "Al instante", never: "Nunca", why: "En el siguiente merge de esa part." },
      count: { q: "Una tabla tiene {total} filas. DELETE FROM oculta {gone}. ¿Qué devuelve SELECT count()?", why: "{total} − {gone} = {n}: las filas enmascaradas se filtran desde ya." },
      best: { q: "Tienes que borrar todo el año pasado de una tabla particionada por mes. ¿Lo más barato?", drop: "DROP PARTITION, mes a mes", lightweight: "DELETE FROM … WHERE year = 2025", mutation: "ALTER TABLE … DELETE", why: "Soltar una partición elimina parts enteras: ni máscara ni reescritura." },
    },
  },
  "6-3": {
    title: "UPDATE ligero",
    summary: "UPDATE … SET escribe una pequeña patch part (Beta).",
    brief: {
      title: "Un parche encima",
      body: "Desde 25.8, <code>UPDATE … SET</code> es un <b>UPDATE ligero</b> (aún <b>Beta</b> en 26.9). En vez de reescribir parts escribe una <b>patch part</b> diminuta con solo la clave y las columnas cambiadas de las filas afectadas. Las consultas aplican el parche <b>al leer</b>, y un merge posterior lo absorbe en la part real. Pensado para cambios pequeños (hasta ~10% de la tabla).",
    },
    size: { q: "UPDATE customers SET plan = pro WHERE id = 4. ¿Cuántas cajas lleva la patch part?", why: "2: una fila, con su clave (id) y la columna cambiada (plan). Nada más se copia." },
    read: { q: "Antes de cualquier merge, ¿qué plan muestra SELECT para el cliente 4?", pro: "pro (el parche se aplica al leer)", free: "free (hasta el merge)", both: "Las dos filas", why: "El parche se aplica mientras se lee, así que el valor nuevo se ve al instante." },
    absorb: {
      title: "Parchear y absorber",
      body: "Pasa a todos los clientes de Lima al plan <code>pro</code> con un UPDATE ligero y luego fuerza un merge para que los parches se absorban en las parts.",
      patch: "UPDATE … SET plan = 'pro' WHERE city = 'Lima'",
      optimize: "OPTIMIZE TABLE … FINAL",
      select: "SELECT *",
      success: "El parche se vio al instante y el merge lo fundió con los datos: ninguna part se reescribió solo por el cambio.",
    },
    check: {
      what: { q: "¿Qué escribe un UPDATE ligero?", patch: "Una patch part pequeña con la clave y las columnas cambiadas", rewrite: "Una copia reescrita de cada part tocada", mask: "Una máscara _row_exists", why: "Una patch part, que se aplica al leer y absorben los merges." },
      status: { q: "¿En qué estado está el UPDATE ligero en 26.9?", beta: "Beta", ga: "GA", removed: "Eliminado", why: "Beta desde 25.8." },
      boxes: { q: "Un UPDATE ligero cambia {changed} columna(s) en {rows} filas (clave de una columna). ¿Cuántos valores guarda el parche?", why: "{rows} × ({changed} + 1 de clave) = {n}." },
      when: { q: "¿Cuándo deja de existir una patch part?", merge: "Cuando un merge la absorbe en los datos", never: "Nunca", select: "Tras el primer SELECT", why: "Los merges la aplican a las parts y la eliminan." },
    },
  },
  "6-4": {
    title: "TTL: datos con caducidad",
    summary: "Las filas vencidas se van en los merges, no en el instante en que vencen.",
    brief: {
      title: "Una regla que llega tarde",
      body: "<code>TTL day + INTERVAL 30 DAY</code> dice que las filas vencen 30 días después de su día. Pero nadie vigila el reloj: las filas vencidas las quita un <b>merge de TTL</b>, que corre como mucho cada <code>merge_with_ttl_timeout</code> (4 horas por defecto). Hasta entonces siguen guardadas <b>y siguen saliendo en las consultas</b>. Una part con todas sus filas vencidas se elimina entera.",
    },
    before: { q: "Hoy es el día 40. Las filas con día ≤ 10 ya vencieron, pero aún no corrió ningún merge de TTL. ¿Cuántas filas devuelve SELECT? (Hay 8.)", why: "8: el TTL no oculta filas; las quita cuando corre un merge." },
    merge: { q: "Ahora corre un merge de TTL. La part 1 (días 1–3) venció entera, la part 2 (8, 25, 38) en parte y la part 3 (36, 39) está fresca. ¿Cuántas parts quedan?", why: "2: la part 1 se elimina entera, la part 2 se reescribe sin el día 8 (nivel +1) y la part 3 se queda." },
    calendar: {
      title: "Al día con el calendario",
      body: "Avanza el calendario hasta el día 70 (cada 10 días llegan eventos nuevos) y no dejes filas vencidas guardadas.",
      advance: "+10 días (eventos nuevos)",
      ttl: "Merge de TTL",
      select: "SELECT *",
      success: "Las filas vencen según el calendario pero se van con los merges. Si necesitas que desaparezcan justo a tiempo, filtra también por fecha en tus consultas.",
    },
    check: {
      when: { q: "¿Cuándo se borran físicamente las filas vencidas?", merge: "En un merge de TTL", instant: "En el instante en que vencen", select: "La próxima vez que se leen", why: "En los merges (como mucho cada merge_with_ttl_timeout)." },
      expires: { q: "TTL day + INTERVAL {days} DAY. Una fila del día {day} vence el día…", why: "{day} + {days} = {n}." },
      timeout: { q: "¿Valor por defecto de merge_with_ttl_timeout?", h4: "4 horas", s1: "1 segundo", d1: "1 día", why: "14400 s = 4 horas entre merges de TTL." },
      dropParts: { q: "Con ttl_only_drop_parts = 1, el TTL elimina…", whole: "Solo parts enteras con todas sus filas vencidas", rows: "Filas sueltas", never: "Nada", why: "Solo parts enteras: barato, y encaja con particiones por tiempo." },
    },
  },
  "6-5": {
    title: "Almacén caliente y frío",
    summary: "Lleva parts viejas del SSD a S3 con una storage policy y TTL.",
    brief: {
      title: "Discos, volúmenes, políticas",
      body: "Una <b>storage policy</b> enumera volúmenes, por ejemplo un <b>SSD</b> rápido (caliente) y <b>S3</b> (frío). <code>TTL … TO VOLUME</code> mueve <b>parts enteras</b> al siguiente volumen según envejecen, y cuando el disco caliente se llena (<code>move_factor</code> = 0.1, menos del 10% libre) también se mueven. Las consultas leen todos los volúmenes sin enterarse; lo frío solo es más lento.",
    },
    move: { q: "La part de enero se mueve a S3. ¿Qué pasa con sus filas?", copy: "La part se copia tal cual al otro disco", rewrite: "Las filas se reescriben y recomprimen", delete: "Las filas se borran de la tabla", why: "Los movimientos copian parts: la misma part, en otro disco." },
    query: { q: "SELECT * FROM metrics después del movimiento: ¿qué devuelve?", all: "Todos los meses, de los dos discos", hot: "Solo los meses del SSD", error: "Un error hasta deshacer el movimiento", why: "La tabla abarca los dos volúmenes; la consulta lee ambos." },
    months: {
      title: "Sitio para meses nuevos",
      body: "En el SSD caben {cap} parts mensuales. Recibe 3 meses nuevos sin que el SSD rechace ninguno: aplica el movimiento por TTL para mandar los meses viejos a S3.",
      newMonth: "Llega un mes nuevo",
      ttlMove: "TTL … TO VOLUME 'cold'",
      select: "SELECT *",
      success: "Los meses recientes siguen en el SSD rápido, los viejos viven en S3, que es barato, y la tabla responde por todos.",
    },
    check: {
      unit: { q: "¿Qué mueve el almacenamiento por niveles entre discos?", parts: "Parts enteras", rows: "Filas sueltas", columns: "Columnas sueltas", why: "Parts enteras (o particiones)." },
      query: { q: "Consultar un mes que vive en S3…", transparent: "funciona igual, solo más lento", restore: "requiere restaurarlo a mano antes", lost: "es imposible", why: "Los volúmenes son transparentes para las consultas." },
      factor: { q: "move_factor = 0.1 en un disco caliente de {size} GB: ¿por debajo de cuántos GB libres empiezan a moverse parts?", why: "El 10% de {size} = {n} GB." },
      actions: { q: "¿Cuál de estas es una acción de TTL?", volume: "TO VOLUME (mover parts)", update: "UPDATE de una columna", index: "ADD INDEX", why: "El TTL puede hacer DELETE, mover TO DISK/VOLUME, GROUP BY (resumir) o RECOMPRESS." },
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
