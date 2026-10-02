// Writes playtest/scripts/level-<id>.json for each level id given, embedding driver.js.
// Usage: node playtest/make-level-scripts.mjs 1-1 1-2 …  [--locale es] [--viewport 1440x900]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : def;
};
const locale = opt("--locale", "es");
const [w, h] = opt("--viewport", "1440x900").split("x").map(Number);
const driver = readFileSync(new URL("./driver.js", import.meta.url), "utf8");
mkdirSync(new URL("./scripts/", import.meta.url), { recursive: true });
for (const id of args) {
  const script = {
    name: `level-${id}${w < 800 ? "-mobile" : ""}`,
    path: `/${locale}/level/${id}`,
    viewport: [w, h],
    steps: [
      { wait: 4000 },
      { screenshot: "start" },
      { eval: driver },
      { wait: 1200 },
      { screenshot: "end" },
      { expect: "window.__TEST__.phase() === 'result'" },
    ],
  };
  writeFileSync(new URL(`./scripts/${script.name}.json`, import.meta.url), JSON.stringify(script, null, 1));
  console.log(`wrote ${script.name}.json`);
}
