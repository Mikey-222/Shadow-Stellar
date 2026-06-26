#[cfg(test)]
pub mod helpers {
    use soroban_sdk::{
        testutils::{Address as _, Ledger, LedgerInfo},
        token::StellarAssetClient,
        token::TokenClient,
        Address, Env, Vec,
    };
    use crate::{CcpContract, CcpContractClient};

    // ── Mock UltraHONK verifier contracts ─────────────────────────────────────
    // Each mock is in its own module to avoid #[contract] + #[contractimpl] type
    // conflicts in Soroban SDK 22.

    pub mod mock_verifier {
        use soroban_sdk::{contract, contractimpl, Env, Bytes};

        #[contract]
        pub struct MockVerifier;

        #[contractimpl]
        impl MockVerifier {
            pub fn __constructor() {}
            pub fn verify(_env: Env, _proof_bytes: Bytes, _public_inputs: Bytes) -> bool {
                true
            }
            pub fn vk_bytes(_env: Env) -> Bytes {
                Bytes::new(&Env::default())
            }
        }
    }

    pub mod failing_verifier {
        use soroban_sdk::{contract, contractimpl, Env, Bytes};

        #[contract]
        pub struct FailingVerifier;

        #[contractimpl]
        impl FailingVerifier {
            pub fn __constructor() {}
            pub fn verify(_env: Env, _proof_bytes: Bytes, _public_inputs: Bytes) -> bool {
                false
            }
            pub fn vk_bytes(_env: Env) -> Bytes {
                Bytes::new(&Env::default())
            }
        }
    }

    pub use mock_verifier::MockVerifier;
    pub use failing_verifier::FailingVerifier;

    pub struct TestSetup {
        pub env: Env,
        pub client: CcpContractClient<'static>,
        pub xlm: Address,
        pub usdc: Address,
        pub eurc: Address,
    }

    pub fn ledger_info(timestamp: u64, seq: u32) -> LedgerInfo {
        LedgerInfo {
            timestamp,
            protocol_version: 26,
            sequence_number: seq,
            network_id: Default::default(),
            base_reserve: 10,
            min_temp_entry_ttl: 6_312_000,
            min_persistent_entry_ttl: 6_312_000,
            max_entry_ttl: 6_312_000,
        }
    }

    /// Create a TestSetup with a mock verifier registered in the same env.
    pub fn setup_with_verifier<F>(register_verifier: F) -> (TestSetup, Address)
    where
        F: FnOnce(&Env) -> Address,
    {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set(ledger_info(1_000_000, 1));

        let verifier_id = register_verifier(&env);
        let contract_id = env.register(CcpContract, ());
        let xlm = env.register_stellar_asset_contract_v2(Address::generate(&env)).address();
        let usdc = env.register_stellar_asset_contract_v2(Address::generate(&env)).address();
        let eurc = env.register_stellar_asset_contract_v2(Address::generate(&env)).address();

        let client = CcpContractClient::new(&env, &contract_id);
        client.initialize(&xlm, &usdc, &eurc, &Some(verifier_id.clone()));

        let env: Env = unsafe { core::mem::transmute(env) };
        let client: CcpContractClient<'static> = unsafe { core::mem::transmute(client) };

        (TestSetup { env, client, xlm, usdc, eurc }, verifier_id)
    }

    impl TestSetup {
        pub fn new() -> Self {
            let env = Env::default();
            env.mock_all_auths();
            env.ledger().set(ledger_info(1_000_000, 1));

            let contract_id = env.register(CcpContract, ());
            let xlm = env.register_stellar_asset_contract_v2(Address::generate(&env)).address();
            let usdc = env.register_stellar_asset_contract_v2(Address::generate(&env)).address();
            let eurc = env.register_stellar_asset_contract_v2(Address::generate(&env)).address();

            let client = CcpContractClient::new(&env, &contract_id);
            client.initialize(&xlm, &usdc, &eurc, &None);

            let env: Env = unsafe { core::mem::transmute(env) };
            let client: CcpContractClient<'static> = unsafe { core::mem::transmute(client) };

            TestSetup { env, client, xlm, usdc, eurc }
        }

        pub fn make_members(&self, n: u32, amount: i128) -> Vec<Address> {
            let mut members = Vec::new(&self.env);
            for _ in 0..n {
                let m = Address::generate(&self.env);
                StellarAssetClient::new(&self.env, &self.xlm).mint(&m, &amount);
                members.push_back(m);
            }
            members
        }

        pub fn advance_time(&self, delta: u64) {
            let ts = self.env.ledger().timestamp();
            let seq = self.env.ledger().sequence();
            self.env.ledger().set(ledger_info(ts + delta, seq + 1));
        }

        pub fn token_balance(&self, token: &Address, addr: &Address) -> i128 {
            TokenClient::new(&self.env, token).balance(addr)
        }
    }
}

// ─── Hash-based ZK Integration Tests ──────────────────────────────────────────

#[cfg(test)]
pub mod hash_zk_tests {
    use soroban_sdk::{
        testutils::Address as _,
        token::StellarAssetClient,
        Address, Env, Vec,
    };
    use crate::{
        CcpError, LockType, MemberState, zk::{
            commit, compute_range_tag, sha256_domain2,
            bytes32_to_soroban,
            DOMAIN_NULLIFIER, ZkDepositProof, ZkProof,
        },
    };
    use super::helpers::TestSetup;

    fn make_amounts(env: &Env, n: u32, amt: i128) -> Vec<i128> {
        let mut v = Vec::new(env);
        for _ in 0..n { v.push_back(amt); }
        v
    }

    /// Build a valid ZkDepositProof for a given slot obligation.
    fn make_deposit_proof(
        env: &Env, slot: u32, vault_id: u64, obligation: i128,
    ) -> (ZkDepositProof, [u8; 32]) {
        let r = [slot as u8 + 0x10; 32];
        let c = commit(env, obligation, &r);
        let rt = compute_range_tag(env, &c, obligation, obligation);
        let n = sha256_domain2(env, DOMAIN_NULLIFIER, &vault_id.to_le_bytes(), &c);
        let proof = ZkDepositProof {
            commitment: bytes32_to_soroban(env, &c),
            range_tag:  bytes32_to_soroban(env, &rt),
            nullifier:  bytes32_to_soroban(env, &n),
        };
        (proof, r)
    }

    fn create_zk_vault(t: &TestSetup, creator: &Address) -> u64 {
        let now = t.env.ledger().timestamp();
        let mut commitments = Vec::new(&t.env);
        for i in 0..5u32 {
            let r = [i as u8 + 0x10; 32];
            let c = commit(&t.env, 1000, &r);
            commitments.push_back(bytes32_to_soroban(&t.env, &c));
        }
        let amounts = make_amounts(&t.env, 5, 1000);
        t.client.create_group_vault_zk(
            creator, &t.xlm, &commitments, &amounts,
            &(now + 7200), &(now + 3600), &LockType::Strict, &0,
        )
    }

    #[test]
    fn test_hash_zk_deposit_success() {
        let t = TestSetup::new();
        let creator = Address::generate(&t.env);
        StellarAssetClient::new(&t.env, &t.xlm).mint(&creator, &10_000_000);
        let vault_id = create_zk_vault(&t, &creator);

        let zk_vault = t.client.get_zk_vault(&vault_id);
        assert_eq!(zk_vault.deposited_count, 0u32);

        let (proof, _r) = make_deposit_proof(&t.env, 0, vault_id, 1000);
        let zk_proof = ZkProof { deposit_proof: proof };
        t.client.deposit_zk(&creator, &vault_id, &0u32, &zk_proof);

        let zk_vault = t.client.get_zk_vault(&vault_id);
        assert_eq!(zk_vault.deposited_count, 1u32);

        let slot0 = t.client.get_zk_member_record_fn(&vault_id, &0u32);
        assert_eq!(slot0.state, MemberState::Deposited);
    }

    #[test]
    fn test_hash_zk_deposit_nullifier_replay() {
        let t = TestSetup::new();
        let creator = Address::generate(&t.env);
        StellarAssetClient::new(&t.env, &t.xlm).mint(&creator, &10_000_000);
        let vault_id = create_zk_vault(&t, &creator);

        let (proof, _r) = make_deposit_proof(&t.env, 0, vault_id, 1000);
        let zk_proof = ZkProof { deposit_proof: proof.clone() };
        t.client.deposit_zk(&creator, &vault_id, &0u32, &zk_proof);

        // Replay same proof into a different slot — nullifier check should reject
        let result = t.client.try_deposit_zk(
            &creator, &vault_id, &1u32, &ZkProof { deposit_proof: proof },
        );
        assert_eq!(result, Err(Ok(CcpError::NullifierAlreadyUsed)));
    }
}

// ─── UltraHONK Integration Tests ────────────────────────────────────────────────

#[cfg(test)]
pub mod ultrahonk_tests {
    use soroban_sdk::{
        testutils::Address as _,
        token::StellarAssetClient,
        Address, Bytes, BytesN, Env, Vec,
    };

    use crate::{
        CcpError, LockType, MemberState, VaultState,
    };
    use super::helpers::{TestSetup, MockVerifier, FailingVerifier, setup_with_verifier};

    fn make_commitments(env: &Env, n: u32) -> Vec<BytesN<32>> {
        let mut v = Vec::new(env);
        for i in 0..n {
            let mut arr = [0u8; 32];
            arr[0] = i as u8 + 1;
            v.push_back(BytesN::from_array(env, &arr));
        }
        v
    }
    fn make_amounts(env: &Env, n: u32, amt: i128) -> Vec<i128> {
        let mut v = Vec::new(env);
        for _ in 0..n { v.push_back(amt); }
        v
    }

    fn mock_proof_bytes(env: &Env) -> Bytes {
        Bytes::from_array(env, &[0xabu8; 128])
    }

    fn mock_public_inputs(env: &Env) -> Bytes {
        Bytes::from_array(env, &[0xbbu8; 32])
    }

    fn create_zk_vault(t: &TestSetup, creator: &Address) -> u64 {
        let now = t.env.ledger().timestamp();
        let commitments = make_commitments(&t.env, 5);
        let amounts = make_amounts(&t.env, 5, 1000);
        t.client.create_group_vault_zk(
            creator, &t.xlm, &commitments, &amounts,
            &(now + 7200), &(now + 3600), &LockType::Strict, &0,
        )
    }

    #[test]
    fn test_ultrahonk_verifier_not_set() {
        let t = TestSetup::new();
        let creator = Address::generate(&t.env);
        StellarAssetClient::new(&t.env, &t.xlm).mint(&creator, &1_000_000);
        let vault_id = create_zk_vault(&t, &creator);

        let result = t.client.try_deposit_zk_ultrahonk(
            &creator, &vault_id, &mock_proof_bytes(&t.env), &mock_public_inputs(&t.env),
        );
        assert_eq!(result, Err(Ok(CcpError::VerifierNotSet)));
    }

    #[test]
    fn test_ultrahonk_deposit_success() {
        let (t, _verifier) = setup_with_verifier(|env| env.register(MockVerifier, ()));
        let creator = Address::generate(&t.env);
        StellarAssetClient::new(&t.env, &t.xlm).mint(&creator, &1_000_000);
        let vault_id = create_zk_vault(&t, &creator);

        let zk_vault = t.client.get_zk_vault(&vault_id);
        assert_eq!(zk_vault.deposited_count, 0u32);

        t.client.deposit_zk_ultrahonk(
            &creator, &vault_id, &mock_proof_bytes(&t.env), &mock_public_inputs(&t.env),
        );

        let zk_vault = t.client.get_zk_vault(&vault_id);
        assert_eq!(zk_vault.deposited_count, 1u32);

        let slot0 = t.client.get_zk_member_record_fn(&vault_id, &0u32);
        assert_eq!(slot0.state, MemberState::Deposited);
    }

    #[test]
    fn test_ultrahonk_deposit_failing_verifier() {
        let (t, _verifier) = setup_with_verifier(|env| env.register(FailingVerifier, ()));
        let creator = Address::generate(&t.env);
        StellarAssetClient::new(&t.env, &t.xlm).mint(&creator, &1_000_000);
        let vault_id = create_zk_vault(&t, &creator);

        let result = t.client.try_deposit_zk_ultrahonk(
            &creator, &vault_id, &mock_proof_bytes(&t.env), &mock_public_inputs(&t.env),
        );
        assert_eq!(result, Err(Ok(CcpError::UltraHonkProofFailed)));
    }

    #[test]
    fn test_ultrahonk_deposit_non_privacy_vault() {
        let (t, _verifier) = setup_with_verifier(|env| env.register(MockVerifier, ()));
        let now = t.env.ledger().timestamp();
        let creator = Address::generate(&t.env);
        StellarAssetClient::new(&t.env, &t.xlm).mint(&creator, &1_000_000);

        let members = t.make_members(5, 1000);
        let amounts = make_amounts(&t.env, 5, 1000);

        let vault_id = t.client.create_group_vault(
            &members.get(0).unwrap(), &t.xlm, &members, &amounts,
            &(now + 7200), &(now + 3600), &LockType::Strict, &0,
        );

        let result = t.client.try_deposit_zk_ultrahonk(
            &creator, &vault_id, &mock_proof_bytes(&t.env), &mock_public_inputs(&t.env),
        );
        assert_eq!(result, Err(Ok(CcpError::VaultNotPrivacyMode)));
    }

    #[test]
    fn test_ultrahonk_deposit_fills_slots_in_order() {
        let (t, _verifier) = setup_with_verifier(|env| env.register(MockVerifier, ()));
        let creator = Address::generate(&t.env);
        StellarAssetClient::new(&t.env, &t.xlm).mint(&creator, &10_000_000);
        let vault_id = create_zk_vault(&t, &creator);

        // Deposit into slot 0
        t.client.deposit_zk_ultrahonk(
            &creator, &vault_id, &mock_proof_bytes(&t.env), &mock_public_inputs(&t.env),
        );
        let slot0 = t.client.get_zk_member_record_fn(&vault_id, &0u32);
        assert_eq!(slot0.state, MemberState::Deposited);

        // Deposit with a different proof fills slot 1 (same vault, next slot)
        let diff_proof = Bytes::from_array(&t.env, &[0xbbu8; 128]);
        t.client.deposit_zk_ultrahonk(
            &creator, &vault_id, &diff_proof, &mock_public_inputs(&t.env),
        );
        let slot1 = t.client.get_zk_member_record_fn(&vault_id, &1u32);
        assert_eq!(slot1.state, MemberState::Deposited);
    }

    #[test]
    fn test_ultrahonk_deposit_funds_transferred() {
        let (t, _verifier) = setup_with_verifier(|env| env.register(MockVerifier, ()));
        let creator = Address::generate(&t.env);
        StellarAssetClient::new(&t.env, &t.xlm).mint(&creator, &10_000_000);
        let vault_id = create_zk_vault(&t, &creator);

        let bal_before = t.token_balance(&t.xlm, &creator);
        t.client.deposit_zk_ultrahonk(
            &creator, &vault_id, &mock_proof_bytes(&t.env), &mock_public_inputs(&t.env),
        );
        let bal_after = t.token_balance(&t.xlm, &creator);

        // 5% commission (500 bps) → 950 locked, 50 sent to creator
        // 5% commission (500 bps). Since creator == depositor, the commission
        // is returned to them: net loss = amount - commission = 950.
        assert_eq!(bal_before - bal_after, 950);
    }

    #[test]
    fn test_ultrahonk_full_activation() {
        let (t, _verifier) = setup_with_verifier(|env| env.register(MockVerifier, ()));
        let creator = Address::generate(&t.env);
        StellarAssetClient::new(&t.env, &t.xlm).mint(&creator, &100_000_000);
        let vault_id = create_zk_vault(&t, &creator);

        // Deposit into all 5 slots using fresh addresses
        for i in 0..5 {
            let depositor = Address::generate(&t.env);
            StellarAssetClient::new(&t.env, &t.xlm).mint(&depositor, &100_000_000);
            t.client.deposit_zk_ultrahonk(
                &depositor, &vault_id, &mock_proof_bytes(&t.env), &mock_public_inputs(&t.env),
            );
        }

        let zk_vault = t.client.get_zk_vault(&vault_id);
        assert_eq!(zk_vault.deposited_count, 5u32);
        assert_eq!(zk_vault.state, VaultState::ActiveLocked);

        // All members should be Active
        for i in 0..5u32 {
            let slot = t.client.get_zk_member_record_fn(&vault_id, &i);
            assert_eq!(slot.state, MemberState::Active);
        }
    }
}