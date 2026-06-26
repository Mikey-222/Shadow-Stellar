# Shadow-Stellar

Zero-knowledge vault protocol on Stellar (Soroban). Three contracts, one frontend.

- **Time-Locked Vault (TLV)** — Solo vaults: lock XLM/USDC/EURC for a fixed duration
- **Collective Commitment Protocol + ZK (CCP)** — Group escrow for 5–100 members, with optional ZK privacy layer
- **ZK Commitment Protocol (ZCP)** — Standalone private vaults: amount hidden behind a BN254 Pedersen commitment

All contracts deployed on testnet. Embedded UltraHONK verifier (Barretenberg) for zk-SNARK verification. No cross-contract verifier calls.

---

## Architecture

### Time-Locked Vault

```
User ──create_vault/withdraw──▶ Vault Manager ──token transfer──▶ Token (XLM/USDC/EURC)
Protocol Owner ──withdraw_treasury──▶ Vault Manager
Frontend ──get_vault/get_vaults_by_owner/get_treasury_balance──▶ Vault Manager

Storage: Vault Records | Owner Index | Treasury | Counter | Protocol Owner | Supported Tokens
```

All time checks use `env.ledger().timestamp()`. No external oracle.

### Collective Commitment Protocol

```
Creator ──create_group_vault──▶ CCP Contract
Member ──deposit/withdraw/claim_pool──▶ CCP Contract
Anyone ──cancel──▶ CCP Contract
Frontend ──queries──▶ CCP Contract

CCP ──token transfer──▶ Token Contract

Storage: Counter | SupportedTokens | GroupVault | MemberRecord | CommunityPool | CreatorVaults | MemberVaults
```

ZK privacy mode uses the same storage but with Pedersen commitments instead of plaintext amounts/addresses.

### ZK Commitment Protocol

```
User ──zk_deposit──▶ ZCP Contract ──verify commitment + nullifier──▶ Embedded UltraHONK Verifier
User ──zk_withdraw──▶ ZCP Contract ──verify blinding──▶
User ──zk_deposit_ultrahonk──▶ ZCP Contract ──full SNARK verification──▶ Embedded UltraHONK Verifier

Storage: Entry Registry | Nullifier Registry | Depositor Index | Verifier Address
```

---

## How It Works

### Time-Locked Vault (Solo)

1. User picks an asset (XLM/USDC/EURC), amount, unlock time, and lock type
2. **Strict lock** — no early withdrawal; funds released only after unlock time
3. **Penalty lock** — early exit allowed, but a basis-point penalty (`floor(amount × rate / 10_000)`) goes to the protocol treasury
4. Funds are transferred to the contract at creation; withdraw returns them to the owner

**Creator earns:** Nothing (solo vault — no commission model)

**States:** `Active` → `Withdrawn`

### Group Vault (CCP)

1. **Creator** deploys a vault with 5–100 member addresses, obligation amounts, lock duration, funding deadline, lock type, and penalty rate
2. **Funding phase** (`FundingOpen`) — each member deposits their obligation before the deadline
3. **Active phase** (`ActiveLocked`) — all funds locked until `unlock_time`
   - **Strict lock:** no early exit
   - **Penalty lock:** early exit allowed — member forfeits penalty % to community pool
4. **Settlement** (`SettlementReady`) — members withdraw principal, claim equal pool share
5. **Resolved** — all members claimed
6. **Cancelled** — funding deadline missed; anyone calls `cancel`, depositors refunded

**ZK Privacy mode:**
- Member amounts and addresses are hidden via Pedersen commitments
- Each member gets a secret from the creator; deposit uses a ZK proof
- Withdrawal reveals the blinding factor for on-chain verification
- Same lifecycle, but `create_group_vault_zk`, `deposit_zk`, `withdraw_zk`, `claim_pool_zk`

**Creator earns:** 5% of each deposit immediately at deposit time (no claiming needed)

```
create_group_vault → all members: Committed
deposit (×N)      → each member: Deposited
last deposit      → all: Active · vault: ActiveLocked
unlock_time       → vault: SettlementReady
withdraw          → member: Withdrawn
claim_pool        → member: Claimed
all claimed       → vault: Resolved

funding deadline missed:
  cancel() → vault: Cancelled → withdraw() refunds depositors
```

### ZK Vault (ZCP)

1. A 32-byte blinding factor is derived deterministically from your wallet address (SHA-256)
2. `commitment = amount·G + blinding·H` — BN254 Pedersen, computed in-browser via `@noble/curves`
3. `nullifier = SHA-256(DOMAIN_NULLIFIER || entry_id || commitment)` — anti-replay
4. `range_tag = SHA-256(DOMAIN_RANGE || commitment || amount || 1 || max)` — range proof
5. Proof submitted to `zk_deposit` — only the commitment x-coordinate is stored on-chain
6. To withdraw: the blinding factor is recomputed from your address; contract verifies `commitment' == amount·G + blinding·H`

**Two proof modes:**

| Mode | How it works | Tools needed |
|------|-------------|--------------|
| SHA-256 (auto) | Blinding derived from wallet address, commitment computed in-browser | None |
| UltraHONK SNARK | Run Noir circuit with private inputs → paste output hex | `nargo` + `bb` |

> **For most users:** Use SHA-256 (auto). UltraHonk is for custom Noir circuits.

---

## Contracts (Testnet)

| Contract | Address | Status |
|----------|---------|--------|
| Time-Locked Vault v2 | `CABGIDBEGTWZQLGVSZRLGR44PN3Q32QKV5PVD6BZLH4KGBLJDL7ZEZ3H` | ✅ Live |
| CCP + ZK v3 | `CDJRALESLSOS7UUYXSQTPUUJQVGYZQ4PJIWFRYNSS4RO5QLWHITYK5IQ` | ✅ Live |
| ZK Commitment Protocol v3 | `CBIJMJ6SDKD2CPTFBKE4APC7ATFNGOX7XMOFCI47YFSRQNDFLBBDPLLI` | ✅ Live |

**Network:** Stellar Testnet · RPC: `https://soroban-testnet.stellar.org`

### Supported Assets

| Asset | SAC Address |
|-------|-------------|
| XLM | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |
| USDC | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |
| EURC | `CCUUDM434BMZMYWYDITHFXHDMIVTGGD6T2I5UKNX5BSLXLW7HVR4MCGZ` |

**Protocol Owner:** `GBAWEM6LAMZQIW6JRQPLEIZBZTQHRCUYGTZNCYIWD2BXOF4DE4QYA7OM`

### Functions

**TLV:** `initialize` · `create_vault` · `withdraw` · `withdraw_treasury` · `get_vault` · `get_vaults_by_owner` · `get_treasury_balance`

**CCP Standard:** `initialize` · `create_group_vault` · `deposit` · `withdraw` · `cancel` · `claim_pool` · `get_group_vault` · `get_member_state` · `get_vaults_by_member` · `get_vaults_by_creator` · `get_pool_balance` · `get_member_claim_amount`

**CCP ZK:** `create_group_vault_zk` · `deposit_zk` · `withdraw_zk` · `claim_pool_zk` · `deposit_zk_ultrahonk` · `is_nullifier_spent` · `get_zk_vault` · `get_zk_member_record_fn` · `get_vault_privacy_mode`

**ZCP:** `initialize` · `zk_deposit` · `zk_withdraw` · `zk_deposit_ultrahonk` · `zk_withdraw_ultrahonk` · `verify_range_proof` · `is_nullifier_spent_fn` · `get_entry_fn` · `get_entries_by_depositor` · `get_commitment` · `get_next_entry_id`

---

## Frontend

React 19 + Vite + TanStack Router. Supports Freighter, xBull, Albedo, Rabet, Lobstr, Hana wallets.

### Routes

| Path | Description |
|------|-------------|
| `/` | Dashboard |
| `/create` | Solo vault creation |
| `/vaults` | Solo vault list |
| `/vaults/:id` | Solo vault detail |
| `/group` | Group vault list |
| `/group/create` | Group vault creation |
| `/group/:id` | Group vault detail |
| `/zk` | ZK vault list |
| `/zk/create` | ZK vault creation |
| `/zk/:entryId` | ZK vault detail |
| `/history` | Transaction history |

### ZK Privacy Flow

**SHA-256 (auto) — default:**
1. Blinding factor derived deterministically from wallet address
2. BN254 Pedersen commitment computed in-browser
3. Nullifier + range tag via SHA-256
4. Only commitment x-coordinate stored on-chain
5. Withdrawal recomputes commitment from (amount, blinding)

**UltraHONK SNARK — advanced:**

Generate a proof off-chain, then paste the output hex into the UI.

```bash
# 1. Prerequisites
curl -L https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash
noirup -v 1.0.0-beta.2
# Install bb v0.87.0 (matching the embedded verifier)
curl -L https://raw.githubusercontent.com/AztecProtocol/aztec-packages/refs/tags/aztec-packages-v0.87.0/barretenberg/bbup/install | bash
bbup -v 0.87.0
```

```bash
# 2. Navigate to the circuit
cd circuits/private_vault
```

```bash
# 3. Edit Prover.toml with your values
#    commitment = pedersen([blinding, recipient, amount]) — hex
#    nullifier  = pedersen([blinding, entry_id]) — hex
#    blinding   = your 32-byte blinding factor — hex
#    recipient  = hex-encoded wallet address (first 8 bytes)
#    amount     = deposit amount in stroops (e.g. 500000000 = 50 XLM)
#    entry_id   = next entry ID from get_next_entry_id()
```

```bash
# 4. Compile, execute, prove
nargo compile --silence-warnings
nargo execute
mkdir -p ../../build/private_vault
bb write_vk --scheme ultra_honk \
  --bytecode_path target/private_vault.json \
  -o ../../build/private_vault
bb prove --scheme ultra_honk --oracle_hash poseidon2 \
  --bytecode_path target/private_vault.json \
  --witness_path target/private_vault.gz \
  -k ../../build/private_vault/vk \
  -o ../../build/private_vault/proof
bb verify --scheme ultra_honk --oracle_hash poseidon2 \
  -k ../../build/private_vault/vk \
  -p ../../build/private_vault/proof/proof \
  -i ../../build/private_vault/proof/public_inputs
```

```bash
# 5. Extract hex values to paste into the UI
#    Proof bytes (raw binary → hex):
xxd -p ../../build/private_vault/proof/proof | tr -d '\n'; echo
#    Public inputs (raw binary → hex):
xxd -p ../../build/private_vault/proof/public_inputs | tr -d '\n'; echo
#    Commitment (from Prover.toml or compute via stellar-bn254):
#    Copy the commitment hex from Prover.toml directly
```

```bash
# 6. Paste into the UI fields:
#    - Commitment: 64-char hex (from Prover.toml or stellar-bn254)
#    - Proof bytes: the raw proof hex (29184 chars for bb 0.87.0)
#    - Public inputs: the public inputs hex
```

Or use the build script (automates steps 4–5):
```bash
bash scripts/build_noir.sh
# Output: build/private_vault/proof/{proof, public_inputs, vk}
```

> **Proof format note:** The embedded verifier expects 14,592-byte proofs from `bb 0.87.0`. Newer `bb` versions produce 7,488-byte proofs and are incompatible. See [Known Issue](#known-issue) below.

---

## UltraHONK Integration

Embedded verifier (`ultrahonk-soroban-verifier` vendored crate) in both CCP and ZCP — no separate verifier contract.

### Verification Pipeline

```
1. Load VK from storage
2. Fiat-Shamir transcript (9 rounds)
3. Sumcheck (28 rounds)
4. Shplemini batch-opening (65-commitment MSM)
5. BN254 pairing check
```

### Known Issue

| Artifact | bb 0.87.0 (expected) | bb 3.0.0-nightly (current) |
|----------|----------------------|-----------------------------|
| Proof size | 14,592 B | 7,488 B |
| VK size | 1,760 B | 1,888 B |
| ACIR input format | Legacy | Current |

Toolchain version gap — verifier is ready; proof generation needs matching `bb` + `nargo`.

---

## Project Structure

```
├── time-locked-vault/               # Solo vault contract (Rust/Soroban)
├── collective-commitment-protocol/  # CCP + ZK group vault (Rust/Soroban)
│   └── src/zk/                      # ZK module (pedersen, proof, verifier)
├── zk-commitment-protocol/          # Standalone ZK vault (Rust/Soroban)
├── crates/
│   └── ultrahonk-soroban-verifier/  # Vendored UltraHONK verifier
├── circuits/
│   └── private_vault/               # Noir circuit for ZK proof
├── scripts/
│   ├── deploy-testnet.sh            # Deploy CCP + ZCP
│   └── build_noir.sh                # Compile Noir circuits
└── Shadow-Stellar-app/              # React 19 frontend
    └── src/
        ├── lib/                     # Soroban clients + crypto helpers
        ├── store/                   # Zustand state (wallet, vaults)
        └── routes/                  # TanStack Router pages
```

---

## Building

```bash
rustup target add wasm32v1-none

# Build contracts
cargo build --manifest-path time-locked-vault/Cargo.toml --target wasm32v1-none --release
cargo build --manifest-path collective-commitment-protocol/Cargo.toml --target wasm32v1-none --release
cargo build --manifest-path zk-commitment-protocol/Cargo.toml --target wasm32v1-none --release

# Run tests
cargo test --manifest-path time-locked-vault/Cargo.toml     # 23 tests
cargo test --manifest-path collective-commitment-protocol/Cargo.toml  # 50 tests
cargo test --manifest-path zk-commitment-protocol/Cargo.toml         # 23 tests

# Frontend
cd Shadow-Stellar-app && npm install && npm run dev
```

## Deploying

```bash
# Quick deploy (CCP + ZCP)
bash scripts/deploy-testnet.sh

# Initialize contracts
stellar contract invoke --id CDJRALESLSOS7UUYXSQTPUUJQVGYZQ4PJIWFRYNSS4RO5QLWHITYK5IQ \
  --source deployer --network testnet -- initialize \
  --xlm_token CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC \
  --usdc_token CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA \
  --eurc_token CCUUDM434BMZMYWYDITHFXHDMIVTGGD6T2I5UKNX5BSLXLW7HVR4MCGZ

stellar contract invoke --id CBIJMJ6SDKD2CPTFBKE4APC7ATFNGOX7XMOFCI47YFSRQNDFLBBDPLLI \
  --source deployer --network testnet -- initialize \
  --owner GBAWEM6LAMZQIW6JRQPLEIZBZTQHRCUYGTZNCYIWD2BXOF4DE4QYA7OM \
  --xlm_token CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC \
  --usdc_token CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA \
  --eurc_token CCUUDM434BMZMYWYDITHFXHDMIVTGGD6T2I5UKNX5BSLXLW7HVR4MCGZ

# Frontend
cp scripts/.deployed-ids.env Shadow-Stellar-app/.env
cd Shadow-Stellar-app && npm install && npm run dev
```

---

## Events

| Contract | Topic | Trigger |
|----------|-------|---------|
| TLV | `vault_crt` | Vault created |
| TLV | `withdrawn` | Mature withdrawal |
| TLV | `early_wdr` | Early withdrawal |
| TLV | `treas_wdr` | Treasury drained |
| CCP | `grp_crt` | Group vault created |
| CCP | `mem_dep` | Member deposited |
| CCP | `vlt_act` | Vault activated |
| CCP | `vlt_can` | Vault cancelled |
| CCP | `mem_exit` | Early exit |
| CCP | `mem_wdr` | Withdrawn |
| CCP | `pool_clm` | Pool claimed |
| CCP | `vlt_res` | Vault resolved |
| CCP | `zk_crt/zk_dep/zk_wdr/zk_exit/zk_clm` | ZK events |
| ZCP | `zk_dep` | ZK deposit |
| ZCP | `zk_wdr` | ZK withdrawal |

Events viewable on [Stellar Expert](https://stellar.expert/explorer/testnet/).

---

## License

MIT
