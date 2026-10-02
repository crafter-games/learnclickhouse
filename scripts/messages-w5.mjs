// Merges World 5 copy into messages/{en,es}.json (rerunnable).
import { readFileSync, writeFileSync } from "node:fs";

const ui = {
  en: { panels: { result: "SELECT result", rowCount: "{n, plural, one {# row} other {# rows}}" }, map: { w5: { title: "Merge-time engines", body: "ReplacingMergeTree, SummingMergeTree, AggregatingMergeTree and CollapsingMergeTree: what happens to rows with the same key when parts merge, and how to read the right answer before they do." } } },
  es: { panels: { result: "Resultado del SELECT", rowCount: "{n, plural, one {# fila} other {# filas}}" }, map: { w5: { title: "Motores de merge", body: "ReplacingMergeTree, SummingMergeTree, AggregatingMergeTree y CollapsingMergeTree: qué pasa con las filas de la misma clave cuando se fusionan las parts, y cómo leer bien antes de que pase." } } },
};

const en = {
  "5-1": {
    title: "The latest version",
    summary: "ReplacingMergeTree keeps the newest row per key, eventually.",
    brief: {
      title: "Updates as inserts",
      body: "In this depot each box is <b>one row</b>, with its value printed on it. A <b>ReplacingMergeTree</b> keeps, for every ORDER BY key, the row with the highest <code>ver</code>. To “update” a customer you <b>insert a new version</b>. But the old one only disappears when the two parts <b>merge</b>, at a time nobody chooses.",
    },
    update: { q: "Customer 2 moves to Bogotá: we insert version 2. How many rows does <code>SELECT *</code> return now?", why: "4: both versions of customer 2 are still there, in different parts. Replacing only happens during merges." },
    merge: { q: "The press merges the two parts. How many rows remain?", why: "3: during the merge, the two rows with id = 2 collapse into the one with the highest ver (Bogotá)." },
    moves: {
      title: "Two moves and the truth",
      body: "Customers 1 and 3 move too. Insert their new versions, then read the table so it shows only the latest version of each, without waiting for a merge.",
      move1: "Customer 1 → Santiago",
      move3: "Customer 3 → Valencia",
      select: "SELECT *",
      final: "SELECT * FINAL",
      success: "FINAL merged at read time: one row per customer, the newest. The parts themselves are still unmerged.",
    },
    check: {
      when: { q: "When does ReplacingMergeTree remove older versions?", merge: "When the parts holding them merge", insert: "At insert time", select: "On every SELECT", why: "During merges, at an unknown time. Until then both versions are stored and returned." },
      key: { q: "Which rows count as “the same” for ReplacingMergeTree?", orderBy: "Rows with the same ORDER BY key", primary: "Rows with a unique PRIMARY KEY", all: "Identical rows only", why: "The ORDER BY key, per partition. There is no uniqueness constraint." },
      count: { q: "You insert {n} versions of the same id in {n} INSERTs and no merge has happened. How many rows does SELECT * show for it?", why: "{n}: one per part until they merge." },
      noVer: { q: "ReplacingMergeTree without a ver column keeps…", last: "the last inserted row", first: "the first row", random: "a random row", why: "The last inserted one." },
    },
  },
  "5-2": {
    title: "Case: the ghost version",
    summary: "FINAL, argMax and deleted rows.",
    brief: {
      title: "Reading before the merge",
      body: "A customer complains: the dashboard shows them in two cities. Two tools fix that before any merge. <code>FINAL</code> merges at read time (correct, but it costs more). <code>argMax(city, ver)</code> with GROUP BY picks the newest value with a normal query. And to delete, you insert a version with <code>deleted = 1</code>: FINAL hides it.",
    },
    ghost: { q: "Two versions of customer 2, no merge yet. How many rows does <code>WHERE id = 2</code> return without FINAL?", why: "2: the old Madrid row and the new Bogotá row. That's the ghost." },
    delete: {
      q: "We insert customer 3 again with <code>deleted = 1</code>. Does customer 3 appear in <code>SELECT * FINAL</code>?",
      hidden: "No: FINAL hides rows marked deleted",
      shown: "Yes, deleted is just another column",
      error: "The query fails",
      why: "FINAL keeps the newest version and, being marked deleted, hides it. A plain SELECT still shows it until cleanup merges remove it.",
    },
    two: {
      title: "Two ways to read the truth",
      body: "Show the right answer twice: once with FINAL, once with argMax and GROUP BY. Compare them with a plain SELECT.",
      select: "SELECT *",
      final: "SELECT * FINAL",
      argmax: "argMax(city, ver)",
      success: "Same answer, two routes. FINAL is simpler; argMax is an ordinary aggregation that also works across shards.",
    },
    check: {
      final: { q: "What does FINAL do?", readTime: "Applies the engine's merge logic at read time", forces: "Forces a real merge on disk", cache: "Reads from a cache", why: "It merges in the query; the parts on disk stay as they are." },
      argMax: { q: "Which function returns the value of the row with the highest version?", argMax: "argMax(value, ver)", max: "max(value)", any: "any(value)", why: "argMax(value, ver), grouped by the key." },
      deleted: { q: "With ReplacingMergeTree(ver, is_deleted), a row with is_deleted = 1 is hidden…", final: "by FINAL (and removed by cleanup merges)", always: "always, at once", never: "never", why: "FINAL hides it; a plain SELECT still sees it until it's cleaned up." },
      partition: { q: "Does Replacing deduplicate rows in different partitions?", within: "No, only within a partition", across: "Yes, across all partitions", never: "Never", why: "Merges never cross partitions, so neither does deduplication." },
    },
  },
  "5-3": {
    title: "Counters that add up",
    summary: "SummingMergeTree adds numbers per key when parts merge.",
    brief: { title: "Pre-aggregated counters", body: "A <b>SummingMergeTree</b> adds up the numeric columns of rows with the same key when parts merge, so a counter table stays small. Until then there can be several partial rows per key: always read with <code>sum()</code> and GROUP BY." },
    rows: { q: "Page 1 got views in two inserts. How many rows does <code>WHERE page = 1</code> return before any merge?", why: "2 partial rows (5 and 2). They're only added up when the parts merge." },
    sum: { q: "What does <code>sum(views)</code> give for page 1?", why: "5 + 2 = 7, merged or not. That's why you query with sum()." },
    zero: {
      q: "We insert page 3 with views = −1 (its total becomes 0) and the parts merge. What happens to page 3?",
      gone: "Its row disappears",
      zero: "A row with 0 stays",
      negative: "A row with −1 stays",
      why: "When every summed column adds up to 0, SummingMergeTree drops the row.",
    },
    report: {
      title: "A correct report, any time",
      body: "More views arrive. Show the views per page correctly while partial rows are still on the shelves.",
      more: "More views",
      star: "SELECT *",
      sum: "sum(views) GROUP BY page",
      success: "sum() with GROUP BY gives the right totals whether or not the press has run.",
    },
    check: {
      when: { q: "When does SummingMergeTree add rows up?", merge: "During merges", insert: "At insert time", never: "Never, you must sum", why: "During merges; so you still sum in queries." },
      query: { q: "How should you read a SummingMergeTree table?", sum: "sum() … GROUP BY key", star: "SELECT * is enough", final: "Only with FINAL", why: "Always aggregate: there may be several partial rows per key." },
      total: { q: "Two unmerged rows for a key: {x} and {y}. What does sum() return?", why: "{x} + {y} = {s}." },
      zero: { q: "After a merge, a key's summed values are all 0. Its row…", gone: "is removed", zero: "stays with 0", error: "causes an error", why: "Removed." },
    },
  },
  "5-4": {
    title: "Aggregate states",
    summary: "AggregatingMergeTree stores partial aggregations you can combine.",
    brief: { title: "Storing half an aggregation", body: "Some results can't just be added: unique users are the classic case. An <b>AggregatingMergeTree</b> stores an aggregate <b>state</b> (here, the set of users seen). You write it with <code>uniqState</code> and read it with <code>uniqMerge</code>, which combines the states without counting anyone twice." },
    day1: { q: "Day 1: one part saw users [1, 2, 3] and another saw [2, 3, 4]. What does <code>uniqMerge(users)</code> return for day 1?", why: "4: the states combine into [1, 2, 3, 4]. Adding the counts of each part would say 6." },
    press: { title: "States merging", body: "Watch the press: the two states of day 1 become one, with the union of the users." },
    count: {
      title: "Count the visitors",
      body: "Day 2 gets more visits. Show the unique visitors per day correctly, before the parts merge again.",
      visit: "New visits on day 2",
      wrong: "sum of uniq per part",
      merge: "uniqMerge(users)",
      success: "uniqMerge combines states, so user 5, who visited twice, counts once.",
    },
    check: {
      combinators: { q: "To use AggregatingMergeTree with uniq you write with… and read with…", stateMerge: "uniqState … uniqMerge", mergeState: "uniqMerge … uniqState", plain: "uniq … uniq", why: "-State to store the state, -Merge to finish it." },
      uniq: { q: "Part A saw {x} users and part B saw {y}, with {shared} in both. Unique users?", why: "{x} + {y} − {shared} = {n}." },
      direct: { q: "What do you get selecting an AggregateFunction column directly?", binary: "A binary state, not the number", number: "The final number", error: "Always an error", why: "A state; finish it with -Merge or finalizeAggregation." },
      simple: { q: "For sum, min or max, which lighter type stores plain values?", simple: "SimpleAggregateFunction", aggregate: "AggregateFunction", nullable: "Nullable", why: "SimpleAggregateFunction: the state is the value itself." },
    },
  },
  "5-5": {
    title: "Ins and outs",
    summary: "CollapsingMergeTree cancels rows with a sign.",
    brief: { title: "Cancel and replace", body: "<b>CollapsingMergeTree</b> uses a <code>sign</code> column: +1 is a state row, −1 cancels it. To change a value you insert the old row with −1 and the new one with +1. Merges cancel the pairs; queries use <code>sum(sign * x)</code>. VersionedCollapsingMergeTree allows any insert order, and <b>CoalescingMergeTree</b> (25.6) keeps the latest non-NULL value per column." },
    sum: { q: "User 1 has rows (+1, 5), (−1, 5), (+1, 6). What does <code>sum(sign * views)</code> give?", why: "5 − 5 + 6 = 6: the cancel row removes the old state." },
    press: { title: "Pairs cancel", body: "Watch the press: the +1 and −1 rows of user 1 cancel each other, only (+1, 6) remains." },
    update: {
      title: "Update user 2",
      body: "User 2 now has 9 views. Change it the collapsing way, then read the views per user.",
      cancel: "Cancel old row (−1, 4)",
      add: "New row (+1, 9)",
      read: "sum(sign * views)",
      success: "Cancel the old state, insert the new one, and sum with the sign. User 2 shows 9.",
    },
    check: {
      sign: { q: "What does a row with sign = −1 do?", cancel: "Cancels a matching +1 row", delete: "Deletes the whole key", negative: "Stores a negative value", why: "It cancels the state row with the same key." },
      sum: { q: "Rows (+1, {x}), (−1, {x}), (+1, {y}). sum(sign * x)?", why: "{x} − {x} + {y} = {y}." },
      versioned: { q: "What does VersionedCollapsingMergeTree add?", anyOrder: "Rows can arrive in any order (version column)", faster: "Faster merges", noSign: "No sign column needed", why: "A version column, so cancel rows needn't follow their states." },
      coalescing: { q: "What does CoalescingMergeTree keep per key?", perColumn: "The latest non-NULL value of each column", wholeRow: "The whole latest row", sum: "Sums", why: "Per column (25.6+), for column-level upserts." },
    },
  },
};

const es = {
  "5-1": {
    title: "La última versión",
    summary: "ReplacingMergeTree se queda con la fila más nueva de cada clave, con el tiempo.",
    brief: {
      title: "Actualizar es insertar",
      body: "En este almacén cada caja es <b>una fila</b>, con su valor escrito encima. Un <b>ReplacingMergeTree</b> conserva, para cada clave del ORDER BY, la fila con el <code>ver</code> más alto. Para “actualizar” un cliente <b>insertas una versión nueva</b>. Pero la vieja solo desaparece cuando las dos parts se <b>fusionan</b>, en un momento que nadie elige.",
    },
    update: { q: "El cliente 2 se muda a Bogotá: insertamos la versión 2. ¿Cuántas filas devuelve <code>SELECT *</code> ahora?", why: "4: las dos versiones del cliente 2 siguen ahí, en parts distintas. El reemplazo solo ocurre en los merges." },
    merge: { q: "La prensa fusiona las dos parts. ¿Cuántas filas quedan?", why: "3: en el merge, las dos filas con id = 2 se quedan en la de ver más alto (Bogotá)." },
    moves: {
      title: "Dos mudanzas y la verdad",
      body: "Los clientes 1 y 3 también se mudan. Inserta sus versiones nuevas y luego lee la tabla de forma que salga solo la última versión de cada uno, sin esperar al merge.",
      move1: "Cliente 1 → Santiago",
      move3: "Cliente 3 → Valencia",
      select: "SELECT *",
      final: "SELECT * FINAL",
      success: "FINAL fusionó al leer: una fila por cliente, la más nueva. Las parts siguen sin fusionar.",
    },
    check: {
      when: { q: "¿Cuándo quita ReplacingMergeTree las versiones viejas?", merge: "Cuando se fusionan las parts que las tienen", insert: "Al insertar", select: "En cada SELECT", why: "En los merges, en un momento desconocido. Hasta entonces se guardan y se devuelven las dos." },
      key: { q: "¿Qué filas cuentan como “la misma” para ReplacingMergeTree?", orderBy: "Las que tienen la misma clave del ORDER BY", primary: "Las de una PRIMARY KEY única", all: "Solo filas idénticas", why: "La clave del ORDER BY, dentro de cada partición. No hay restricción de unicidad." },
      count: { q: "Insertas {n} versiones del mismo id en {n} INSERT y no ha habido merges. ¿Cuántas filas muestra SELECT * para él?", why: "{n}: una por part hasta que se fusionen." },
      noVer: { q: "ReplacingMergeTree sin columna ver se queda con…", last: "la última fila insertada", first: "la primera fila", random: "una fila al azar", why: "La última insertada." },
    },
  },
  "5-2": {
    title: "Caso: la versión fantasma",
    summary: "FINAL, argMax y filas borradas.",
    brief: {
      title: "Leer antes del merge",
      body: "Un cliente se queja: el dashboard lo muestra en dos ciudades. Dos herramientas lo arreglan sin esperar al merge. <code>FINAL</code> fusiona al leer (correcto, pero cuesta más). <code>argMax(city, ver)</code> con GROUP BY elige el valor más nuevo con una consulta normal. Y para borrar, insertas una versión con <code>deleted = 1</code>: FINAL la oculta.",
    },
    ghost: { q: "Dos versiones del cliente 2, todavía sin merge. ¿Cuántas filas devuelve <code>WHERE id = 2</code> sin FINAL?", why: "2: la vieja de Madrid y la nueva de Bogotá. Ese es el fantasma." },
    delete: {
      q: "Insertamos otra vez el cliente 3 con <code>deleted = 1</code>. ¿Aparece el cliente 3 en <code>SELECT * FINAL</code>?",
      hidden: "No: FINAL oculta las filas marcadas como borradas",
      shown: "Sí, deleted es una columna más",
      error: "La consulta falla",
      why: "FINAL se queda con la versión más nueva y, como está marcada como borrada, la oculta. Un SELECT normal la sigue viendo hasta que los merges de limpieza la quiten.",
    },
    two: {
      title: "Dos formas de leer la verdad",
      body: "Muestra la respuesta correcta dos veces: una con FINAL y otra con argMax y GROUP BY. Compáralas con un SELECT normal.",
      select: "SELECT *",
      final: "SELECT * FINAL",
      argmax: "argMax(city, ver)",
      success: "Misma respuesta, dos caminos. FINAL es más simple; argMax es una agregación normal que también funciona entre shards.",
    },
    check: {
      final: { q: "¿Qué hace FINAL?", readTime: "Aplica la lógica de merge del motor al leer", forces: "Fuerza un merge real en disco", cache: "Lee de una caché", why: "Fusiona dentro de la consulta; las parts en disco se quedan igual." },
      argMax: { q: "¿Qué función devuelve el valor de la fila con la versión más alta?", argMax: "argMax(valor, ver)", max: "max(valor)", any: "any(valor)", why: "argMax(valor, ver), agrupando por la clave." },
      deleted: { q: "Con ReplacingMergeTree(ver, is_deleted), una fila con is_deleted = 1 se oculta…", final: "con FINAL (y la quitan los merges de limpieza)", always: "siempre, al momento", never: "nunca", why: "FINAL la oculta; un SELECT normal la sigue viendo hasta la limpieza." },
      partition: { q: "¿Deduplica Replacing filas de particiones distintas?", within: "No, solo dentro de una partición", across: "Sí, entre todas", never: "Nunca", why: "Los merges nunca cruzan particiones, y la deduplicación tampoco." },
    },
  },
  "5-3": {
    title: "Contadores que se suman",
    summary: "SummingMergeTree suma los números de cada clave al fusionar.",
    brief: { title: "Contadores preagregados", body: "Un <b>SummingMergeTree</b> suma las columnas numéricas de las filas con la misma clave cuando se fusionan las parts, así una tabla de contadores se queda pequeña. Hasta entonces puede haber varias filas parciales por clave: lee siempre con <code>sum()</code> y GROUP BY." },
    rows: { q: "La página 1 recibió visitas en dos inserts. ¿Cuántas filas devuelve <code>WHERE page = 1</code> antes de cualquier merge?", why: "2 filas parciales (5 y 2). Solo se suman cuando se fusionan las parts." },
    sum: { q: "¿Qué da <code>sum(views)</code> para la página 1?", why: "5 + 2 = 7, con merge o sin él. Por eso se consulta con sum()." },
    zero: {
      q: "Insertamos la página 3 con views = −1 (su total queda en 0) y se fusionan las parts. ¿Qué pasa con la página 3?",
      gone: "Su fila desaparece",
      zero: "Queda una fila con 0",
      negative: "Queda una fila con −1",
      why: "Cuando todas las columnas sumadas dan 0, SummingMergeTree quita la fila.",
    },
    report: {
      title: "Un informe correcto, siempre",
      body: "Llegan más visitas. Muestra las visitas por página correctamente mientras aún hay filas parciales en las estanterías.",
      more: "Más visitas",
      star: "SELECT *",
      sum: "sum(views) GROUP BY page",
      success: "sum() con GROUP BY da los totales correctos haya pasado la prensa o no.",
    },
    check: {
      when: { q: "¿Cuándo suma SummingMergeTree las filas?", merge: "En los merges", insert: "Al insertar", never: "Nunca, tienes que sumar tú", why: "En los merges; por eso igual sumas en las consultas." },
      query: { q: "¿Cómo hay que leer una tabla SummingMergeTree?", sum: "sum() … GROUP BY clave", star: "Con SELECT * basta", final: "Solo con FINAL", why: "Agregando siempre: puede haber varias filas parciales por clave." },
      total: { q: "Dos filas sin fusionar para una clave: {x} y {y}. ¿Qué devuelve sum()?", why: "{x} + {y} = {s}." },
      zero: { q: "Tras un merge, los valores sumados de una clave dan todos 0. Su fila…", gone: "se quita", zero: "se queda con 0", error: "provoca un error", why: "Se quita." },
    },
  },
  "5-4": {
    title: "Estados agregados",
    summary: "AggregatingMergeTree guarda agregaciones parciales que se pueden combinar.",
    brief: { title: "Guardar media agregación", body: "Hay resultados que no se pueden sumar sin más: los usuarios únicos son el ejemplo clásico. Un <b>AggregatingMergeTree</b> guarda un <b>estado</b> de agregación (aquí, el conjunto de usuarios vistos). Lo escribes con <code>uniqState</code> y lo lees con <code>uniqMerge</code>, que combina los estados sin contar a nadie dos veces." },
    day1: { q: "Día 1: una part vio a los usuarios [1, 2, 3] y otra a [2, 3, 4]. ¿Qué devuelve <code>uniqMerge(users)</code> para el día 1?", why: "4: los estados se combinan en [1, 2, 3, 4]. Sumar el recuento de cada part daría 6." },
    press: { title: "Estados que se fusionan", body: "Mira la prensa: los dos estados del día 1 se convierten en uno, con la unión de los usuarios." },
    count: {
      title: "Cuenta los visitantes",
      body: "El día 2 recibe más visitas. Muestra los visitantes únicos por día correctamente, antes de que las parts se vuelvan a fusionar.",
      visit: "Visitas nuevas el día 2",
      wrong: "suma de uniq por part",
      merge: "uniqMerge(users)",
      success: "uniqMerge combina estados, así que el usuario 5, que vino dos veces, cuenta una.",
    },
    check: {
      combinators: { q: "Para usar AggregatingMergeTree con uniq escribes con… y lees con…", stateMerge: "uniqState … uniqMerge", mergeState: "uniqMerge … uniqState", plain: "uniq … uniq", why: "-State para guardar el estado, -Merge para terminarlo." },
      uniq: { q: "La part A vio {x} usuarios y la B {y}, con {shared} en las dos. ¿Usuarios únicos?", why: "{x} + {y} − {shared} = {n}." },
      direct: { q: "¿Qué obtienes si seleccionas directamente una columna AggregateFunction?", binary: "Un estado binario, no el número", number: "El número final", error: "Siempre un error", why: "Un estado; termínalo con -Merge o finalizeAggregation." },
      simple: { q: "Para sum, min o max, ¿qué tipo más ligero guarda valores normales?", simple: "SimpleAggregateFunction", aggregate: "AggregateFunction", nullable: "Nullable", why: "SimpleAggregateFunction: el estado es el propio valor." },
    },
  },
  "5-5": {
    title: "Altas y bajas",
    summary: "CollapsingMergeTree cancela filas con un signo.",
    brief: { title: "Cancelar y reemplazar", body: "<b>CollapsingMergeTree</b> usa una columna <code>sign</code>: +1 es una fila de estado y −1 la cancela. Para cambiar un valor insertas la fila vieja con −1 y la nueva con +1. Los merges cancelan las parejas; las consultas usan <code>sum(sign * x)</code>. VersionedCollapsingMergeTree admite cualquier orden de inserción, y <b>CoalescingMergeTree</b> (25.6) se queda con el último valor no NULL de cada columna." },
    sum: { q: "El usuario 1 tiene las filas (+1, 5), (−1, 5), (+1, 6). ¿Qué da <code>sum(sign * views)</code>?", why: "5 − 5 + 6 = 6: la fila de cancelación quita el estado viejo." },
    press: { title: "Las parejas se cancelan", body: "Mira la prensa: las filas +1 y −1 del usuario 1 se anulan entre sí y solo queda (+1, 6)." },
    update: {
      title: "Actualiza al usuario 2",
      body: "El usuario 2 ahora tiene 9 visitas. Cámbialo a la manera de Collapsing y luego lee las visitas por usuario.",
      cancel: "Cancelar la fila vieja (−1, 4)",
      add: "Fila nueva (+1, 9)",
      read: "sum(sign * views)",
      success: "Cancelas el estado viejo, insertas el nuevo y sumas con el signo. El usuario 2 muestra 9.",
    },
    check: {
      sign: { q: "¿Qué hace una fila con sign = −1?", cancel: "Cancela una fila +1 equivalente", delete: "Borra la clave entera", negative: "Guarda un valor negativo", why: "Cancela la fila de estado con la misma clave." },
      sum: { q: "Filas (+1, {x}), (−1, {x}), (+1, {y}). ¿sum(sign * x)?", why: "{x} − {x} + {y} = {y}." },
      versioned: { q: "¿Qué añade VersionedCollapsingMergeTree?", anyOrder: "Las filas pueden llegar en cualquier orden (columna de versión)", faster: "Merges más rápidos", noSign: "No necesita columna de signo", why: "Una columna de versión, así la cancelación no tiene que llegar después de su estado." },
      coalescing: { q: "¿Qué conserva CoalescingMergeTree por clave?", perColumn: "El último valor no NULL de cada columna", wholeRow: "La última fila entera", sum: "Sumas", why: "Por columna (25.6+), para upserts columna a columna." },
    },
  },
};

for (const [locale, levels] of [["en", en], ["es", es]]) {
  const file = new URL(`../messages/${locale}.json`, import.meta.url);
  const json = JSON.parse(readFileSync(file, "utf8"));
  for (const [ns, add] of Object.entries(ui[locale])) json[ns] = { ...(json[ns] ?? {}), ...add };
  json.levels = { ...(json.levels ?? {}), ...levels };
  writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
  console.log(`updated ${locale}.json`);
}
