// Builds playtest/scripts/m4-end.json: full progress → exam (autoplayed) → finale → certificate PNG.
import { writeFileSync } from "node:fs";
const levels = {};
for (const [w, n] of [[1, 4], [2, 5], [3, 5], [4, 4], [5, 5], [6, 5], [7, 5], [8, 5], [9, 5], [10, 5], [11, 5]]) for (let i = 1; i <= n; i++) levels[`${w}-${i}`] = { stars: 3, attempts: 1 };
const state = JSON.stringify({ state: { levels, concepts: {}, shifts: [], exam: null, name: "Ada Lovelace" }, version: 1 });
const setup = `localStorage.setItem("column-depot:progress", ${JSON.stringify(state)}); location.href = "/es/exam";`;
const examRun = `(async () => {
  const s = (ms) => new Promise((r) => setTimeout(r, ms));
  [...document.querySelectorAll("button")].find((b) => /Empezar el examen/.test(b.textContent)).click();
  await s(800);
  for (let i = 0; i < 20; i++) {
    const q = window.__TEST__.question();
    if (q.input === "number") {
      const inp = document.querySelector("#answer-number");
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(inp, String(q.answer));
      inp.dispatchEvent(new Event("input", { bubbles: true }));
      await s(60);
      inp.form.requestSubmit();
    } else document.querySelector('[data-value="' + q.answer + '"]').click();
    await s(250);
    [...document.querySelectorAll("button")].find((b) => /Siguiente|Ver resultados/.test(b.textContent) && !b.disabled)?.click();
    await s(350);
  }
  return "done";
})()`;
const cert = `(async () => {
  let url = null;
  HTMLAnchorElement.prototype.click = function () { url = this.href; };
  [...document.querySelectorAll("button")].find((b) => /Descargar/.test(b.textContent)).click();
  await new Promise((r) => setTimeout(r, 300));
  return url;
})()`;
writeFileSync(new URL("./scripts/m4-end.json", import.meta.url), JSON.stringify({ name: "m4-end", path: "/es/world", viewport: [1440, 900], steps: [{ wait: 2500 }, { eval: setup }, { wait: 3500 }, { screenshot: "exam-intro" }, { eval: examRun }, { wait: 1200 }, { screenshot: "exam-result" }, { eval: 'location.href = "/es/finale"' }, { wait: 4000 }, { screenshot: "finale" }, { eval: cert }] }));
