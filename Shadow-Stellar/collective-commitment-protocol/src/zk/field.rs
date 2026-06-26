//! # Finite Field Arithmetic (Fp)
//!
//! Implements arithmetic over a 252-bit prime field suitable for Pedersen
//! commitments and Schnorr-style proofs inside the Soroban WASM runtime.
//!
//! Prime: p = 2^252 + 27742317777372353535851937790883648493
//! This is the order of the Ed25519 curve's base-point subgroup (ℓ).
//! Using ℓ lets us work purely with scalars and verify proofs against the
//! Ed25519 compressed-point convention that Stellar already uses natively.
//!
//! All arithmetic is constant-width u128 pairs (lo, hi) representing a
//! 256-bit integer reduced mod p.  This avoids any heap allocation and runs
//! cleanly inside `#![no_std]`.

/// The Ed25519 group order (ℓ) stored as two 128-bit limbs [lo, hi].
/// p = 2^252 + 27742317777372353535851937790883648493
/// In hex: 1000000000000000000000000000000014def9dea2f79cd65812631a5cf5d3ed
pub const FIELD_ORDER_LO: u128 = 0x14def9dea2f79cd65812631a5cf5d3ed;
pub const FIELD_ORDER_HI: u128 = 0x1000000000000000000000000000000;

/// 256-bit field element represented as (lo, hi) where value = hi * 2^128 + lo.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Fp {
    pub lo: u128,
    pub hi: u128,
}

impl Fp {
    pub const ZERO: Fp = Fp { lo: 0, hi: 0 };
    pub const ONE: Fp = Fp { lo: 1, hi: 0 };

    /// Construct from a u64 (for small scalars, e.g. counts, penalties).
    #[inline]
    pub fn from_u64(v: u64) -> Fp {
        Fp { lo: v as u128, hi: 0 }
    }

    /// Construct from a u128 (for amounts encoded directly).
    #[inline]
    pub fn from_u128(v: u128) -> Fp {
        Fp { lo: v, hi: 0 }.reduce()
    }

    /// Construct from a little-endian 32-byte array (Schnorr/Ed25519 scalar).
    pub fn from_bytes_le(bytes: &[u8; 32]) -> Fp {
        let lo = u128::from_le_bytes(bytes[0..16].try_into().unwrap_or([0u8; 16]));
        let hi = u128::from_le_bytes(bytes[16..32].try_into().unwrap_or([0u8; 16]));
        Fp { lo, hi }.reduce()
    }

    /// Encode to a little-endian 32-byte array.
    pub fn to_bytes_le(self) -> [u8; 32] {
        let mut out = [0u8; 32];
        out[0..16].copy_from_slice(&self.lo.to_le_bytes());
        out[16..32].copy_from_slice(&self.hi.to_le_bytes());
        out
    }

    /// Return true iff self == 0.
    #[inline]
    pub fn is_zero(self) -> bool {
        self.lo == 0 && self.hi == 0
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    /// Add two 256-bit integers, returning (sum, carry_out).
    #[inline(always)]
    fn add256(alo: u128, ahi: u128, blo: u128, bhi: u128) -> (u128, u128, bool) {
        let (lo, c0) = alo.overflowing_add(blo);
        let (hi, c1) = ahi.overflowing_add(bhi);
        let (hi, c2) = hi.overflowing_add(c0 as u128);
        (lo, hi, c1 || c2)
    }

    /// Subtract two 256-bit integers, returning (diff, borrow).
    #[inline(always)]
    fn sub256(alo: u128, ahi: u128, blo: u128, bhi: u128) -> (u128, u128, bool) {
        let (lo, b0) = alo.overflowing_sub(blo);
        let (hi, b1) = ahi.overflowing_sub(bhi);
        let (hi, b2) = hi.overflowing_sub(b0 as u128);
        (lo, hi, b1 || b2)
    }

    /// Reduce a (lo, hi) pair modulo FIELD_ORDER.
    /// Works because hi ≤ 2*FIELD_ORDER_HI after a single field operation.
    pub fn reduce(self) -> Fp {
        // Compare self >= p
        let (rlo, rhi, borrow) = Self::sub256(self.lo, self.hi, FIELD_ORDER_LO, FIELD_ORDER_HI);
        if borrow {
            // self < p, already reduced
            Fp { lo: self.lo, hi: self.hi }
        } else {
            Fp { lo: rlo, hi: rhi }
        }
    }

    // ── Field operations ──────────────────────────────────────────────────────

    /// Modular addition.
    pub fn add(self, rhs: Fp) -> Fp {
        let (lo, hi, _carry) = Self::add256(self.lo, self.hi, rhs.lo, rhs.hi);
        Fp { lo, hi }.reduce()
    }

    /// Modular subtraction (wraps correctly).
    pub fn sub(self, rhs: Fp) -> Fp {
        let (lo, hi, borrow) = Self::sub256(self.lo, self.hi, rhs.lo, rhs.hi);
        if borrow {
            // Add p back
            let (lo2, hi2, _) = Self::add256(lo, hi, FIELD_ORDER_LO, FIELD_ORDER_HI);
            Fp { lo: lo2, hi: hi2 }
        } else {
            Fp { lo, hi }
        }
    }

    /// Modular negation.
    #[inline]
    pub fn neg(self) -> Fp {
        if self.is_zero() { self } else { Fp { lo: FIELD_ORDER_LO, hi: FIELD_ORDER_HI }.sub(self) }
    }

    /// Modular multiplication using schoolbook 128-bit limb multiplication.
    /// We compute a*b mod p using the identity:
    ///   a = alo + ahi*2^128
    ///   b = blo + bhi*2^128
    ///   a*b = alo*blo + (alo*bhi + ahi*blo)*2^128 + ahi*bhi*2^256
    ///
    /// Each 128×128 → 256 product is split into four 64×64 → 128 products.
    pub fn mul(self, rhs: Fp) -> Fp {
        // We need 512-bit intermediate, represented as four u128 limbs [r0,r1,r2,r3]
        // where value = r0 + r1*2^128 + r2*2^256 + r3*2^384.
        // Then reduce mod p.

        // Split into four 64-bit limbs
        let a0 = self.lo as u64 as u128;
        let a1 = (self.lo >> 64) as u64 as u128;
        let a2 = self.hi as u64 as u128;
        let a3 = (self.hi >> 64) as u64 as u128;

        let b0 = rhs.lo as u64 as u128;
        let b1 = (rhs.lo >> 64) as u64 as u128;
        let b2 = rhs.hi as u64 as u128;
        let b3 = (rhs.hi >> 64) as u64 as u128;

        // Accumulate into 8 × 64-bit buckets (limbs of the 512-bit product)
        let mut t: [u128; 8] = [0u128; 8];
        let pairs = [
            (0, a0, b0), (1, a0, b1), (1, a1, b0),
            (2, a0, b2), (2, a1, b1), (2, a2, b0),
            (3, a0, b3), (3, a1, b2), (3, a2, b1), (3, a3, b0),
            (4, a1, b3), (4, a2, b2), (4, a3, b1),
            (5, a2, b3), (5, a3, b2),
            (6, a3, b3),
        ];
        for (idx, x, y) in pairs.iter() {
            t[*idx] += x * y;
        }

        // Propagate carries across 64-bit boundaries
        let mut carry: u128 = 0;
        let mut limbs = [0u64; 8];
        for i in 0..8 {
            let v = t[i] + carry;
            limbs[i] = v as u64;
            carry = v >> 64;
        }
        // Any final carry is dropped (product fits in 512 bits for field elements < p)

        // Reassemble into four 128-bit words [r0, r1, r2, r3]
        let r0 = (limbs[0] as u128) | ((limbs[1] as u128) << 64);
        let r1 = (limbs[2] as u128) | ((limbs[3] as u128) << 64);
        let r2 = (limbs[4] as u128) | ((limbs[5] as u128) << 64);
        let r3 = (limbs[6] as u128) | ((limbs[7] as u128) << 64);

        // Now reduce r0 + r1*2^128 + r2*2^256 + r3*2^384  mod p
        // Using p = 2^252 + c  where c = 27742317777372353535851937790883648493
        // Barrett / Montgomery reduction is complex; we use repeated subtraction
        // since inputs are already < p, each ri is bounded:
        //   r0 < 2^128, r1 < 2^128, r2 < 2^128, r3 < 2^128
        // We fold upper limbs: 2^256 = (p - c)^2 / ... this is expensive.
        // Simpler: use the schoolbook chain — fold r3 first, then r2.
        //
        // 2^252 ≡ -c (mod p), so 2^256 = 2^4 * 2^252 ≡ -16c (mod p).
        // Similarly 2^384 = 2^128 * 2^256 ≡ -16c * 2^128 (mod p).
        //
        // Let c128 = 16 * c = 16 * FIELD_ORDER_LO  (as 128-bit).
        // Since FIELD_ORDER_LO < 2^124, 16*FIELD_ORDER_LO < 2^128 — fits in u128.

        let c_val: u128 = FIELD_ORDER_LO; // c = 27742317777372353535851937790883648493

        // Fold r3: r3 * 2^384 = r3 * 2^128 * (-16c) mod p
        // Contribution to [r0, r1, r2] limbs:
        // (-16c * r3) * 2^128  →  subtract 16*c*r3 shifted one 128-bit limb up
        let coeff3 = 16u128.wrapping_mul(c_val); // 16c
        let (prod3_lo, prod3_hi) = wide_mul_u128(coeff3, r3); // coeff3 * r3 → 256-bit
        // Subtract from (r1, r2) position:
        let (r1b, r2b, r2c) = {
            let (lo, b0) = r1.overflowing_sub(prod3_lo);
            let (hi, b1) = r2.overflowing_sub(prod3_hi);
            let (hi2, b2) = hi.overflowing_sub(b0 as u128);
            (lo, hi2, b1 || b2)
        };
        // r2c means we underflowed into r3 position; but since r3 was folded, we absorb.

        // Fold r2: r2 * 2^256 = r2 * (-16c) mod p
        // Contribution to r0: subtract 16c*r2_lo, to r1: subtract 16c*r2_hi
        let r2_eff = if r2c {
            // If subtraction underflowed, add p back to (r1b, r2b) and retry
            // For safety, treat underflow as modular wrap:
            let (lo, hi, _) = Fp::add256(r1b, r2b, FIELD_ORDER_LO, FIELD_ORDER_HI);
            // recompute: this is just the upper 256-bit portion
            let _ = lo;
            hi
        } else {
            r2b
        };

        let (prod2_lo, prod2_hi) = wide_mul_u128(16u128.wrapping_mul(c_val), r2_eff);
        let r1_eff = if r2c { r1b } else { r1b };

        // Now we have a 256-bit result: r0 + r1_eff * 2^128 - prod2_lo - prod2_hi*2^128
        // Simplified assembly:
        let (acc_lo, acc_hi) = {
            let (lo, c0) = r0.overflowing_sub(prod2_lo);
            let (hi, c1) = r1_eff.overflowing_sub(prod2_hi);
            let (hi2, _) = hi.overflowing_sub(c0 as u128);
            (lo, if c1 { hi2.wrapping_add(FIELD_ORDER_HI) } else { hi2 })
        };

        Fp { lo: acc_lo, hi: acc_hi }.reduce()
    }

    /// Modular exponentiation via square-and-multiply.
    pub fn pow(self, mut exp: Fp) -> Fp {
        let mut base = self;
        let mut result = Fp::ONE;
        // Iterate over bits of exp from LSB
        while !exp.is_zero() {
            if exp.lo & 1 == 1 {
                result = result.mul(base);
            }
            base = base.mul(base);
            // Right-shift exp by 1
            let carry = exp.hi & 1;
            exp.hi >>= 1;
            exp.lo = (exp.lo >> 1) | (carry << 127);
        }
        result
    }

    /// Modular inverse via Fermat's little theorem: a^(p-2) mod p.
    pub fn inv(self) -> Fp {
        // p - 2 = (FIELD_ORDER_HI, FIELD_ORDER_LO) - 2
        let (lo, borrow) = FIELD_ORDER_LO.overflowing_sub(2);
        let hi = FIELD_ORDER_HI - borrow as u128;
        self.pow(Fp { lo, hi })
    }

    /// Equality check (constant-time equivalent for field elements).
    #[inline]
    pub fn eq_ct(self, rhs: Fp) -> bool {
        self.lo == rhs.lo && self.hi == rhs.hi
    }
}

/// Compute the full 256-bit product of two 128-bit integers.
/// Returns (lo128, hi128) where result = hi128 * 2^128 + lo128.
///
/// Decomposes each 128-bit operand into two 64-bit halves:
///   a = a0 + a1*2^64,  b = b0 + b1*2^64
/// Then a*b = a0*b0 + (a0*b1 + a1*b0)*2^64 + a1*b1*2^128
/// Each product fits in 128 bits. The middle term may overflow 128 bits.
fn wide_mul_u128(a: u128, b: u128) -> (u128, u128) {
    let a0 = a as u64 as u128;
    let a1 = (a >> 64) as u64 as u128;
    let b0 = b as u64 as u128;
    let b1 = (b >> 64) as u64 as u128;

    let ll = a0 * b0;
    let lh = a0 * b1;
    let hl = a1 * b0;
    let hh = a1 * b1;

    // Middle term: lh + hl, may overflow 128 bits
    let (mid_lo, carry_mid) = lh.overflowing_add(hl);
    // carry_mid indicates overflow of 128-bit addition → bit 128 set
    let carry = carry_mid as u128;

    // Low 128 bits of result: ll + (mid_lo << 64) — may overflow
    let (lo, carry_lo) = ll.overflowing_add(mid_lo << 64);

    // High 128 bits: hh + (mid_lo >> 64) + carry + carry_lo
    let (hi, _) = hh.overflowing_add(mid_lo >> 64);
    let (hi, _) = hi.overflowing_add(carry);
    let (hi, _) = hi.overflowing_add(carry_lo as u128);

    (lo, hi)
}

#[cfg(test)]
mod field_tests {
    use super::*;

    #[test]
    fn test_zero_one() {
        assert_eq!(Fp::ZERO.add(Fp::ONE), Fp::ONE);
        assert_eq!(Fp::ONE.sub(Fp::ONE), Fp::ZERO);
        assert!(Fp::ZERO.is_zero());
        assert!(!Fp::ONE.is_zero());
    }

    #[test]
    fn test_add_sub_roundtrip() {
        let a = Fp::from_u64(12345);
        let b = Fp::from_u64(67890);
        let c = a.add(b);
        let d = c.sub(b);
        assert_eq!(d, a);
    }

    #[test]
    fn test_negation() {
        let a = Fp::from_u64(999);
        let neg_a = a.neg();
        assert_eq!(a.add(neg_a), Fp::ZERO);
    }

    #[test]
    fn test_mul_one() {
        let a = Fp::from_u64(0xdeadbeef);
        assert_eq!(a.mul(Fp::ONE), a);
    }

    #[test]
    fn test_from_bytes_roundtrip() {
        let a = Fp::from_u64(0xcafebabedeadbeef);
        let bytes = a.to_bytes_le();
        let b = Fp::from_bytes_le(&bytes);
        assert_eq!(a, b);
    }
}
