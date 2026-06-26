use crate::ec::{g1_msm, pairing_check};
use crate::field::{batch_inverse, Fr};
use crate::trace;
use crate::types::{
    G1Point, Proof, Transcript, VerificationKey, CONST_PROOF_SIZE_LOG_N, NUMBER_OF_ENTITIES,
    NUMBER_UNSHIFTED,
};
use core::array::repeat;
use core::ops::Neg;
use soroban_sdk::Env;

pub fn verify_shplemini(
    env: &Env,
    proof: &Proof,
    vk: &VerificationKey,
    tp: &Transcript,
) -> Result<(), &'static str> {
    let log_n = vk.log_circuit_size as usize;
    if log_n == 0 || log_n > CONST_PROOF_SIZE_LOG_N {
        return Err("shplemini: log_circuit_size out of range");
    }
    let one = Fr::one(env);
    let two = Fr::from_u64(env, 2);
    let mut r_pows = Fr::zero_array::<CONST_PROOF_SIZE_LOG_N>(env);
    r_pows[0] = tp.gemini_r.clone();
    for i in 1..log_n {
        r_pows[i] = &r_pows[i - 1] * &r_pows[i - 1];
    }
    const MAX_BATCH: usize = 3 * CONST_PROOF_SIZE_LOG_N + 1;
    let batch_size = 3 + log_n + 2 * (log_n - 1);
    let mut to_invert = Fr::zero_array::<MAX_BATCH>(env);
    let mut inverted = Fr::zero_array::<MAX_BATCH>(env);
    to_invert[0] = &tp.shplonk_z - &r_pows[0];
    to_invert[1] = &tp.shplonk_z + &r_pows[0];
    to_invert[2] = tp.gemini_r.clone();
    for j in (1..=log_n).rev() {
        let u = &tp.sumcheck_u_challenges[j - 1];
        to_invert[3 + (log_n - j)] = &r_pows[j - 1] * &(&one - u) + u;
    }
    let further_base = 3 + log_n;
    for j in 1..log_n {
        to_invert[further_base + 2 * (j - 1)] = &tp.shplonk_z - &r_pows[j];
        to_invert[further_base + 2 * (j - 1) + 1] = &tp.shplonk_z + &r_pows[j];
    }
    batch_inverse(&to_invert[..batch_size], &mut inverted[..batch_size]).map_err(|_| {
        "shplemini: batch inversion failed (zero denominator in shplonk/gemini/fold)"
    })?;
    if inverted[..batch_size.min(inverted.len())]
        .iter()
        .any(|x| x.is_zero())
    {
        return Err("shplemini: batch inversion produced zero result");
    }
    let pos0 = inverted[0].clone();
    let neg0 = inverted[1].clone();
    let gemini_r_inv = inverted[2].clone();
    const TOTAL: usize = 1 + NUMBER_UNSHIFTED + CONST_PROOF_SIZE_LOG_N + 1;
    trace!("total = {}", TOTAL);
    let mut scalars = Fr::zero_array::<TOTAL>(env);
    let mut coms = repeat::<G1Point, TOTAL>(G1Point::infinity(env));
    let unshifted = &tp.shplonk_nu * &neg0 + &pos0;
    let shifted = gemini_r_inv * (&pos0 - &(&tp.shplonk_nu * &neg0));
    let neg_unshifted = -&unshifted;
    let neg_shifted = -&shifted;
    scalars[0] = one.clone();
    coms[0] = proof.shplonk_q.clone();
    let mut rho_pow = one.clone();
    let mut eval_acc = Fr::zero(env);
    let mut eval_scalars = Fr::zero_array::<NUMBER_OF_ENTITIES>(env);
    for (idx, eval) in proof
        .sumcheck_evaluations
        .iter()
        .take(NUMBER_OF_ENTITIES)
        .enumerate()
    {
        let scalar = if idx < NUMBER_UNSHIFTED {
            neg_unshifted.clone()
        } else {
            neg_shifted.clone()
        } * &rho_pow;
        eval_scalars[idx] = scalar;
        eval_acc = eval_acc + &(eval * &rho_pow);
        rho_pow = rho_pow * &tp.rho;
    }
    for (unshifted, shifted) in [(27, 35), (28, 36), (29, 37), (30, 38), (31, 39)] {
        eval_scalars[unshifted] = eval_scalars[unshifted].clone() + eval_scalars[shifted].clone();
    }
    {
        let mut j = 1;
        macro_rules! push_vk {
            ($($field:ident),+ $(,)?) => {
                $(
                    coms[j] = vk.$field.clone();
                    scalars[j] = eval_scalars[j - 1].clone();
                    j += 1;
                )+
            };
        }
        push_vk![
            qm, qc, ql, qr, qo, q4, q_lookup, q_arith, q_delta_range,
            q_elliptic, q_aux, q_poseidon2_external, q_poseidon2_internal,
            s1, s2, s3, s4, id1, id2, id3, id4,
            t1, t2, t3, t4, lagrange_first, lagrange_last
        ];
        coms[j] = proof.w1.clone();
        scalars[j] = eval_scalars[27].clone();
        j += 1;
        coms[j] = proof.w2.clone();
        scalars[j] = eval_scalars[28].clone();
        j += 1;
        coms[j] = proof.w3.clone();
        scalars[j] = eval_scalars[29].clone();
        j += 1;
        coms[j] = proof.w4.clone();
        scalars[j] = eval_scalars[30].clone();
        j += 1;
        coms[j] = proof.z_perm.clone();
        scalars[j] = eval_scalars[31].clone();
        j += 1;
        coms[j] = proof.lookup_inverses.clone();
        scalars[j] = eval_scalars[32].clone();
        j += 1;
        coms[j] = proof.lookup_read_counts.clone();
        scalars[j] = eval_scalars[33].clone();
        j += 1;
        coms[j] = proof.lookup_read_tags.clone();
        scalars[j] = eval_scalars[34].clone();
        j += 1;
        let _ = j;
    }
    let mut fold_pos = Fr::zero_array::<CONST_PROOF_SIZE_LOG_N>(env);
    let mut cur = eval_acc;
    for j in (1..=log_n).rev() {
        let r2 = &r_pows[j - 1];
        let u = &tp.sumcheck_u_challenges[j - 1];
        let fold_lin = r2 * &(&one - u) - u;
        let num = r2 * &cur * &two - &(&proof.gemini_a_evaluations[j - 1] * &fold_lin);
        let den_inv = inverted[3 + (log_n - j)].clone();
        cur = num * &den_inv;
        fold_pos[j - 1] = cur.clone();
    }
    let nu_sq = &tp.shplonk_nu * &tp.shplonk_nu;
    let mut const_acc =
        &fold_pos[0] * &pos0 + &(&proof.gemini_a_evaluations[0] * &tp.shplonk_nu * &neg0);
    let mut v_pow = nu_sq.clone();
    let base = 1 + NUMBER_UNSHIFTED;
    for j in 1..log_n {
        let pos_inv = inverted[further_base + 2 * (j - 1)].clone();
        let neg_inv = inverted[further_base + 2 * (j - 1) + 1].clone();
        let sp = &v_pow * &pos_inv;
        let sn = &v_pow * &tp.shplonk_nu * &neg_inv;
        scalars[base + j - 1] = -(&sp + &sn);
        const_acc = const_acc + &(&proof.gemini_a_evaluations[j] * &sn) + &(&fold_pos[j] * &sp);
        v_pow = v_pow * &nu_sq;
        coms[base + j - 1] = proof.gemini_fold_comms[j - 1].clone();
    }
    coms[((log_n - 1) + base)..((CONST_PROOF_SIZE_LOG_N - 1) + base)]
        .clone_from_slice(&proof.gemini_fold_comms[(log_n - 1)..(CONST_PROOF_SIZE_LOG_N - 1)]);
    let one_idx = base + (CONST_PROOF_SIZE_LOG_N - 1);
    trace!("one_idx = {}", one_idx);
    coms[one_idx] = G1Point::generator(env);
    scalars[one_idx] = const_acc;
    let q_idx = one_idx + 1;
    trace!("q_idx = {}", q_idx);
    coms[q_idx] = proof.kzg_quotient.clone();
    scalars[q_idx] = tp.shplonk_z.clone();
    let p0 = g1_msm(env, &coms, &scalars)?;
    let p1 = proof.kzg_quotient.0.clone().neg();
    if pairing_check(env, &p0, &p1) {
        Ok(())
    } else {
        Err("Shplonk pairing check failed")
    }
}
