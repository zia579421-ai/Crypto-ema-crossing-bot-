
export interface KlineData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface PairStatus {
  symbol: string;
  price: number;
  ema20: number | null;
  ema100: number | null;
  lastTouch: number | null;
  isTouching: boolean;
  history: KlineData[];
}

export interface AlertEvent {
  id: string;
  symbol: string;
  timestamp: number;
  price: number;
  type: 'bullish_cross' | 'bearish_cross' | 'touch';
}
