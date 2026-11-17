// Re-encodes the textures inside GLB files as WebP, in place, so they download
// several times faster. three.js reads WebP textures (EXT_texture_webp) itself.
//
//   node tools/optimize-textures.mjs assets/converted/body_female.glb assets/converted/body_male.glb
//
// Only opaque textures are worth it here; textures with see-through parts keep
// their alpha in WebP too, so nothing is lost either way.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import sharp from 'sharp';
import { statSync } from 'node:fs';

const QUALITY = 88;
const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('Give the GLB files to optimize.');
  process.exit(1);
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const file of files) {
  const before = statSync(file).size;
  const document = await io.read(file);
  let changed = false;
  for (const texture of document.getRoot().listTextures()) {
    const image = texture.getImage();
    if (!image || texture.getMimeType() === 'image/webp') continue;
    texture.setImage(new Uint8Array(await sharp(image).webp({ quality: QUALITY }).toBuffer()));
    texture.setMimeType('image/webp');
    texture.setURI(texture.getURI().replace(/\.(png|jpe?g)$/i, '.webp'));
    changed = true;
  }
  if (changed) document.createExtension(EXTTextureWebP).setRequired(true);
  await io.write(file, document);
  const after = statSync(file).size;
  console.log(`${file}: ${(before / 1e6).toFixed(2)} MB -> ${(after / 1e6).toFixed(2)} MB`);
}
