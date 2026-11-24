# Nongs — To do

Pick the first unchecked item. Background and decisions are in `PLAN.md` (§9 deployment, §10 milestones and status). Tick items off here and update `PLAN.md` when something changes how the game works.

Last updated: 2026-11-24.

## 1. Deploy to Dokploy

Panel: `https://dokploy.ikanasinn.com`. The API key is in the `DOKPLOY_API_KEY` user environment variable on the dev machine (header `x-api-key`, endpoints `/api/<router>.<procedure>`, e.g. `/api/project.all`). Dokploy's GitHub connection ("Dokploy IkanAsinn.com") can already pull this repository.

The VPS firewall only opens **80 and 443**. `deploy/docker-compose.yml` is written for that: voice audio goes as TURN over TLS on its own domain through Traefik. Read the comment at the top of that file first.

- [ ] Choose three domains, e.g. `nongs.ikanasinn.com` (game), `voice.ikanasinn.com` (LiveKit signalling), `turn.ikanasinn.com` (voice audio).
- [ ] DNS (Cloudflare): point all three at the VPS. **The TURN domain must be "DNS only" (grey cloud).** The other two may be proxied, with WebSockets on.
- [ ] In Dokploy, create a project "Nongs" and a Compose service from `IkanAsinn/Nongs`, branch `main`, compose path `deploy/docker-compose.yml`.
- [ ] Environment: `POSTGRES_PASSWORD` and `LIVEKIT_API_SECRET` (long random values, secret ≥ 32 characters), `LIVEKIT_API_KEY=nongs`, `VOICE_DOMAIN`, `TURN_DOMAIN`.
- [ ] Domains tab: game domain → service `game`, port 5181; voice domain → service `livekit`, port 7880. HTTPS with Let's Encrypt. Do **not** add the TURN domain there; the labels in the compose file route it.
- [ ] Deploy (ask the owner first; it makes the game public). Watch the build log: the image builds the client, so it takes a few minutes.
- [ ] Check: `https://<game domain>/api/health` answers, registering and logging in work, two players see each other.
- [ ] Check voice: the HUD must not say "No voice chat"; two players in one room hear each other. If audio does not connect, suspect the Traefik TCP router first: it assumes Dokploy's defaults (entrypoint `websecure`, cert resolver `letsencrypt`) and that the TURN domain got a certificate.
- [ ] Invite the closed beta.

## 2. Voice, tested properly

Voice is written but has never run against a real LiveKit server. Test it on the deployed server (or locally with `livekit-server --dev` and `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` set):

- [ ] Two players in the same room hear each other at full volume.
- [ ] In the backyard, volume fades with distance (silent at 12 m).
- [ ] Mute and deafen work, and show the tape and the headphones to others.
- [ ] Walking through a door switches to the other zone's voice room.
- [ ] A locked room: no voice from outside; sitting in the bathtub mutes and deafens.

## 3. Performance

- [ ] FPS test on the target laptop (4-core CPU, 8 GB RAM, integrated GPU) with 8 and then 16 players (`PLAN.md` §7: 60 FPS with 8, at least 30 with 16). The view from the front door is the heaviest (about 180 draw calls, 160k triangles).
- [ ] Clothing is drawn as extra passes of the body (about 5 draws per character); check this holds up with 16 players in one room.

## 4. Features still missing

- [ ] **Other players' hands:** only `carrying` is synced; draw the broom, mop or plate in other players' hands.
- [ ] **Shared cooking:** pots, pans and the stove are each player's own; the server only checks the meal's effect on hunger.
- [ ] **Loose clothing** (skirts, hoodies, capes): needs the `split-body` and `fit-clothing` scripts and the `apps/fitter` tool (`PLAN.md` §4.2).

## 5. Housekeeping

- [ ] Re-run `tools/blender/build_house.py` once in Blender to confirm it reads `packages/shared/src/furniture.data.json`.
- [ ] Optional: open 7881/tcp and 7882/udp on the VPS and publish them on the `livekit` service for lower voice latency.
