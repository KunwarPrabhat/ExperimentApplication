const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Add 3D asset extensions to Metro's asset resolver
config.resolver.assetExts.push(
  'glb',
  'gltf',
  'fbx',
  'png',
  'jpg'
);

module.exports = config;