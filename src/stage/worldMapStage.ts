import * as THREE from "three";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { materialsOf, model, type Pack } from "./models";
import { Tweens, easeInOutCubic, easeOutBack } from "./tweens";

// World select (GDD → P12): a 3D logistics park. One warehouse (Kenney City Kit Industrial) per
// world along a road; delivery trucks drive by; the camera glides from building to building.

export type PlotSpec = {
  id: number;
  title: string;
  locked: boolean;
  /** 0–1 completion, drawn as flags on the plot. */
  progress: number;
};

const LOCK_SVG = '<svg aria-hidden="true" viewBox="0 0 256 256" width="14" height="14"><path fill="currentColor" d="M208 80h-32V56a48 48 0 0 0-96 0v24H48a16 16 0 0 0-16 16v112a16 16 0 0 0 16 16h160a16 16 0 0 0 16-16V96a16 16 0 0 0-16-16ZM96 56a32 32 0 0 1 64 0v24H96Z"/></svg>';
const SPACING = 7.5;
const ROAD_Z = 2.6;
const FOV = 32;
const CAMERA_OFFSET = new THREE.Vector3(1.8, 9.6, 18.5);

/** What stands on each world's plot (models + offsets), so the building says what the world is about. */
const PLOTS: Record<number, { pack: Pack; name: string; x: number; z: number; ry?: number; s?: number }[]> = {
  1: [
    { pack: "city", name: "building-i", x: 0, z: -0.6, s: 2.2 },
    { pack: "factory", name: "box-small", x: 1.9, z: 0.9, s: 1 },
    { pack: "factory", name: "box-small", x: 2.4, z: 1.2, ry: 0.4, s: 1 },
    { pack: "factory", name: "box-small", x: 2.1, z: 1.0, ry: 0.2, s: 0.9 },
  ],
  2: [
    { pack: "city", name: "building-s", x: 0, z: -0.6, s: 2.2 },
    { pack: "car", name: "delivery", x: -1.6, z: 1.1, ry: Math.PI, s: 0.55 },
    { pack: "factory", name: "box-small", x: 1.7, z: 1.1, s: 1 },
  ],
  3: [
    { pack: "city", name: "building-k", x: 0, z: -0.6, s: 2.2 },
    { pack: "city", name: "detail-tank", x: 2.2, z: 0.6, s: 1.6 },
    { pack: "factory", name: "structure-yellow-medium", x: -2.1, z: 1.0, s: 1 },
  ],
  4: [
    { pack: "city", name: "building-j", x: -0.4, z: -0.6, s: 2.2 },
    { pack: "city", name: "shipping-container-a", x: 2.2, z: 0.4, ry: 0.2, s: 1.5 },
    { pack: "city", name: "shipping-container-b", x: 2.3, z: 1.4, ry: -0.1, s: 1.5 },
  ],
};
const UPCOMING = [
  { pack: "city" as Pack, name: "building-h", x: 0, z: -0.6, s: 2.0 },
  { pack: "factory" as Pack, name: "warning-orange", x: -1.8, z: 1.2, s: 1 },
  { pack: "factory" as Pack, name: "warning-orange", x: 1.9, z: 1.0, s: 1 },
];

const plotPos = (i: number) => new THREE.Vector3(i * SPACING, 0, 0);

type Plot = { group: THREE.Group; ring: THREE.Mesh; tag: HTMLElement; spec: PlotSpec };

export class WorldMapStage {
  private renderer: THREE.WebGLRenderer;
  private labels: CSS2DRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 300);
  private tweens = new Tweens();
  private plots: Plot[] = [];
  private trucks: { obj: THREE.Object3D; dir: 1 | -1; speed: number }[] = [];
  private focus = new THREE.Vector3();
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private offY = 0;
  private selected = 0;
  private frame = 0;
  private last = performance.now();
  private t = 0;
  private disposed = false;
  private resizeObs: ResizeObserver;
  private insets = { top: 0, bottom: 0 };
  private raycaster = new THREE.Raycaster();
  private sun: THREE.DirectionalLight;
  readonly ready: Promise<void>;

  constructor(
    private host: HTMLElement,
    private specs: PlotSpec[],
    private onPick: (index: number) => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.style.touchAction = "pan-y";
    this.renderer.domElement.setAttribute("aria-hidden", "true");
    host.appendChild(this.renderer.domElement);
    this.labels = new CSS2DRenderer();
    Object.assign(this.labels.domElement.style, { position: "absolute", inset: "0", pointerEvents: "none" });
    host.appendChild(this.labels.domElement);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xa79fcf, 1.8));
    this.sun = new THREE.DirectionalLight(0xfff0dc, 2.3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.radius = 4;
    this.sun.shadow.bias = -0.0008;
    Object.assign(this.sun.shadow.camera, { left: -14, right: 14, top: 12, bottom: -12, near: 1, far: 60 });
    this.scene.add(this.sun, this.sun.target);

    this.renderer.domElement.addEventListener("pointerdown", this.onPointer);
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(host);
    this.ready = this.build().then(() => {
      this.focus.copy(plotPos(this.selected));
      this.camPos.copy(this.focus).add(CAMERA_OFFSET);
      this.camLook.copy(this.focus);
      this.resize();
      this.loop();
    });
  }

  private async build() {
    const n = this.specs.length;
    const x0 = -10, x1 = (n - 1) * SPACING + 10;
    // Ground and road
    const ground = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.3, 16), new THREE.MeshStandardMaterial({ color: 0xe1dcf0, roughness: 1 }));
    ground.position.set((x0 + x1) / 2, -0.16, 0.5);
    ground.receiveShadow = true;
    const road = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.02, 2.2), new THREE.MeshStandardMaterial({ color: 0x8f88b4, roughness: 0.9 }));
    road.position.set((x0 + x1) / 2, 0.005, ROAD_Z);
    road.receiveShadow = true;
    this.scene.add(ground, road);
    const dashMat = new THREE.MeshStandardMaterial({ color: 0xf6f2ff });
    for (let x = x0 + 0.5; x < x1; x += 1.4) {
      const dash = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.01, 0.08), dashMat);
      dash.position.set(x, 0.02, ROAD_Z);
      this.scene.add(dash);
    }
    // Background scenery behind the plots: a row of pale buildings and chimneys
    const backdrop = ["building-a", "building-d", "building-m", "building-c", "building-g", "building-b"];
    let k = 0;
    for (let x = x0 + 2; x < x1 - 1; x += 2.8) {
      const b = await model("city", backdrop[k++ % backdrop.length], true);
      b.position.set(x, 0, -6.2);
      b.scale.setScalar(1.25);
      for (const m of materialsOf(b)) m.color.lerp(new THREE.Color(0xe4def3), 0.72);
      this.scene.add(b);
    }

    for (const [i, spec] of this.specs.entries()) this.plots.push(await this.buildPlot(i, spec));

    // Trucks driving both ways
    for (const [dir, z] of [[1, ROAD_Z + 0.5], [-1, ROAD_Z - 0.5]] as const) {
      const truck = await model("car", "delivery");
      truck.scale.setScalar(0.5);
      truck.rotation.y = dir === 1 ? Math.PI / 2 : -Math.PI / 2;
      truck.position.set(dir === 1 ? x0 : x1, 0, z);
      this.scene.add(truck);
      this.trucks.push({ obj: truck, dir, speed: dir === 1 ? 2.4 : 1.9 });
    }
    this.xRange = [x0, x1];
  }

  private xRange: [number, number] = [0, 0];

  private async buildPlot(i: number, spec: PlotSpec): Promise<Plot> {
    const group = new THREE.Group();
    group.position.copy(plotPos(i));
    group.userData.plot = i;
    const pad = new THREE.Mesh(new THREE.BoxGeometry(6.2, 0.12, 4.4), new THREE.MeshStandardMaterial({ color: spec.locked ? 0xd4d0e2 : 0xcfc8ea, roughness: 0.95 }));
    pad.position.set(0, 0.05, -0.2);
    pad.receiveShadow = true;
    group.add(pad);
    // A soft ring under the selected plot
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.07, 8, 64), new THREE.MeshStandardMaterial({ color: 0xf5b324, emissive: 0xf5b324, emissiveIntensity: 0.4 }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(0, 0.13, -0.2);
    ring.scale.set(1, 0.72, 1);
    ring.visible = false;
    group.add(ring);

    for (const p of PLOTS[spec.id] ?? UPCOMING) {
      const m = await model(p.pack, p.name, spec.locked);
      m.position.set(p.x, 0.11, p.z);
      m.rotation.y = p.ry ?? 0;
      m.scale.setScalar(p.s ?? 1);
      if (spec.locked) for (const mat of materialsOf(m)) mat.color.lerp(new THREE.Color(0xc9c6da), 0.6);
      group.add(m);
    }

    // Completion flags along the front edge
    const flags = Math.round(spec.progress * 5);
    for (let f = 0; f < flags; f++) {
      const x = -2.6 + f * 0.5;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.8), new THREE.MeshStandardMaterial({ color: 0x2b2840 }));
      pole.position.set(x, 0.5, 1.75);
      const flag = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.22, 0.02), new THREE.MeshStandardMaterial({ color: 0xf5b324 }));
      flag.position.set(x + 0.17, 0.78, 1.75);
      pole.castShadow = flag.castShadow = true;
      group.add(pole, flag);
    }

    const outer = document.createElement("div");
    const tag = document.createElement("div");
    tag.className = "plot-tag";
    outer.appendChild(tag);
    const tagObj = new CSS2DObject(outer);
    tagObj.position.set(0, 0.1, 2.05);
    group.add(tagObj);
    tag.innerHTML = `<b>${spec.id}</b><span>${spec.title}</span>${spec.locked ? LOCK_SVG : ""}`;
    tag.classList.toggle("is-locked", spec.locked);

    this.scene.add(group);
    return { group, ring, tag, spec };
  }

  /** Focus a plot: the camera glides there and the building pops. */
  select(index: number) {
    this.selected = Math.max(0, Math.min(this.plots.length - 1, index));
    for (const [i, p] of this.plots.entries()) {
      p.tag.classList.toggle("is-selected", i === this.selected);
      p.ring.visible = i === this.selected;
    }
    const target = plotPos(this.selected);
    void this.tweens.to(this.focus, { x: target.x, y: 0, z: target.z }, 750, easeInOutCubic);
    const g = this.plots[this.selected]?.group;
    if (g) {
      g.scale.setScalar(0.94);
      void this.tweens.to(g.scale, { x: 1, y: 1, z: 1 }, 420, easeOutBack);
    }
  }

  setInsets(insets: { top: number; bottom: number }) {
    this.insets = insets;
  }

  private onPointer = (e: PointerEvent) => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObjects(this.plots.map((p) => p.group), true)[0];
    if (!hit) return;
    let o: THREE.Object3D | null = hit.object;
    while (o && o.userData.plot === undefined) o = o.parent;
    if (o) this.onPick(o.userData.plot as number);
  };

  private resize() {
    const { clientWidth: w, clientHeight: h } = this.host;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
  }

  private loop = () => {
    if (this.disposed) return;
    const now = performance.now();
    const dt = Math.min(64, now - this.last);
    this.last = now;
    this.t += dt / 1000;
    this.tweens.update(dt);
    const { clientWidth: w, clientHeight: h } = this.host;
    // Camera: ease toward the focused plot; narrow screens step back to fit the building
    const back = w < 700 ? 1.45 : 1;
    const wantPos = this.focus.clone().add(CAMERA_OFFSET.clone().multiplyScalar(back));
    const k = 1 - Math.exp(-(dt / 1000) * 5);
    this.camPos.lerp(wantPos, k);
    this.camLook.lerp(this.focus.clone().add(new THREE.Vector3(0, 0.6, 0)), k);
    // Keep the plot centred in the free area between the header and the bottom card
    const wantOff = -((this.insets.top - this.insets.bottom) / 2);
    this.offY += (wantOff - this.offY) * k;
    this.camera.aspect = w / h;
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    this.camera.setViewOffset(w, h, 0, this.offY, w, h);
    this.camera.updateProjectionMatrix();
    this.sun.position.copy(this.focus).add(new THREE.Vector3(-6, 14, 9));
    this.sun.target.position.copy(this.focus);
    // Idle life: the selected ring pulses, trucks drive along the road
    const pulse = 1 + Math.sin(this.t * 3) * 0.02;
    this.plots[this.selected]?.ring.scale.set(pulse, 0.72 * pulse, pulse);
    for (const tr of this.trucks) {
      tr.obj.position.x += tr.dir * tr.speed * (dt / 1000);
      if (tr.dir === 1 && tr.obj.position.x > this.xRange[1]) tr.obj.position.x = this.xRange[0];
      if (tr.dir === -1 && tr.obj.position.x < this.xRange[0]) tr.obj.position.x = this.xRange[1];
    }
    this.host.style.setProperty("--stage-zoom", w < 700 ? "0.85" : "1");
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
    this.frame = requestAnimationFrame(this.loop);
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObs.disconnect();
    this.renderer.domElement.removeEventListener("pointerdown", this.onPointer);
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labels.domElement.remove();
  }
}
