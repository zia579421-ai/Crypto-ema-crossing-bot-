
import { KlineData } from './types';

/**
 * Calculates EMA for a series of values.
 * Formula: EMA = (Close - EMA_prev) * (2 / (n + 1)) + EMA_prev
 */
export function calculateEMA(data: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const ema: number[] = [];
  
  // Initial EMA: simple average of first 'period' elements
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += data[i];
  }
  let prevEma = sum / period;
  ema[period - 1] = prevEma;

  for (let i = period; i < data.length; i++) {
    const currentEma = (data[i] - prevEma) * k + prevEma;
    ema[i] = currentEma;
    prevEma = currentEma;
  }

  return ema;
}

export function calculateSingleEMA(currentPrice: number, prevEma: number, period: number): number {
  const k = 2 / (period + 1);
  return (currentPrice - prevEma) * k + prevEma;
}

export const SYMBOLS_MAP: Record<string, string> = {
  "icpusdt.p": "ICPUSDT",
  "btcusdt.p": "BTCUSDT",
  "beatusdt.p": "BEAMXUSDT", // Assuming BEAMX for 'beat' typo
  "ethusdt.p": "ETHUSDT",
  "zecusdt.p": "ZECUSDT",
  "strkusdt.p": "STRKUSDT",
  "hypeusdt.p": "HYPEUSDT",
  "taousdt.p": "TAOUSDT",
  "aaveusdt.p": "AAVEUSDT",
  "solusdt.p": "SOLUSDT",
  "asterusdt.p": "ASTRUSDT" // ASTR is the ticker for Astar
};
