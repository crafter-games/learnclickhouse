import * as THREE from "three";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { Part, QueryResult, QuerySpec, Table } from "@/sim/table";
import { materialsOf, model } from "./models";
import { Pico, type Face } from "./pico";
import { COLORS, COLUMN_COLORS } from "./theme";
import { Tweens, easeInOutCubic, easeOutBack, easeOutCubic, wait } from "./tweens";

// The warehouse (GDD → Verbos del almacén). World units: 1 shelf cell = 1 granule.
// Aisles (columns) run along +x; each aisle has a roller rack with one box per granule and a
// walkway in front of it (towards the camera) where Pico drives.
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

export type StageLabels = {
  column: (name: string, type: string) => string;
  part: (name: string) => string;
  dock: string;
};

export type BoxSound = "read" | "skip" | "seal" | "land" | "truck";

export type StageOptions = {
  /** Called for every box Pico opens or skips, and other stage-timed sounds. */
  onSound?: (sound: BoxSound, index?: number) => void;
};

type BoxState = "idle" | "read" | "skipped";
type Box = { obj: THREE.Object3D; mats: THREE.MeshStandardMaterial[]; maps: (THREE.Texture | null)[]; state: BoxState; column: number; x: number };
type Section = { part: Part; x0: number; width: number; boxes: Box[][]; tag: CSS2DObject; props: THREE.Object3D[] };

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
  readonly ready: Promise<void>;

  constructor(
    private host: HTMLElement,
    private table: Table,
    private text: StageLabels,
    private options: StageOptions = {},
  ) {
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

  // ------------------------------------------------------------------ layout

  private get columns() {
    return this.table.columns;
  }
  private rackZ(c: number) {
    return c * AISLE;
  }
  private walkZ(c: number) {
    return this.rackZ(c) + WALK;
  }
  private get frontZ() {
    return this.rackZ(this.columns.length - 1) + WALK + 1.4;
  }
  private get homePos() {
    return new THREE.Vector3(this.leftAisleX, 0, this.walkZ(this.columns.length - 1));
  }
  /** Cross aisles: Pico only changes walkway along these, never across the racks. */
  private get leftAisleX() {
    return START_X - 1.9;
  }
  private get rightAisleX() {
    const last = this.sections[this.sections.length - 1];
    return (last ? last.x0 + last.width : START_X) + 0.9;
  }
  private get dockPos() {
    return new THREE.Vector3(START_X - 5.2, 0, this.frontZ + 0.4);
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
    Object.assign(sun.shadow.camera, { left: -16, right: 24, top: 16, bottom: -12, near: 1, far: 50 });
    sun.target.position.set(6, 0, 3);
    this.scene.add(sun, sun.target);
  }

  private async build() {
    const n = this.columns.length;
    // Floor: a soft platform with painted tile joints (the Kenney floor tiles read too dark here)
    const x0 = -9, x1 = 27, z0 = -2.2, z1 = this.frontZ + 2.6;
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(x1 - x0, 0.3, z1 - z0),
      new THREE.MeshStandardMaterial({ color: 0xe6e2f2, roughness: 0.95 }),
    );
    slab.position.set((x0 + x1) / 2, -0.15, (z0 + z1) / 2);
    slab.receiveShadow = true;
    this.scene.add(slab);
    const joints: number[] = [];
    for (let x = x0 + 2; x < x1; x += 2) joints.push(x, 0.002, z0, x, 0.002, z1);
    for (let z = z0 + 2; z < z1; z += 2) joints.push(x0, 0.002, z, x1, 0.002, z);
    const jointGeo = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(joints, 3));
    this.scene.add(new THREE.LineSegments(jointGeo, new THREE.LineBasicMaterial({ color: 0xc9c3de })));

    // Back wall with windows, behind the first rack
    const [wall, windowWide] = await Promise.all([model("factory", "structure-wall"), model("factory", "structure-window-wide")]);
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

    // Walkway stripes in front of each rack
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0xf2c14e, roughness: 0.8 });
    for (let c = 0; c < n; c++) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(x1 - START_X - 1, 0.01, 0.05), stripeMat);
      stripe.position.set((START_X - 0.6 + x1) / 2, 0.012, this.walkZ(c) + 0.5);
      this.scene.add(stripe);
    }

    // Aisle signs: a yellow post with the column name
    const post = await model("factory", "structure-yellow-medium");
    this.columns.forEach((col, c) => {
      const p = post.clone();
      p.position.set(START_X - 1.0, 0, this.rackZ(c));
      this.scene.add(p);
      const tag = label("aisle-tag", `<b style="background:${COLUMN_COLORS[c % COLUMN_COLORS.length]}"></b>${this.text.column(col.name, col.type)}`);
      tag.obj.position.set(START_X - 1.0, 1.25, this.rackZ(c));
      this.scene.add(tag.obj);
      this.aisleTags.push(tag.inner);
    });

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

    // Parts that already exist (e.g. a level that starts with data)
    for (const part of this.table.activeParts) await this.addSection(part, false);
  }

  // ------------------------------------------------------------------ sections (parts)

  private async addSection(part: Part, animate: boolean) {
    const x0 = this.nextSectionX();
    const width = part.granules.length;
    const [boxModel, rollers, upright] = await Promise.all([model("factory", "box-small"), model("factory", "conveyor-bars-high"), model("factory", "structure-yellow-short")]);
    const props: THREE.Object3D[] = [];
    const boxes: Box[][] = [];
    for (let c = 0; c < this.columns.length; c++) {
      const row: Box[] = [];
      for (let g = 0; g < width; g++) {
        const x = x0 + g + 0.5;
        const r = rollers.clone();
        r.position.set(x, 0, this.rackZ(c));
        this.scene.add(r);
        props.push(r);
        const obj = boxModel.clone(true);
        obj.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh) mesh.material = (mesh.material as THREE.Material).clone();
        });
        obj.position.set(x, RACK_Y, this.rackZ(c));
        obj.rotation.y = (((g * 7 + c * 3) % 5) - 2) * 0.03;
        this.scene.add(obj);
        const mats = materialsOf(obj);
        row.push({ obj, mats, maps: mats.map((m) => m.map), state: "idle", column: c, x });
      }
      // Section uprights at both ends: the part is sealed
      for (const ux of [x0 + 0.02, x0 + width - 0.02]) {
        const u = upright.clone();
        u.position.set(ux, 0, this.rackZ(c));
        this.scene.add(u);
        props.push(u);
      }
      boxes.push(row);
    }
    const tag = label("part-tag", this.text.part(part.name));
    tag.obj.position.set(x0 + width / 2, 0.05, this.frontZ - 0.55);
    this.scene.add(tag.obj);
    const section: Section = { part, x0, width, boxes, tag: tag.obj, props };
    this.sections.push(section);

    if (!animate) return section;
    // Everything starts hidden; the truck delivers it
    for (const p of props) p.scale.setScalar(0.001);
    for (const row of boxes) for (const b of row) b.obj.visible = false;
    tag.outer.style.visibility = "hidden";
    return section;
  }

  /** A truck backs into the dock, its boxes fly to their shelves, the section is sealed. */
  deliver(part: Part): Promise<void> {
    // The canvas (sim event) and the desk (await) both ask for the same delivery
    const pending = this.deliveries.get(part.name);
    if (pending) return pending;
    const run = async () => {
      await this.ready;
      const section = await this.addSection(part, true);
      this.refit();
      const truck = await this.driveTruckIn();
      // Racks and uprights grow in
      void Promise.all(section.props.map((p, i) => wait(i * 8).then(() => this.tweens.to(p.scale, { x: 1, y: 1, z: 1 }, 260, easeOutBack))));
      // Boxes fly from the truck to their cells, column by column
      const from = truck.position.clone().add(new THREE.Vector3(0.6, 1.1, 0));
      const flights: Promise<void>[] = [];
      let i = 0;
      for (const row of section.boxes)
        for (const b of row) {
          const delay = i++ * 55;
          flights.push(
            wait(delay).then(async () => {
              const to = b.obj.position.clone();
              b.obj.visible = true;
              b.obj.position.copy(from);
              await this.tweens.progress(520, (p) => {
                b.obj.position.lerpVectors(from, to, p);
                b.obj.position.y += Math.sin(Math.PI * p) * 1.6;
              });
              b.obj.position.copy(to);
              this.options.onSound?.("land", i);
              void this.squash(b.obj);
            }),
          );
        }
      await Promise.all(flights);
      // Seal: the part's name tag stamps in
      const tagEl = section.tag.element as HTMLElement;
      tagEl.style.visibility = "visible";
      tagEl.firstElementChild?.classList.add("is-new");
      this.options.onSound?.("seal");
      void this.driveTruckOut(truck);
    };
    const next = this.busy.then(run);
    this.busy = next.catch(() => {});
    this.deliveries.set(part.name, next);
    return next;
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

  private async squash(obj: THREE.Object3D) {
    obj.scale.set(1.15, 0.85, 1.15);
    await this.tweens.to(obj.scale, { x: 1, y: 1, z: 1 }, 160, easeOutBack);
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

  /** Back to the idle look (every box closed and coloured). */
  resetBoxes() {
    for (const s of this.sections) for (const row of s.boxes) for (const b of row) this.setBox(b, "idle");
    for (const t of this.aisleTags) t.classList.remove("is-dim", "is-on");
  }

  private boxFor(result: QueryResult, partName: string, granule: number, column: string) {
    return result.boxes.find((b) => b.part === partName && b.granule === granule && b.column === column);
  }

  /** Pico walks only the aisles of the columns the query reads, opening only the granules it needs. */
  playQuery(spec: QuerySpec, result: QueryResult): Promise<void> {
    const run = async () => {
      await this.ready;
      this.resetBoxes();
      const readCols = this.columns.map((c, i) => ({ c, i })).filter(({ c }) => result.boxes.some((b) => b.column === c.name && b.read));
      // Aisles nobody visits fade out at once: a whole column file is never opened
      this.columns.forEach((col, c) => {
        const visited = readCols.some((r) => r.i === c);
        this.aisleTags[c].classList.toggle("is-dim", !visited);
        this.aisleTags[c].classList.toggle("is-on", visited);
        if (visited) return;
        for (const s of this.sections) for (const b of s.boxes[c]) this.setBox(b, "skipped");
      });
      this.options.onSound?.("skip");
      this.pico.setFace("focus");
      this.follow = true;
      await wait(250);

      // Zig-zag like a real picker: one aisle left → right, the next one back
      let forward = true;
      for (const { c: col, i: c } of readCols) {
        const cells = this.sections.flatMap((s) => s.boxes[c].map((b, g) => ({ s, b, g })));
        if (!forward) cells.reverse();
        await this.travel(new THREE.Vector3(forward ? START_X - 0.6 : this.rightAisleX - 0.5, 0, this.walkZ(c)));
        for (const { s, b, g } of cells) {
          await this.driveTo(new THREE.Vector3(b.x, 0, this.walkZ(c)), true);
          const read = this.boxFor(result, s.part.name, g, col.name)?.read ?? false;
          if (read) {
            this.setBox(b, "read");
            this.pico.flash(true);
            this.options.onSound?.("read", g);
            void this.tweens.to(b.obj.position, { y: RACK_Y + 0.22 }, 110, easeOutCubic).then(() => this.tweens.to(b.obj.position, { y: RACK_Y }, 180, easeOutBack));
            await wait(140);
            this.pico.flash(false);
          } else {
            this.setBox(b, "skipped");
            this.options.onSound?.("skip", g);
            await wait(40);
          }
        }
        // Out of the aisle on the far side
        await this.driveTo(new THREE.Vector3(forward ? this.rightAisleX : this.leftAisleX, 0, this.walkZ(c)), true);
        forward = !forward;
      }
      this.pico.setFace(result.boxesRead <= result.boxesTotal / 4 ? "happy" : "wow");
      await this.travel(this.homePos);
      await this.tweens.to(this.pico.root.rotation, { y: Math.PI / 2 }, 200, easeInOutCubic);
      this.follow = false;
      this.refit();
      void spec;
    };
    const next = this.busy.then(run);
    this.busy = next.catch(() => {});
    return next;
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
