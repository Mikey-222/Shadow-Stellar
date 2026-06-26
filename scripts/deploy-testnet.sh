#!/usr/bin/env bash
set -euo pipefail

# ─── Shadow-Stellar Testnet Deployment Script ──────────────────────────────────
#
# Usage:
#   ./scripts/deploy-testnet.sh [--with-ultrahonk <VERIFIER_ID>]
#
# Prerequisites:
#   - stellar CLI v25+ (https://github.com/stellar/stellar-cli)
#   - A funded testnet identity (created automatically if missing)
#   - wasm32-unknown-unknown target (rustup target add wasm32-unknown-unknown)
#
# Output:
#   - Writes contract IDs to scripts/.deployed-ids.env for frontend use
#   - Prints initialization commands
# ────────────────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

# ── Config ──────────────────────────────────────────────────────────────────────
NETWORK="${STELLAR_NETWORK:-testnet}"
IDENTITY="${STELLAR_IDENTITY:-shadow-stellar-admin}"
RUST_PROFILE="${RUST_PROFILE:-release}"
WASM_TARGET="wasm32v1-none"
OUT_DIR="target/$WASM_TARGET/$RUST_PROFILE"

# ── Color helpers ────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${CYAN}▸ $*${NC}"; }
ok()    { echo -e "${GREEN}✓ $*${NC}"; }
warn()  { echo -e "${YELLOW}⚠ $*${NC}"; }
err()   { echo -e "${RED}✗ $*${NC}"; exit 1; }

# Parse optional --with-ultrahonk flag
ULTRAHONK_VERIFIER=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-ultrahonk) ULTRAHONK_VERIFIER="$2"; shift 2 ;;
    *) err "Unknown argument: $1 (usage: --with-ultrahonk <VERIFIER_ID>)" ;;
  esac
done

# ── Step 0: Check prerequisites ─────────────────────────────────────────────────
info "Checking prerequisites..."

command -v stellar >/dev/null 2>&1 || err "stellar CLI not found. Install from https://github.com/stellar/stellar-cli"
rustup target list --installed 2>/dev/null | grep -q "$WASM_TARGET" || err "wasm32v1-none target not installed. Run: rustup target add wasm32v1-none"

# Ensure identity exists and is funded
if ! stellar keys ls 2>/dev/null | grep -q "$IDENTITY"; then
  info "Creating testnet identity '$IDENTITY'..."
  stellar keys generate "$IDENTITY" --network "$NETWORK"
fi

ADDR=$(stellar keys address "$IDENTITY")
info "Using identity: $IDENTITY ($ADDR)"

# Check/fund balance
BALANCE=$(stellar keys balance "$IDENTITY" --network "$NETWORK" 2>/dev/null || echo "0")
if [ "$BALANCE" = "0" ] || [ "$BALANCE" = "0.0000000" ]; then
  info "Funding identity with testnet XLM..."
  stellar keys fund "$IDENTITY" --network "$NETWORK" 2>/dev/null || warn "Friendbot may be rate-limited; check $ADDR at https://stellar.expert/explorer/testnet/account/$ADDR"
fi

# ── Step 1: Build WASM contracts ─────────────────────────────────────────────────
info "Building contracts (profile: $RUST_PROFILE)..."

cd "$REPO_DIR/collective-commitment-protocol"
cargo build --target "$WASM_TARGET" --"$RUST_PROFILE" 2>&1 | tail -1
CCP_WASM="$REPO_DIR/collective-commitment-protocol/$OUT_DIR/collective_commitment_protocol.wasm"
[ -f "$CCP_WASM" ] || err "CCP WASM not found at $CCP_WASM"
CCP_HASH=$(stellar contract install --wasm "$CCP_WASM" --source "$IDENTITY" --network "$NETWORK")
ok "CCP WASM installed (hash: ${CCP_HASH:0:16}…)"

cd "$REPO_DIR/zk-commitment-protocol"
cargo build --target "$WASM_TARGET" --"$RUST_PROFILE" 2>&1 | tail -1
ZCP_WASM="$REPO_DIR/zk-commitment-protocol/$OUT_DIR/zk_commitment_protocol.wasm"
[ -f "$ZCP_WASM" ] || err "ZCP WASM not found at $ZCP_WASM"
ZCP_HASH=$(stellar contract install --wasm "$ZCP_WASM" --source "$IDENTITY" --network "$NETWORK")
ok "ZCP WASM installed (hash: ${ZCP_HASH:0:16}…)"

# ── Step 2: Deploy contracts ─────────────────────────────────────────────────────
info "Deploying contracts..."

CCP_ID=$(stellar contract deploy --wasm-hash "$CCP_HASH" --source "$IDENTITY" --network "$NETWORK")
ok "CCP deployed at: $CCP_ID"

ZCP_ID=$(stellar contract deploy --wasm-hash "$ZCP_HASH" --source "$IDENTITY" --network "$NETWORK")
ok "ZCP deployed at: $ZCP_ID"

# ── Step 3: Gather token addresses ────────────────────────────────────────────────
info "Resolving testnet token contract IDs..."

# Stellar testnet classic asset wrapped contract IDs (Soroban-native SAC)
XLM_ID=$(stellar contracts asset id --asset "native" --network "$NETWORK" 2>/dev/null || \
         warn "Could not auto-resolve XLM contract ID (not critical — derive off-chain)")
USDC_ID="${USDC_ID:-$(stellar contracts asset id --asset "USDC:G...LABEL" --network "$NETWORK" 2>/dev/null || echo "")}"
EURC_ID="${EURC_ID:-$(stellar contracts asset id --asset "EURC:G...LABEL" --network "$NETWORK" 2>/dev/null || echo "")}"

if [ -z "$XLM_ID" ]; then
  warn "Auto-resolution failed. You'll need to provide token contract IDs manually."
  echo ""
  echo "  To get XLM contract ID:"
  echo "    stellar contracts asset id --asset native --network $NETWORK"
  echo ""
  echo "  To get USDC/EURC (first mint/bridge them, then):"
  echo "    stellar contracts asset id --asset \"USDC:<ISSUER>\" --network $NETWORK"
  echo ""
fi

# ── Step 4: Print deployment summary ──────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                 Deployment Complete                        ║"
echo "╠══════════════════════════════════════════════════════════════╣"
printf "║  CCP:  %-56s ║\n" "$CCP_ID"
printf "║  ZCP:  %-56s ║\n" "$ZCP_ID"
printf "║  Admin: %-55s ║\n" "$ADDR"
echo "╚══════════════════════════════════════════════════════════════╝"

# Save contract IDs for frontend
cat > "$SCRIPT_DIR/.deployed-ids.env" <<EOF
# Shadow-Stellar deployed contract IDs (testnet)
# Generated by deploy-testnet.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ)
VITE_CCP_CONTRACT_ID=$CCP_ID
VITE_ZCP_CONTRACT_ID=$ZCP_ID
VITE_NETWORK=testnet
EOF

echo ""
info "Contract IDs saved to scripts/.deployed-ids.env"
echo ""

# ── Step 5: Print initialization commands ─────────────────────────────────────────
echo "───────────────────────────────────────────────────────────────────────────"
echo "  Next: Initialize contracts"
echo "───────────────────────────────────────────────────────────────────────────"
echo ""
echo "  # CCP initialization (requires XLM/USDC/EURC contract IDs):"
echo "  stellar contract invoke \\"
echo "    --id $CCP_ID --source $IDENTITY --network $NETWORK -- \\"
echo "    initialize \\"
echo "    --xlm_token \$XLM_ID \\"
echo "    --usdc_token \$USDC_ID \\"
echo "    --eurc_token \$EURC_ID ${ULTRAHONK_VERIFIER:+\\\\}"
if [ -n "$ULTRAHONK_VERIFIER" ]; then
echo "    --verifier $ULTRAHONK_VERIFIER"
else
echo "    # (omit --verifier or pass null if not using UltraHonk)"
fi
echo ""
echo "  # ZCP initialization:"
echo "  stellar contract invoke \\"
echo "    --id $ZCP_ID --source $IDENTITY --network $NETWORK -- \\"
echo "    initialize \\"
echo "    --owner $ADDR \\"
echo "    --xlm_token \$XLM_ID \\"
echo "    --usdc_token \$USDC_ID \\"
echo "    --eurc_token \$EURC_ID ${ULTRAHONK_VERIFIER:+\\\\}"
if [ -n "$ULTRAHONK_VERIFIER" ]; then
echo "    --verifier $ULTRAHONK_VERIFIER"
fi
echo ""
echo "───────────────────────────────────────────────────────────────────────────"
echo "  Frontend: Copy scripts/.deployed-ids.env to Shadow-Stellar-app/"
echo "             or set VITE_CCP_CONTRACT_ID and VITE_ZCP_CONTRACT_ID"
echo "             in the app's .env file."
echo "───────────────────────────────────────────────────────────────────────────"
