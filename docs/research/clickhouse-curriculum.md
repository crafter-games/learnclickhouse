# ClickHouse curriculum research

Compiled 2026-10-02 against **ClickHouse 26.9** (stable, released 2026-09-21) and **26.8 LTS** (2026-08-27). Defaults were read from `master` source (`src/Core/Settings.cpp`, `src/Storages/MergeTree/MergeTreeSettings.cpp`, `src/Core/Defines.h`). Each setting there carries its own change history (`{"version", old, new, "reason"}`), which is the authoritative "changed in" record. Items marked **[unverified]** must be checked before they appear in game content. Source keys like [S1] point to the list at the end.

> **The docs lag the source in 2026. Teach the source and changelog values, and tie each to a version:**
> - `async_insert` defaults to **1 since 26.2** (`{"26.2", false, true}` in Settings.cpp). Several docs pages still say async inserts are off.
> - The default codec changed in **26.9**: MergeTree column data uses **LZ4 below 100 MB and ZSTD(3) at or above** (judged at write time, so merges promote parts to ZSTD). Network compression is ZSTD(3). The CREATE TABLE/codec pages still say "LZ4". Cloud uses ZSTD(1).
> - `async_insert_max_data_size` is **10 MiB in OSS**, and 100 MiB is the Cloud value the docs quote.
> - `old_parts_lifetime` is **480 s**, not the "about 10 minutes" in the partitioning docs.
> - The new analyzer **can't be turned off since 26.9**.
>
> The game teaches open-source ClickHouse 26.x, and adds a "Cloud note" wherever Cloud differs (SharedMergeTree, ZSTD(1), 1 GiB wide-part threshold, 100 MiB async buffer, synchronous Distributed inserts).

## Version timeline

Cadence: stable releases come roughly monthly (the 3 latest are supported). LTS releases come twice a year, always **YY.3 and YY.8**, with 1 year of support [S19][S20].

| Version | Milestone |
|---|---|
| 21.11 | ClickHouse Keeper production-ready (replaces ZooKeeper) |
| 23.3 LTS (Mar 2023) | **Lightweight DELETE** GA (`_row_exists` mask) |
| 23.5 | Marks and primary key compressed by default |
| 23.6 | "Too many parts" relaxed: `parts_to_throw_insert` 300 → **3000** |
| 23.12 | Refreshable MVs introduced |
| 24.2 | Primary key loaded lazily; adaptive async-insert timeout; async buffer 1 MB → 10 MiB |
| 24.3 LTS | **New analyzer on by default** |
| 24.8 LTS | Projections on Replacing/Collapsing tables throw by default; experimental JSON type |
| 24.10 | **Refreshable MVs production-ready**; parallel replicas Beta |
| 24.12 | `join_algorithm` default → `direct,parallel_hash,hash`; planner may swap join sides |
| 25.3 LTS (Mar 2025) | **JSON, Variant, Dynamic** production-ready; query condition cache introduced |
| 25.4 | **Query condition cache** and **lazy materialization** on by default |
| 25.6 | CoalescingMergeTree; `_part_offset` projections prune like secondary indexes |
| 25.7 / 25.8 LTS | **Lightweight UPDATE (patch parts)**: experimental → **Beta**; vector similarity index GA |
| 25.9 / 25.12 | Automatic multi-table join reordering (limit 10 tables, statistics on) |
| 26.2 (Feb 2026) | **`async_insert=1` by default**; insert dedup on for all inserts; **text (full-text) index GA** |
| 26.3 LTS | Column statistics GA |
| 26.5 | Hash joins spill to disk by default (`max_bytes_ratio_before_external_join=0.5`) |
| 26.8 LTS (Aug 2026) | Patch parts v2 format; `ie_join` added to the default join list |
| 26.9 (Sep 2026) | **Default codec ZSTD(3)** (size-aware for MergeTree); analyzer mandatory; `REFRESH … APPEND INCREMENTAL` |

## Worlds, concepts, configs, misconceptions

Order validated against the ClickHouse Academy "Real-time Analytics" path (intro → architecture → inserts → modeling → analyzing → joins → updates/deletes → acceleration → sharding/replication → managing data) [D1] and the docs' Best Practices list [D2].

### World 1 — Columns
| Concept | Definition | Configs / defaults | Misconception |
|---|---|---|---|
| Columnar layout | In a **Wide** part each column is its own file (`col.bin` + marks `col.cmrk2`). A query opens only the columns it names [S3][S14] | — | "ClickHouse reads the whole row, then picks columns" |
| Why 3 of 100 is cheap | Bytes read ≈ compressed blocks of the 3 referenced columns for the selected granules; the other 97 files are never opened [S3] | — | "SELECT * costs the same as SELECT a" |
| Compression per column | Each column is compressed alone, in blocks of 64 KiB–1 MiB. Similar values side by side compress far better than mixed rows [S1] | `min_compress_block_size=65536`, `max_compress_block_size=1048576`. Codec: LZ4 < 100 MB, ZSTD(3) ≥ 100 MB (26.9+) | "ClickHouse always uses LZ4" (outdated since 26.9) |
| Sorting helps compression | Sorting puts equal values together: docs example 50.16 → 25.15 GiB; UserID ratio 3:1 → 39:1 after reordering the key [S16][S3] | — | "Compression doesn't depend on ORDER BY" |
| Compact vs Wide part | Small parts store all columns in one file (Compact); merges turn them Wide [S2] | `min_bytes_for_wide_part`=10 MiB OSS (1 GiB Cloud) | "Every part is one file per column" |
| OLAP vs OLTP | Built for scanning and aggregating many rows, not point updates or row-by-row writes | — | "It's a faster Postgres" |

### World 2 — Inserts, Parts & Merges
| Concept | Definition | Configs / defaults | Misconception |
|---|---|---|---|
| Part | Each INSERT block creates ≥ 1 **immutable** part per partition it touches: a folder with column files, marks, `primary.cidx`, `minmax_*.idx`, `checksums.txt`… [S14] | `max_insert_block_size`=1,048,449 rows | "INSERT appends to a file / updates in place" |
| Part name | `partition_minBlock_maxBlock_level[_mutation]`, e.g. `all_1_1_0` (fresh) → `all_1_9_2` (merged); level = merge depth [S13] | — | "Level = number of parts merged" |
| Background merge | Picks a **contiguous** run of parts in one partition: decompress → merge-sort → rebuild index → compress → new part. Old parts become outdated [S9] | up to 100 parts per merge; max result 150 GiB; 16 × 2 = 32 concurrent merges/mutations; `old_parts_lifetime`=480 s | "Merges must be triggered with OPTIMIZE"; "everything ends in one part" |
| Too many parts | Too many active parts **per partition**: inserts are delayed, then rejected (`TOO_MANY_PARTS`) [S2][S21] | `parts_to_delay_insert`=1000, `parts_to_throw_insert`=3000 (300 before 23.6), `max_parts_in_total`=100,000 | "Raise the limit to fix it" |
| Batching | ≥ 1,000 rows per insert, ideally **10k–100k**, about **1 insert/s** [S12b] | — | "Row-by-row inserts are fine like OLTP" |
| Async inserts | The server buffers small inserts and flushes one part at the first limit hit: size, time or query count [S12] | **`async_insert=1` since 26.2**, `wait_for_async_insert=1`, 10 MiB, 200 ms max (adaptive, 50 ms min), 450 queries | "`wait_for_async_insert=0` is fast *and* safe" (fire-and-forget; errors only in logs) |
| Insert deduplication | A retried identical **block** is dropped if its hash is still in the window [S2] | `deduplicate_insert=enable` (26.2, all inserts); `replicated_deduplication_window`=10,000 blocks / 3600 s; plain MergeTree: `non_replicated_deduplication_window=0` (off) | "Dedup = uniqueness by primary key" |

### World 3 — ORDER BY & the Sparse Index
| Concept | Definition | Configs / defaults | Misconception |
|---|---|---|---|
| Sorting key | `ORDER BY` sets the row order **inside each part**, not across the table [S3] | — | "The table is globally sorted" |
| Granule | Smallest unit read: up to 8192 rows (adaptive, also capped by bytes) [S2] | `index_granularity=8192`, `index_granularity_bytes`=10 MiB | "The index finds individual rows" (it always reads whole granules) |
| Sparse primary index | One entry per **granule** (first row's key values). Docs: 8.87 M rows → **1083 granules** → 96.93 KiB index, fully in memory [S3] | `primary_key_lazy_load=true` (24.2) | "It's a B-tree with one entry per row" |
| Marks | Per column and granule: (offset of the compressed block, offset inside it), so a reader can seek to granule N [S3] | `.cmrk2` (compressed since 23.5) | "Marks = the primary index" (index holds key values, marks hold file offsets) |
| First vs later key column | Filter on the 1st column → binary search (**1/1083** granules). Filter on the 2nd column → generic exclusion (**1076/1083**) unless the 1st column has low cardinality [S3] | — | "Every ORDER BY column is equally indexed" |
| Key column order | Put **lower-cardinality columns first**: helps pruning on later columns and compression [S3] | — | "Most selective column first, like B-tree databases" |
| PRIMARY KEY | Defaults to ORDER BY; if given, it must be a prefix. **Not unique**: duplicates are allowed [S14] | — | "PRIMARY KEY enforces uniqueness" |
| EXPLAIN indexes = 1 | Shows `Parts x/y`, `Granules x/y` per stage: MinMax → Partition → PrimaryKey → Skip. Docs: `11/12` → `6/10` → `2/6` [S10b] | — | — |
| LIMIT | `LIMIT 1` with ORDER BY on a non-key column still reads every granule [D4] | lazy materialization (25.4) defers wide columns up to LIMIT 10,000 | "LIMIT makes the scan short" |

### World 4 — Partitions
| Concept | Definition | Configs / defaults | Misconception |
|---|---|---|---|
| Purpose | A **data-management** unit: drop, move or archive whole chunks (`DROP/DETACH/ATTACH/MOVE/REPLACE PARTITION`, TTL, tiering) [S13a] | "In most cases you don't need a partition key"; if time-based, **monthly** | "Partitioning speeds up queries" (docs: it does not; ORDER BY does) |
| Merge boundary | Parts **never merge across partitions**; part limits apply per partition [S13] | — | — |
| Partition pruning | Each part stores `minmax_<col>.idx`; parts that can't match are skipped. Docs: 436 → 1 parts, 3,257 → 11 granules [S13a] | — | "You must name the partition ID to prune" |
| Over-partitioning | One insert block touching N partitions creates N parts; > 100 partitions in a block throws [S1] | `max_partitions_per_insert_block=100`; keep total partitions under ~1,000–10,000 | "Daily or hourly partitions (or by customer) are better" |
| DROP PARTITION | Metadata operation: the cheapest delete there is [S19] | — | — |

### World 5 — Merge-time Engines
| Concept | Definition | Configs / defaults | Misconception |
|---|---|---|---|
| ReplacingMergeTree(ver, is_deleted) | Rows with equal **ORDER BY** key collapse to one (max `ver`, or the last inserted) **only when their parts merge**, and only within a partition [B18] | — | "Duplicates never show up in SELECT" |
| FINAL | Merges at query time; parallel, much improved, cost grows with data not filtered by the key [B20] | `do_not_merge_across_partitions_select_final=0`; guide: 2.34 s → 0.99 s with partitions | "FINAL is unusable" / "put FINAL everywhere" |
| argMax pattern | `argMax(col, ver) … GROUP BY key` gets the latest version without FINAL **[unverified: exact docs wording]** | — | — |
| SummingMergeTree | On merge, sums numeric columns per key; a row whose sums are all 0 is deleted. Query with `sum() GROUP BY` [B21] | — | "SELECT * already returns totals" |
| AggregatingMergeTree | Stores aggregate **states**: insert with `-State`, read with `-Merge`; `SimpleAggregateFunction` for sum/min/max/any [B22] | — | "You can SELECT the state column directly" |
| CollapsingMergeTree(sign) | `+1` state row, `-1` cancel row; pairs cancel on merge. VersionedCollapsing allows any insert order [B23][B24] | — | — |
| CoalescingMergeTree | (25.6) Per column, keeps the latest non-NULL value — column-level upserts [B25] | — | "Replacing keeps the latest value per column" (it keeps whole rows) |

### World 6 — Changing & Expiring Data
| Concept | Definition | Configs / defaults | Misconception |
|---|---|---|---|
| Mutations | `ALTER … UPDATE/DELETE` **rewrite whole parts**, asynchronously, in order, only for parts that existed at submit time; tracked in `system.mutations` [C12] | `mutations_sync=0`; key columns can't be updated | "UPDATE/DELETE are cheap like in Postgres"; "the ALTER returned, so it's done" |
| Lightweight DELETE | `DELETE FROM` sets a hidden `_row_exists` mask; rows are hidden at once and removed by later merges. GA 23.3 [C14] | `lightweight_deletes_sync=2`; throws on tables with projections by default | "It frees disk immediately" |
| Lightweight UPDATE | `UPDATE … SET` writes a small **patch part**, applied on read and absorbed by merges. **Beta** since 25.8 [C16][C17] | `enable_lightweight_update=true`; aimed at ≤ ~10% of a table; ~1,600× faster than a mutation in the benchmark (60 ms vs 100 s) | "UPDATE is GA" (still Beta in 26.9) |
| Row/column TTL | Applied **during merges**, not at the expiry instant [C10] | `merge_with_ttl_timeout`=14400 s (4 h) | "Rows vanish exactly when they expire" |
| TTL actions | `DELETE`, `TO DISK/VOLUME` (moves whole parts), `GROUP BY` (rollup), `RECOMPRESS` [C10][C11] | `ttl_only_drop_parts=0` | — |
| Tiered storage | Disks → volumes → policy; parts move to the next volume when free space < `move_factor`; S3 disks supported [C11] | `move_factor=0.1` | — |

### World 7 — Skipping Indexes & Projections
| Concept | Definition | Configs / defaults | Misconception |
|---|---|---|---|
| Skip index | A per-*index-granule* summary that lets the reader skip blocks that **can't** match. Matched granules are still read fully [B1] | `use_skip_indexes=1`; default `GRANULARITY 1` | "It's a secondary index that finds rows" |
| GRANULARITY | Index granule = N primary granules (GRANULARITY 4 → 32,768 rows) [B1] | — | "GRANULARITY is in rows" |
| minmax / set(N) / bloom_filter | Range per block / up to N distinct values / probabilistic membership (FPR 0.025) [B2] | — | — |
| Correlation rule | "A useful skip index requires a strong correlation between the primary key and the targeted column." Random spread → nothing skipped, you still pay [B1] | — | "Adding indexes always helps" |
| ADD vs MATERIALIZE | `ADD INDEX` covers new parts only; `MATERIALIZE INDEX` (a mutation) builds it for old parts [B1] | — | "ADD INDEX speeds up old data instantly" |
| text index | Inverted index (token → rows). **GA 26.2**; `tokenbf_v1`/`ngrambf_v1` deprecated (version **[unverified]**) [B3][B5] | — | "ClickHouse can't do full-text search" |
| vector_similarity | HNSW ANN index, **GA 25.8**; approximate results [B4] | — | — |
| Projection | A hidden table **inside each part** with another ORDER BY or a pre-aggregation; the optimizer picks whichever reads the fewest marks [B8] | `optimize_use_projections=1`; `_part_offset` projections (25.5/25.6) act as secondary indexes | "You query a projection by name"; "it's free" (double writes, disk) |
| Query condition cache | Remembers per (part, filter) a **bit per granule**: 0 = no match. Repeated filters skip zeros (99.46 M → 2.16 M rows) [B30] | on by default since 25.4; 100 MB | "It caches results" (that's the query cache, off by default) |

### World 8 — Materialized Views & Ingestion
| Concept | Definition | Configs / defaults | Misconception |
|---|---|---|---|
| Incremental MV | "Just a trigger that runs a query on blocks of data as they're inserted." Sees **only the inserted block**; updates, deletes and drops on the source change nothing [B10][B11] | `parallel_view_processing=0` | "An MV is a cached query that stays in sync" |
| TO target | Rows go to a table you own, usually Summing/AggregatingMergeTree → several partial rows per key until merge [B10] | — | "One row per key in the target" |
| MV + JOIN | Fires only on inserts into the **left-most** table; changing the dimension table does nothing [B10] | — | "Updating the dimension refreshes the MV" |
| Backfill | Creating an MV doesn't process old rows; `POPULATE` can miss rows → use `INSERT INTO target SELECT …` [B12] | — | "Creating an MV processes history" |
| Refreshable MV | Re-runs the full query on a schedule (`REFRESH EVERY/AFTER`), atomically replacing the target or `APPEND`. Prod-ready 24.10 [B11][B17] | `refresh_retries=2` | "Refreshable MVs are incremental" (only with `APPEND INCREMENTAL`, 26.9) |
| Kafka engine | A Kafka table is a **consumer**, not storage: Kafka table → MV → MergeTree; at-least-once [C30] | — | "The Kafka table stores messages" |
| Formats | Native (columnar, fastest), RowBinary, JSONEachRow (easy, expensive to parse), Parquet, CSV [C21] | — | — |

### World 9 — Query Execution & JOINs
| Concept | Definition | Configs / defaults | Misconception |
|---|---|---|---|
| Vectorized execution | Operators work on blocks of column arrays, not row by row [B27] | `max_block_size=65409` | "Processes row by row" |
| Parallelism | Granule ranges spread across threads | `max_threads` = number of cores | — |
| PREWHERE | Reads the filter columns first, the rest only for blocks with a match; moved automatically from WHERE [B28] | `optimize_move_to_prewhere=1` | "You must write PREWHERE by hand" |
| Lazy materialization | For `ORDER BY … LIMIT n`, reads wide columns only for the top-n rows (219 s → 0.139 s) [B29] | on since 25.4; cap LIMIT 10,000 (25.12) | — |
| query_log | `read_rows`, `read_bytes`, `memory_usage`, `query_duration_ms` per query [B13] | — | — |
| Default join | `join_algorithm=direct,parallel_hash,hash,ie_join`; plain `hash` if the build side is estimated < 100,000 rows [S1] | changed in 24.12 and 26.8 | "The default is hash" |
| Hash join | The build side becomes an in-memory hash table and the other side probes it; spills to disk at 50% of memory since 26.5 [B32][S1] | `max_bytes_ratio_before_external_join=0.5` | "The right table must fit in RAM" (no longer strictly) |
| Join order | Since 24.12 the planner may swap sides; since 25.9 it reorders up to 10 tables using statistics (TPC-H 3,903 s → 2.7 s) [B33] | `query_plan_join_swap_table='auto'` | "Always put the small table on the right" (legacy rule) |
| Dictionaries | In-memory key → attributes maps (`dictGet`), reloaded every `LIFETIME` [B34] | — | "Dictionaries are always fresh" |
| IN vs JOIN | `IN` builds a set; often cheaper than a JOIN for filtering [B35] | — | — |

### World 10 — Types & Codecs
| Concept | Definition | Configs / defaults | Misconception |
|---|---|---|---|
| Smallest type | UInt8/16 instead of Int64, Date/DateTime instead of String, Enum8: one example went 131.58 → 35.34 GiB uncompressed [C34] | — | — |
| LowCardinality(T) | Dictionary encoding (small index per row). Good below **10k** distinct values; can be worse above **100k** [C33] | — | "Use it on every String" |
| Nullable(T) | An extra null-map file; almost always slower; not allowed in keys by default [C35] | `allow_nullable_key=0` | "NULL is free" |
| Codecs | Delta, DoubleDelta (monotonic timestamps), Gorilla/FPC (floats), T64 (crops unused bits), chained with ZSTD: `CODEC(Delta, ZSTD)` [C20] | bare `ZSTD` = level 1 | "Gorilla is always best for floats" (plain ZSTD won in the blog test; levels > 3 gave little) |
| Ratios | Date column with Delta+ZSTD: 2.24 GiB → 24.55 MiB; Stack Overflow table 2.86× [C34][C36] | `system.columns` compressed/uncompressed bytes | — |
| JSON | Each path becomes its own columnar subcolumn; extra paths overflow to shared data. GA 25.3 [C37] | `max_dynamic_paths=1024`, `max_dynamic_types=32` | "JSON is stored as a text blob" |

### World 11 — Replication & Sharding
| Concept | Definition | Configs / defaults | Misconception |
|---|---|---|---|
| ReplicatedMergeTree | Insert on any replica → it writes the part and logs it in Keeper → other replicas **fetch** the part. "Asynchronous and multi-master" [C1] | an insert waits for 1 replica | "Replication is synchronous"; "one leader takes writes" |
| ClickHouse Keeper | Raft coordination (ZooKeeper protocol): metadata, replication log, dedup hashes, DDL queue — **not data** [C2] | ≥ 3 nodes (2F+1) | "Keeper stores the data" |
| insert_quorum | Insert waits for N replicas [C5] | `insert_quorum=0` (off), `'auto'` = majority; timeout 600 s | "Quorum makes reads consistent" (also needs `select_sequential_consistency=1`) |
| Distributed table | A routing view over shards: no data of its own. Rows go to a shard by `sharding_key % total weight` [C3] | OSS insert is **background** (`distributed_foreground_insert=0`); Cloud = 1 | "The Distributed table stores data" |
| internal_replication | `true` writes one replica per shard and lets replication copy the rest [C3] | default `false` (use `true` with Replicated tables) | — |
| ON CLUSTER | DDL queued in Keeper, executed eventually by each host [C24] | `distributed_ddl_task_timeout=180` | "ON CLUSTER is atomic" |
| SharedMergeTree (Cloud) | Shared object storage + Keeper metadata; stateless compute; scale by adding replicas, no sharding needed [C9] | all inserts are quorum inserts | "You must design shards in Cloud" |
| Parallel replicas | One query's granules split across replicas of a shard. Beta since 24.10, opt-in [C26] | `enable_parallel_replicas=0` | "More replicas speed up every query" |

## Top beginner mistakes (for "diagnose the symptom" and trap levels)

From the official "13 mistakes" post [D3] plus docs and community sources [D4]:
1. Too many parts from tiny inserts or fine-grained partitions.
2. Partition key used as an index (by user_id, by day).
3. Poor ORDER BY (high cardinality first, not matching filters).
4. "PRIMARY KEY means unique."
5. Expecting ReplacingMergeTree to dedupe immediately; overusing FINAL.
6. Mutations for routine updates/deletes.
7. Expecting MVs to see old data, updates or dimension changes.
8. Piling on skip indexes that prune nothing.
9. Misunderstanding insert deduplication (block hash, retries).
10. Expecting LIMIT to stop a scan; OLTP-style point lookups.
11. Nullable everywhere; String for everything.
12. JOIN-heavy relational models; sharding too early; replicas read-only when Keeper struggles.

## Visualizable mechanics (simulation backlog)

This is the section that decides the game type. ClickHouse is about **shape and amount of data read**, so most mechanics are spatial: blocks appearing, fusing, lighting up or greying out, with a counter.

1. **Rotate the table**: rows slice into column strips (opening cinematic); `SELECT a,b,c` lights up 3 strips out of N, with a bytes-read counter.
2. **Compression shrink**: a strip of mixed values vs a sorted strip; sorted shrinks more. Codec pipeline: timestamps → Delta → small numbers → ZSTD.
3. **Insert → part spawn**: each INSERT drops a block `all_N_N_0`, sized by rows; tiny blocks are Compact, big ones Wide (stacked column strips).
4. **Merge**: a contiguous run of blocks in one lane fuses into `all_min_max_(level+1)`; old blocks fade (outdated) and disappear. Blocks stop growing at a cap.
5. **Too many parts**: a per-partition meter (green < 1000, slow 1000–3000, rejected ≥ 3000). Inserts faster than merges fill the board. **Async insert** = a buffer hopper that flushes one block per 200 ms / 10 MiB / 450 queries.
6. **2048-style merge board**: same-size parts combine; a full board = TOO_MANY_PARTS. Partitions are separate boards that never mix.
7. **Granules & sparse index**: a column cut into 8192-row granules with one index flag per granule; a binary-search pointer jumps on a first-key filter; a second-key filter lights up nearly everything (1/1083 vs 1076/1083).
8. **Reorder the key**: drag ORDER BY columns into order; granules read and compressed size update live.
9. **EXPLAIN funnel**: MinMax → Partition → PrimaryKey → Skip, `Granules 11/12 → 6/10 → 2/6`.
10. **Partition lanes**: parts live in lanes; partition pruning dims whole lanes; "PARTITION BY user_id" explodes into hundreds of lanes and trips the 100-partitions guard; DROP PARTITION removes a lane instantly.
11. **Replacing dedupe after merge**: three rows `id=7` (ver 1/2/3) in three parts → SELECT shows 3 → merge → 1. FINAL does it at read time with a visible CPU cost.
12. **Collapsing ±1 annihilation**; **Summing** totals shrinking to one row; zero-sum rows vanishing; **Aggregating** state blobs fusing.
13. **Mutation vs lightweight DELETE vs patch part vs DROP PARTITION**: a whole block rewritten (heavy) / bits flipped in `_row_exists` / a thin overlay block / a lane removed.
14. **TTL timeline**: parts age along a conveyor: hot → cold → S3 → deleted, but only when the next TTL merge fires (up to 4 h late).
15. **Skip index per block**: minmax boxes tight on a correlated column, full-width on a random one; bloom filter bits with a false positive; a GRANULARITY slider.
16. **Projection choice**: the query compares marks-to-read for the base order vs a projection and takes the cheaper path; the projection lives as a hidden folder inside every part.
17. **Query condition cache**: the first run writes a 0/1 bit per granule; the second run skips the zeros.
18. **MV as a tap on the insert pipe**: only the new block flows through the MV; old rows sit upstream, untouched; the target shows several partial rows per key until a merge.
19. **PREWHERE / lazy materialization**: read the thin filter column first, then fetch wide columns only for surviving granules / the top-n rows.
20. **Hash join**: the build side streams into buckets, the other side probes; a memory bar spills to disk at 50%.
21. **Replication**: insert on replica A → GET_PART entry in the Keeper log → B and C fetch; B offline then catching up; quorum spinner.
22. **Shard routing**: `user_id % total weight` sends rows to shards; the Distributed table holds no data, and its background queue empties after the insert returns.
23. **Types**: LowCardinality turns a string column into a dictionary + tiny index column; Nullable writes a second null-map file; JSON paths split into subcolumns.

### Puzzle numbers (all from docs/source)
| Number | Meaning |
|---|---|
| 8192 rows | one granule |
| 8.87 M rows → 1083 granules | docs sample; index 96.93 KiB |
| 1/1083 vs 1076/1083 | granules read: first vs second key column |
| 436 → 1 parts, 3,257 → 11 granules | partition pruning example |
| 11/12 → 6/10 → 2/6 | EXPLAIN funnel example |
| 100 M rows, set(100) → 32,768 rows read | skip index example |
| 1000 / 3000 / 100,000 | delay / throw parts per partition / total parts |
| 150 GiB, 100 parts | merge size cap, max parts per merge |
| 10k–100k rows, ~1/s | batch guidance |
| 200 ms / 10 MiB / 450 | async flush limits |
| 480 s | old parts lifetime |
| 100 MB | LZ4 → ZSTD(3) switch (26.9) |
| 4 h | TTL merge interval |
| 100,000 rows | `hash` vs `parallel_hash` threshold |
| 50 single-row inserts/s vs 40 merged/s → 300 s | time to hit 3000 parts |

## Inspiration (what exists)

- **systeminternals.dev/clickhouse** [D5]: the closest thing — a sandbox with INSERT / merge buttons, part counters and a granule-skipping demo. It has no goals, constraints or scoring. **That gap is ours.**
- Official visual vocabulary to stay faithful to: column strips, parts as boxes, granules with mark flags, greyed-out skipped granules, a merge tree growing up to a cap, partitions as lanes, Keeper log + fetch arrows [D6][D7].
- Mechanics worth borrowing: a 2048-style merge board (nobody has published it as an LSM analogy), Learn Git Branching's "ghost of the goal state", Zachtronics histograms of your metric (rows/granules read), Factorio belts for insert/MV pipelines, The Secret Lives of Data's narrated steps for Raft/replication, SQL Murder Mystery's case framing [D8].

## Sources

- [S1] Settings.cpp (master, 2026-10-02): https://github.com/ClickHouse/ClickHouse/blob/master/src/Core/Settings.cpp
- [S2] MergeTreeSettings.cpp: https://github.com/ClickHouse/ClickHouse/blob/master/src/Storages/MergeTree/MergeTreeSettings.cpp
- [S3] Sparse primary indexes guide: https://clickhouse.com/docs/guides/best-practices/sparse-primary-indexes
- [S5] Changelog 2026: https://clickhouse.com/docs/whats-new/changelog , https://github.com/ClickHouse/ClickHouse/blob/master/CHANGELOG.md
- [S6] Changelog 2023: https://clickhouse.com/docs/whats-new/changelog/2023 · [S7] 2024: …/changelog/2024 · [S8] 2025: …/changelog/2025
- [S9] Merges: https://clickhouse.com/docs/merges
- [S10b] EXPLAIN: https://clickhouse.com/docs/sql-reference/statements/explain
- [S12] Async inserts: https://clickhouse.com/docs/optimize/asynchronous-inserts · [S12b] Bulk inserts: https://clickhouse.com/docs/optimize/bulk-inserts
- [S13] Custom partitioning key: https://clickhouse.com/docs/engines/table-engines/mergetree-family/custom-partitioning-key · [S13a] Partitions: https://clickhouse.com/docs/partitions
- [S14] MergeTree: https://clickhouse.com/docs/engines/table-engines/mergetree-family/mergetree · Parts: https://clickhouse.com/docs/parts
- [S16] Compression: https://clickhouse.com/docs/data-compression/compression-in-clickhouse
- [S19] Production versions FAQ: https://clickhouse.com/docs/faq/operations/production · Deletes overview: https://clickhouse.com/docs/deletes/overview
- [S20] Releases: https://github.com/ClickHouse/ClickHouse/releases
- [S21] Too many parts: https://clickhouse.com/docs/knowledgebase/exception-too-many-parts
- [B1] Skipping indexes: https://clickhouse.com/docs/optimize/skipping-indexes · [B2] index types: see [S14]
- [B3] Text index: https://clickhouse.com/docs/engines/table-engines/mergetree-family/invertedindexes · [B5] GA blog: https://clickhouse.com/blog/full-text-search-ga-release
- [B4] Vector index: https://clickhouse.com/docs/engines/table-engines/mergetree-family/annindexes
- [B8] Projections: https://clickhouse.com/docs/data-modeling/projections
- [B10] Incremental MVs: https://clickhouse.com/docs/materialized-view/incremental-materialized-view · [B11] CREATE VIEW: https://clickhouse.com/docs/sql-reference/statements/create/view · [B12] Backfilling: https://clickhouse.com/docs/data-modeling/backfilling
- [B13] query_log: https://clickhouse.com/docs/operations/system-tables/query_log
- [B17] 24.10 release: https://clickhouse.com/blog/clickhouse-release-24-10
- [B18] ReplacingMergeTree: https://clickhouse.com/docs/engines/table-engines/mergetree-family/replacingmergetree · guide https://clickhouse.com/docs/guides/replacing-merge-tree
- [B20] FINAL: https://clickhouse.com/docs/sql-reference/statements/select/from
- [B21] Summing · [B22] Aggregating · [B23] Collapsing · [B24] VersionedCollapsing · [B25] Coalescing: https://clickhouse.com/docs/engines/table-engines/mergetree-family/
- [B27] Architecture: https://clickhouse.com/docs/development/architecture
- [B28] PREWHERE: https://clickhouse.com/docs/sql-reference/statements/select/prewhere
- [B29] Lazy materialization: https://clickhouse.com/blog/clickhouse-gets-lazier-and-faster-introducing-lazy-materialization
- [B30] Query condition cache: https://clickhouse.com/blog/introducing-the-clickhouse-query-condition-cache
- [B32] JOIN: https://clickhouse.com/docs/sql-reference/statements/select/join · [B33] 25.9 release: https://clickhouse.com/blog/clickhouse-release-25-09
- [B34] Dictionaries: https://clickhouse.com/docs/sql-reference/dictionaries · [B35] IN: https://clickhouse.com/docs/sql-reference/operators/in
- [C1] Replication: https://clickhouse.com/docs/engines/table-engines/mergetree-family/replication
- [C2] Keeper: https://clickhouse.com/docs/guides/sre/keeper/clickhouse-keeper
- [C3] Distributed: https://clickhouse.com/docs/engines/table-engines/special/distributed
- [C5] Settings docs: https://clickhouse.com/docs/operations/settings/settings
- [C9] SharedMergeTree: https://clickhouse.com/docs/cloud/reference/shared-merge-tree
- [C10] TTL: https://clickhouse.com/docs/guides/developer/ttl · [C11] storage policies: see [S14]
- [C12] ALTER: https://clickhouse.com/docs/sql-reference/statements/alter · [C14] Lightweight DELETE: https://clickhouse.com/docs/guides/developer/lightweight-delete
- [C16] UPDATE: https://clickhouse.com/docs/sql-reference/statements/update · [C17] patch parts blog: https://clickhouse.com/blog/updates-in-clickhouse-2-sql-style-updates , benchmarks https://clickhouse.com/blog/updates-in-clickhouse-3-benchmarks
- [C20] Codecs: https://clickhouse.com/docs/reference/statements/create/table/codec · [C21] Insert strategy: https://clickhouse.com/docs/best-practices/selecting-an-insert-strategy
- [C24] Distributed DDL: https://clickhouse.com/docs/sql-reference/distributed-ddl · [C26] Parallel replicas: https://clickhouse.com/docs/deployment-guides/parallel-replicas
- [C30] Kafka engine: https://clickhouse.com/docs/engines/table-engines/integrations/kafka
- [C33] LowCardinality: https://clickhouse.com/docs/sql-reference/data-types/lowcardinality · [C34] Codecs blog: https://clickhouse.com/blog/optimize-clickhouse-codecs-compression-schema · [C35] Nullable: https://clickhouse.com/docs/sql-reference/data-types/nullable · [C36] see [S16] · [C37] JSON: https://clickhouse.com/docs/sql-reference/data-types/newjson
- [D1] ClickHouse Academy: https://clickhouse.com/learn/real-time-analytics · [D2] Best practices: https://clickhouse.com/docs/best-practices
- [D3] 13 mistakes: https://clickhouse.com/blog/common-getting-started-issues-with-clickhouse · [D4] community: see the 13-mistakes post and https://clickhouse.com/docs/guides/developer/deduplication
- [D5] https://systeminternals.dev/clickhouse/mergetree/ · [D6] Index-based pruning (Apr 2026): https://clickhouse.com/blog/index-based-pruning · [D7] https://clickhouse.com/docs/concepts/core-concepts/academic-overview
- [D8] https://learngitbranching.js.org · https://thesecretlivesofdata.com/raft/ · https://mystery.knightlab.com (cited from memory, not opened)

Full per-topic notes with every setting and its change history live in `docs/research/raw/` (storage, query, ops, inspiration). Corrections applied here: the latest LTS is **26.8** (raw/query.md says 26.3) and `async_insert=1` landed in **26.2** (raw/storage.md says 26.3), both checked against the GitHub releases and the Settings.cpp history.
