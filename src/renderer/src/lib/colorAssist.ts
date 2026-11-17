// Colour-blindness correction (daltonization) for the stream picture. Colours a
// viewer cannot tell apart are simulated (Machado, Oliveira and Fernandes 2009,
// full severity), and what is lost is moved into channels they do see (Fidaner,
// Lin and Ozguven). The result is one 3x3 matrix, applied as an SVG colour
// matrix, which works in linear light like the models expect.

export type ColorAssist = 'off' | 'protan' | 'deutan' | 'tritan'

type Matrix = number[] // 3x3, row-major

const SIMULATE: Record<Exclude<ColorAssist, 'off'>, Matrix> = {
  protan: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deutan: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  tritan: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
}

// Where the lost difference goes: red-green losses into green and blue, blue-yellow ones into red and green.
const SHIFT: Record<Exclude<ColorAssist, 'off'>, Matrix> = {
  protan: [0, 0, 0, 0.7, 1, 0, 0.7, 0, 1],
  deutan: [0, 0, 0, 0.7, 1, 0, 0.7, 0, 1],
  tritan: [1, 0, 0.7, 0, 1, 0.7, 0, 0, 0],
}

const IDENTITY: Matrix = [1, 0, 0, 0, 1, 0, 0, 0, 1]

function multiply(a: Matrix, b: Matrix): Matrix {
  const out: Matrix = []
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out.push(a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c])
  return out
}

/** I + E (I - S): the correction as one matrix. */
export function assistMatrix(kind: Exclude<ColorAssist, 'off'>): Matrix {
  const lost = IDENTITY.map((v, i) => v - SIMULATE[kind][i])
  const shifted = multiply(SHIFT[kind], lost)
  return IDENTITY.map((v, i) => v + shifted[i])
}

/** The matrix in feColorMatrix's 4x5 form. */
export function svgMatrix(kind: Exclude<ColorAssist, 'off'>) {
  const m = assistMatrix(kind)
  return [0, 1, 2].map((r) => `${m[r * 3].toFixed(5)} ${m[r * 3 + 1].toFixed(5)} ${m[r * 3 + 2].toFixed(5)} 0 0`).join(' ') + ' 0 0 0 1 0'
}
