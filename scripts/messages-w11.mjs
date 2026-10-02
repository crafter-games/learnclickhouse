// Merges World 11 copy into messages/{en,es}.json (rerunnable).
// SQL quotes are doubled ('') inside rich text because an ICU apostrophe before < or { escapes it.
import { readFileSync, writeFileSync } from "node:fs";

const ui = {
  en: {
    panels: { keeper: "ClickHouse Keeper", keeperNodes: "{up} of {n} nodes up", keeperQuorum: "quorum", keeperReadonly: "no quorum: read-only", keeperLog: "replication log" },
    stage: { quorum: "FAILED · quorum not reached", readonly: "REJECTED · Keeper read-only" },
    map: { w11: { title: "Replication & sharding", body: "ReplicatedMergeTree and part fetches, Keeper, insert_quorum, shards behind a Distributed table, SharedMergeTree and parallel replicas." } },
  },
  es: {
    panels: { keeper: "ClickHouse Keeper", keeperNodes: "{up} de {n} nodos activos", keeperQuorum: "quórum", keeperReadonly: "sin quórum: solo lectura", keeperLog: "log de replicación" },
    stage: { quorum: "FALLÓ · sin quórum", readonly: "RECHAZADO · Keeper solo lectura" },
    map: { w11: { title: "Replicación y sharding", body: "ReplicatedMergeTree y la descarga de parts, Keeper, insert_quorum, shards detrás de una tabla Distributed, SharedMergeTree y réplicas en paralelo." } },
  },
};

const replicaHalls = { en: { r1: "replica 1", r2: "replica 2" }, es: { r1: "réplica 1", r2: "réplica 2" } };
const shardHalls = { en: { s1: "shard 1 (user_id % 2 = 0)", s2: "shard 2 (user_id % 2 = 1)" }, es: { s1: "shard 1 (user_id % 2 = 0)", s2: "shard 2 (user_id % 2 = 1)" } };

const en = {
  "11-1": {
    title: "Replicas fetch parts",
    summary: "ReplicatedMergeTree: write on any replica, the others fetch the part.",
    halls: replicaHalls.en,
    brief: {
      title: "Write once, fetch everywhere",
      body: "With <b>ReplicatedMergeTree</b> an INSERT goes to <b>any</b> replica. That replica writes the part and records it in the <b>replication log</b> in Keeper; the other replicas read the log and <b>fetch the part</b>. It's asynchronous and multi-master: there's no leader for writes, and by default the INSERT returns once one replica has it.",
    },
    lag: { q: "INSERT on replica 1. When it returns, does replica 2 already have the rows?", soon: "Not necessarily: it fetches the part shortly after", already: "Yes, always", never: "No, never", why: "Replication is asynchronous: the insert was acknowledged by replica 1, replica 2 fetches the part a moment later." },
    master: { q: "Can you INSERT on replica 2 instead?", works: "Yes: any replica takes writes", refused: "No: only the leader takes writes", why: "Multi-master: replica 1 fetches the part from replica 2 the same way." },
    both: {
      title: "Same data on both",
      body: "Insert on each replica, then check that replica 2 has every row.",
      insert1: "INSERT on replica 1",
      insert2: "INSERT on replica 2",
      count2: "SELECT * on replica 2",
      success: "Each part was written once and fetched by the other replica. Same part names on both: replicas hold identical parts.",
    },
    check: {
      how: { q: "How does a replica get data inserted on another replica?", fetch: "It reads the replication log in Keeper and fetches the part", sync: "The insert writes to all replicas synchronously", leader: "A leader pushes rows", why: "Fetching parts listed in the log." },
      master: { q: "Which replica can take INSERTs?", any: "Any of them", leader: "Only the leader", first: "Only the first one", why: "Multi-master." },
      ack: { q: "By default an INSERT returns after how many replicas have the part?", one: "One", all: "All", majority: "A majority", why: "One (insert_quorum = 0)." },
      copies: { q: "{replicas} replicas, {inserts} INSERTs, all replicated. How many part copies exist (before merges)?", why: "{replicas} × {inserts} = {n}." },
    },
  },
  "11-2": {
    title: "insert_quorum",
    summary: "Wait for N replicas before the INSERT counts.",
    halls: replicaHalls.en,
    brief: {
      title: "Acknowledged where?",
      body: "By default (<code>insert_quorum = 0</code>) an INSERT is acknowledged as soon as one replica wrote it. If that replica dies before the others fetch, the data isn't anywhere else yet. <code>insert_quorum = 2</code> (or <code>''auto''</code>, a majority) makes the INSERT wait until that many replicas have the part, and fail after <code>insert_quorum_timeout</code> (600 s). Reads only see quorum data with <code>select_sequential_consistency = 1</code>.",
    },
    zero: { q: "Replica 2 is down. INSERT with the default insert_quorum = 0. What happens?", ok: "It succeeds; only replica 1 has the rows", fails: "It fails", waits: "It waits for replica 2", why: "It succeeds with a single copy. Replica 2 will fetch it when it's back." },
    two: { q: "Replica 2 still down. The same INSERT with insert_quorum = 2?", timeout: "It waits, then fails: quorum not reached", ok: "It succeeds", partial: "Half the rows go in", why: "Only one replica can confirm, so after insert_quorum_timeout the INSERT fails and the client must retry." },
    durable: {
      title: "Durable writes",
      body: "Make an INSERT that's acknowledged only once both replicas have it.",
      revive: "Bring replica 2 back",
      quorum: "insert_quorum",
      quorums: { "0": "0", "2": "2" },
      insert: "INSERT on replica 1",
      success: "Replica 2 caught up from the log, and the quorum INSERT returned only after both replicas had the part.",
    },
    check: {
      default: { q: "Default insert_quorum?", zero: "0 (off)", two: "2", all: "All replicas", why: "Off: one replica acknowledges." },
      auto: { q: "insert_quorum = 'auto' means…", majority: "A majority of replicas", all: "All replicas", one: "One replica", why: "Majority." },
      reads: { q: "For reads that only see quorum-inserted data you also need…", sequential: "select_sequential_consistency = 1", nothing: "Nothing else", final: "FINAL", why: "Quorum alone doesn't make every read consistent." },
      down: { q: "insert_quorum = 2 with only one replica up. The INSERT…", timeout: "Fails after insert_quorum_timeout", succeeds: "Succeeds", queued: "Is queued forever", why: "It can't reach the quorum." },
    },
  },
  "11-3": {
    title: "ClickHouse Keeper",
    summary: "Coordination, not storage: logs and metadata, with a majority.",
    halls: replicaHalls.en,
    brief: {
      title: "The coordinator",
      body: "<b>ClickHouse Keeper</b> (Raft, ZooKeeper-compatible) keeps the <b>metadata</b>: replication logs, which parts each replica has, insert dedup hashes, the ON CLUSTER DDL queue. <b>Not the data</b>. It needs a <b>majority</b> of its nodes: 3 nodes survive 1 failure, 5 survive 2 (2F + 1). Without a majority, replicated tables go read-only.",
    },
    what: { q: "What does Keeper store for this table?", metadata: "The replication log and metadata", rows: "The rows", both: "Both", why: "Metadata only; the parts live on the replicas' disks." },
    one: { q: "3 Keeper nodes, 1 fails. Can you still INSERT?", yes: "Yes: 2 of 3 is a majority", no: "No", why: "Yes: Raft needs a majority, and 2 of 3 is enough." },
    survive: {
      title: "Survive two failures",
      body: "Two Keeper nodes are going to fail. Choose the ensemble size so the cluster still takes INSERTs.",
      nodes: "Keeper nodes",
      counts: { "3": "3", "5": "5" },
      fail: "Two Keeper nodes fail",
      insert: "INSERT",
      success: "5 nodes, 2 down, 3 up: still a majority. 2F + 1 nodes survive F failures.",
    },
    check: {
      stores: { q: "Keeper stores…", metadata: "Metadata: logs, part lists, dedup hashes, DDL queue", data: "Table data", both: "Data and metadata", why: "Never the data." },
      nodes: { q: "How many Keeper nodes to survive {f} failure(s)?", why: "2 × {f} + 1 = {n}." },
      lost: { q: "Keeper loses its majority. Replicated tables…", readonly: "Go read-only", fine: "Keep working", deleted: "Are dropped", why: "No coordination, no writes." },
      onCluster: { q: "CREATE … ON CLUSTER runs…", eventually: "Eventually on each host, via a queue in Keeper", atomic: "Atomically everywhere", never: "Only locally", why: "Queued in Keeper; distributed_ddl_task_timeout = 180 s is how long the client waits." },
    },
  },
  "11-4": {
    title: "Shards and the Distributed table",
    summary: "A router over shards: rows go by sharding_key % shards.",
    halls: shardHalls.en,
    brief: {
      title: "Split the data",
      body: "When one server isn't enough, data is split into <b>shards</b>. A <code>Distributed</code> table stores nothing: it <b>routes</b>. On INSERT each row goes to a shard by <code>sharding_key % total weight</code>; on SELECT it asks every shard and merges the answers. In open-source ClickHouse the INSERT is forwarded in the background by default; with Replicated tables use <code>internal_replication = true</code>.",
    },
    route: { q: "INSERT INTO events_all rows for users 5, 6, 7 and 8, sharded by user_id. How many land on shard 1 (user_id % 2 = 0)?", why: "2: users 6 and 8. Users 5 and 7 go to shard 2." },
    read: { q: "SELECT count() FROM events_all. Which shards are read?", both: "Both, in parallel", one: "One", none: "None: the Distributed table has the data", why: "Both: each shard counts its own rows, the initiator adds them up." },
    colocate: {
      title: "Keep a user together",
      body: "Rows are sharded by rand(). Change the sharding key so all of user 9's events land on one shard, then insert them.",
      key: "sharding key",
      keys: { "rand()": "rand()", user_id: "user_id" },
      insert: "INSERT 4 events of user 9",
      select: "SELECT … WHERE user_id = 9",
      success: "Sharding by user_id keeps each user's rows on one shard, so per-user queries and joins stay local. rand() spreads load evenly but scatters every user.",
    },
    check: {
      stores: { q: "A Distributed table…", router: "Stores nothing; routes inserts and queries to shards", data: "Stores a copy of all data", cache: "Caches query results", why: "It's a routing view." },
      route: { q: "{shards} shards of equal weight, sharding key {key}. Which shard index (0-based) gets the row?", why: "{key} % {shards} = {n}." },
      internal: { q: "With ReplicatedMergeTree shards, internal_replication = true writes to…", one: "One replica per shard; replication copies it", all: "Every replica directly", none: "No replica", why: "Replication does the rest." },
      async: { q: "In open-source ClickHouse, an INSERT into a Distributed table is forwarded to shards…", background: "In the background by default", always: "Always synchronously", never: "Never", why: "distributed_foreground_insert = 0 by default (Cloud: 1)." },
    },
  },
  "11-5": {
    title: "SharedMergeTree & parallel replicas",
    summary: "In ClickHouse Cloud, data lives in object storage and compute scales out.",
    halls: { s3: "shared object storage (S3)" },
    brief: {
      title: "Storage apart, compute apart",
      body: "In ClickHouse Cloud, <b>SharedMergeTree</b> keeps parts in <b>shared object storage</b> and metadata in Keeper. Replicas are <b>stateless compute</b>: adding one copies no data, and you scale without designing shards. <b>Parallel replicas</b> (Beta, opt-in with <code>enable_parallel_replicas</code>) split one query's granules across replicas.",
    },
    add: { q: "You add a third replica. How many parts must be copied to it?", why: "0: it reads the same shared storage. That's why scaling out takes seconds." },
    split: { q: "With parallel replicas on and 3 replicas, a query reads 24 granules. How many does each replica read?", why: "8: the granule ranges are split between the replicas, like threads on one server." },
    scale: {
      title: "Scale out for the big query",
      body: "This query must finish within 250 ms. Choose the number of replicas and whether to use parallel replicas, then run it.",
      replicas: "replicas",
      counts: { "1": "1", "2": "2", "4": "4" },
      parallel: "parallel replicas",
      values: { "0": "off", "1": "on" },
      run: "SELECT sum(total) FROM orders",
      success: "4 replicas reading 6 granules each: 240 ms. Without parallel replicas, extra replicas help concurrency (more queries at once), not a single query.",
    },
    check: {
      where: { q: "Where does SharedMergeTree keep the data?", objectStorage: "In shared object storage", local: "On each replica's local disk", keeper: "In Keeper", why: "Object storage; Keeper holds metadata." },
      shard: { q: "In ClickHouse Cloud, do you need to design shards to scale?", notNeeded: "No: add replicas over shared storage", required: "Yes, always", automatic: "Shards are created per table", why: "Scale by adding compute." },
      parallel: { q: "Parallel replicas are…", optIn: "Opt-in (Beta)", always: "Always on", removed: "Removed", why: "enable_parallel_replicas = 0 by default." },
      split: { q: "{replicas} replicas with parallel replicas, {granules} granules to read. Granules per replica?", why: "{granules} ÷ {replicas} = {n}." },
    },
  },
};

const es = {
  "11-1": {
    title: "Las réplicas descargan parts",
    summary: "ReplicatedMergeTree: escribes en cualquier réplica y las demás descargan la part.",
    halls: replicaHalls.es,
    brief: {
      title: "Escribir una vez, descargar en todas",
      body: "Con <b>ReplicatedMergeTree</b> un INSERT va a <b>cualquier</b> réplica. Esa réplica escribe la part y la apunta en el <b>log de replicación</b> de Keeper; las demás réplicas leen el log y <b>descargan la part</b>. Es asíncrono y multi-master: no hay líder para las escrituras, y por defecto el INSERT responde en cuanto una réplica la tiene.",
    },
    lag: { q: "INSERT en la réplica 1. Cuando responde, ¿tiene ya la réplica 2 las filas?", soon: "No necesariamente: descarga la part poco después", already: "Sí, siempre", never: "No, nunca", why: "La replicación es asíncrona: el insert lo confirmó la réplica 1 y la réplica 2 descarga la part un momento después." },
    master: { q: "¿Puedes hacer el INSERT en la réplica 2?", works: "Sí: cualquier réplica acepta escrituras", refused: "No: solo el líder acepta escrituras", why: "Multi-master: la réplica 1 descarga la part de la réplica 2 igual." },
    both: {
      title: "Los mismos datos en las dos",
      body: "Inserta en cada réplica y comprueba que la réplica 2 tiene todas las filas.",
      insert1: "INSERT en la réplica 1",
      insert2: "INSERT en la réplica 2",
      count2: "SELECT * en la réplica 2",
      success: "Cada part se escribió una vez y la otra réplica la descargó. Los mismos nombres de part en las dos: las réplicas guardan parts idénticas.",
    },
    check: {
      how: { q: "¿Cómo consigue una réplica los datos insertados en otra?", fetch: "Lee el log de replicación en Keeper y descarga la part", sync: "El insert escribe en todas las réplicas a la vez", leader: "Un líder le empuja las filas", why: "Descargando las parts que aparecen en el log." },
      master: { q: "¿Qué réplica puede aceptar INSERTs?", any: "Cualquiera", leader: "Solo el líder", first: "Solo la primera", why: "Multi-master." },
      ack: { q: "Por defecto, ¿tras cuántas réplicas con la part responde un INSERT?", one: "Una", all: "Todas", majority: "Una mayoría", why: "Una (insert_quorum = 0)." },
      copies: { q: "{replicas} réplicas, {inserts} INSERTs, todo replicado. ¿Cuántas copias de parts hay (antes de los merges)?", why: "{replicas} × {inserts} = {n}." },
    },
  },
  "11-2": {
    title: "insert_quorum",
    summary: "Esperar a N réplicas antes de dar el INSERT por bueno.",
    halls: replicaHalls.es,
    brief: {
      title: "¿Confirmado dónde?",
      body: "Por defecto (<code>insert_quorum = 0</code>) un INSERT se confirma en cuanto una réplica lo ha escrito. Si esa réplica muere antes de que las otras lo descarguen, los datos aún no están en ningún otro sitio. <code>insert_quorum = 2</code> (o <code>''auto''</code>, una mayoría) hace que el INSERT espere hasta que tantas réplicas tengan la part, y falle tras <code>insert_quorum_timeout</code> (600 s). Las lecturas solo ven datos con quórum con <code>select_sequential_consistency = 1</code>.",
    },
    zero: { q: "La réplica 2 está caída. INSERT con el insert_quorum = 0 por defecto. ¿Qué pasa?", ok: "Funciona; solo la réplica 1 tiene las filas", fails: "Falla", waits: "Espera a la réplica 2", why: "Funciona con una sola copia. La réplica 2 la descargará cuando vuelva." },
    two: { q: "La réplica 2 sigue caída. El mismo INSERT con insert_quorum = 2?", timeout: "Espera y luego falla: no hay quórum", ok: "Funciona", partial: "Entra la mitad de las filas", why: "Solo una réplica puede confirmarlo, así que tras insert_quorum_timeout el INSERT falla y el cliente debe reintentar." },
    durable: {
      title: "Escrituras duraderas",
      body: "Haz un INSERT que solo se confirme cuando las dos réplicas lo tengan.",
      revive: "Recuperar la réplica 2",
      quorum: "insert_quorum",
      quorums: { "0": "0", "2": "2" },
      insert: "INSERT en la réplica 1",
      success: "La réplica 2 se puso al día con el log, y el INSERT con quórum respondió solo cuando las dos réplicas tenían la part.",
    },
    check: {
      default: { q: "¿Valor por defecto de insert_quorum?", zero: "0 (desactivado)", two: "2", all: "Todas las réplicas", why: "Desactivado: confirma una réplica." },
      auto: { q: "insert_quorum = 'auto' significa…", majority: "Una mayoría de réplicas", all: "Todas las réplicas", one: "Una réplica", why: "Mayoría." },
      reads: { q: "Para que las lecturas solo vean datos insertados con quórum también necesitas…", sequential: "select_sequential_consistency = 1", nothing: "Nada más", final: "FINAL", why: "El quórum por sí solo no hace consistente cada lectura." },
      down: { q: "insert_quorum = 2 con una sola réplica activa. El INSERT…", timeout: "Falla tras insert_quorum_timeout", succeeds: "Funciona", queued: "Se queda en cola para siempre", why: "No puede alcanzar el quórum." },
    },
  },
  "11-3": {
    title: "ClickHouse Keeper",
    summary: "Coordinación, no almacenamiento: logs y metadatos, con mayoría.",
    halls: replicaHalls.es,
    brief: {
      title: "El coordinador",
      body: "<b>ClickHouse Keeper</b> (Raft, compatible con ZooKeeper) guarda los <b>metadatos</b>: logs de replicación, qué parts tiene cada réplica, los hashes de deduplicación de inserts y la cola de DDL ON CLUSTER. <b>No los datos</b>. Necesita una <b>mayoría</b> de sus nodos: 3 nodos aguantan 1 caída, 5 aguantan 2 (2F + 1). Sin mayoría, las tablas replicadas pasan a solo lectura.",
    },
    what: { q: "¿Qué guarda Keeper de esta tabla?", metadata: "El log de replicación y los metadatos", rows: "Las filas", both: "Las dos cosas", why: "Solo metadatos; las parts viven en los discos de las réplicas." },
    one: { q: "3 nodos de Keeper, cae 1. ¿Puedes seguir haciendo INSERT?", yes: "Sí: 2 de 3 es mayoría", no: "No", why: "Sí: Raft necesita mayoría, y 2 de 3 basta." },
    survive: {
      title: "Aguantar dos caídas",
      body: "Van a caer dos nodos de Keeper. Elige el tamaño del ensemble para que el clúster siga aceptando INSERTs.",
      nodes: "Nodos de Keeper",
      counts: { "3": "3", "5": "5" },
      fail: "Caen dos nodos de Keeper",
      insert: "INSERT",
      success: "5 nodos, 2 caídos, 3 activos: sigue habiendo mayoría. 2F + 1 nodos aguantan F caídas.",
    },
    check: {
      stores: { q: "Keeper guarda…", metadata: "Metadatos: logs, listas de parts, hashes de dedup, cola de DDL", data: "Los datos de las tablas", both: "Datos y metadatos", why: "Nunca los datos." },
      nodes: { q: "¿Cuántos nodos de Keeper para aguantar {f} caída(s)?", why: "2 × {f} + 1 = {n}." },
      lost: { q: "Keeper pierde la mayoría. Las tablas replicadas…", readonly: "Pasan a solo lectura", fine: "Siguen funcionando", deleted: "Se borran", why: "Sin coordinación no hay escrituras." },
      onCluster: { q: "CREATE … ON CLUSTER se ejecuta…", eventually: "Tarde o temprano en cada host, mediante una cola en Keeper", atomic: "De forma atómica en todos", never: "Solo en local", why: "Se encola en Keeper; distributed_ddl_task_timeout = 180 s es lo que espera el cliente." },
    },
  },
  "11-4": {
    title: "Shards y la tabla Distributed",
    summary: "Un enrutador sobre los shards: las filas van según sharding_key % shards.",
    halls: shardHalls.es,
    brief: {
      title: "Repartir los datos",
      body: "Cuando un servidor no basta, los datos se reparten en <b>shards</b>. Una tabla <code>Distributed</code> no guarda nada: <b>enruta</b>. En un INSERT cada fila va a un shard según <code>sharding_key % peso total</code>; en un SELECT pregunta a todos los shards y junta las respuestas. En ClickHouse open source el INSERT se reenvía en segundo plano por defecto; con tablas Replicated usa <code>internal_replication = true</code>.",
    },
    route: { q: "INSERT INTO events_all de filas de los usuarios 5, 6, 7 y 8, con sharding por user_id. ¿Cuántas caen en el shard 1 (user_id % 2 = 0)?", why: "2: los usuarios 6 y 8. Los usuarios 5 y 7 van al shard 2." },
    read: { q: "SELECT count() FROM events_all. ¿Qué shards se leen?", both: "Los dos, en paralelo", one: "Uno", none: "Ninguno: los datos están en la tabla Distributed", why: "Los dos: cada shard cuenta sus filas y el iniciador las suma." },
    colocate: {
      title: "Un usuario, en un solo sitio",
      body: "Las filas se reparten con rand(). Cambia la clave de sharding para que todos los eventos del usuario 9 caigan en un shard y luego insértalos.",
      key: "clave de sharding",
      keys: { "rand()": "rand()", user_id: "user_id" },
      insert: "INSERT de 4 eventos del usuario 9",
      select: "SELECT … WHERE user_id = 9",
      success: "Con sharding por user_id las filas de cada usuario quedan en un shard, así que las consultas y los joins por usuario son locales. rand() reparte bien la carga pero dispersa a cada usuario.",
    },
    check: {
      stores: { q: "Una tabla Distributed…", router: "No guarda nada; enruta inserts y consultas a los shards", data: "Guarda una copia de todos los datos", cache: "Cachea resultados", why: "Es una vista que enruta." },
      route: { q: "{shards} shards del mismo peso, clave de sharding {key}. ¿Qué índice de shard (desde 0) recibe la fila?", why: "{key} % {shards} = {n}." },
      internal: { q: "Con shards ReplicatedMergeTree, internal_replication = true escribe en…", one: "Una réplica por shard; la replicación copia el resto", all: "Todas las réplicas directamente", none: "Ninguna réplica", why: "La replicación hace el resto." },
      async: { q: "En ClickHouse open source, un INSERT en una tabla Distributed se reenvía a los shards…", background: "En segundo plano por defecto", always: "Siempre de forma síncrona", never: "Nunca", why: "distributed_foreground_insert = 0 por defecto (Cloud: 1)." },
    },
  },
  "11-5": {
    title: "SharedMergeTree y réplicas en paralelo",
    summary: "En ClickHouse Cloud los datos viven en almacenamiento de objetos y el cómputo escala.",
    halls: { s3: "almacenamiento de objetos compartido (S3)" },
    brief: {
      title: "Almacenamiento por un lado, cómputo por otro",
      body: "En ClickHouse Cloud, <b>SharedMergeTree</b> guarda las parts en <b>almacenamiento de objetos compartido</b> y los metadatos en Keeper. Las réplicas son <b>cómputo sin estado</b>: añadir una no copia datos, y escalas sin diseñar shards. Las <b>réplicas en paralelo</b> (Beta, opcionales con <code>enable_parallel_replicas</code>) reparten los granules de una consulta entre réplicas.",
    },
    add: { q: "Añades una tercera réplica. ¿Cuántas parts hay que copiarle?", why: "0: lee el mismo almacenamiento compartido. Por eso escalar lleva segundos." },
    split: { q: "Con réplicas en paralelo y 3 réplicas, una consulta lee 24 granules. ¿Cuántos lee cada réplica?", why: "8: los rangos de granules se reparten entre las réplicas, como los hilos en un servidor." },
    scale: {
      title: "Escalar para la consulta grande",
      body: "Esta consulta tiene que terminar en 250 ms. Elige el número de réplicas y si usar réplicas en paralelo, y lánzala.",
      replicas: "réplicas",
      counts: { "1": "1", "2": "2", "4": "4" },
      parallel: "réplicas en paralelo",
      values: { "0": "off", "1": "on" },
      run: "SELECT sum(total) FROM orders",
      success: "4 réplicas leyendo 6 granules cada una: 240 ms. Sin réplicas en paralelo, más réplicas ayudan a la concurrencia (más consultas a la vez), no a una sola consulta.",
    },
    check: {
      where: { q: "¿Dónde guarda los datos SharedMergeTree?", objectStorage: "En almacenamiento de objetos compartido", local: "En el disco local de cada réplica", keeper: "En Keeper", why: "Almacenamiento de objetos; Keeper guarda los metadatos." },
      shard: { q: "En ClickHouse Cloud, ¿hay que diseñar shards para escalar?", notNeeded: "No: se añaden réplicas sobre almacenamiento compartido", required: "Sí, siempre", automatic: "Se crean shards por tabla", why: "Se escala añadiendo cómputo." },
      parallel: { q: "Las réplicas en paralelo son…", optIn: "Opcionales (Beta)", always: "Siempre activas", removed: "Eliminadas", why: "enable_parallel_replicas = 0 por defecto." },
      split: { q: "{replicas} réplicas con réplicas en paralelo y {granules} granules que leer. ¿Granules por réplica?", why: "{granules} ÷ {replicas} = {n}." },
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
