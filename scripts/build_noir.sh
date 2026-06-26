#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
CIRCUITS_DIR="$ROOT_DIR/circuits"
BUILD_DIR="$ROOT_DIR/build"

echo "=== Noir Circuit Builder ==="
echo "Circuits dir: $CIRCUITS_DIR"
echo "Build dir:    $BUILD_DIR"

if ! command -v nargo &>/dev/null; then
    echo "Error: nargo not found"
    exit 1
fi
if ! command -v bb &>/dev/null; then
    echo "Error: bb not found"
    exit 1
fi

for circuit in "$CIRCUITS_DIR"/*/; do
    name="$(basename "$circuit")"
    echo ""
    echo ">>> Building circuit: $name"

    pushd "$circuit" > /dev/null

    # Compile
    nargo compile --silence-warnings 2>&1

    # Generate witness (requires Prover.toml)
    nargo execute 2>&1

    # Write verification key (bb v3+)
    mkdir -p "$BUILD_DIR/$name"
    bb write_vk --scheme ultra_honk \
        --bytecode_path "target/${name}.json" \
        -o "$BUILD_DIR/$name"

    # Generate proof
    bb prove --scheme ultra_honk --oracle_hash poseidon2 \
        --bytecode_path "target/${name}.json" \
        --witness_path "target/${name}.gz" \
        -k "$BUILD_DIR/$name/vk" \
        -o "$BUILD_DIR/$name/proof"

    # Verify proof
    bb verify --scheme ultra_honk --oracle_hash poseidon2 \
        -k "$BUILD_DIR/$name/vk" \
        -p "$BUILD_DIR/$name/proof/proof" \
        -i "$BUILD_DIR/$name/proof/public_inputs"

    popd > /dev/null

    echo ">>> $name: proof verified OK"
done

echo ""
echo "=== Done ==="
