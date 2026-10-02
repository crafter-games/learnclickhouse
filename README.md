# Column Depot — Learn ClickHouse

A 3D warehouse game that teaches how ClickHouse really stores and reads data: columns, parts and merges, the sparse primary index and partitions. Unofficial; ClickHouse is a trademark of ClickHouse, Inc.

**Play:** https://learnclickhouse.crafter.run

- Design: [`GDD.md`](GDD.md)
- Facts (ClickHouse 26.9 / 26.8 LTS, with sources): [`docs/research/clickhouse-curriculum.md`](docs/research/clickhouse-curriculum.md)
- Learning science behind the design: [`docs/research/learning-science.md`](docs/research/learning-science.md)

## Develop

```bash
pnpm install
pnpm dev        # http://localhost:3000
pnpm test       # simulation tests (Vitest)
pnpm lint
node scripts/gen-sfx.mjs   # regenerate the synthesized sound effects
```

### Playtests

The game exposes `window.__TEST__`; `playtest/driver.js` autoplays a level (predictions, tasks via each step's `solution`, recall check).

```bash
node playtest/make-level-scripts.mjs 1-1 2-3 4-4        # writes playtest/scripts/level-<id>.json
node ~/.claude/skills/game-playtest/scripts/playtest-web.mjs playtest/scripts/level-2-3.json --url http://localhost:3000
node playtest/make-m4.mjs                                # exam → finale → certificate PNG
```

Stack: Next.js 16, next-intl (en/es), Three.js with Kenney models, music by Juhani Junkala (all CC0, see [`CREDITS.md`](CREDITS.md)), Howler for audio.

Made by [Jibaru](https://github.com/Jibaru).
