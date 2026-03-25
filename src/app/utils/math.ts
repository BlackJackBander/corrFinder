export function logReturns(arr: (number | null)[]): (number | null)[] {
  const res: (number | null)[] = new Array(arr.length).fill(null);
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] !== null && arr[i - 1] !== null && (arr[i] as number) > 0 && (arr[i - 1] as number) > 0) {
      res[i] = Math.log((arr[i] as number) / (arr[i - 1] as number));
    }
  }
  return res;
}

export function lagArray(arr: (number | null)[], lag: number): (number | null)[] {
  const res: (number | null)[] = new Array(arr.length).fill(null);
  for (let i = lag; i < arr.length; i++) {
    res[i] = arr[i - lag];
  }
  return res;
}

export function elementwiseMedian(arrays: (number | null)[][]): (number | null)[] {
  if (!arrays || arrays.length === 0) return [];
  const n = arrays[0].length;
  const result: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const values: number[] = [];
    for (const arr of arrays) {
      if (arr[i] !== null && !isNaN(arr[i] as number)) values.push(arr[i] as number);
    }
    if (values.length > 0) {
      values.sort((a, b) => a - b);
      result[i] = values[Math.floor(values.length / 2)];
    } else {
      result[i] = null;
    }
  }
  return result;
}

export function adfTest(y: (number | null)[]): { stationary: boolean; adf: number } {
  const clean = y.filter((v): v is number => v !== null && !isNaN(v) && isFinite(v));
  if (clean.length < 20) return { stationary: false, adf: 0 };
  const n = clean.length;
  const dy: number[] = [];
  for (let i = 1; i < n; i++) dy.push(clean[i] - clean[i - 1]);
  const ylag = clean.slice(0, -1);
  const meanY = clean.reduce((a, b) => a + b, 0) / n;
  const meanDy = dy.reduce((a, b) => a + b, 0) / dy.length;
  let num = 0, den = 0;
  for (let i = 0; i < ylag.length; i++) {
    num += (ylag[i] - meanY) * (dy[i] - meanDy);
    den += (ylag[i] - meanY) ** 2;
  }
  const rho = den !== 0 ? num / den : 0;
  let se = 0;
  for (let i = 0; i < ylag.length; i++) {
    const resid = (dy[i] - meanDy) - rho * (ylag[i] - meanY);
    se += resid * resid;
  }
  se = Math.sqrt(se / (ylag.length - 1));
  const adfStat = se !== 0 ? (rho - 1) / se : 0;
  const stationary = adfStat < -2.89;
  return { stationary, adf: adfStat };
}

export function correlation(xarr: (number | null)[], yarr: (number | null)[]): number {
  const pairs: [number, number][] = [];
  for (let i = 0; i < Math.min(xarr.length, yarr.length); i++) {
    if (xarr[i] !== null && yarr[i] !== null && !isNaN(xarr[i] as number) && !isNaN(yarr[i] as number))
      pairs.push([xarr[i] as number, yarr[i] as number]);
  }
  if (pairs.length < 3) return 0;
  const len = pairs.length;
  const sumX = pairs.reduce((s, p) => s + p[0], 0);
  const sumY = pairs.reduce((s, p) => s + p[1], 0);
  const sumX2 = pairs.reduce((s, p) => s + p[0] * p[0], 0);
  const sumY2 = pairs.reduce((s, p) => s + p[1] * p[1], 0);
  const sumXY = pairs.reduce((s, p) => s + p[0] * p[1], 0);
  const num = sumXY - (sumX * sumY) / len;
  const den = Math.sqrt((sumX2 - sumX * sumX / len) * (sumY2 - sumY * sumY / len));
  return den === 0 ? 0 : num / den;
}

export function covariance(xarr: (number | null)[], yarr: (number | null)[]): number {
  const pairs: [number, number][] = [];
  for (let i = 0; i < Math.min(xarr.length, yarr.length); i++) {
    if (xarr[i] !== null && yarr[i] !== null && !isNaN(xarr[i] as number) && !isNaN(yarr[i] as number))
      pairs.push([xarr[i] as number, yarr[i] as number]);
  }
  if (pairs.length < 3) return 0;
  const len = pairs.length;
  const meanX = pairs.reduce((s, p) => s + p[0], 0) / len;
  const meanY = pairs.reduce((s, p) => s + p[1], 0) / len;
  let cov = 0;
  for (let i = 0; i < len; i++) cov += (pairs[i][0] - meanX) * (pairs[i][1] - meanY);
  return cov / (len - 1);
}

export function normalizeZ(arr: (number | null)[]): number[] {
  const valid = arr.filter((v): v is number => v !== null && !isNaN(v));
  if (valid.length === 0) return arr.map(() => 0);
  const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
  const std = Math.sqrt(valid.reduce((a, b) => a + (b - mean) ** 2, 0) / valid.length) || 1;
  return arr.map(v => (v !== null && !isNaN(v)) ? ((v as number) - mean) / std : 0);
}
