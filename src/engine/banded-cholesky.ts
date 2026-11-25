/**
 * Banded Cholesky for symmetric positive definite matrices.
 *
 * Storage: the lower band, column by column: band[d * n + j] = A[j + d][j], d = 0..p
 * (d = 0 is the diagonal). Entries past the end of the matrix (j + d >= n) are unused.
 *
 * Factoring is O(n p^2) and each solve O(n p). There is no pivoting (an SPD matrix needs
 * none) and no iteration, so the result is fully deterministic.
 */
export interface BandedMatrix {
  /** Size of the (square) matrix. */
  n: number;
  /** Bandwidth: A[i][j] = 0 when |i - j| > p. */
  p: number;
  /** (p + 1) * n values: band[d * n + j] = A[j + d][j]. */
  band: Float64Array;
}

export function createBandedMatrix(n: number, p: number): BandedMatrix {
  return { n, p, band: new Float64Array((p + 1) * Math.max(0, n)) };
}

/**
 * Factor A = L Lᵀ in place: the band then holds L in the same layout
 * (band[d * n + j] = L[j + d][j]). Returns false (the band is then partly
 * overwritten) when A is not positive definite.
 */
export function bandedCholeskyFactor(m: BandedMatrix): boolean {
  const { n, p, band } = m;
  for (let j = 0; j < n; j++) {
    let s = band[j];
    const kmax = Math.min(p, j);
    for (let k = 1; k <= kmax; k++) {
      const v = band[k * n + j - k]; // L[j][j - k]
      s -= v * v;
    }
    if (!(s > 0)) return false;
    const diag = Math.sqrt(s);
    band[j] = diag;
    const dmax = Math.min(p, n - 1 - j);
    for (let d = 1; d <= dmax; d++) {
      let t = band[d * n + j]; // A[j + d][j]
      const km = Math.min(p - d, j);
      for (let k = 1; k <= km; k++) {
        t -= band[(d + k) * n + j - k] * band[k * n + j - k]; // L[j + d][j - k] * L[j][j - k]
      }
      band[d * n + j] = t / diag;
    }
  }
  return true;
}

/**
 * Solve L Lᵀ x = b with a matrix factored by bandedCholeskyFactor: forward
 * substitution (L y = b), then back substitution (Lᵀ x = y). b is overwritten with x,
 * and returned.
 */
export function bandedCholeskySolve(l: BandedMatrix, b: Float64Array): Float64Array {
  const { n, p, band } = l;
  for (let i = 0; i < n; i++) {
    let s = b[i];
    const kmax = Math.min(p, i);
    for (let k = 1; k <= kmax; k++) s -= band[k * n + i - k] * b[i - k]; // L[i][i - k] * y[i - k]
    b[i] = s / band[i];
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    const kmax = Math.min(p, n - 1 - i);
    for (let k = 1; k <= kmax; k++) s -= band[k * n + i] * b[i + k]; // L[i + k][i] * x[i + k]
    b[i] = s / band[i];
  }
  return b;
}
