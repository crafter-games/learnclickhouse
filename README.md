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

Stack: Next.js 16, next-intl (en/es), Three.js with Kenney models (CC0, see [`CREDITS.md`](CREDITS.md)), Tone.js generative music, Howler SFX.

Made by [Jibaru](https://github.com/Jibaru).
