# Research B — ClickHouse query-side internals (for the learning game)

Researched 2026-10-02. **Latest releases at research time: 26.9 stable (v26.9.8.3), 26.3 LTS** (https://api.github.com/repos/ClickHouse/ClickHouse/releases). Setting defaults below are read straight from `master` source (commit dated 2026-10-02):
- S = https://github.com/ClickHouse/ClickHouse/blob/master/src/Core/Settings.cpp (each setting carries its own change-history tuple `{"version", old, new, "reason"}` — this is the authoritative "changed in version" record)
- MTS = https://github.com/ClickHouse/ClickHouse/blob/master/src/Storages/MergeTree/MergeTreeSettings.cpp
- DEF = https://github.com/ClickHouse/ClickHouse/blob/master/src/Core/Defines.h

Anything tagged "26.10" in source is **on master, not yet in a stable release** as of today.
**[unverified]** = could not confirm from a primary source.

---

## 0. Headline facts / surprises (TL;DR)

| # | Fact | Source |
|---|---|---|
| 1 | `join_algorithm` default is **`direct,parallel_hash,hash,ie_join`** (was `default` until 24.12; `ie_join` appended in 26.8). So the default is **not** plain `hash` anymore — `parallel_hash` is preferred. `parallel_hash_join_threshold` = 100 000 (25.5): if right side is estimated < 100k rows, plain `hash` is used. | S |
| 2 | Hash joins **spill to disk by default since 26.5**: `max_bytes_ratio_before_external_join = 0.5` (new 26.5), `max_bytes_before_external_join` (26.4). "Right table must fit in RAM" is no longer strictly true on current versions. | S |
| 3 | The planner **can swap build/probe sides** (`query_plan_join_swap_table = 'auto'` since 24.12) and **reorder multi-table joins** (25.9; `query_plan_optimize_join_order_limit` 1→10 in 25.12; statistics used by default `allow_statistics_optimize`=1 since 25.12; auto statistics `auto_statistics_types` on by default since 26.4; column statistics GA 26.3). "Always put the small table on the right" is now a legacy rule of thumb. | S, MTS, https://clickhouse.com/blog/clickhouse-release-25-09 |
| 4 | Full-text **`text` index is GA in 26.2** (experimental 24.6 → Beta 25.12 → GA 26.2). `tokenbf_v1` / `ngrambf_v1` are now marked **deprecated** in the docs. | S (`enable_full_text_index`), https://clickhouse.com/docs/engines/table-engines/mergetree-family/mergetree |
| 5 | **Vector similarity index GA in 25.8** (experimental since 24.8). Note: one docs fetch still said "experimental" — the source history `{"25.8", false, true, "Vector similarity indexes are GA."}` wins. | S, https://clickhouse.com/docs/changelogs/25.8 |
| 6 | The **new analyzer is mandatory as of 26.9** — `enable_analyzer`/`allow_experimental_analyzer` is OBSOLETE; default-on since 24.3. | S |
| 7 | `max_block_size` default = **65409** (= 65536 − SIMD padding), not 65536 / 65505. Insert block = 1 048 449. | DEF |
| 8 | Query condition cache: new in 25.3, **on by default since 25.4** (the 25.3 launch blog says "not yet enabled by default" — outdated). | S, https://clickhouse.com/blog/introducing-the-clickhouse-query-condition-cache |
| 9 | Lazy materialization on by default since 25.4; its LIMIT cap rose 10 → 100 (25.11) → **10 000 (25.12)**. | S |
| 10 | Projections + lightweight DELETE **throw by default** (`lightweight_mutation_projection_mode='throw'`); projections on Replacing/Collapsing/etc. tables **throw by default** (`deduplicate_merge_projection_mode='throw'` since 24.8). | MTS |
| 11 | CoalescingMergeTree **exists** (25.6+): keeps latest non-NULL value per column. | https://clickhouse.com/docs/engines/table-engines/mergetree-family/coalescingmergetree |
| 12 | Refreshable MVs: introduced 23.12, **production-ready in 24.10**. | https://clickhouse.com/blog/clickhouse-release-24-10 |

---

## 1. Data skipping indexes

| Concept | Definition | Settings / defaults (version) | Common misconception |
|---|---|---|---|
| Skip index (general) | Per-*index-granule* summary that lets the reader skip blocks "guaranteed to have no matching values". Not a row-pointer B-tree. Syntax: `INDEX name expr TYPE type(...) [GRANULARITY n]`. [1][2] | `use_skip_indexes`=1 [S]; `force_data_skipping_indices` [1]; `use_skip_indexes_if_final`=1 (default changed 0→1 in **25.6**) [S]; `use_skip_indexes_on_data_read`=1 (new 25.9, on by default **26.1**: index checks interleaved with reading) [S]; `use_skip_indexes_for_disjunctions`=1 (25.12) [S]; `materialize_skip_indexes_on_merge`=1 (MTS, 25.1) | "It's like a Postgres secondary index that finds rows." No — it only prunes granules; matched granules are still scanned fully. |
| GRANULARITY | "Each indexed block consists of GRANULARITY granules. … if the granularity of the primary table index is 8192 rows, and the index granularity is 4, each indexed 'block' will be 32768 rows." [1] | Default GRANULARITY = **1** [2]. `index_granularity`=8192 rows, `index_granularity_bytes`=10 MiB (adaptive granularity) [MTS]. Vector index default granularity = 100 million [4]. | "GRANULARITY is rows." It's a multiple of primary-index granules. |
| minmax | Stores min & max of the expression per index granule. [2] | — ; MTS `add_minmax_index_for_numeric_columns` / `_string_columns` (25.1), `_temporal_columns` (26.2) all default **false** | Useless if values are randomly spread (every granule's range covers the target). |
| set(N) | Stores up to N distinct values per index granule; `set(0)` = unlimited; if exceeded, index stores nothing useful for that granule. [1][2] | — | Works for "low cardinality per block, high cardinality overall". |
| bloom_filter([fpr]) | Probabilistic membership per granule; supports `=`, `IN`, `has`… [2] | default false-positive rate **0.025** [2] | "No false negatives" is right; but false positives mean extra granules are read. Can't help `<`/`>`. |
| tokenbf_v1(size_bytes, hashes, seed) | Bloom filter over tokens split on non-alphanumerics. [2] | **Deprecated** (docs; deprecated ~26.2 per secondary source — exact version **[unverified]**) [2][15] | Still widely recommended in old blog posts. |
| ngrambf_v1(n, size_bytes, hashes, seed) | Bloom filter over character n-grams; for `LIKE '%x%'`. [2] | **Deprecated** (same as above) [2] | |
| `text` (full-text inverted index) | Deterministic inverted index (token → posting list, row-level), `INDEX i col TYPE text(tokenizer = splitByNonAlpha, preprocessor = lowerUTF8(col))`. Accelerates `hasToken`, `hasAllTokens`, `hasAnyTokens` directly, plus hints for `=`, `IN`, `LIKE`, `match`, `startsWith`, `endsWith`… [3][5] | `enable_full_text_index` (alias `allow_experimental_full_text_index`): experimental **24.6**, Beta **25.12**, **GA 26.2** [S]; `query_plan_direct_read_from_text_index`=1 (25.9) [S]; GA announced 2026-03-10 [5]; works on Cloud [5]. Phrase search (`support_phrase_search`) still experimental [3]. | "ClickHouse can't do full-text search." It can, natively, since 26.2 GA. (Note: one docs page summary claimed "not supported in Cloud" — contradicted by GA blog [5]; treat as **[unverified]**.) |
| vector_similarity | ANN index: `INDEX i vec TYPE vector_similarity('hnsw', 'cosineDistance', 768)`; queries `ORDER BY L2Distance(vec, ref) LIMIT N`. Uses USearch HNSW. [4] | experimental 24.8 → **GA 25.8** [S][6]; binary quantization 25.8 [6]; `vector_search_filter_strategy`='auto' (pre/post filter) [4]; `hnsw_candidate_list_size_for_search`=256 [4]; old `annoy`/`usearch` types removed in 25.8 [6] | "Approximate = exact." Results are approximate; post-filtering can return < N rows. |
| When they help vs hurt | "In most cases a useful skip index requires a strong correlation between the primary key and the targeted, non-primary column." Random spread → every granule matches → you pay index evaluation + full read. [1] | Disable per query with `use_skip_indexes=0` if most granules match [1] | "Adding indexes always makes queries faster" — they cost insert/merge time + disk, and may prune nothing. |
| EXPLAIN indexes=1 | Shows each index stage with Parts and Granules remaining/total. Docs example: Partition Min-Max `Parts 4/5, Granules 11/12` → PrimaryKey `Parts 2/3, Granules 6/10` → Skip `t_minmax` ("minmax GRANULARITY 2") `Parts 1/2, Granules 2/6`. Trace log form: "Index `vix` has dropped 6102/6104 granules". [7][1] | `EXPLAIN PLAN` options: `indexes` default 0, `actions` default 1 (per docs page), `projections` default 0, `header` 0, `json` 0 [7] | |
| ADD vs MATERIALIZE | `ALTER TABLE ADD INDEX` → only new inserts/merged parts get the index; `ALTER TABLE MATERIALIZE INDEX` (a mutation) builds it for existing parts. [1] | | "ADD INDEX instantly speeds up old data." No — old parts lack it until materialized/merged. |

Concrete docs example [1]: 100M rows, `set(100)` index → **32,768 rows read instead of 100M** (0.079 s → 0.051 s; 800 MB → 360 KB).

---

## 2. Projections

| Concept | Definition | Settings / defaults (version) | Common misconception |
|---|---|---|---|
| Projection | "An additional, hidden table" stored **inside each data part** (`<name>.proj` subdirectory), with its own ORDER BY / primary index or a GROUP BY pre-aggregation; kept in sync on insert & merge. [8][9] | `optimize_use_projections`=1 [S]; `force_optimize_projection` [9]; `optimize_use_implicit_projections`=1 (implicit min-max/count projections) [S] | "A projection is a separate table I query by name." You query the base table; the optimizer picks. |
| ORDER BY projection | Same rows, different sort → different primary index (e.g. base `ORDER BY ts`, projection `ORDER BY user_id`). Full copy of selected columns. [8] | | |
| Aggregate projection | `SELECT k, sum(x) GROUP BY k` → hidden table becomes AggregatingMergeTree with `AggregateFunction` columns. [8] | | |
| Selection | Optimizer "chooses a table that can generate the same correct result, but requires the least amount of data to be read" (compares marks to read). [8] Since **25.6** multiple projections can help one query (one read, others prune parts). [8] | `EXPLAIN projections=1`; `system.query_log.used_projections` [7][13] | |
| `_part_offset` / lightweight (index-like) projections | Projection stores only its sort key + `_part_offset` pointer to the row in the base part; acts as a secondary index. Supported **25.5**; granule-level pruning like a real secondary index **25.6**. [8][16] | `ADD PROJECTION ... WITH SETTINGS (index_granularity = ...)` per-projection settings [9] | |
| Cost | "more IO and space on disk"; writing data twice. [8][9] Can't: different TTLs, JOINs or WHERE in definition (docs list), chaining. [8] | | "Free speed-up." Every insert & merge does the extra work. |
| Lightweight DELETE interaction | "By default, lightweight delete `DELETE` does not work for tables with projections." Modes: `throw` (default), `drop` (projection removed in touched parts until rebuilt), `rebuild`. Part-level. [MTS] | `lightweight_mutation_projection_mode`='throw' (setting added 24.7 per docs [9]) | |
| Dedup-engine merges | For non-classic engines (Replacing/Collapsing/…), merges reduce rows → projection would go stale. Values `ignore` (compat only, may be incorrect), `throw`, `drop`, `rebuild`. Also governs `OPTIMIZE DEDUPLICATE`. [MTS] | `deduplicate_merge_projection_mode`='throw'; default changed ignore→throw in **24.8** [MTS] | |

---

## 3. Materialized views

| Concept | Definition | Settings / defaults (version) | Common misconception |
|---|---|---|---|
| Incremental MV | "Just a trigger that runs a query on blocks of data as they're inserted into a table." It sees **only the inserted block**. [10] "Any changes to existing data of source table (like update, delete, drop partition, etc.) does not change the materialized view." [11] Aggregation happens "only within a single packet of inserted data". [11] | `parallel_view_processing`=0 (sequential) [S]; `materialized_views_ignore_errors`=0 [S] | "MV = cached query result that stays in sync." It is an insert trigger; never re-reads the source. |
| TO target table | `CREATE MATERIALIZED VIEW mv TO target AS SELECT ...` — rows go to an explicit table you own (preferred). [10] Target usually Summing/AggregatingMergeTree, with GROUP BY keys matching target ORDER BY. [10] | | "The MV stores its own data." With TO, data lives in the target. |
| Partial aggregates | Each insert block writes its own partial rows; target merges them later → you must re-aggregate (`sum`, `-Merge`) or use FINAL at read. [10] | | "One row per key in the target." Several until merge. |
| JOIN in MV | "Only triggers on inserts to the source table (the left-most table in the query)." Right-side table changes don't update anything. [10] | | "Updating the dimension table refreshes the MV." |
| POPULATE / backfill | POPULATE "can miss rows inserted into its source table" during creation and runs all at once (memory/interrupt risk). Recommended: `INSERT INTO target SELECT …` or replay via a Null-engine table. [12] | | "Creating an MV processes historical data." Only with POPULATE (discouraged) or manual backfill. |
| Chaining | MV target can itself be the source of another MV; multiple MVs on one source run in UUID order unless `parallel_view_processing=1`. [10] | | |
| Refreshable MV | Periodically re-runs the full query: `REFRESH EVERY|AFTER interval [OFFSET][RANDOMIZE FOR] [DEPENDS ON …] [APPEND [INCREMENTAL]] [TO …] [EMPTY] AS SELECT`. Default = atomic replace of target; `APPEND` adds rows; `DEPENDS ON` waits for other RMVs. No insert trigger. Monitor via `system.view_refreshes`; `SYSTEM REFRESH/STOP/START/WAIT/CANCEL VIEW`. [11] | Introduced 23.12, **production-ready 24.10** ("In 24.10, this feature supports the Replicated database engine and is also production-ready!") [17]; `refresh_retries`=2, initial backoff 100 ms, max backoff 60 s [11]. `APPEND INCREMENTAL` (only rows since last refresh; single plain MergeTree source) — version **[unverified]**. | "Refreshable MVs are incremental." Default mode recomputes everything. |

---

## 4. MergeTree engine family

| Engine | Definition | Settings / defaults | Common misconception |
|---|---|---|---|
| ReplacingMergeTree([ver[, is_deleted]]) | Rows with equal **ORDER BY** key are collapsed to one: max `ver`, or last inserted if no `ver`. "Data deduplication occurs only during a merge. Merging occurs in the background at an unknown time." → eventual. [18] `is_deleted` (UInt8, requires `ver`) marks deletes; rows physically removed only with `OPTIMIZE … FINAL CLEANUP` / cleanup merges. [18][19] | `allow_experimental_replacing_merge_with_cleanup`=0; `enable_replacing_merge_with_cleanup_for_min_age_to_force_merge`=0 (25.3) [MTS] | **"Duplicates never show up."** A plain SELECT can still return duplicates and deleted rows. Dedup key is ORDER BY, not PRIMARY KEY/unique constraint; dedup is per-partition. |
| FINAL | Merges at query time; works for Replacing/Summing/Aggregating/Collapsing/VersionedCollapsing. Runs in parallel (`max_final_threads`). [20] | `final`=0 [S]; `do_not_merge_across_partitions_select_final`=0 [S] — set 1 to merge each partition independently. Guide benchmark: no partitions **2.338 s / 122.94M rows** vs yearly partitions **0.994 s / 64.65M rows**. [19] `optimize_move_to_prewhere_if_final` default → true only in **26.10 (master)** [S]; `query_plan_optimize_lazy_final`=0 (26.4) [S]; `use_skip_indexes_if_final`=1 (25.6) [S] | "FINAL is unusable/very slow." Much improved; cost scales with data not filtered by PK. |
| argMax alternative | `SELECT key, argMax(col, ver) … GROUP BY key` gives latest per key without FINAL. Standard pattern — exact docs wording **[unverified]** (see deduplication guide [19]). | | |
| SummingMergeTree([cols]) | On merge sums numeric non-key columns per sorting key; other columns take an arbitrary value; row deleted if all summed values are 0; nested `…Map` summed by key. Query with `sum() GROUP BY`. [21] | | "SELECT * gives totals." Only after merges. Zero-sum rows disappear. |
| AggregatingMergeTree | Replaces rows with same sorting key by one row of combined **aggregate states**. Insert with `-State` (e.g. `uniqState`), query with `-Merge` + GROUP BY. `SimpleAggregateFunction(f, T)` stores plain values for f where state = value (sum, min, max, any…). [22] | | "You can SELECT the column directly." `AggregateFunction` columns are binary states; need `-Merge` (or `finalizeAggregation`). |
| CollapsingMergeTree(sign) | `sign=1` state row, `-1` cancel row; on merge pairs with same key cancel. Query with `sum(sign)`, `sum(sign*x)`, `HAVING sum(sign)>0`. Requires cancel to follow its state (insert order). [23] | | |
| VersionedCollapsingMergeTree(sign, version) | Same but "allows inserting the data in any order with multiple threads" thanks to `version`. [24] | | |
| CoalescingMergeTree([cols]) | **New in 25.6**: rows with same key → one row with "the latest non-NULL values for each column". Column-level upserts for sparse/fragmented data; use Nullable columns; query with FINAL. [25][26] | | "Replacing keeps per-column latest." No — Replacing keeps whole rows; Coalescing is per column. |

---

## 5. Query execution

| Concept | Definition | Settings / defaults (version) | Common misconception |
|---|---|---|---|
| Vectorized execution / blocks | "Operations are dispatched on arrays, rather than on individual values." A Block = set of (IColumn, IDataType, name) chunks flowing through a processor pipeline. [27] | `max_block_size` = **65409** (65536 − padding) [DEF]; `max_insert_block_size` = 1 048 449 [DEF]; `index_granularity` 8192 [MTS] | "Processes row by row." |
| Parallelism | Pipeline stages run in parallel streams. | `max_threads` = 0 → auto = number of hardware threads available (logical cores for x86 <32 cores w/ SMT); Cloud shows `auto(N)` [S]. New 26.5: `max_threads_min_free_memory_per_thread`=1 GiB can lower thread count [S] | |
| PREWHERE | Reads only filter columns first, then the other columns "only for blocks that contain at least one matching row". Auto-moved from WHERE. MergeTree only. [28] | `optimize_move_to_prewhere`=1; `move_all_conditions_to_prewhere`=1; `enable_multiple_prewhere_read_steps`=1 [S] | "You must write PREWHERE manually." |
| Lazy materialization | For `ORDER BY … LIMIT n`, defers reading non-sort columns until after top-N chosen. EXPLAIN shows "Lazily read columns: …". Blog: 150M-row reviews, **219 s → 0.139 s**; 72 GB → 1.81 GB. [29] | `query_plan_optimize_lazy_materialization`=1 since **25.4**; `query_plan_max_limit_for_lazy_materialization` 10 (25.4) → 100 (25.11) → **10 000 (25.12)** [S] | |
| Query condition cache | Caches, per (part, filter condition hash), a **per-granule bit**: 0 = no row matched / 1 = some matched. Later queries with same WHERE skip 0-granules. Example: 0.529 s / 99.46M rows → 0.037 s / 2.16M rows. 100 MB ≈ 839M granule entries. [30] | `use_query_condition_cache`: new 25.3 (off), **on by default 25.4** [S]; `query_condition_cache_size` 100 MB [30] | Confused with query result cache. It stores granule bitmaps, not results. |
| Query (result) cache | Stores full SELECT results; transactionally inconsistent (TTL-based); not shared between users by default; non-deterministic functions not cached by default. [31] | `use_query_cache`=0; `query_cache_ttl`=60 s; `query_cache_min_query_duration`=0; `query_cache_min_query_runs`=0; `query_cache_share_between_users`=0 [S]. GA version **[unverified]** (~23.x) | "Cache always fresh." It can serve stale data up to TTL. |
| Analyzer | New query analysis/planner. | Enabled by default **24.3**; alias `enable_analyzer` 24.8; **mandatory/obsolete toggle 26.9** [S] | |
| EXPLAIN | `AST`, `SYNTAX`, `QUERY TREE`, `PLAN` (default), `PIPELINE`, `ESTIMATE`, `TABLE OVERRIDE`; docs also list `ANALYZE`, `WHATIF` (newer). PLAN options `indexes`, `actions`, `projections`, `header`, `json`. [7] | | |
| system.query_log | `type` (QueryStart/QueryFinish/ExceptionBeforeStart/ExceptionWhileProcessing), `query_duration_ms`, `read_rows`, `read_bytes`, `result_rows`, `memory_usage`, `peak_threads_usage`, `ProfileEvents`, `normalized_query_hash`, `used_projections`, `used_join_algorithms`, `spilled_to_disk`. Filter `is_initial_query=1`; `SYSTEM FLUSH LOGS`. [13] | | |
| system.parts / parts | Each INSERT creates an immutable part; name `partition_minblock_maxblock_level` (level 0 = unmerged, +1 per merge); background merges up to ~150 GB. `system.parts` (`name`, `active`, `rows`, `level`…). [14] | | |

---

## 6. JOINs, dictionaries, IN

| Concept | Definition | Settings / defaults (version) | Common misconception |
|---|---|---|---|
| Default join algorithm | List, first applicable wins: **`direct,parallel_hash,hash,ie_join`**. [S] | 24.12: `default` → `direct,parallel_hash,hash` ("parallel_hash is now preferred over hash"); 26.8: `ie_join` appended [S]; `parallel_hash_join_threshold`=100 000 (25.5) [S] | "Default = hash." |
| hash / parallel_hash | Build side loaded into RAM hash table ("ClickHouse takes the right_table and creates a hash table for it in RAM" [32]); `parallel_hash` builds several hash tables concurrently over buckets. [S] | `max_bytes_in_join`=0, `max_rows_in_join`=0 (unlimited) [S]; spill: `max_bytes_ratio_before_external_join`=**0.5** (26.5), `max_bytes_before_external_join`=0 (26.4) [S] | |
| Build-side choice / reordering | `query_plan_join_swap_table`='auto' (since 24.12; previously right was always build) — planner may make the left table the build side. Multi-table global join reordering 25.9 (greedy), DPsize 25.12; TPC-H 6-table join **3,903 s → 2.7 s** with statistics. [S][33] | `query_plan_optimize_join_order_limit` 1 (25.9) → **10 (25.12)**; `allow_statistics_optimize`=1 (25.12); `auto_statistics_types`='basic, uniq_v2' (auto stats on 26.4) [S][MTS] | "ClickHouse never reorders joins; you must put the small table on the right." True before 24.12; now planner decides (only `ALL` strictness w/ `JOIN ON` for swap). |
| grace_hash | Partitions right table into buckets (`grace_hash_join_initial_buckets`), one in memory, rest on disk; external from first block. Now mostly diagnostic; enable spilling via thresholds instead. [S] | | |
| partial_merge | Sorts only right table in blocks with min-max index, spills to disk; RIGHT/FULL only with ALL. [S] | | |
| full_sorting_merge / parallel_full_sorting_merge | Sort both sides then merge; good when inputs pre-sorted by key; parallel variant shards by key hash. [S] | | |
| direct | Nested-loop lookup into Dictionary, EmbeddedRocksDB, or MergeTree (pushes key filter to storage). INNER/LEFT, single equality key. [S] | first in default list | |
| ie_join | Sort-based IEJoin for ON with two inequalities. Default list since 26.8. [S] | | |
| Dictionaries | In-memory `key → attributes` maps; sources: ClickHouse table, MySQL, PostgreSQL, HTTP, file, …; layouts FLAT (max_array_size default 500 000), HASHED, SPARSE_HASHED, COMPLEX_KEY_HASHED, RANGE_HASHED, CACHE, IP_TRIE, DIRECT; `LIFETIME(MIN a MAX b)` random reload time in range, old version served while reloading; `dictGet`, `dictGetOrDefault`, `dictHas`. DDL creation recommended. [34] | | "Dictionary = always fresh." Refreshed per LIFETIME. |
| IN vs JOIN | IN builds a set in memory from the subquery; docs: "In some cases, it is more efficient to use IN instead of JOIN"; dictionaries recommended for dimension lookups. JOIN subquery not cached across runs. [32][35] | `transform_null_in`=0 (NULL never matches) [35]; `max_rows_in_set` [35] | |
| GLOBAL IN / GLOBAL JOIN | Plain IN on a Distributed table runs the subquery on each shard over local data (N² fan-out); GLOBAL IN runs it once on the initiator, ships result as a temp table to shards. [35] | `distributed_product_mode`='deny' default [S] | "IN on distributed sees all data." Only local shard data unless GLOBAL. |

---

## 7. Visualizable mechanics (animation ideas)

1. **Granule pruning funnel** — a table of 12 granules; Partition MinMax greys out 1, PK greys out more, skip index greys more; counter reads like EXPLAIN `Granules: 11/12 → 6/10 → 2/6` (docs numbers [7]).
2. **minmax on correlated vs random column** — two strips of granules; correlated column shows tight [min,max] boxes that skip most; random column every box spans full range → nothing skipped [1].
3. **Bloom filter per index granule** — bit arrays light up per granule; query hashes "error" into k bits; granule with all k bits set is read (incl. a false positive); fpr slider 0.025 [2].
4. **GRANULARITY slider** — index granule = N × 8192 rows; larger N = smaller index but coarser skipping [1][2].
5. **Text index posting list** — token → list of row ids; contrast with tokenbf "maybe" per granule [3].
6. **Projection selection** — query arrives; optimizer compares marks-to-read for base (ORDER BY ts) vs projection (ORDER BY user_id) and picks the cheaper; part directory shows `p_user.proj/` subfolder [8][9].
7. **MV firing on insert block** — an INSERT of 3 rows flows through a trigger arrow; MV query runs only on those 3 rows; existing source rows stay grey; target gets a new partial-aggregate part [10].
8. **MV with JOIN** — updating the right dimension table: nothing happens; inserting into left table: MV fires using current dimension [10].
9. **Replacing dedupe after merge** — 3 parts each with `id=7` (ver 1,2,3); SELECT shows 3 rows; merge animation → 1 row (ver 3); FINAL shortcut does it at read time [18][19].
10. **Collapsing +1/−1 annihilation** — state and cancel rows pair up and vanish during merge [23].
11. **AggregatingMergeTree states** — `uniqState` blobs combine on merge; `uniqMerge` finalizes [22].
12. **Hash join build/probe** — right (or planner-chosen) table streams into N hash buckets (parallel_hash), left streams through probing; memory bar spills to disk at 50% ratio (26.5+) [S].
13. **Query condition cache bitmap** — first run scans all, writes 0/1 per granule; second run skips 0s (99.46M → 2.16M rows) [30].
14. **Lazy materialization** — sort only the ORDER BY column, pick top 3 row ids, then fetch wide columns only for those 3 [29].
15. **GLOBAL IN** — initiator runs subquery once and broadcasts set vs every shard re-running it [35].
16. **PREWHERE** — read filter column first, then only matching granules' other columns [28].

## 8. Puzzle ideas (concrete numbers)

| Puzzle | Setup | Answer |
|---|---|---|
| Granule math | `index_granularity=8192`, `INDEX i x TYPE minmax GRANULARITY 4`. Rows covered per index granule? | 32 768 [1] |
| How many granules? | 100M rows, granularity 8192 | ⌈100 000 000 / 8192⌉ = 12 208 granules; set index → 32 768 rows read (= 4 granules) [1] |
| Replacing count | Insert (id=1,v=1), (id=1,v=2) in two INSERTs into ReplacingMergeTree(v) ORDER BY id; `SELECT count()` immediately? | 2 (could be 1 if a merge already ran — nondeterministic); with FINAL: 1 [18] |
| Summing zero | SummingMergeTree, insert (k=1, n=5) then (k=1, n=-5); after OPTIMIZE FINAL how many rows? | 0 — all summed columns 0 → row deleted [21] |
| Collapsing | rows (k=1,+1,views=5), (k=1,−1,views=5), (k=1,+1,views=6). `sum(sign*views)`? | 6 [23] |
| MV backfill | Source has 1M rows; create MV TO target (no POPULATE), insert 10 rows. Rows processed by MV? | 10 [10][12] |
| MV + JOIN | MV joins `orders` with `customers`; you UPDATE a customer name. MV target changes? | No [10] |
| Join default | Which algorithm for right side with ~50 000 rows (estimate known)? | `hash` (below 100 000 threshold), else `parallel_hash` [S] |
| Block size | Default `max_block_size`? | 65 409 [DEF] |
| Query condition cache | 100 MB cache, 1 bit per granule: how many granules? | 838 860 800 (~839M) [30] |
| Bloom FPR | 10 000 granules none containing value, fpr 0.025: expected granules read? | ~250 (2.5%) — derived from [2] |
| Version trivia | Which version made text index GA? vector index GA? refreshable MV prod-ready? analyzer default? | 26.2 / 25.8 / 24.10 / 24.3 [S][17] |
| Lazy materialization | Does `ORDER BY ts LIMIT 20000` use lazy materialization by default on 26.x? | No — cap 10 000 [S] |

---

## Sources

- [S] https://github.com/ClickHouse/ClickHouse/blob/master/src/Core/Settings.cpp
- [MTS] https://github.com/ClickHouse/ClickHouse/blob/master/src/Storages/MergeTree/MergeTreeSettings.cpp
- [DEF] https://github.com/ClickHouse/ClickHouse/blob/master/src/Core/Defines.h
- Releases list: https://api.github.com/repos/ClickHouse/ClickHouse/releases
- [1] https://clickhouse.com/docs/optimize/skipping-indexes
- [2] https://clickhouse.com/docs/engines/table-engines/mergetree-family/mergetree
- [3] https://clickhouse.com/docs/engines/table-engines/mergetree-family/invertedindexes
- [4] https://clickhouse.com/docs/engines/table-engines/mergetree-family/annindexes
- [5] https://clickhouse.com/blog/full-text-search-ga-release ; PR https://github.com/ClickHouse/ClickHouse/pull/96794
- [6] https://clickhouse.com/docs/changelogs/25.8 ; https://aiven.io/blog/aiven-for-clickhouse-258-lts
- [7] https://clickhouse.com/docs/sql-reference/statements/explain
- [8] https://clickhouse.com/docs/data-modeling/projections
- [9] https://clickhouse.com/docs/sql-reference/statements/alter/projection
- [10] https://clickhouse.com/docs/materialized-view/incremental-materialized-view
- [11] https://clickhouse.com/docs/sql-reference/statements/create/view
- [12] https://clickhouse.com/docs/data-modeling/backfilling
- [13] https://clickhouse.com/docs/operations/system-tables/query_log
- [14] https://clickhouse.com/docs/parts
- [15] https://clickhouse.com/docs/optimize/skipping-indexes/examples (deprecation; version via secondary search result — [unverified])
- [16] https://clickhouse.com/blog/clickhouse-release-25-06 ; https://clickhouse.com/blog/projections-secondary-indices
- [17] https://clickhouse.com/blog/clickhouse-release-24-10
- [18] https://clickhouse.com/docs/engines/table-engines/mergetree-family/replacingmergetree
- [19] https://clickhouse.com/docs/guides/replacing-merge-tree
- [20] https://clickhouse.com/docs/sql-reference/statements/select/from
- [21] https://clickhouse.com/docs/engines/table-engines/mergetree-family/summingmergetree
- [22] https://clickhouse.com/docs/engines/table-engines/mergetree-family/aggregatingmergetree
- [23] https://clickhouse.com/docs/engines/table-engines/mergetree-family/collapsingmergetree
- [24] https://clickhouse.com/docs/engines/table-engines/mergetree-family/versionedcollapsingmergetree
- [25] https://clickhouse.com/docs/engines/table-engines/mergetree-family/coalescingmergetree
- [26] https://clickhouse.com/blog/clickhouse-25-6-coalescingmergetree
- [27] https://clickhouse.com/docs/development/architecture
- [28] https://clickhouse.com/docs/sql-reference/statements/select/prewhere
- [29] https://clickhouse.com/blog/clickhouse-gets-lazier-and-faster-introducing-lazy-materialization
- [30] https://clickhouse.com/blog/introducing-the-clickhouse-query-condition-cache
- [31] https://clickhouse.com/docs/operations/query-cache
- [32] https://clickhouse.com/docs/sql-reference/statements/select/join
- [33] https://clickhouse.com/blog/clickhouse-release-25-09 ; https://clickhouse.com/blog/clickhouse-release-25-10
- [34] https://clickhouse.com/docs/sql-reference/dictionaries
- [35] https://clickhouse.com/docs/sql-reference/operators/in
