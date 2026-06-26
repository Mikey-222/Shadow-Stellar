use core::array;

use crate::{
    field::{batch_inverse, Fr},
    relations::accumulate_relation_evaluations,
    types::{Transcript, VerificationKey, BATCHED_RELATION_PARTIAL_LENGTH, CONST_PROOF_SIZE_LOG_N},
};
use soroban_sdk::Env;

const BARY_BYTES: [[u8; 32]; BATCHED_RELATION_PARTIAL_LENGTH] = [
    [
        0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58,
        0x5d, 0x28, 0x33, 0xe8, 0x48, 0x79, 0xb9, 0x70, 0x91, 0x43, 0xe1, 0xf5, 0x93, 0xef, 0xff,
        0xec, 0x51,
    ],
    [
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x02, 0xd0,
    ],
    [
        0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58,
        0x5d, 0x28, 0x33, 0xe8, 0x48, 0x79, 0xb9, 0x70, 0x91, 0x43, 0xe1, 0xf5, 0x93, 0xef, 0xff,
        0xff, 0x11,
    ],
    [
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x90,
    ],
    [
        0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58,
        0x5d, 0x28, 0x33, 0xe8, 0x48, 0x79, 0xb9, 0x70, 0x91, 0x43, 0xe1, 0xf5, 0x93, 0xef, 0xff,
        0xff, 0x71,
    ],
    [
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0xf0,
    ],
    [
        0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58,
        0x5d, 0x28, 0x33, 0xe8, 0x48, 0x79, 0xb9, 0x70, 0x91, 0x43, 0xe1, 0xf5, 0x93, 0xef, 0xff,
        0xfd, 0x31,
    ],
    [
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x13, 0xb0,
    ],
];

#[inline(always)]
fn check_sum(round_univariate: &[Fr], round_target: Fr) -> bool {
    let total_sum = &round_univariate[0] + &round_univariate[1];
    total_sum == round_target
}

#[inline(always)]
fn compute_next_target_sum(
    round_univariate: &[Fr],
    round_challenge: Fr,
    barycentric_weights: &[Fr; BATCHED_RELATION_PARTIAL_LENGTH],
    point_indices: &[Fr; BATCHED_RELATION_PARTIAL_LENGTH],
    one: &Fr,
    zero: &Fr,
) -> Result<Fr, &'static str> {
    for (point, univariate) in point_indices.iter().zip(round_univariate.iter()) {
        if &round_challenge == point {
            return Ok(univariate.clone());
        }
    }
    let mut denoms: [Fr; BATCHED_RELATION_PARTIAL_LENGTH] = array::from_fn(|_| zero.clone());
    let mut b_poly = one.clone();
    for i in 0..BATCHED_RELATION_PARTIAL_LENGTH {
        let diff = &round_challenge - &point_indices[i];
        b_poly = b_poly * &diff;
        denoms[i] = &barycentric_weights[i] * &diff;
    }
    let mut inv_denoms: [Fr; BATCHED_RELATION_PARTIAL_LENGTH] = array::from_fn(|_| zero.clone());
    batch_inverse(&denoms, &mut inv_denoms)
        .map_err(|_| "sumcheck: barycentric denominator is zero")?;
    let mut acc = zero.clone();
    for (univariate, inv_denom) in round_univariate.iter().zip(inv_denoms.iter()) {
        acc = acc + (univariate * inv_denom);
    }
    Ok(b_poly * acc)
}

#[inline(always)]
fn partially_evaluate_pow(
    one: &Fr,
    gate_challenge: Fr,
    pow_partial_evaluation: Fr,
    round_challenge: Fr,
) -> Fr {
    pow_partial_evaluation * (one + round_challenge * (gate_challenge - one))
}

pub fn verify_sumcheck(
    env: &Env,
    proof: &crate::types::Proof,
    tp: &Transcript,
    vk: &VerificationKey,
) -> Result<(), &'static str> {
    let log_n = vk.log_circuit_size as usize;
    if log_n == 0 || log_n > CONST_PROOF_SIZE_LOG_N {
        return Err("sumcheck: log_circuit_size out of range");
    }
    let zero = Fr::zero(env);
    let one = Fr::one(env);
    let barycentric_weights: [Fr; BATCHED_RELATION_PARTIAL_LENGTH] =
        array::from_fn(|i| Fr::from_array(env, &BARY_BYTES[i]));
    let point_indices: [Fr; BATCHED_RELATION_PARTIAL_LENGTH] =
        array::from_fn(|i| Fr::from_u64(env, i as u64));
    let mut round_target = zero.clone();
    let mut pow_partial_evaluation = one.clone();
    for round in 0..log_n {
        let round_univariate = &proof.sumcheck_univariates[round];
        if !check_sum(round_univariate, round_target) {
            return Err("round failed");
        }
        let round_challenge = tp.sumcheck_u_challenges[round].clone();
        round_target = compute_next_target_sum(
            round_univariate,
            round_challenge.clone(),
            &barycentric_weights,
            &point_indices,
            &one,
            &zero,
        )?;
        pow_partial_evaluation = partially_evaluate_pow(
            &one,
            tp.gate_challenges[round].clone(),
            pow_partial_evaluation,
            round_challenge,
        );
    }
    let grand_honk_relation_sum = accumulate_relation_evaluations(
        env,
        &proof.sumcheck_evaluations,
        &tp.rel_params,
        &tp.alphas,
        pow_partial_evaluation,
    );
    if grand_honk_relation_sum == round_target {
        Ok(())
    } else {
        crate::trace!("===== SUMCHECK FINAL CHECK FAILED =====");
        crate::trace!("grand_relation = 0x{:x}", crate::debug::Hex(&grand_honk_relation_sum.to_bytes()));
        crate::trace!("target = 0x{:x}", crate::debug::Hex(&round_target.to_bytes()));
        Err("sumcheck final mismatch")
    }
}
