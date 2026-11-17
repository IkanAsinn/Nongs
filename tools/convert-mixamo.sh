#!/usr/bin/env bash
# Converts the Mixamo FBX files in assets/mixamo to GLB in assets/converted.
# Needs tools/fbx2gltf/FBX2glTF.exe (FBX2glTF v0.9.7 from facebookincubator/FBX2glTF releases).
set -euo pipefail
cd "$(dirname "$0")/.."
conv=tools/fbx2gltf/FBX2glTF.exe
mkdir -p assets/converted
for body in assets/mixamo/body_*_rigged.fbx; do
  name=$(basename "$body" _rigged.fbx)
  "$conv" --binary -i "$body" -o "assets/converted/$name"
done
for anim in assets/mixamo/animations/*.fbx; do
  "$conv" --binary -i "$anim" -o "assets/converted/$(basename "$anim" .fbx)"
done

# The bodies' textures as WebP: several times smaller to download.
node tools/optimize-textures.mjs assets/converted/body_*.glb
