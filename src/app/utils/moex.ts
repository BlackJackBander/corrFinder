export interface MoexCandle {
  date: string;
  close: number | null;
  volume: number | null;
}

export async function fetchMoexChunk(ticker: string, start: string, end: string): Promise<MoexCandle[]> {
  const url = `https://iss.moex.com/iss/engines/stock/markets/shares/securities/${ticker}/candles.json?from=${start}&till=${end}&interval=24`;
  try {
    const r = await fetch(url);
    if (!r.ok) return [];
    const json = await r.json();
    const cols: string[] = json.candles.columns;
    const data: unknown[][] = json.candles.data;
    if (!data || data.length === 0) return [];

    const closeIdx = cols.indexOf('close');
    const volIdx = cols.indexOf('volume');
    const endIdx = cols.indexOf('end') >= 0 ? cols.indexOf('end') : cols.indexOf('begin');

    return data.map(row => ({
      date: (row[endIdx] as string).split(' ')[0],
      close: row[closeIdx] as number,
      volume: (row[volIdx] as number) > 0 ? (row[volIdx] as number) : null,
    }));
  } catch {
    return [];
  }
}

export function synchronizeByDate(
  baseDates: string[],
  predictorMaps: Map<string, MoexCandle>[]
): (number | null)[][] {
  return predictorMaps.map(map => {
    const arr: (number | null)[] = new Array(baseDates.length).fill(null);
    for (let i = 0; i < baseDates.length; i++) {
      const rec = map.get(baseDates[i]);
      arr[i] = rec ? rec.close : null;
    }
    return arr;
  });
}
