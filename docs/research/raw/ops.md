# Research C: ClickHouse operations (replication, lifecycle, ingestion, types and compression)

Researched 2026-10-02. Defaults were checked against GitHub `master` source (`src/Core/Settings.cpp` and `src/Storages/MergeTree/MergeTreeSettings.cpp`; master is the 26.10 dev cycle; the latest release is 26.9, from 2026-09-21) and against the official docs. Where the docs and the source disagree, the source wins and the conflict is noted.
Source keys such as [S1] are listed at the end.

> **Five facts that may surprise readers (all changed in 2026)**
> 1. **`async_insert` now defaults to `1`.** It changed in 26.2 (PR #97590, backported to 26.2.4.17). Several docs pages still say async inserts are off by default. [S5][S6]
> 2. **The default compression codec is now ZSTD(3).** It changed from LZ4 in 26.9 and is a backward-incompatible change. MergeTree uses a size-aware rule: below 100 MB the codec is LZ4 (new inserts start at size 0, so they are LZ4); at or above 100 MB it is ZSTD(3). Merges therefore promote parts to ZSTD. Network compression is also ZSTD(3). The codec docs still say "LZ4 self-managed, ZSTD in Cloud". [S7][S8][S20]
> 3. **`deduplicate_insert` now defaults to `enable`.** It changed in 26.2. Insert deduplication now covers both sync and async inserts by default. [S5][S21]
> 4. **Lightweight UPDATE (patch parts) is still Beta.** It was experimental in 25.7 and became Beta in 25.8, with the default `enable_lightweight_update = true`. The patch format changed to v2 in 26.8 and gained sort-key columns in 26.9. [S5][S17][S18]
> 5. **`allow_experimental_codecs` is obsolete as of 26.9.** Each codec now has its own setting, for example `enable_alp_codec` (ALP is Beta). [S7]

---

## 1. Replication and sharding

| Concept | Definition | Settings / defaults (version) | Common misconception |
|---|---|---|---|
| ReplicatedMergeTree | Table-level replication. An INSERT goes to any replica, which writes a part locally and records it in the Keeper log. Other replicas then fetch that part (compressed) from a peer. "Replication is asynchronous and multi-master." INSERT and ALTER are replicated. CREATE, DROP, ATTACH, DETACH and RENAME are **not** replicated. [S1] | By default an INSERT waits for **1 replica** only. Fetches run in a separate pool (`background_fetches_pool_size`). [S1] Deduplication windows: `replicated_deduplication_window=10000` blocks and `replicated_deduplication_window_seconds=3600`. [S4] | "Replication is synchronous / all replicas have the data when INSERT returns." Wrong: other replicas catch up asynchronously. "There is one leader that takes writes." Wrong: "Multiple replicas can be leaders at the same time" and any replica accepts writes. [S1][S22] |
| ClickHouse Keeper | A C++ coordination service that replaces ZooKeeper. It uses Raft (NuRaft), speaks the ZooKeeper client protocol, and its snapshot/log format is incompatible with ZooKeeper (convert with `clickhouse-keeper-converter`). It provides linearizable reads and writes, has better compression and lower memory use, and avoids the zxid overflow problem. Production-ready since **21.11**. [S2] | At least **3 nodes** is recommended for quorum (2F+1: 3 nodes tolerate 1 failure, 5 tolerate 2). [S2][S23] | "Keeper stores the table data." Wrong: it stores only metadata, the replication log, block hashes for deduplication, and the DDL queue. |
| insert_quorum | Makes an INSERT wait until N replicas confirm the write. | `insert_quorum=0` (off; values below 2 also mean off; `'auto'` means a majority). `insert_quorum_timeout=600000` ms. `insert_quorum_parallel=1` (default since 21.1). Does not apply to SharedMergeTree. [S5] | "A quorum makes reads consistent automatically." Wrong: that also needs `select_sequential_consistency=1` **and** `insert_quorum_parallel=0`. [S5] |
| select_sequential_consistency | A SELECT reads only data that was written with a quorum. | Default `0`. Requires `insert_quorum_parallel` disabled. Behaves differently on SharedMergeTree. [S5] | |
| Distributed engine | A "view" over shards. "Tables with Distributed engine do not store any data of their own." Rows are routed by `sharding_key` modulo the sum of shard weights (weight default 1). [S3] | `distributed_foreground_insert=0` (alias **`insert_distributed_sync`**). In OSS an INSERT is buffered on local disk and sent in the background. **Cloud default is `1`.** [S5] Other settings: `distributed_background_insert_*`, `prefer_localhost_replica=1`, `optimize_skip_unused_shards=0`. [S3][S5] | "The Distributed table stores data." Wrong. "INSERT into Distributed means the data is on the shards when it returns." Wrong by default in OSS. |
| internal_replication | Per-shard flag in the cluster config. `true` writes to **one** healthy replica per shard and lets ReplicatedMergeTree replicate the rest. `false` makes the Distributed table write to every replica itself. [S3] | Default `false`. With Replicated tables you almost always want `true`. [S3] | Leaving it `false` together with ReplicatedMergeTree causes double writes and inconsistency **[unverified wording; consequence widely documented]**. |
| ON CLUSTER DDL | `CREATE/ALTER/DROP/RENAME ... ON CLUSTER c` puts a task in Keeper's DDL queue, and every host runs it "eventually … even if some hosts are currently not available". [S24] | `distributed_ddl_task_timeout=180` s; `distributed_ddl_output_mode=throw`. [S5] | "ON CLUSTER is atomic across the cluster." Wrong: it is eventually executed per host. |
| Replicated database engine | `ENGINE = Replicated('zk_path','shard','replica')` replicates **DDL/metadata** through a log in Keeper. Table data is still replicated by the table engine. The initiator executes first and the other hosts follow. [S25] | Docs do not mark it experimental. | "A Replicated database replicates data." Only metadata. |
| Parallel replicas | Splits one query's granule ranges across several replicas of the **same** shard. A coordinator hands out tasks dynamically and uses work stealing. [S26] | `enable_parallel_replicas` (alias of `allow_experimental_parallel_reading_from_replicas`) defaults to `0`. It has been **Beta since 24.10**. `max_parallel_replicas=1000`. `cluster_for_parallel_replicas` (use `default` in Cloud). 26.9 added plan-based automatic enabling. [S5][S7][S26] | "More replicas automatically speed up every query." It is opt-in, has limits (FINAL, some JOINs, small queries), and helps most on Cloud's shared storage. |
| SharedMergeTree (Cloud) | A Cloud engine. Data lives in shared object storage (S3/GCS/Azure) and metadata in Keeper. "Replicas don't communicate with each other". Compute is stateless and storage is separate, so you scale by adding replicas and do not need to shard. [S9] | "All inserts to SharedMergeTree are quorum inserts", so `insert_quorum` is unnecessary. Use `SYSTEM SYNC REPLICA LIGHTWEIGHT` for read-your-writes across replicas. In Cloud, `default_table_engine` is SharedMergeTree. [S9][S5] | "You must design shards in Cloud." Usually not. |

## 2. Data lifecycle

| Concept | Definition | Settings / defaults (version) | Common misconception |
|---|---|---|---|
| Row TTL | `TTL ts + INTERVAL 30 DAY [DELETE] [WHERE …]` removes rows. It is applied **during merges**, not at the expiry instant. [S10] | `merge_with_ttl_timeout=14400` s (4 h) is the minimum gap between TTL merges. To force TTL: `OPTIMIZE … FINAL` or `ALTER TABLE … MATERIALIZE TTL`. [S4][S10] | "Rows disappear exactly when they expire." Wrong: it can take hours (until the next TTL merge). |
| Column TTL | When it expires, the column value is reset to the type's default. [S10] | | |
| TTL TO DISK / TO VOLUME | Moves whole **parts** to another disk or volume (hot to cold to S3). [S11] | `perform_ttl_move_on_insert` controls whether parts that are already expired go straight to the TTL target. [S11] | |
| TTL GROUP BY | Rolls up expired rows (`GROUP BY key_prefix SET col = agg(col)`). The GROUP BY must be a prefix of the primary key. [S11] | | |
| TTL RECOMPRESS | `TTL d + INTERVAL 1 MONTH RECOMPRESS CODEC(ZSTD(17))` re-encodes old data. [S10] | `merge_with_recompression_ttl_timeout=14400` s. [S4] | |
| ttl_only_drop_parts | Drop a whole part only when **all** of its rows have expired, instead of rewriting the part. Pair it with `PARTITION BY` on the TTL column. [S4][S10] | Default `0`. [S4] | |
| Storage policies / tiered storage | Disks are grouped into volumes (ordered, JBOD-like), and volumes into a policy. New parts go to the first volume with space. Parts move to the next volume when free space falls below `move_factor`. `max_data_part_size_bytes` keeps big parts off the fast disks. S3, Azure and HDFS disks are supported. [S11] | `move_factor` default **0.1**. [S11] | |
| Mutations (`ALTER … UPDATE/DELETE`) | They work by "rewriting whole data parts". They are asynchronous, totally ordered, apply only to parts that existed when the mutation was submitted, cannot be rolled back (use `KILL MUTATION`), and do not block inserts. Track them in `system.mutations`. [S12] | `mutations_sync=0` (0 = async, 1 = this server, 2 = all replicas, 3 = active replicas). Key columns cannot be updated. [S5][S13] | "UPDATE/DELETE are cheap like in Postgres." A 1-row ALTER DELETE can rewrite GBs of parts. "The ALTER finished, so the data is gone." It may still be running. |
| Lightweight DELETE | `DELETE FROM t WHERE …` sets the hidden `_row_exists` mask. Reads become `PREWHERE _row_exists`, and the rows are physically removed on later merges. **GA in 23.3.** [S14][S15] | `enable_lightweight_delete=1`; `lightweight_deletes_sync=2` (waits for all replicas; Cloud default 1). Fails on tables with projections unless `lightweight_mutation_projection_mode` (default `throw`) is set. `lightweight_delete_mode=alter_update` (25.5+). [S5][S4][S14] | "Lightweight delete frees disk immediately." No, only after merges. Deleting a large fraction slows SELECTs. |
| Lightweight UPDATE / patch parts | `UPDATE t SET … WHERE …` writes small **patch parts** that hold only the changed columns and rows. They are applied at read time and materialized on merges. [S16] | **Experimental in 25.7, Beta in 25.8**: `enable_lightweight_update=true` (alias `allow_experimental_lightweight_update`); `apply_patch_parts=1`; `apply_patches_on_merge=1` (25.5). Requires `enable_block_number_column` and `enable_block_offset_column` (both default `0`). The patch format is v2 since 26.8, and 26.9 added sort-key columns. Aimed at small updates (about 10% of the table or less). Benchmarks report about 1,600x faster than mutations (60 ms vs 100 s). [S5][S4][S16][S17][S18] | "UPDATE is GA." It is still Beta as of 26.10 master. |
| DROP PARTITION / TRUNCATE | Drops whole parts or partitions as a metadata operation. This is the cheapest delete, so design `PARTITION BY` for it. [S19][S27] | | |

## 3. Ingestion

| Concept | Definition | Settings / defaults (version) | Common misconception |
|---|---|---|---|
| Batching / parts | Each INSERT creates at least one part, and merges have to keep up. Recommendation: at least 1,000 rows per insert, ideally **10,000–100,000**, and about **1 insert per second**. [S21] | `parts_to_delay_insert=1000` and `parts_to_throw_insert=3000` (per partition), which produce the "Too many parts" error. `max_insert_block_size=1048449`. [S4][S5] | "Row-by-row inserts are fine like OLTP." |
| Async inserts | The server buffers small inserts and flushes when it hits a size, time or query-count limit. | **`async_insert=1` since 26.2.** `wait_for_async_insert=1`. `async_insert_max_data_size` is 10 MiB in OSS (100 MiB in Cloud). `async_insert_busy_timeout_max_ms=200` (Cloud 1000), adaptive with a 50 ms minimum. `async_insert_max_query_number=450`. [S5][S6] Some docs still say "100 MiB" and "not enabled by default", which is stale for OSS. [S21][S28] | "fire-and-forget is safe." With `wait_for_async_insert=0`, data can be lost. |
| Insert deduplication | Retried identical blocks are ignored, using hashes kept in Keeper. | `deduplicate_insert=enable` (26.2) covers sync and async inserts. `insert_deduplication_token` lets you set your own key. [S5][S29] | |
| Kafka engine + MV | A Kafka engine table is a **consumer**, not storage. A materialized view reads from it and inserts into a MergeTree table. A SELECT on the Kafka table consumes the messages. Delivery is at-least-once. Virtual columns: `_topic`, `_partition`, `_offset`, `_timestamp`, `_key`, `_headers`. `kafka_handle_error_mode`: default / stream / dead_letter_queue. [S30] | `kafka_num_consumers`, `kafka_max_block_size`, `kafka_thread_per_consumer`. | "The Kafka table stores messages." |
| S3Queue | Streams files from object storage. It uses the same MV pattern and tracks processed files in Keeper. Modes: `ordered`, `unordered`, and `exclusive` (no Keeper; 26.9). Since 24.6, `mode` must be set explicitly. `after_processing` default `keep`. [S31][S7] | `polling_min_timeout_ms=1000`, `tracked_files_limit=1000`, `loading_retries=10`. [S31] | |
| ClickPipes (Cloud only) | Managed ingestion from Kafka/Confluent/MSK/Redpanda/Event Hubs, Kinesis, S3/GCS/Azure Blob, and CDC from Postgres, MySQL/MariaDB and MongoDB (Beta). Errors go to tables with 7-day retention. [S32] | | |
| Formats | **Native** is columnar and the most efficient. **RowBinary** is efficient and row-based. **JSONEachRow** is easy but "expensive to parse". Also supported: CSV/TSV, Parquet (columnar files). [S21] | LZ4-compressed Native inserts cut a 5.6 GiB load from 150 s to 131 s. [S21] | |

## 4. Data types and compression

| Concept | Definition | Settings / defaults (version) | Common misconception |
|---|---|---|---|
| LowCardinality(T) | Dictionary encoding: each row stores a small integer index into a dictionary. Below **10,000** distinct values it is "mostly" more efficient. Above **100,000** it "can perform worse" than the plain type. Preferred over Enum for strings. [S33] | `low_cardinality_max_dictionary_size=8192`; `allow_suspicious_low_cardinality_types=0`. [S5] Example: `station_id` 7.60 to 3.40 MiB, `name` 9.63 to 3.99 MiB. [S34] | "Use it on every String." Not on high-cardinality columns. |
| Nullable(T) | Adds "a separate file with NULL masks". "almost always negatively affects performance." It "can't be included in table indexes" unless `allow_nullable_key=1` (default 0). [S35][S4] | | "NULL is free." Use default values instead. |
| Smallest type | Pick the narrowest type that fits: UInt8/16 instead of Int64, Float32, Date/DateTime instead of String, Enum8. In one example, type changes alone took uncompressed size from 131.58 GiB to 35.34 GiB (-73%). [S34] | | |
| Default codec | **26.9+ OSS: LZ4 for parts under 100 MB, ZSTD(3) at or above 100 MB.** Earlier OSS used LZ4. Cloud uses ZSTD. A bare `ZSTD` means level 1 (levels range 1–22). [S7][S8][S20] | `network_compression_method="ZSTD"`. [S5] | "ClickHouse defaults to LZ4." True only before 26.9 (and for small new parts). |
| Specialized codecs | **Delta** (stores differences), **DoubleDelta** (delta of deltas; suits monotonic timestamps), **Gorilla** and **FPC** (floats, XOR), **T64** (crops unused high bits of integers), **GCD**, **ALP** (floats, Beta, `enable_alp_codec`). Experimental: ZXC, SZ3 (lossy). Encryption: AES_128_GCM_SIV, AES_256_GCM_SIV. [S20] | Chains are written like `CODEC(Delta, ZSTD)`. Preparation codecs cannot be used alone. Encryption goes last. `enable_adaptive_codec_selection` is experimental. [S20][S7] | "Gorilla is always best for floats." In the blog test, plain ZSTD beat the specialized codecs on floats, and ZSTD levels above 3 gave negligible gains. [S34] |
| Compression ratios | Stack Overflow posts: 143.47 GiB to 50.16 GiB (2.86x). FavoriteCount reached 1,853x. Delta on Id: 159.70 to 64.91 MiB. [S36] Weather data: Delta+ZSTD on a date went from 2.24 GiB to 24.55 MiB (ratio 1.76 to 166). Whole table 4.07 to 1.42 GiB compressed. [S34] | Inspect with `system.columns` (`data_compressed_bytes`, `data_uncompressed_bytes`). [S36] | |
| JSON type | Each JSON path becomes its own columnar subcolumn (typed by hint, otherwise Dynamic). Extra paths go to "shared data". **Production-ready in 25.3.** [S37][S5] | `max_dynamic_paths=1024`; `max_dynamic_types=32`. Supports `SKIP` and `SKIP REGEXP`. [S37] | "JSON is stored as a text blob." Wrong: it is columnar per path. |
| Variant / Dynamic | Variant(T1..Tn) is a discriminated union (it can also be NULL). Dynamic holds any type, up to `max_types=32` per block, after which values go to a shared variant. **Both production-ready in 25.3** (experimental from 24.1 and 24.5 respectively). [S38][S39][S5] | | |
| Enum8/16 | Fixed string-to-integer mapping. `weatherType` String to Enum8: 37.87 to 16.48 MiB. LowCardinality is more flexible. [S34][S33] | | |

## 5. System tables for teaching

| Table | Use |
|---|---|
| `system.parts` | Active and inactive parts, rows, bytes, partition, disk. Use it for "too many parts" and for watching merges/TTL moves. |
| `system.merges` | Merges currently running, with progress. |
| `system.mutations` | Mutation status: `is_done`, `parts_to_do`, `latest_fail_reason`. [S12] |
| `system.part_log` | Events NewPart, MergePartsStart, MergeParts, DownloadPart, RemovePart, MutatePartStart, MutatePart, MovePart. It exists only if the `part_log` server setting is configured, and the shipped `config.xml` enables it. [S40][S41] |
| `system.replicas` | `is_leader` (several can be leaders), `is_readonly`, `absolute_delay`, `queue_size`, `inserts_in_queue`, `merges_in_queue`, `log_pointer`, `total_replicas`, `active_replicas`. [S22] |
| `system.replication_queue` | Per-replica tasks: GET_PART (fetch), MERGE_PARTS, and others. [S23] |
| `system.query_log` | Per-query read_rows, read_bytes, memory, duration (`log_queries=1`). [S41] |
| `system.columns` | Compressed and uncompressed size per column. [S36] |

---

## Visualizable mechanics

1. **Replication.** An INSERT reaches replica A, which creates part `all_5_5_0` and appends a GET_PART entry to the Keeper log. Replicas B and C read the log and fetch the part from A. Show the lag (`absolute_delay`). Show B offline, then catching up.
2. **Quorum insert.** With `insert_quorum=2`, the INSERT spinner waits until 2 replicas tick. If the timeout (600 s) passes, the block is rolled back.
3. **Distributed routing.** A row with `user_id=17` and 3 shards of weights 1:1:2 (total 4): `17 % 4 = 1`, so it goes to shard 2 (range [1,2)). Async mode (default): the row first lands in a local queue folder, then is sent. Cloud default: synchronous.
4. **SharedMergeTree vs RMT.** In RMT each replica has its own disk and copies parts. In SharedMergeTree, all replicas point at one S3 bucket and Keeper holds only metadata. Scaling adds a stateless node.
5. **TTL move.** Parts age along a timeline. After 7 d they slide to a "cold" volume, after 30 d to S3, and after 365 d they are deleted, but only when the next TTL merge fires (up to 4 h of "lag").
6. **move_factor.** Hot disk fills to 90% free-space threshold → oldest parts start moving.
7. **Mutation vs lightweight DELETE vs UPDATE.** A mutation rewrites the whole part (all columns are copied, which is heavy). A lightweight DELETE flips bits in `_row_exists` and rows vanish at the next merge. A lightweight UPDATE writes a small patch part that is overlaid on read and merged in later. DROP PARTITION removes the whole partition at once.
8. **Too many parts.** Many tiny inserts pile up parts. Above 1,000 parts per partition inserts slow down, and at 3,000 they fail. Async insert buffers the inserts into a single part.
9. **Codec pipeline.** A timestamp column passes through Delta and becomes small numbers, then ZSTD shrinks it. Show bytes at each stage (2.24 GiB to 24.55 MiB).
10. **LowCardinality.** A string column `['US','DE','US','FR',…]` becomes a dictionary {0:US,1:DE,2:FR} plus a UInt8 index column.
11. **Nullable.** Two files are written side by side: values plus a null-map of 0/1 bytes.
12. **JSON.** One JSON document is split into per-path subcolumns. Path number 1025 overflows into shared data.

## Puzzle ideas (concrete numbers)

- **Shard routing:** 3 shards with weights 1, 1, 2 and `sharding_key = user_id`. Which shard gets user_id 10? Total weight 4, `10 % 4 = 2`, which falls in shard 3's range [2,4), so the answer is shard 3.
- **Quorum:** 3 replicas, `insert_quorum='auto'`. How many acks are needed? `3/2+1 = 2`.
- **Keeper sizing:** How many Keeper node failures can a 5-node ensemble tolerate? 2. A 4-node ensemble? 1 (so prefer odd sizes).
- **TTL lag:** Rows expire at 12:00 and the last TTL merge ran at 11:30. With `merge_with_ttl_timeout=14400`, what is the earliest the next TTL merge can run? 15:30.
- **Too many parts:** A client sends 50 single-row inserts per second into one partition, and merges reduce the part count by 40 per second. When is the 3,000 limit hit (starting at 0)? (50-40)=10 per second, so 300 s. The fix is batching or async insert.
- **Delete choice:** Remove one month from a 5-year table partitioned by `toYYYYMM`. Options: ALTER DELETE, DELETE FROM, DROP PARTITION. Answer: DROP PARTITION.
- **Type picker:** age (0–120) is UInt8. HTTP status is UInt16 or LowCardinality. country (about 200 values) is LowCardinality(String). user_agent (millions of values) is String, not LowCardinality.
- **Codec match:** monotonic timestamps go with DoubleDelta+ZSTD. Sensor floats go with Gorilla, or try plain ZSTD. Small ints in a UInt64 go with T64+ZSTD. Random UUIDs: none of these help.
- **Version trivia:** "In 26.9, what is the codec of a freshly inserted 5 MB part with no CODEC clause?" LZ4. "And after it merges into a 200 MB part?" ZSTD(3).
- **Async insert flush:** Each insert is 1 KB at 100 inserts per second, with 10 MiB, 200 ms and 450-query limits. Which limit triggers first? About 200 ms (adaptive), which is about 20 queries and 20 KB.

## Sources

- [S1] https://clickhouse.com/docs/engines/table-engines/mergetree-family/replication
- [S2] https://clickhouse.com/docs/guides/sre/keeper/clickhouse-keeper
- [S3] https://clickhouse.com/docs/engines/table-engines/special/distributed
- [S4] https://github.com/ClickHouse/ClickHouse/blob/master/src/Storages/MergeTree/MergeTreeSettings.cpp ; https://clickhouse.com/docs/operations/settings/merge-tree-settings
- [S5] https://github.com/ClickHouse/ClickHouse/blob/master/src/Core/Settings.cpp ; https://clickhouse.com/docs/operations/settings/settings
- [S6] https://github.com/ClickHouse/ClickHouse/pull/97590
- [S7] https://clickhouse.com/docs/whats-new/changelog (26.9 entries) ; https://clickhouse.com/docs/resources/changelogs/oss/2026
- [S8] https://github.com/ClickHouse/ClickHouse/blob/master/src/Storages/CompressionCodecSelector.h ; https://github.com/ClickHouse/ClickHouse/blob/master/src/Compression/CompressionFactory.cpp
- [S9] https://clickhouse.com/docs/cloud/reference/shared-merge-tree
- [S10] https://clickhouse.com/docs/guides/developer/ttl
- [S11] https://clickhouse.com/docs/engines/table-engines/mergetree-family/mergetree (storage policies, TTL)
- [S12] https://clickhouse.com/docs/sql-reference/statements/alter
- [S13] https://clickhouse.com/docs/sql-reference/statements/alter/update
- [S14] https://clickhouse.com/docs/guides/developer/lightweight-delete
- [S15] https://clickhouse.com/blog/clickhouse-release-23-03
- [S16] https://clickhouse.com/docs/sql-reference/statements/update
- [S17] https://clickhouse.com/blog/clickhouse-release-25-07 ; https://clickhouse.com/blog/updates-in-clickhouse-2-sql-style-updates
- [S18] https://clickhouse.com/blog/updates-in-clickhouse-3-benchmarks
- [S19] https://clickhouse.com/docs/deletes/overview
- [S20] https://clickhouse.com/docs/reference/statements/create/table/codec
- [S21] https://clickhouse.com/docs/best-practices/selecting-an-insert-strategy
- [S22] https://clickhouse.com/docs/operations/system-tables/replicas
- [S23] https://clickhouse.com/docs/architecture/replication ; https://clickhouse.com/docs/products/kubernetes-operator/guides/configuration ; https://clickhouse.com/docs/reference/system-tables/replication_queue
- [S24] https://clickhouse.com/docs/sql-reference/distributed-ddl
- [S25] https://clickhouse.com/docs/engines/database-engines/replicated
- [S26] https://clickhouse.com/docs/deployment-guides/parallel-replicas
- [S27] https://clickhouse.com/docs/guides/developer/deduplication
- [S28] https://clickhouse.com/docs/optimize/asynchronous-inserts
- [S29] https://clickhouse.com/docs/guides/developer/deduplication
- [S30] https://clickhouse.com/docs/engines/table-engines/integrations/kafka
- [S31] https://clickhouse.com/docs/engines/table-engines/integrations/s3queue
- [S32] https://clickhouse.com/docs/integrations/clickpipes
- [S33] https://clickhouse.com/docs/sql-reference/data-types/lowcardinality
- [S34] https://clickhouse.com/blog/optimize-clickhouse-codecs-compression-schema
- [S35] https://clickhouse.com/docs/sql-reference/data-types/nullable
- [S36] https://clickhouse.com/docs/data-compression/compression-in-clickhouse
- [S37] https://clickhouse.com/docs/sql-reference/data-types/newjson
- [S38] https://clickhouse.com/docs/sql-reference/data-types/variant
- [S39] https://clickhouse.com/docs/sql-reference/data-types/dynamic
- [S40] https://clickhouse.com/docs/operations/system-tables/part_log
- [S41] https://github.com/ClickHouse/ClickHouse/blob/master/programs/server/config.xml

### Unverified / caveats
- **[unverified]** The exact failure mode of `internal_replication=false` combined with ReplicatedMergeTree (double writes) is widely documented but was not quoted from an official page here.
- **[unverified]** The status of the Replicated database engine: the docs page does not call it experimental, but no explicit GA version was found.
- The `insert_deduplicate` docstring still says "only 100 of the most recent blocks", but `replicated_deduplication_window` is 10000 in source. Trust the source.
- The docs pages for async inserts and codecs lag the source (they still say async inserts are off, 100 MiB, LZ4 default). Teach the source/changelog values and tie each to a version.
- Puzzle shard math assumes the documented remainder-over-total-weight rule; check the boundary convention before shipping.
