export interface Predictor {
  id: number;
  ticker: string;
  weight: number;
  rawPrices?: (number | null)[];
  returns?: (number | null)[];
  laggedReturns?: (number | null)[];
  normLagged?: number[];
  corr: string;
  cov: string;
}

export interface AppState {
  targetTicker: string;
  dates: string[];
  basePrice: (number | null)[];
  baseLogPrice: (number | null)[];
  baseReturns: (number | null)[];
  predictors: Predictor[];
  nextId: number;
  stationary: boolean;
  adfStat: number | null;
}
