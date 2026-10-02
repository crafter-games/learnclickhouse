// Merges map / landing / unlock-code strings into messages/{en,es}.json (rerunnable).
import { readFileSync, writeFileSync } from "node:fs";

const add = {
  en: {
    map: {
      home: "Home",
      world: "World {n}",
      prev: "Previous world",
      next: "Next world",
      replay: "Replay",
      playLevel: "Play {id}",
      worldLocked: "Finish World {n} to unlock",
      soon: "Coming soon",
      soonBody: "This warehouse is still under construction. More ClickHouse is on the way.",
      sandbox: { title: "Free depot" },
      w1: { title: "Columns", body: "Why ClickHouse stores each column on its own: reading only what a query names, and why similar values side by side compress so well." },
      w2: { title: "Inserts, parts & merges", body: "Every insert becomes an immutable part; background merges fuse them. Batching, async inserts and the famous “Too many parts”." },
      w3: { title: "ORDER BY & the sparse index", body: "Granules of 8,192 rows, an index with one entry per granule, and why the order of your key decides how much gets read." },
      w4: { title: "Partitions", body: "Separate halls for managing data: pruning, why partitions don't make queries faster, and the cheapest delete there is." },
    },
    code: {
      button: "Code",
      open: "Enter an unlock code",
      title: "Unlock code",
      body: "Got a code? Type it here.",
      label: "Code",
      redeem: "Redeem",
      bad: "That code doesn't work.",
      ok: "Unlocked! Every level complete with 3 stars.",
      close: "Close",
    },
    landing: {
      kicker: "Learn ClickHouse · unofficial",
      headline: "Run the depot and learn how ClickHouse really stores and reads data.",
      start: "Start",
      credits: "3D art: Kenney (CC0). Music and sounds generated in code. Full credits in",
      madeBy: "Made by",
      github: "Source code on GitHub",
    },
  },
  es: {
    map: {
      home: "Inicio",
      world: "Mundo {n}",
      prev: "Mundo anterior",
      next: "Mundo siguiente",
      replay: "Repetir",
      playLevel: "Jugar {id}",
      worldLocked: "Termina el Mundo {n} para desbloquear",
      soon: "Próximamente",
      soonBody: "Esta nave aún está en obras. Viene más ClickHouse en camino.",
      sandbox: { title: "Almacén libre" },
      w1: { title: "Columnas", body: "Por qué ClickHouse guarda cada columna por separado: leer solo lo que nombra la consulta, y por qué los valores parecidos juntos comprimen tan bien." },
      w2: { title: "Inserts, parts y merges", body: "Cada insert se convierte en una part inmutable; los merges en segundo plano las fusionan. Lotes, async inserts y el famoso “Too many parts”." },
      w3: { title: "ORDER BY e índice disperso", body: "Granules de 8192 filas, un índice con una entrada por granule, y por qué el orden de tu clave decide cuánto se lee." },
      w4: { title: "Particiones", body: "Naves separadas para gestionar datos: la poda, por qué particionar no acelera consultas y el borrado más barato que existe." },
    },
    code: {
      button: "Código",
      open: "Ingresar un código de desbloqueo",
      title: "Código de desbloqueo",
      body: "¿Tienes un código? Escríbelo aquí.",
      label: "Código",
      redeem: "Canjear",
      bad: "Ese código no funciona.",
      ok: "¡Desbloqueado! Todos los niveles completos con 3 estrellas.",
      close: "Cerrar",
    },
    landing: {
      kicker: "Aprende ClickHouse · no oficial",
      headline: "Dirige el almacén y aprende cómo ClickHouse guarda y lee los datos de verdad.",
      start: "Empezar",
      credits: "Arte 3D: Kenney (CC0). Música y sonidos generados en código. Créditos completos en",
      madeBy: "Hecho por",
      github: "Código fuente en GitHub",
    },
  },
};

for (const locale of ["en", "es"]) {
  const file = new URL(`../messages/${locale}.json`, import.meta.url);
  const json = JSON.parse(readFileSync(file, "utf8"));
  Object.assign(json, add[locale]);
  json.desk = { ...json.desk, map: locale === "es" ? "Mapa del mundo" : "World map" };
  writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
  console.log(`updated ${locale}.json`);
}
