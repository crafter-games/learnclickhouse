// Autoplays a level: answers predictions and checks with the known answers and solves tasks with
// the step's `solution` (window.__TEST__). Returns { phase, log }.
(async () => {
  const T = () => window.__TEST__;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const btn = (re) => [...document.querySelectorAll("button")].find((b) => re.test(b.textContent.trim()) && !b.disabled);
  const NEXT = /^(Next|Start the recall check|Let's go|Siguiente|Empezar el repaso|¡Vamos!)/;
  const answer = async (q) => {
    if (q.input === "number") {
      const i = document.querySelector("#answer-number");
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, String(q.answer));
      i.dispatchEvent(new Event("input", { bubbles: true }));
      await sleep(80);
      i.form.requestSubmit();
    } else document.querySelector(`[data-value="${q.answer}"]`).click();
  };
  const idle = async () => {
    for (let i = 0; i < 200 && T().step().busy; i++) await sleep(250);
  };
  const log = [];
  const done = new Set();
  const deadline = Date.now() + 240000;
  for (let g = 0; g < 600 && T().phase() !== "result" && Date.now() < deadline; g++) {
    if (T().phase() === "check") {
      if (!document.querySelector("[role=status]")) {
        await answer(T().question());
        await sleep(300);
      }
      const n = btn(/^(Next|See results|Siguiente|Ver resultados)/);
      if (n) n.click();
      await sleep(400);
      continue;
    }
    const s = T().step();
    // window.__STOP = n: return as soon as step n is on screen (for mid-level screenshots)
    if (window.__STOP !== undefined && T().phase() === "steps" && s.index >= window.__STOP) return { stopped: s.index, log };
    if (!s.ready) {
      await sleep(300);
      continue;
    }
    if (s.kind === "predict" && document.querySelector("[data-value]:not([disabled]), #answer-number:not([disabled])")) {
      await answer(T().prediction());
      await sleep(500);
      await idle();
      continue;
    }
    // Dialogue box: finish typing / turn the page until its last page shows a button
    const dlg = document.querySelector("[data-dialogue]");
    if (dlg && (dlg.dataset.dialogue === "more" || !dlg.querySelector("button"))) {
      dlg.click();
      await sleep(150);
      continue;
    }
    const next = btn(NEXT);
    if (next) {
      log.push(s.kind);
      next.click();
      await sleep(500);
      continue;
    }
    if (s.kind === "task" && document.querySelector("[data-dock]")) {
      const sol = T().solution();
      const key = `${s.index}`;
      if (sol?.columns) {
        for (const c of document.querySelectorAll("[data-column]")) {
          const want = sol.columns.includes(c.dataset.column);
          if ((c.getAttribute("aria-pressed") === "true") !== want) c.click();
        }
        await sleep(200);
        document.querySelector("[data-run]:not([disabled])")?.click();
        await sleep(400);
        await idle();
      } else if ((sol?.settings || sol?.actions) && !done.has(key)) {
        for (const [f, v] of Object.entries(sol.settings || {})) {
          document.querySelector(`[data-setting="${f}=${v}"]`)?.click();
          await sleep(300);
        }
        for (const c of sol.orderBy || []) {
          [...document.querySelectorAll("[role=radio]")].find((b) => b.textContent.trim() === c)?.click();
          await sleep(300);
          await idle();
        }
        for (const id of sol.actions || []) {
          await idle();
          document.querySelector(`[data-action="${id}"]:not([disabled])`)?.click();
          await sleep(500);
          await idle();
        }
        done.add(key);
      } else if (sol?.orderBy && !done.has(key)) {
        for (const c of sol.orderBy) {
          [...document.querySelectorAll("[role=radio]")].find((b) => b.textContent.trim() === c)?.click();
          await sleep(300);
          await idle();
        }
        done.add(key);
      }
      await sleep(400);
      continue;
    }
    await sleep(400);
  }
  return { phase: T().phase(), log };
})();
