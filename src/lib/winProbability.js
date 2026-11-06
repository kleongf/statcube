function erf(x) {
  const sign = x < 0 ? -1 : 1
  const ax = Math.abs(x)
  const t = 1 / (1 + 0.3275911 * ax)
  const poly =
    t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))))
  return sign * (1 - poly * Math.exp(-ax * ax))
}
function normalCDF(x) { return 0.5 * (1 + erf(x / Math.SQRT2)) }

export function calcRedWinProb(r1, r2, b1, b2, params) {
  const red = (r1 ?? 0) + (r2 ?? 0)
  const blue = (b1 ?? 0) + (b2 ?? 0)
  const redStd = params.a * Math.pow(Math.max(1, red), params.p)
  const blueStd = params.a * Math.pow(Math.max(1, blue), params.p)
  const z = (0 - (red - blue)) / Math.sqrt(redStd ** 2 + blueStd ** 2)
  return 1 - normalCDF(z)
}
