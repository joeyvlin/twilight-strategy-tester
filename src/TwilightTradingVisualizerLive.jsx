import React, { useState, useEffect, useRef, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, BarChart, Bar, Cell } from 'recharts';
import { ArrowUpRight, ArrowDownRight, DollarSign, TrendingUp, AlertCircle, Wifi, WifiOff, Activity, Settings, Info } from 'lucide-react';

const TwilightTradingVisualizerLive = () => {
  // ===================
  // CONFIGURATION
  // ===================
  const DEFAULT_TVL = 300; // $300 TVL for testing
  const BINANCE_TAKER_FEE = 0.0004; // 0.04% taker fee
  const BINANCE_MAKER_FEE = 0.0002; // 0.02% maker fee
  const TWILIGHT_FEE = 0; // 0% fee on Twilight
  const TWILIGHT_FUNDING_PSI = 1.0; // Sensitivity parameter for Twilight funding

  // ===================
  // STATE
  // ===================
  // Live price states
  const [twilightPrice, setTwilightPrice] = useState(84695);
  const [cexPrice, setCexPrice] = useState(84670);
  const [markPrice, setMarkPrice] = useState(84670);
  const [binanceFundingRate, setBinanceFundingRate] = useState(0.0001); // 0.01% default
  const [nextFundingTime, setNextFundingTime] = useState(null);

  // Connection states
  const [isSpotConnected, setIsSpotConnected] = useState(false);
  const [isFuturesConnected, setIsFuturesConnected] = useState(false);
  const [isMarkPriceConnected, setIsMarkPriceConnected] = useState(false);
  const [lastSpotUpdate, setLastSpotUpdate] = useState(null);
  const [lastFuturesUpdate, setLastFuturesUpdate] = useState(null);
  const [lastMarkPriceUpdate, setLastMarkPriceUpdate] = useState(null);

  // Pool state (for Twilight funding rate calculation)
  const [twilightLongSize, setTwilightLongSize] = useState(0);
  const [twilightShortSize, setTwilightShortSize] = useState(0);

  // Trading parameters
  const [tvl, setTvl] = useState(DEFAULT_TVL);
  const [useManualMode, setUseManualMode] = useState(false);
  const [selectedStrategy, setSelectedStrategy] = useState(null);

  // Price/funding history for charts
  const [priceHistory, setPriceHistory] = useState([]);
  const [fundingHistory, setFundingHistory] = useState([]);
  const maxHistoryLength = 50;

  // WebSocket refs
  const spotWsRef = useRef(null);
  const futuresWsRef = useRef(null);
  const markPriceWsRef = useRef(null);

  // ===================
  // WEBSOCKET CONNECTIONS
  // ===================

  // Connect to Binance Spot WebSocket (for Twilight pricing)
  useEffect(() => {
    if (useManualMode) return;

    const connectSpotWebSocket = () => {
      try {
        const spotWs = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@trade');

        spotWs.onopen = () => {
          console.log('Connected to Binance Spot WebSocket');
          setIsSpotConnected(true);
        };

        spotWs.onmessage = (event) => {
          const data = JSON.parse(event.data);
          const price = parseFloat(data.p);
          setTwilightPrice(Math.round(price));
          setLastSpotUpdate(new Date().toLocaleTimeString());
        };

        spotWs.onerror = () => setIsSpotConnected(false);
        spotWs.onclose = () => {
          setIsSpotConnected(false);
          setTimeout(connectSpotWebSocket, 3000);
        };

        spotWsRef.current = spotWs;
      } catch (error) {
        setIsSpotConnected(false);
      }
    };

    connectSpotWebSocket();
    return () => spotWsRef.current?.close();
  }, [useManualMode]);

  // Connect to Binance Futures WebSocket (for CEX pricing)
  useEffect(() => {
    if (useManualMode) return;

    const connectFuturesWebSocket = () => {
      try {
        const futuresWs = new WebSocket('wss://fstream.binance.com/ws/btcusdt@trade');

        futuresWs.onopen = () => {
          console.log('Connected to Binance Futures WebSocket');
          setIsFuturesConnected(true);
        };

        futuresWs.onmessage = (event) => {
          const data = JSON.parse(event.data);
          const price = parseFloat(data.p);
          setCexPrice(Math.round(price));
          setLastFuturesUpdate(new Date().toLocaleTimeString());
        };

        futuresWs.onerror = () => setIsFuturesConnected(false);
        futuresWs.onclose = () => {
          setIsFuturesConnected(false);
          setTimeout(connectFuturesWebSocket, 3000);
        };

        futuresWsRef.current = futuresWs;
      } catch (error) {
        setIsFuturesConnected(false);
      }
    };

    connectFuturesWebSocket();
    return () => futuresWsRef.current?.close();
  }, [useManualMode]);

  // Connect to Binance Mark Price WebSocket (for funding rate)
  useEffect(() => {
    if (useManualMode) return;

    const connectMarkPriceWebSocket = () => {
      try {
        // Mark price stream includes funding rate - updates every 3s
        const markPriceWs = new WebSocket('wss://fstream.binance.com/ws/btcusdt@markPrice');

        markPriceWs.onopen = () => {
          console.log('Connected to Binance Mark Price WebSocket');
          setIsMarkPriceConnected(true);
        };

        markPriceWs.onmessage = (event) => {
          const data = JSON.parse(event.data);
          // Mark price stream format:
          // { "e": "markPriceUpdate", "E": timestamp, "s": "BTCUSDT",
          //   "p": "mark price", "i": "index price", "P": "settlement price",
          //   "r": "funding rate", "T": "next funding time" }
          const newMarkPrice = parseFloat(data.p);
          const newFundingRate = parseFloat(data.r);
          const newNextFundingTime = parseInt(data.T);

          setMarkPrice(Math.round(newMarkPrice));
          setBinanceFundingRate(newFundingRate);
          setNextFundingTime(newNextFundingTime);
          setLastMarkPriceUpdate(new Date().toLocaleTimeString());
        };

        markPriceWs.onerror = () => setIsMarkPriceConnected(false);
        markPriceWs.onclose = () => {
          setIsMarkPriceConnected(false);
          setTimeout(connectMarkPriceWebSocket, 3000);
        };

        markPriceWsRef.current = markPriceWs;
      } catch (error) {
        setIsMarkPriceConnected(false);
      }
    };

    connectMarkPriceWebSocket();
    return () => markPriceWsRef.current?.close();
  }, [useManualMode]);

  // ===================
  // HISTORY TRACKING
  // ===================

  useEffect(() => {
    const spread = twilightPrice - cexPrice;
    const spreadPercent = ((spread / cexPrice) * 100);

    setPriceHistory(prev => {
      const newHistory = [...prev, {
        time: new Date().toLocaleTimeString(),
        twilight: twilightPrice,
        cex: cexPrice,
        spread: parseFloat(spreadPercent.toFixed(3))
      }];
      return newHistory.length > maxHistoryLength ? newHistory.slice(-maxHistoryLength) : newHistory;
    });
  }, [twilightPrice, cexPrice]);

  useEffect(() => {
    setFundingHistory(prev => {
      const newHistory = [...prev, {
        time: new Date().toLocaleTimeString(),
        binance: binanceFundingRate * 100, // Convert to percentage
        twilight: calculateTwilightFundingRate() * 100
      }];
      return newHistory.length > maxHistoryLength ? newHistory.slice(-maxHistoryLength) : newHistory;
    });
  }, [binanceFundingRate, twilightLongSize, twilightShortSize]);

  // ===================
  // CALCULATIONS
  // ===================

  const spread = twilightPrice - cexPrice;
  const spreadPercent = ((spread / cexPrice) * 100).toFixed(4);

  // Calculate Twilight funding rate based on pool imbalance
  // Formula: fundingrate = ((totallong - totalshort) / allpositionsize)² / (psi * 8.0)
  function calculateTwilightFundingRate() {
    const allPositionSize = twilightLongSize + twilightShortSize;
    if (allPositionSize === 0) return 0;

    const imbalance = (twilightLongSize - twilightShortSize) / allPositionSize;
    const fundingRate = Math.pow(imbalance, 2) / (TWILIGHT_FUNDING_PSI * 8.0);

    // Sign: positive = longs pay, negative = shorts pay
    return imbalance >= 0 ? fundingRate : -fundingRate;
  }

  const twilightFundingRate = calculateTwilightFundingRate();

  // Time until next Binance funding
  const getTimeUntilFunding = () => {
    if (!nextFundingTime) return 'N/A';
    const now = Date.now();
    const diff = nextFundingTime - now;
    if (diff <= 0) return 'Now';
    const hours = Math.floor(diff / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    return `${hours}h ${minutes}m`;
  };

  // ===================
  // STRATEGY GENERATION
  // ===================

  const generateStrategies = useMemo(() => {
    const strategies = [];
    const btcPrice = twilightPrice;
    const maxPositionUSD = tvl; // Max position value limited by TVL

    // Position sizes in USD (respecting TVL)
    const positionSizes = [50, 100, 150, 200, 250, 300].filter(s => s <= tvl);
    const leverages = [5, 10, 15, 20];

    let id = 1;

    // Helper to calculate APY
    const calculateStrategyAPY = (strategy) => {
      const {
        twilightPosition, twilightSize, twilightLeverage,
        binancePosition, binanceSize, binanceLeverage,
        holdingDays = 30
      } = strategy;

      // Calculate margins
      const twilightMargin = twilightSize / twilightLeverage;
      const binanceMargin = binanceSize / binanceLeverage;
      const totalMargin = twilightMargin + binanceMargin;

      if (totalMargin === 0) return { apy: 0, dailyPnL: 0, monthlyPnL: 0 };

      // Entry fees
      const twilightEntryFee = twilightSize * TWILIGHT_FEE;
      const binanceEntryFee = binanceSize * BINANCE_TAKER_FEE;
      const totalEntryFee = twilightEntryFee + binanceEntryFee;

      // Exit fees (assume same)
      const totalExitFee = totalEntryFee;
      const totalFees = totalEntryFee + totalExitFee;

      // Funding calculations (per 8 hours for Binance, hourly for Twilight)
      // Binance: 3x per day, Twilight: 24x per day
      const binanceFundingPerDay = binanceSize * binanceFundingRate * 3;
      const twilightFundingPerDay = twilightSize * Math.abs(twilightFundingRate) * 24;

      // Determine funding direction
      let dailyFundingPnL = 0;

      // Binance funding: positive rate = longs pay shorts
      if (binancePosition === 'LONG') {
        dailyFundingPnL -= binanceFundingPerDay; // Pay if long, rate positive
      } else if (binancePosition === 'SHORT') {
        dailyFundingPnL += binanceFundingPerDay; // Receive if short, rate positive
      }

      // Twilight funding: based on pool imbalance
      if (twilightPosition === 'LONG' && twilightFundingRate > 0) {
        dailyFundingPnL -= twilightFundingPerDay;
      } else if (twilightPosition === 'LONG' && twilightFundingRate < 0) {
        dailyFundingPnL += twilightFundingPerDay;
      } else if (twilightPosition === 'SHORT' && twilightFundingRate > 0) {
        dailyFundingPnL += twilightFundingPerDay;
      } else if (twilightPosition === 'SHORT' && twilightFundingRate < 0) {
        dailyFundingPnL -= twilightFundingPerDay;
      }

      // Basis profit (spread capture for hedged positions)
      let basisProfit = 0;
      if (twilightPosition && binancePosition && twilightPosition !== binancePosition) {
        // Delta-neutral: capture spread
        const spreadCapture = Math.abs(spread) * (Math.min(twilightSize, binanceSize) / btcPrice);
        basisProfit = spreadCapture;
      }

      // Total P&L
      const monthlyFundingPnL = dailyFundingPnL * 30;
      const monthlyPnL = basisProfit + monthlyFundingPnL - totalFees;
      const dailyPnL = monthlyPnL / 30;

      // APY calculation
      const monthlyROI = (monthlyPnL / totalMargin) * 100;
      const apy = monthlyROI * 12;

      return {
        apy: isNaN(apy) ? 0 : apy,
        dailyPnL: isNaN(dailyPnL) ? 0 : dailyPnL,
        monthlyPnL: isNaN(monthlyPnL) ? 0 : monthlyPnL,
        totalMargin,
        totalFees,
        basisProfit,
        monthlyFundingPnL
      };
    };

    // Strategy 1-4: Twilight Only (Long/Short at different leverages)
    for (const lev of [10, 20]) {
      const size = Math.min(150, tvl);

      strategies.push({
        id: id++,
        name: `Twilight Long ${lev}x`,
        description: `Long BTC on Twilight only. No hedge. Directional bet.`,
        category: 'Directional',
        twilightPosition: 'LONG',
        twilightSize: size,
        twilightLeverage: lev,
        binancePosition: null,
        binanceSize: 0,
        binanceLeverage: 0,
        risk: 'HIGH',
        ...calculateStrategyAPY({
          twilightPosition: 'LONG', twilightSize: size, twilightLeverage: lev,
          binancePosition: null, binanceSize: 0, binanceLeverage: 0
        })
      });

      strategies.push({
        id: id++,
        name: `Twilight Short ${lev}x`,
        description: `Short BTC on Twilight only. No hedge. Directional bet.`,
        category: 'Directional',
        twilightPosition: 'SHORT',
        twilightSize: size,
        twilightLeverage: lev,
        binancePosition: null,
        binanceSize: 0,
        binanceLeverage: 0,
        risk: 'HIGH',
        ...calculateStrategyAPY({
          twilightPosition: 'SHORT', twilightSize: size, twilightLeverage: lev,
          binancePosition: null, binanceSize: 0, binanceLeverage: 0
        })
      });
    }

    // Strategy 5-8: Binance Only (for comparison)
    for (const lev of [10, 20]) {
      const size = Math.min(150, tvl);

      strategies.push({
        id: id++,
        name: `Binance Long ${lev}x`,
        description: `Long BTC on Binance Futures. Subject to funding fees.`,
        category: 'CEX Only',
        twilightPosition: null,
        twilightSize: 0,
        twilightLeverage: 0,
        binancePosition: 'LONG',
        binanceSize: size,
        binanceLeverage: lev,
        risk: 'HIGH',
        ...calculateStrategyAPY({
          twilightPosition: null, twilightSize: 0, twilightLeverage: 0,
          binancePosition: 'LONG', binanceSize: size, binanceLeverage: lev
        })
      });

      strategies.push({
        id: id++,
        name: `Binance Short ${lev}x`,
        description: `Short BTC on Binance Futures. Collect funding if rate positive.`,
        category: 'CEX Only',
        twilightPosition: null,
        twilightSize: 0,
        twilightLeverage: 0,
        binancePosition: 'SHORT',
        binanceSize: size,
        binanceLeverage: lev,
        risk: 'HIGH',
        ...calculateStrategyAPY({
          twilightPosition: null, twilightSize: 0, twilightLeverage: 0,
          binancePosition: 'SHORT', binanceSize: size, binanceLeverage: lev
        })
      });
    }

    // Strategy 9-12: Delta-Neutral Hedged (Long Twilight / Short Binance)
    for (const size of [100, 150]) {
      if (size > tvl) continue;

      for (const lev of [10, 20]) {
        strategies.push({
          id: id++,
          name: `Hedge: Long Twi / Short Bin ${lev}x ($${size})`,
          description: `Delta-neutral: Long on Twilight (0 funding), Short on Binance (collect funding). Capture spread + funding arb.`,
          category: 'Delta-Neutral',
          twilightPosition: 'LONG',
          twilightSize: size,
          twilightLeverage: lev,
          binancePosition: 'SHORT',
          binanceSize: size,
          binanceLeverage: lev,
          risk: 'LOW',
          ...calculateStrategyAPY({
            twilightPosition: 'LONG', twilightSize: size, twilightLeverage: lev,
            binancePosition: 'SHORT', binanceSize: size, binanceLeverage: lev
          })
        });
      }
    }

    // Strategy 13-16: Delta-Neutral Hedged (Short Twilight / Long Binance)
    for (const size of [100, 150]) {
      if (size > tvl) continue;

      for (const lev of [10, 20]) {
        strategies.push({
          id: id++,
          name: `Hedge: Short Twi / Long Bin ${lev}x ($${size})`,
          description: `Delta-neutral: Short on Twilight, Long on Binance. Pay Binance funding but earn Twilight funding if shorts > longs.`,
          category: 'Delta-Neutral',
          twilightPosition: 'SHORT',
          twilightSize: size,
          twilightLeverage: lev,
          binancePosition: 'LONG',
          binanceSize: size,
          binanceLeverage: lev,
          risk: 'LOW',
          ...calculateStrategyAPY({
            twilightPosition: 'SHORT', twilightSize: size, twilightLeverage: lev,
            binancePosition: 'LONG', binanceSize: size, binanceLeverage: lev
          })
        });
      }
    }

    // Strategy 17-18: Funding Rate Arbitrage (max size)
    const maxSize = Math.min(tvl, 300);

    strategies.push({
      id: id++,
      name: `Max Funding Arb: Long Twi / Short Bin`,
      description: `Maximum capital deployment for funding arbitrage. Long Twilight (0 funding), Short Binance (collect ${(binanceFundingRate * 100).toFixed(4)}% per 8h).`,
      category: 'Funding Arb',
      twilightPosition: 'LONG',
      twilightSize: maxSize,
      twilightLeverage: 20,
      binancePosition: 'SHORT',
      binanceSize: maxSize,
      binanceLeverage: 20,
      risk: 'MEDIUM',
      ...calculateStrategyAPY({
        twilightPosition: 'LONG', twilightSize: maxSize, twilightLeverage: 20,
        binancePosition: 'SHORT', binanceSize: maxSize, binanceLeverage: 20
      })
    });

    strategies.push({
      id: id++,
      name: `Max Funding Arb: Short Twi / Long Bin`,
      description: `Reverse funding arb. Useful when Binance funding is negative (shorts pay longs).`,
      category: 'Funding Arb',
      twilightPosition: 'SHORT',
      twilightSize: maxSize,
      twilightLeverage: 20,
      binancePosition: 'LONG',
      binanceSize: maxSize,
      binanceLeverage: 20,
      risk: 'MEDIUM',
      ...calculateStrategyAPY({
        twilightPosition: 'SHORT', twilightSize: maxSize, twilightLeverage: 20,
        binancePosition: 'LONG', binanceSize: maxSize, binanceLeverage: 20
      })
    });

    // Strategy 19-20: Conservative Low Leverage
    strategies.push({
      id: id++,
      name: `Conservative Hedge 5x ($100)`,
      description: `Low leverage delta-neutral for safety. Long Twilight, Short Binance.`,
      category: 'Conservative',
      twilightPosition: 'LONG',
      twilightSize: 100,
      twilightLeverage: 5,
      binancePosition: 'SHORT',
      binanceSize: 100,
      binanceLeverage: 5,
      risk: 'VERY LOW',
      ...calculateStrategyAPY({
        twilightPosition: 'LONG', twilightSize: 100, twilightLeverage: 5,
        binancePosition: 'SHORT', binanceSize: 100, binanceLeverage: 5
      })
    });

    strategies.push({
      id: id++,
      name: `Conservative Hedge 5x ($50)`,
      description: `Minimal capital at risk. Test strategy for learning.`,
      category: 'Conservative',
      twilightPosition: 'LONG',
      twilightSize: 50,
      twilightLeverage: 5,
      binancePosition: 'SHORT',
      binanceSize: 50,
      binanceLeverage: 5,
      risk: 'VERY LOW',
      ...calculateStrategyAPY({
        twilightPosition: 'LONG', twilightSize: 50, twilightLeverage: 5,
        binancePosition: 'SHORT', binanceSize: 50, binanceLeverage: 5
      })
    });

    return strategies.sort((a, b) => b.apy - a.apy);
  }, [twilightPrice, cexPrice, spread, binanceFundingRate, twilightFundingRate, tvl]);

  // ===================
  // RENDER HELPERS
  // ===================

  const getRiskColor = (risk) => {
    switch (risk) {
      case 'VERY LOW': return 'bg-green-100 text-green-800';
      case 'LOW': return 'bg-blue-100 text-blue-800';
      case 'MEDIUM': return 'bg-yellow-100 text-yellow-800';
      case 'HIGH': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getAPYColor = (apy) => {
    if (apy > 100) return 'text-green-600';
    if (apy > 50) return 'text-blue-600';
    if (apy > 0) return 'text-gray-600';
    return 'text-red-600';
  };

  const getCategoryColor = (category) => {
    switch (category) {
      case 'Delta-Neutral': return 'bg-purple-100 text-purple-800';
      case 'Funding Arb': return 'bg-orange-100 text-orange-800';
      case 'Directional': return 'bg-red-100 text-red-800';
      case 'Conservative': return 'bg-green-100 text-green-800';
      case 'CEX Only': return 'bg-gray-100 text-gray-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  // ===================
  // RENDER
  // ===================

  return (
    <div className="w-full max-w-7xl mx-auto p-4 bg-gradient-to-br from-slate-50 to-slate-100 min-h-screen">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-800 mb-1">
              Twilight Strategy Tester
              {!useManualMode && <span className="text-red-500 animate-pulse ml-3 text-xl">LIVE</span>}
            </h1>
            <p className="text-slate-600 text-sm">TVL: ${tvl} | 20 Trading Strategies with Live APY</p>
          </div>

          {/* Connection Status */}
          <div className="bg-white rounded-lg p-3 shadow flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1">
              {isSpotConnected ? <Wifi className="w-4 h-4 text-green-500" /> : <WifiOff className="w-4 h-4 text-red-500" />}
              <span className="text-xs">Spot</span>
            </div>
            <div className="flex items-center gap-1">
              {isFuturesConnected ? <Wifi className="w-4 h-4 text-green-500" /> : <WifiOff className="w-4 h-4 text-red-500" />}
              <span className="text-xs">Futures</span>
            </div>
            <div className="flex items-center gap-1">
              {isMarkPriceConnected ? <Wifi className="w-4 h-4 text-green-500" /> : <WifiOff className="w-4 h-4 text-red-500" />}
              <span className="text-xs">Funding</span>
            </div>
            <button
              onClick={() => setUseManualMode(!useManualMode)}
              className={`px-2 py-1 rounded text-xs font-semibold ${
                useManualMode ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'
              }`}
            >
              {useManualMode ? 'Manual' : 'Live'}
            </button>
          </div>
        </div>
      </div>

      {/* Market Data Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-white rounded-lg p-3 shadow">
          <div className="text-xs text-slate-500">Twilight (Spot)</div>
          <div className="text-xl font-bold text-blue-600">${twilightPrice.toLocaleString()}</div>
          <div className="text-xs text-slate-400">{lastSpotUpdate || 'Connecting...'}</div>
        </div>

        <div className="bg-white rounded-lg p-3 shadow">
          <div className="text-xs text-slate-500">Binance Perp</div>
          <div className="text-xl font-bold text-purple-600">${cexPrice.toLocaleString()}</div>
          <div className="text-xs text-slate-400">{lastFuturesUpdate || 'Connecting...'}</div>
        </div>

        <div className="bg-white rounded-lg p-3 shadow">
          <div className="text-xs text-slate-500">Spread</div>
          <div className={`text-xl font-bold ${spread >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {spread >= 0 ? '+' : ''}{spreadPercent}%
          </div>
          <div className="text-xs text-slate-400">${spread.toFixed(2)}</div>
        </div>

        <div className="bg-white rounded-lg p-3 shadow">
          <div className="text-xs text-slate-500">Binance Funding (8h)</div>
          <div className={`text-xl font-bold ${binanceFundingRate >= 0 ? 'text-orange-600' : 'text-blue-600'}`}>
            {binanceFundingRate >= 0 ? '+' : ''}{(binanceFundingRate * 100).toFixed(4)}%
          </div>
          <div className="text-xs text-slate-400">Next: {getTimeUntilFunding()}</div>
        </div>
      </div>

      {/* TVL and Pool State Settings */}
      <div className="bg-white rounded-lg p-4 shadow mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Settings className="w-5 h-5 text-slate-600" />
          <h3 className="font-bold text-slate-800">Test Parameters</h3>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs text-slate-600 mb-1">TVL ($)</label>
            <input
              type="number"
              value={tvl}
              onChange={(e) => setTvl(Number(e.target.value))}
              className="w-full px-2 py-1 border rounded text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-600 mb-1">Pool Long Size ($)</label>
            <input
              type="number"
              value={twilightLongSize}
              onChange={(e) => setTwilightLongSize(Number(e.target.value))}
              className="w-full px-2 py-1 border rounded text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-600 mb-1">Pool Short Size ($)</label>
            <input
              type="number"
              value={twilightShortSize}
              onChange={(e) => setTwilightShortSize(Number(e.target.value))}
              className="w-full px-2 py-1 border rounded text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-600 mb-1">Twilight Funding Rate</label>
            <div className={`px-2 py-1 rounded text-sm font-mono ${twilightFundingRate >= 0 ? 'bg-orange-50 text-orange-700' : 'bg-blue-50 text-blue-700'}`}>
              {twilightFundingRate >= 0 ? '+' : ''}{(twilightFundingRate * 100).toFixed(6)}%/hr
            </div>
          </div>
        </div>
        {useManualMode && (
          <div className="grid grid-cols-2 gap-4 mt-4 pt-4 border-t">
            <div>
              <label className="block text-xs text-slate-600 mb-1">Manual Spot Price</label>
              <input
                type="number"
                value={twilightPrice}
                onChange={(e) => setTwilightPrice(Number(e.target.value))}
                className="w-full px-2 py-1 border rounded text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-600 mb-1">Manual Futures Price</label>
              <input
                type="number"
                value={cexPrice}
                onChange={(e) => setCexPrice(Number(e.target.value))}
                className="w-full px-2 py-1 border rounded text-sm"
              />
            </div>
          </div>
        )}
      </div>

      {/* Funding Rate Chart */}
      {fundingHistory.length > 3 && (
        <div className="bg-white rounded-lg p-4 shadow mb-6">
          <h3 className="font-bold text-slate-800 mb-2 flex items-center gap-2">
            <Activity className="w-5 h-5 text-blue-600" />
            Funding Rate Comparison
          </h3>
          <ResponsiveContainer width="100%" height={120}>
            <LineChart data={fundingHistory}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="time" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${v.toFixed(3)}%`} />
              <Tooltip formatter={(v) => `${v.toFixed(4)}%`} />
              <Line type="monotone" dataKey="binance" stroke="#f97316" strokeWidth={2} dot={false} name="Binance" />
              <Line type="monotone" dataKey="twilight" stroke="#3b82f6" strokeWidth={2} dot={false} name="Twilight" />
              <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="3 3" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Strategy APY Chart */}
      <div className="bg-white rounded-lg p-4 shadow mb-6">
        <h3 className="font-bold text-slate-800 mb-2 flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-green-600" />
          Strategy APY Comparison
        </h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={generateStrategies.slice(0, 10)} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis type="number" tickFormatter={(v) => `${v.toFixed(0)}%`} />
            <YAxis type="category" dataKey="name" width={200} tick={{ fontSize: 10 }} />
            <Tooltip formatter={(v) => `${v.toFixed(2)}%`} />
            <Bar dataKey="apy" name="APY">
              {generateStrategies.slice(0, 10).map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.apy > 0 ? '#22c55e' : '#ef4444'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* All 20 Strategies Table */}
      <div className="bg-white rounded-lg p-4 shadow mb-6">
        <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
          <DollarSign className="w-5 h-5 text-green-600" />
          All 20 Trading Strategies (Sorted by APY)
        </h3>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-slate-50">
                <th className="text-left p-2">#</th>
                <th className="text-left p-2">Strategy</th>
                <th className="text-left p-2">Category</th>
                <th className="text-left p-2">Risk</th>
                <th className="text-right p-2">Margin</th>
                <th className="text-right p-2">Monthly P&L</th>
                <th className="text-right p-2 font-bold">APY</th>
                <th className="text-center p-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {generateStrategies.map((strategy, idx) => (
                <tr
                  key={strategy.id}
                  className={`border-b hover:bg-slate-50 cursor-pointer ${selectedStrategy?.id === strategy.id ? 'bg-blue-50' : ''}`}
                  onClick={() => setSelectedStrategy(strategy)}
                >
                  <td className="p-2 text-slate-400">{idx + 1}</td>
                  <td className="p-2">
                    <div className="font-medium text-slate-800">{strategy.name}</div>
                    <div className="text-xs text-slate-500 max-w-xs truncate">{strategy.description}</div>
                  </td>
                  <td className="p-2">
                    <span className={`px-2 py-0.5 rounded text-xs ${getCategoryColor(strategy.category)}`}>
                      {strategy.category}
                    </span>
                  </td>
                  <td className="p-2">
                    <span className={`px-2 py-0.5 rounded text-xs ${getRiskColor(strategy.risk)}`}>
                      {strategy.risk}
                    </span>
                  </td>
                  <td className="p-2 text-right font-mono">${strategy.totalMargin.toFixed(2)}</td>
                  <td className={`p-2 text-right font-mono ${strategy.monthlyPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {strategy.monthlyPnL >= 0 ? '+' : ''}${strategy.monthlyPnL.toFixed(2)}
                  </td>
                  <td className={`p-2 text-right font-bold font-mono ${getAPYColor(strategy.apy)}`}>
                    {strategy.apy >= 0 ? '+' : ''}{strategy.apy.toFixed(1)}%
                  </td>
                  <td className="p-2 text-center">
                    <button
                      className="px-2 py-1 bg-blue-500 text-white rounded text-xs hover:bg-blue-600"
                      onClick={(e) => { e.stopPropagation(); setSelectedStrategy(strategy); }}
                    >
                      Details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Selected Strategy Details */}
      {selectedStrategy && (
        <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg p-4 shadow mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-slate-800 flex items-center gap-2">
              <Info className="w-5 h-5 text-blue-600" />
              Strategy Details: {selectedStrategy.name}
            </h3>
            <button
              onClick={() => setSelectedStrategy(null)}
              className="text-slate-400 hover:text-slate-600"
            >
              Close
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Twilight Position */}
            <div className="bg-white rounded-lg p-4 shadow">
              <h4 className="font-bold text-blue-700 mb-3">Twilight Position</h4>
              {selectedStrategy.twilightPosition ? (
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-600">Direction:</span>
                    <span className={`font-semibold ${selectedStrategy.twilightPosition === 'LONG' ? 'text-green-600' : 'text-red-600'}`}>
                      {selectedStrategy.twilightPosition === 'LONG' ? <ArrowUpRight className="w-4 h-4 inline" /> : <ArrowDownRight className="w-4 h-4 inline" />}
                      {selectedStrategy.twilightPosition}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Size:</span>
                    <span className="font-mono">${selectedStrategy.twilightSize}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Leverage:</span>
                    <span className="font-mono">{selectedStrategy.twilightLeverage}x</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Margin:</span>
                    <span className="font-mono">${(selectedStrategy.twilightSize / selectedStrategy.twilightLeverage).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Trading Fee:</span>
                    <span className="font-mono text-green-600">$0.00 (0%)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Funding Rate:</span>
                    <span className="font-mono">{(twilightFundingRate * 100).toFixed(4)}%/hr</span>
                  </div>
                </div>
              ) : (
                <div className="text-slate-400 italic">No Twilight position</div>
              )}
            </div>

            {/* Binance Position */}
            <div className="bg-white rounded-lg p-4 shadow">
              <h4 className="font-bold text-purple-700 mb-3">Binance Position</h4>
              {selectedStrategy.binancePosition ? (
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-600">Direction:</span>
                    <span className={`font-semibold ${selectedStrategy.binancePosition === 'LONG' ? 'text-green-600' : 'text-red-600'}`}>
                      {selectedStrategy.binancePosition === 'LONG' ? <ArrowUpRight className="w-4 h-4 inline" /> : <ArrowDownRight className="w-4 h-4 inline" />}
                      {selectedStrategy.binancePosition}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Size:</span>
                    <span className="font-mono">${selectedStrategy.binanceSize}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Leverage:</span>
                    <span className="font-mono">{selectedStrategy.binanceLeverage}x</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Margin:</span>
                    <span className="font-mono">${(selectedStrategy.binanceSize / selectedStrategy.binanceLeverage).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Trading Fee:</span>
                    <span className="font-mono text-orange-600">${(selectedStrategy.binanceSize * BINANCE_TAKER_FEE * 2).toFixed(2)} ({(BINANCE_TAKER_FEE * 100).toFixed(2)}% x2)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Funding Rate:</span>
                    <span className="font-mono">{(binanceFundingRate * 100).toFixed(4)}%/8h</span>
                  </div>
                </div>
              ) : (
                <div className="text-slate-400 italic">No Binance position</div>
              )}
            </div>
          </div>

          {/* P&L Breakdown */}
          <div className="mt-4 bg-white rounded-lg p-4 shadow">
            <h4 className="font-bold text-slate-700 mb-3">Projected P&L Breakdown (Monthly)</h4>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
              <div className="border-l-4 border-slate-300 pl-3">
                <div className="text-slate-500">Total Margin</div>
                <div className="font-bold text-slate-800">${selectedStrategy.totalMargin.toFixed(2)}</div>
              </div>
              <div className="border-l-4 border-blue-300 pl-3">
                <div className="text-slate-500">Basis Capture</div>
                <div className="font-bold text-blue-600">${selectedStrategy.basisProfit.toFixed(2)}</div>
              </div>
              <div className="border-l-4 border-orange-300 pl-3">
                <div className="text-slate-500">Funding P&L</div>
                <div className={`font-bold ${selectedStrategy.monthlyFundingPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {selectedStrategy.monthlyFundingPnL >= 0 ? '+' : ''}${selectedStrategy.monthlyFundingPnL.toFixed(2)}
                </div>
              </div>
              <div className="border-l-4 border-red-300 pl-3">
                <div className="text-slate-500">Total Fees</div>
                <div className="font-bold text-red-600">-${selectedStrategy.totalFees.toFixed(2)}</div>
              </div>
              <div className="border-l-4 border-green-500 pl-3">
                <div className="text-slate-500">Net Monthly</div>
                <div className={`font-bold text-lg ${selectedStrategy.monthlyPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {selectedStrategy.monthlyPnL >= 0 ? '+' : ''}${selectedStrategy.monthlyPnL.toFixed(2)}
                </div>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t flex justify-between items-center">
              <span className="text-slate-600">Projected Annual Percentage Yield (APY):</span>
              <span className={`text-3xl font-bold ${getAPYColor(selectedStrategy.apy)}`}>
                {selectedStrategy.apy >= 0 ? '+' : ''}{selectedStrategy.apy.toFixed(2)}%
              </span>
            </div>
          </div>

          {/* Execution Guide */}
          <div className="mt-4 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <h4 className="font-bold text-yellow-800 mb-2 flex items-center gap-2">
              <AlertCircle className="w-4 h-4" />
              Execution Steps
            </h4>
            <ol className="text-sm text-yellow-900 space-y-1 list-decimal list-inside">
              {selectedStrategy.twilightPosition && (
                <li>Open {selectedStrategy.twilightPosition} position on Twilight: ${selectedStrategy.twilightSize} at {selectedStrategy.twilightLeverage}x leverage</li>
              )}
              {selectedStrategy.binancePosition && (
                <li>Open {selectedStrategy.binancePosition} position on Binance Futures: ${selectedStrategy.binanceSize} at {selectedStrategy.binanceLeverage}x leverage</li>
              )}
              <li>Monitor funding rates and adjust if needed</li>
              <li>Close both positions simultaneously when taking profit</li>
            </ol>
          </div>
        </div>
      )}

      {/* Fee Comparison */}
      <div className="bg-white rounded-lg p-4 shadow">
        <h3 className="font-bold text-slate-800 mb-3">Fee Structure</h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="bg-green-50 rounded-lg p-3">
            <div className="font-bold text-green-800">Twilight</div>
            <div className="text-green-700">Trading Fee: 0%</div>
            <div className="text-green-700">Funding: Hourly, imbalance-based</div>
          </div>
          <div className="bg-orange-50 rounded-lg p-3">
            <div className="font-bold text-orange-800">Binance</div>
            <div className="text-orange-700">Taker Fee: 0.04%</div>
            <div className="text-orange-700">Maker Fee: 0.02%</div>
            <div className="text-orange-700">Funding: Every 8 hours</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TwilightTradingVisualizerLive;
