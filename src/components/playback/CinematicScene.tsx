"use client";

import { ContactShadows, Environment, PerspectiveCamera, Sparkles, Stars } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  DEFAULT_PHYSICS,
  DEFAULT_ZONE,
  getRoundSnapshot,
  zoneRadiusAt,
  type ExplosionState,
  type PhysicsSettings,
  type PlayerState,
  type RoundTimeline,
  type TrailSegment,
  type ZoneSettings,
} from "@/lib/playback";

export type PlaybackCameraMode = "cinematic" | "follow" | "pov" | "noclip";

type CinematicSceneProps = {
  round: RoundTimeline;
  time: number;
  selectedPlayer?: string;
  cameraMode: PlaybackCameraMode;
  physics?: PhysicsSettings;
  zone?: ZoneSettings;
};

export function CinematicScene({
  round,
  time,
  selectedPlayer,
  cameraMode,
  physics = DEFAULT_PHYSICS,
  zone = DEFAULT_ZONE,
}: CinematicSceneProps) {
  const snapshot = useMemo(() => getRoundSnapshot(round, time, physics), [round, time, physics]);
  const zoneRadius = zoneRadiusAt(time, zone);
  const zoneCenter = toWorld(zone.centerX, zone.centerY, round);
  const arenaSize = Math.max(round.bounds.width, round.bounds.height);

  return (
    <Canvas shadows={{ type: THREE.PCFShadowMap }} dpr={[1, 2]} gl={{ antialias: true }}>
      <color attach="background" args={["#03040b"]} />
      <fog attach="fog" args={["#03040b", arenaSize * 0.75, arenaSize * 2.1]} />
      <PerspectiveCamera makeDefault fov={52} position={[0, arenaSize * 0.6, arenaSize * 0.9]} />
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

      <ArenaFloor round={round} />
      <RimWalls round={round} />
      {zoneRadius !== null && zoneRadius > 0.5 && (
        <SumoZone radius={zoneRadius} time={time} center={[zoneCenter.x, zoneCenter.z]} />
      )}
      <TrailSegments segments={snapshot.trails} round={round} />
      {snapshot.players.map((player) => (
        <CycleMarker key={player.username} player={player} round={round} selected={player.username === selectedPlayer} />
      ))}
      {snapshot.explosions.map((explosion) => (
        <Explosion key={explosion.username} data={explosion} round={round} />
      ))}

      <Sparkles count={80} size={2.4} speed={0.25} opacity={0.5} scale={[arenaSize, 30, arenaSize]} />
      <Stars radius={arenaSize * 1.6} depth={50} count={1400} factor={3} saturation={0} fade speed={0.35} />
      <ContactShadows position={[0, 0.03, 0]} opacity={0.5} scale={arenaSize * 1.5} blur={2.5} far={30} />
      <Environment preset="night" />
    </Canvas>
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

    const alpha = 1 - Math.exp(-delta * (mode === "pov" ? 8 : 3.6));
    camera.position.lerp(desiredPosition.current, alpha);
    lookAt.current.lerp(desiredLookAt.current, alpha);
    camera.lookAt(lookAt.current);
  });

  return null;
}

function ArenaFloor({ round }: { round: RoundTimeline }) {
  const width = round.bounds.width;
  const height = round.bounds.height;

  return (
    <group>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
        <planeGeometry args={[width, height, 1, 1]} />
        <meshStandardMaterial color="#050816" metalness={0.65} roughness={0.34} emissive="#071833" emissiveIntensity={0.22} />
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
  const color = "#67f7ff";

  return (
    <group>
      <RimWall position={[0, 1, -height / 2]} scale={[width, 2, 0.35]} color={color} />
      <RimWall position={[0, 1, height / 2]} scale={[width, 2, 0.35]} color={color} />
      <RimWall position={[-width / 2, 1, 0]} scale={[0.35, 2, height]} color={color} />
      <RimWall position={[width / 2, 1, 0]} scale={[0.35, 2, height]} color={color} />
    </group>
  );
}

function RimWall({ position, scale, color }: { position: [number, number, number]; scale: [number, number, number]; color: string }) {
  return (
    <mesh castShadow receiveShadow position={position} scale={scale}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#05151d" emissive={color} emissiveIntensity={0.6} metalness={0.45} roughness={0.25} transparent opacity={0.72} />
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
  segments,
  round,
  capacity,
  depthBias,
}: {
  geometry: THREE.BoxGeometry;
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

function CycleMarker({ player, round, selected }: { player: PlayerState; round: RoundTimeline; selected: boolean }) {
  const position = toWorld(player.x, player.y, round);
  const speedScale = THREE.MathUtils.clamp(player.speed / 22, 0.85, 1.65);
  const glow = selected ? 4.8 : 2.8;

  return (
    <group position={[position.x, 0.7, position.z]} rotation={[0, -player.heading, 0]}>
      <pointLight color={player.color} intensity={selected ? 18 : 9} distance={selected ? 26 : 16} />
      <mesh castShadow scale={[1.9 * speedScale, 0.42, 0.78]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#f7fbff" emissive={player.color} emissiveIntensity={glow} metalness={0.45} roughness={0.18} />
      </mesh>
      <mesh position={[-0.6, -0.33, -0.48]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.2, 0.045, 10, 20]} />
        <meshStandardMaterial color="#0d111a" emissive={player.color} emissiveIntensity={1.6} />
      </mesh>
      <mesh position={[-0.6, -0.33, 0.48]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.2, 0.045, 10, 20]} />
        <meshStandardMaterial color="#0d111a" emissive={player.color} emissiveIntensity={1.6} />
      </mesh>
      {!player.active && (
        <mesh scale={[2.8, 0.05, 2.8]} position={[0, -0.62, 0]}>
          <circleGeometry args={[1, 36]} />
          <meshBasicMaterial color={player.color} transparent opacity={0.25} />
        </mesh>
      )}
    </group>
  );
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
