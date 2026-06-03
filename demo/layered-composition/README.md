# Demo — Three disciplines, one column (layered composition)

One column. Three teams, each authoring an independent `.ifcx` **layer** with its own
opinion about that column. Federate the layers → **one** column carrying everyone's data.
This is the core IFCX/IFC5 idea (and the USD idea it descends from) made concrete.

| Layer | Opinion about the same column UUID `2a3b…0c01` |
|-------|------------------------------------------------|
| [`architect.ifcx`](architect.ifcx)   | identity + placement: *"Column-1, grid A/2, 3.0 m tall"* |
| [`structural.ifcx`](structural.ifcx) | *"load-bearing, steel grade S355"* — and as-built height **3.2** (a deliberate conflict) |
| [`fire.ifcx`](fire.ifcx)             | *"90-minute fire rating (R90)"* |

Each file carries its own **provenance** in the header (`author`, `timestamp`, `dataVersion`)
and ships the **schemas** for the attributes it introduces — so closed-world validation
travels with the data.

---

## Stage 1 — Runnable now (this repo) ✅ verified

```bash
./demo/layered-composition/run.sh
```

It builds the alpha `ifcx` CLI (`src/`, esbuild) and walks the beats. The engine is the
repo's own `src/ifcx-core/composition` + `ifcx-cli compose`. Nothing new added to the engine.

**Beat 1 — federation (cumulative).** The column's attribute set grows as layers stack:

```text
architect            -> { name, height:3.0, location, … }
+ structural         -> { …, loadBearing, steelGrade:S355, height:3.2 }   # height overridden
+ fire               -> { …, fireRatingMinutes:90, fireRatingClass:R90 }  # full column
```

**Beat 2 — conflict = layer order ("later wins").** Both architect and structural state a
`height`. Compose `architect structural` → **3.2** wins (structural is later/stronger).
Reverse to `structural architect` → **3.0** wins. Conflict resolution is purely *position in
the stack* — the same rule as USD's "strongest opinion wins."

**Beat 3 — closed-world validation rejects bad opinions.**

```text
steelGrade "S999"        -> Expected "S999" to be one of [S235,S275,S355,S460]
fireRatingMinutes "ninety" -> Expected "ninety" to be of type int
```

(The bad `S999` layer doesn't even define the enum schema — it inherits the rule from the
structural layer. **Schemas federate too.**) This is also the exact code path behind
issue #125: the validation message embeds the file's own value, which is why the viewer must
render it with `textContent`, not `innerHTML`.

### Manual one-liners

```bash
cd src && npm install && npx esbuild ifcx-cli/ifcx-cli.ts --bundle \
  --outfile=ifcx-cli.js --external:three --platform=node
D=../demo/layered-composition
node ifcx-cli.js compose --no-fetch $D/architect.ifcx $D/structural.ifcx $D/fire.ifcx out.json
```

---

## Stage 2 — Make it visual (reference viewer) ✅ built

Same three disciplines, now with geometry, in [`viewer/`](viewer/):

- [`viewer/architect.ifcx`](viewer/architect.ifcx) — adds a **box mesh** (`usd::usdgeom::mesh`)
  for the column + a default **grey** material (`bsi::ifc::presentation::diffuseColor`).
- [`viewer/structural.ifcx`](viewer/structural.ifcx) — the structural opinions (as Stage 1).
- [`viewer/fire.ifcx`](viewer/fire.ifcx) — the fire opinions **and overrides the colour to red**.

The web viewer federates every loaded file itself (`src/viewer/compose-flattened.ts` →
`compose3`), so you just load the three layers — no pre-compose step.

```bash
cd src && npm run serve          # esbuild builds render.mjs + serves web/viewer
# open the printed localhost URL
```

In the viewer's **Layer browser** ("lower takes priority"), load the files **in order
architect → structural → fire** (the file picker is multi-select). Then:

1. The column renders. **Click it** → the *Selection attributes* panel
   (`render.ts` → `handleClick`) shows the **merged** set: name, height (3.0, matching the
   mesh), load-bearing, S355, fire R90. (The height *conflict* is demonstrated in Stage 1; the
   viewer layers keep height at 3.0 so the attribute and the drawn geometry stay consistent.)
2. **Punchline:** the column is **grey** with only architect+structural loaded, and turns
   **red** the moment the fire layer is added — *adding a layer visibly changes the model*,
   not just the JSON. (Verified at the data level: `diffuseColor` composes
   `[0.6,0.6,0.6] → [0.85,0.15,0.1]`.)

> These files are fully offline (inline schemas, no `imports`), so they also compose in the
> CLI — `run.sh` verifies the grey→red colour flip headlessly.

### Headless stills (no browser)

For environments without WebGL, [`viewer/render-still.mjs`](viewer/render-still.mjs) is a
~150-line, dependency-free software rasterizer (built-in `zlib` only) that renders a composed
column to PNG:

```bash
node demo/layered-composition/viewer/render-still.mjs <composed.json> out.png
```

`run.sh` writes `column-grey.png` / `column-red.png` this way. Back-face culling draws exactly
6 of the box's 12 triangles, which doubles as a check that the mesh winding is outward.

---

## Stage 3 — Geometry tiers (P/B/M) ✅ illustrated

Fidelity is itself a composable opinion. [`tiers/gen-tiers.mjs`](tiers/gen-tiers.mjs)
procedurally emits the same column at three tiers, each a layer that overrides
`usd::usdgeom::mesh`:

| Tier | File | Geometry |
|------|------|----------|
| **P** Profile  | [`tiers/tier-P.ifcx`](tiers/tier-P.ifcx) | the steel cross-section as a closed `basiscurves` polyline |
| **B** Boundary | [`tiers/tier-B.ifcx`](tiers/tier-B.ifcx) | a coarse extruded **box** (architect's massing volume) |
| **M** Mesh     | [`tiers/tier-M.ifcx`](tiers/tier-M.ifcx) | the full extruded **I-section** (structural steel profile) |

```bash
node demo/layered-composition/tiers/gen-tiers.mjs            # (re)generate the tiers
# compose discipline layers + ONE tier; the tier wins over the architect's box:
cd src && node ifcx-cli.js compose --no-fetch \
  ../demo/layered-composition/viewer/{architect,structural,fire}.ifcx \
  ../demo/layered-composition/tiers/tier-M.ifcx  out.json
DOUBLE=1 node ../demo/layered-composition/viewer/render-still.mjs out.json isection.png
```

The narrative: the **architect ships tier B** (a massing box); the **structural engineer**,
knowing it's an S355 section, **ships tier M** — the actual steel I-section — which *wins* over
the box in composition. Same column, fidelity chosen per-load. Mirrors
`LTplus-AG/IFCX@louistrue-geometry-tiers` (commit *"Ship geometry tiers P/B/M with latent-path
face addressing"*), whose viewer adds the live tier-toggle UI + SVG profile rendering.

> Tier **P** renders as a curve in the live viewer (its `basiscurves` branch). To see *only*
> the profile, the mesh attribute must be cleared — a natural place to show the alpha
> `null`-tombstone, and why post-alpha's explicit `DELETE` opinion is the better design.

### Live in the fork

Clone `LTplus-AG/IFCX`, checkout `louistrue-geometry-tiers`, build its viewer, load a tiered
asset, exercise the tier-toggle UI. (Different repo — not pushable from here.)

---

## Stage 4 — The finale: live federation (`LTplus-AG/ifc-lite#897`)

Static file-federation → **live** federation. Three browser windows = architect / structural /
fire as live **CRDT peers** sharing one room link. Someone types `S355` and it appears on
everyone's column in real time. Built on the same **GUID-path identity** that makes
alpha→post-alpha merging safe (peers converge on GUID paths regardless of local IDs).

Runbook:
1. Server: set `COLLAB_TOKEN_SECRET`, start the collab server (JWT room tokens, mint/revoke/kick).
2. Open the viewer; create a room (first-touch = creator/admin); copy the invite link.
3. Open the link in two more windows = the other two disciplines.
4. Edit a property in one → watch it replicate live; show the Room HUD (presence, roles, revoke).

> Known review items to fix before a live demo: `parseRoleFromToken` must decode the JWT's
> middle segment (not the whole token); room-claim persistence across server restarts;
> concurrent geometry-ref additions can drop updates (plain-array in `Y.Map`).

---

## Talking points (each beat → the architecture)

- **Later-wins (Beat 2)** = USD "strongest opinion wins." Today the override is **silent** —
  you can't see *who* lost. Post-alpha fixes this with explicit `VALUE / DELETE / PASS_THROUGH`
  opinions + a mandatory provenance header per section. (Our layers already carry author/
  timestamp in the header — point at it.)
- **Validation (Beat 3)** = the open-world (any node, any attribute) vs closed-world
  (a column *must* be S235–S460) tension, resolved by schemas that **federate with the data**.
- **UUID path** = global identity, the prerequisite for collision-free multi-author federation
  — and exactly what the Stage 4 CRDT relies on.
