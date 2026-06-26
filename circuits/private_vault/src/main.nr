fn main(
    commitment: pub Field,
    nullifier: pub Field,
    blinding: Field,
    recipient: Field,
    amount: Field,
    entry_id: Field,
) {
    let computed_commitment = std::hash::pedersen_hash([blinding, recipient, amount]);
    assert(commitment == computed_commitment);

    let computed_nullifier = std::hash::pedersen_hash([blinding, entry_id]);
    assert(nullifier == computed_nullifier);

    assert(amount != 0);
}
