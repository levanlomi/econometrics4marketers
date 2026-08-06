/** Minimal matrix helpers for OLS (avoids shipping all of mathjs). */

export function transpose(A: number[][]): number[][] {
  const m = A.length
  const n = A[0]?.length ?? 0
  const T = Array.from({ length: n }, () => Array(m).fill(0))
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) T[j][i] = A[i][j]
  }
  return T
}

export function matMul(A: number[][], B: number[][]): number[][] {
  const m = A.length
  const n = B[0].length
  const p = B.length
  const C = Array.from({ length: m }, () => Array(n).fill(0))
  for (let i = 0; i < m; i++) {
    for (let k = 0; k < p; k++) {
      const aik = A[i][k]
      for (let j = 0; j < n; j++) C[i][j] += aik * B[k][j]
    }
  }
  return C
}

export function matVec(A: number[][], v: number[]): number[] {
  return A.map((row) => row.reduce((s, a, j) => s + a * v[j], 0))
}

/** Gauss–Jordan inverse. Returns null if singular. */
export function inv(A: number[][]): number[][] | null {
  const n = A.length
  const M = A.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))])

  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r
    }
    if (Math.abs(M[pivot][col]) < 1e-12) return null
    if (pivot !== col) {
      const tmp = M[col]
      M[col] = M[pivot]
      M[pivot] = tmp
    }
    const div = M[col][col]
    for (let j = 0; j < 2 * n; j++) M[col][j] /= div
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const factor = M[r][col]
      for (let j = 0; j < 2 * n; j++) M[r][j] -= factor * M[col][j]
    }
  }

  return M.map((row) => row.slice(n))
}
