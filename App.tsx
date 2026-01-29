
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { SYMBOLS_MAP, calculateEMA, calculateSingleEMA } from './utils';
import { PairStatus, AlertEvent, KlineData } from './types';
import { Bell, Activity, TrendingUp, TrendingDown, RefreshCw, Zap, BellOff, BellRing } from 'lucide-react';

const PAIRS = Object.keys(SYMBOLS_MAP);
const TIMEFRAME = '5m';
const BINANCE_FUTURES_WS = 'wss://fstream.binance.com/ws';
const BINANCE_FUTURES_API = 'https://fapi.binance.com/fapi/v1';

const App: React.FC = () => {
  const [pairsData, setPairsData] = useState<Record<string, PairStatus>>({});
  const [alerts, setAlerts] = useState<AlertEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'default'
  );
  const wsRef = useRef<WebSocket | null>(null);

  // Initialize data for each pair
  useEffect(() => {
    const initPairs = async () => {
      const initialData: Record<string, PairStatus> = {};
      
      for (const rawSymbol of PAIRS) {
        const symbol = SYMBOLS_MAP[rawSymbol];
        try {
          const response = await fetch(`${BINANCE_FUTURES_API}/klines?symbol=${symbol}&interval=${TIMEFRAME}&limit=150`);
          const data = await response.json();
          
          if (Array.isArray(data)) {
            const klines: KlineData[] = data.map((d: any) => ({
              time: d[0],
              open: parseFloat(d[1]),
              high: parseFloat(d[2]),
              low: parseFloat(d[3]),
              close: parseFloat(d[4]),
            }));

            const closes = klines.map(k => k.close);
            const ema20Arr = calculateEMA(closes, 20);
            const ema100Arr = calculateEMA(closes, 100);

            const lastClose = closes[closes.length - 1];
            const e20 = ema20Arr[ema20Arr.length - 1];
            const e100 = ema100Arr[ema100Arr.length - 1];

            initialData[symbol] = {
              symbol: rawSymbol,
              price: lastClose,
              ema20: e20,
              ema100: e100,
              lastTouch: null,
              isTouching: false,
              history: klines
            };
          }
        } catch (err) {
          console.error(`Error fetching ${symbol}:`, err);
        }
      }
      setPairsData(initialData);
      connectWebSocket();
    };

    initPairs();

    return () => {
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  const requestNotificationPermission = async () => {
    if (typeof Notification === 'undefined') return;
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
  };

  const connectWebSocket = () => {
    if (wsRef.current) wsRef.current.close();

    const streams = Object.values(SYMBOLS_MAP).map(s => `${s.toLowerCase()}@kline_${TIMEFRAME}`).join('/');
    const ws = new WebSocket(`${BINANCE_FUTURES_WS}/${streams}`);

    ws.onopen = () => {
      setIsConnected(true);
      console.log('Connected to Binance Futures WebSocket');
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.e === 'kline') {
        const { s: symbol, k } = msg;
        const close = parseFloat(k.c);
        const isFinal = k.x;

        setPairsData(prev => {
          const current = prev[symbol];
          if (!current) return prev;

          const prevEma20 = current.ema20!;
          const prevEma100 = current.ema100!;

          const newEma20 = calculateSingleEMA(close, prevEma20, 20);
          const newEma100 = calculateSingleEMA(close, prevEma100, 100);

          const diff = Math.abs(newEma20 - newEma100);
          const threshold = newEma100 * 0.00015; 
          const isTouching = diff <= threshold;

          const wasAbove = prevEma20 > prevEma100;
          const isAbove = newEma20 > newEma100;
          const crossed = wasAbove !== isAbove;

          if (crossed || isTouching) {
            const lastAlert = alerts[0];
            const isDuplicate = lastAlert && (lastAlert as AlertEvent).symbol === current.symbol && (Date.now() - (lastAlert as AlertEvent).timestamp < 300000);
            
            if (!isDuplicate) {
              if (crossed) {
                const type = isAbove ? 'bullish_cross' : 'bearish_cross';
                triggerAlert(current.symbol, close, type);
              } else if (isTouching) {
                triggerAlert(current.symbol, close, 'touch');
              }
            }
          }

          const newHistory = [...current.history];
          if (isFinal) {
            newHistory.push({
              time: k.t,
              open: parseFloat(k.o),
              high: parseFloat(k.h),
              low: parseFloat(k.l),
              close: close
            });
            if (newHistory.length > 200) newHistory.shift();
          }

          return {
            ...prev,
            [symbol]: {
              ...current,
              price: close,
              ema20: newEma20,
              ema100: newEma100,
              isTouching,
              history: newHistory
            }
          };
        });
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      setTimeout(connectWebSocket, 5000);
    };

    wsRef.current = ws;
  };

  const triggerAlert = (symbol: string, price: number, type: AlertEvent['type']) => {
    const rawSymbol = symbol.toUpperCase();
    const newAlert: AlertEvent = {
      id: Math.random().toString(36).substr(2, 9),
      symbol: rawSymbol,
      timestamp: Date.now(),
      price,
      type
    };
    setAlerts(prev => [newAlert, ...prev].slice(0, 50));
    
    // Notification text handling
    let title = "";
    let body = "";
    if (type === 'bullish_cross') {
      title = "Bullish Cross 🚀";
      body = `${rawSymbol} EMA 20 crossed ABOVE EMA 100 (Upwards) at $${price.toLocaleString()}`;
    } else if (type === 'bearish_cross') {
      title = "Bearish Cross 📉";
      body = `${rawSymbol} EMA 20 crossed BELOW EMA 100 (Downwards) at $${price.toLocaleString()}`;
    } else {
      title = "EMA Touch 🔔";
      body = `${rawSymbol} price touched the EMA lines at $${price.toLocaleString()}`;
    }

    // 1. Browser Push Notification
    if (notificationPermission === 'granted') {
      new Notification(title, {
        body,
        icon: 'https://cdn-icons-png.flaticon.com/512/25/25694.png'
      });
    }

    // 2. Sound Notification
    try {
      const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
      audio.volume = 0.4;
      audio.play().catch(() => {});
    } catch (e) {}
  };

  const sortedPairs = useMemo<PairStatus[]>(() => {
    return (Object.values(pairsData) as PairStatus[]).sort((a, b) => a.symbol.localeCompare(b.symbol));
  }, [pairsData]);

  const getAlertBadgeStyles = (type: AlertEvent['type']) => {
    switch (type) {
      case 'bullish_cross':
        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
      case 'bearish_cross':
        return 'bg-rose-500/10 text-rose-400 border-rose-500/20';
      case 'touch':
        return 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20';
      default:
        return 'bg-slate-500/10 text-slate-400 border-slate-500/20';
    }
  };

  const getAlertLabel = (type: AlertEvent['type']) => {
    switch (type) {
      case 'bullish_cross': return 'Bullish Cross (Up)';
      case 'bearish_cross': return 'Bearish Cross (Down)';
      case 'touch': return 'EMA Touch';
      default: return type;
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 p-4 md:p-8">
      {/* Header */}
      <header className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center mb-10 gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent flex items-center gap-2">
            <Zap className="text-yellow-400 fill-yellow-400" />
            EMA Crossing Bot
          </h1>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1">
            <p className="text-slate-500 text-sm flex items-center gap-2">
              Monitoring 11 pairs <span className="text-slate-300 font-mono">5m</span>
              <span className={`inline-block w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`}></span>
              {isConnected ? 'Live' : 'Offline'}
            </p>
            <div className="h-4 w-[1px] bg-slate-800 hidden md:block"></div>
            {notificationPermission === 'granted' ? (
              <span className="text-[10px] text-emerald-500 font-bold flex items-center gap-1">
                <BellRing size={12} /> ALERTS ENABLED
              </span>
            ) : notificationPermission === 'denied' ? (
              <span className="text-[10px] text-rose-500 font-bold flex items-center gap-1">
                <BellOff size={12} /> ALERTS BLOCKED
              </span>
            ) : (
              <button 
                onClick={requestNotificationPermission}
                className="text-[10px] bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 border border-blue-500/30 px-2 py-0.5 rounded transition-all font-bold flex items-center gap-1 animate-pulse"
              >
                <Bell size={12} /> ENABLE BROWSER ALERTS
              </button>
            )}
          </div>
        </div>
        
        <div className="flex gap-4 items-center">
          <div className="bg-slate-900/50 border border-slate-800 rounded-lg px-4 py-2 flex items-center gap-3">
             <Activity size={18} className="text-blue-400" />
             <div>
               <p className="text-[10px] uppercase text-slate-500 font-bold tracking-wider">Feed Status</p>
               <p className="text-xs font-mono text-slate-300">Synchronized</p>
             </div>
          </div>
          <button 
            onClick={() => window.location.reload()}
            className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors text-slate-400 hover:text-white"
          >
            <RefreshCw size={20} />
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {sortedPairs.length === 0 ? (
              Array(11).fill(0).map((_, i) => (
                <div key={i} className="h-40 bg-slate-900/50 border border-slate-800 rounded-xl animate-pulse" />
              ))
            ) : (
              sortedPairs.map((pair: PairStatus) => {
                const diff = pair.ema20 && pair.ema100 ? (pair.ema20 - pair.ema100) : 0;
                const isBullish = diff > 0;
                
                return (
                  <div 
                    key={pair.symbol}
                    className={`relative overflow-hidden bg-slate-900 border transition-all duration-300 rounded-xl p-5 ${
                      pair.isTouching 
                        ? 'border-yellow-500 shadow-[0_0_20px_rgba(234,179,8,0.2)] bg-slate-900/80 scale-[1.02]' 
                        : 'border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    {pair.isTouching && (
                      <div className="absolute top-0 right-0 p-2">
                        <span className="flex h-3 w-3">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-3 w-3 bg-yellow-500"></span>
                        </span>
                      </div>
                    )}

                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h3 className="text-lg font-bold text-white tracking-tight">{pair.symbol.toUpperCase()}</h3>
                        <p className="text-xs text-slate-500 font-mono">Binance Perpetuals</p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-mono font-bold text-blue-400">
                          {pair.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
                        </p>
                        <div className="flex items-center justify-end gap-1">
                           {isBullish ? <TrendingUp size={12} className="text-emerald-500" /> : <TrendingDown size={12} className="text-rose-500" />}
                           <span className={`text-[10px] font-bold ${isBullish ? 'text-emerald-500' : 'text-rose-500'}`}>
                             {isBullish ? 'BULLISH' : 'BEARISH'}
                           </span>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 mt-4">
                      <div className="bg-slate-950/50 rounded-lg p-2 border border-slate-800/50">
                        <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">EMA 20</p>
                        <p className="text-sm font-mono text-slate-300">
                          {pair.ema20?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
                        </p>
                      </div>
                      <div className="bg-slate-950/50 rounded-lg p-2 border border-slate-800/50">
                        <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">EMA 100</p>
                        <p className="text-sm font-mono text-slate-300">
                          {pair.ema100?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 pt-4 border-t border-slate-800 flex justify-between items-center">
                      <span className="text-[10px] text-slate-500 font-medium">Distance</span>
                      <span className={`text-xs font-mono font-bold ${pair.isTouching ? 'text-yellow-400' : 'text-slate-400'}`}>
                        {Math.abs(diff).toLocaleString(undefined, { maximumFractionDigits: 6 })}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="lg:col-span-1 flex flex-col gap-6">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl flex flex-col h-[calc(100vh-200px)] sticky top-8">
            <div className="p-5 border-b border-slate-800 flex items-center justify-between">
              <h2 className="font-bold flex items-center gap-2">
                <Bell size={18} className="text-yellow-400" />
                Live Alerts
              </h2>
              <span className="bg-slate-800 text-slate-400 px-2 py-0.5 rounded text-[10px] font-bold">
                {alerts.length}
              </span>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
              {alerts.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-slate-600 opacity-50">
                  <Activity size={48} className="mb-2" />
                  <p className="text-sm">Scanning for touches...</p>
                </div>
              ) : (
                alerts.map((alert: AlertEvent) => (
                  <div 
                    key={alert.id}
                    className="p-3 bg-slate-950 border border-slate-800 rounded-xl hover:border-blue-500/50 transition-colors group"
                  >
                    <div className="flex justify-between items-start mb-1">
                      <span className="text-white font-bold text-sm tracking-wide">{alert.symbol.toUpperCase()}</span>
                      <span className="text-[10px] text-slate-500 font-mono">
                        {new Date(alert.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase border ${getAlertBadgeStyles(alert.type)}`}>
                        {getAlertLabel(alert.type)}
                      </span>
                      <span className="text-xs text-slate-400">at </span>
                      <span className="text-xs font-mono font-bold text-slate-200">${alert.price}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </main>

      <footer className="max-w-7xl mx-auto mt-12 pb-8 border-t border-slate-900 pt-8 flex flex-col md:flex-row justify-between items-center text-slate-600 text-xs text-center md:text-left gap-4">
        <p>© 2024 EMA Bot Dashboard • Monitoring Live Binance Data</p>
        <div className="flex gap-6 mt-4 md:mt-0">
          <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-emerald-500"></div> System Stable</span>
          <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-blue-500"></div> API Connected</span>
        </div>
      </footer>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #1e293b;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #334155;
        }
      `}</style>
    </div>
  );
};

export default App;
