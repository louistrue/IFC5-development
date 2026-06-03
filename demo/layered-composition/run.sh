#!/usr/bin/env bash
#
# Layered-composition demo: three disciplines, one column.
#
#   architect.ifcx   -> "Column-1 is here, it's 3.0 m tall"
#   structural.ifcx  -> "load-bearing, steel grade S355" (+ as-built height 3.2 -> CONFLICT)
#   fire.ifcx        -> "90-minute fire rating"
#
# Federating them produces ONE column carrying everyone's opinions.
# This script builds the alpha ifcx CLI and walks the demo beats.
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
SRC="$ROOT/src"
OUT="$(mktemp -d)"

line() { printf '\n\033[1m######## %s ########\033[0m\n' "$1"; }

# Run the CLI, stream its (de-noised) output, and RETURN THE CLI'S OWN EXIT CODE.
# grep/sed are allowed to fail harmlessly; the CLI's status is preserved so real
# failures propagate (under `set -e`) instead of being masked by `|| true`.
compose() {
  local out rc=0
  out=$(node "$SRC/ifcx-cli.js" compose --no-fetch "$@" 2>&1) || rc=$?
  printf '%s\n' "$out" | grep -Ev "running ifcx|^[[:space:]]*at " | sed '/^[[:space:]]*$/d' || true
  return "$rc"
}

# Assert that a compose is REJECTED by validation (used for the bad-opinion beats).
# If the CLI unexpectedly succeeds, the closed-world claim has regressed -> fail loud.
expect_reject() {
  if compose "$@"; then
    echo "  ✗ UNEXPECTED: compose succeeded; closed-world validation has regressed" >&2
    exit 1
  fi
  echo "  ✓ rejected as expected"
}

# --- build the CLI (one-time) -------------------------------------------------
cd "$SRC"
[ -d node_modules ] || npm install
npx esbuild ifcx-cli/ifcx-cli.ts --bundle --outfile=ifcx-cli.js --external:three --platform=node >/dev/null

# --- BEAT 1: federation, cumulative ------------------------------------------
line "1a  architect only"
compose "$HERE/architect.ifcx" "$OUT/1.json";  cat "$OUT/1.json"

line "1b  + structural   (height 3.0 -> 3.2, +loadBearing, +S355)"
compose "$HERE/architect.ifcx" "$HERE/structural.ifcx" "$OUT/2.json";  cat "$OUT/2.json"

line "1c  + fire          (full federated column)"
compose "$HERE/architect.ifcx" "$HERE/structural.ifcx" "$HERE/fire.ifcx" "$OUT/3.json";  cat "$OUT/3.json"

# --- BEAT 2: conflict resolution is layer-ORDER (later wins) ------------------
line "2   reorder: structural THEN architect -> architect's 3.0 now wins"
compose "$HERE/structural.ifcx" "$HERE/architect.ifcx" "$OUT/swap.json"
grep -o '"demo::height": [0-9.]*' "$OUT/swap.json"

# --- BEAT 3: closed-world validation rejects bad opinions (asserted) ---------
line "3a  bad steelGrade S999  (enum is [S235,S275,S355,S460]) -> must be rejected"
cat > "$OUT/bad.ifcx" <<'JSON'
{ "header": { "id": "demo/bad@v1.ifcx", "ifcxVersion": "ifcx_alpha", "dataVersion": "1.0.0", "author": "@oops", "timestamp": "2026-06-02" },
  "imports": [], "schemas": {},
  "data": [ { "path": "2a3b1c00-0000-4000-8000-000000000c01", "attributes": { "demo::steelGrade": "S999" } } ] }
JSON
expect_reject "$HERE/architect.ifcx" "$HERE/structural.ifcx" "$OUT/bad.ifcx" "$OUT/bad.json"

line "3b  fireRatingMinutes = \"ninety\"  (schema wants Integer) -> must be rejected"
cat > "$OUT/bad2.ifcx" <<'JSON'
{ "header": { "id": "demo/bad2@v1.ifcx", "ifcxVersion": "ifcx_alpha", "dataVersion": "1.0.0", "author": "@oops", "timestamp": "2026-06-02" },
  "imports": [], "schemas": {},
  "data": [ { "path": "2a3b1c00-0000-4000-8000-000000000c01", "attributes": { "demo::fireRatingMinutes": "ninety" } } ] }
JSON
expect_reject "$HERE/architect.ifcx" "$HERE/fire.ifcx" "$OUT/bad2.ifcx" "$OUT/bad2.json"

# --- STAGE 2: geometry + colour-driven-by-layer (data-level check) -----------
line "S2  viewer layers: column colour flips grey -> red when fire layer is added"
compose "$HERE/viewer/architect.ifcx" "$HERE/viewer/structural.ifcx" "$OUT/grey.json"
compose "$HERE/viewer/architect.ifcx" "$HERE/viewer/structural.ifcx" "$HERE/viewer/fire.ifcx" "$OUT/red.json"
COL=2a3b1c00-0000-4000-8000-000000000c01
node -e "const f=p=>JSON.parse(require('fs').readFileSync(p)).children['$COL'].attributes;
const g=f('$OUT/grey.json'), r=f('$OUT/red.json');
console.log('  architect+structural -> diffuseColor', JSON.stringify(g['bsi::ifc::presentation::diffuseColor']),
            '| mesh pts', g['usd::usdgeom::mesh'].points.length);
console.log('  + fire               -> diffuseColor', JSON.stringify(r['bsi::ifc::presentation::diffuseColor']),
            '| fireRating', r['demo::fireRatingMinutes'], r['demo::fireRatingClass']);"
# headless stills (pure-Node software rasterizer; back-face cull verifies winding)
node "$HERE/viewer/render-still.mjs" "$OUT/grey.json" "$OUT/column-grey.png"
node "$HERE/viewer/render-still.mjs" "$OUT/red.json"  "$OUT/column-red.png"
echo "  -> render it live with:  (cd $SRC && npm run serve)  then load viewer/{architect,structural,fire}.ifcx in order"

# --- STAGE 3: geometry tiers (P/B/M) -- fidelity as a composable opinion ------
line "S3  geometry tiers: a later layer upgrades the box (B) to a steel I-section (M)"
node "$HERE/tiers/gen-tiers.mjs"
compose "$HERE/viewer/architect.ifcx" "$HERE/viewer/structural.ifcx" "$HERE/viewer/fire.ifcx" "$HERE/tiers/tier-M.ifcx" "$OUT/tierM.json"
DOUBLE=1 node "$HERE/viewer/render-still.mjs" "$OUT/tierM.json" "$OUT/column-isection.png"

printf '\n\033[1mDone.\033[0m Composed outputs are in %s\n' "$OUT"
