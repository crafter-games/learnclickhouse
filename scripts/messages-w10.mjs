// Merges World 10 copy into messages/{en,es}.json (rerunnable).
// SQL quotes are doubled ('') inside rich text because an ICU apostrophe before < or { escapes it.
import { readFileSync, writeFileSync } from "node:fs";

const ui = {
  en: { map: { w10: { title: "Types & codecs", body: "The smallest type that fits, LowCardinality, the cost of Nullable, codecs chained with ZSTD and the JSON type." } } },
  es: { map: { w10: { title: "Tipos y codecs", body: "El tipo más pequeño que sirva, LowCardinality, lo que cuesta Nullable, codecs encadenados con ZSTD y el tipo JSON." } } },
};

const en = {
  "10-1": {
    title: "The smallest type that fits",
    summary: "Int64 for an age, String for a date: bytes you pay on every row.",
    brief: {
      title: "Bytes per row add up",
      body: "Every row pays for its column types, before compression and after. <code>UInt8</code> holds 0–255 in 1 byte, <code>Int64</code> takes 8. A date as <code>String</code> is ~20 bytes; as <code>DateTime</code>, 4. In one documented example, choosing the right types took a table from <b>131.58 GiB to 35.34 GiB</b> uncompressed. Boxes here shrink with the bytes they hold.",
    },
    age: { q: "age Int64 → UInt8. How many uncompressed bytes per row does age take now?", why: "1: UInt8 is one byte, plenty for 0–120." },
    created: { q: "created String ('2026-10-02 12:00:00', ~20 bytes) → DateTime. Bytes per row?", why: "4: DateTime is a 32-bit Unix timestamp. It also compresses and compares far better than text." },
    shrink: {
      title: "Put the table on a diet",
      body: "Choose types for user_id and created and apply them so the table takes at most 45% of its starting size.",
      user_id: "user_id",
      created: "created",
      types: { Int64: "Int64", UInt32: "UInt32", String: "String", DateTime: "DateTime" },
      apply: "ALTER TABLE … MODIFY COLUMN",
      success: "UInt32 ids and a DateTime: a fraction of the bytes for the same information. Smaller columns also mean less to read on every query.",
    },
    check: {
      age: { q: "Best type for an age (0–120)?", uint8: "UInt8", int64: "Int64", string: "String", why: "UInt8: 1 byte." },
      bytes: { q: "Changing a column from Int64 to UInt8 on {millions} million rows saves how many million bytes (uncompressed)?", why: "7 bytes per row × {millions} million = {n} million." },
      date: { q: "Timestamps are best stored as…", datetime: "DateTime / DateTime64", string: "String", float: "Float64", why: "4 (or 8) bytes, compress well, sort and compare natively." },
      enum: { q: "A status with 4 fixed values is best as…", enum: "Enum8 (or LowCardinality(String))", string: "String", uint64: "UInt64", why: "1 byte per row with readable names." },
    },
  },
  "10-2": {
    title: "LowCardinality",
    summary: "Dictionary-encode strings with few distinct values, not all strings.",
    brief: {
      title: "A dictionary per part",
      body: "<code>LowCardinality(String)</code> stores each distinct value once in a dictionary and a small number per row. With a few hundred cities it's a big win. The rule of thumb: good <b>below 10,000</b> distinct values, and it can be <b>worse above 100,000</b>, when the dictionaries get huge.",
    },
    city: { q: "city has ~200 distinct values. LowCardinality(String) makes it…", smaller: "Much smaller", same: "About the same", bigger: "Bigger", why: "Much smaller: one tiny index per row instead of the string." },
    url: { q: "url has ~1,000,000 distinct values. LowCardinality(String) makes it…", smaller: "Much smaller", same: "About the same", bigger: "Bigger", why: "Bigger: the dictionary is nearly as large as the data, plus the indexes." },
    pick: {
      title: "Only where it pays",
      body: "Choose the type of each column so the table is as small as it can be, then apply.",
      city: "city",
      url: "url",
      types: { String: "String", LowCardinality: "LowCardinality" },
      apply: "ALTER TABLE … MODIFY COLUMN",
      success: "LowCardinality for city, plain String for url. Check the number of distinct values (uniq()) before you decide.",
    },
    check: {
      how: { q: "LowCardinality(String) works by…", dictionary: "Dictionary encoding: each value once, a small index per row", compress: "A stronger codec", index: "Building a skip index", why: "Dictionary encoding." },
      fit: { q: "A String column has {distinct} distinct values. Is LowCardinality a good fit?", yes: "Yes", no: "No", whyYes: "Yes: well under 10,000 distinct values.", whyNo: "No: with that many distinct values the dictionary gets too big; above ~100,000 it can be worse." },
      every: { q: "Should every String column be LowCardinality?", no: "No, only low-cardinality ones", yes: "Yes", why: "High-cardinality strings get worse." },
      vsEnum: { q: "LowCardinality over Enum, when…", newValues: "New values can appear without an ALTER", faster: "You need faster inserts", smaller: "Values are numbers", why: "Enum needs the list up front." },
    },
  },
  "10-3": {
    title: "Nullable isn't free",
    summary: "An extra null-map file per column, and no keys by default.",
    brief: {
      title: "A second file per column",
      body: "<code>Nullable(T)</code> keeps an extra <b>null map</b> next to the column: one byte per row saying whether the value is NULL. Reads and filters get slower, and by default a Nullable column can't be in the sorting key (<code>allow_nullable_key = 0</code>). Usually a default value (<code>''''</code>, <code>0</code>) says “unknown” just as well.",
    },
    extra: { q: "Nullable(UInt32) vs UInt32: how many extra uncompressed bytes per row for the null map?", why: "1: one UInt8 per row in a separate file, read along with the column." },
    key: { q: "CREATE TABLE … (score Nullable(UInt32)) ORDER BY score. What happens?", error: "An error, unless allow_nullable_key = 1", works: "It just works", slower: "It works, a bit slower", why: "Nullable keys are refused by default." },
    defaults: {
      title: "Defaults instead of NULL",
      body: "Drop Nullable from phone and score (use DEFAULT '''' and DEFAULT 0) and apply.",
      setting: "Nullable",
      values: { yes: "keep", no: "remove" },
      apply: "ALTER TABLE … MODIFY COLUMN",
      success: "No null maps: smaller columns and faster scans. Keep Nullable only where NULL truly means something different from a default.",
    },
    check: {
      cost: { q: "What does Nullable add?", nullMap: "A null-map file (1 byte per row) and slower processing", free: "Nothing", index: "An index", why: "The null map is read with the column." },
      key: { q: "A Nullable column in ORDER BY, by default…", refused: "Is refused (allow_nullable_key = 0)", fine: "Is fine", faster: "Is faster", why: "Not allowed by default." },
      bytes: { q: "A Nullable column over {millions} million rows has a null map of how many million bytes?", why: "{millions}: one byte per row." },
      instead: { q: "Instead of Nullable for “unknown”, usually…", default: "A default value like '''' or 0", nullable: "Nullable(Nullable(T))", string: "Store everything as String", why: "Defaults are cheaper." },
    },
  },
  "10-4": {
    title: "Codecs",
    summary: "Delta and DoubleDelta for sequences, chained with ZSTD; measure floats.",
    brief: {
      title: "Transform, then compress",
      body: "A <b>codec</b> transforms a column before compression. <code>Delta</code> stores differences between neighbours, <code>DoubleDelta</code> differences of differences (perfect for timestamps that tick regularly), <code>Gorilla</code> targets floats, <code>T64</code> crops unused bits. They're chained with a compressor: <code>CODEC(DoubleDelta, ZSTD)</code>. One documented Date column went from 2.24 GiB to 24.55 MiB.",
    },
    delta: { q: "ts ticks every few seconds. With CODEC(DoubleDelta, ZSTD) instead of LZ4, its size becomes…", huge: "A tiny fraction", small: "A bit smaller", worse: "Bigger", why: "A tiny fraction: regular ticks turn into runs of zeros, which ZSTD crushes." },
    gorilla: { q: "Is Gorilla always the best codec for floats?", notAlways: "No: plain ZSTD often wins; measure", always: "Yes", never: "It's never useful", why: "In ClickHouse's own tests plain ZSTD beat Gorilla on some float data. Measure with system.columns." },
    tune: {
      title: "Tune the sensors table",
      body: "Choose the codec for ts and temp that makes each one smallest, then apply.",
      ts: "ts",
      temp: "temp",
      codecs: { LZ4: "LZ4", "DoubleDelta, ZSTD": "DoubleDelta, ZSTD", Gorilla: "Gorilla", ZSTD: "ZSTD" },
      apply: "ALTER TABLE … MODIFY COLUMN",
      success: "DoubleDelta + ZSTD for the regular timestamps, plain ZSTD for these temperatures. Compare compressed sizes in system.columns before and after.",
    },
    check: {
      ts: { q: "Best codec family for regularly ticking timestamps?", doubleDelta: "DoubleDelta (chained with ZSTD)", gorilla: "Gorilla", none: "None", why: "Differences of differences are mostly zero." },
      chain: { q: "CODEC(Delta, ZSTD) means…", chain: "Delta first, then ZSTD compresses the result", only: "Only ZSTD", either: "Whichever is smaller", why: "Codecs run in order." },
      float: { q: "For float columns, you should…", measure: "Try ZSTD and Gorilla and measure", gorilla: "Always use Gorilla", never: "Never compress", why: "Data decides." },
      where: { q: "Where do you compare compressed and uncompressed sizes per column?", columns: "system.columns (data_compressed_bytes / data_uncompressed_bytes)", parts: "system.merges", queryLog: "system.query_log", why: "system.columns." },
    },
  },
  "10-5": {
    title: "The JSON type",
    summary: "Each JSON path becomes its own column; read one, skip the rest.",
    halls: { text: "events_text · payload String", json: "events_json · payload JSON" },
    brief: {
      title: "Columns inside a column",
      body: "With the <b>JSON</b> type (GA in 25.3) every path, like <code>payload.ms</code>, is stored as its own <b>columnar subcolumn</b>, with its own type. Reading one path reads only that subcolumn. Beyond <code>max_dynamic_paths</code> (1024) extra paths go to a shared data column. As a String, the same payload must be read whole and parsed on every query.",
    },
    json: { q: "SELECT avg(payload.ms) on the JSON table. What is read?", ms: "Only the payload.ms subcolumn", all: "Every payload subcolumn", blob: "The whole payload", why: "One subcolumn, a few bytes per row." },
    text: { q: "The same on the String table with JSONExtractUInt(payload, 'ms'). What is read?", whole: "The whole payload string, then parsed", ms: "Just the ms field", why: "The whole string, every row: 30 bytes per row here, then JSON parsing." },
    compare: {
      title: "Same answer, different bill",
      body: "Run both versions of avg(ms) and compare what each reads.",
      text: "avg(JSONExtractUInt(payload, 'ms'))",
      json: "avg(payload.ms)",
      success: "The JSON subcolumn read a few percent of the bytes, with no parsing. Use the JSON type for semi-structured data you query by path.",
    },
    check: {
      stored: { q: "How is a JSON column stored?", subcolumns: "As one columnar subcolumn per path", blob: "As a text blob", rows: "Row by row", why: "Each path is a subcolumn." },
      paths: { q: "A JSON column has more paths than max_dynamic_paths. The extra ones…", shared: "Go to a shared data column", error: "Cause an error", dropped: "Are dropped", why: "They're still stored, just not as separate subcolumns." },
      ga: { q: "Since which version is the JSON type production-ready?", v253: "25.3", v226: "22.6", never: "Still experimental", why: "25.3 (with Variant and Dynamic)." },
      read: { q: "A JSON column has {n} paths. A query uses one of them. How many subcolumns does it read?", why: "1: only the path it needs." },
    },
  },
};

const es = {
  "10-1": {
    title: "El tipo más pequeño que sirva",
    summary: "Int64 para una edad, String para una fecha: bytes que pagas en cada fila.",
    brief: {
      title: "Los bytes por fila se acumulan",
      body: "Cada fila paga por los tipos de sus columnas, antes y después de comprimir. <code>UInt8</code> guarda de 0 a 255 en 1 byte; <code>Int64</code> ocupa 8. Una fecha como <code>String</code> son ~20 bytes; como <code>DateTime</code>, 4. En un ejemplo documentado, elegir bien los tipos llevó una tabla de <b>131,58 GiB a 35,34 GiB</b> sin comprimir. Aquí las cajas encogen con los bytes que guardan.",
    },
    age: { q: "age Int64 → UInt8. ¿Cuántos bytes sin comprimir por fila ocupa ahora age?", why: "1: UInt8 es un byte, de sobra para 0–120." },
    created: { q: "created String ('2026-10-02 12:00:00', ~20 bytes) → DateTime. ¿Bytes por fila?", why: "4: DateTime es un timestamp Unix de 32 bits. Además comprime y se compara mucho mejor que el texto." },
    shrink: {
      title: "La tabla, a dieta",
      body: "Elige tipos para user_id y created y aplícalos para que la tabla ocupe como mucho el 45% de su tamaño inicial.",
      user_id: "user_id",
      created: "created",
      types: { Int64: "Int64", UInt32: "UInt32", String: "String", DateTime: "DateTime" },
      apply: "ALTER TABLE … MODIFY COLUMN",
      success: "Ids UInt32 y un DateTime: una fracción de los bytes para la misma información. Columnas más pequeñas también son menos que leer en cada consulta.",
    },
    check: {
      age: { q: "¿El mejor tipo para una edad (0–120)?", uint8: "UInt8", int64: "Int64", string: "String", why: "UInt8: 1 byte." },
      bytes: { q: "Cambiar una columna de Int64 a UInt8 en {millions} millones de filas ahorra cuántos millones de bytes (sin comprimir)?", why: "7 bytes por fila × {millions} millones = {n} millones." },
      date: { q: "Los timestamps se guardan mejor como…", datetime: "DateTime / DateTime64", string: "String", float: "Float64", why: "4 (u 8) bytes, comprimen bien y se ordenan y comparan de forma nativa." },
      enum: { q: "Un estado con 4 valores fijos se guarda mejor como…", enum: "Enum8 (o LowCardinality(String))", string: "String", uint64: "UInt64", why: "1 byte por fila con nombres legibles." },
    },
  },
  "10-2": {
    title: "LowCardinality",
    summary: "Codificar con diccionario los strings con pocos valores distintos, no todos.",
    brief: {
      title: "Un diccionario por part",
      body: "<code>LowCardinality(String)</code> guarda cada valor distinto una sola vez en un diccionario y un número pequeño por fila. Con unos cientos de ciudades se gana muchísimo. La regla práctica: bien <b>por debajo de 10.000</b> valores distintos, y puede salir <b>peor por encima de 100.000</b>, cuando los diccionarios se hacen enormes.",
    },
    city: { q: "city tiene ~200 valores distintos. LowCardinality(String) la deja…", smaller: "Mucho más pequeña", same: "Más o menos igual", bigger: "Más grande", why: "Mucho más pequeña: un índice diminuto por fila en vez del string." },
    url: { q: "url tiene ~1.000.000 de valores distintos. LowCardinality(String) la deja…", smaller: "Mucho más pequeña", same: "Más o menos igual", bigger: "Más grande", why: "Más grande: el diccionario es casi tan grande como los datos, y encima están los índices." },
    pick: {
      title: "Solo donde compensa",
      body: "Elige el tipo de cada columna para que la tabla sea lo más pequeña posible y aplícalo.",
      city: "city",
      url: "url",
      types: { String: "String", LowCardinality: "LowCardinality" },
      apply: "ALTER TABLE … MODIFY COLUMN",
      success: "LowCardinality para city y String normal para url. Mira cuántos valores distintos hay (uniq()) antes de decidir.",
    },
    check: {
      how: { q: "LowCardinality(String) funciona…", dictionary: "Con un diccionario: cada valor una vez y un índice pequeño por fila", compress: "Con un codec más fuerte", index: "Construyendo un índice de salto", why: "Codificación con diccionario." },
      fit: { q: "Una columna String tiene {distinct} valores distintos. ¿Encaja LowCardinality?", yes: "Sí", no: "No", whyYes: "Sí: muy por debajo de 10.000 valores distintos.", whyNo: "No: con tantos valores distintos el diccionario crece demasiado; por encima de ~100.000 puede salir peor." },
      every: { q: "¿Debería ser LowCardinality toda columna String?", no: "No, solo las de pocos valores distintos", yes: "Sí", why: "Los strings con muchos valores distintos empeoran." },
      vsEnum: { q: "LowCardinality antes que Enum cuando…", newValues: "Pueden aparecer valores nuevos sin hacer un ALTER", faster: "Necesitas inserts más rápidos", smaller: "Los valores son números", why: "Enum necesita la lista de antemano." },
    },
  },
  "10-3": {
    title: "Nullable no sale gratis",
    summary: "Un archivo extra de null map por columna, y sin claves por defecto.",
    brief: {
      title: "Un segundo archivo por columna",
      body: "<code>Nullable(T)</code> guarda un <b>null map</b> extra junto a la columna: un byte por fila que dice si el valor es NULL. Las lecturas y los filtros van más lentos, y por defecto una columna Nullable no puede estar en la clave de orden (<code>allow_nullable_key = 0</code>). Casi siempre un valor por defecto (<code>''''</code>, <code>0</code>) dice “desconocido” igual de bien.",
    },
    extra: { q: "Nullable(UInt32) frente a UInt32: ¿cuántos bytes extra sin comprimir por fila para el null map?", why: "1: un UInt8 por fila en un archivo aparte, que se lee junto a la columna." },
    key: { q: "CREATE TABLE … (score Nullable(UInt32)) ORDER BY score. ¿Qué pasa?", error: "Un error, salvo con allow_nullable_key = 1", works: "Funciona sin más", slower: "Funciona, algo más lento", why: "Las claves Nullable se rechazan por defecto." },
    defaults: {
      title: "Valores por defecto en vez de NULL",
      body: "Quita Nullable de phone y score (con DEFAULT '''' y DEFAULT 0) y aplícalo.",
      setting: "Nullable",
      values: { yes: "mantener", no: "quitar" },
      apply: "ALTER TABLE … MODIFY COLUMN",
      success: "Sin null maps: columnas más pequeñas y lecturas más rápidas. Deja Nullable solo donde NULL signifique algo distinto de un valor por defecto.",
    },
    check: {
      cost: { q: "¿Qué añade Nullable?", nullMap: "Un archivo de null map (1 byte por fila) y más trabajo al procesar", free: "Nada", index: "Un índice", why: "El null map se lee con la columna." },
      key: { q: "Una columna Nullable en el ORDER BY, por defecto…", refused: "Se rechaza (allow_nullable_key = 0)", fine: "Está bien", faster: "Va más rápido", why: "No se permite por defecto." },
      bytes: { q: "Una columna Nullable de {millions} millones de filas tiene un null map de cuántos millones de bytes?", why: "{millions}: un byte por fila." },
      instead: { q: "En vez de Nullable para “desconocido”, normalmente…", default: "Un valor por defecto como '''' o 0", nullable: "Nullable(Nullable(T))", string: "Guardarlo todo como String", why: "Los valores por defecto salen más baratos." },
    },
  },
  "10-4": {
    title: "Codecs",
    summary: "Delta y DoubleDelta para secuencias, encadenados con ZSTD; con los floats, mide.",
    brief: {
      title: "Transformar y luego comprimir",
      body: "Un <b>codec</b> transforma la columna antes de comprimirla. <code>Delta</code> guarda las diferencias entre vecinos, <code>DoubleDelta</code> las diferencias de las diferencias (perfecto para timestamps que avanzan a ritmo fijo), <code>Gorilla</code> apunta a floats y <code>T64</code> recorta bits que sobran. Se encadenan con un compresor: <code>CODEC(DoubleDelta, ZSTD)</code>. Una columna Date documentada pasó de 2,24 GiB a 24,55 MiB.",
    },
    delta: { q: "ts avanza cada pocos segundos. Con CODEC(DoubleDelta, ZSTD) en vez de LZ4, su tamaño queda en…", huge: "Una fracción diminuta", small: "Algo más pequeño", worse: "Más grande", why: "Una fracción diminuta: los pasos regulares se vuelven rachas de ceros, que ZSTD aplasta." },
    gorilla: { q: "¿Es Gorilla siempre el mejor codec para floats?", notAlways: "No: ZSTD a secas gana a menudo; mide", always: "Sí", never: "Nunca sirve", why: "En las pruebas de ClickHouse, ZSTD a secas ganó a Gorilla con algunos datos float. Mide con system.columns." },
    tune: {
      title: "Ajusta la tabla de sensores",
      body: "Elige para ts y para temp el codec que deje cada una más pequeña y aplícalo.",
      ts: "ts",
      temp: "temp",
      codecs: { LZ4: "LZ4", "DoubleDelta, ZSTD": "DoubleDelta, ZSTD", Gorilla: "Gorilla", ZSTD: "ZSTD" },
      apply: "ALTER TABLE … MODIFY COLUMN",
      success: "DoubleDelta + ZSTD para los timestamps regulares y ZSTD a secas para estas temperaturas. Compara los tamaños comprimidos en system.columns antes y después.",
    },
    check: {
      ts: { q: "¿La mejor familia de codecs para timestamps que avanzan a ritmo fijo?", doubleDelta: "DoubleDelta (encadenado con ZSTD)", gorilla: "Gorilla", none: "Ninguno", why: "Las diferencias de las diferencias son casi siempre cero." },
      chain: { q: "CODEC(Delta, ZSTD) significa…", chain: "Primero Delta y luego ZSTD comprime el resultado", only: "Solo ZSTD", either: "El que salga más pequeño", why: "Los codecs se aplican en orden." },
      float: { q: "Con columnas float deberías…", measure: "Probar ZSTD y Gorilla y medir", gorilla: "Usar siempre Gorilla", never: "No comprimir nunca", why: "Deciden los datos." },
      where: { q: "¿Dónde comparas el tamaño comprimido y sin comprimir de cada columna?", columns: "system.columns (data_compressed_bytes / data_uncompressed_bytes)", parts: "system.merges", queryLog: "system.query_log", why: "system.columns." },
    },
  },
  "10-5": {
    title: "El tipo JSON",
    summary: "Cada ruta del JSON es su propia columna: lees una y te saltas el resto.",
    halls: { text: "events_text · payload String", json: "events_json · payload JSON" },
    brief: {
      title: "Columnas dentro de una columna",
      body: "Con el tipo <b>JSON</b> (GA en 25.3) cada ruta, como <code>payload.ms</code>, se guarda como su propia <b>subcolumna columnar</b>, con su propio tipo. Leer una ruta lee solo esa subcolumna. Pasado <code>max_dynamic_paths</code> (1024), las rutas extra van a una columna de datos compartidos. Como String, el mismo payload hay que leerlo entero y parsearlo en cada consulta.",
    },
    json: { q: "SELECT avg(payload.ms) en la tabla JSON. ¿Qué se lee?", ms: "Solo la subcolumna payload.ms", all: "Todas las subcolumnas de payload", blob: "El payload entero", why: "Una subcolumna, unos pocos bytes por fila." },
    text: { q: "Lo mismo en la tabla String con JSONExtractUInt(payload, 'ms'). ¿Qué se lee?", whole: "El string del payload entero, y luego se parsea", ms: "Solo el campo ms", why: "El string entero, en cada fila: aquí 30 bytes por fila, y además el parseo del JSON." },
    compare: {
      title: "La misma respuesta, otra factura",
      body: "Lanza las dos versiones de avg(ms) y compara lo que lee cada una.",
      text: "avg(JSONExtractUInt(payload, 'ms'))",
      json: "avg(payload.ms)",
      success: "La subcolumna JSON leyó un pequeño porcentaje de los bytes, sin parsear nada. Usa el tipo JSON para datos semiestructurados que consultas por ruta.",
    },
    check: {
      stored: { q: "¿Cómo se guarda una columna JSON?", subcolumns: "Como una subcolumna columnar por ruta", blob: "Como un bloque de texto", rows: "Fila a fila", why: "Cada ruta es una subcolumna." },
      paths: { q: "Una columna JSON tiene más rutas que max_dynamic_paths. Las que sobran…", shared: "Van a una columna de datos compartidos", error: "Provocan un error", dropped: "Se descartan", why: "Se siguen guardando, solo que no como subcolumnas separadas." },
      ga: { q: "¿Desde qué versión está listo para producción el tipo JSON?", v253: "25.3", v226: "22.6", never: "Sigue siendo experimental", why: "25.3 (junto con Variant y Dynamic)." },
      read: { q: "Una columna JSON tiene {n} rutas. Una consulta usa una. ¿Cuántas subcolumnas lee?", why: "1: solo la ruta que necesita." },
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
