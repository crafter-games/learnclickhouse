# Research D: Visual inspiration survey (2026-10-02)

Purpose: visual/mechanic inspiration only. Each entry: URL + "Borrow" = what we could reuse.

## 1. Official ClickHouse learning

### ClickHouse Academy: "Real-time Analytics with ClickHouse" learning path (10 modules, ~10h, 3 levels)
- L1 (Associate): M1 Intro -> M2 Architecture deep dive -> M3 Inserting data
- L2 (Professional): M4 Modeling -> M5 Analyzing -> M6 Joining -> M7 Deleting/updating
- L3: M8 Query acceleration (MVs, projections, skipping indexes) -> M9 Sharding & replication -> M10 Managing data (TTL, partitions)
- URLs: https://clickhouse.com/learn/real-time-analytics , https://learn.clickhouse.com/visitor_catalog_class/show/1872073/Real-time-Analytics-with-ClickHouse-Level-1 , https://clickhouse.com/company/events/202610-APJ-Real-time-Analytics-ClickHouse-Level3 , labs repo https://github.com/ClickHouse/clickhouse-academy
- Borrow: this order validates the curriculum: columns -> parts/inserts -> ORDER BY/sparse index -> updates/dedup -> acceleration (skip idx, MVs) -> replication last. Earn badges named after the real certs (Associate/Professional).

### Docs Best Practices (in order)
https://clickhouse.com/docs/best-practices : primary key -> data types -> materialized views -> JOINs -> partitioning key -> insert strategy (bulk/async) -> skipping indexes -> avoid mutations -> avoid OPTIMIZE FINAL -> avoid Nullable -> JSON.
- Borrow: each best practice = one "boss level" / achievement; the "avoid X" pages become trap levels where the tempting move is wrong.

### Core concepts docs with official diagrams
- Part merges: https://clickhouse.com/docs/merges — tree of small parts merging upward to ~150 GB cap; concurrent merge-thread loop; 4-step merge (decompress, merge, rebuild sparse index, compress); per-engine variants (Replacing/Summing/Aggregating).
  - Borrow: show merge as a machine with 4 visible stations; engine variants = same machine with a different "collapse rule" cartridge.
- Table parts / partitions siblings: https://clickhouse.com/docs/parts , https://clickhouse.com/docs/partitions
  - Borrow: parts as folders of per-column files; partitions as separate lanes that never merge with each other.
- Practical intro to primary indexes: https://clickhouse.com/docs/guides/clickhouse/data-modelling/sparse-primary-indexes — granules of 8192 rows, first-row key = mark, primary.idx flat array, .mrk files pointing into compressed blocks.
  - Borrow: canonical visual vocabulary (granule stripes, mark flags, binary search over marks); keep our art faithful to it.
- Index-based pruning (Mark Needham, Apr 2026): https://clickhouse.com/blog/index-based-pruning — granules g1..g4, numbered callouts, pruned vs kept granules for primary index, lightweight projection (_part_offset), minmax skip index.
  - Borrow: one unified "pruning" screen where three index types grey out granules in turn.
- Architecture overview (VLDB paper as docs): https://clickhouse.com/docs/concepts/core-concepts/academic-overview — storage/query/integration layers, replication via Keeper log + part fetch.
  - Borrow: world map for the game (layers = regions).
- Merges dashboard: part boxes sized by bytes + write amplification (shown on the merges page).
  - Borrow: a live "parts treemap" HUD and a write-amplification meter as score.
- Tom Schreiber blog posts use looping animated diagrams, e.g. parallel replicas GROUP BY over 100B rows: https://clickhouse.com/blog/clickhouse-parallel-replicas ; also authored the 13-mistakes post (below) and the JOINs-under-the-hood series https://clickhouse.com/blog/clickhouse-fully-supports-joins-full-sort-partial-merge-part3
  - Borrow: short looping animations with a consistent palette (yellow ClickHouse accent on dark), data "streams" fanning out to replicas, and a re-run-in-loop so speed is visible.

## 2. Videos / talks

- Alexey Milovidov, "ClickHouse Deep Dive" slides: https://presentations.clickhouse.com/meetup16/internals.pdf (also https://www.slideshare.net/slideshow/clickhouse-deep-dive-by-aleksei-milovidov/95740776) — MergeTree as "small set of sorted parts, like LSM", partitions never merge.
  - Borrow: frame MergeTree as "LSM without a memtable": every INSERT is a part.
- Altinity webinar "A Day in the Life of a ClickHouse Query": https://altinity.com/webinarspage/a-day-in-the-life-of-a-clickhouse-query
  - Borrow: narrative device of following one query (or one row) through the system as a character.
- Altinity "Black Magic: Skipping Indices": https://altinity.com/blog/clickhouse-black-magic-skipping-indices
  - Borrow: per-granule minmax/set/bloom badges; show when the index fails (random data) as well as succeeds.
- "An intro to column-based storage": https://www.youtube.com/watch?v=a7rmLeGK1v8 ; 5-min explainer https://www.youtube.com/watch?v=Tk3Xmayopy8 ; All Things Open "Columnar Storage" https://clickhouse.com/videos/all-things-open-columnar-storage
  - Borrow: the classic "rotate the table 90 degrees" animation (rows slicing into column strips) as the game's opening cinematic.
- "Postgres developer's guide to updates and deletes in ClickHouse": https://clickhouse.com/videos/postgres-updates-deletes
  - Borrow: side-by-side "Postgres world vs ClickHouse world" comparisons for update/delete levels.
- Official video hub: https://clickhouse.com/videos
- Common visual devices across these: color-coded column strips, granule blocks with first-value flags, merge trees growing upward, greyed-out (skipped) blocks, counters for rows/bytes read.

## 3. Interactive visualizations and games

### Directly ClickHouse
- systeminternals.dev MergeTree: https://systeminternals.dev/clickhouse/mergetree/ and primary keys https://systeminternals.dev/clickhouse/primary-keys/ — click a column header to read only it; INSERT / INSERT x5 / Force Merge buttons with Parts/Rows/Merges counters + activity log; search value to watch granules skipped; compression of different data patterns; minmax/set/bloom/ngram skip demo; partition filter.
  - Borrow: closest existing thing to our idea; it is a sandbox, not a game. Our edge = goals, constraints, scoring, narrative. Copy the counter + event-log HUD pattern.

### Databases / SQL games
- SQL Murder Mystery: https://mystery.knightlab.com (repo https://github.com/NUKnightLab/sql-mysteries) — Borrow: mystery framing that motivates each query; "whodunit" = "which granules hold the answer".
- SQL Island: https://sql-island.informatik.uni-kl.de — Borrow: gentle day-one onboarding with a story and tiny wins.
- Lost at SQL: https://lost-at-sql.therobinlord.com — Borrow: multiple cases of rising difficulty; case-file UI.
- SQL Noir / roundups: https://www.sqlnoir.com/blog/games-to-learn-sql , https://datalemur.com/blog/games-to-learn-sql — Borrow: noir theme proves story skins work for dry topics.
- Use The Index, Luke: https://use-the-index-luke.com/sql/anatomy/the-leaf-nodes — Borrow: plain, consistent figure style; contrast B-tree (row-pointing, dense) vs our sparse index (granule-pointing).
- SQL Execution Visualizer: https://sql-execution-visualizer.vercel.app/ — Borrow: step-through execution plan with "rows examined" collapsing.
- VizLearn DB modules (42 in teaching order): https://vizlearn.in/database/ ; B+ tree: https://vizlearn.app/cs/databases/b-plus-tree/ — Borrow: code-synced highlighting (SQL line lights up the visual element it affects).
- B-tree simulators: https://semicolony.dev/simulators/btree , https://systemdesignsimulator.org/internals/btree — Borrow: animated splits; contrast with ClickHouse's "never split, just merge".
- EXPLAIN plan visualizers: https://github.com/TabularisDB/explain-plan — Borrow: render ClickHouse `EXPLAIN indexes=1` (Parts x/y, Granules x/y) as a funnel graphic.

### LSM / compaction / storage engine visualizers
- Show HN interactive LSM simulator: https://news.ycombinator.com/item?id=47053251 — write path, leveled compaction cascades, live write/read/space amplification meters. Borrow: amplification meters as the trade-off score for merge levels.
- DEV interactive LSM engine: https://dev.to/ebendttl/engineering-a-high-performance-lsm-tree-storage-engine-memtables-sstables-and-compaction-3jfk — Borrow: inspect sparse index + bloom filter per file on click.
- Compactionary (BU DiSC): https://disc-projects.bu.edu/compactionary/#interactiveDemo — compaction as 4 knobs (when/how/how much/which). Borrow: expose merge policy knobs in a late "tuning" level.
- crackingwalnuts B-tree/LSM: https://crackingwalnuts.com/tools/btree-lsm — Borrow: side-by-side B-tree vs LSM toggle.
- a2z-storage-engines: https://github.com/deepshah08/a2z-storage-engines — includes row vs columnar simulator. Borrow: field-guide chapter structure.
- mini-lsm (tiered compaction chapter): https://skyzh.github.io/mini-lsm/week2-03-tiered.html — Borrow: diagrams of sorted runs per level for the merge-level art.

### Columnar formats
- DuckDB storage (row groups, column segments): https://systeminternals.dev/duckdb/storage-format/ ; MotherDuck columnar guide: https://motherduck.com/learn/columnar-storage-guide/ — Borrow: zone maps = our minmax skip index; same visual language.
- Parquet structure explainer: https://www.parquetexplorer.com/blog/parquet-file-structure/ ; metadata readers https://www.chatdb.ai/tools/parquet-metadata-reader — Borrow: nested-box drill-down (file > row group > column chunk > page) for part > column file > granule > compressed block.

### Distributed systems
- The Secret Lives of Data (Raft): https://thesecretlivesofdata.com/raft/ (mirror https://visual.ofcoder.com/) ; https://raft.github.io/ — Borrow: guided narrated step-through with moving message dots; perfect template for Keeper log + replicas fetching parts.

### Non-database teaching games (mechanics)
- Learn Git Branching: https://learngitbranching.js.org — typed commands drive animated DAG, levels with goal-state preview. Borrow: "match the target state" levels (e.g. reach this part layout / this granule count) with a ghost overlay of the goal.
- Oh My Git!: https://ohmygit.org — cards = commands, live visualization of internals. Borrow: card hand of ClickHouse actions (INSERT batch, OPTIMIZE, ADD INDEX, CREATE MV) with costs.
- Zachtronics (TIS-100, SpaceChem, Opus Magnum): https://en.wikipedia.org/wiki/TIS-100 — Borrow: histograms of solutions (rows read, bytes, merges) vs other players; multiple optimization axes.
- Factorio systems thinking: https://medium.com/gaming-is-good/factorio-taught-me-systems-thinking-part-i-f8a1d2a8a349 — Borrow: insert pipeline as conveyor belts; "too many parts" = belt backs up (backpressure) when inserts outpace merges.
- Mini Metro (no source found tying it to data systems) — Borrow: minimalist flat-color line art and escalating load pressure for a replication/sharding routing level.
- 2048 / Threes: no published LSM analogy found, but the mechanic maps cleanly: equal-sized parts combine into a bigger part, board fills up = "too many parts" game over. Borrow: core merge mini-game (part sizes as tiles, levels as tile values, partitions as separate boards).
- Tetris: Borrow: inserts falling in as blocks; batch size decides how many blocks (parts) land.

## 4. Top beginner pain points / misconceptions

Primary source: "Getting started with ClickHouse? 13 mistakes and how to avoid them" (Tom Schreiber et al., updated) https://clickhouse.com/blog/common-getting-started-issues-with-clickhouse

1. Too many parts from tiny/frequent inserts or over-granular partitioning — https://clickhouse.com/docs/knowledgebase/exception-too-many-parts , https://clickhouse.com/blog/asynchronous-data-inserts-in-clickhouse — Borrow: board-overflow fail state; batch slider and async-insert buffer power-up.
2. Partition key used like an index (high-cardinality partitions) — 13-mistakes #1, https://clickhouse.com/docs/best-practices (partitioning key) — Borrow: level where partitioning by user_id explodes part count.
3. Poor ORDER BY / primary key choice (wrong order, high-cardinality first, not matching filters) — 13-mistakes #7, https://clickhouse.com/docs/guides/clickhouse/data-modelling/sparse-primary-indexes — Borrow: reorder-key puzzle scored by granules read.
4. "PRIMARY KEY means unique" — ORDER BY is a sort/index, duplicates coexist — https://clickhouse.com/docs/guides/developer/deduplication , https://github.com/ClickHouse/ClickHouse/issues/103486 — Borrow: insert the same id twice and both rows visibly stay.
5. ReplacingMergeTree dedups only eventually; FINAL overused; mutable column in ORDER BY prevents dedup — https://dev.to/mohhddhassan/why-final-in-clickhouse-is-usually-a-design-smell-2jg2 , https://obsessiondb.com/blog/replacingmergetree-deduplication-done-right — Borrow: duplicates only vanish when the two parts merge; FINAL costs a visible CPU penalty.
6. Mutations (ALTER UPDATE/DELETE) rewrite whole parts; use lightweight updates/deletes — 13-mistakes #3, https://clickhouse.com/docs/best-practices (avoid mutations), https://clickhouse.com/videos/postgres-updates-deletes — Borrow: animate a 1-row update rewriting an entire part vs a small patch part.
7. Incremental MVs are insert triggers on the new block only (no backfill, no reaction to updates/deletes, only left table of a JOIN triggers) — 13-mistakes #12, https://clickhouse.com/docs/materialized-view/incremental-materialized-view , https://neverblink.ai/blog/clickhouse-materialized-views-explained — Borrow: MV as a pipe tapped onto the insert stream; old data sitting upstream never flows through.
8. Overusing data skipping indexes (no benefit when data not correlated with sort, slower inserts) — 13-mistakes #8, https://altinity.com/blog/clickhouse-black-magic-skipping-indices — Borrow: index costs insert time; skip rate shown per granule so useless indexes are obvious.
9. Insert-time deduplication misunderstood (block hash window, retries) — 13-mistakes #6 — Borrow: retry the same block and see it rejected; change one row and it gets in.
10. LIMIT doesn't short-circuit / point lookups treated like OLTP — 13-mistakes #9 — Borrow: LIMIT 1 with ORDER BY on a non-key column still scans everything (meter fills anyway).
11. Nullable overuse and type choices (LowCardinality, String vs enums) — 13-mistakes #5, https://clickhouse.com/docs/best-practices (avoid nullable / data types) — Borrow: compression mini-game where type choice changes column file size.
12. JOIN-heavy relational modeling and memory-limit errors; going horizontal (sharding) too early; readonly replicas when Keeper is under-resourced — 13-mistakes #2/#10/#11, https://posthog.com/blog/secrets-of-posthog-query-performance — Borrow: late-game levels where adding a shard is the tempting but wrong answer; Keeper outage turns replicas read-only.

## Takeaways for our game
- Nobody has made a goal-driven ClickHouse game; systeminternals.dev is the nearest sandbox. Our gap: objectives, constraints, scoring.
- Visual vocabulary to stay faithful to: column strips, parts as boxes, granules of 8192 with mark flags, greyed-out skipped granules, merge tree upward to a cap, partitions as separate lanes, Keeper log + fetch arrows.
- Strongest mechanics: 2048-style merge board (parts), Learn-Git-Branching goal ghosting, Zachtronics metric histograms (rows/granules read), Factorio belts for insert/MV pipelines, Secret-Lives-of-Data narrated steps for replication.
