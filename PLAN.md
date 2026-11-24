# Nongs — Game Plan

Browser-based multiplayer cozy house game. Third-person (TPV) and first-person (FPV) views, room-based voice chat, activities (cooking, cleaning, decorating, birthdays), and customizable male and female characters.

## Decisions

| Topic | Decision |
|---|---|
| World | **One shared house for everyone** (single Colyseus room) |
| Capacity | **16 players max**; when full, new players get a "House is full" message |
| Auth | **Username + password**, stored in Postgres (argon2id hash) |
| Characters | Male and female, **full modular customization** (tops, bottoms, shoes, hair, accessories, colors) |
| Blender | Available through MCP since 2026-11. The house and all furniture are built by scripts in `tools/blender/`. The TypeScript pipeline in §4.2 is still the plan for clothing. |
| Target hardware | 4-core CPU, 8 GB RAM, integrated GPU |
| Hosting | Own VPS, Docker, Dokploy |

## 1. Tech stack

| Layer | Choice |
|---|---|
| Client | Three.js + TypeScript + Vite |
| Character physics | Rapier (WASM) kinematic capsule |
| Multiplayer state | Colyseus (Node.js), server-authoritative, 20 Hz + client interpolation |
| Voice | LiveKit (self-hosted SFU) |
| Database | PostgreSQL |
| Asset pipeline | Node scripts: `@gltf-transform/*`, `three-mesh-bvh`, KTX2 / meshopt |

```
apps/client      Three.js game + character creator (dev server: http://localhost:5180)
apps/server      Colyseus + REST (auth, LiveKit token minting)
apps/fitter      Browser dev tool for fitting clothing (dev only)
packages/shared  types, constants, zones, recipes, catalogs
assets/raw       Meshy downloads (untouched)
assets/out       Optimized game-ready GLBs
tools/pipeline   Asset processing scripts
deploy/          docker-compose.yml (Dokploy)
```

## 2. Server-authoritative rules
The client renders, reads input and animates. The server owns positions (validated), door locks, stats, dirt, furniture and **voice access**. Privacy depends on this: a client never receives audio it is not allowed to hear.

## 3. Accounts
- `POST /auth/register` and `POST /auth/login`. Passwords hashed with **argon2id**. Session token in an httpOnly, Secure cookie. Login is rate-limited.
- Username rules: 3–16 characters, `[a-zA-Z0-9_]`, unique (case-insensitive).
- Colyseus `onAuth` checks the session. One active connection per account (a new login kicks the older session).

### Tables
```
users(id, username, password_hash, birthday, created_at)
avatars(user_id, config jsonb)
player_stats(user_id, energy, hunger, updated_at)
house(id, last_online_at)                  -- single row for now
room_state(room_id, dirt, locked_by)
furniture(id, item_key, room_id, x, y, z, rot_y, placed_by)
```

## 4. Characters and customization

### 4.1 Model structure
- **Two base bodies** (male and female) sharing **one skeleton** (same bone names and hierarchy). Every animation clip works on both. Clips keep rotation tracks only, plus the hips' position track.
- The body is **split into segments** (head, torso, upper arms, forearms, hands, thighs, shins, feet). Clothing hides the segments it covers, which prevents clipping and saves triangles.
- **Skinned clothing** (tops, bottoms, shoes): separate GLBs bound to the body skeleton at runtime. One fitted version per gender.
- **Rigid items** (hair, hats, glasses, bags, headset, mouth tape): attached to bone sockets.
- **Colors** are applied by tinting through mask textures. **Patterns** are made with `meshy_retexture`.
- Budget: about 10k triangles and 4–6 draw calls per character.

**What is built now (2026-11-11) is simpler than the above.** Clothes and the hair cap are *shells*: the body mesh drawn again, pushed out a few millimetres and cut to the garment's shape in the shader (`apps/client/src/player/outfit.ts`). No clothing models, no body splitting and no fitting step are needed, and a shell can never clip through an animation. Loose hair (long, ponytail, buns) is a few spheres on the head bone. The skin under a garment is not drawn. The catalogue and the saved look are in `packages/shared/src/avatar.ts`. The cost is one extra draw of the body per garment (about 5 draws per character), which needs a second look before 16 players share a room. Separate clothing meshes as described above are still the way to get skirts, hoodies, hats and other shapes that do not follow the body.

```json
{ "gender":"female", "skin":"#c68a6b", "face":"face_03",
  "hair":"bob_01", "hairColor":"#2b1a10",
  "top":"hoodie_01", "topColor":"#e85d75", "topPattern":"plain",
  "bottom":"jeans_01", "bottomColor":"#3b4a6b", "shoes":"sneaker_01",
  "accessories":["glasses_round","beanie_01"] }
```

### 4.2 Blender-free pipeline (our own tools)
Blender's main job here would be weight painting, and that step can be automated.

1. **`split-body`** (script): assigns each triangle of the rigged body to a segment by its dominant bone weight, then exports named sub-meshes.
2. **`fit-clothing`** (script):
   - Aligns the clothing mesh to the body's region (torso, legs or feet) by bounding box, with an optional per-item offset and scale from `fit.json`.
   - **Shrinkwrap outward:** any clothing vertex inside or too close to the body surface is pushed out along the normal to `body surface + 4–8 mm` (`three-mesh-bvh` closest-point queries).
   - **Weight transfer:** each clothing vertex copies skin indices and weights from the nearest point on the body, interpolated across that triangle with barycentric coordinates. The top 4 weights are kept and normalized.
   - Writes the coverage mask (which body segments to hide) into the GLB extras.
3. **`apps/fitter`** (browser dev tool): loads body + clothing, provides sliders for offset, scale and inflate, plays walk, run and sit animations to check clipping, and saves `fit.json`. Re-running the script uses those values.
4. **`optimize`** (script): runs resize, KTX2, meshopt, sets 1 unit = 1 m and puts the pivot at the floor.

Clothing generation tip: generate clothing concepts **already worn on the same A-pose mannequin** (`image_to_image` from the base body render). The garment then has the right proportions and pose, so fitting is mostly the shrinkwrap step.

Fallback: Blender is free and can run headless (`blender --background --python script.py`), so it can be added later for hard cases (long dresses, capes) without anyone needing to learn its UI.

### 4.3 Starter content
2 bodies, 6 hairstyles per gender (each body has its own list, `HAIR_FOR` in `packages/shared/src/avatar.ts`), 5 tops, 4 bottoms, 3 shoes (each fitted for both genders), 10 rigid accessories, 6 faces, and pattern retextures.

## 5. Voice
- Each closed room and each open area is a **zone** (see `packages/shared/src/house.ts`: living room, entry, kitchen, three bedrooms, bathroom, lawn). Each zone is a **separate LiveKit room** (`nongs-kitchen`, `nongs-living`, …). The server only mints a token for the zone you are standing in, and crossing a door switches channels (about 0.5 s).
- **Open-area falloff:** subscribe only to players within 15 m. Web Audio `PannerNode` (equalpower): full volume at 1 m, silent at 12 m. At most 8 active streams.
- **Locks:** only someone inside a room can lock it. The server refuses entry and voice tokens while it is locked; people inside can always leave. The room auto-unlocks when empty. Includes a knock interaction. The client side is done (2026-11-17): L locks or unlocks the bedroom or bathroom you are in while its door is shut, opening from inside unlocks, outside a locked door E knocks, and a lock comes undone when its owner leaves. The rules are in `packages/shared/src/locks.ts`; `?locked=<room id>` locks a room as if someone else were inside. Still to do: the server keeps the locks, sends them to everyone and refuses entry and voice.
- **Mute** shows grey tape crossed over the mouth and **deafen** shows headphones; neither shows in the bath (`voiceSigns` in `packages/shared/src/voice.ts`). The tape is a shell on the face (`outfit.ts`); the headphones are modelled in Blender (`tools/blender/build_gear.py`) to fit any head. The server will sync the two flags.
- The microphone needs HTTPS and a user click.
- **Bath:** sitting in the bathtub turns the microphone and the sound off, and gives both back on getting out. The rule is `packages/shared/src/voice.ts` (`canSpeak`, `canHear`); the server must apply the same rule when it mints tokens.

## 6. Gameplay systems
- **Stats:** Energy and Hunger, computed on the server. They drain while online and freeze while offline. Low values cause slower movement and yawn animations. Sleeping in a bed restores Energy; eating restores Hunger.
- **Cooking:** pick a recipe at the fridge (6 recipes in `packages/shared/src/cooking.ts`) → E at a counter switches to FPV. Each step is a mouse gesture (chop, circle, drag, shake, flip) with an on-screen hint. Stove steps are timed: some must wait until the food is ready, and every one burns if the cook is late. A burnt meal is binned and the cook starts again from the fridge. A served dish gets 1–3 stars and is carried and eaten with Q. Kitchen props come from `tools/blender/build_kitchen_kit.py` (`cooking_kit.glb`).
- **Reactions:** T, then 1–7: wave, clap, cheer, shrug, laugh (keyframed in Blender on the game rig by `tools/blender/build_reactions.py`, exported as `react_<name>.glb`), dance and blow a kiss (Mixamo). Played over standing still; moving stops them.
- **Music and settings:** background music is made in code (`apps/client/src/audio/music.ts`), so nothing is downloaded. O opens Settings: music and sound-effect volume (kept in the browser) and Log out.
- **Pool slide:** a curved water slide (`SLIDE` in `house.ts`, built in `build_house.py`). Climb the ladder, slide down, splash into the pool.
- **Birthday:** taken from `users.birthday`, a DD-MM-YYYY date asked at registration (`?birthday` forces the event). The cake only appears on the coffee table on that day. Players **blow into the mic** (low-frequency loudness detection), and the candles go out with a smoke effect. Holding a key works as a fallback.
- **Litter:** each room holds a few pieces of litter (at most one per 9 m², at least two), modelled in Blender (`tools/blender/build_litter.py` → `litter.glb`: paper, can, banana peel, crisp packet, crumbs). Spills (a puddle of juice) need the mop; everything else needs the broom. Half of the kitchen's and bathroom's litter is spills, 15% elsewhere. A new piece turns up about every 4 minutes in an occupied room and about every 8 hours in an empty one (`litterDue` in `rules.ts`). The broom only sweeps up pieces within reach of its brush. On the first login after the house was empty, add the pieces built up since `last_online_at`. Players clean with a broom or mop.
- **Decorating:** build mode with a catalog, grid snap, rotation and placement. The server validates and saves every change. Walls and floors are fixed; furniture is movable, except kitchen and bathroom fittings and ceiling lamps (`MOUNTS` in `packages/shared/src/decor.ts`).
- **Own pictures:** a player can put an image of their own in any picture frame. It is cropped and shrunk to 512×364 in the browser before it is stored.
- **Swimming:** the backyard pool is 6 × 12 m and 1.15 m deep (`POOL` in `packages/shared/src/house.ts`). Where the water reaches the neck the body floats: it treads water when still and swims a stroke when moving (Shift swims faster). The pose is made in code on top of the idle clip, so no swimming clip is needed. Clothes come off in the water. Steps lead in and out at the south end, and E climbs out at any other side.
- **Camera:** V toggles TPV/FPV. In FPV your own head is hidden. In TPV the camera is pulled in when a wall blocks it.

## 7. Performance budget
- Fewer than 150 draw calls and 300k visible triangles. Textures: 1K for large objects, 512 for small props, KTX2 compressed, meshes meshopt-compressed.
- Render only your current room plus rooms visible through open doors.
- Lighting: baked AO on walls and floors, hemisphere light plus one shadow light, blob shadows under characters.
- Instancing for repeated props. Pixel ratio capped at 1, with dynamic resolution down to 0.75 when FPS drops.
- Target: 60 FPS with 8 players and at least 30 FPS with 16.

## 8. Meshy asset pipeline
- **Shared style prompt:** "cute chibi style, about 2.5 heads tall, cozy stylized low-poly, soft pastel colors, hand-painted look, game asset, plain white background, front view".
- **Budget (100 Meshy credits/month, resets on the 1st):** Meshy spends credits on 2 base bodies (3D) and nano-banana concept images (3 credits each). The user converts the remaining concepts to 3D in **Tripo AI** and puts the GLBs in `assets/raw/`.
- **Rigging and animation: Mixamo (free).** Both bodies get the standard Mixamo skeleton, so male and female share bone names. Animations are downloaded once "without skin" and reused for both. FBX files are converted to GLB with a script.
- **Chibi + Mixamo rules:** A-pose with arms clear of the body and legs apart; head about 1/2.5 of total height; arms long enough to reach the face. Clips where the hands come near the face (eat, blow, yawn) will need small arm-offset corrections in code.
- **Props:** `text_to_image` → `image_to_3d` (meshy-t2 + meshy-n1, target_polycount) → `optimize`.
- **Bodies:** A-pose chibi concept → meshy-t2.5 (~8k triangles) → Mixamo auto-rig → Mixamo animations (idle, walk, run, sit, sleep, eat, cook, sweep, mop, blow, wave, dance, yawn) → FBX→GLB → `split-body`.
- **Clothing:** `image_to_image` (garment on mannequin) → meshy-t2 + meshy-n1 → `fit-clothing` → fitter check.
- Walls and floors are **not** made in Meshy. They are modular pieces built in code.
- **Estimate:** about 2,300 credits, or about 3,200 with retries. Every paid call is confirmed first.

## 9. Deployment (Dokploy)
- One `game` container serves the built client, the API and the game server's WebSocket on port 5181, behind Traefik (see `deploy/docker-compose.yml`).
- The VPS only has ports **80 and 443** open, so everything goes through Dokploy's Traefik. LiveKit signaling is an ordinary HTTPS domain (`VOICE_DOMAIN`). The audio goes over LiveKit's built-in TURN over TLS on a third domain (`TURN_DOMAIN`): a Traefik TCP router picks that name out of port 443 by SNI and hands it to LiveKit's port 5349. Browsers try direct UDP first and fall back to this relay. With Cloudflare, `TURN_DOMAIN` must be DNS only. Opening 7881/tcp and 7882/udp later would give lower latency without other changes.
- Dokploy panel: `dokploy.ikanasinn.com` (its GitHub connection can already pull this repository).
- VPS: 4 vCPU and 4–8 GB RAM. Bandwidth is the main cost (about 8 Mbps per listener with 16 people talking in one zone).

## 10. Milestones
The repo uses **npm workspaces** (`npm install`, `npm run dev`, `npm test`, `npm run typecheck`).

1. **Pipeline test:** 1 body (rig + 2 animations), 1 shirt, 1 hat, 3 props → split-body, fit-clothing, fitter → FPS test on a target-spec laptop.
2. Blockout house, character controller, TPV/FPV.
3. Accounts, Colyseus sync, nametags, character creator.
4. LiveKit zones, distance falloff, locks, mute/deafen visuals.
5. Stats, sleeping, eating.
6. Cooking, then dirt and cleaning, then decorating.
7. Birthday event.
8. Full Meshy art pass and optimization.
9. Dokploy deployment and closed beta.

### Status (2026-11-18)
Everything that matters is now decided by the server (`apps/server/src/house.ts`, one Colyseus room for the whole house, 16 places). The client draws, predicts and asks.

| Milestone | State |
|---|---|
| 1 Pipeline test | Partly done: both bodies rigged in Mixamo with 13 clips. Clothes and hair are shells of the body (§4.1). Hats (beanie, cap) and glasses (round, square, sunglasses) are modelled in Blender (`tools/blender/build_accessories.py`) and fixed to the head bone like the headphones. `split-body`, `fit-clothing` and the fitter are not written; skirts and other loose clothing still need them. |
| 2 House and controller | Done. |
| 3 Accounts and multiplayer | Done. Colyseus 0.16 on the API's own port under `/colyseus`; `onAuth` reads the session cookie; one connection per account (a new log in replaces the old one); 20 s to reconnect after a drop. Other players are drawn with their look, name tag, animation, swimming, lying down, bath and voice signs, moved smoothly 0.12 s behind. The server checks every move (speed, locked rooms). |
| 4 Voice | Done in code, not yet tried against a real LiveKit server. `/api/voice/token` gives a token for the zone's LiveKit room (`nongs-<zone>`); rooms are heard at full volume, open areas (lawn, backyard) fade with distance (`voiceVolume`). Muting, deafening and the bath are enforced by the token's grants; changing zone moves the player to the other LiveKit room. Without `LIVEKIT_*` settings the HUD says "No voice chat". |
| 5 Stats, sleeping, eating | Done on the server: stats tick there, are saved in `player_stats` and stay frozen while offline. |
| 6 Cooking, dirt, decorating | Done on the server: litter builds up there (also while the house is empty), sweeping is checked for reach and tool, doors and locks (knocking, opening from inside unlocks) are shared, furniture moves are checked with `checkPlacement` and saved in `furniture`. Pictures are stored on the server, re-encoded to 512 × 364 JPEG, and anyone can take a bad one down. Storage instead of a shop: in decorate mode X puts a piece away and C takes stored pieces out again. Cooking itself stays on the client; only the meal's effect on hunger goes through the server. |
| 7 Birthday | Done: six candles on the cake, blown out by blowing into the microphone (a low, loud sound for 0.8 s) or by holding F; slices are refused until then. The cake resets each new day. |
| 8 Art pass | Furniture is drawn in batches, one per material (`apps/client/src/world/batches.ts`); closed rooms are only drawn from inside or through an open door (`world/visibility.ts`); resolution drops to 0.75 when the frame rate falls. Draw calls: about 180 at the front door looking in (was 364), 80–110 inside rooms. Body textures are WebP (4.4 MB → 1.3 MB), one copy per body shared by every player. KTX2 was not done: the furniture textures are already 10–35 KB JPEGs, and the bodies are the only large ones. |
| 9 Deployment | Ready to try: `Dockerfile` (one image: game, API and game server on port 5181), `deploy/docker-compose.yml` (game, PostgreSQL 16, LiveKit with its configuration inline, voice over port 443 only). Not yet deployed. |

### Action items, in order
1. **Try voice for real.** Run LiveKit (`livekit-server --dev`, or the compose file) with `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` set, and check two players in one room, in the backyard at a distance, muting, deafening and a zone change.
2. **FPS test on the target laptop** with 8 and then 16 players (§7). The entrance view is the heaviest (about 180 draw calls, 160k triangles).
3. **Deploy to Dokploy** (comments at the top of `deploy/docker-compose.yml`), then invite the closed beta.
4. **Other players' hands.** Only what a player carries is synced (`carrying`); the broom, mop or plate is not drawn in other players' hands yet.
5. **Loose clothing** (skirts, hoodies) needs `fit-clothing` and the fitter (§4.2).
6. **Shared cooking.** Pots, pans and the stove are still each player's own; the server only checks the meal's effect.

Housekeeping: re-run `tools/blender/build_house.py` once in Blender to confirm it reads the shared furniture file.
