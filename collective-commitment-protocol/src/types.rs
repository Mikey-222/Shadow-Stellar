use soroban_sdk::{contracttype, Address, BytesN, Map, Vec};

// ─── Enums ────────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, PartialEq, Debug)]
pub enum VaultState {
    FundingOpen,
    ActiveLocked,
    SettlementReady,
    Resolved,
    Cancelled,
}

#[contracttype]
#[derive(Clone, PartialEq, Debug)]
pub enum MemberState {
    Committed,
    Deposited,
    Active,
    Exited,
    Withdrawn,
    Claimed,
}

#[contracttype]
#[derive(Clone, PartialEq, Debug)]
pub enum LockType {
    Strict,
    Penalty,
}

// ─── Core structs ─────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug)]
pub struct GroupVault {
    pub vault_id: u64,
    pub creator: Address,
    pub token: Address,
    pub members: Vec<Address>,
    pub obligations: Map<Address, i128>,
    pub unlock_time: u64,
    pub funding_deadline: u64,
    pub lock_type: LockType,
    pub penalty_rate: u32,
    pub state: VaultState,
    pub total_size: i128,
    pub deposited_count: u32,
    pub claimed_count: u32,
    /// Set when vault transitions to SettlementReady — total members eligible to claim pool
    pub eligible_claimers: u32,
    /// Set when vault transitions to SettlementReady — original pool balance for equal distribution
    pub original_pool: i128,
    /// Creator commission in basis points (e.g. 500 = 5%). Deducted from each deposit.
    pub commission_rate: u32,
}

// ── ZK-specific types ─────────────────────────────────────────────────────────

/// A ZK member record stored on-chain in privacy-mode vaults.
///
/// Instead of an `Address`, each member slot stores:
/// - A commitment to the member's identity secret
/// - The member state (same state machine as `MemberState`)
/// - A commitment to their deposit amount (once deposited)
///
/// The actual address is only used for token transfers —
/// it is NOT stored in the member record.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ZkMemberRecord {
    /// Commitment to the member's identity secret (BN254 Pedersen):
    ///   member_commitment = secret * G + r * H
    pub member_commitment: BytesN<32>,

    /// Commitment to the deposited amount (set after deposit, BN254 Pedersen):
    ///   amount_commitment = amount * G + r * H
    /// Zero before deposit.
    pub amount_commitment: BytesN<32>,

    /// Vault-scoped nullifier used during deposit:
    ///   nullifier = SHA-256(DOMAIN_NULLIFIER || vault_id || blinding_r)
    /// Zero before deposit.
    pub nullifier: BytesN<32>,

    /// Current state of this member (same MemberState enum).
    pub state: MemberState,

    /// Net locked amount stored after ZK deposit verification.
    /// This is revealed when the member withdraws.
    pub amount: i128,
}

/// Privacy-mode group vault.
///
/// Same lifecycle as `GroupVault` but member identities and amounts are
/// committed via ZK before being revealed.  Member addresses are still
/// required for token transfers but are NOT stored in the vault record.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ZkGroupVault {
    pub vault_id: u64,
    pub creator: Address,
    pub token: Address,

    /// Number of member slots (5–100).
    pub member_count: u32,

    /// Total obligation computed from member_obligations sum.
    pub total_size: i128,

    /// Per-slot obligation amounts (slot_index → amount).
    /// Set at creation; revealed by the creator.
    pub slot_obligations: Map<u32, i128>,

    pub unlock_time: u64,
    pub funding_deadline: u64,
    pub lock_type: LockType,
    pub penalty_rate: u32,
    pub state: VaultState,

    pub deposited_count: u32,
    pub claimed_count: u32,
    pub eligible_claimers: u32,
    pub original_pool: i128,
    pub commission_rate: u32,
}

/// Event emitted on a successful ZK deposit.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ZkMemberDepositedEvent {
    pub vault_id: u64,
    /// The nullifier hash (not the address — preserves privacy).
    pub nullifier: BytesN<32>,
    /// The commitment to the deposited amount.
    pub amount_commitment: BytesN<32>,
}

/// Event emitted when a ZK privacy-mode vault is created.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ZkGroupVaultCreatedEvent {
    pub vault_id: u64,
    pub creator: Address,
    pub token: Address,
    pub member_count: u32,
    pub total_vault_size: i128,
    pub unlock_time: u64,
    pub lock_type: LockType,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct MemberRecord {
    pub state: MemberState,
    pub amount: i128,
}

// ─── Event structs ────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug)]
pub struct GroupVaultCreatedEvent {
    pub vault_id: u64,
    pub creator: Address,
    pub token: Address,
    pub member_count: u32,
    pub total_vault_size: i128,
    pub unlock_time: u64,
    pub lock_type: LockType,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct MemberDepositedEvent {
    pub vault_id: u64,
    pub member: Address,
    pub amount: i128,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct VaultActivatedEvent {
    pub vault_id: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct VaultCancelledEvent {
    pub vault_id: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct MemberEarlyExitEvent {
    pub vault_id: u64,
    pub member: Address,
    pub payout: i128,
    pub penalty: i128,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct MemberWithdrawnEvent {
    pub vault_id: u64,
    pub member: Address,
    pub amount: i128,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct PoolClaimedEvent {
    pub vault_id: u64,
    pub member: Address,
    pub claimed: i128,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct VaultResolvedEvent {
    pub vault_id: u64,
}
