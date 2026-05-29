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
  run: require('./3D_assets/animation/Fast_Run.fbx'),
};

// Chessboard grid generator using GPU Shaders for infinite rendering speed and zero memory overhead
function Ground() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
      <planeGeometry args={[500, 500]} />
      <shaderMaterial
        vertexShader={`
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `}
        fragmentShader={`
          varying vec2 vUv;
          void main() {
            // Scale UV coordinates to create standard chessboard pattern size
            vec2 grid = floor(vUv * 80.0);
            float checker = mod(grid.x + grid.y, 2.0);
            
            // Rich light green and dark green color vectors
            vec3 lightGreen = vec3(0.56, 0.93, 0.56); // #90ee90
            vec3 darkGreen = vec3(0.18, 0.55, 0.34);  // #2e8b57
            
            gl_FragColor = vec4(mix(darkGreen, lightGreen, checker), 1.0);
          }
        `}
      />
    </mesh>
  );
}

// Character visual renderer with fully robust procedural material mapping
function Character({ moveVectorRef }: { moveVectorRef: React.RefObject<THREE.Vector2> }) {
  const idleFbx = useFBX(ASSETS.idle);
  const runFbx = useFBX(ASSETS.run);
  
  const groupRef = useRef<THREE.Group>(null!);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionsRef = useRef<{ [key: string]: THREE.AnimationAction }>({});
  const activeActionNameRef = useRef<string>('idle');

  // Bulletproof Material Parser to color meshes even if textures fail to bind on native EXGL
  useEffect(() => {
    const fixMaterials = (model: THREE.Group) => {
      model.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          const oldMat = mesh.material;
          
          const createSafeMaterial = (mat: any) => {
            let color = new THREE.Color('#ffffff');
            const name = child.name.toLowerCase();
            
            // Intuitively paint character body parts based on sub-mesh keywords
            if (name.includes('skin') || name.includes('face') || name.includes('body') || name.includes('head') || name.includes('hand') || name.includes('arm') || name.includes('leg') || name.includes('neck') || name.includes('torso')) {
              color.set('#ffcc99'); // Nice peach skin
            } else if (name.includes('hair') || name.includes('brow') || name.includes('eyebrow')) {
              color.set('#4a3728'); // Stylish brown hair
            } else if (name.includes('shirt') || name.includes('cloth') || name.includes('top') || name.includes('jacket') || name.includes('chest') || name.includes('upper') || name.includes('coat')) {
              color.set('#3b82f6'); // Vibrant blue shirt
            } else if (name.includes('pant') || name.includes('jeans') || name.includes('trouser') || name.includes('bottom') || name.includes('lower')) {
              color.set('#374151'); // Charcoal black jeans
            } else if (name.includes('shoe') || name.includes('boot') || name.includes('foot') || name.includes('sneaker')) {
              color.set('#1f2937'); // Black shoes
            } else if (name.includes('eye')) {
              color.set('#ffffff'); // Shiny white eyes
            } else {
              // Procedural unique color assignment based on mesh name hash to guarantee 0% black meshes!
              let hash = 0;
              for (let i = 0; i < name.length; i++) {
                hash = name.charCodeAt(i) + ((hash << 5) - hash);
              }
              const hue = Math.abs(hash % 360) / 360;
              color.setHSL(hue, 0.6, 0.6);
            }

            // Exclude broken maps that cause black texture errors in native EXGL
            const validMap = (mat.map && mat.map.image) ? mat.map : null;

            return new THREE.MeshStandardMaterial({
              color: color,
              map: validMap,
              roughness: 0.7,
              metalness: 0.1,
            });
          };

          if (oldMat) {
            // Memory Leak Fix: Dispose old GPU materials before assigning new ones
            if (Array.isArray(oldMat)) {
              mesh.material = oldMat.map(createSafeMaterial);
              oldMat.forEach(m => m.dispose());
            } else {
              mesh.material = createSafeMaterial(oldMat);
              oldMat.dispose();
            }
          }
        }
      });
    };

    if (idleFbx) fixMaterials(idleFbx);
    if (runFbx) fixMaterials(runFbx);
  }, [idleFbx, runFbx]);

  // Animation setup and clean up
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
      if (mixerRef.current) {
        mixerRef.current.stopAllAction();
        if (idleFbx) {
          mixerRef.current.uncacheRoot(idleFbx);
        }
      }
    };
  }, [idleFbx, runFbx]);

  // 60FPS Game Loop Logic (Fully decoupled from React re-renders)
  useFrame((state, delta) => {
    const speed = 15 * delta;
    const moveVector = moveVectorRef.current || new THREE.Vector2(0, 0);
    const isMoving = moveVector.lengthSq() > 0.001;
    const moveDirection = new THREE.Vector3();

    if (isMoving && groupRef.current) {
      // Calculate camera-relative forward and right directions
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(state.camera.quaternion);
      forward.y = 0;
      forward.normalize();
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(state.camera.quaternion);
      right.y = 0;
      right.normalize();

      // Mapped movements perfectly! UP goes FORWARD, RIGHT goes RIGHT. No inversions.
      moveDirection.addScaledVector(forward, moveVector.y)
                   .addScaledVector(right, moveVector.x);

      if (moveDirection.lengthSq() > 0) {
        moveDirection.normalize();
        const deltaPos = moveDirection.clone().multiplyScalar(speed);
        
        groupRef.current.position.add(deltaPos);
        state.camera.position.add(deltaPos); // Smoothly pan camera alongside character

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

    // Fully guarded controls targeting to avoid zooming / camera fighting errors
    if (state.controls && (state.controls as any).target) {
      const controls = state.controls as any;
      if (typeof controls.target.copy === 'function') {
        controls.target.copy(groupRef.current.position);
      }
      if (typeof controls.update === 'function') {
        controls.update();
      }
    }

    mixerRef.current?.update(delta);
  });

  return (
    <group ref={groupRef}>
      <primitive object={idleFbx} scale={0.01} />
    </group>
  );
}

// 3. Main App Layout
export default function App() {
  const [gameState, setGameState] = useState<'HOME' | 'PLAYING'>('HOME');
  
  // Decoupled Ref avoids massive 60FPS re-rendering/garbage collection overhead on App state
  const moveVectorRef = useRef(new THREE.Vector2(0, 0));

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
        
        <ambientLight intensity={0.9} />
        <directionalLight position={[10, 20, 10]} intensity={1.6} />
        
        <Suspense fallback={null}>
          <Ground />
          <Character moveVectorRef={moveVectorRef} />
        </Suspense>
      </Canvas>

      {/* Perfectly layered Joystick Container */}
      <View style={styles.joystickContainer}>
        <ReactNativeJoystick
          color="#00000080"
          radius={50}
          onMove={(data: any) => {
            if (data && data.angle) {
              const rad = data.angle.radian;
              const force = Math.min(data.force, 1);
              moveVectorRef.current.set(Math.cos(rad) * force, Math.sin(rad) * force);
            }
          }}
          onStop={() => {
            moveVectorRef.current.set(0, 0);
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
  
  // High z-index centered container to prevent collapsing or hiding behind Canvas
  joystickContainer: { 
    position: 'absolute', 
    bottom: 50, 
    left: 0,
    right: 0,
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    elevation: 9999,
  },
});