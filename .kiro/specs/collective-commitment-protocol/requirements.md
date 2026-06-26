# Requirements Document

## Introduction

The Collective Commitment Protocol (CCP) is a standalone Soroban smart contract deployed on Stellar testnet. It implements a permissioned multi-user escrow system where a group of members collectively lock funds into a shared vault. The protocol enforces participation through a funding deadline, handles funding failures with full refunds, penalizes early exits by redistributing penalties to committed members, and resolves all funds deterministically with no value created or destroyed.

The CCP is architecturally independent of the existing time-locked-vault contract. It introduces three cooperating layers: a Vault Registry for group creation and membership management, a Vault Execution Engine for deposit/withdrawal/cancellation logic, and a Community Settlement Pool for penalty accumulation and distribution.

## Glossary

- **CCP**: The Collective Commitment Protocol smart contract.
- **Group_Vault**: A shared escrow vault with a fixed membership list, per-member obligation amounts, a single token, an unlock time, a lock type, a penalty rate, and a funding deadline.
- **Vault_Registry**: The administrative layer of the CCP responsible for creating group vaults and enforcing membership rules.
- **Vault_Execution_Engine**: The core logic layer responsible for deposit, withdrawal, cancellation, and pool claim operations.
- **Community_Settlement_Pool**: The per-vault accumulator that collects early-exit penalties and distributes them equally to members who remain active to maturity.
- **Creator**: The address that calls `create_group_vault`. The creator does not need to be a member of the vault.
- **Member**: An address explicitly listed in the vault's membership list at creation time. Membership is immutable after creation.
- **Obligation_Amount**: The fixed token amount a specific member must deposit into a vault. Each member may have a different obligation amount.
- **Funding_Deadline**: A Unix timestamp after which, if the vault is not fully funded, any caller may trigger cancellation and full refunds.
- **Lock_Type**: Either `Strict` (early exit blocked) or `Penalty` (early exit allowed with a configurable penalty).
- **Penalty_Rate**: A value in basis points (1–10000) specifying the fraction of a member's deposit deducted as a penalty on early exit. Only applicable to `Penalty` vaults.
- **Vault_State**: The lifecycle state of a group vault. One of: `Created`, `Funding_Open`, `Funding_Complete`, `Active_Locked`, `Settlement_Ready`, `Resolved`, or `Cancelled`.
- **Member_State**: The lifecycle state of a member within a vault. One of: `Not_Joined`, `Committed`, `Deposited`, `Active`, `Exited`, `Withdrawn`, or `Claimed`.
- **Active_Member**: A member whose Member_State is `Active` — they deposited and did not exit early before vault maturity.
- **vault_id**: A monotonically incrementing `u64` identifier uniquely assigned to each group vault at creation.
- **Supported_Token**: One of the three tokens accepted by the CCP: native XLM, USDC, or EURC. All members of a vault use the same token.
- **Total_Vault_Size**: The sum of all members' obligation amounts for a given vault.
- **Pool_Balance**: The accumulated penalty funds held by the Community Settlement Pool for a specific vault.

---

## Requirements

### Requirement 1: Group Vault Creation

**User Story:** As a creator, I want to create a group vault with a defined membership list and per-member obligations, so that a group of participants can collectively commit funds under shared rules.

#### Acceptance Criteria

1. WHEN `create_group_vault` is called with a valid creator, member list, amounts list, supported token, future unlock_time, future funding_deadline, valid lock_type, and valid penalty_rate, THE Vault_Registry SHALL create a new Group_Vault, assign it a unique vault_id, and return that vault_id.
2. THE Vault_Registry SHALL enforce that the member list contains between 5 and 100 addresses (inclusive).
3. IF `create_group_vault` is called with fewer than 5 or more than 100 members, THEN THE Vault_Registry SHALL return an error and no vault SHALL be created.
4. THE Vault_Registry SHALL enforce that the amounts list length equals the member list length, with each index position mapping one obligation amount to one member.
5. IF `create_group_vault` is called with an amounts list whose length does not equal the member list length, THEN THE Vault_Registry SHALL return an error and no vault SHALL be created.
6. IF `create_group_vault` is called with any obligation amount less than or equal to zero, THEN THE Vault_Registry SHALL return an error and no vault SHALL be created.
7. IF `create_group_vault` is called with a token not in the supported token set (XLM, USDC, EURC), THEN THE Vault_Registry SHALL return an error and no vault SHALL be created.
8. IF `create_group_vault` is called with an unlock_time less than or equal to the current ledger timestamp, THEN THE Vault_Registry SHALL return an error and no vault SHALL be created.
9. IF `create_group_vault` is called with a funding_deadline less than or equal to the current ledger timestamp, THEN THE Vault_Registry SHALL return an error and no vault SHALL be created.
10. IF `create_group_vault` is called with a funding_deadline greater than or equal to unlock_time, THEN THE Vault_Registry SHALL return an error and no vault SHALL be created.
11. IF `create_group_vault` is called with lock_type `Penalty` and a penalty_rate of zero or greater than 10000, THEN THE Vault_Registry SHALL return an error and no vault SHALL be created.
12. WHEN a Group_Vault is successfully created, THE Vault_Registry SHALL set the vault's initial Vault_State to `Funding_Open`.
13. WHEN a Group_Vault is successfully created, THE Vault_Registry SHALL record the membership list as immutable for the lifetime of the vault.
14. WHEN a Group_Vault is successfully created, THE Vault_Registry SHALL emit a `group_vault_created` event containing vault_id, creator, token, member_count, total_vault_size, unlock_time, and lock_type.
15. THE Vault_Registry SHALL index each created vault_id under the creator's address so that `get_vaults_by_creator` returns it.
16. THE Vault_Registry SHALL index each created vault_id under every member's address so that `get_vaults_by_member` returns it for each member.
17. WHEN a Group_Vault is successfully created, THE Vault_Registry SHALL set each member's initial Member_State to `Committed`.

### Requirement 2: Member Deposit

**User Story:** As a member, I want to deposit my exact obligation amount into the vault, so that I fulfill my commitment and the vault can reach full funding.

#### Acceptance Criteria

1. WHEN `deposit` is called by a caller who is on the vault's member list, whose Member_State is `Committed`, and whose Vault_State is `Funding_Open`, THE Vault_Execution_Engine SHALL transfer exactly the caller's obligation amount from the caller to the contract and update the caller's Member_State to `Deposited`.
2. IF `deposit` is called by a caller who is not on the vault's member list, THEN THE Vault_Execution_Engine SHALL return an error and no transfer SHALL occur.
3. IF `deposit` is called by a member whose Member_State is not `Committed` (i.e., the member has already deposited or exited), THEN THE Vault_Execution_Engine SHALL return an error and no transfer SHALL occur.
4. IF `deposit` is called when the vault's Vault_State is not `Funding_Open`, THEN THE Vault_Execution_Engine SHALL return an error and no transfer SHALL occur.
5. IF `deposit` is called after the vault's funding_deadline has passed, THEN THE Vault_Execution_Engine SHALL return an error and no transfer SHALL occur.
6. WHEN the final member's deposit causes all members to have Member_State `Deposited`, THE Vault_Execution_Engine SHALL transition the Vault_State from `Funding_Open` to `Active_Locked` and emit a `vault_activated` event containing the vault_id.
7. WHEN `deposit` is called successfully, THE Vault_Execution_Engine SHALL emit a `member_deposited` event containing vault_id, member address, and amount.

### Requirement 3: Funding Failure and Cancellation

**User Story:** As a depositor, I want to recover my funds if the vault fails to reach full funding before the deadline, so that I am not locked out of my money due to other members not participating.

#### Acceptance Criteria

1. WHEN `cancel` is called on a vault whose Vault_State is `Funding_Open` and whose funding_deadline has passed, THE Vault_Execution_Engine SHALL transition the Vault_State to `Cancelled`.
2. THE Vault_Execution_Engine SHALL allow any caller (not just members) to invoke `cancel` on an eligible vault.
3. IF `cancel` is called on a vault whose Vault_State is not `Funding_Open`, THEN THE Vault_Execution_Engine SHALL return an error.
4. IF `cancel` is called on a vault whose funding_deadline has not yet passed, THEN THE Vault_Execution_Engine SHALL return an error.
5. WHEN a vault transitions to `Cancelled`, THE Vault_Execution_Engine SHALL make each depositor's full deposited amount available for individual refund withdrawal.
6. WHEN `withdraw` is called by a member whose Member_State is `Deposited` on a `Cancelled` vault, THE Vault_Execution_Engine SHALL transfer the member's full deposited obligation amount back to the member and update the member's Member_State to `Withdrawn`.
7. IF `withdraw` is called by a member whose Member_State is not `Deposited` on a `Cancelled` vault, THEN THE Vault_Execution_Engine SHALL return an error.
8. THE Vault_Execution_Engine SHALL guarantee that no funds remain locked in a vault with Vault_State `Cancelled` once all depositors have called `withdraw`.
9. WHEN a vault is cancelled, THE Vault_Execution_Engine SHALL emit a `vault_cancelled` event containing the vault_id.

### Requirement 4: Mature Withdrawal

**User Story:** As an active member, I want to withdraw my full deposit after the vault reaches maturity, so that I receive back my committed funds.

#### Acceptance Criteria

1. WHEN `withdraw` is called by a member whose Member_State is `Active` on a vault whose Vault_State is `Settlement_Ready`, THE Vault_Execution_Engine SHALL transfer the member's full obligation amount back to the member and update the member's Member_State to `Withdrawn`.
2. IF `withdraw` is called by a member whose Member_State is not `Active` on a `Settlement_Ready` vault, THEN THE Vault_Execution_Engine SHALL return an error.
3. IF `withdraw` is called on a vault whose Vault_State is `Active_Locked` (i.e., unlock_time has not yet passed), THEN THE Vault_Execution_Engine SHALL return an error for `Strict` vaults.
4. WHEN `withdraw` is called successfully on a `Settlement_Ready` vault, THE Vault_Execution_Engine SHALL emit a `member_withdrawn` event containing vault_id, member address, and amount.
5. WHEN the vault's unlock_time is reached and the Vault_State is `Active_Locked`, THE Vault_Execution_Engine SHALL transition the Vault_State to `Settlement_Ready`.

### Requirement 5: Early Exit

**User Story:** As a member of a Penalty vault, I want the option to exit early and recover most of my deposit, so that I am not permanently locked in if my circumstances change.

#### Acceptance Criteria

1. WHEN `withdraw` is called by a member whose Member_State is `Active` on a vault whose Vault_State is `Active_Locked` and whose lock_type is `Penalty`, THE Vault_Execution_Engine SHALL calculate a penalty equal to `floor(obligation_amount * penalty_rate / 10000)`, transfer `obligation_amount - penalty` back to the member, add the penalty to the vault's Community_Settlement_Pool, and update the member's Member_State to `Exited`.
2. THE Vault_Execution_Engine SHALL guarantee that `payout + penalty == obligation_amount` exactly for every early exit, with no value created or destroyed.
3. IF `withdraw` is called by a member whose Member_State is `Active` on a vault whose Vault_State is `Active_Locked` and whose lock_type is `Strict`, THEN THE Vault_Execution_Engine SHALL return an error and no transfer SHALL occur.
4. WHEN a member's Member_State transitions to `Exited`, THE Vault_Execution_Engine SHALL treat that transition as irreversible; no subsequent deposit or re-entry SHALL be permitted for that member in that vault.
5. WHEN an early exit occurs, THE Vault_Execution_Engine SHALL emit a `member_early_exit` event containing vault_id, member address, payout amount, and penalty amount.

### Requirement 6: Community Settlement Pool

**User Story:** As an active member who stayed committed to maturity, I want to claim my share of the penalty pool, so that I am rewarded for my commitment.

#### Acceptance Criteria

1. THE Community_Settlement_Pool SHALL accumulate all penalty amounts from early exits within a given vault.
2. WHEN the Vault_State is `Settlement_Ready`, THE Community_Settlement_Pool SHALL distribute the pool balance equally among all members whose Member_State is `Active` at the time of settlement.
3. WHEN `claim_pool` is called by a member whose Member_State is `Active` or `Withdrawn` on a `Settlement_Ready` vault, THE Community_Settlement_Pool SHALL transfer that member's equal share of the pool to the member and update the member's Member_State to `Claimed`.
4. IF `claim_pool` is called by a member whose Member_State is not `Active` or `Withdrawn` on a `Settlement_Ready` vault, THEN THE Community_Settlement_Pool SHALL return an error.
5. IF `claim_pool` is called on a vault whose Vault_State is not `Settlement_Ready`, THEN THE Community_Settlement_Pool SHALL return an error.
6. THE Community_Settlement_Pool SHALL guarantee that the sum of all individual claim amounts equals the total pool balance for the vault, with no value created or destroyed.
7. IF the pool balance for a vault is zero (no early exits occurred), THEN `claim_pool` SHALL succeed and transfer zero tokens, updating the member's Member_State to `Claimed`.
8. WHEN all members with Member_State `Active` or `Withdrawn` have called `claim_pool`, THE Community_Settlement_Pool SHALL transition the Vault_State to `Resolved`.
9. WHEN `claim_pool` is called successfully, THE Community_Settlement_Pool SHALL emit a `pool_claimed` event containing vault_id, member address, and claimed amount.
10. WHEN the Vault_State transitions to `Resolved`, THE Community_Settlement_Pool SHALL emit a `vault_resolved` event containing the vault_id.

### Requirement 7: Vault State Machine

**User Story:** As a protocol participant, I want the vault to follow a strict, deterministic lifecycle, so that all state transitions are predictable and no vault can become permanently stuck.

#### Acceptance Criteria

1. THE CCP SHALL enforce the following Vault_State transition sequence: `Funding_Open` → `Active_Locked` (when fully funded) → `Settlement_Ready` (when unlock_time reached) → `Resolved` (when all claims complete).
2. THE CCP SHALL enforce the alternative failure path: `Funding_Open` → `Cancelled` (when funding_deadline passes without full funding).
3. IF any operation attempts to transition a vault to a Vault_State that is not a valid successor of its current Vault_State, THEN THE CCP SHALL return an error and the Vault_State SHALL remain unchanged.
4. THE CCP SHALL guarantee that every vault with Vault_State `Funding_Open` either transitions to `Active_Locked` or `Cancelled` — no vault SHALL remain in `Funding_Open` indefinitely.
5. THE CCP SHALL guarantee that every vault resolves exactly once, reaching Vault_State `Resolved` or `Cancelled` and never transitioning out of those terminal states.

### Requirement 8: Member State Machine

**User Story:** As a protocol participant, I want each member's state to follow a strict, deterministic lifecycle, so that double deposits, double withdrawals, and unauthorized actions are impossible.

#### Acceptance Criteria

1. THE CCP SHALL enforce the following Member_State transition sequence for members who complete the full lifecycle: `Committed` → `Deposited` → `Active` → `Withdrawn` → `Claimed`.
2. THE CCP SHALL enforce the early exit path: `Active` → `Exited` (irreversible).
3. IF any operation attempts to transition a member to a Member_State that is not a valid successor of their current Member_State, THEN THE CCP SHALL return an error and the Member_State SHALL remain unchanged.
4. THE CCP SHALL prevent any member from depositing more than once into the same vault.
5. THE CCP SHALL prevent any member from withdrawing more than once from the same vault.
6. THE CCP SHALL prevent any member from claiming the pool more than once from the same vault.

### Requirement 9: Economic Invariants

**User Story:** As a protocol participant, I want the contract to guarantee that no funds are ever created or destroyed, so that I can trust the protocol with my assets.

#### Acceptance Criteria

1. THE CCP SHALL maintain the invariant that the sum of all members' obligation amounts equals the Total_Vault_Size for every vault.
2. THE CCP SHALL maintain the invariant that `deposited_funds == returned_funds + distributed_funds + pool_balance` at all times for every vault, where no value is created or lost.
3. THE CCP SHALL maintain the invariant that the Pool_Balance for a vault equals the sum of all penalties collected from early exits in that vault.
4. THE CCP SHALL maintain the invariant that the sum of all individual pool claim amounts equals the total Pool_Balance for the vault.
5. THE CCP SHALL guarantee that a vault with Vault_State `Cancelled` retains zero locked funds once all depositors have individually withdrawn their refunds.

### Requirement 10: Access Control and Adversarial Safety

**User Story:** As a member, I want the protocol to be safe against adversarial behavior by the creator, other members, and external callers, so that no party can steal or permanently lock funds.

#### Acceptance Criteria

1. THE CCP SHALL require `require_auth()` from the caller for all state-mutating operations: `deposit`, `withdraw`, and `claim_pool`.
2. THE CCP SHALL prevent the creator from modifying vault parameters, membership, or funds after vault creation.
3. THE CCP SHALL prevent any address that is not on the vault's member list from calling `deposit` or `claim_pool` on that vault.
4. THE CCP SHALL prevent a member from depositing on behalf of another member.
5. IF a member deposits and then takes no further action, THE CCP SHALL resolve the situation through the funding_deadline timeout, either completing the vault if all others deposit or cancelling the vault and allowing refunds.
6. THE CCP SHALL prevent any caller from withdrawing funds belonging to another member.
7. THE CCP SHALL guarantee that the order in which members call `withdraw` or `claim_pool` does not affect the amount any individual member receives.

### Requirement 11: Read-Only Queries

**User Story:** As a frontend or indexer, I want to query vault and member state without modifying contract state, so that I can display accurate information to users.

#### Acceptance Criteria

1. THE CCP SHALL provide a `get_group_vault(vault_id)` function that returns the full Group_Vault record for the given vault_id.
2. IF `get_group_vault` is called with an unknown vault_id, THEN THE CCP SHALL return an error.
3. THE CCP SHALL provide a `get_member_state(vault_id, member)` function that returns the member's current Member_State and deposited amount for the given vault.
4. IF `get_member_state` is called with an address that is not a member of the vault, THEN THE CCP SHALL return an error.
5. THE CCP SHALL provide a `get_vaults_by_creator(creator)` function that returns a list of all vault_ids created by the given address. WHEN no vaults exist for the creator, THE CCP SHALL return an empty list.
6. THE CCP SHALL provide a `get_vaults_by_member(member)` function that returns a list of all vault_ids in which the given address is a member. WHEN no vaults exist for the member, THE CCP SHALL return an empty list.
7. THE CCP SHALL provide a `get_pool_balance(vault_id)` function that returns the current Pool_Balance for the given vault.
8. THE CCP SHALL provide a `get_member_claim_amount(vault_id, member)` function that returns the member's equal share of the pool. WHEN the pool balance is zero, THE CCP SHALL return zero.

### Requirement 12: Contract Initialization

**User Story:** As a deployer, I want to initialize the CCP contract once with supported token addresses, so that the contract is ready to accept vault creation calls.

#### Acceptance Criteria

1. THE CCP SHALL provide an `initialize` function that accepts the addresses for the XLM, USDC, and EURC token contracts and stores them as the supported token set.
2. WHEN `initialize` is called on an already-initialized contract, THE CCP SHALL return an error and the existing state SHALL remain unchanged.
3. THE CCP SHALL set the vault_id counter to zero during initialization.
4. WHEN `initialize` is called successfully, THE CCP SHALL be ready to accept `create_group_vault` calls.

### Requirement 13: Event Emission

**User Story:** As a frontend or indexer, I want the contract to emit structured events for all significant state transitions, so that I can track vault and member activity off-chain.

#### Acceptance Criteria

1. WHEN a group vault is created, THE CCP SHALL emit a `group_vault_created` event containing: vault_id, creator, token, member_count, total_vault_size, unlock_time, and lock_type.
2. WHEN a member deposits, THE CCP SHALL emit a `member_deposited` event containing: vault_id, member address, and amount.
3. WHEN a vault transitions to `Active_Locked`, THE CCP SHALL emit a `vault_activated` event containing: vault_id.
4. WHEN a vault transitions to `Cancelled`, THE CCP SHALL emit a `vault_cancelled` event containing: vault_id.
5. WHEN a member exits early, THE CCP SHALL emit a `member_early_exit` event containing: vault_id, member address, payout amount, and penalty amount.
6. WHEN a member completes a mature withdrawal, THE CCP SHALL emit a `member_withdrawn` event containing: vault_id, member address, and amount.
7. WHEN a member claims their pool share, THE CCP SHALL emit a `pool_claimed` event containing: vault_id, member address, and claimed amount.
8. WHEN a vault transitions to `Resolved`, THE CCP SHALL emit a `vault_resolved` event containing: vault_id.
