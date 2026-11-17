# Concept images → Tripo AI

Convert each image below to 3D in Tripo, export as **GLB with texture**, and save it in `assets/raw/` under the file name in the last column. If Tripo offers a face/polygon limit, use the number in the "Triangles" column; otherwise the pipeline script reduces it afterwards.

The two bodies are already done in Meshy (`assets/raw/body_female.glb`, `assets/raw/body_male.glb`, about 8.3k triangles each). `body_female.png` and `body_male.png` are kept only as style references.

## Character items

| Image | Triangles | Save as | Notes |
|---|---|---|---|
| `top_tshirt.png` | 1,500 | `top_tshirt.glb` | Must stay hollow (open neck, sleeves, hem) |
| `bottom_denim_shorts.png` | 1,500 | `bottom_denim_shorts.glb` | Knee-length. Must stay hollow |
| `shoes_sneakers.png` | 1,200 | `shoes_sneakers.glb` | Both shoes in one model |
| `hair_male_short.png` | 1,500 | `hair_male_short.glb` | Grey on purpose: colored in game |
| `hair_female_bob.png` | 1,500 | `hair_female_bob.glb` | Grey on purpose: colored in game |
| `acc_headset.png` | 1,000 | `acc_headset.glb` | Shown when a player is deafened |
| `acc_beanie.png` | 800 | `acc_beanie.glb` | |

## Props

| Image | Triangles | Save as |
|---|---|---|
| `prop_bed.png` | 3,000 | `prop_bed.glb` |
| `prop_sofa.png` | 3,000 | `prop_sofa.glb` |
| `prop_fridge.png` | 1,500 | `prop_fridge.glb` |
| `prop_stove.png` | 2,500 | `prop_stove.glb` |
| `prop_coffee_table.png` | 800 | `prop_coffee_table.glb` |
| `prop_chair.png` | 1,200 | `prop_chair.glb` |
| `prop_cake.png` | 1,500 | `prop_cake.glb` |
| `prop_broom.png` | 800 | `prop_broom.glb` |
| `prop_mop.png` | 1,000 | `prop_mop.glb` |

## Style prompt (for making more images later)
"Cute chibi stylized low-poly 3D game asset, soft pastel colors, hand-painted look, smooth simple shapes, soft even lighting, no shadows, plain white background, centered, single isolated object fully visible." Props use an isometric three-quarter view from slightly above.
