import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import es from "../../messages/es.json";

// Every msg("…") and choices(…, "base", [ids]) in the level files must exist in both locales.
const src = ["./world1.ts", "./world2.ts", "./world3.ts", "./world4.ts", "./world5.ts", "./world6.ts", "./world7.ts", "./world8.ts", "./world9.ts"].map((f) => readFileSync(new URL(f, import.meta.url), "utf8")).join("\n");
const keys = new Set<string>();
for (const m of src.matchAll(/msg\(\s*"([^"]+)"/g)) keys.add(m[1]);
for (const m of src.matchAll(/choices\([^,]+,\s*"([^"]+)",\s*\[([^\]]+)\]/g)) for (const id of m[2].matchAll(/"([^"]+)"/g)) keys.add(`${m[1]}.${id[1]}`);
// choices(…, "base", COLS) uses the column names
for (const m of src.matchAll(/choices\([^,]+,\s*"([^"]+)",\s*COLS\)/g)) for (const c of ["date", "customer_id", "city", "total"]) keys.add(`${m[1]}.${c}`);

const get = (obj: unknown, path: string) => path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], obj);

describe("level copy", () => {
  it.each([["en", en], ["es", es]])("%s has every level message", (_, messages) => {
    const missing = [...keys].filter((k) => typeof get((messages as { levels: unknown }).levels, k) !== "string");
    expect(missing).toEqual([]);
  });
  it("found a meaningful number of keys", () => expect(keys.size).toBeGreaterThan(60));
  it("en and es have the same keys", () => {
    const flat = (o: unknown, p = ""): string[] =>
      typeof o === "object" && o ? Object.entries(o).flatMap(([k, v]) => flat(v, p ? `${p}.${k}` : k)) : [p];
    expect(flat(es).sort()).toEqual(flat(en).sort());
  });
});

describe("placeholders", () => {
  // Text/Rich pass `b` and `code` as rich-text tag functions, so a {b} value would render a function
  it("never use the names of rich-text tags", () => {
    for (const json of [en, es]) expect(JSON.stringify(json)).not.toMatch(/\{(b|code)\}/);
  });
});

describe("ICU syntax", () => {
  // next-intl parses every message with intl-messageformat: an apostrophe right before < or {
  // starts an escaped literal and breaks rich text, so compile them all here
  it.each([["en", en], ["es", es]])("%s messages all compile", async (_, messages) => {
    const { IntlMessageFormat } = await import("intl-messageformat");
    const bad: string[] = [];
    const walk = (o: unknown, path: string) => {
      if (typeof o === "string") {
        try {
          // Every placeholder gets a value; b / code / small are rich-text tags
          const values = new Proxy({}, { get: (_t, k) => (["b", "code", "small"].includes(String(k)) ? (c: unknown) => c : 1), has: () => true });
          new IntlMessageFormat(o, "en", undefined, { ignoreTag: false }).format(values as Record<string, never>);
        } catch (e) {
          bad.push(`${path}: ${(e as Error).message}`);
        }
      } else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) walk(v, path ? `${path}.${k}` : k);
    };
    walk(messages, "");
    expect(bad).toEqual([]);
  });
});
