"use client";

import { ContactShadows, Environment, Html, PerspectiveCamera, useTexture } from "@react-three/drei";
import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OBJLoader } from "three-stdlib";
import {
  DEFAULT_PHYSICS,
  DEFAULT_ZONE,
  getRoundSnapshot,
  zoneRadiusAt,
  type ExplosionState,
  type PhysicsSettings,
  type PlayerState,
  type RoundSnapshot,
  type RoundTimeline,
  type TrailSegment,
  type ZoneSettings,
} from "@/lib/playback";

export type PlaybackCameraMode = "cinematic" | "follow" | "pov" | "noclip";

// Original Armagetron Advanced art, imported from the game's `textures/` dir.
const TEX = {
  floor: "/aa/textures/floor.png",
  wall: "/aa/textures/dir_wall.png",
  rim: "/aa/textures/rim_wall.png",
  sky: "/aa/textures/sky.png",
  cycleBody: "/aa/textures/cycle_body.png",
  cycleWheel: "/aa/textures/cycle_wheel.png",
} as const;

// Original AA cycle models (body + two wheels), imported from the game's `models/` dir.
const MODEL = {
  body: "/aa/models/cycle_body.obj",
  front: "/aa/models/cycle_front.obj",
  rear: "/aa/models/cycle_rear.obj",
} as const;

type CinematicSceneProps = {
  round: RoundTimeline;
  time: number;
  selectedPlayer?: string;
  cameraMode: PlaybackCameraMode;
  fov?: number;
  physics?: PhysicsSettings;
  zone?: ZoneSettings;
};

export function CinematicScene({
  round,
  time,
  selectedPlayer,
  cameraMode,
  fov = 52,
  physics = DEFAULT_PHYSICS,
  zone = DEFAULT_ZONE,
}: CinematicSceneProps) {
  const snapshot = useMemo(() => getRoundSnapshot(round, time, physics), [round, time, physics]);
  const leans = useMemo(() => computeLeans(snapshot, round.bounds), [snapshot, round.bounds]);
  const zoneRadius = zoneRadiusAt(time, zone);
  const zoneCenter = toWorld(zone.centerX, zone.centerY, round);
  const arenaSize = Math.max(round.bounds.width, round.bounds.height);

  return (
    <Canvas shadows={{ type: THREE.PCFShadowMap }} dpr={[1, 2]} gl={{ antialias: true }}>
      <color attach="background" args={["#0a1626"]} />
      <fog attach="fog" args={["#0a1626", arenaSize * 0.9, arenaSize * 2.4]} />
      <PerspectiveCamera makeDefault fov={fov} position={[0, arenaSize * 0.6, arenaSize * 0.9]} />
      {cameraMode === "noclip" ? (
        <FreeCamera />
      ) : (
        <CameraRig
          round={round}
          time={time}
          selectedPlayer={selectedPlayer}
          mode={cameraMode}
          players={snapshot.players}
        />
      )}

      <ambientLight intensity={0.25} />
      <directionalLight
        castShadow
        color="#89c7ff"
        intensity={1.8}
        position={[arenaSize * 0.35, arenaSize * 0.9, arenaSize * 0.3]}
        shadow-mapSize={[2048, 2048]}
      />
      <pointLight color="#4fdcff" intensity={12} distance={arenaSize * 1.3} position={[0, 28, 0]} />
      <pointLight color="#ff4fd8" intensity={8} distance={arenaSize} position={[-arenaSize * 0.35, 18, -arenaSize * 0.2]} />
      <pointLight color="#f8c84a" intensity={8} distance={arenaSize} position={[arenaSize * 0.35, 18, arenaSize * 0.2]} />

      <Suspense fallback={null}>
        <SkyDome arenaSize={arenaSize} />
        <ArenaFloor round={round} />
        <RimWalls round={round} />
        <TrailSegments segments={snapshot.trails} round={round} />
      </Suspense>
      {zoneRadius !== null && zoneRadius > 0.5 && (
        <SumoZone radius={zoneRadius} time={time} center={[zoneCenter.x, zoneCenter.z]} />
      )}
      <Suspense fallback={null}>
        {snapshot.players.map((player) => (
          <CycleMarker
            key={player.username}
            player={player}
            round={round}
            selected={player.username === selectedPlayer}
            lean={leans.get(player.username) ?? 0}
          />
        ))}
      </Suspense>
      {snapshot.explosions.map((explosion) => (
        <Explosion key={explosion.username} data={explosion} round={round} />
      ))}

      <ContactShadows position={[0, 0.03, 0]} opacity={0.5} scale={arenaSize * 1.5} blur={2.5} far={30} />
      <Environment preset="night" />
    </Canvas>
  );
}

// Original AA sky.png mapped onto a big inverted dome behind the arena.
function SkyDome({ arenaSize }: { arenaSize: number }) {
  const base = useTexture(TEX.sky);
  const texture = useMemo(() => {
    const clone = base.clone();
    clone.wrapS = THREE.RepeatWrapping;
    clone.wrapT = THREE.RepeatWrapping;
    clone.repeat.set(3, 3);
    clone.colorSpace = THREE.SRGBColorSpace;
    clone.needsUpdate = true;
    return clone;
  }, [base]);

  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <mesh scale={[-1, 1, 1]}>
      <sphereGeometry args={[arenaSize * 2.6, 32, 16]} />
      <meshBasicMaterial map={texture} side={THREE.BackSide} fog={false} depthWrite={false} color="#9fb6d8" />
    </mesh>
  );
}

// Free-fly "noclip" camera: WASD to move, E/Q for up/down, Shift to sprint, click-drag to look.
function FreeCamera() {
  const { camera, gl } = useThree();
  const keys = useRef(new Set<string>());
  const dragging = useRef(false);
  const last = useRef({ x: 0, y: 0 });
  const yaw = useRef(0);
  const pitch = useRef(0);
  const ready = useRef(false);

  useEffect(() => {
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);
    yaw.current = Math.atan2(direction.x, direction.z);
    pitch.current = Math.asin(THREE.MathUtils.clamp(direction.y, -1, 1));
    ready.current = true;
  }, [camera]);

  useEffect(() => {
    const dom = gl.domElement;
    const pressedKeys = keys.current;

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) {
        return;
      }
      pressedKeys.add(event.key.toLowerCase());
    };
    const onKeyUp = (event: KeyboardEvent) => pressedKeys.delete(event.key.toLowerCase());
    const onBlur = () => pressedKeys.clear();

    const onPointerDown = (event: PointerEvent) => {
      dragging.current = true;
      last.current = { x: event.clientX, y: event.clientY };
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!dragging.current) {
        return;
      }
      const dx = event.clientX - last.current.x;
      const dy = event.clientY - last.current.y;
      last.current = { x: event.clientX, y: event.clientY };
      yaw.current -= dx * 0.0032;
      pitch.current = THREE.MathUtils.clamp(pitch.current - dy * 0.0032, -1.5, 1.5);
    };
    const onPointerUp = () => {
      dragging.current = false;
    };

    dom.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);

    return () => {
      dom.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      pressedKeys.clear();
    };
  }, [gl]);

  useFrame((_, delta) => {
    if (!ready.current) {
      return;
    }

    const cosPitch = Math.cos(pitch.current);
    const forward = new THREE.Vector3(
      Math.sin(yaw.current) * cosPitch,
      Math.sin(pitch.current),
      Math.cos(yaw.current) * cosPitch,
    );
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(forward, up).normalize();

    const pressed = keys.current;
    const move = new THREE.Vector3();
    if (pressed.has("w")) move.add(forward);
    if (pressed.has("s")) move.sub(forward);
    if (pressed.has("d")) move.add(right);
    if (pressed.has("a")) move.sub(right);
    if (pressed.has("e")) move.y += 1;
    if (pressed.has("q")) move.y -= 1;

    if (move.lengthSq() > 0) {
      const speed = (pressed.has("shift") ? 95 : 32) * delta;
      camera.position.addScaledVector(move.normalize(), speed);
    }

    camera.lookAt(camera.position.clone().add(forward));
  });

  return null;
}

type CameraRigProps = {
  round: RoundTimeline;
  time: number;
  selectedPlayer?: string;
  mode: PlaybackCameraMode;
  players: PlayerState[];
};

function CameraRig({ round, time, selectedPlayer, mode, players }: CameraRigProps) {
  const { camera } = useThree();
  const lookAt = useRef(new THREE.Vector3());
  const desiredPosition = useRef(new THREE.Vector3());
  const desiredLookAt = useRef(new THREE.Vector3());
  const arenaSize = Math.max(round.bounds.width, round.bounds.height);

  useFrame((_, delta) => {
    const target = chooseCameraTarget(players, selectedPlayer);

    if (mode === "cinematic" || !target) {
      const orbit = time * 0.11;
      desiredLookAt.current.set(0, 0.9, 0);
      desiredPosition.current.set(
        Math.cos(orbit) * arenaSize * 0.55,
        arenaSize * 0.38 + Math.sin(time * 0.17) * 7,
        Math.sin(orbit) * arenaSize * 0.55,
      );
    } else {
      const targetPosition = toWorld(target.x, target.y, round);
      const heading = new THREE.Vector3(target.dirX, 0, -target.dirY).normalize();
      const side = new THREE.Vector3(-heading.z, 0, heading.x);

      if (mode === "pov") {
        desiredPosition.current.copy(targetPosition).addScaledVector(heading, -2.8).add(new THREE.Vector3(0, 1.45, 0));
        desiredLookAt.current.copy(targetPosition).addScaledVector(heading, 13).add(new THREE.Vector3(0, 1.2, 0));
      } else {
        desiredPosition.current
          .copy(targetPosition)
          .addScaledVector(heading, -18)
          .addScaledVector(side, 5)
          .add(new THREE.Vector3(0, 12, 0));
        desiredLookAt.current.copy(targetPosition).addScaledVector(heading, 8).add(new THREE.Vector3(0, 2.2, 0));
      }
    }

    const responsiveness = mode === "pov" ? 8 : mode === "follow" ? 1.9 : 3.6;
    const alpha = 1 - Math.exp(-delta * responsiveness);
    camera.position.lerp(desiredPosition.current, alpha);
    lookAt.current.lerp(desiredLookAt.current, alpha);
    camera.lookAt(lookAt.current);
  });

  return null;
}

function ArenaFloor({ round }: { round: RoundTimeline }) {
  const width = round.bounds.width;
  const height = round.bounds.height;
  const base = useTexture(TEX.floor);
  const texture = useMemo(() => {
    const clone = base.clone();
    clone.wrapS = THREE.RepeatWrapping;
    clone.wrapT = THREE.RepeatWrapping;
    // floor.png tiles every ~20 game units, like the original arena floor.
    clone.repeat.set(width / 20, height / 20);
    clone.anisotropy = 8;
    clone.colorSpace = THREE.SRGBColorSpace;
    clone.needsUpdate = true;
    return clone;
  }, [base, width, height]);

  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <group>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
        <planeGeometry args={[width, height, 1, 1]} />
        <meshStandardMaterial
          map={texture}
          color="#3f5d86"
          metalness={0.2}
          roughness={0.78}
          emissive="#0a1830"
          emissiveIntensity={0.18}
        />
      </mesh>
      <ArenaGrid round={round} />
    </group>
  );
}

// 1x1 game-unit floor grid, phase-aligned to integer map coordinates so the scale is
// honest, with brighter lines every 10 units for readability.
function ArenaGrid({ round }: { round: RoundTimeline }) {
  const { minX, maxX, minY, maxY, centerX, centerY } = round.bounds;

  const { minor, major } = useMemo(() => {
    const minorPos: number[] = [];
    const majorPos: number[] = [];
    const z0 = -(minY - centerY);
    const z1 = -(maxY - centerY);
    const x0 = minX - centerX;
    const x1 = maxX - centerX;

    for (let mx = Math.ceil(minX); mx <= Math.floor(maxX); mx += 1) {
      const wx = mx - centerX;
      const target = ((mx % 10) + 10) % 10 === 0 ? majorPos : minorPos;
      target.push(wx, 0.01, z0, wx, 0.01, z1);
    }

    for (let my = Math.ceil(minY); my <= Math.floor(maxY); my += 1) {
      const wz = -(my - centerY);
      const target = ((my % 10) + 10) % 10 === 0 ? majorPos : minorPos;
      target.push(x0, 0.01, wz, x1, 0.01, wz);
    }

    const buildGeometry = (positions: number[]) => {
      const buffer = new THREE.BufferGeometry();
      buffer.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      return buffer;
    };

    return { minor: buildGeometry(minorPos), major: buildGeometry(majorPos) };
  }, [minX, maxX, minY, maxY, centerX, centerY]);

  useEffect(() => {
    return () => {
      minor.dispose();
      major.dispose();
    };
  }, [minor, major]);

  return (
    <group>
      <lineSegments geometry={minor}>
        <lineBasicMaterial color="#2ee9ff" transparent opacity={0.06} />
      </lineSegments>
      <lineSegments geometry={major}>
        <lineBasicMaterial color="#39e0ff" transparent opacity={0.2} />
      </lineSegments>
    </group>
  );
}

function RimWalls({ round }: { round: RoundTimeline }) {
  const width = round.bounds.width;
  const height = round.bounds.height;
  const texture = useTexture(TEX.rim);
  const h = 4;
  const panel = 8; // one rim_wall panel every ~8 game units

  return (
    <group>
      <RimWall texture={texture} position={[0, h / 2, -height / 2]} scale={[width, h, 0.4]} repeatX={width / panel} />
      <RimWall texture={texture} position={[0, h / 2, height / 2]} scale={[width, h, 0.4]} repeatX={width / panel} />
      <RimWall texture={texture} position={[-width / 2, h / 2, 0]} scale={[0.4, h, height]} repeatX={height / panel} />
      <RimWall texture={texture} position={[width / 2, h / 2, 0]} scale={[0.4, h, height]} repeatX={height / panel} />
    </group>
  );
}

function RimWall({
  texture,
  position,
  scale,
  repeatX,
}: {
  texture: THREE.Texture;
  position: [number, number, number];
  scale: [number, number, number];
  repeatX: number;
}) {
  // Clone so each wall can tile the shared image at its own length without fighting.
  const map = useMemo(() => {
    const clone = texture.clone();
    clone.wrapS = THREE.RepeatWrapping;
    clone.wrapT = THREE.RepeatWrapping;
    clone.repeat.set(Math.max(1, Math.round(repeatX)), 1);
    clone.colorSpace = THREE.SRGBColorSpace;
    clone.needsUpdate = true;
    return clone;
  }, [texture, repeatX]);

  useEffect(() => () => map.dispose(), [map]);

  return (
    <mesh castShadow receiveShadow position={position} scale={scale}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial
        map={map}
        color="#b7cdf0"
        emissive="#21407a"
        emissiveIntensity={0.55}
        metalness={0.3}
        roughness={0.5}
        transparent
        opacity={0.94}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

// Shared trail box: two broad faces (+Z / -Z), top, and ends carry different brightness.
// Combined with the per-instance player colour (instanceColor), this gives each side of a
// wall a distinct shade so neighbouring walls stay readable in tight gaps.
function makeTrailGeometry(): THREE.BoxGeometry {
  const box = new THREE.BoxGeometry(1, 1.4, 0.14);
  // BoxGeometry face order: +X, -X, +Y, -Y, +Z, -Z (4 vertices each).
  const faceTint = [0.82, 0.82, 1.3, 0.45, 1.12, 0.66];
  const tint: number[] = [];
  for (let face = 0; face < 6; face += 1) {
    for (let vertex = 0; vertex < 4; vertex += 1) {
      const value = faceTint[face];
      tint.push(value, value, value);
    }
  }
  box.setAttribute("color", new THREE.Float32BufferAttribute(tint, 3));
  return box;
}

function TrailSegments({ segments, round }: { segments: TrailSegment[]; round: RoundTimeline }) {
  // One geometry shared by every player's mesh; disposed when the scene unmounts.
  const geometry = useMemo(() => makeTrailGeometry(), []);
  useEffect(() => () => geometry.dispose(), [geometry]);

  // Original AA cycle-wall texture, tinted per player via instanceColor.
  const wallBase = useTexture(TEX.wall);
  const wallTexture = useMemo(() => {
    const clone = wallBase.clone();
    clone.colorSpace = THREE.SRGBColorSpace;
    clone.needsUpdate = true;
    return clone;
  }, [wallBase]);
  useEffect(() => () => wallTexture.dispose(), [wallTexture]);

  // Group the live segments by player so each player draws in its own pass. Walls are
  // kept geometrically exact (corners line up perfectly); z-fighting between two players'
  // coplanar walls is avoided with a per-player depth bias (polygonOffset) instead of a
  // positional nudge, which used to leave a notch at every corner.
  const byPlayer = useMemo(() => {
    const groups = new Map<string, TrailSegment[]>();
    for (const segment of segments) {
      const list = groups.get(segment.username);
      if (list) {
        list.push(segment);
      } else {
        groups.set(segment.username, [segment]);
      }
    }
    return groups;
  }, [segments]);

  return (
    <>
      {round.players.map((player, index) => (
        <PlayerTrailMesh
          key={player.username}
          geometry={geometry}
          texture={wallTexture}
          segments={byPlayer.get(player.username) ?? EMPTY_SEGMENTS}
          round={round}
          capacity={Math.max(1, player.trails.length)}
          // Distinct, evenly-spread depth bias per player. Centred around 0 so nobody is
          // pushed too far; the gap (2 units) is plenty to win the depth tie cleanly.
          depthBias={(index - (round.players.length - 1) / 2) * 2}
        />
      ))}
    </>
  );
}

const EMPTY_SEGMENTS: TrailSegment[] = [];

function PlayerTrailMesh({
  geometry,
  texture,
  segments,
  round,
  capacity,
  depthBias,
}: {
  geometry: THREE.BoxGeometry;
  texture: THREE.Texture;
  segments: TrailSegment[];
  round: RoundTimeline;
  capacity: number;
  depthBias: number;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);

  useLayoutEffect(() => {
    const mesh = meshRef.current;

    if (!mesh) {
      return;
    }

    mesh.count = segments.length;

    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      const transform = getTrailTransform(segment, round);
      // intensity < 1 means a dead player's wall is expiring: sink and dim it.
      const intensity = THREE.MathUtils.clamp(segment.intensity, 0, 1);
      const height = 0.25 + 0.75 * intensity;
      dummy.position.set(transform.position[0], transform.position[1] * height, transform.position[2]);
      dummy.rotation.set(0, transform.rotationY, 0);
      dummy.scale.set(transform.length, height, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      color.set(segment.color).multiplyScalar(0.35 + 0.65 * intensity);
      mesh.setColorAt(index, color);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }
    mesh.computeBoundingSphere();
  }, [color, dummy, round, segments]);

  return (
    <instancedMesh ref={meshRef} args={[geometry, undefined, capacity]}>
      {/* vertexColors (per-face brightness) × instanceColor (player hue) = tinted sides.
          Opaque on purpose: transparent walls flicker/sort badly where they overlap.
          polygonOffset gives each player a distinct depth so coplanar walls don't fight. */}
      <meshBasicMaterial
        map={texture}
        vertexColors
        toneMapped={false}
        polygonOffset
        polygonOffsetFactor={0}
        polygonOffsetUnits={depthBias}
      />
    </instancedMesh>
  );
}

function getTrailTransform(segment: TrailSegment, round: RoundTimeline) {
  const from = toWorld(segment.from[0], segment.from[1], round);
  const to = toWorld(segment.to[0], segment.to[1], round);
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const length = Math.max(0.05, Math.hypot(dx, dz));
  const position: [number, number, number] = [(from.x + to.x) / 2, 0.65, (from.z + to.z) / 2];
  const rotationY = -Math.atan2(dz, dx);
  return { length, position, rotationY };
}

// Overall scale for the imported cycle models. 0.95 read too big and a literal 0.5 (the
// game's glScalef) too small against our wall sizing, so split the difference.
const CYCLE_SCALE = 0.72;

// AA cycle textures are greyscale + alpha: the alpha marks the painted detail and the
// transparent areas get filled with the player colour (see gTextureCycle::ProcessImage in
// gCycle.cpp). We replicate that blend once per colour and cache the resulting canvas.
const cycleTextureCache = new Map<string, Promise<THREE.CanvasTexture>>();

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

async function blendedCycleTexture(url: string, color: string, darken: number): Promise<THREE.CanvasTexture> {
  const key = `${url}|${color}|${darken}`;
  const cached = cycleTextureCache.get(key);
  if (cached) return cached;

  const promise = loadImage(url).then((img) => {
    const w = img.naturalWidth || 256;
    const h = img.naturalHeight || 256;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0, w, h);
    const tint = new THREE.Color(color);
    const r = Math.round(tint.r * 255 * darken);
    const g = Math.round(tint.g * 255 * darken);
    const b = Math.round(tint.b * 255 * darken);
    const data = ctx.getImageData(0, 0, w, h);
    const px = data.data;
    for (let i = 0; i < px.length; i += 4) {
      const a = px[i + 3];
      px[i] = (a * px[i] + (255 - a) * r) >> 8;
      px[i + 1] = (a * px[i + 1] + (255 - a) * g) >> 8;
      px[i + 2] = (a * px[i + 2] + (255 - a) * b) >> 8;
      px[i + 3] = 255;
    }
    ctx.putImageData(data, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return texture;
  });

  cycleTextureCache.set(key, promise);
  return promise;
}

function useCycleTextures(color: string): { body: THREE.Texture; wheel: THREE.Texture } | null {
  const [textures, setTextures] = useState<{ body: THREE.Texture; wheel: THREE.Texture } | null>(null);
  useEffect(() => {
    let alive = true;
    Promise.all([
      blendedCycleTexture(TEX.cycleBody, color, 1),
      blendedCycleTexture(TEX.cycleWheel, color, 0.7),
    ])
      .then(([body, wheel]) => {
        if (alive) setTextures({ body, wheel });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [color]);
  return textures;
}

// The .mod/.obj cycle models ship without UVs (AA generates them via GL texgen at runtime).
// We approximate that with an object-space planar projection along the lateral axis so the
// painted detail reads on the visible flanks of the bike.
function applyPlanarUV(geometry: THREE.BufferGeometry) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const pos = geometry.attributes.position as THREE.BufferAttribute;
  const dx = box.max.x - box.min.x || 1;
  const dz = box.max.z - box.min.z || 1;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i += 1) {
    uv[i * 2] = (pos.getX(i) - box.min.x) / dx;
    uv[i * 2 + 1] = (pos.getZ(i) - box.min.z) / dz;
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
}

// AA cycle tilt (gCycle.cpp "animate skew", ~L3110): the cycle does NOT bank into turns.
// It casts two sensors 45° forward-left / forward-right, measures the distance to the nearest
// wall on each side (capped at `extension`), and leans based on the asymmetry — i.e. it tilts
// when grinding close to a wall. We reproduce the steady state of that ODE (scrub-safe):
//   lr   = (leftHit - rightHit) / extension          (each hit clamped to [0, extension])
//   skew = clamp(-lr/2, -leftHit*0.5, rightHit*0.5)   (game's fac = 0.5)
//   roll = atan(skew)                                 (render: ske=(1,skew) rotated about fwd)
const SKEW_EXTENSION = 0.25; // gCycle.cpp: REAL extension = .25
const SKEW_FAC = 0.5;

// Distance from ray origin (px,py) along unit dir (dx,dy) to segment a→b; Infinity if no hit
// within maxDist (in front of the ray, within the segment span).
function rayHitDistance(
  px: number,
  py: number,
  dx: number,
  dy: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  maxDist: number,
): number {
  const ex = bx - ax;
  const ey = by - ay;
  const denom = dx * ey - dy * ex;
  if (Math.abs(denom) < 1e-9) return Infinity; // parallel
  const rx = ax - px;
  const ry = ay - py;
  const t = (rx * ey - ry * ex) / denom; // distance along the (unit) ray
  const u = (rx * dy - ry * dx) / denom; // position along the segment
  if (t < 0 || t > maxDist || u < 0 || u > 1) return Infinity;
  return t;
}

// Nearest wall distance along one sensor ray, capped at SKEW_EXTENSION.
function sensorHit(
  px: number,
  py: number,
  dx: number,
  dy: number,
  walls: Array<[number, number, number, number]>,
): number {
  let best = SKEW_EXTENSION;
  for (const [ax, ay, bx, by] of walls) {
    const d = rayHitDistance(px, py, dx, dy, ax, ay, bx, by, SKEW_EXTENSION);
    if (d < best) best = d;
  }
  return best;
}

// Per-player skew roll (radians) from the current snapshot, in game coordinates.
function computeLeans(snapshot: RoundSnapshot, bounds: RoundTimeline["bounds"]): Map<string, number> {
  const rim: Array<[number, number, number, number]> = [
    [bounds.minX, bounds.minY, bounds.maxX, bounds.minY],
    [bounds.maxX, bounds.minY, bounds.maxX, bounds.maxY],
    [bounds.maxX, bounds.maxY, bounds.minX, bounds.maxY],
    [bounds.minX, bounds.maxY, bounds.minX, bounds.minY],
  ];
  const walls: Array<[number, number, number, number]> = rim.slice();
  for (const t of snapshot.trails) {
    walls.push([t.from[0], t.from[1], t.to[0], t.to[1]]);
  }

  const leans = new Map<string, number>();
  for (const player of snapshot.players) {
    if (!player.active) continue;
    const len = Math.hypot(player.dirX, player.dirY) || 1;
    const fx = player.dirX / len;
    const fy = player.dirY / len;
    // 45° rotations of the drive direction (dirDrive.Turn(1,±1), normalized).
    const inv = 1 / Math.SQRT2;
    const lx = (fx - fy) * inv;
    const ly = (fx + fy) * inv;
    const rx = (fx + fy) * inv;
    const ry = (fy - fx) * inv;

    const leftHit = sensorHit(player.x, player.y, lx, ly, walls);
    const rightHit = sensorHit(player.x, player.y, rx, ry, walls);
    const lr = (leftHit - rightHit) / SKEW_EXTENSION;
    let skew = -lr / 2;
    const lo = -leftHit * SKEW_FAC;
    const hi = rightHit * SKEW_FAC;
    if (skew < lo) skew = lo;
    if (skew > hi) skew = hi;
    leans.set(player.username, Math.atan(skew));
  }
  return leans;
}

function CycleMarker({ player, round, selected, lean }: { player: PlayerState; round: RoundTimeline; selected: boolean; lean: number }) {
  const position = toWorld(player.x, player.y, round);

  return (
    <group position={[position.x, 0, position.z]} rotation={[0, -player.heading, 0]}>
      <pointLight color={player.color} intensity={selected ? 18 : 9} distance={selected ? 26 : 16} position={[0, 1.2, 0]} />
      <group rotation={[lean, 0, 0]}>
        <CycleModel color={player.color} selected={selected} distance={player.distance} />
      </group>
      {player.active && (
        <Html
          position={[0, 2.6, 0]}
          center
          distanceFactor={26}
          zIndexRange={[24, 0]}
          wrapperClass="cycle-label-wrap"
          occlude={false}
        >
          <span className={`cycle-label${selected ? " is-selected" : ""}`} style={{ ["--cycle" as string]: player.color }}>
            {player.username}
          </span>
        </Html>
      )}
      {!player.active && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} scale={[2.8, 2.8, 1]} position={[0.5, 0.02, 0]}>
          <circleGeometry args={[1, 36]} />
          <meshBasicMaterial color={player.color} transparent opacity={0.22} />
        </mesh>
      )}
    </group>
  );
}

// The real AA light-cycle: body + front/rear wheels, assembled with the same offsets the
// game uses (see gCycle.cpp Render: rear wheel at z=0.73, front at x=1.84,z=0.43). The
// models are x-forward / z-up, so the inner group is rotated to our y-up world. The .obj
// ships without UVs, so we project planar UVs and map the original AA cycle textures, blended
// to the player colour the same way the game does.
// Wheel pivots/radii from gCycle.cpp Render: rear hub at z=0.73, front hub at x=1.84,z=0.43.
// Wheels spin about their lateral (model y) axis by θ = 2·odometer/radius
// (rotate(rotationWheel, 2·speed·dt/r), r = 0.43 front, 0.73 rear).
const WHEEL_RADIUS_FRONT = 0.43;
const WHEEL_RADIUS_REAR = 0.73;

function CycleModel({ color, selected, distance }: { color: string; selected: boolean; distance: number }) {
  const [bodyObj, frontObj, rearObj] = useLoader(OBJLoader, [MODEL.body, MODEL.front, MODEL.rear]);
  const textures = useCycleTextures(color);

  const { group, frontWheel, rearWheel } = useMemo(() => {
    const tint = new THREE.Color(color);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: textures ? "#ffffff" : "#10151f",
      map: textures?.body ?? null,
      // No emissive glow once the real texture is mapped — it washed out the painted detail.
      emissive: tint,
      emissiveIntensity: textures ? 0 : selected ? 2.1 : 1.25,
      metalness: 0.45,
      roughness: 0.35,
    });
    const wheelMat = new THREE.MeshStandardMaterial({
      color: textures ? "#ffffff" : "#04060b",
      map: textures?.wheel ?? null,
      emissive: tint,
      emissiveIntensity: textures ? 0 : selected ? 1.1 : 0.7,
      metalness: 0.55,
      roughness: 0.45,
    });

    const apply = (source: THREE.Object3D, material: THREE.Material, position?: [number, number, number]) => {
      const clone = source.clone(true);
      clone.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry = mesh.geometry.clone();
          applyPlanarUV(mesh.geometry);
          mesh.material = material;
          mesh.castShadow = true;
        }
      });
      if (position) {
        clone.position.set(...position);
      }
      return clone;
    };

    // Model space (matches gCycle.cpp): x = forward, y = lateral, z = up.
    const rearWheel = apply(rearObj, wheelMat, [0, 0, 0.73]);
    const frontWheel = apply(frontObj, wheelMat, [1.84, 0, 0.43]);
    const inner = new THREE.Group();
    inner.add(apply(bodyObj, bodyMat));
    inner.add(rearWheel);
    inner.add(frontWheel);
    inner.rotation.x = -Math.PI / 2; // z-up model -> y-up scene

    const outer = new THREE.Group();
    outer.add(inner);
    return { group: outer, frontWheel, rearWheel };
  }, [bodyObj, frontObj, rearObj, color, selected, textures]);

  // Spin the wheels by the cycle's odometer (deterministic in playback time → scrub-safe).
  useLayoutEffect(() => {
    frontWheel.rotation.y = (2 * distance) / WHEEL_RADIUS_FRONT;
    rearWheel.rotation.y = (2 * distance) / WHEEL_RADIUS_REAR;
  }, [distance, frontWheel, rearWheel]);

  useEffect(() => {
    return () => {
      group.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry?.dispose();
          if (mesh.material) (mesh.material as THREE.Material).dispose();
        }
      });
    };
  }, [group]);

  return <primitive object={group} scale={CYCLE_SCALE} />;
}

const ZONE_COLOR = "#c6f534";

// Shrinking sumo / fortress win-zone, centred on the arena (world origin). Unit-radius
// geometry scaled by the current radius so we never reallocate buffers per frame.
function SumoZone({ radius, time, center }: { radius: number; time: number; center: [number, number] }) {
  const pulse = 0.5 + 0.5 * Math.sin(time * 2.4);
  return (
    <group position={[center[0], 0, center[1]]} scale={[radius, 1, radius]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]}>
        <circleGeometry args={[1, 72]} />
        <meshBasicMaterial color={ZONE_COLOR} transparent opacity={0.05} side={THREE.DoubleSide} toneMapped={false} depthWrite={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.09, 0]}>
        <ringGeometry args={[0.97, 1, 96]} />
        <meshBasicMaterial color={ZONE_COLOR} transparent opacity={0.5 + 0.4 * pulse} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      <mesh position={[0, 1.6, 0]}>
        <cylinderGeometry args={[1, 1, 3.2, 96, 1, true]} />
        <meshBasicMaterial color={ZONE_COLOR} transparent opacity={0.1 + 0.06 * pulse} side={THREE.DoubleSide} toneMapped={false} depthWrite={false} />
      </mesh>
    </group>
  );
}

// Hemisphere-up unit directions for explosion sparks, mirroring gExplosion's expvec burst.
const EXPLOSION_DIRS: Array<[number, number, number]> = (() => {
  const seeded = (n: number) => {
    const value = Math.sin(n * 12.9898) * 43758.5453;
    return value - Math.floor(value);
  };
  const dirs: Array<[number, number, number]> = [];
  for (let i = 0; i < 44; i += 1) {
    const x = seeded(i + 1) - 0.5;
    const z = seeded(i + 101) - 0.5;
    const y = 0.18 + seeded(i + 201) * 0.9;
    const length = Math.hypot(x, y, z) || 1;
    dirs.push([x / length, y / length, z / length]);
  }
  return dirs;
})();

function Explosion({ data, round }: { data: ExplosionState; round: RoundTimeline }) {
  const arenaSize = Math.max(round.bounds.width, round.bounds.height);
  const maxRadius = THREE.MathUtils.clamp(arenaSize * 0.14, 6, 16);
  const position = toWorld(data.x, data.y, round);
  const t = data.progress;

  // Expanding shell: outer edge races ahead, inner edge follows, then it fades out.
  const outer = maxRadius * Math.sqrt(t);
  const inner = maxRadius * Math.max(0, 1.6 * t - 0.6);
  const opacity = t < 0.45 ? 1 : Math.max(0, 1 - (t - 0.45) / 0.55);

  const geometry = useMemo(() => {
    const buffer = new THREE.BufferGeometry();
    buffer.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(new Float32Array(EXPLOSION_DIRS.length * 6), 3),
    );
    return buffer;
  }, []);

  useEffect(() => () => geometry.dispose(), [geometry]);

  useLayoutEffect(() => {
    const attribute = geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < EXPLOSION_DIRS.length; i += 1) {
      const [dx, dy, dz] = EXPLOSION_DIRS[i];
      attribute.setXYZ(i * 2, dx * inner, dy * inner, dz * inner);
      attribute.setXYZ(i * 2 + 1, dx * outer, dy * outer, dz * outer);
    }
    attribute.needsUpdate = true;
    geometry.computeBoundingSphere();
  }, [geometry, inner, outer]);

  return (
    <group position={[position.x, 0.8, position.z]}>
      <pointLight color={data.color} intensity={(1 - t) * 60} distance={maxRadius * 2.6} />
      <lineSegments geometry={geometry}>
        <lineBasicMaterial color={data.color} transparent opacity={opacity} toneMapped={false} />
      </lineSegments>
    </group>
  );
}

function chooseCameraTarget(players: PlayerState[], selectedPlayer?: string): PlayerState | undefined {
  return (
    players.find((player) => player.username === selectedPlayer && player.active) ??
    players.find((player) => player.username === selectedPlayer) ??
    players.find((player) => player.active) ??
    players[0]
  );
}

function toWorld(x: number, y: number, round: RoundTimeline): THREE.Vector3 {
  return new THREE.Vector3(x - round.bounds.centerX, 0, -(y - round.bounds.centerY));
}
