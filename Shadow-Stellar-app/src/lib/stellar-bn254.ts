import { weierstrass } from '@noble/curves/abstract/weierstrass';
import { Field, pow } from '@noble/curves/abstract/modular';
import { sha256 } from '@noble/hashes/sha256';
import { hmac } from '@noble/hashes/hmac';
import { concatBytes } from '@noble/hashes/utils';

// Stellar Soroban BN254 curve parameters (ark-bn254 compatible)
export const FIELD_ORDER  = 0x2523648240000001BA344D80000000086121000000000013A700000000000013n;
export const SCALAR_ORDER = 0x2523648240000001BA344D8000000007FF9F800000000010A10000000000000Dn;

// G = standard BN254 generator (1, 2)
// H = NUMS point (2, sqrt(11) mod p) — no known DL from G
const _H_Y = pow(11n, (FIELD_ORDER + 1n) / 4n, FIELD_ORDER);

const _curve = weierstrass({
  a: 0n, b: 3n,
  Fp: Field(FIELD_ORDER),
  n: SCALAR_ORDER,
  Gx: 1n, Gy: 2n, h: 1n,
  hash: sha256,
  hmac: (key: Uint8Array, ...msgs: Uint8Array[]) => hmac(sha256, key, concatBytes(...msgs)),
  lowS: false,
});

type Point = {
  multiply(s: bigint): Point;
  add(o: Point): Point;
  toAffine(): { x: bigint; y: bigint };
};

const G: Point = _curve.ProjectivePoint.BASE as unknown as Point;
const H: Point = _curve.ProjectivePoint.fromAffine({ x: 2n, y: _H_Y }) as unknown as Point;

/** Convert a hex string to a BN254 scalar (reduce mod SCALAR_ORDER). */
export function hexToScalar(hex: string): bigint {
  return BigInt('0x' + hex) % SCALAR_ORDER;
}

/** Extract the 32-byte big-endian x-coordinate from a BN254 G1 point. */
function pointToHex(p: Point): string {
  let x = p.toAffine().x;
  const b = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) { b[i] = Number(x & 0xffn); x >>= 8n; }
  return Array.from(b).map(v => v.toString(16).padStart(2, '0')).join('');
}

/** Pedersen commitment: C = amount * G + blinding * H  (32-byte x-coordinate hex) */
export function pedersenCommit(amount: bigint, blindingHex: string): string {
  return pointToHex(G.multiply(amount % SCALAR_ORDER).add(H.multiply(hexToScalar(blindingHex))));
}

/** Member commitment: C = secret * G  (32-byte x-coordinate hex) */
export function memberCommit(secretHex: string): string {
  return pointToHex(G.multiply(hexToScalar(secretHex)));
}
