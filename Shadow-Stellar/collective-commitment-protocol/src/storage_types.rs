use soroban_sdk::{contracttype, contracterror, Address, BytesN};

#[contracttype]
pub enum DataKey {
    // Instance storage
    VaultCounter,
    SupportedTokens,
    CommunityPool(u64),

    // Persistent storage
    GroupVault(u64),
    MemberRecord(u64, Address),
    CreatorVaults(Address),
    MemberVaults(Address),

    // ── ZK storage keys ──────────────────────────────────────────────────────

    /// Spent nullifier registry.
    /// Key: the 32-byte nullifier itself.
    /// Value: vault_id (u64) — which vault consumed this nullifier.
    /// Used to prevent replay of ZK proofs.
    ZkNullifier(BytesN<32>),

    /// ZK member record for a (vault, slot_index) — privacy mode vaults.
    /// Stores the commitment instead of plaintext address.
    /// Key: (vault_id, slot_index)
    ZkMemberRecord(u64, u32),

    /// ZK vault flag — marks a vault as created in privacy mode.
    /// Value: bool
    ZkVaultPrivacyMode(u64),

    /// Per-vault ZK deposit commitment store.
    /// Key: (vault_id, nullifier_bytes)
    /// Value: ZkMemberRecord
    ZkDepositRecord(u64, BytesN<32>),

    /// UltraHonk verifier contract address (set at init).
    VerifierAddress,

    /// Embedded UltraHonk verification key bytes (set at init).
    /// When set, the embedded verifier is used instead of cross-contract.
    VerificationKey,
}

#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq)]
pub enum CcpError {
    // Initialization
    AlreadyInitialized       = 1,
    NotInitialized           = 2,

    // Input validation
    InvalidMemberCount       = 10,
    MemberAmountMismatch     = 11,
    InvalidObligationAmount  = 12,
    UnsupportedToken         = 13,
    InvalidUnlockTime        = 14,
    InvalidFundingDeadline   = 15,
    InvalidPenaltyRate       = 16,

    // Vault lifecycle
    VaultNotFound            = 20,
    NotMember                = 21,
    WrongVaultState          = 22,
    WrongMemberState         = 23,
    FundingDeadlinePassed    = 24,
    FundingDeadlineNotPassed = 25,
    EarlyExitNotAllowed      = 26,

    // Access control
    Unauthorized             = 30,

    // Token transfer
    TransferFailed           = 40,

    // ── ZK errors ─────────────────────────────────────────────────────────────

    /// The submitted ZK proof is invalid (commitment mismatch, bad range, etc.)
    InvalidZkProof           = 50,

    /// The nullifier has already been used — replay attempt detected
    NullifierAlreadyUsed     = 51,

    /// The ZK proof's amount opening does not match the declared obligation
    ZkAmountMismatch         = 52,

    /// Schnorr authentication proof failed
    SchnorrVerificationFailed = 53,

    /// Vault is in ZK privacy mode — use ZK functions instead
    VaultIsPrivacyMode       = 54,

    /// Vault is NOT in ZK privacy mode — use standard functions
    VaultNotPrivacyMode      = 55,

    /// ZK member slot not found in privacy vault
    ZkMemberSlotNotFound     = 56,

    /// UltraHonk verifier address not configured
    VerifierNotSet           = 60,

    /// UltraHonk zk-SNARK proof verification failed
    UltraHonkProofFailed     = 61,
}
