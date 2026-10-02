# Research A — ClickHouse storage fundamentals (as of 2026-10-02)

Method: defaults were read directly from ClickHouse `master` source on 2026-10-02 (`src/Core/Settings.cpp`, `src/Storages/MergeTree/MergeTreeSettings.cpp`, `src/Core/Defines.h`, `src/Core/ServerSettings.cpp`). The per-setting change history embedded in those files (the `{"version", old, new, "reason"}` tuples) was cross-checked against the official changelogs. Release dates come from the changelog headers and GitHub release tags. Source keys like [S1] point to the list at the end.

> **Heads-up for the game: the docs restructured their URLs in 2025–26.** Many `clickhouse.com/docs/...` paths now redirect to `/docs/reference/...` or `/docs/concepts/...`. The fetched/final URLs are given below.
>
> **Docs vs. source discrepancies found.** The source code wins in each case:
> 1. The async-insert guide says `async_insert_max_data_size` defaults to 100 MiB. Source: **10 MiB (10485760) in OSS**, 100 MiB is the **Cloud** default [S1][S12].
> 2. The partitioning page says inactive parts are deleted "approximately 10 minutes after merging". `old_parts_lifetime` = **480 s (8 min)** [S2][S14].
> 3. The CREATE TABLE codec page still says "lz4 in self-managed". **Since 26.9 the built-in default is size-aware: LZ4 for parts < 100 MB, ZSTD(3) for parts ≥ 100 MB** [S5][S16].

---

## 1. Version timeline

### Current releases (as of 2026-10-02)
| Item | Value | Source |
|---|---|---|
| Latest **stable** | **26.9** (released 2026-09-21; latest patch tag `v26.9.8.3-stable`) | [S5], git tags [S20] |
| Latest **LTS** | **26.8 LTS** (released 2026-08-27; latest patch tag `v26.8.15.10-lts`) | [S5], [S20] |
| Previous LTS still supported | 26.3 LTS (2026-03-26). LTS lines get 1 year of support, so 25.8 LTS (2025-08-28) reaches end of life around 2026-08 | [S5][S19] |
| In development | 26.10 (tag `v26.10.1.1-new` exists; settings history already references "26.10") | [S1][S20] |
| Cadence | Stable releases come "roughly monthly" and the 3 latest stable releases are supported. LTS releases come "twice a year", supported for a year. In practice the LTS releases are **YY.3 and YY.8** (23.3, 23.8, 24.3, 24.8, 25.3, 25.8, 26.3, 26.8) | [S19], changelogs [S5–S8] |
| Gap note | There was no normal 25.9 `.1` stable tag. The first 25.9 stable tag is `v25.9.2.1-stable`; the changelog dates 25.9 to 2025-09-25 | [S20][S8] |

### Teaching-relevant milestones (last ~3 years)
| Version (date) | Milestone | Source |
|---|---|---|
| 23.3 LTS (2023-03-30) | **Lightweight DELETE production ready and enabled by default** (`DELETE FROM` works by default; it writes a `_row_exists` mask) | [S6] |
| 23.5 (2023-06-08) | Marks and primary key **compressed by default** (`.cmrk*` and `primary.cidx` files) | [S6] |
| 23.6 (2023-06-30) | "Too many parts" thresholds relaxed. `parts_to_throw_insert` went from **300 → 3000** (and `parts_to_delay_insert` went 150 → 1000 **[unverified: the 150 old value; the source comment only documents 300]**) | [S6][S2] |
| 24.2 (2024-02-29) | **Primary key loaded lazily** on first access (`primary_key_lazy_load`, on by default). Async inserts get an **adaptive busy timeout** (min 50 ms / max 200 ms). `async_insert_max_data_size` raised 1,000,000 → 10,485,760 bytes | [S7][S1] |
| 24.3 LTS (2024-03-26) | **New analyzer enabled by default** (`allow_experimental_analyzer=1`). Unused suffix PK columns are not kept in memory (`primary_key_ratio_of_unique_prefix_values_to_skip_suffix_columns=0.9`) | [S7] |
| 24.8 LTS (2024-08-20) | Analyzer setting renamed `enable_analyzer` and is "fully promoted to production". Experimental new JSON type introduced | [S7][S1] |
| 24.10 (2024-10-31) | **Refreshable MVs production ready**. **Parallel replicas → Beta** | [S7][S1] |
| 24.12 (2024-12-19) | Optional primary-index cache (`use_primary_key_cache`, off by default) | [S7][S2] |
| 25.3 LTS (2025-03-20) | **JSON, Dynamic, Variant types production-ready**. Query condition cache introduced | [S8][S1] |
| 25.4 (2025-04-22) | **Query condition cache enabled by default**. **Lazy materialization** (`query_plan_optimize_lazy_materialization`) on by default | [S8][S1] |
| 25.5 (2025-05-22) | Vector similarity index → Beta | [S8] |
| 25.7 (2025-07-24) | **Lightweight UPDATE** (`UPDATE t SET … WHERE …`) via **patch parts** introduced | [S8][S11] |
| 25.8 LTS (2025-08-28) | **Vector similarity index GA**. Lightweight updates/deletes "promoted from experimental to beta" (`enable_lightweight_update` default true, tier BETA). `replicated_deduplication_window` 1000 → **10000** (25.9 per settings history) | [S8][S2] |
| 25.10 / 25.11 / 25.12 | Lazy-materialization LIMIT cap raised 10 → 100 (25.11) → 10000 (25.12). `replicated_deduplication_window_seconds` reduced 7 days → 1 h (25.10). Time/Time64 enabled (25.12) | [S1][S2][S8] |
| 26.2 (2026-02-26) | **Text (full-text) index GA**. QBit GA. **Insert deduplication ON for all inserts by default** (including async and MVs; new `deduplicate_insert='enable'`) | [S5][S1] |
| 26.3 LTS (2026-03-26) | **`async_insert` ON by default.** "ClickHouse will be batching all small inserts by default now." (`compatibility` < 26.2 restores false) | [S5][S1] |
| 26.8 LTS (2026-08-27) | Patch parts v2 format (sorted by sorting key, `_block_number`, `_block_offset`) | [S5] |
| 26.9 (2026-09-21) | **Analyzer can no longer be disabled.** **Default compression LZ4 → ZSTD(3)** (network: ZSTD(3); MergeTree column data: LZ4 below 100 MB, ZSTD(3) at or above 100 MB). Incremental refreshable MVs (`REFRESH … APPEND INCREMENTAL`). `Nullable(Tuple)` GA | [S5][S1] |

---

## 2. Row vs column storage

| Concept | Definition | Settings/defaults (version) | Common misconception | Sources |
|---|---|---|---|---|
| Columnar layout | In a **Wide** part each column is stored in its own file (`<col>.bin` plus a mark file `<col>.cmrk2`). A query reads only the columns it references. | — | "ClickHouse reads the whole row then projects" — no. `SELECT a,b,c` from a 100-column table opens only 3 column files, plus the primary index and marks. | [S3][S14] |
| Wide vs Compact part | **Compact**: all columns in one file (`data.bin` + `data.cmrk3`/`.cmrk4`), good for small, frequent inserts. **Wide**: one file per column. A part is Compact if its bytes **or** rows are below the thresholds. | `min_bytes_for_wide_part` = **10,485,760 (10 MiB) in OSS**, **1 GiB in ClickHouse Cloud** builds (`#if CLICKHOUSE_CLOUD`). `min_rows_for_wide_part` = 0. `min_level_for_wide_part` = 0 (new 25.10). `write_marks_for_substreams_in_compact_parts` = true (default since 25.8) gives `.cmrk4` | "Every part is one-file-per-column." Small fresh parts are Compact, and merges later turn them Wide. | [S2][S3][S17] |
| Column compression | Each column is compressed independently, in **compressed blocks**. A block is cut when the uncompressed buffer reaches the min size at a mark boundary, or the max size. | `min_compress_block_size` = **65,536 (64 KiB)**. `max_compress_block_size` = **1,048,576 (1 MiB)** | — | [S1] |
| Default codec | **OSS ≤ 26.8: LZ4.** **OSS ≥ 26.9: size-aware. LZ4 for parts < 100 MB, ZSTD(3) for parts ≥ 100 MB** (judged at write time, so merges into big parts switch to ZSTD). **Cloud: ZSTD (level 1)**. Per-column `CODEC(Delta, ZSTD)` etc. overrides this. | Marks and primary key use `ZSTD(3)` (`marks_compression_codec`, `primary_key_compression_codec`). `network_compression_method` = `ZSTD` (was LZ4 before 26.9) | "ClickHouse always uses LZ4" — outdated since 26.9. "Cloud and OSS compress the same" — no. | [S5][S16][S10][S1][S2] |
| Marks | One mark per granule per column (and substream). Each mark stores (offset of the compressed block in `.bin`, offset inside the decompressed block), so a reader can seek to granule N without decompressing earlier data. | Extension rule (source): `.mrk`/`.cmrk` + `2` for Wide adaptive, `3` for Compact, `4` for Compact with substream marks. Compressed (`c`) by default since 23.5 | Marks ≠ the primary index. `primary.idx` holds key **values**, and marks hold **file offsets**. | [S3][S18][S6] |
| Why 3 of 100 columns is cheap | Bytes read ≈ the sum over the 3 referenced columns of (compressed blocks covering the selected granules). The other 97 `.bin` files are never opened. Since 25.4, lazy materialization goes further: columns not needed for `ORDER BY … LIMIT n` are read only for the surviving n rows (cap `query_plan_max_limit_for_lazy_materialization` = 10000). | — | — | [S3][S1][S8] |
| ORDER BY helps compression | Sorting puts equal values next to each other. The docs example went from 50.16 GiB → 25.15 GiB compressed. The UserID column ratio improved 3:1 → 39:1 when the key order changed. | — | "Compression is independent of ORDER BY." | [S16][S3] |

---

## 3. MergeTree parts and merges

| Concept | Definition | Settings/defaults (version) | Common misconception | Sources |
|---|---|---|---|---|
| Part | An immutable, self-contained directory of sorted rows: column files, marks, `primary.cidx`, `minmax_*.idx`, `partition.dat`, `checksums.txt`, `count.txt`, `columns.txt`. **Each INSERT block creates ≥1 new part per partition it touches.** | — | "INSERT appends to an existing file / updates in place." Parts are never modified, only replaced by new parts. | [S14][S13] |
| Part name | `partitionID_minBlock_maxBlock_level[_mutationVersion]`, e.g. `201901_1_9_2_11`: partition 201901, blocks 1–9, merge level 2, mutation version 11. An unpartitioned table uses `all_…` (e.g. `all_1_1_0` = fresh insert, `all_1_9_2`). | Block numbers come from a per-table (per-partition for Replicated) monotonic counter | "Level = number of parts merged." Level = merge depth: max(source levels) + 1. | [S13][S9][S3] |
| Background merge | Merges pick a **contiguous range** of parts in the same partition. They decompress, merge-sort, rebuild the sparse index, compress, and write a new part. Source parts become inactive. | Merge threads: server `background_pool_size` = 16 × `background_merges_mutations_concurrency_ratio` = 2 → up to 32 concurrent merges/mutations. `merge_max_block_size` = 8192 rows. Vertical merges reduce memory | "Merges run on a schedule / must be triggered with OPTIMIZE." They run continuously. `OPTIMIZE FINAL` is rarely needed and ignores the 150 GiB cap. | [S9][S2][S15] |
| Merge selection | `SimpleMergeSelector` (default `merge_selector_algorithm=SIMPLE`) balances **write amplification** against **part count**. It prefers merging small, young parts, and its "base" (total/largest size ratio) is adjusted by part count, size and age. | `max_parts_to_merge_at_once` = **100**. `max_bytes_to_merge_at_max_space_in_pool` = **150 GiB** (161,061,273,600 B). `max_bytes_to_merge_at_min_space_in_pool` = 1 MiB (applies when the pool is nearly full). `number_of_free_entries_in_pool_to_lower_max_size_of_merge` = 8. 26.9 adds `min_partition_age_to_force_merge_seconds` | "Eventually everything merges into one part." Parts stop growing at ~150 GiB, and merges never cross partitions. | [S15][S2][S9][S5] |
| Too many parts | When the number of **active parts in one partition** gets too high: past the delay threshold, INSERT is slowed (sleep up to `max_delay_to_insert`); past the throw threshold, error `TOO_MANY_PARTS` ("Merges are processing significantly slower than inserts"). | `parts_to_delay_insert` = **1000**. `parts_to_throw_insert` = **3000** (was **300 before 23.6**). `max_parts_in_total` = **100,000** (whole table). `max_delay_to_insert` = 1 s. `inactive_parts_to_throw_insert` = 0 (off) | "Raise the limit to fix it." The docs say to fix the cause (batching, async inserts, partition key) instead. | [S2][S6][S21] |
| Insert block size | Server-side squashing: a large INSERT is split into blocks of up to ~1M rows, and each block → a part. | `max_insert_block_size` = **1,048,449** rows (DEFAULT_INSERT_BLOCK_SIZE = 1048576 − SIMD padding; alias `max_insert_block_size_rows` since 26.1). `min_insert_block_size_rows` = 1,048,449. `min_insert_block_size_bytes` = 1,048,449 × 256 ≈ 256 MiB | — | [S1][S4] |
| Batch guidance | Sync inserts: **≥1,000 rows, ideally 10,000–100,000 rows per insert**, and about **one insert query per second**. | — | "Row-by-row inserts like OLTP are fine." Each one creates a part. (Since 26.3 async insert by default mitigates this.) | [S12b][S21] |
| Async inserts | The server buffers small inserts in memory (per query shape and settings) and flushes one part when the **first** threshold is hit: size, time, or query count. | `async_insert` = **true since 26.3 LTS** (compat key "26.2"; false before). `wait_for_async_insert` = **true**. `async_insert_max_data_size` = **10 MiB OSS** / 100 MiB Cloud (was 1,000,000 B before 24.2). `async_insert_busy_timeout_max_ms` (alias `async_insert_busy_timeout_ms`) = **200 ms** OSS / 1000 ms Cloud. Adaptive timeout on (min **50 ms**, ±20% rate) since 24.2. `async_insert_max_query_number` = **450**. The MergeTree-level `async_insert` table setting is still false | "`wait_for_async_insert=0` is the fast and safe mode." It is fire-and-forget, and errors only show up in server logs. The docs recommend `async_insert=1, wait_for_async_insert=1`. | [S1][S12][S5] |
| Insert deduplication | Hash of the inserted block. A retried identical block is dropped if its hash is still in the window. | `insert_deduplicate` = true (sync, Replicated). Since 26.2 `deduplicate_insert`='enable' → on for **all** inserts incl. async and MVs. `replicated_deduplication_window` = **10,000** blocks (was 1000 before 25.9). `replicated_deduplication_window_seconds` = **3600** (was 7 days before 25.10). Async variants: 10,000 / 1 week. `non_replicated_deduplication_window` = 0 (non-replicated MergeTree does **not** dedup unless set) | "Dedup = uniqueness by primary key." It is per inserted **block** (retry safety), not per row. | [S2][S1][S5] |
| Part states | `active` = used by queries. `outdated`/inactive = source parts after a merge, kept for safety then deleted. Other states include Temporary, PreActive, Deleting. | `old_parts_lifetime` = **480 s (8 min)** (the docs say "approximately 10 minutes") | "Disk usage drops instantly after a merge." The old parts linger about 8 min. | [S2][S13] |
| Lightweight DELETE | Writes a `_row_exists` mask. Rows are hidden immediately and physically removed on later merges. | `lightweight_deletes_sync` = 2. `lightweight_delete_mode` = `alter_update` | "DELETE frees space immediately." | [S6][S1] |
| Lightweight UPDATE (patch parts) | `UPDATE t SET … WHERE …` writes a small **patch part** (changed columns plus `_part`, `_part_offset`, `_block_number`, `_block_offset`, `_data_version`). It is applied on read (merge mode, or join mode if the source part has merged away) and materialized during merges. | `enable_lightweight_update` = true (BETA since 25.8). `apply_patch_parts` = true | "UPDATE rewrites the part like `ALTER … UPDATE`." Classic mutations rewrite whole columns; patch parts are about 1000× faster per the blog. | [S11][S1][S8] |

---

## 4. Primary key / ORDER BY / sparse index

| Concept | Definition | Settings/defaults (version) | Common misconception | Sources |
|---|---|---|---|---|
| Sorting key | `ORDER BY` defines physical row order inside each part (not across parts). | — | "Data is globally sorted across the table." Only within a part. | [S3][S14] |
| PRIMARY KEY | Defaults to the ORDER BY tuple. If given explicitly it **must be a prefix** of ORDER BY. **Not unique**: duplicates are allowed. | — | "PK enforces uniqueness / is a B-tree with one entry per row." | [S3][S14] |
| Granule | The smallest unit read: up to `index_granularity` rows, also bounded by `index_granularity_bytes` (adaptive granularity). A granule has 1…8192 rows. | `index_granularity` = **8192**. `index_granularity_bytes` = **10 MiB** (10,485,760). `min_index_granularity_bytes` = 1024. `enable_mixed_granularity_parts` = true | "ClickHouse reads individual rows via the index." It always reads whole granules. | [S2][S3][S14] |
| Sparse primary index | `primary.idx` (`primary.cidx` when compressed, the default since 23.5) holds **one entry per granule**: the key values of the granule's first row, plus a final mark. Docs example: 8.87 M rows → **1083 granules** → index 96.93 KiB, fully in memory. | `primary_key_lazy_load` = true (since 24.2: loaded on first use). `primary_key_ratio_of_unique_prefix_values_to_skip_suffix_columns` = 0.9 (24.3). `use_primary_key_cache` = false (24.12, opt-in LRU cache). `SYSTEM UNLOAD PRIMARY KEY` (24.4) | "The PK index is huge / on disk per row." | [S3][S2][S7] |
| Binary search vs generic exclusion | Filter on the **first** key column → binary search over marks (docs trace: "found continuous range in 19 steps"; result 1/1083 granules). Filter on a **later** column → generic exclusion search, which only works well when the preceding key columns have low cardinality (docs: URL filter → **1076/1083** granules selected). | — | "Any column in the ORDER BY is equally indexed." | [S3] |
| Key column order | Put **lower-cardinality columns first** (ascending cardinality). This helps both secondary-column pruning and compression (3:1 → 39:1 example). | — | "Put the most selective (high-cardinality) column first, like in B-tree DBs." This can be wrong for ClickHouse when you also filter on later columns. | [S3] |
| EXPLAIN indexes = 1 | Shows each index stage as `Parts: selected/total` and `Granules: selected/total`, in order: MinMax (partition) → Partition → PrimaryKey → Skip. Docs example: MinMax `4/5, 11/12` → Partition `3/4, 10/11` → PrimaryKey `2/3, 6/10` → Skip `1/2, 2/6`. | Since 25.10, the query condition cache is applied **before** PK and skip-index analysis | — | [S10b][S8] |
| Query condition cache | Remembers, per (part, condition), which granule ranges did **not** match WHERE, so repeated filters skip them. | `use_query_condition_cache` = true (25.4; introduced 25.3) | — | [S1][S8] |

---

## 5. Partitions (PARTITION BY)

| Concept | Definition | Settings/defaults (version) | Common misconception | Sources |
|---|---|---|---|---|
| Purpose | A **data management** unit: drop/move/archive whole chunks cheaply (TTL drops, `DROP/DETACH/ATTACH/MOVE/REPLACE PARTITION`, storage tiering). | `ttl_only_drop_parts` = false | "Partitioning speeds up queries." The docs say: "Partitioning does not speed up queries (in contrast to the ORDER BY expression)." | [S14][S13a] |
| Merge boundary | **Parts never merge across partitions.** Each partition has its own part count, and the too-many-parts limits are **per partition**. | — | — | [S13][S13a][S2] |
| Partition pruning | Each part stores `partition.dat` plus `minmax_<col>.idx` for the partition-key columns. Parts whose min/max can't match the filter are skipped. Docs example: **436 parts → 1** and **3,257 granules → 11**. | — | "Pruning needs the filter to name the partition ID." It works on any filter over the partition-key columns. | [S13a][S10b] |
| Granularity guidance | "In most cases you don't need a partition key." If time-based, use **monthly** (`toYYYYMM(date)`). Keep total partitions **under ~1000–10000**. Never partition by client ID or name. | `max_partitions_per_insert_block` = **100** (since 19.5). `throw_on_max_partitions_per_insert_block` = true | "Daily or hourly partitions are always better." They multiply part counts and hit TOO_MANY_PARTS. | [S14][S1][S13a] |
| Insert fan-out | One INSERT block touching N partitions creates **N parts**. More than 100 partitions in a block → exception. | see above | — | [S1][S13a] |

---

## Visualizable mechanics (simulation ideas)

1. **Insert → part spawn**: each INSERT drops a new tile `all_N_N_0` (or `YYYYMM_N_N_0` per partition touched). Tile size ∝ rows. Small tiles are Compact (one box) and big ones are Wide (a stack of per-column strips). Threshold 10 MiB.
2. **Merge animation**: the selector picks a **contiguous** run of adjacent tiles in one partition and fuses them into `all_min_max_(level+1)`. The old tiles fade to "outdated" and disappear after 480 s (game time). Cap: tiles ≥150 GiB stop merging. ≤100 parts per merge.
3. **Too-many-parts meter** per partition: green < 1000, yellow 1000–3000 (inserts slow down / "sleep" animation), red ≥ 3000 → INSERT rejected. Toggle "async insert" to see many tiny inserts batched into one tile per 200 ms / 10 MiB / 450 queries.
4. **Partition lanes**: parts live in lanes by partition. Merges never cross lanes. A "partition by user_id" mode explodes into hundreds of lanes and trips the 100-partitions-per-insert guard.
5. **Column files**: a part opens up into column files. A `SELECT a,b,c` lights up 3 of 100 files and dims the rest. Show bytes read.
6. **Granules and sparse index**: a column file sliced into 8192-row granules with one `primary.idx` entry per granule. A binary search pointer jumps (≈log2 steps) on a first-column filter, while a later-column filter shows generic exclusion lighting up most granules (1076/1083).
7. **Marks**: an arrow from a mark to (compressed block offset, offset in decompressed block). Compressed blocks of 64 KiB–1 MiB span one or more granules.
8. **EXPLAIN funnel**: a waterfall MinMax → Partition → PrimaryKey → Skip index showing `Parts x/y`, `Granules x/y` shrinking.
9. **Patch parts**: an UPDATE drops a thin translucent overlay tile that is applied on read and absorbed at the next merge. DELETE sets a `_row_exists` mask.
10. **Codec switch (26.9+)**: when merged size crosses 100 MB the tile recolors from LZ4 to ZSTD(3).

## Puzzle-target numbers

| Number | Meaning |
|---|---|
| 8192 | rows per granule (`index_granularity`) |
| 10 MiB | `index_granularity_bytes`. Also `min_bytes_for_wide_part` (OSS) and `async_insert_max_data_size` (OSS) |
| 1 GiB | `min_bytes_for_wide_part` in Cloud |
| 8.87 M rows → 1083 granules | docs sample (⌈8,870,000/8192⌉ ≈ 1083), index 96.93 KiB |
| 1/1083 vs 1076/1083 | granules selected: first key column vs second key column |
| 436→1 parts, 3257→11 granules | partition-pruning example |
| 1000 / 3000 | delay / throw active parts per partition (300 before 23.6) |
| 100,000 | `max_parts_in_total` |
| 150 GiB | max auto-merge result size |
| 100 | max parts per merge, and `max_partitions_per_insert_block` |
| 1,048,449 | `max_insert_block_size` rows |
| 10k–100k rows, ~1 insert/s | batch guidance |
| 200 ms / 450 / 50 ms | async flush timeout max / query count / adaptive min |
| 480 s | `old_parts_lifetime` |
| 10,000 blocks / 3600 s | replicated dedup window |
| 64 KiB / 1 MiB | min / max compress block size |
| 100 MB | LZ4 → ZSTD(3) switch point (26.9+) |
| 16 × 2 = 32 | concurrent background merges/mutations (pool × ratio) |
| 1000–10000 | recommended max total partitions |
| `201901_1_9_2_11` | partition_min_max_level_mutation |

---

## Sources
- [S1] Settings.cpp (master, read 2026-10-02): https://github.com/ClickHouse/ClickHouse/blob/master/src/Core/Settings.cpp
- [S2] MergeTreeSettings.cpp: https://github.com/ClickHouse/ClickHouse/blob/master/src/Storages/MergeTree/MergeTreeSettings.cpp
- [S3] Sparse primary indexes guide: https://clickhouse.com/docs/guides/best-practices/sparse-primary-indexes
- [S4] Defines.h (DEFAULT_INSERT_BLOCK_SIZE): https://github.com/ClickHouse/ClickHouse/blob/master/src/Core/Defines.h
- [S5] Changelog 2026 (26.1–26.9): https://clickhouse.com/docs/whats-new/changelog and https://github.com/ClickHouse/ClickHouse/blob/master/CHANGELOG.md
- [S6] Changelog 2023: https://clickhouse.com/docs/whats-new/changelog/2023
- [S7] Changelog 2024: https://clickhouse.com/docs/whats-new/changelog/2024
- [S8] Changelog 2025: https://clickhouse.com/docs/whats-new/changelog/2025
- [S9] Merges concept page: https://clickhouse.com/docs/merges
- [S10] CREATE TABLE / codecs: https://clickhouse.com/docs/reference/statements/create/table
- [S10b] EXPLAIN: https://clickhouse.com/docs/reference/statements/explain
- [S11] Lightweight UPDATE blog: https://clickhouse.com/blog/updates-in-clickhouse-2-sql-style-updates and 25.7 release blog https://clickhouse.com/blog/clickhouse-release-25-07
- [S12] Async inserts: https://clickhouse.com/docs/optimize/asynchronous-inserts (→ /docs/concepts/best-practices/async-insert)
- [S12b] Bulk inserts: https://clickhouse.com/docs/optimize/bulk-inserts (→ /docs/concepts/best-practices/bulk-inserts)
- [S13] Custom partitioning key (part names, active, ~10 min): https://clickhouse.com/docs/engines/table-engines/mergetree-family/custom-partitioning-key
- [S13a] Table partitions: https://clickhouse.com/docs/partitions
- [S14] MergeTree engine: https://clickhouse.com/docs/reference/engines/table-engines/mergetree-family/mergetree ; Table parts: https://clickhouse.com/docs/parts
- [S15] SimpleMergeSelector.h: https://github.com/ClickHouse/ClickHouse/blob/master/src/Storages/MergeTree/Compaction/MergeSelectors/SimpleMergeSelector.h
- [S16] Compression in ClickHouse (Cloud ZSTD level 1): https://clickhouse.com/docs/data-compression/compression-in-clickhouse
- [S17] ServerSettings.cpp (background_pool_size 16, ratio 2): https://github.com/ClickHouse/ClickHouse/blob/master/src/Core/ServerSettings.cpp
- [S18] Mark file extensions: https://github.com/ClickHouse/ClickHouse/blob/master/src/Storages/MergeTree/MergeTreeIndexGranularityInfo.cpp
- [S19] Which version to use in production: https://clickhouse.com/docs/faq/operations/production
- [S20] Release tags/dates: https://github.com/ClickHouse/ClickHouse/releases , https://github.com/ClickHouse/ClickHouse/tags
- [S21] Too many parts KB: https://clickhouse.com/docs/knowledgebase/exception-too-many-parts
