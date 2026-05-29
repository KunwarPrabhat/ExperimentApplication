import 'react-native-gesture-handler';
import React, { useState, Suspense, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Canvas, useFrame } from '@react-three/fiber/native';
import { PerspectiveCamera, OrbitControls, useFBX } from '@react-three/drei/native';
import { ReactNativeJoystick } from '@korsolutions/react-native-joystick';
import * as THREE from 'three';

const ASSETS = {
  idle: require('./3D_assets/animation/Standing_Idle.fbx'),
  run: require('./3D_assets/animation/Run.fbx'),
};

// 1. A big flat plane of light green color
function Ground() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
      <planeGeometry args={[500, 500]} />
      <meshStandardMaterial color="#90ee90" roughness={1} metalness={0} />
    </mesh>
  );
}

// 2. The Character with the Texture Parser
function Character({ moveVector }: { moveVector: THREE.Vector2 }) {
  const idleFbx = useFBX(ASSETS.idle);
  const runFbx = useFBX(ASSETS.run);
  
  const groupRef = useRef<THREE.Group>(null!);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionsRef = useRef<{ [key: string]: THREE.AnimationAction }>({});
  const activeActionNameRef = useRef<string>('idle');

  // The Bulletproof Material Parser to fix black textures
  useEffect(() => {
    const fixMaterials = (model: THREE.Group) => {
      model.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          
          const createSafeMaterial = (oldMat: any) => {
            // We forcefully create a standard material that Expo GL guarantees it can render
            return new THREE.MeshStandardMaterial({
              color: oldMat.color || new THREE.Color('#ffffff'),
              map: oldMat.map || null, // Keeps the original texture image if it exists
              roughness: 0.8,
              metalness: 0.1,
            });
          };

          if (mesh.material) {
            if (Array.isArray(mesh.material)) {
              mesh.material = mesh.material.map(createSafeMaterial);
            } else {
              mesh.material = createSafeMaterial(mesh.material);
            }
          }
        }
      });
    };

    if (idleFbx) fixMaterials(idleFbx);
    if (runFbx) fixMaterials(runFbx);
  }, [idleFbx, runFbx]);

  // Animation Setup
  useEffect(() => {
    if (idleFbx && runFbx) {
      const mixer = new THREE.AnimationMixer(idleFbx);
      mixerRef.current = mixer;

      if (idleFbx.animations.length > 0) {
        actionsRef.current['idle'] = mixer.clipAction(idleFbx.animations[0]);
      }
      if (runFbx.animations.length > 0) {
        actionsRef.current['run'] = mixer.clipAction(runFbx.animations[0]);
      }

      actionsRef.current['idle']?.play();
    }
    return () => {
      mixerRef.current?.stopAllAction();
    };
  }, [idleFbx, runFbx]);

  // Movement Logic
  useFrame((state, delta) => {
    const speed = 6 * delta;
    const isMoving = moveVector.lengthSq() > 0.001;
    const moveDirection = new THREE.Vector3();

    if (isMoving && groupRef.current) {
      // Camera-relative directions
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(state.camera.quaternion);
      forward.y = 0;
      forward.normalize();
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(state.camera.quaternion);
      right.y = 0;
      right.normalize();

      // Transform directions relative to current camera angle
      moveDirection.addScaledVector(forward, moveVector.y)
                   .addScaledVector(right, -moveVector.x);

      if (moveDirection.lengthSq() > 0) {
        moveDirection.normalize();
        const deltaPos = moveDirection.clone().multiplyScalar(speed);
        
        groupRef.current.position.add(deltaPos);
        state.camera.position.add(deltaPos); // Camera pans with character

        // Rotate to face movement direction
        const targetAngle = Math.atan2(moveDirection.x, moveDirection.z);
        const targetQuaternion = new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 1, 0),
          targetAngle
        );
        groupRef.current.quaternion.slerp(targetQuaternion, 15 * delta);
      }
    }

    // Animation Crossfading
    const nextAction = isMoving ? 'run' : 'idle';
    if (activeActionNameRef.current !== nextAction) {
      const prev = actionsRef.current[activeActionNameRef.current];
      const next = actionsRef.current[nextAction];
      if (next) {
        next.reset().fadeIn(0.2).play();
        prev?.fadeOut(0.2);
        activeActionNameRef.current = nextAction;
      }
    }

    // Make camera smoothly follow the player
    if (state.controls && groupRef.current) {
      const controls = state.controls as any;
      controls.target.lerp(groupRef.current.position, 10 * delta);
    }

    mixerRef.current?.update(delta);
  });

  return (
    <group ref={groupRef}>
      {/* FBX models are usually massive, scale=0.01 brings them down to 1 meter tall */}
      <primitive object={idleFbx} scale={0.01} />
    </group>
  );
}

// 3. Main App Layout
export default function App() {
  const [gameState, setGameState] = useState<'HOME' | 'PLAYING'>('HOME');
  const [moveVector, setMoveVector] = useState(new THREE.Vector2(0, 0));

  if (gameState === 'HOME') {
    return (
      <GestureHandlerRootView style={styles.homeContainer}>
        <TouchableOpacity style={styles.playButton} onPress={() => setGameState('PLAYING')}>
          <Text style={styles.playText}>PLAY</Text>
        </TouchableOpacity>
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={styles.container}>
      <Canvas>
        <color attach="background" args={['#87CEEB']} /> {/* Sky Blue Background */}
        
        <PerspectiveCamera makeDefault position={[0, 5, 10]} />
        <OrbitControls makeDefault enableZoom={true} enablePan={false} />
        
        {/* Simple lighting so we can see the textures clearly */}
        <ambientLight intensity={0.8} />
        <directionalLight position={[10, 20, 10]} intensity={1.5} />
        
        <Suspense fallback={null}>
          <Ground />
          <Character moveVector={moveVector} />
        </Suspense>
      </Canvas>

      <View style={styles.joystickContainer}>
        <ReactNativeJoystick
          color="#00000080"
          radius={50}
          onMove={(data: any) => {
            if (data && data.angle) {
              const rad = data.angle.radian;
              const force = Math.min(data.force, 1);
              // Map joystick data to a simple X/Y vector
              setMoveVector(new THREE.Vector2(Math.cos(rad) * force, Math.sin(rad) * force));
            }
          }}
          onStop={() => {
            setMoveVector(new THREE.Vector2(0, 0));
          }}
        />
      </View>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  homeContainer: { flex: 1, backgroundColor: '#1a1a1a', justifyContent: 'center', alignItems: 'center' },
  playButton: { backgroundColor: '#e11d48', paddingHorizontal: 50, paddingVertical: 20, borderRadius: 30 },
  playText: { color: 'white', fontSize: 24, fontWeight: 'bold', letterSpacing: 4 },
  joystickContainer: { position: 'absolute', bottom: 40, left: 40 },
});