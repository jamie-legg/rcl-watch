"use client";

import { ContactShadows, Environment, Html, PerspectiveCamera, useTexture } from "@react-three/drei";
import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import * as THREE from "three";
import { OBJLoader } from "three-stdlib";
import {
  DEFAULT_PHYSICS,
  DEFAULT_ZONE,
  EXPLOSION_DURATION,
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
import type { DecodedZone } from "@/types/tstLog";

export type PlaybackCameraMode = "cinematic" | "follow" | "pov" | "noclip";

// Follow-camera rig mapped 1:1 to Armagetron's custom-camera settings (eCamera.cpp):
//   CAMERA_CUSTOM_BACK / RISE / PITCH / TURN_SPEED. Defaults are the game's defaults.
export type CameraConfig = {
  /** CAMERA_CUSTOM_BACK: distance the camera sits behind the cycle (game units). */
  back: number;
  /** CAMERA_CUSTOM_RISE: height the camera sits above the cycle (game units). */
  rise: number;
  /** CAMERA_CUSTOM_PITCH: vertical look slope (negative looks down). */
  pitch: number;
  /** CAMERA_CUSTOM_TURN_SPEED: how fast the camera direction eases toward the cycle heading. */
  turnSpeed: number;
};

export const DEFAULT_CAMERA: CameraConfig = { back: 30, rise: 20, pitch: -0.7, turnSpeed: 40 };

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
  camera?: CameraConfig;
  physics?: PhysicsSettings;
  zone?: ZoneSettings;
  /** Zones recovered from a recording (aarec); take priority over the heuristic sumo zone. */
  decodedZones?: DecodedZone[];
  debug?: boolean;
  debugRef?: RefObject<HTMLDivElement | null>;
};

export function CinematicScene({
  round,
  time,
  selectedPlayer,
  cameraMode,
  fov = 52,
  camera = DEFAULT_CAMERA,
  physics = DEFAULT_PHYSICS,
  zone = DEFAULT_ZONE,
  decodedZones = [],
  debug = false,
  debugRef,
}: CinematicSceneProps) {
  const snapshot = useMemo(() => getRoundSnapshot(round, time, physics), [round, time, physics]);
  const leans = useMemo(() => computeLeans(snapshot, round.bounds), [snapshot, round.bounds]);
  const hasDecodedZones = decodedZones.length > 0;
  // Decoded (recording) zones take priority over the heuristic sumo zone.
  const zoneRadius = hasDecodedZones ? null : zoneRadiusAt(time, zone);
  const zoneCenter = toWorld(zone.centerX, zone.centerY, round);
  const arenaSize = Math.max(round.bounds.width, round.bounds.height);
  // Cinematic camera should orbit the actual action centre, not the world origin
  // (which is the player-position bounding-box centre, usually off the map centre).
  // With decoded zones, orbit their centroid; with the sumo zone, its centre.
  const decodedCentroid = useMemo<[number, number, number] | null>(() => {
    if (!hasDecodedZones) return null;
    let sx = 0;
    let sz = 0;
    for (const z of decodedZones) {
      const w = toWorld(z.centerX, z.centerY, round);
      sx += w.x;
      sz += w.z;
    }
    return [sx / decodedZones.length, 0, sz / decodedZones.length];
  }, [hasDecodedZones, decodedZones, round]);
  const orbitCenter = useMemo<[number, number, number]>(
    () => decodedCentroid ?? (zone.enabled ? [zoneCenter.x, 0, zoneCenter.z] : [0, 0, 0]),
    [decodedCentroid, zone.enabled, zoneCenter.x, zoneCenter.z],
  );

  return (
    <Canvas shadows={{ type: THREE.PCFShadowMap }} dpr={[1, 2]} gl={{ antialias: true }}>
      {debug && debugRef && <DebugStats targetRef={debugRef} />}
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
          config={camera}
          orbitCenter={orbitCenter}
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
      {hasDecodedZones && <DecodedZones zones={decodedZones} time={time} round={round} />}
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
      {snapshot.players
        .filter((player) => player.active)
        .map((player) => (
          <CycleLabel key={player.username} player={player} round={round} selected={player.username === selectedPlayer} />
        ))}
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
  config: CameraConfig;
  orbitCenter: [number, number, number];
};

function CameraRig({ round, time, selectedPlayer, mode, players, config, orbitCenter }: CameraRigProps) {
  const { camera } = useThree();
  const lookAt = useRef(new THREE.Vector3());
  const desiredPosition = useRef(new THREE.Vector3());
  const desiredLookAt = useRef(new THREE.Vector3());
  // Persistent camera heading that eases toward the cycle direction (AA's `newdir`).
  const camDir = useRef(new THREE.Vector3(0, 0, -1));
  const arenaSize = Math.max(round.bounds.width, round.bounds.height);

  useFrame((_, delta) => {
    const target = chooseCameraTarget(players, selectedPlayer);

    if (mode === "cinematic" || !target) {
      const orbit = time * 0.11;
      desiredLookAt.current.set(orbitCenter[0], 0.9, orbitCenter[2]);
      desiredPosition.current.set(
        orbitCenter[0] + Math.cos(orbit) * arenaSize * 0.55,
        arenaSize * 0.38 + Math.sin(time * 0.17) * 7,
        orbitCenter[2] + Math.sin(orbit) * arenaSize * 0.55,
      );
      const alpha = 1 - Math.exp(-delta * 3.6);
      camera.position.lerp(desiredPosition.current, alpha);
      lookAt.current.lerp(desiredLookAt.current, alpha);
      camera.lookAt(lookAt.current);
      return;
    }

    const targetPosition = toWorld(target.x, target.y, round);
    const heading = new THREE.Vector3(target.dirX, 0, -target.dirY).normalize();

    if (mode === "pov") {
      desiredPosition.current.copy(targetPosition).addScaledVector(heading, -2.8).add(new THREE.Vector3(0, 1.45, 0));
      desiredLookAt.current.copy(targetPosition).addScaledVector(heading, 13).add(new THREE.Vector3(0, 1.2, 0));
      const alpha = 1 - Math.exp(-delta * 8);
      camera.position.lerp(desiredPosition.current, alpha);
      lookAt.current.lerp(desiredLookAt.current, alpha);
      camera.lookAt(lookAt.current);
      return;
    }

    // Follow = AA custom camera. Ease the camera heading toward the cycle's at TURN_SPEED
    // (newdir = dir + cycleDir·turnSpeed·dt, renormalised), then place BACK behind / RISE
    // above and look down by PITCH.
    const dir = camDir.current;
    dir.addScaledVector(heading, config.turnSpeed * delta);
    dir.y = 0;
    if (dir.lengthSq() < 1e-6) {
      dir.copy(heading);
    }
    dir.normalize();

    desiredPosition.current
      .copy(targetPosition)
      .addScaledVector(dir, -config.back)
      .add(new THREE.Vector3(0, config.rise, 0));
    // View direction: camera heading (horizontal) tilted by the pitch slope.
    desiredLookAt.current
      .copy(desiredPosition.current)
      .add(new THREE.Vector3(dir.x, config.pitch, dir.z).multiplyScalar(10));

    // Position is eased only lightly (anti-jitter); the turn feel comes from camDir easing.
    const alpha = 1 - Math.exp(-delta * 10);
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
  const box = new THREE.BoxGeometry(1, 1.4, 0.06);
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
          // Distinct, evenly-spread depth rank per player, centred on 0. Used as BOTH the
          // polygon-offset factor (slope-scaled) and units below, so coplanar walls separate
          // cleanly even at the glancing angles where a constant offset wasn't enough.
          depthBias={index - (round.players.length - 1) / 2}
        />
      ))}
    </>
  );
}

const EMPTY_SEGMENTS: TrailSegment[] = [];

// Trail walls read ~35% too tall in our scene; scale them down.
const WALL_HEIGHT_FACTOR = 0.65;

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
      const height = (0.25 + 0.75 * intensity) * WALL_HEIGHT_FACTOR;
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
          polygonOffset gives each player a distinct depth so coplanar walls don't fight.
          A *slope-scaled* factor (not just constant units) is required — these near-edge-on
          walls have a steep depth gradient, so a constant offset alone still z-fights. */}
      <meshBasicMaterial
        map={texture}
        vertexColors
        toneMapped={false}
        polygonOffset
        polygonOffsetFactor={depthBias}
        polygonOffsetUnits={depthBias * 4}
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

// Overall scale for the imported cycle models. Matches the game's glScalef(.5,.5,.5).
const CYCLE_SCALE = 0.5;

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
  const ext = SKEW_EXTENSION;
  for (const [ax, ay, bx, by] of walls) {
    // Cheap AABB reject: the ray only reaches `ext`, so skip far segments outright.
    if (ax < px - ext && bx < px - ext) continue;
    if (ax > px + ext && bx > px + ext) continue;
    if (ay < py - ext && by < py - ext) continue;
    if (ay > py + ext && by > py + ext) continue;
    const d = rayHitDistance(px, py, dx, dy, ax, ay, bx, by, ext);
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

// Name plate that eases toward its cycle instead of snapping, so it's readable at speed.
function CycleLabel({ player, round, selected }: { player: PlayerState; round: RoundTimeline; selected: boolean }) {
  // Lock the label to the cycle's interpolated position (driven by the same render as the
  // bike). An earlier soft-follow lerp ran in its own useFrame loop, a second rAF clock that
  // beat against the playback clock and made the names shake — direct positioning is rock steady.
  const target = toWorld(player.x, player.y, round);

  const name = player.username.split("@")[0];
  const suffix = player.username.includes("@") ? player.username.split("@").slice(1).join("@") : "";

  return (
    <group position={[target.x, 2.6, target.z]}>
      <Html center distanceFactor={30} zIndexRange={[24, 0]} wrapperClass="cycle-label-wrap" occlude={false}>
        <span className={`cycle-label${selected ? " is-selected" : ""}`} style={{ ["--cycle" as string]: player.color }}>
          <strong>{name}</strong>
          {suffix && <em>@{suffix}</em>}
        </span>
      </Html>
    </group>
  );
}

function CycleMarker({ player, round, selected, lean }: { player: PlayerState; round: RoundTimeline; selected: boolean; lean: number }) {
  const position = toWorld(player.x, player.y, round);

  return (
    <group position={[position.x, 0, position.z]} rotation={[0, -player.heading, 0]}>
      <pointLight color={player.color} intensity={selected ? 18 : 9} distance={selected ? 26 : 16} position={[0, 1.2, 0]} />
      <group rotation={[lean, 0, 0]}>
        <CycleModel color={player.color} selected={selected} distance={player.distance} />
      </group>
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

// Faithful to gWinZone.cpp Render: the win-zone is a ring of ZONE_SEGMENTS (11) vertical
// quads, each spanning ZONE_SEG_LENGTH (0.5) of its arc slot (so they're dashed with gaps),
// the whole ring rotating at ROTATION_SPEED (~0.3 rad/s). ZONE_HEIGHT is 5 in-game; we trim
// it a touch to fit our compressed scene. Built once at unit radius/height and scaled.
const ZONE_SEGMENTS = 11;
const ZONE_SEG_LENGTH = 0.5;
const ZONE_HEIGHT = 4;
const ZONE_ROTATION_SPEED = 0.3;

function buildZoneGeometry(): THREE.BufferGeometry {
  const seglen = ((2 * Math.PI) / ZONE_SEGMENTS) * ZONE_SEG_LENGTH;
  const positions: number[] = [];
  for (let i = 0; i < ZONE_SEGMENTS; i += 1) {
    const a = (i * 2 * Math.PI) / ZONE_SEGMENTS;
    const b = a + seglen;
    const sa = Math.sin(a);
    const ca = Math.cos(a);
    const sb = Math.sin(b);
    const cb = Math.cos(b);
    // Two triangles for the quad (sa,ca)→(sb,cb), y from 0 (ground) to 1 (top).
    positions.push(sa, 0, ca, sa, 1, ca, sb, 1, cb);
    positions.push(sa, 0, ca, sb, 1, cb, sb, 0, cb);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

function SumoZone({
  radius,
  time,
  center,
  color = ZONE_COLOR,
  rotationSpeed = ZONE_ROTATION_SPEED,
}: {
  radius: number;
  time: number;
  center: [number, number];
  color?: string;
  rotationSpeed?: number;
}) {
  const geometry = useMemo(buildZoneGeometry, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const pulse = 0.5 + 0.5 * Math.sin(time * 2.4);

  return (
    <group position={[center[0], 0, center[1]]}>
      {/* Faint ground ring so the footprint reads even when the wall is far. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]} scale={[radius, radius, 1]}>
        <ringGeometry args={[0.985, 1, 96]} />
        <meshBasicMaterial color={color} transparent opacity={0.35} side={THREE.DoubleSide} toneMapped={false} depthWrite={false} />
      </mesh>
      {/* Rotating segmented wall (additive glow). */}
      <mesh geometry={geometry} scale={[radius, ZONE_HEIGHT, radius]} rotation={[0, time * rotationSpeed, 0]}>
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.32 + 0.2 * pulse}
          side={THREE.DoubleSide}
          toneMapped={false}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

// Render zones recovered from the recording's network stream (gZone, descriptor
// 340). radius(t) = offset + slope*(t - referenceTime): fortress zones are fixed
// (slope 0), the sumo/win zone shrinks (slope < 0). Colour is the team colour.
function DecodedZones({ zones, time, round }: { zones: DecodedZone[]; time: number; round: RoundTimeline }) {
  return (
    <>
      {zones.map((zone, i) => {
        const radius = Math.max(0, zone.radiusOffset + zone.radiusSlope * (time - zone.referenceTime));
        if (radius <= 0.5) return null;
        const c = toWorld(zone.centerX, zone.centerY, round);
        const [r, g, b] = zone.color;
        // Black means a not-yet-team-coloured creation; fall back to the ring colour.
        const color = r + g + b < 0.05 ? ZONE_COLOR : `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
        return (
          <SumoZone
            key={`${zone.centerX},${zone.centerY},${i}`}
            radius={radius}
            time={time}
            center={[c.x, c.z]}
            color={color}
            rotationSpeed={zone.rotationSpeed || ZONE_ROTATION_SPEED}
          />
        );
      })}
    </>
  );
}

// Faithful copy of gExplosion's `expvec`: 9 fixed cardinal/diagonal rays plus 31 random ones
// with a wide horizontal spread (fak=7) and a fixed upward (z=1) bias, all normalised. The
// game is z-up; our scene is y-up, so we remap (gx, gy_horiz, gz_up) → (gx, gz_up, gy_horiz).
const EXPLOSION_DIRS: Array<[number, number, number]> = (() => {
  const seeded = (n: number) => {
    const value = Math.sin(n * 12.9898) * 43758.5453;
    return value - Math.floor(value);
  };
  const raw: Array<[number, number, number]> = [
    [0, 0, 1],
    [0, 1, 1],
    [0, -1, 1],
    [1, 0, 1],
    [-1, 0, 1],
    [1, 1, 1],
    [-1, 1, 1],
    [1, -1, 1],
    [-1, -1, 1],
  ];
  const fak = 7;
  for (let j = raw.length; j < 40; j += 1) {
    raw.push([fak * (seeded(j + 1) - 0.5), fak * (seeded(j + 201) - 0.5), 1]);
  }
  return raw.map(([gx, gy, gz]) => {
    const x = gx;
    const y = gz; // game up (z) → scene up (y)
    const z = gy;
    const length = Math.hypot(x, y, z) || 1;
    return [x / length, y / length, z / length] as [number, number, number];
  });
})();

// gExplosion::Render scales the ray endpoints by a1*100 (game units/sec); ours is 1:1 with the
// game's coordinates, so we use the same rate.
const EXPLOSION_SPEED = 100;

function Explosion({ data, round }: { data: ExplosionState; round: RoundTimeline }) {
  const position = toWorld(data.x, data.y, round);

  // Mirror gExplosion::Render exactly. age (a1) runs 0..EXPLOSION_DURATION seconds. Each ray
  // goes from inner radius (e) to outer (a1), both ×100. Full opacity for the first second,
  // then a linear fade to 0 by ~2s; after 1s the inner ends lift off into an expanding shell.
  const a1 = data.progress * EXPLOSION_DURATION + 0.01;
  const e = Math.max(0, a1 - 1);
  const fade = THREE.MathUtils.clamp(2 - a1, 0, 1);
  const outer = a1 * EXPLOSION_SPEED;
  const inner = e * EXPLOSION_SPEED;

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
    <group position={[position.x, 0.35, position.z]}>
      <pointLight color={data.color} intensity={fade * 90} distance={Math.max(24, outer * 1.4)} />
      <lineSegments geometry={geometry}>
        <lineBasicMaterial color={data.color} transparent opacity={fade} toneMapped={false} />
      </lineSegments>
    </group>
  );
}

// Samples render stats inside the Canvas and writes them straight into a DOM node owned by
// PlaybackHub (via ref) ~4×/sec, so the HUD never triggers a React re-render of the scene.
function DebugStats({ targetRef }: { targetRef: RefObject<HTMLDivElement | null> }) {
  const gl = useThree((state) => state.gl);
  const acc = useRef({ frames: 0, elapsed: 0, last: performance.now(), low: Infinity });

  useFrame(() => {
    const now = performance.now();
    const a = acc.current;
    a.elapsed += now - a.last;
    a.last = now;
    a.frames += 1;

    if (a.elapsed < 250) {
      return;
    }

    const fps = (a.frames * 1000) / a.elapsed;
    const ms = a.elapsed / a.frames;
    a.low = Math.min(a.low, fps);

    const el = targetRef.current;
    if (el) {
      const render = gl.info.render;
      const memory = gl.info.memory;
      const programs = gl.info.programs?.length ?? 0;
      const rows: Array<[string, string]> = [
        ["FPS", fps.toFixed(0)],
        ["Low", Number.isFinite(a.low) ? a.low.toFixed(0) : "—"],
        ["Frame", `${ms.toFixed(1)} ms`],
        ["Draw calls", render.calls.toLocaleString()],
        ["Triangles", render.triangles.toLocaleString()],
        ["Geometries", String(memory.geometries)],
        ["Textures", String(memory.textures)],
        ["Programs", String(programs)],
      ];
      el.innerHTML = rows
        .map(([k, v]) => `<div class="debug-row"><span>${k}</span><b>${v}</b></div>`)
        .join("");
    }

    a.frames = 0;
    a.elapsed = 0;
  });

  return null;
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
