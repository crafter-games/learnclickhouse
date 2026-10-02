import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { COLORS } from "./theme";

// Pico, the picker robot and guide (GDD → Art direction): a rounded amber body on wheels, with a
// screen for a face. Built from primitives in the Kenney style (soft bevels, flat colours).
export type Face = "happy" | "focus" | "wow" | "dizzy" | "blink";

const FACE_PX = 128;

function drawFace(ctx: CanvasRenderingContext2D, face: Face) {
  const s = FACE_PX;
  ctx.fillStyle = "#1d1b2e";
  ctx.fillRect(0, 0, s, s);
  ctx.fillStyle = face === "dizzy" ? "#ff8a8a" : "#7ff0dc";
  ctx.strokeStyle = ctx.fillStyle;
  ctx.lineCap = "round";
  ctx.lineWidth = 9;
  const eye = (x: number) => {
    if (face === "happy") {
      ctx.beginPath();
      ctx.arc(x, 58, 13, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
    } else if (face === "blink") {
      ctx.beginPath();
      ctx.moveTo(x - 12, 56);
      ctx.lineTo(x + 12, 56);
      ctx.stroke();
    } else if (face === "dizzy") {
      ctx.beginPath();
      ctx.moveTo(x - 10, 46);
      ctx.lineTo(x + 10, 66);
      ctx.moveTo(x + 10, 46);
      ctx.lineTo(x - 10, 66);
      ctx.stroke();
    } else {
      const h = face === "wow" ? 30 : 22;
      ctx.beginPath();
      ctx.roundRect(x - 9, 56 - h / 2, 18, h, 9);
      ctx.fill();
    }
  };
  eye(42);
  eye(86);
  ctx.beginPath();
  if (face === "wow") ctx.arc(64, 92, 8, 0, Math.PI * 2);
  else if (face === "dizzy") {
    ctx.moveTo(48, 94);
    ctx.quadraticCurveTo(56, 86, 64, 94);
    ctx.quadraticCurveTo(72, 102, 80, 94);
  } else if (face === "focus") {
    ctx.moveTo(54, 92);
    ctx.lineTo(74, 92);
  } else ctx.arc(64, 82, 14, Math.PI * 0.15, Math.PI * 0.85);
  if (face === "wow") ctx.fill();
  else ctx.stroke();
}

export class Pico {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private faceCtx: CanvasRenderingContext2D;
  private faceTex: THREE.CanvasTexture;
  private lamp: THREE.MeshStandardMaterial;
  private wheels: THREE.Mesh[] = [];
  private face: Face = "happy";
  private t = Math.random() * 10;
  private nextBlink = 2.5;
  /** Speed in units/s, set by the stage while driving (spins the wheels, leans forward). */
  speed = 0;

  constructor() {
    const amber = new THREE.MeshStandardMaterial({ color: COLORS.amber, roughness: 0.55 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x3b3654, roughness: 0.7 });
    const trim = new THREE.MeshStandardMaterial({ color: COLORS.amberDark, roughness: 0.6 });

    const torso = new THREE.Mesh(new RoundedBoxGeometry(0.62, 0.46, 0.48, 4, 0.12), amber);
    torso.position.y = 0.42;
    const belt = new THREE.Mesh(new RoundedBoxGeometry(0.64, 0.1, 0.5, 2, 0.04), trim);
    belt.position.y = 0.24;
    const head = new THREE.Mesh(new RoundedBoxGeometry(0.56, 0.4, 0.42, 4, 0.12), amber);
    head.position.y = 0.86;

    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = FACE_PX;
    this.faceCtx = canvas.getContext("2d")!;
    this.faceTex = new THREE.CanvasTexture(canvas);
    this.faceTex.colorSpace = THREE.SRGBColorSpace;
    drawFace(this.faceCtx, this.face);
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.42, 0.3),
      new THREE.MeshStandardMaterial({ map: this.faceTex, emissiveMap: this.faceTex, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.3 }),
    );
    screen.position.set(0, 0.86, 0.212);

    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.2), dark);
    antenna.position.y = 1.15;
    this.lamp = new THREE.MeshStandardMaterial({ color: 0xffd36b, emissive: 0xffb020, emissiveIntensity: 0.4 });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), this.lamp);
    bulb.position.y = 1.27;

    // A little scanner on the right arm: the thing that "opens" boxes
    const arm = new THREE.Mesh(new RoundedBoxGeometry(0.12, 0.3, 0.12, 2, 0.05), trim);
    arm.position.set(0.38, 0.42, 0.04);
    const scanner = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.1, 0.2, 2, 0.04), dark);
    scanner.position.set(0.38, 0.28, 0.12);
    const armL = arm.clone();
    armL.position.x = -0.38;

    for (const x of [-0.24, 0.24]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.1, 20), dark);
      w.rotation.z = Math.PI / 2;
      w.position.set(x, 0.11, 0);
      this.wheels.push(w);
      this.root.add(w);
    }

    this.body.add(torso, belt, head, screen, antenna, bulb, arm, armL, scanner);
    this.body.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    this.root.add(this.body);
  }

  setFace(face: Face) {
    if (face === this.face) return;
    this.face = face;
    drawFace(this.faceCtx, face);
    this.faceTex.needsUpdate = true;
  }

  /** Antenna lamp flash while scanning a box. */
  flash(on: boolean) {
    this.lamp.emissiveIntensity = on ? 2.2 : 0.4;
    this.lamp.emissive.setHex(on ? 0x34e0c8 : 0xffb020);
  }

  update(dt: number) {
    this.t += dt;
    // Idle bob, faster and lower while driving
    const moving = Math.abs(this.speed) > 0.05;
    this.body.position.y = moving ? Math.abs(Math.sin(this.t * 14)) * 0.025 : Math.sin(this.t * 2.2) * 0.02;
    this.body.rotation.x = moving ? 0.08 : 0;
    for (const w of this.wheels) w.rotation.x += (this.speed * dt) / 0.11;
    // Blink every few seconds unless the face is doing something
    if (this.face === "happy" || this.face === "focus") {
      this.nextBlink -= dt;
      if (this.nextBlink < 0) {
        const prev = this.face;
        this.setFace("blink");
        setTimeout(() => this.face === "blink" && this.setFace(prev), 140);
        this.nextBlink = 2.5 + Math.random() * 3;
      }
    }
  }
}
