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

```
architect            -> { name, height:3.0, location, … }
+ structural         -> { …, loadBearing, steelGrade:S355, height:3.2 }   # height overridden
+ fire               -> { …, fireRatingMinutes:90, fireRatingClass:R90 }  # full column
```

**Beat 2 — conflict = layer order ("later wins").** Both architect and structural state a
`height`. Compose `architect structural` → **3.2** wins (structural is later/stronger).
Reverse to `structural architect` → **3.0** wins. Conflict resolution is purely *position in
the stack* — the same rule as USD's "strongest opinion wins."

**Beat 3 — closed-world validation rejects bad opinions.**

```
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

## Stage 2 — Make it visual (reference viewer)

Goal: render the column in `web/viewer`, click it, watch the **property panel**
(`src/viewer/render.ts` → `handleClick`) show the *merged* attributes; then make a later
layer *visibly* change the column.

Steps:
1. Add real geometry to the architect layer — a box mesh + `usd::xformop::transform`
   (copy the shape of an existing example, e.g. `examples/Hello Wall/*`). Geometry is just
   another attribute opinion.
2. Build + serve: `cd src && npm run serve` (esbuild builds `render.mjs`, serves `web/viewer`).
3. Drag the composed file in; click the column → merged attributes appear.
4. **Punchline:** drive a material/colour from a later layer (e.g. fire layer → red tint, or a
   "R90" badge) so *adding a layer visibly changes the model*, not just the JSON.

> Note: the web viewer composes internally; feed it the layer file(s), not the
> `NodeToJSON` tree that the CLI prints.

---

## Stage 3 — Geometry tiers (`LTplus-AG/IFCX@louistrue-geometry-tiers`)

The architect's *geometry* opinion becomes **tiered — P/B/M** (Profile → Boundary → Mesh),
with selective per-tier loading and SVG profile rendering (commit *"Ship geometry tiers P/B/M
with latent-path face addressing"*).

Demo: on the same column, toggle **Profile → Boundary → Mesh**. Message — an opinion about
geometry isn't one blob; **fidelity is itself composable / load-on-demand**. Pairs naturally
with the discipline-layers story.

Runbook: clone the fork, checkout `louistrue-geometry-tiers`, build its viewer, load a
tiered asset, exercise the tier-toggle UI. (Outside this repo — guided, not scripted here.)

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
