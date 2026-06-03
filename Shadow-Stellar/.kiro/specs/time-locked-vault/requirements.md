# Requirements Document

## Introduction

A time-locked asset vault protocol implemented as a Soroban smart contract on the Stellar network. The contract manages multiple vaults per user, accepting deposits of XLM, USDC, or USDT and locking them for a user-defined period. Withdrawals are governed by lock type: strict vaults block early exit entirely, while penalty vaults allow early exit with a configurable penalty deducted and forwarded to a protocol treasury. The contract targets Stellar testnet and is designed to back a working dApp frontend.

## Glossary

- **Vault_Manager**: The Soroban smart contract that creates vaults, stores vault data, and handles all withdrawals.
- **Vault**: A single locked-asset record owned by one user, identified by a unique vault_id.
- **Owner**: The Stellar wallet address (AccountId) that created and controls a specific vault.
- **Protocol_Owner**: The deployer/administrator address authorized to withdraw accumulated penalty fees from the treasury.
- **Token**: A supported asset — native XLM or a token contract address (USDC / USDT).
- **Lock_Type**: An enum value of either STRICT or PENALTY that governs early-exit rules for a vault.
- **Penalty_Rate**: A basis-point integer (0–10000) representing the percentage of the locked amount deducted on early withdrawal.
- **Treasury**: The internal ledger entry within the Vault_Manager that accumulates penalty amounts per token.
- **Vault_State**: An enum of ACTIVE or WITHDRAWN representing the lifecycle state of a vault.
- **unlock_time**: A Unix timestamp (u64, seconds) after which a mature withdrawal is permitted.
- **start_time**: The Unix timestamp at which the vault was created.
- **Ledger_Timestamp**: The current on-chain time as reported by the Soroban ledger environment.

---

## Requirements

### Requirement 1: Vault Creation

**User Story:** As a user, I want to deposit a supported asset and lock it for a defined period, so that I can commit funds to a savings goal with enforced time rules.

#### Acceptance Criteria

1. WHEN a user calls `create_vault` with a valid token, positive amount, future `unlock_time`, and a `lock_type`, THE Vault_Manager SHALL transfer the specified amount from the caller's address to the contract, create a Vault record, and return a unique `vault_id`.
2. THE Vault_Manager SHALL assign each new vault a `vault_id` that is unique across all vaults in the contract.
3. THE Vault_Manager SHALL record `start_time` as the Ledger_Timestamp at the moment of vault creation.
4. IF the provided `unlock_time` is less than or equal to the current Ledger_Timestamp, THEN THE Vault_Manager SHALL reject the call and return an error.
5. IF the provided `amount` is zero or negative, THEN THE Vault_Manager SHALL reject the call and return an error.
6. IF the provided `token` is not on the list of supported assets (XLM, USDC, USDT), THEN THE Vault_Manager SHALL reject the call and return an error.
7. WHERE `lock_type` is PENALTY, THE Vault_Manager SHALL require a `penalty_rate` between 1 and 10000 inclusive and store it with the vault.
8. WHERE `lock_type` is STRICT, THE Vault_Manager SHALL store a `penalty_rate` of 0 for the vault.
9. THE Vault_Manager SHALL set the initial Vault_State to ACTIVE upon creation.
10. THE Vault_Manager SHALL append the new `vault_id` to the owner's vault index so that all vaults for a given owner are retrievable.

---

### Requirement 2: Mature Withdrawal

**User Story:** As a user, I want to withdraw my full deposit after the lock period expires, so that I receive 100% of my locked funds back.

#### Acceptance Criteria

1. WHEN a user calls `withdraw` on a vault and the Ledger_Timestamp is greater than or equal to `unlock_time`, THE Vault_Manager SHALL transfer the full locked amount of the vault's token back to the Owner.
2. WHEN a mature withdrawal succeeds, THE Vault_Manager SHALL set the Vault_State to WITHDRAWN.
3. IF the caller's address does not match the vault's Owner, THEN THE Vault_Manager SHALL reject the withdrawal and return an authorization error.
4. IF the Vault_State is already WITHDRAWN, THEN THE Vault_Manager SHALL reject the call and return an error, preventing double withdrawal.
5. WHEN a mature withdrawal succeeds, THE Vault_Manager SHALL emit a `withdrawn` event containing `vault_id`, `owner`, `token`, and `amount`.

---

### Requirement 3: Early Withdrawal — Penalty Vault

**User Story:** As a user with a penalty vault, I want the option to exit early by accepting a penalty, so that I can access a portion of my funds before the lock period ends.

#### Acceptance Criteria

1. WHEN a user calls `withdraw` on a PENALTY vault and the Ledger_Timestamp is less than `unlock_time`, THE Vault_Manager SHALL calculate the penalty as `floor(amount * penalty_rate / 10000)`.
2. WHEN an early withdrawal is processed, THE Vault_Manager SHALL transfer `amount - penalty` to the Owner and add the `penalty` amount to the Treasury balance for that token.
3. WHEN an early withdrawal succeeds, THE Vault_Manager SHALL set the Vault_State to WITHDRAWN.
4. IF the caller's address does not match the vault's Owner, THEN THE Vault_Manager SHALL reject the early withdrawal and return an authorization error.
5. IF the Vault_State is already WITHDRAWN, THEN THE Vault_Manager SHALL reject the call and return an error.
6. THE Vault_Manager SHALL calculate the penalty using integer arithmetic such that `payout + penalty == amount` with no remainder lost.
7. WHEN an early withdrawal succeeds, THE Vault_Manager SHALL emit an `early_withdrawn` event containing `vault_id`, `owner`, `token`, `amount`, and `penalty`.

---

### Requirement 4: Early Withdrawal — Strict Vault

**User Story:** As a user with a strict vault, I want the contract to block any early withdrawal attempt, so that my commitment is enforced unconditionally.

#### Acceptance Criteria

1. WHEN a user calls `withdraw` on a STRICT vault and the Ledger_Timestamp is less than `unlock_time`, THE Vault_Manager SHALL reject the call and return an early-exit-not-allowed error.
2. IF the Vault_State is already WITHDRAWN, THEN THE Vault_Manager SHALL reject the call and return an error regardless of lock type.

---

### Requirement 5: Vault Query

**User Story:** As a user or frontend, I want to read vault details and list all vaults for an owner, so that I can display accurate vault state in the dApp UI.

#### Acceptance Criteria

1. WHEN `get_vault` is called with a valid `vault_id`, THE Vault_Manager SHALL return the full Vault record including `owner`, `token`, `amount`, `start_time`, `unlock_time`, `lock_type`, `penalty_rate`, and `Vault_State`.
2. IF `get_vault` is called with a `vault_id` that does not exist, THEN THE Vault_Manager SHALL return a not-found error.
3. WHEN `get_vaults_by_owner` is called with an owner address, THE Vault_Manager SHALL return the list of all `vault_id` values associated with that owner.
4. WHEN `get_vaults_by_owner` is called for an owner with no vaults, THE Vault_Manager SHALL return an empty list.

---

### Requirement 6: Treasury Management

**User Story:** As the Protocol_Owner, I want to withdraw accumulated penalty fees from the treasury, so that the protocol can collect revenue from early exits.

#### Acceptance Criteria

1. WHEN `withdraw_treasury` is called by the Protocol_Owner for a given token, THE Vault_Manager SHALL transfer the full accumulated treasury balance for that token to the Protocol_Owner's address.
2. WHEN `withdraw_treasury` succeeds, THE Vault_Manager SHALL reset the treasury balance for that token to zero.
3. IF `withdraw_treasury` is called by any address other than the Protocol_Owner, THEN THE Vault_Manager SHALL reject the call and return an authorization error.
4. IF `withdraw_treasury` is called for a token with a zero treasury balance, THEN THE Vault_Manager SHALL reject the call and return an error.
5. WHEN `get_treasury_balance` is called with a token address, THE Vault_Manager SHALL return the current accumulated penalty balance for that token.

---

### Requirement 7: Asset Integrity

**User Story:** As a user, I want the contract to guarantee that I always receive the same asset I deposited, so that I am not exposed to token substitution.

#### Acceptance Criteria

1. THE Vault_Manager SHALL store the token address at vault creation time and use only that stored address for all subsequent transfers related to that vault.
2. WHEN a withdrawal is processed, THE Vault_Manager SHALL transfer only the token recorded in the vault record, not any other asset.
3. IF a token transfer fails during vault creation, THEN THE Vault_Manager SHALL abort the vault creation and return an error without creating a vault record.
4. IF a token transfer fails during withdrawal, THEN THE Vault_Manager SHALL abort the withdrawal and leave the Vault_State unchanged.

---

### Requirement 8: Event Emission

**User Story:** As a dApp frontend, I want the contract to emit structured events for key actions, so that I can index and display vault activity without polling contract state.

#### Acceptance Criteria

1. WHEN a vault is successfully created, THE Vault_Manager SHALL emit a `vault_created` event containing `vault_id`, `owner`, `token`, `amount`, `unlock_time`, and `lock_type`.
2. WHEN a mature withdrawal succeeds, THE Vault_Manager SHALL emit a `withdrawn` event containing `vault_id`, `owner`, `token`, and `amount`.
3. WHEN an early withdrawal succeeds, THE Vault_Manager SHALL emit an `early_withdrawn` event containing `vault_id`, `owner`, `token`, `amount`, and `penalty`.
4. WHEN a treasury withdrawal succeeds, THE Vault_Manager SHALL emit a `treasury_withdrawn` event containing `token` and `amount`.
