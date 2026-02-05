import React, { useState, useEffect, useRef, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, BarChart, Bar, Cell } from 'recharts';
import { ArrowUpRight, ArrowDownRight, DollarSign, TrendingUp, AlertCircle, Wifi, WifiOff, Activity, Settings, Info, ArrowLeft } from 'lucide-react';

const CEXComparisonPage = ({ onNavigateToTwilight }) => {
  // ===================
  // CONFIGURATION
  // ===================
  const DEFAULT_TVL = 300; // $300 TVL for testing
  const BINANCE_TAKER_FEE = 0.001; // 0.1% spot taker fee
  const BINANCE_MAKER_FEE = 0.001; // 0.1% spot maker fee
  const BINANCE_FUTURES_TAKER_FEE = 0.0004; // 0.04% futures taker fee
  const BINANCE_MARGIN_INTEREST_DAILY = 0.0003; // ~0.03% daily (~10.95% APR) for BTC
  const BINANCE_USDT_INTEREST_DAILY = 0.0005; // ~0.05% daily (~18.25% APR) for USDT

  // ===================
  // STATE
  // ===================
  const [spotPrice, setSpotPrice] = useState(84695);
  const [futuresPrice, setFuturesPrice] = useState(84670);
  const [binanceFundingRate, setBinanceFundingRate] = useState(0.0001);
  const [nextFundingTime, setNextFundingTime] = useState(null);

  // Connection states
  const [isSpotConnected, setIsSpotConnected] = useState(false);
  const [isFuturesConnected, setIsFuturesConnected] = useState(false);
  const [lastSpotUpdate, setLastSpotUpdate] = useState(null);
  const [lastFuturesUpdate, setLastFuturesUpdate] = useState(null);

  // Trading parameters
  const [tvl, setTvl] = useState(DEFAULT_TVL);
  const [useManualMode, setUseManualMode] = useState(false);
  const [selectedStrategy, setSelectedStrategy] = useState(null);

  // Custom interest rates (user adjustable)
  const [btcInterestRate, setBtcInterestRate] = useState(BINANCE_MARGIN_INTEREST_DAILY * 100);
  const [usdtInterestRate, setUsdtInterestRate] = useState(BINANCE_USDT_INTEREST_DAILY * 100);

  // WebSocket refs
  const spotWsRef = useRef(null);
  const futuresWsRef = useRef(null);
  const markPriceWsRef = useRef(null);
  const spotReconnectRef = useRef(null);
  const spotCancelledRef = useRef(false);
  const futuresReconnectRef = useRef(null);
  const futuresCancelledRef = useRef(false);
  const markPriceReconnectRef = useRef(null);
  const markPriceCancelledRef = useRef(false);

  // ===================
  // WEBSOCKET CONNECTIONS
  // ===================

  useEffect(() => {
    if (useManualMode) return;
    spotCancelledRef.current = false;

    const connectSpotWebSocket = () => {
      if (spotCancelledRef.current) return;
      try {
        const spotWs = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@trade');

        spotWs.onopen = () => {
          if (spotCancelledRef.current) return;
          setIsSpotConnected(true);
        };

        spotWs.onmessage = (event) => {
          if (spotCancelledRef.current) return;
          const data = JSON.parse(event.data);
          const price = parseFloat(data.p);
          setSpotPrice(Math.round(price));
          setLastSpotUpdate(new Date().toLocaleTimeString());
        };

        spotWs.onerror = () => { if (!spotCancelledRef.current) setIsSpotConnected(false); };
        spotWs.onclose = () => {
          if (spotCancelledRef.current) return;
          setIsSpotConnected(false);
          spotReconnectRef.current = setTimeout(connectSpotWebSocket, 3000);
        };

        spotWsRef.current = spotWs;
      } catch (error) {
        if (!spotCancelledRef.current) setIsSpotConnected(false);
      }
    };

    connectSpotWebSocket();
    return () => {
      spotCancelledRef.current = true;
      if (spotReconnectRef.current) clearTimeout(spotReconnectRef.current);
      spotReconnectRef.current = null;
      spotWsRef.current?.close();
      spotWsRef.current = null;
    };
  }, [useManualMode]);

  useEffect(() => {
    if (useManualMode) return;
    futuresCancelledRef.current = false;

    const connectFuturesWebSocket = () => {
      if (futuresCancelledRef.current) return;
      try {
        const futuresWs = new WebSocket('wss://fstream.binance.com/ws/btcusdt@trade');

        futuresWs.onopen = () => {
          if (futuresCancelledRef.current) return;
          setIsFuturesConnected(true);
        };

        futuresWs.onmessage = (event) => {
          if (futuresCancelledRef.current) return;
          const data = JSON.parse(event.data);
          const price = parseFloat(data.p);
          setFuturesPrice(Math.round(price));
          setLastFuturesUpdate(new Date().toLocaleTimeString());
        };

        futuresWs.onerror = () => { if (!futuresCancelledRef.current) setIsFuturesConnected(false); };
        futuresWs.onclose = () => {
          if (futuresCancelledRef.current) return;
          setIsFuturesConnected(false);
          futuresReconnectRef.current = setTimeout(connectFuturesWebSocket, 3000);
        };

        futuresWsRef.current = futuresWs;
      } catch (error) {
        if (!futuresCancelledRef.current) setIsFuturesConnected(false);
      }
    };

    connectFuturesWebSocket();
    return () => {
      futuresCancelledRef.current = true;
      if (futuresReconnectRef.current) clearTimeout(futuresReconnectRef.current);
      futuresReconnectRef.current = null;
      futuresWsRef.current?.close();
      futuresWsRef.current = null;
    };
  }, [useManualMode]);

  useEffect(() => {
    if (useManualMode) return;
    markPriceCancelledRef.current = false;

    const connectMarkPriceWebSocket = () => {
      if (markPriceCancelledRef.current) return;
      try {
        const markPriceWs = new WebSocket('wss://fstream.binance.com/ws/btcusdt@markPrice');

        markPriceWs.onopen = () => {};

        markPriceWs.onmessage = (event) => {
          if (markPriceCancelledRef.current) return;
          const data = JSON.parse(event.data);
          const newFundingRate = parseFloat(data.r);
          const newNextFundingTime = parseInt(data.T);
          setBinanceFundingRate(newFundingRate);
          setNextFundingTime(newNextFundingTime);
        };

        markPriceWs.onerror = () => {};
        markPriceWs.onclose = () => {
          if (markPriceCancelledRef.current) return;
          markPriceReconnectRef.current = setTimeout(connectMarkPriceWebSocket, 3000);
        };

        markPriceWsRef.current = markPriceWs;
      } catch (error) {}
    };

    connectMarkPriceWebSocket();
    return () => {
      markPriceCancelledRef.current = true;
      if (markPriceReconnectRef.current) clearTimeout(markPriceReconnectRef.current);
      markPriceReconnectRef.current = null;
      markPriceWsRef.current?.close();
      markPriceWsRef.current = null;
    };
  }, [useManualMode]);

  // ===================
  // CALCULATIONS
  // ===================

  const spread = spotPrice - futuresPrice;
  const spreadPercent = ((spread / futuresPrice) * 100).toFixed(4);

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
    const btcPrice = spotPrice;
    const btcDailyInterest = btcInterestRate / 100;
    const usdtDailyInterest = usdtInterestRate / 100;

    let id = 1;

    const calculateStrategyMetrics = (strategy) => {
      const {
        type, // 'spot', 'margin', 'futures', 'cash-carry'
        position, // 'LONG' or 'SHORT'
        size, // Position size in USD
        leverage,
        holdingDays = 30
      } = strategy;

      // ===================
      // MARGIN CALCULATIONS
      // ===================

      let marginRequired = 0;
      let totalFees = 0;
      let dailyInterestCost = 0;
      let monthlyInterestCost = 0;
      let dailyFundingPnL = 0;
      let monthlyFundingPnL = 0;

      if (type === 'spot') {
        // Spot: No leverage, margin = full position size
        marginRequired = size;
        totalFees = size * BINANCE_TAKER_FEE * 2; // Entry + exit
        dailyInterestCost = 0;
        monthlyInterestCost = 0;
      } else if (type === 'margin') {
        // Margin: Leverage with borrowing
        marginRequired = size / leverage;
        totalFees = size * BINANCE_TAKER_FEE * 2;

        // Interest calculation
        // For LONG: You borrow USDT to buy BTC
        // For SHORT: You borrow BTC to sell
        const borrowedAmount = size - marginRequired; // Amount borrowed

        if (position === 'LONG') {
          // Borrow USDT, pay USDT interest
          dailyInterestCost = borrowedAmount * usdtDailyInterest;
        } else {
          // Borrow BTC, pay BTC interest (in USD terms)
          dailyInterestCost = borrowedAmount * btcDailyInterest;
        }
        monthlyInterestCost = dailyInterestCost * 30;
      } else if (type === 'futures') {
        // Futures: Leverage with funding rates
        marginRequired = size / leverage;
        totalFees = size * BINANCE_FUTURES_TAKER_FEE * 2;

        // Funding rate (3x per day)
        const fundingPerPayment = size * binanceFundingRate;
        const dailyFunding = fundingPerPayment * 3;

        if (position === 'LONG' && binanceFundingRate > 0) {
          dailyFundingPnL = -dailyFunding; // Longs pay
        } else if (position === 'LONG' && binanceFundingRate < 0) {
          dailyFundingPnL = Math.abs(dailyFunding); // Longs receive
        } else if (position === 'SHORT' && binanceFundingRate > 0) {
          dailyFundingPnL = dailyFunding; // Shorts receive
        } else if (position === 'SHORT' && binanceFundingRate < 0) {
          dailyFundingPnL = -Math.abs(dailyFunding); // Shorts pay
        }
        monthlyFundingPnL = dailyFundingPnL * 30;
      } else if (type === 'cash-carry') {
        // Cash and Carry: Long spot + Short futures
        // Margin = spot position (full) + futures margin
        const spotSize = size;
        const futuresSize = size;
        const futuresMargin = futuresSize / leverage;
        marginRequired = spotSize + futuresMargin;
        totalFees = (spotSize * BINANCE_TAKER_FEE * 2) + (futuresSize * BINANCE_FUTURES_TAKER_FEE * 2);

        // Earn funding from short futures (if positive)
        const fundingPerPayment = futuresSize * binanceFundingRate;
        const dailyFunding = fundingPerPayment * 3;
        if (binanceFundingRate > 0) {
          dailyFundingPnL = dailyFunding; // Shorts receive
        } else {
          dailyFundingPnL = -Math.abs(dailyFunding); // Shorts pay
        }
        monthlyFundingPnL = dailyFundingPnL * 30;
      } else if (type === 'margin-hedge') {
        // Margin Long + Futures Short
        const marginSize = size;
        const futuresSize = size;
        const marginMargin = marginSize / leverage;
        const futuresMargin = futuresSize / leverage;
        marginRequired = marginMargin + futuresMargin;
        totalFees = (marginSize * BINANCE_TAKER_FEE * 2) + (futuresSize * BINANCE_FUTURES_TAKER_FEE * 2);

        // Interest on margin borrow (LONG margin = borrow USDT)
        const borrowedAmount = marginSize - marginMargin;
        dailyInterestCost = borrowedAmount * usdtDailyInterest;
        monthlyInterestCost = dailyInterestCost * 30;

        // Funding from short futures
        const fundingPerPayment = futuresSize * binanceFundingRate;
        const dailyFunding = fundingPerPayment * 3;
        if (binanceFundingRate > 0) {
          dailyFundingPnL = dailyFunding;
        } else {
          dailyFundingPnL = -Math.abs(dailyFunding);
        }
        monthlyFundingPnL = dailyFundingPnL * 30;
      }

      // ===================
      // PRICE P&L CALCULATION
      // ===================

      const calculatePricePnL = (priceChangePct) => {
        let pricePnL = 0;

        if (type === 'spot') {
          // Spot: Direct price exposure
          if (position === 'LONG') {
            pricePnL = size * priceChangePct;
          }
          // Can't short spot directly
        } else if (type === 'margin') {
          // Margin: Leveraged price exposure
          if (position === 'LONG') {
            pricePnL = size * priceChangePct;
          } else {
            pricePnL = -size * priceChangePct;
          }
        } else if (type === 'futures') {
          // Futures: Leveraged price exposure
          if (position === 'LONG') {
            pricePnL = size * priceChangePct;
          } else {
            pricePnL = -size * priceChangePct;
          }
        } else if (type === 'cash-carry' || type === 'margin-hedge') {
          // Delta-neutral: Price exposure cancels
          pricePnL = 0;
        }

        return pricePnL;
      };

      const pricePnLUp5 = calculatePricePnL(0.05);
      const pricePnLDown5 = calculatePricePnL(-0.05);
      const pricePnLUp10 = calculatePricePnL(0.10);
      const pricePnLDown10 = calculatePricePnL(-0.10);

      // Total P&L at different price scenarios (30 days)
      const totalPnLFlat = monthlyFundingPnL - monthlyInterestCost - totalFees;
      const totalPnLUp5 = pricePnLUp5 + monthlyFundingPnL - monthlyInterestCost - totalFees;
      const totalPnLDown5 = pricePnLDown5 + monthlyFundingPnL - monthlyInterestCost - totalFees;
      const totalPnLUp10 = pricePnLUp10 + monthlyFundingPnL - monthlyInterestCost - totalFees;
      const totalPnLDown10 = pricePnLDown10 + monthlyFundingPnL - monthlyInterestCost - totalFees;

      // ROI and APY (based on flat price)
      const monthlyROI = marginRequired > 0 ? (totalPnLFlat / marginRequired) * 100 : 0;
      const apy = monthlyROI * 12;

      // ===================
      // LIQUIDATION (for leveraged)
      // ===================

      let liquidationPrice = null;
      let liquidationPct = null;

      if (type === 'margin' || type === 'futures') {
        const maintMargin = type === 'margin' ? 0.01 : 0.004; // 1% for margin, 0.4% for futures

        if (position === 'LONG') {
          liquidationPrice = btcPrice * (1 - (1 - maintMargin) / leverage);
          liquidationPct = ((btcPrice - liquidationPrice) / btcPrice) * 100;
        } else {
          liquidationPrice = btcPrice * (1 + (1 - maintMargin) / leverage);
          liquidationPct = ((liquidationPrice - btcPrice) / btcPrice) * 100;
        }
      }

      // ===================
      // RISK METRICS
      // ===================

      // Would you survive a 5% move against you?
      const wouldSurvive5Pct = liquidationPct ? liquidationPct > 5 : true;
      const wouldSurvive10Pct = liquidationPct ? liquidationPct > 10 : true;

      // Max loss is 100% of margin (liquidation)
      const maxLoss = marginRequired;

      // Risk-adjusted APY: If you'd get liquidated before collecting meaningful funding, APY is misleading
      // Show "effective APY" based on probability of survival
      // Rough estimate: BTC moves ~3-5% per week on average
      const daysToLiquidation = liquidationPct ? Math.floor(liquidationPct / 3) : null; // ~3% daily volatility
      const effectiveAPY = (wouldSurvive5Pct && wouldSurvive10Pct) ? apy :
                          wouldSurvive5Pct ? apy * 0.5 : // 50% haircut if risky
                          apy * 0.1; // 90% haircut if very risky

      // Market direction
      let marketDirection = 'NEUTRAL';
      if (type === 'cash-carry' || type === 'margin-hedge') {
        marketDirection = 'NEUTRAL';
      } else if (position === 'LONG') {
        marketDirection = 'BULLISH';
      } else if (position === 'SHORT') {
        marketDirection = 'BEARISH';
      }

      return {
        marginRequired,
        totalFees,
        dailyInterestCost,
        monthlyInterestCost,
        dailyFundingPnL,
        monthlyFundingPnL,
        // P&L scenarios
        pnlFlat: totalPnLFlat,
        pnlUp5: totalPnLUp5,
        pnlDown5: totalPnLDown5,
        pnlUp10: totalPnLUp10,
        pnlDown10: totalPnLDown10,
        // Price-only P&L
        priceOnlyUp5: pricePnLUp5,
        priceOnlyDown5: pricePnLDown5,
        priceOnlyUp10: pricePnLUp10,
        priceOnlyDown10: pricePnLDown10,
        // ROI
        monthlyROI,
        apy,
        effectiveAPY,
        // Risk
        liquidationPrice,
        liquidationPct,
        wouldSurvive5Pct,
        wouldSurvive10Pct,
        maxLoss,
        daysToLiquidation,
        marketDirection
      };
    };

    // ===================
    // STRATEGY DEFINITIONS
    // ===================

    // 1-2: Spot Trading
    strategies.push({
      id: id++,
      name: 'Spot Long (No Leverage)',
      description: 'Buy and hold BTC spot. No leverage, no interest, no funding. Simplest strategy.',
      category: 'Spot',
      type: 'spot',
      position: 'LONG',
      size: Math.min(150, tvl),
      leverage: 1,
      risk: 'LOW',
      ...calculateStrategyMetrics({ type: 'spot', position: 'LONG', size: Math.min(150, tvl), leverage: 1 })
    });

    strategies.push({
      id: id++,
      name: 'Spot Long ($300)',
      description: 'Full TVL in spot BTC. Maximum exposure without leverage.',
      category: 'Spot',
      type: 'spot',
      position: 'LONG',
      size: Math.min(300, tvl),
      leverage: 1,
      risk: 'LOW',
      ...calculateStrategyMetrics({ type: 'spot', position: 'LONG', size: Math.min(300, tvl), leverage: 1 })
    });

    // 3-8: Margin Trading (with interest)
    for (const lev of [3, 5, 10]) {
      const size = Math.min(150, tvl * lev);

      strategies.push({
        id: id++,
        name: `Margin Long ${lev}x`,
        description: `Leveraged long using borrowed USDT. Pays ${(usdtInterestRate).toFixed(3)}%/day interest on borrowed funds.`,
        category: 'Margin',
        type: 'margin',
        position: 'LONG',
        size: size,
        leverage: lev,
        risk: lev >= 10 ? 'HIGH' : 'MEDIUM',
        ...calculateStrategyMetrics({ type: 'margin', position: 'LONG', size, leverage: lev })
      });

      strategies.push({
        id: id++,
        name: `Margin Short ${lev}x`,
        description: `Leveraged short using borrowed BTC. Pays ${(btcInterestRate).toFixed(3)}%/day interest on borrowed BTC.`,
        category: 'Margin',
        type: 'margin',
        position: 'SHORT',
        size: size,
        leverage: lev,
        risk: lev >= 10 ? 'HIGH' : 'MEDIUM',
        ...calculateStrategyMetrics({ type: 'margin', position: 'SHORT', size, leverage: lev })
      });
    }

    // 9-14: Futures Trading
    for (const lev of [10, 20, 50]) {
      const size = Math.min(150, tvl);

      strategies.push({
        id: id++,
        name: `Futures Long ${lev}x`,
        description: `Linear perp long. No interest but pays/receives funding (${(binanceFundingRate * 100).toFixed(4)}% per 8h).`,
        category: 'Futures',
        type: 'futures',
        position: 'LONG',
        size: size,
        leverage: lev,
        risk: lev >= 50 ? 'VERY HIGH' : lev >= 20 ? 'HIGH' : 'MEDIUM',
        ...calculateStrategyMetrics({ type: 'futures', position: 'LONG', size, leverage: lev })
      });

      strategies.push({
        id: id++,
        name: `Futures Short ${lev}x`,
        description: `Linear perp short. Collects funding when positive (${(binanceFundingRate * 100).toFixed(4)}% per 8h).`,
        category: 'Futures',
        type: 'futures',
        position: 'SHORT',
        size: size,
        leverage: lev,
        risk: lev >= 50 ? 'VERY HIGH' : lev >= 20 ? 'HIGH' : 'MEDIUM',
        ...calculateStrategyMetrics({ type: 'futures', position: 'SHORT', size, leverage: lev })
      });
    }

    // 15-16: Cash and Carry (Spot + Short Futures)
    strategies.push({
      id: id++,
      name: 'Cash & Carry 10x',
      description: 'Delta-neutral: Long spot + Short futures. Earns funding with no interest cost. Capital intensive.',
      category: 'Delta-Neutral',
      type: 'cash-carry',
      position: 'NEUTRAL',
      size: Math.min(100, tvl / 2),
      leverage: 10,
      risk: 'LOW',
      ...calculateStrategyMetrics({ type: 'cash-carry', position: 'NEUTRAL', size: Math.min(100, tvl / 2), leverage: 10 })
    });

    strategies.push({
      id: id++,
      name: 'Cash & Carry 20x',
      description: 'Delta-neutral with higher leverage on futures side. More capital efficient but higher risk.',
      category: 'Delta-Neutral',
      type: 'cash-carry',
      position: 'NEUTRAL',
      size: Math.min(100, tvl / 2),
      leverage: 20,
      risk: 'MEDIUM',
      ...calculateStrategyMetrics({ type: 'cash-carry', position: 'NEUTRAL', size: Math.min(100, tvl / 2), leverage: 20 })
    });

    // 17-20: Margin + Futures Hedge
    for (const lev of [5, 10]) {
      strategies.push({
        id: id++,
        name: `Margin-Futures Hedge ${lev}x`,
        description: `Long margin + Short futures. Delta-neutral but PAYS INTEREST on margin borrow. Compare to Twilight!`,
        category: 'Margin-Hedge',
        type: 'margin-hedge',
        position: 'NEUTRAL',
        size: Math.min(100, tvl / 2),
        leverage: lev,
        risk: 'MEDIUM',
        ...calculateStrategyMetrics({ type: 'margin-hedge', position: 'NEUTRAL', size: Math.min(100, tvl / 2), leverage: lev })
      });
    }

    // Comparison strategies
    strategies.push({
      id: id++,
      name: 'Funding Farm (Short Futures Only)',
      description: 'Pure funding collection via short futures. Exposed to price risk if BTC pumps.',
      category: 'Funding',
      type: 'futures',
      position: 'SHORT',
      size: Math.min(200, tvl),
      leverage: 10,
      risk: 'HIGH',
      ...calculateStrategyMetrics({ type: 'futures', position: 'SHORT', size: Math.min(200, tvl), leverage: 10 })
    });

    strategies.push({
      id: id++,
      name: 'Max Leverage Futures Long 100x',
      description: 'Extreme leverage. Very high liquidation risk. For reference only.',
      category: 'Futures',
      type: 'futures',
      position: 'LONG',
      size: Math.min(100, tvl),
      leverage: 100,
      risk: 'EXTREME',
      ...calculateStrategyMetrics({ type: 'futures', position: 'LONG', size: Math.min(100, tvl), leverage: 100 })
    });

    return strategies.sort((a, b) => b.apy - a.apy);
  }, [spotPrice, futuresPrice, binanceFundingRate, tvl, btcInterestRate, usdtInterestRate]);

  const strategyChartData = useMemo(
    () => generateStrategies.slice(0, 10),
    [generateStrategies]
  );

  useEffect(() => {
    if (!selectedStrategy) return;
    const current = generateStrategies.find((s) => s.id === selectedStrategy.id);
    if (current && current !== selectedStrategy) {
      setSelectedStrategy(current);
    } else if (!current) {
      setSelectedStrategy(null);
    }
  }, [generateStrategies, selectedStrategy?.id]);

  // ===================
  // RENDER HELPERS
  // ===================

  const getRiskColor = (risk) => {
    switch (risk) {
      case 'LOW': return 'bg-green-100 text-green-800';
      case 'MEDIUM': return 'bg-yellow-100 text-yellow-800';
      case 'HIGH': return 'bg-red-100 text-red-800';
      case 'VERY HIGH': return 'bg-red-200 text-red-900';
      case 'EXTREME': return 'bg-purple-200 text-purple-900';
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
      case 'Spot': return 'bg-blue-100 text-blue-800';
      case 'Margin': return 'bg-orange-100 text-orange-800';
      case 'Futures': return 'bg-purple-100 text-purple-800';
      case 'Delta-Neutral': return 'bg-green-100 text-green-800';
      case 'Margin-Hedge': return 'bg-red-100 text-red-800';
      case 'Funding': return 'bg-cyan-100 text-cyan-800';
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
            <div className="flex items-center gap-3 mb-1">
              <button
                onClick={onNavigateToTwilight}
                className="flex items-center gap-1 px-3 py-1 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition"
              >
                <ArrowLeft className="w-4 h-4" />
                Twilight Strategies
              </button>
              <span className="text-slate-400">|</span>
              <span className="text-sm text-slate-600">Comparing Traditional CEX Options</span>
            </div>
            <h1 className="text-3xl font-bold text-slate-800 mb-1">
              CEX Trading Comparison
              {!useManualMode && <span className="text-red-500 animate-pulse ml-3 text-xl">LIVE</span>}
            </h1>
            <p className="text-slate-600 text-sm">TVL: ${tvl} | Spot, Margin (with Interest), Futures</p>
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

      {/* Key Message */}
      <div className="bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg p-4 mb-6 text-white">
        <h3 className="font-bold text-lg mb-2">Why Twilight is Different</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div className="bg-white/10 rounded-lg p-3">
            <div className="font-semibold mb-1">Margin Trading</div>
            <div className="text-white/80">Pays interest on borrowed funds ({(usdtInterestRate).toFixed(3)}%/day = {(usdtInterestRate * 365).toFixed(1)}% APR)</div>
          </div>
          <div className="bg-white/10 rounded-lg p-3">
            <div className="font-semibold mb-1">Futures Trading</div>
            <div className="text-white/80">Pays/receives funding rates ({(binanceFundingRate * 100).toFixed(4)}% per 8h)</div>
          </div>
          <div className="bg-white/20 rounded-lg p-3 border-2 border-white/50">
            <div className="font-semibold mb-1">Twilight (Inverse Perp)</div>
            <div className="text-white">Zero trading fees + No borrow interest = More profit!</div>
          </div>
        </div>
      </div>

      {/* Market Data Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-white rounded-lg p-3 shadow">
          <div className="text-xs text-slate-500">Binance Spot</div>
          <div className="text-xl font-bold text-blue-600">${spotPrice.toLocaleString()}</div>
          <div className="text-xs text-slate-400">{lastSpotUpdate || 'Connecting...'}</div>
        </div>

        <div className="bg-white rounded-lg p-3 shadow">
          <div className="text-xs text-slate-500">Binance Futures</div>
          <div className="text-xl font-bold text-purple-600">${futuresPrice.toLocaleString()}</div>
          <div className="text-xs text-slate-400">{lastFuturesUpdate || 'Connecting...'}</div>
        </div>

        <div className="bg-white rounded-lg p-3 shadow">
          <div className="text-xs text-slate-500">Spot-Futures Spread</div>
          <div className={`text-xl font-bold ${spread >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {spread >= 0 ? '+' : ''}{spreadPercent}%
          </div>
          <div className="text-xs text-slate-400">${spread.toFixed(2)}</div>
        </div>

        <div className="bg-white rounded-lg p-3 shadow">
          <div className="text-xs text-slate-500">Funding Rate (8h)</div>
          <div className={`text-xl font-bold ${binanceFundingRate >= 0 ? 'text-orange-600' : 'text-blue-600'}`}>
            {binanceFundingRate >= 0 ? '+' : ''}{(binanceFundingRate * 100).toFixed(4)}%
          </div>
          <div className="text-xs text-slate-400">Next: {getTimeUntilFunding()}</div>
        </div>
      </div>

      {/* Settings */}
      <div className="bg-white rounded-lg p-4 shadow mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Settings className="w-5 h-5 text-slate-600" />
          <h3 className="font-bold text-slate-800">Parameters</h3>
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
            <label className="block text-xs text-slate-600 mb-1">BTC Margin Interest (%/day)</label>
            <input
              type="number"
              step="0.001"
              value={btcInterestRate}
              onChange={(e) => setBtcInterestRate(Number(e.target.value))}
              className="w-full px-2 py-1 border rounded text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-600 mb-1">USDT Margin Interest (%/day)</label>
            <input
              type="number"
              step="0.001"
              value={usdtInterestRate}
              onChange={(e) => setUsdtInterestRate(Number(e.target.value))}
              className="w-full px-2 py-1 border rounded text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-600 mb-1">APR Equivalent</label>
            <div className="px-2 py-1 rounded text-sm font-mono bg-red-50 text-red-700">
              ~{(usdtInterestRate * 365).toFixed(1)}% / year
            </div>
          </div>
        </div>
      </div>

      {/* Strategy APY Chart */}
      <div className="bg-white rounded-lg p-4 shadow mb-6">
        <h3 className="font-bold text-slate-800 mb-2 flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-green-600" />
          Strategy APY Comparison (Flat Price)
        </h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={strategyChartData} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis type="number" tickFormatter={(v) => `${v.toFixed(0)}%`} />
            <YAxis type="category" dataKey="name" width={180} tick={{ fontSize: 10 }} />
            <Tooltip formatter={(v) => `${v.toFixed(2)}%`} />
            <Bar dataKey="apy" name="APY">
              {strategyChartData.map((entry, index) => (
                <Cell key={`cell-${entry.id ?? index}`} fill={entry.apy > 0 ? '#22c55e' : '#ef4444'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* All Strategies Table */}
      <div className="bg-white rounded-lg p-4 shadow mb-6">
        <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
          <DollarSign className="w-5 h-5 text-green-600" />
          All CEX Trading Strategies
        </h3>
        <p className="text-xs text-slate-500 mb-4">
          Note: Margin strategies include interest costs. Compare to Twilight which has NO interest on leveraged positions!
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-slate-50">
                <th className="text-left p-2">#</th>
                <th className="text-left p-2">Strategy</th>
                <th className="text-center p-2">Category</th>
                <th className="text-center p-2">Direction</th>
                <th className="text-left p-2">Risk</th>
                <th className="text-right p-2">Margin</th>
                <th className="text-right p-2">Interest/mo</th>
                <th className="text-right p-2">Monthly P&L</th>
                <th className="text-right p-2">APY</th>
                <th className="text-right p-2 text-green-700">If +5%</th>
                <th className="text-right p-2 text-red-700">If -5%</th>
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
                  <td className="p-2 text-center">
                    <span className={`px-2 py-0.5 rounded text-xs ${getCategoryColor(strategy.category)}`}>
                      {strategy.category}
                    </span>
                  </td>
                  <td className="p-2 text-center">
                    <span className={`px-2 py-1 rounded text-xs font-bold ${
                      strategy.marketDirection === 'BULLISH' ? 'bg-green-500 text-white' :
                      strategy.marketDirection === 'BEARISH' ? 'bg-red-500 text-white' :
                      'bg-gray-500 text-white'
                    }`}>
                      {strategy.marketDirection === 'BULLISH' ? '↑ BULL' :
                       strategy.marketDirection === 'BEARISH' ? '↓ BEAR' : '↔ NEUTRAL'}
                    </span>
                  </td>
                  <td className="p-2">
                    <span className={`px-2 py-0.5 rounded text-xs ${getRiskColor(strategy.risk)}`}>
                      {strategy.risk}
                    </span>
                  </td>
                  <td className="p-2 text-right font-mono">${strategy.marginRequired.toFixed(2)}</td>
                  <td className={`p-2 text-right font-mono ${strategy.monthlyInterestCost > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                    {strategy.monthlyInterestCost > 0 ? `-$${strategy.monthlyInterestCost.toFixed(2)}` : '$0.00'}
                  </td>
                  <td className={`p-2 text-right font-mono ${strategy.pnlFlat >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {strategy.pnlFlat >= 0 ? '+' : ''}${strategy.pnlFlat?.toFixed(2) || '0'}
                  </td>
                  <td className="p-2 text-right">
                    <div className={`font-mono font-bold ${getAPYColor(strategy.apy)}`}>
                      {strategy.apy >= 0 ? '+' : ''}{strategy.apy?.toFixed(1) || '0'}%
                    </div>
                    {strategy.liquidationPct && strategy.liquidationPct < 10 && (
                      <div className="text-xs text-red-500 font-semibold">
                        Liq: {strategy.liquidationPct.toFixed(1)}%
                      </div>
                    )}
                  </td>
                  <td className={`p-2 text-right font-mono font-bold ${strategy.pnlUp5 >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {strategy.pnlUp5 >= 0 ? '+' : ''}${strategy.pnlUp5?.toFixed(2) || '0'}
                  </td>
                  <td className={`p-2 text-right font-mono font-bold ${strategy.pnlDown5 >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {strategy.pnlDown5 >= 0 ? '+' : ''}${strategy.pnlDown5?.toFixed(2) || '0'}
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

      {/* Strategy Details Modal */}
      {selectedStrategy && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setSelectedStrategy(null)}>
          <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            {/* Modal Header */}
            <div className={`p-4 rounded-t-xl ${
              selectedStrategy.marketDirection === 'BULLISH' ? 'bg-gradient-to-r from-green-600 to-emerald-600' :
              selectedStrategy.marketDirection === 'BEARISH' ? 'bg-gradient-to-r from-red-600 to-rose-600' :
              'bg-gradient-to-r from-gray-600 to-slate-600'
            } text-white`}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <span className={`px-3 py-1 rounded-full text-sm font-bold ${
                      selectedStrategy.marketDirection === 'BULLISH' ? 'bg-white text-green-700' :
                      selectedStrategy.marketDirection === 'BEARISH' ? 'bg-white text-red-700' :
                      'bg-white text-gray-700'
                    }`}>
                      {selectedStrategy.marketDirection === 'BULLISH' ? '↑ BULLISH' :
                       selectedStrategy.marketDirection === 'BEARISH' ? '↓ BEARISH' :
                       '↔ NEUTRAL'}
                    </span>
                  </div>
                  <h2 className="text-xl font-bold">{selectedStrategy.name}</h2>
                  <p className="text-white/80 text-sm mt-1">{selectedStrategy.description}</p>
                </div>
                <button
                  onClick={() => setSelectedStrategy(null)}
                  className="bg-white/20 hover:bg-white/30 rounded-full p-2 transition"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="flex gap-2 mt-3">
                <span className={`px-2 py-1 rounded text-xs font-semibold ${getCategoryColor(selectedStrategy.category)}`}>
                  {selectedStrategy.category}
                </span>
                <span className={`px-2 py-1 rounded text-xs font-semibold ${getRiskColor(selectedStrategy.risk)}`}>
                  {selectedStrategy.risk} RISK
                </span>
              </div>
            </div>

            {/* HIGH LEVERAGE WARNING */}
            {selectedStrategy.liquidationPct && selectedStrategy.liquidationPct < 10 && (
              <div className="p-4 bg-purple-900 text-white border-b-4 border-purple-500">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-8 h-8 text-yellow-400" />
                  <div>
                    <div className="font-bold text-lg text-yellow-400">EXTREME LEVERAGE WARNING</div>
                    <div className="text-sm">
                      Liquidation at just <strong className="text-yellow-300">{selectedStrategy.liquidationPct.toFixed(1)}%</strong> price move against you!
                      BTC regularly moves 3-5% in a single day.
                    </div>
                    <div className="text-sm mt-1">
                      The <strong>{selectedStrategy.apy.toFixed(0)}% APY is misleading</strong> - you would likely get liquidated before collecting meaningful funding.
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
                      <div className="bg-white/10 rounded p-1">
                        <div className="text-yellow-300">Max Loss</div>
                        <div className="font-bold">${selectedStrategy.maxLoss.toFixed(2)} (100%)</div>
                      </div>
                      <div className="bg-white/10 rounded p-1">
                        <div className="text-yellow-300">Monthly Gain</div>
                        <div className="font-bold">${selectedStrategy.pnlFlat.toFixed(2)}</div>
                      </div>
                      <div className="bg-white/10 rounded p-1">
                        <div className="text-yellow-300">Risk/Reward</div>
                        <div className="font-bold text-red-400">{(selectedStrategy.maxLoss / selectedStrategy.pnlFlat).toFixed(0)}:1 against</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Interest Warning for Margin */}
            {selectedStrategy.type === 'margin' && (
              <div className="p-4 bg-red-100 border-b-4 border-red-500">
                <div className="flex items-center gap-2 text-red-800">
                  <AlertCircle className="w-6 h-6" />
                  <div>
                    <div className="font-bold">Margin Interest Cost</div>
                    <div className="text-sm">
                      You pay <strong>${selectedStrategy.dailyInterestCost.toFixed(4)}/day</strong> ({selectedStrategy.position === 'LONG' ? usdtInterestRate : btcInterestRate}%)
                      = <strong>${selectedStrategy.monthlyInterestCost.toFixed(2)}/month</strong> = <strong>{((selectedStrategy.position === 'LONG' ? usdtInterestRate : btcInterestRate) * 365).toFixed(1)}% APR</strong>
                    </div>
                    <div className="text-sm mt-1 font-semibold">
                      Twilight has NO interest on leveraged positions!
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Margin-Hedge Warning */}
            {selectedStrategy.type === 'margin-hedge' && (
              <div className="p-4 bg-orange-100 border-b-4 border-orange-500">
                <div className="flex items-center gap-2 text-orange-800">
                  <AlertCircle className="w-6 h-6" />
                  <div>
                    <div className="font-bold">Interest Eats Your Funding Profit!</div>
                    <div className="text-sm">
                      Monthly funding earned: +${selectedStrategy.monthlyFundingPnL.toFixed(2)} |
                      Interest paid: -${selectedStrategy.monthlyInterestCost.toFixed(2)} |
                      Net: <strong className={selectedStrategy.pnlFlat >= 0 ? 'text-green-700' : 'text-red-700'}>
                        ${selectedStrategy.pnlFlat.toFixed(2)}
                      </strong>
                    </div>
                    <div className="text-sm mt-1 font-semibold">
                      With Twilight: Same funding, ZERO interest = More profit!
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* P&L Scenarios */}
            <div className="p-4 bg-gradient-to-r from-slate-100 to-slate-200 border-b-4 border-slate-400">
              <h3 className="font-bold text-slate-800 text-lg mb-3">
                P&L at Different Price Movements (30 days)
              </h3>
              <div className="grid grid-cols-5 gap-2 text-center">
                <div className="bg-red-100 rounded-lg p-3">
                  <div className="text-red-600 text-xs font-semibold">If -10%</div>
                  <div className={`text-xl font-bold ${selectedStrategy.pnlDown10 >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                    {selectedStrategy.pnlDown10 >= 0 ? '+' : ''}${selectedStrategy.pnlDown10?.toFixed(2) || '0'}
                  </div>
                  <div className={`text-xs ${selectedStrategy.priceOnlyDown10 >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    Price: {selectedStrategy.priceOnlyDown10 >= 0 ? '+' : ''}${selectedStrategy.priceOnlyDown10?.toFixed(2) || '0'}
                  </div>
                </div>
                <div className="bg-red-50 rounded-lg p-3">
                  <div className="text-red-500 text-xs font-semibold">If -5%</div>
                  <div className={`text-xl font-bold ${selectedStrategy.pnlDown5 >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                    {selectedStrategy.pnlDown5 >= 0 ? '+' : ''}${selectedStrategy.pnlDown5?.toFixed(2) || '0'}
                  </div>
                  <div className={`text-xs ${selectedStrategy.priceOnlyDown5 >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    Price: {selectedStrategy.priceOnlyDown5 >= 0 ? '+' : ''}${selectedStrategy.priceOnlyDown5?.toFixed(2) || '0'}
                  </div>
                </div>
                <div className="bg-gray-100 rounded-lg p-3 border-2 border-gray-300">
                  <div className="text-gray-600 text-xs font-semibold">Flat (0%)</div>
                  <div className={`text-xl font-bold ${selectedStrategy.pnlFlat >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                    {selectedStrategy.pnlFlat >= 0 ? '+' : ''}${selectedStrategy.pnlFlat?.toFixed(2) || '0'}
                  </div>
                  <div className="text-xs text-gray-500">No price change</div>
                </div>
                <div className="bg-green-50 rounded-lg p-3">
                  <div className="text-green-500 text-xs font-semibold">If +5%</div>
                  <div className={`text-xl font-bold ${selectedStrategy.pnlUp5 >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                    {selectedStrategy.pnlUp5 >= 0 ? '+' : ''}${selectedStrategy.pnlUp5?.toFixed(2) || '0'}
                  </div>
                  <div className={`text-xs ${selectedStrategy.priceOnlyUp5 >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    Price: {selectedStrategy.priceOnlyUp5 >= 0 ? '+' : ''}${selectedStrategy.priceOnlyUp5?.toFixed(2) || '0'}
                  </div>
                </div>
                <div className="bg-green-100 rounded-lg p-3">
                  <div className="text-green-600 text-xs font-semibold">If +10%</div>
                  <div className={`text-xl font-bold ${selectedStrategy.pnlUp10 >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                    {selectedStrategy.pnlUp10 >= 0 ? '+' : ''}${selectedStrategy.pnlUp10?.toFixed(2) || '0'}
                  </div>
                  <div className={`text-xs ${selectedStrategy.priceOnlyUp10 >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    Price: {selectedStrategy.priceOnlyUp10 >= 0 ? '+' : ''}${selectedStrategy.priceOnlyUp10?.toFixed(2) || '0'}
                  </div>
                </div>
              </div>
            </div>

            {/* Position Details - DETAILED BREAKDOWN */}
            <div className="p-4 bg-slate-50 border-b-4 border-blue-500">
              <h3 className="font-bold text-slate-800 text-lg mb-4 flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-blue-600" />
                EXACT POSITION DETAILS
              </h3>

              {/* Single-leg strategies (spot, margin, futures) */}
              {(selectedStrategy.type === 'spot' || selectedStrategy.type === 'margin' || selectedStrategy.type === 'futures') && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className={`rounded-xl p-4 ${
                    selectedStrategy.type === 'spot' ? 'bg-blue-600' :
                    selectedStrategy.type === 'margin' ? 'bg-orange-600' :
                    'bg-purple-600'
                  } text-white`}>
                    <div className="flex justify-between items-center mb-2">
                      <div className="text-sm opacity-80">
                        {selectedStrategy.type === 'spot' ? 'SPOT POSITION' :
                         selectedStrategy.type === 'margin' ? 'MARGIN POSITION' :
                         'FUTURES POSITION'}
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded font-bold ${
                        selectedStrategy.type === 'spot' ? 'bg-blue-400' :
                        selectedStrategy.type === 'margin' ? 'bg-orange-400' :
                        'bg-purple-400'
                      }`}>
                        {selectedStrategy.type === 'spot' ? 'NO LEVERAGE' :
                         selectedStrategy.type === 'margin' ? 'USDT-MARGINED' :
                         'LINEAR PERP'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mb-3">
                      {selectedStrategy.position === 'LONG' ? (
                        <ArrowUpRight className="w-8 h-8" />
                      ) : (
                        <ArrowDownRight className="w-8 h-8" />
                      )}
                      <span className="text-3xl font-bold">{selectedStrategy.position}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="bg-white/20 rounded-lg p-2">
                        <div className="opacity-70">Position Size (USD)</div>
                        <div className="text-xl font-bold">${selectedStrategy.size}</div>
                      </div>
                      <div className="bg-white/20 rounded-lg p-2">
                        <div className="opacity-70">Leverage</div>
                        <div className="text-xl font-bold">{selectedStrategy.leverage}x</div>
                      </div>
                      <div className="bg-yellow-500/30 rounded-lg p-2 col-span-2">
                        <div className="opacity-90 font-semibold">Margin Required</div>
                        <div className="text-2xl font-bold">${selectedStrategy.marginRequired.toFixed(2)}</div>
                        {selectedStrategy.type === 'margin' && (
                          <div className="text-xs opacity-70">
                            Borrowed: ${(selectedStrategy.size - selectedStrategy.marginRequired).toFixed(2)}
                          </div>
                        )}
                      </div>
                      {selectedStrategy.type === 'margin' && (
                        <div className="bg-red-500/30 rounded-lg p-2 col-span-2">
                          <div className="opacity-90 font-semibold">Daily Interest on Borrowed</div>
                          <div className="text-xl font-bold">${selectedStrategy.dailyInterestCost.toFixed(4)}/day</div>
                          <div className="text-xs opacity-70">
                            = ${selectedStrategy.monthlyInterestCost.toFixed(2)}/month
                          </div>
                        </div>
                      )}
                      <div className="bg-white/20 rounded-lg p-2 col-span-2">
                        <div className="opacity-70">Trading Fee (0.1% spot / 0.04% futures)</div>
                        <div className="text-xl font-bold">${selectedStrategy.totalFees.toFixed(2)}</div>
                      </div>
                    </div>
                  </div>

                  {/* Execution Steps */}
                  <div className="bg-white rounded-xl p-4 border-2 border-slate-200">
                    <h4 className="font-bold text-slate-800 mb-3">Step-by-Step Execution</h4>
                    <div className="space-y-3 text-sm">
                      {selectedStrategy.type === 'spot' && (
                        <>
                          <div className="flex items-start gap-2">
                            <span className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded text-xs font-bold">1</span>
                            <div>
                              <div className="font-semibold">Buy BTC Spot</div>
                              <div className="text-slate-600">Purchase ${selectedStrategy.size} worth of BTC at market price</div>
                            </div>
                          </div>
                          <div className="flex items-start gap-2">
                            <span className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded text-xs font-bold">2</span>
                            <div>
                              <div className="font-semibold">Hold</div>
                              <div className="text-slate-600">Keep BTC in your spot wallet. No ongoing costs.</div>
                            </div>
                          </div>
                        </>
                      )}
                      {selectedStrategy.type === 'margin' && (
                        <>
                          <div className="flex items-start gap-2">
                            <span className="bg-orange-100 text-orange-800 px-2 py-0.5 rounded text-xs font-bold">1</span>
                            <div>
                              <div className="font-semibold">Deposit Margin</div>
                              <div className="text-slate-600">Transfer ${selectedStrategy.marginRequired.toFixed(2)} to margin wallet</div>
                            </div>
                          </div>
                          <div className="flex items-start gap-2">
                            <span className="bg-orange-100 text-orange-800 px-2 py-0.5 rounded text-xs font-bold">2</span>
                            <div>
                              <div className="font-semibold">Borrow {selectedStrategy.position === 'LONG' ? 'USDT' : 'BTC'}</div>
                              <div className="text-slate-600">
                                Auto-borrow ${(selectedStrategy.size - selectedStrategy.marginRequired).toFixed(2)} at {selectedStrategy.position === 'LONG' ? usdtInterestRate : btcInterestRate}%/day
                              </div>
                            </div>
                          </div>
                          <div className="flex items-start gap-2">
                            <span className="bg-orange-100 text-orange-800 px-2 py-0.5 rounded text-xs font-bold">3</span>
                            <div>
                              <div className="font-semibold">Open {selectedStrategy.position} Position</div>
                              <div className="text-slate-600">{selectedStrategy.position === 'LONG' ? 'Buy' : 'Sell'} ${selectedStrategy.size} BTC at {selectedStrategy.leverage}x</div>
                            </div>
                          </div>
                          <div className="bg-red-50 rounded-lg p-2 mt-2">
                            <div className="text-red-700 text-xs font-semibold">Interest accrues hourly!</div>
                          </div>
                        </>
                      )}
                      {selectedStrategy.type === 'futures' && (
                        <>
                          <div className="flex items-start gap-2">
                            <span className="bg-purple-100 text-purple-800 px-2 py-0.5 rounded text-xs font-bold">1</span>
                            <div>
                              <div className="font-semibold">Deposit Margin</div>
                              <div className="text-slate-600">Transfer ${selectedStrategy.marginRequired.toFixed(2)} USDT to futures wallet</div>
                            </div>
                          </div>
                          <div className="flex items-start gap-2">
                            <span className="bg-purple-100 text-purple-800 px-2 py-0.5 rounded text-xs font-bold">2</span>
                            <div>
                              <div className="font-semibold">Open {selectedStrategy.position} {selectedStrategy.leverage}x</div>
                              <div className="text-slate-600">{selectedStrategy.position === 'LONG' ? 'Buy' : 'Sell'} ${selectedStrategy.size} BTCUSDT Perp</div>
                            </div>
                          </div>
                          <div className="flex items-start gap-2">
                            <span className="bg-purple-100 text-purple-800 px-2 py-0.5 rounded text-xs font-bold">3</span>
                            <div>
                              <div className="font-semibold">Manage Funding</div>
                              <div className="text-slate-600">
                                {binanceFundingRate > 0
                                  ? (selectedStrategy.position === 'LONG' ? 'Pay' : 'Receive')
                                  : (selectedStrategy.position === 'LONG' ? 'Receive' : 'Pay')
                                } funding every 8 hours
                              </div>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Multi-leg strategies (cash-carry, margin-hedge) */}
              {(selectedStrategy.type === 'cash-carry' || selectedStrategy.type === 'margin-hedge') && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* LEG 1: Long Position */}
                    <div className={`rounded-xl p-4 ${selectedStrategy.type === 'cash-carry' ? 'bg-blue-600' : 'bg-orange-600'} text-white`}>
                      <div className="flex justify-between items-center mb-2">
                        <div className="text-sm opacity-80">LEG 1: {selectedStrategy.type === 'cash-carry' ? 'SPOT' : 'MARGIN'} POSITION</div>
                        <span className={`text-xs px-2 py-0.5 rounded font-bold ${selectedStrategy.type === 'cash-carry' ? 'bg-blue-400' : 'bg-orange-400'}`}>
                          {selectedStrategy.type === 'cash-carry' ? 'NO LEVERAGE' : 'USDT-MARGINED'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mb-3">
                        <ArrowUpRight className="w-8 h-8" />
                        <span className="text-3xl font-bold">LONG</span>
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div className="bg-white/20 rounded-lg p-2">
                          <div className="opacity-70">Position Size</div>
                          <div className="text-xl font-bold">${selectedStrategy.size}</div>
                        </div>
                        <div className="bg-white/20 rounded-lg p-2">
                          <div className="opacity-70">Leverage</div>
                          <div className="text-xl font-bold">{selectedStrategy.type === 'cash-carry' ? '1x' : `${selectedStrategy.leverage}x`}</div>
                        </div>
                        <div className="bg-yellow-500/30 rounded-lg p-2 col-span-2">
                          <div className="opacity-90 font-semibold">Capital Required</div>
                          <div className="text-2xl font-bold">
                            ${selectedStrategy.type === 'cash-carry'
                              ? selectedStrategy.size.toFixed(2)
                              : (selectedStrategy.size / selectedStrategy.leverage).toFixed(2)}
                          </div>
                          {selectedStrategy.type === 'margin-hedge' && (
                            <div className="text-xs opacity-70">
                              Borrowed: ${(selectedStrategy.size - selectedStrategy.size / selectedStrategy.leverage).toFixed(2)}
                            </div>
                          )}
                        </div>
                        {selectedStrategy.type === 'margin-hedge' && (
                          <div className="bg-red-500/30 rounded-lg p-2 col-span-2">
                            <div className="opacity-90 font-semibold">Interest on Borrowed USDT</div>
                            <div className="text-lg font-bold">${selectedStrategy.dailyInterestCost.toFixed(4)}/day</div>
                          </div>
                        )}
                        <div className="bg-white/20 rounded-lg p-2 col-span-2">
                          <div className="opacity-70">Trading Fee</div>
                          <div className="text-lg font-bold">${(selectedStrategy.size * (selectedStrategy.type === 'cash-carry' ? 0.001 : 0.001) * 2).toFixed(2)}</div>
                        </div>
                      </div>
                    </div>

                    {/* LEG 2: Short Futures */}
                    <div className="rounded-xl p-4 bg-purple-600 text-white">
                      <div className="flex justify-between items-center mb-2">
                        <div className="text-sm opacity-80">LEG 2: FUTURES POSITION</div>
                        <span className="bg-purple-400 text-xs px-2 py-0.5 rounded font-bold">LINEAR PERP</span>
                      </div>
                      <div className="flex items-center gap-2 mb-3">
                        <ArrowDownRight className="w-8 h-8" />
                        <span className="text-3xl font-bold">SHORT</span>
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div className="bg-white/20 rounded-lg p-2">
                          <div className="opacity-70">Position Size</div>
                          <div className="text-xl font-bold">${selectedStrategy.size}</div>
                        </div>
                        <div className="bg-white/20 rounded-lg p-2">
                          <div className="opacity-70">Leverage</div>
                          <div className="text-xl font-bold">{selectedStrategy.leverage}x</div>
                        </div>
                        <div className="bg-yellow-500/30 rounded-lg p-2 col-span-2">
                          <div className="opacity-90 font-semibold">Margin Required</div>
                          <div className="text-2xl font-bold">${(selectedStrategy.size / selectedStrategy.leverage).toFixed(2)}</div>
                        </div>
                        <div className={`rounded-lg p-2 col-span-2 ${binanceFundingRate > 0 ? 'bg-green-500/30' : 'bg-red-500/30'}`}>
                          <div className="opacity-90 font-semibold">Funding (Short {binanceFundingRate > 0 ? 'Receives' : 'Pays'})</div>
                          <div className="text-lg font-bold">
                            {binanceFundingRate > 0 ? '+' : '-'}${Math.abs(selectedStrategy.monthlyFundingPnL).toFixed(2)}/month
                          </div>
                          <div className="text-xs opacity-70">
                            {(binanceFundingRate * 100).toFixed(4)}% per 8h × 3 × 30 days
                          </div>
                        </div>
                        <div className="bg-white/20 rounded-lg p-2 col-span-2">
                          <div className="opacity-70">Trading Fee (0.04%)</div>
                          <div className="text-lg font-bold">${(selectedStrategy.size * 0.0004 * 2).toFixed(2)}</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Total Capital Summary */}
                  <div className="bg-white rounded-lg p-4 border-2 border-slate-300">
                    <h4 className="font-bold text-slate-800 mb-3">Total Capital Required</h4>
                    <div className="grid grid-cols-4 gap-4 text-sm text-center">
                      <div>
                        <div className="text-slate-500">Leg 1 ({selectedStrategy.type === 'cash-carry' ? 'Spot' : 'Margin'})</div>
                        <div className="text-xl font-bold text-blue-600">
                          ${selectedStrategy.type === 'cash-carry'
                            ? selectedStrategy.size.toFixed(2)
                            : (selectedStrategy.size / selectedStrategy.leverage).toFixed(2)}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500">Leg 2 (Futures)</div>
                        <div className="text-xl font-bold text-purple-600">${(selectedStrategy.size / selectedStrategy.leverage).toFixed(2)}</div>
                      </div>
                      <div className="bg-slate-100 rounded-lg p-2">
                        <div className="text-slate-500">Total Margin</div>
                        <div className="text-xl font-bold text-slate-800">${selectedStrategy.marginRequired.toFixed(2)}</div>
                      </div>
                      <div className={`rounded-lg p-2 ${selectedStrategy.monthlyInterestCost > 0 ? 'bg-red-100' : 'bg-green-100'}`}>
                        <div className="text-slate-500">Monthly Interest</div>
                        <div className={`text-xl font-bold ${selectedStrategy.monthlyInterestCost > 0 ? 'text-red-600' : 'text-green-600'}`}>
                          {selectedStrategy.monthlyInterestCost > 0 ? `-$${selectedStrategy.monthlyInterestCost.toFixed(2)}` : '$0.00'}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Execution Steps */}
                  <div className="bg-yellow-50 rounded-lg p-4 border border-yellow-200">
                    <h4 className="font-bold text-yellow-800 mb-3">Step-by-Step Execution</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                      <div className="space-y-2">
                        <div className="font-semibold text-slate-700">Leg 1: {selectedStrategy.type === 'cash-carry' ? 'Buy Spot' : 'Open Margin Long'}</div>
                        <div className="flex items-start gap-2">
                          <span className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded text-xs font-bold">1</span>
                          <span>
                            {selectedStrategy.type === 'cash-carry'
                              ? `Buy $${selectedStrategy.size} BTC on spot market`
                              : `Deposit $${(selectedStrategy.size / selectedStrategy.leverage).toFixed(2)} to margin`
                            }
                          </span>
                        </div>
                        {selectedStrategy.type === 'margin-hedge' && (
                          <div className="flex items-start gap-2">
                            <span className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded text-xs font-bold">2</span>
                            <span>Open ${selectedStrategy.size} LONG at {selectedStrategy.leverage}x (borrows USDT)</span>
                          </div>
                        )}
                      </div>
                      <div className="space-y-2">
                        <div className="font-semibold text-slate-700">Leg 2: Short Futures</div>
                        <div className="flex items-start gap-2">
                          <span className="bg-purple-100 text-purple-800 px-2 py-0.5 rounded text-xs font-bold">{selectedStrategy.type === 'cash-carry' ? '2' : '3'}</span>
                          <span>Deposit ${(selectedStrategy.size / selectedStrategy.leverage).toFixed(2)} USDT to futures</span>
                        </div>
                        <div className="flex items-start gap-2">
                          <span className="bg-purple-100 text-purple-800 px-2 py-0.5 rounded text-xs font-bold">{selectedStrategy.type === 'cash-carry' ? '3' : '4'}</span>
                          <span>Open ${selectedStrategy.size} SHORT at {selectedStrategy.leverage}x</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Cost Breakdown */}
            <div className="p-4 bg-white border-b">
              <h3 className="font-bold text-slate-800 mb-3">Monthly Cost Breakdown</h3>
              <div className="grid grid-cols-5 gap-2 text-sm">
                <div className="bg-slate-100 rounded-lg p-3 text-center">
                  <div className="text-slate-500 text-xs">Trading Fees</div>
                  <div className="font-bold text-red-600">-${selectedStrategy.totalFees.toFixed(2)}</div>
                </div>
                <div className={`rounded-lg p-3 text-center ${selectedStrategy.monthlyInterestCost > 0 ? 'bg-red-100' : 'bg-green-100'}`}>
                  <div className={`text-xs ${selectedStrategy.monthlyInterestCost > 0 ? 'text-red-600' : 'text-green-600'}`}>Interest Cost</div>
                  <div className={`font-bold ${selectedStrategy.monthlyInterestCost > 0 ? 'text-red-700' : 'text-green-700'}`}>
                    {selectedStrategy.monthlyInterestCost > 0 ? `-$${selectedStrategy.monthlyInterestCost.toFixed(2)}` : '$0.00'}
                  </div>
                </div>
                <div className={`rounded-lg p-3 text-center ${selectedStrategy.monthlyFundingPnL >= 0 ? 'bg-green-100' : 'bg-red-100'}`}>
                  <div className={`text-xs ${selectedStrategy.monthlyFundingPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>Funding P&L</div>
                  <div className={`font-bold ${selectedStrategy.monthlyFundingPnL >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                    {selectedStrategy.monthlyFundingPnL >= 0 ? '+' : ''}${selectedStrategy.monthlyFundingPnL.toFixed(2)}
                  </div>
                </div>
                <div className="bg-slate-100 rounded-lg p-3 text-center">
                  <div className="text-slate-500 text-xs">Total Costs</div>
                  <div className="font-bold text-red-600">
                    -${(selectedStrategy.totalFees + selectedStrategy.monthlyInterestCost - Math.max(0, selectedStrategy.monthlyFundingPnL)).toFixed(2)}
                  </div>
                </div>
                <div className={`rounded-lg p-3 text-center ${selectedStrategy.pnlFlat >= 0 ? 'bg-green-500' : 'bg-red-500'} text-white`}>
                  <div className="text-xs opacity-80">Net P&L (Flat)</div>
                  <div className="font-bold text-lg">
                    {selectedStrategy.pnlFlat >= 0 ? '+' : ''}${selectedStrategy.pnlFlat.toFixed(2)}
                  </div>
                </div>
              </div>
            </div>

            {/* Liquidation Info */}
            {selectedStrategy.liquidationPrice && (
              <div className="p-4 bg-red-50 border-b">
                <h3 className="font-bold text-red-800 mb-3 flex items-center gap-2">
                  <AlertCircle className="w-5 h-5" />
                  Liquidation Risk
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-white rounded-lg p-3 border-2 border-red-200">
                    <div className="text-red-600 text-xs">Liquidation Price</div>
                    <div className="text-2xl font-bold text-red-700">
                      ${selectedStrategy.liquidationPrice.toLocaleString(undefined, {maximumFractionDigits: 0})}
                    </div>
                  </div>
                  <div className="bg-white rounded-lg p-3 border-2 border-red-200">
                    <div className="text-red-600 text-xs">Distance to Liquidation</div>
                    <div className="text-2xl font-bold text-red-700">
                      {selectedStrategy.liquidationPct.toFixed(1)}%
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* APY */}
            <div className="p-4 bg-gradient-to-r from-blue-500 to-purple-600 text-white text-center">
              <div className="text-sm opacity-80">Projected Annual APY (Flat Price)</div>
              <div className="text-4xl font-bold">
                {selectedStrategy.apy >= 0 ? '+' : ''}{selectedStrategy.apy.toFixed(2)}%
              </div>
              <div className="text-sm opacity-80 mt-2">
                Monthly ROI: {selectedStrategy.monthlyROI >= 0 ? '+' : ''}{selectedStrategy.monthlyROI.toFixed(2)}%
              </div>
            </div>

            {/* Twilight Comparison */}
            <div className="p-4 bg-gradient-to-r from-blue-100 to-purple-100">
              <h3 className="font-bold text-slate-800 mb-2">Compare with Twilight</h3>
              <p className="text-sm text-slate-600 mb-3">
                Twilight offers leveraged spot exposure (inverse perp) with:
              </p>
              <div className="grid grid-cols-3 gap-2 text-center text-sm">
                <div className="bg-white rounded-lg p-2">
                  <div className="text-green-600 font-bold">0% Trading Fee</div>
                  <div className="text-xs text-slate-500">vs {(BINANCE_TAKER_FEE * 100).toFixed(2)}% on Binance</div>
                </div>
                <div className="bg-white rounded-lg p-2">
                  <div className="text-green-600 font-bold">0% Interest</div>
                  <div className="text-xs text-slate-500">vs {(usdtInterestRate * 365).toFixed(1)}% APR margin</div>
                </div>
                <div className="bg-white rounded-lg p-2">
                  <div className="text-blue-600 font-bold">BTC-Margined</div>
                  <div className="text-xs text-slate-500">Hold BTC exposure</div>
                </div>
              </div>
              <button
                onClick={() => { setSelectedStrategy(null); onNavigateToTwilight(); }}
                className="mt-3 w-full py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition"
              >
                View Twilight Strategies
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fee Comparison Table */}
      <div className="bg-white rounded-lg p-4 shadow">
        <h3 className="font-bold text-slate-800 mb-3">Fee & Cost Comparison</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-slate-50">
                <th className="text-left p-2">Platform / Type</th>
                <th className="text-center p-2">Trading Fee</th>
                <th className="text-center p-2">Interest/Funding</th>
                <th className="text-center p-2">Settlement</th>
                <th className="text-center p-2">Max Leverage</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b">
                <td className="p-2 font-medium">Binance Spot</td>
                <td className="p-2 text-center">0.1%</td>
                <td className="p-2 text-center text-gray-400">None</td>
                <td className="p-2 text-center">Instant</td>
                <td className="p-2 text-center">1x</td>
              </tr>
              <tr className="border-b bg-red-50">
                <td className="p-2 font-medium text-red-800">Binance Margin</td>
                <td className="p-2 text-center">0.1%</td>
                <td className="p-2 text-center text-red-600 font-bold">{(usdtInterestRate * 365).toFixed(1)}% APR</td>
                <td className="p-2 text-center">USDT/BTC</td>
                <td className="p-2 text-center">10x</td>
              </tr>
              <tr className="border-b">
                <td className="p-2 font-medium">Binance Futures</td>
                <td className="p-2 text-center">0.04%</td>
                <td className="p-2 text-center text-orange-600">{(binanceFundingRate * 100 * 3 * 365).toFixed(1)}% APR*</td>
                <td className="p-2 text-center">USDT</td>
                <td className="p-2 text-center">125x</td>
              </tr>
              <tr className="border-b bg-green-50">
                <td className="p-2 font-medium text-green-800">Twilight (Inverse Perp)</td>
                <td className="p-2 text-center text-green-600 font-bold">0%</td>
                <td className="p-2 text-center text-green-600 font-bold">0% Interest</td>
                <td className="p-2 text-center">BTC</td>
                <td className="p-2 text-center">20x</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-500 mt-2">
          * Funding rate varies. Current rate: {(binanceFundingRate * 100).toFixed(4)}% per 8 hours.
        </p>
      </div>
    </div>
  );
};

export default CEXComparisonPage;
