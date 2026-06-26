# Implementation Plan: Time-Locked Vault

## Overview

Implement a Soroban smart contract on Stellar testnet that manages time-locked asset vaults for XLM, USDC, and USDT. Tasks proceed from project scaffolding through data types, storage helpers, token layer, contract functions, event emission, error handling, and tests — each step wired into the previous before moving on.

## Tasks

- [x] 1. Scaffold the Soroban contract crate
  - Run `stellar contract init time-locked-vault` (or create manually) to produce a `Cargo.toml` + `src/lib.rs` skeleton
  - Add dependencies: `soroban-sdk` (with `testutils` feature for dev), `proptest` (dev-only)
  - Confirm `cargo build --target wasm32-unknown-unknown --release` compiles a valid WASM artifact
  - _Requirements: all (prerequisite)_

- [x] 2. Define data types and error enum
  - [x] 2.1 Implement `LockType`, `VaultState`, `Vault`, and event structs
    - Annotate all types with `#[contracttype]` and derive `Clone`, `Debug`, `PartialEq` where needed
    - Define `VaultCreatedEvent`, `WithdrawnEvent`, `EarlyWithdrawnEvent`, `TreasuryWithdrawnEvent`
    - _Requirements: 1.1, 1.7, 1.8, 1.9, 8.1–8.4_
  - [x] 2.2 Implement `DataKey` enum and `VaultError` contracterror
    - Cover all storage keys: `ProtocolOwner`, `VaultCounter`, `SupportedTokens`, `Vault(u64)`, `OwnerVaults(Address)`, `Treasury(Address)`
    - Cover all error variants with their numeric codes as specified in the design
    - _Requirements: 1.4–1.6, 2.3–2.4, 3.4–3.5, 4.1, 6.3–6.4_

- [x] 3. Implement storage helpers and internal utilities
  - [x] 3.1 Write storage read/write helpers
    - `get_vault_unchecked`, `save_vault` (with persistent TTL extension), `next_vault_id`
    - `is_supported_token`, `protocol_owner`
    - `add_to_treasury`, `get_treasury`, `set_treasury`
    - Use `LEDGER_BUMP_AMOUNT` constant (535 000 ledgers) for all persistent TTL extensions
    - _Requirements: 1.2, 1.3, 1.10, 6.5_
  - [x] 3.2 Implement `calculate_penalty` pure function
    - `penalty = amount * (penalty_rate as i128) / 10_000`; `payout = amount - penalty`
    - _Requirements: 3.1, 3.2, 3.6_
  - [x] 3.3 Implement `token_client` helper
    - Wraps `soroban_sdk::token::Client::new(env, token)`
    - _Requirements: 7.1, 7.2_

- [x] 4. Implement `initialize`
  - Store `protocol_owner`, `xlm_token`, `usdc_token`, `usdt_token` as `SupportedTokens` vec, and set `VaultCounter` to 0
  - Guard against double-init: return `AlreadyInitialized` if `ProtocolOwner` already set
  - _Requirements: (contract setup prerequisite); error table row for AlreadyInitialized_

- [x] 5. Implement `create_vault`
  - [x] 5.1 Write input validation and vault record creation
    - `require_auth` on caller; validate amount > 0, unlock_time > ledger timestamp, supported token, penalty_rate rules
    - Allocate vault_id via `next_vault_id`, build `Vault` struct with `start_time = env.ledger().timestamp()`, state `Active`
    - Transfer tokens in via `token_client(...).transfer(caller, contract, amount)`
    - Save vault and append vault_id to `OwnerVaults` index
    - Emit `vault_created` event
    - _Requirements: 1.1–1.10, 7.3, 8.1_
  - [ ]* 5.2 Write unit tests for `create_vault`
    - Happy path for each of the three tokens (XLM, USDC, USDT)
    - Each invalid input variant: amount=0, amount=-1, past unlock_time, unsupported token, PENALTY rate=0, PENALTY rate=10001
    - Verify returned vault_id and stored Vault fields match inputs; state == Active
    - Verify `get_vaults_by_owner` includes the new vault_id
    - _Requirements: 1.1–1.10_

- [x] 6. Implement `withdraw`
  - [x] 6.1 Write mature and early withdrawal logic
    - `require_auth` on caller; load vault (VaultNotFound if missing); check caller == owner (Unauthorized); check state != Withdrawn (AlreadyWithdrawn)
    - If `ledger_timestamp >= unlock_time`: transfer full amount to owner, set state Withdrawn, emit `withdrawn` event
    - If `ledger_timestamp < unlock_time` and `LockType::Penalty`: call `calculate_penalty`, transfer payout to owner, add penalty to treasury, set state Withdrawn, emit `early_withdrawn` event
    - If `ledger_timestamp < unlock_time` and `LockType::Strict`: return `EarlyExitNotAllowed`
    - _Requirements: 2.1–2.5, 3.1–3.7, 4.1–4.2, 7.2, 7.4, 8.2–8.3_
  - [ ]* 6.2 Write unit tests for `withdraw`
    - STRICT vault mature withdrawal returns full amount; state == Withdrawn
    - PENALTY vault mature withdrawal returns full amount; no penalty
    - PENALTY vault early withdrawal with known (amount, rate) pair — verify exact penalty and payout
    - STRICT vault early withdrawal returns `EarlyExitNotAllowed`; state unchanged
    - Non-owner withdrawal returns `Unauthorized`
    - Double withdrawal returns `AlreadyWithdrawn`
    - _Requirements: 2.1–2.5, 3.1–3.7, 4.1–4.2_

- [x] 7. Checkpoint — Ensure all tests pass
  - Run `cargo test` and confirm all unit tests pass; ask the user if questions arise.

- [x] 8. Implement `withdraw_treasury` and read-only queries
  - [x] 8.1 Implement `withdraw_treasury`
    - `require_auth` on caller; check caller == `protocol_owner` (Unauthorized); load treasury balance (TreasuryEmpty if zero)
    - Transfer full balance to protocol_owner via token_client; reset treasury to 0; emit `treasury_withdrawn` event
    - _Requirements: 6.1–6.4, 8.4_
  - [x] 8.2 Implement `get_vault`, `get_vaults_by_owner`, `get_treasury_balance`
    - `get_vault`: load from persistent storage, return `VaultNotFound` if missing
    - `get_vaults_by_owner`: load `OwnerVaults` index, return empty Vec if key absent
    - `get_treasury_balance`: load `Treasury(token)`, return 0 if absent
    - _Requirements: 5.1–5.4, 6.5_
  - [ ]* 8.3 Write unit tests for treasury and queries
    - `withdraw_treasury` by non-owner returns `Unauthorized`
    - `withdraw_treasury` on zero-balance token returns `TreasuryEmpty`
    - `withdraw_treasury` happy path: balance transferred, treasury reset to 0
    - `get_vault` on non-existent id returns `VaultNotFound`
    - `get_vaults_by_owner` on address with no vaults returns empty Vec
    - _Requirements: 5.1–5.4, 6.1–6.5_

- [x] 9. Verify event emission
  - [x] 9.1 Write unit tests for event fields
    - Use `env.events().all()` in testutils to assert each event's topic and data payload
    - Cover `vault_created`, `withdrawn`, `early_withdrawn`, `treasury_withdrawn`
    - Verify all fields match the structs defined in the design
    - _Requirements: 8.1–8.4_

- [ ] 10. Write property-based tests
  - [ ]* 10.1 Property 1 — Vault creation round-trip
    - // Feature: time-locked-vault, Property 1: Vault Creation Round-Trip
    - Generate arbitrary (token ∈ {xlm,usdc,usdt}, amount ∈ [1, i128::MAX/2], unlock_time ∈ [now+1, now+10^9], lock_type, penalty_rate ∈ [1,10000] for PENALTY)
    - Assert `get_vault` fields match inputs; state == Active
    - _Requirements: 1.1, 1.2, 1.7, 1.8, 1.9, 5.1_
  - [ ]* 10.2 Property 2 — Invalid inputs rejected
    - // Feature: time-locked-vault, Property 2: Invalid Inputs Rejected
    - Generate amount ∈ (-∞, 0], unlock_time ∈ (-∞, now], random non-supported address, rate ∈ {0} ∪ [10001, u32::MAX]
    - Assert appropriate error returned; `get_vault` returns `VaultNotFound`
    - _Requirements: 1.4, 1.5, 1.6, 1.7_
  - [ ]* 10.3 Property 3 — Owner index completeness
    - // Feature: time-locked-vault, Property 3: Owner Index Completeness
    - Generate N ∈ [1,20] vaults for the same owner
    - Assert `get_vaults_by_owner` contains every vault_id returned by `create_vault`
    - _Requirements: 1.10, 5.3_
  - [ ]* 10.4 Property 4 — Mature withdrawal returns full amount
    - // Feature: time-locked-vault, Property 4: Mature Withdrawal Returns Full Amount
    - Generate arbitrary vault; advance ledger past unlock_time
    - Assert owner balance delta == amount; state == Withdrawn
    - _Requirements: 2.1, 2.2, 7.1, 7.2_
  - [ ]* 10.5 Property 5 — Unauthorized withdrawal rejected
    - // Feature: time-locked-vault, Property 5: Unauthorized Withdrawal Rejected
    - Generate arbitrary vault and caller ≠ owner
    - Assert `Unauthorized` returned; vault state unchanged
    - _Requirements: 2.3, 3.4_
  - [ ]* 10.6 Property 6 — Double withdrawal rejected
    - // Feature: time-locked-vault, Property 6: Double Withdrawal Rejected
    - Generate arbitrary vault; withdraw once successfully; attempt second withdrawal
    - Assert second call returns `AlreadyWithdrawn`
    - _Requirements: 2.4, 3.5, 4.2_
  - [ ]* 10.7 Property 7 — Penalty arithmetic invariant
    - // Feature: time-locked-vault, Property 7: Penalty Arithmetic Invariant
    - Generate amount ∈ [1, 10^18], penalty_rate ∈ [1, 10000]
    - Assert penalty == floor(amount * rate / 10000); payout + penalty == amount
    - _Requirements: 3.1, 3.2, 3.6_
  - [ ]* 10.8 Property 8 — STRICT vault blocks early exit
    - // Feature: time-locked-vault, Property 8: STRICT Vault Blocks Early Exit
    - Generate arbitrary STRICT vault; call withdraw at ledger time < unlock_time
    - Assert `EarlyExitNotAllowed` returned; state == Active
    - _Requirements: 4.1_
  - [ ]* 10.9 Property 9 — Treasury accumulation and drain round-trip
    - // Feature: time-locked-vault, Property 9: Treasury Accumulation and Drain Round-Trip
    - Generate N ∈ [1,10] early withdrawals on PENALTY vaults for a given token
    - Assert sum(penalties) == `get_treasury_balance`; after `withdraw_treasury`, balance == 0 and protocol_owner received sum
    - _Requirements: 6.1, 6.2, 6.5_
  - [ ]* 10.10 Property 10 — Unauthorized treasury withdrawal rejected
    - // Feature: time-locked-vault, Property 10: Unauthorized Treasury Withdrawal Rejected
    - Generate arbitrary caller ≠ protocol_owner
    - Assert `Unauthorized` returned; treasury balance unchanged
    - _Requirements: 6.3_

- [x] 11. Final checkpoint — Ensure all tests pass
  - Run `cargo test` (and optionally `PROPTEST_CASES=1000 cargo test`) and confirm all tests pass; ask the user if questions arise.

- [x] 12. Integration and testnet verification
  - [x] 12.1 Write integration test helpers
    - Create a test module that deploys the contract to a local Soroban sandbox environment using `soroban-sdk` testutils
    - Implement helper functions for minting test tokens and funding test accounts
    - _Requirements: all_
  - [ ]* 12.2 Write end-to-end integration tests
    - Full flow: `initialize` → `create_vault` → advance ledger → `withdraw` for each token type
    - Early exit flow: PENALTY vault early withdrawal with real token balance assertions
    - Treasury drain: multiple early exits → `withdraw_treasury` → verify protocol_owner balance
    - Query coverage: `get_vault`, `get_vaults_by_owner`, `get_treasury_balance` return correct data
    - Event verification: confirm events appear in `env.events().all()` with correct fields
    - _Requirements: 1.1–1.10, 2.1–2.5, 3.1–3.7, 6.1–6.5, 8.1–8.4_

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references specific requirements for traceability
- Checkpoints at tasks 7 and 11 ensure incremental validation
- Property tests validate universal correctness properties (Properties 1–10 from design)
- Unit tests validate concrete examples and edge cases
- Persistent storage entries (`Vault`, `OwnerVaults`) must always extend TTL on write using `LEDGER_BUMP_AMOUNT`
- The `calculate_penalty` function can be tested independently of the contract environment (pure function)
