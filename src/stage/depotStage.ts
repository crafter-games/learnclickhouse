import * as THREE from "three";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { Part, QueryResult, Table } from "@/sim/table";
import { materialsOf, model } from "./models";
import { Pico, type Face } from "./pico";
import { COLORS, COLUMN_COLORS } from "./theme";
import { Tweens, easeInOutCubic, easeOutBack, easeOutCubic, wait } from "./tweens";

// The warehouse (GDD → Verbos del almacén). World units: 1 shelf cell = 1 box.
// Column layout: one aisle (rack line) per column, one box per granule.
// Row layout (World 1's "before"): a single long rack where each granule's boxes sit side by side,
// one per column — every box of a row block is stored together.
// Racks run along +x; each rack has a walkway in front of it (towards the camera) for Pico.
const AISLE = 2.25; // distance between racks
const WALK = 1.12; // walkway offset in front of a rack (centre of the gap, clear of uprights)
const START_X = 0; // first shelf cell
const SECTION_GAP = 0.55; // space between parts (sections)
const RACK_Y = 0.42; // top of the rollers
const DRIVE_SPEED = 4.2; // Pico, units per second
const FOV = 35;
const READ = new THREE.Color(COLORS.read);
const SKIPPED = new THREE.Color(0xcfcbdf);
const WHITE = new THREE.Color(0xffffff);
/** General shot: from the front, a little to the right and above. */
const GENERAL_DIR = new THREE.Vector3(0.24, 0.74, 1).normalize();

export type Layout = "rows" | "columns";

export type StageLabels = {
  column: (name: string, type: string) => string;
  part: (name: string) => string;
  dock: string;
  /** Tag of the single rack in the row layout. */
  rows: string;
};

export type BoxSound = "read" | "skip" | "seal" | "land" | "truck";

export type StageOptions = {
  /** Called for every box Pico opens or skips, and other stage-timed sounds. */
  onSound?: (sound: BoxSound, index?: number) => void;
};

type BoxState = "idle" | "read" | "skipped";
type Box = {
  granule: number;
  column: number;
  obj: THREE.Object3D;
  mats: THREE.MeshStandardMaterial[];
  maps: (THREE.Texture | null)[];
  state: BoxState;
  /** Visual size (compression), applied on top of squash animations. */
  size: number;
};
type Section = { part: Part; x0: number; width: number; boxes: Box[]; tag: CSS2DObject; racks: THREE.Object3D[] };

type Shot = { pos: THREE.Vector3; look: THREE.Vector3; off: { x: number; y: number } };

function label(className: string, html: string) {
  const outer = document.createElement("div");
  const inner = document.createElement("div");
  inner.className = className;
  inner.innerHTML = html;
  outer.appendChild(inner);
  return { outer, inner, obj: new CSS2DObject(outer) };
}

export class DepotStage {
  private renderer: THREE.WebGLRenderer;
  private labels2d: CSS2DRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 200);
  private tweens = new Tweens();
  private pico = new Pico();
  private sections: Section[] = [];
  private aisleTags: HTMLElement[] = [];
  private aisleProps: THREE.Object3D[] = [];
  private rowTag: { obj: CSS2DObject; inner: HTMLElement } | null = null;
  private truck: THREE.Object3D | null = null;
  private frame = 0;
  private last = performance.now();
  private resizeObs: ResizeObserver;
  private disposed = false;
  private insets = { top: 0, right: 0, bottom: 0, left: 0 };
  /** Where the camera is and where it is heading. */
  private cam: Shot = { pos: new THREE.Vector3(10, 10, 14), look: new THREE.Vector3(), off: { x: 0, y: 0 } };
  private camTarget: Shot | null = null;
  private follow = false;
  private busy = Promise.resolve();
  private deliveries = new Map<string, Promise<void>>();
  private layout: Layout;
  readonly ready: Promise<void>;

  constructor(
    private host: HTMLElement,
    private table: Table,
    private text: StageLabels,
    private options: StageOptions = {},
  ) {
    this.layout = table.storage === "row" ? "rows" : "columns";
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.domElement.setAttribute("aria-hidden", "true");
    this.renderer.domElement.style.display = "block";
    host.appendChild(this.renderer.domElement);

    this.labels2d = new CSS2DRenderer();
    Object.assign(this.labels2d.domElement.style, { position: "absolute", inset: "0", pointerEvents: "none" });
    host.appendChild(this.labels2d.domElement);

    this.lights();
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(host);
    this.ready = this.build().then(() => {
      this.resize();
      this.snapCamera();
      this.loop();
    });
  }

  /** Run one animation at a time, in order (deliveries, queries, layout changes). */
  private queue(run: () => Promise<void>) {
    const next = this.busy.then(async () => {
      await this.ready;
      if (!this.disposed) await run();
    });
    this.busy = next.catch(() => {});
    return next;
  }

  // ------------------------------------------------------------------ layout

  private get columns() {
    return this.table.columns;
  }
  private rackZ(c: number) {
    return c * AISLE;
  }
  /** The rack line the row layout uses: a middle aisle. */
  private get rowLine() {
    return Math.floor((this.columns.length - 1) / 2);
  }
  private walkZ(line: number) {
    return this.rackZ(line) + WALK;
  }
  private get frontZ() {
    return this.rackZ(this.columns.length - 1) + WALK + 1.4;
  }
  private get homePos() {
    return new THREE.Vector3(this.leftAisleX, 0, this.walkZ(this.columns.length - 1));
  }
  private get dockPos() {
    return new THREE.Vector3(START_X - 5.2, 0, this.frontZ + 0.4);
  }
  /** Cross aisles: Pico only changes walkway along these, never across the racks. */
  private get leftAisleX() {
    return START_X - 1.9;
  }
  private get rightAisleX() {
    const last = this.sections[this.sections.length - 1];
    return (last ? last.x0 + last.width : START_X) + 0.9;
  }
  private sectionWidth(part: Part, layout = this.layout) {
    return part.granules.length * (layout === "rows" ? this.columns.length : 1);
  }
  /** Rack line and x of a box in a layout. */
  private slot(x0: number, granule: number, column: number, layout = this.layout) {
    if (layout === "rows") return { line: this.rowLine, x: x0 + granule * this.columns.length + column + 0.5 };
    return { line: column, x: x0 + granule + 0.5 };
  }
  private boxPos(x0: number, b: Box, layout = this.layout) {
    const { line, x } = this.slot(x0, b.granule, b.column, layout);
    return new THREE.Vector3(x, RACK_Y, this.rackZ(line));
  }
  private nextSectionX() {
    const last = this.sections[this.sections.length - 1];
    return last ? last.x0 + last.width + SECTION_GAP : START_X;
  }
  /** World-space bounds of what the general shot must show. */
  private contentBounds() {
    const maxX = Math.max(this.nextSectionX() + 1.2, START_X + 7);
    return new THREE.Box3(new THREE.Vector3(this.dockPos.x - 0.6, 0, this.rackZ(0) - 0.9), new THREE.Vector3(maxX, 1.3, this.frontZ));
  }

  // ------------------------------------------------------------------ build

  private lights() {
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xa79fcf, 1.8));
    const sun = new THREE.DirectionalLight(0xfff0dc, 2.3);
    sun.position.set(-6, 14, 9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.radius = 4;
    sun.shadow.bias = -0.0008;
    Object.assign(sun.shadow.camera, { left: -16, right: 30, top: 16, bottom: -12, near: 1, far: 50 });
    sun.target.position.set(8, 0, 3);
    this.scene.add(sun, sun.target);
  }

  private async build() {
    const n = this.columns.length;
    // Floor: a soft platform with painted tile joints
    const x0 = -9, x1 = 33, z0 = -2.2, z1 = this.frontZ + 2.6;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.3, z1 - z0), new THREE.MeshStandardMaterial({ color: 0xe6e2f2, roughness: 0.95 }));
    slab.position.set((x0 + x1) / 2, -0.15, (z0 + z1) / 2);
    slab.receiveShadow = true;
    this.scene.add(slab);
    const joints: number[] = [];
    for (let x = x0 + 2; x < x1; x += 2) joints.push(x, 0.002, z0, x, 0.002, z1);
    for (let z = z0 + 2; z < z1; z += 2) joints.push(x0, 0.002, z, x1, 0.002, z);
    const jointGeo = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(joints, 3));
    this.scene.add(new THREE.LineSegments(jointGeo, new THREE.LineBasicMaterial({ color: 0xc9c3de })));

    // Back wall with windows, behind the first rack
    // Warm up every model this scene uses in one parallel batch
    const [wall, windowWide] = await Promise.all([
      model("factory", "structure-wall"),
      model("factory", "structure-window-wide"),
      model("factory", "structure-yellow-medium"),
      model("factory", "hopper-high-square"),
      model("factory", "box-small"),
      model("factory", "conveyor-bars-high"),
      model("factory", "structure-yellow-short"),
      model("car", "delivery"),
    ]);
    for (let x = x0 + 1; x < x1; x += 2) {
      if (Math.round((x - x0) / 2) % 3 === 1) {
        const w = windowWide.clone();
        w.position.set(x, 0, z0 + 0.1);
        this.scene.add(w);
      } else
        for (const dx of [-0.5, 0.5]) {
          const w = wall.clone();
          w.position.set(x + dx, 0, z0 + 0.1);
          this.scene.add(w);
        }
    }

    // Walkway stripes in front of each rack line
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0xf2c14e, roughness: 0.8 });
    for (let c = 0; c < n; c++) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(x1 - START_X - 1, 0.01, 0.05), stripeMat);
      stripe.position.set((START_X - 0.6 + x1) / 2, 0.012, this.walkZ(c) + 0.5);
      this.scene.add(stripe);
    }

    // Aisle signs: a yellow post with the column name (hidden in the row layout)
    const post = await model("factory", "structure-yellow-medium");
    this.columns.forEach((col, c) => {
      const p = post.clone();
      p.position.set(START_X - 1.0, 0, this.rackZ(c));
      this.scene.add(p);
      this.aisleProps.push(p);
      const tag = label("aisle-tag", `<b style="background:${COLUMN_COLORS[c % COLUMN_COLORS.length]}"></b>${this.text.column(col.name, col.type)}`);
      tag.obj.position.set(START_X - 1.0, 1.25, this.rackZ(c));
      this.scene.add(tag.obj);
      this.aisleTags.push(tag.inner);
    });
    const stripes = this.columns.map((_, c) => `<i style="background:${COLUMN_COLORS[c % COLUMN_COLORS.length]}"></i>`).join("");
    const row = label("aisle-tag aisle-tag--rows", `<span class="stripes">${stripes}</span>${this.text.rows}`);
    row.obj.position.set(START_X - 1.0, 1.25, this.rackZ(this.rowLine));
    this.scene.add(row.obj);
    this.rowTag = { obj: row.obj, inner: row.inner };
    this.applyAisleSigns(false);

    // Dock: hopper + a sign; trucks park next to it
    const hopper = await model("factory", "hopper-high-square");
    hopper.position.copy(this.dockPos).add(new THREE.Vector3(1.6, 0, -0.9));
    this.scene.add(hopper);
    const dockTag = label("stage-tag stage-tag--dock", this.text.dock);
    dockTag.obj.position.copy(hopper.position).add(new THREE.Vector3(0, 1.9, 0));
    this.scene.add(dockTag.obj);

    // Pico waits at the entrance
    this.pico.root.position.copy(this.homePos);
    this.pico.root.rotation.y = Math.PI / 2;
    this.scene.add(this.pico.root);

    // Parts that already exist (a level that starts with data)
    for (const part of this.table.activeParts) await this.addSection(part, false);
  }

  /** Column signs in the column layout, one "rows" sign in the row layout. */
  private applyAisleSigns(animate: boolean) {
    const rows = this.layout === "rows";
    this.aisleTags.forEach((t) => (t.parentElement!.style.visibility = rows ? "hidden" : "visible"));
    if (this.rowTag) (this.rowTag.obj.element as HTMLElement).style.visibility = rows ? "visible" : "hidden";
    this.aisleProps.forEach((p, c) => {
      const show = !rows || c === this.rowLine;
      if (!animate) p.scale.setScalar(show ? 1 : 0.001);
      else void this.tweens.to(p.scale, { x: show ? 1 : 0.001, y: show ? 1 : 0.001, z: show ? 1 : 0.001 }, 300, show ? easeOutBack : easeInOutCubic);
    });
  }

  // ------------------------------------------------------------------ sections (parts)

  /** Rollers + uprights for a section in the current layout. */
  private async buildRacks(x0: number, width: number) {
    const [rollers, upright] = await Promise.all([model("factory", "conveyor-bars-high"), model("factory", "structure-yellow-short")]);
    const lines = this.layout === "rows" ? [this.rowLine] : this.columns.map((_, c) => c);
    const racks: THREE.Object3D[] = [];
    for (const line of lines) {
      for (let i = 0; i < width; i++) {
        const r = rollers.clone();
        r.position.set(x0 + i + 0.5, 0, this.rackZ(line));
        racks.push(r);
      }
      // Section uprights at both ends: the part is sealed
      for (const ux of [x0 + 0.02, x0 + width - 0.02]) {
        const u = upright.clone();
        u.position.set(ux, 0, this.rackZ(line));
        racks.push(u);
      }
    }
    for (const r of racks) this.scene.add(r);
    return racks;
  }

  private async addSection(part: Part, animate: boolean) {
    const x0 = this.nextSectionX();
    const width = this.sectionWidth(part);
    const boxModel = await model("factory", "box-small");
    const racks = await this.buildRacks(x0, width);
    const boxes: Box[] = [];
    for (let g = 0; g < part.granules.length; g++)
      for (let c = 0; c < this.columns.length; c++) {
        const obj = boxModel.clone(true);
        obj.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh) mesh.material = (mesh.material as THREE.Material).clone();
        });
        // A sticker in the column's colour on the front face: which column this box holds
        const sticker = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.18), new THREE.MeshStandardMaterial({ color: COLUMN_COLORS[c % COLUMN_COLORS.length], roughness: 0.6 }));
        sticker.position.set(0, 0.3, 0.256);
        obj.add(sticker);
        obj.rotation.y = (((g * 7 + c * 3) % 5) - 2) * 0.03;
        const mats = materialsOf(obj).filter((m) => m !== sticker.material);
        const box: Box = { granule: g, column: c, obj, mats, maps: mats.map((m) => m.map), state: "idle", size: 1 };
        obj.position.copy(this.boxPos(x0, box));
        this.scene.add(obj);
        boxes.push(box);
      }
    const tag = label("part-tag", this.text.part(part.name));
    tag.obj.position.set(x0 + width / 2, 0.05, this.frontZ - 0.55);
    this.scene.add(tag.obj);
    const section: Section = { part, x0, width, boxes, tag: tag.obj, racks };
    this.sections.push(section);

    if (!animate) return section;
    // Everything starts hidden; the truck delivers it
    for (const r of racks) r.scale.setScalar(0.001);
    for (const b of boxes) b.obj.visible = false;
    tag.outer.style.visibility = "hidden";
    return section;
  }

  /** A truck backs into the dock, its boxes fly to their shelves, the section is sealed. */
  deliver(part: Part): Promise<void> {
    // The canvas (sim event) and a level script (await) can both ask for the same delivery
    const pending = this.deliveries.get(part.name);
    if (pending) return pending;
    const next = this.queue(async () => {
      const section = await this.addSection(part, true);
      this.refit();
      const truck = await this.driveTruckIn();
      void Promise.all(section.racks.map((p, i) => wait(i * 8).then(() => this.tweens.to(p.scale, { x: 1, y: 1, z: 1 }, 260, easeOutBack))));
      const from = truck.position.clone().add(new THREE.Vector3(0.6, 1.1, 0));
      await Promise.all(
        section.boxes.map((b, i) =>
          wait(i * 55).then(async () => {
            const to = this.boxPos(section.x0, b);
            b.obj.visible = true;
            await this.fly(b, from, to);
            this.options.onSound?.("land", i);
            void this.squash(b);
          }),
        ),
      );
      const tagEl = section.tag.element as HTMLElement;
      tagEl.style.visibility = "visible";
      tagEl.firstElementChild?.classList.add("is-new");
      this.options.onSound?.("seal");
      void this.driveTruckOut(truck);
    });
    this.deliveries.set(part.name, next);
    return next;
  }

  private async fly(b: Box, from: THREE.Vector3, to: THREE.Vector3, ms = 520, arc = 1.6) {
    await this.tweens.progress(ms, (p) => {
      b.obj.position.lerpVectors(from, to, p);
      b.obj.position.y += Math.sin(Math.PI * p) * arc;
    });
    b.obj.position.copy(to);
  }

  private async driveTruckIn() {
    if (!this.truck) {
      this.truck = await model("car", "delivery");
      this.truck.scale.setScalar(0.62);
      this.scene.add(this.truck);
    }
    const truck = this.truck;
    const park = this.dockPos.clone();
    truck.visible = true;
    truck.rotation.y = Math.PI / 2; // nose towards +x
    truck.position.set(park.x - 14, 0, park.z);
    this.options.onSound?.("truck");
    await this.tweens.to(truck.position, { x: park.x }, 900, easeOutCubic);
    return truck;
  }

  private async driveTruckOut(truck: THREE.Object3D) {
    await wait(250);
    await this.tweens.to(truck.position, { x: truck.position.x - 16 }, 900, (t) => t * t);
    truck.visible = false;
  }

  private async squash(b: Box) {
    const s = b.size;
    b.obj.scale.set(1.15 * s, 0.85 * s, 1.15 * s);
    await this.tweens.to(b.obj.scale, { x: s, y: s, z: s }, 160, easeOutBack);
  }

  /**
   * "Rotate the table": every box flies to its slot in the other layout, racks are rebuilt and the
   * signs swap (World 1-1's cinematic).
   */
  setLayout(layout: Layout, animate = true): Promise<void> {
    return this.queue(async () => {
      if (layout === this.layout) return;
      const old = this.sections.map((s) => ({ ...s }));
      this.layout = layout;
      this.resetBoxStates();
      // New section offsets in the new layout
      let x = START_X;
      for (const s of this.sections) {
        s.x0 = x;
        s.width = this.sectionWidth(s.part);
        x += s.width + SECTION_GAP;
      }
      // Old racks shrink away, new ones grow in
      for (const o of old) for (const r of o.racks) void this.tweens.to(r.scale, { x: 0.001, y: 0.001, z: 0.001 }, animate ? 260 : 1).then(() => this.scene.remove(r));
      for (const s of this.sections) {
        s.racks = await this.buildRacks(s.x0, s.width);
        for (const r of s.racks) r.scale.setScalar(animate ? 0.001 : 1);
        s.tag.position.set(s.x0 + s.width / 2, 0.05, this.frontZ - 0.55);
      }
      this.applyAisleSigns(animate);
      this.refit();
      if (!animate) {
        for (const s of this.sections) for (const b of s.boxes) b.obj.position.copy(this.boxPos(s.x0, b));
        return;
      }
      await wait(200);
      for (const s of this.sections) s.racks.forEach((r, i) => void wait(i * 6).then(() => this.tweens.to(r.scale, { x: 1, y: 1, z: 1 }, 280, easeOutBack)));
      let i = 0;
      const flights: Promise<void>[] = [];
      // Fly column by column so the player sees each column gather into its aisle
      for (let c = 0; c < this.columns.length; c++)
        for (const s of this.sections)
          for (const b of s.boxes.filter((bx) => bx.column === c)) {
            const delay = i++ * 110;
            flights.push(
              wait(delay).then(async () => {
                await this.fly(b, b.obj.position.clone(), this.boxPos(s.x0, b), 950, 1.8);
                this.options.onSound?.("land", i);
                void this.squash(b);
              }),
            );
          }
      await Promise.all(flights);
    });
  }

  /** Box size per column (e.g. compressed / uncompressed), animated. 1 = full size. */
  setColumnSizes(sizes: Record<string, number>) {
    return this.queue(async () => {
      const all: Promise<void>[] = [];
      for (const s of this.sections)
        for (const b of s.boxes) {
          const size = sizes[this.columns[b.column].name];
          if (size === undefined || Math.abs(size - b.size) < 0.001) continue;
          b.size = size;
          all.push(this.tweens.to(b.obj.scale, { x: size, y: size, z: size }, 450, easeOutBack));
        }
      await Promise.all(all);
    });
  }

  // ------------------------------------------------------------------ reading (queries)

  private setBox(b: Box, state: BoxState) {
    if (b.state === state) return;
    b.state = state;
    // The Kenney box is textured (colour map), so tinting can't grey it out: read and skipped
    // boxes drop the texture for a flat, unmistakable colour
    b.mats.forEach((m, i) => {
      m.map = state === "idle" ? b.maps[i] : null;
      m.color.copy(state === "read" ? READ : state === "skipped" ? SKIPPED : WHITE);
      m.emissive.setHex(state === "read" ? COLORS.read : 0x000000);
      m.emissiveIntensity = state === "read" ? 0.18 : 0;
      m.needsUpdate = true;
    });
  }

  private resetBoxStates() {
    for (const s of this.sections) for (const b of s.boxes) this.setBox(b, "idle");
    for (const t of this.aisleTags) t.classList.remove("is-dim", "is-on");
    this.rowTag?.inner.classList.remove("is-on");
  }

  /** Back to the idle look (every box closed and coloured). */
  resetBoxes() {
    return this.queue(async () => this.resetBoxStates());
  }

  /** Pico walks only the racks holding boxes the query reads, opening only those boxes. */
  playQuery(result: QueryResult): Promise<void> {
    return this.queue(async () => {
      this.resetBoxStates();
      const isRead = new Set(result.boxes.filter((b) => b.read).map((b) => `${b.part}/${b.granule}/${b.column}`));
      const readOf = (s: Section, b: Box) => isRead.has(`${s.part.name}/${b.granule}/${this.columns[b.column].name}`);
      // Rack lines with something to read, in front-to-back order
      const lines = [...new Set(this.sections.flatMap((s) => s.boxes.filter((b) => readOf(s, b)).map((b) => this.slot(s.x0, b.granule, b.column).line)))].sort((a, b) => a - b);
      if (this.layout === "columns")
        this.columns.forEach((_, c) => {
          const visited = lines.includes(c);
          this.aisleTags[c].classList.toggle("is-dim", !visited);
          this.aisleTags[c].classList.toggle("is-on", visited);
          // Aisles nobody visits fade out at once: a whole column file is never opened
          if (!visited) for (const s of this.sections) for (const b of s.boxes) if (b.column === c) this.setBox(b, "skipped");
        });
      else this.rowTag?.inner.classList.add("is-on");
      if (this.layout === "columns" && lines.length < this.columns.length) this.options.onSound?.("skip");
      this.pico.setFace("focus");
      this.follow = true;
      await wait(250);

      // Zig-zag like a real picker: one aisle left → right, the next one back
      let forward = true;
      for (const line of lines) {
        const cells = this.sections
          .flatMap((s) => s.boxes.map((b) => ({ s, b, ...this.slot(s.x0, b.granule, b.column) })))
          .filter((x) => x.line === line)
          .sort((a, b) => a.x - b.x);
        if (!forward) cells.reverse();
        await this.travel(new THREE.Vector3(forward ? START_X - 0.6 : this.rightAisleX - 0.5, 0, this.walkZ(line)));
        let k = 0;
        for (const { s, b, x } of cells) {
          await this.driveTo(new THREE.Vector3(x, 0, this.walkZ(line)), true);
          if (readOf(s, b)) {
            this.setBox(b, "read");
            this.pico.flash(true);
            this.options.onSound?.("read", k++);
            const y = b.obj.position.y;
            void this.tweens.to(b.obj.position, { y: y + 0.22 }, 110, easeOutCubic).then(() => this.tweens.to(b.obj.position, { y }, 180, easeOutBack));
            await wait(140);
            this.pico.flash(false);
          } else {
            this.setBox(b, "skipped");
            this.options.onSound?.("skip", k);
            await wait(40);
          }
        }
        await this.driveTo(new THREE.Vector3(forward ? this.rightAisleX : this.leftAisleX, 0, this.walkZ(line)), true);
        forward = !forward;
      }
      this.pico.setFace(result.boxesRead <= result.boxesTotal / 4 ? "happy" : "wow");
      await this.travel(this.homePos);
      await this.tweens.to(this.pico.root.rotation, { y: Math.PI / 2 }, 200, easeInOutCubic);
      this.follow = false;
      this.refit();
    });
  }

  setFace(face: Face) {
    this.pico.setFace(face);
  }

  /**
   * Drive along the warehouse's aisles only: to change walkway, go to the nearer cross aisle,
   * along it, then into the target walkway — never diagonally through racks.
   */
  private async travel(to: THREE.Vector3) {
    const p = this.pico.root.position.clone();
    if (Math.abs(p.z - to.z) > 0.05) {
      const cost = (x: number) => Math.abs(p.x - x) + Math.abs(to.x - x);
      const cross = cost(this.leftAisleX) <= cost(this.rightAisleX) ? this.leftAisleX : this.rightAisleX;
      await this.driveTo(new THREE.Vector3(cross, 0, p.z));
      await this.driveTo(new THREE.Vector3(cross, 0, to.z));
    }
    await this.driveTo(to);
  }

  /** Drive Pico to a point (turning first). `straight` skips the turn for runs along an aisle. */
  private async driveTo(to: THREE.Vector3, straight = false) {
    const from = this.pico.root.position.clone();
    const d = from.distanceTo(to);
    if (d < 0.01) return;
    const heading = Math.atan2(to.x - from.x, to.z - from.z);
    if (!straight) {
      let delta = heading - this.pico.root.rotation.y;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      await this.tweens.to(this.pico.root.rotation, { y: this.pico.root.rotation.y + delta }, 160, easeInOutCubic);
    } else this.pico.root.rotation.y = heading;
    const ms = (d / DRIVE_SPEED) * 1000;
    this.pico.speed = DRIVE_SPEED;
    await this.tweens.progress(ms, (p) => this.pico.root.position.lerpVectors(from, to, p), straight ? (t) => t : easeInOutCubic);
    this.pico.speed = 0;
  }

  // ------------------------------------------------------------------ camera

  setInsets(insets: Partial<typeof this.insets>) {
    this.insets = { ...this.insets, ...insets };
    this.refit();
  }

  private resize() {
    const { clientWidth: w, clientHeight: h } = this.host;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.labels2d.setSize(w, h);
    this.refit();
  }

  /** The general shot: frame the content bounds inside the free area (outside floating UI). */
  private generalShot(): Shot {
    const { clientWidth: w, clientHeight: h } = this.host;
    const { top, right, left } = this.insets;
    const bottom = w >= 1000 ? this.insets.bottom * 0.8 : this.insets.bottom;
    const aw = Math.max(160, w - left - right);
    const ah = Math.max(160, h - top - bottom);
    const box = this.contentBounds();
    const center = box.getCenter(new THREE.Vector3());
    // Find the distance at which every corner fits the free area's frustum
    const tanV = Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * (ah / h);
    const tanH = tanV * (aw / ah);
    const cam = new THREE.PerspectiveCamera(FOV, w / h);
    const fits = (dist: number) => {
      cam.position.copy(center).addScaledVector(GENERAL_DIR, dist);
      cam.lookAt(center);
      cam.updateMatrixWorld();
      const inv = cam.matrixWorldInverse;
      for (let i = 0; i < 8; i++) {
        const p = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).applyMatrix4(inv);
        const depth = -p.z;
        if (depth <= 0.1 || Math.abs(p.x) / depth > tanH * 0.96 || Math.abs(p.y) / depth > tanV * 0.96) return false;
      }
      return true;
    };
    let lo = 2, hi = 200;
    for (let k = 0; k < 30; k++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    return {
      pos: center.clone().addScaledVector(GENERAL_DIR, hi),
      look: center,
      // Shift the projection so the frame's centre sits in the middle of the free area
      off: { x: -(left - right) / 2, y: -(top - bottom) / 2 },
    };
  }

  /** Close shot behind Pico, looking down the aisle. */
  private followShot(): Shot {
    const p = this.pico.root.position;
    const { left, right, top } = this.insets;
    const bottom = this.host.clientWidth >= 1000 ? this.insets.bottom * 0.8 : this.insets.bottom;
    return {
      pos: new THREE.Vector3(p.x - 2.6, 4.6, p.z + 7.4),
      look: new THREE.Vector3(p.x + 2.4, 0.4, p.z - 1.8),
      off: { x: -(left - right) / 2, y: -(top - bottom) / 2 },
    };
  }

  private refit() {
    if (!this.host.clientWidth) return;
    this.camTarget = this.generalShot();
    const dist = this.camTarget.pos.distanceTo(this.camTarget.look);
    // Labels scale with how close the general shot is
    const zoom = Math.min(1.2, Math.max(0.7, 22 / dist));
    this.host.style.setProperty("--stage-zoom", String(zoom));
    this.host.toggleAttribute("data-compact", this.host.clientWidth < 640);
  }

  private snapCamera() {
    if (this.camTarget) this.cam = { pos: this.camTarget.pos.clone(), look: this.camTarget.look.clone(), off: { ...this.camTarget.off } };
  }

  private applyCamera() {
    const { clientWidth: w, clientHeight: h } = this.host;
    this.camera.aspect = w / h;
    this.camera.position.copy(this.cam.pos);
    this.camera.lookAt(this.cam.look);
    this.camera.setViewOffset(w, h, this.cam.off.x, this.cam.off.y, w, h);
    this.camera.updateProjectionMatrix();
  }

  private loop = () => {
    if (this.disposed) return;
    const now = performance.now();
    const dt = Math.min(64, now - this.last);
    this.last = now;
    this.tweens.update(dt);
    this.pico.update(dt / 1000);
    // Smoothly ease the camera toward the current shot (never snaps)
    const target = this.follow ? this.followShot() : this.camTarget;
    if (target) {
      const k = 1 - Math.exp(-(dt / 1000) * (this.follow ? 3.2 : 4.5));
      this.cam.pos.lerp(target.pos, k);
      this.cam.look.lerp(target.look, k);
      this.cam.off.x += (target.off.x - this.cam.off.x) * k;
      this.cam.off.y += (target.off.y - this.cam.off.y) * k;
    }
    this.applyCamera();
    this.renderer.render(this.scene, this.camera);
    this.labels2d.render(this.scene, this.camera);
    this.frame = requestAnimationFrame(this.loop);
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObs.disconnect();
    this.renderer.dispose();
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.geometry.dispose();
    });
    this.renderer.domElement.remove();
    this.labels2d.domElement.remove();
  }
}
