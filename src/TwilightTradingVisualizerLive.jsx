import React, { useState, useEffect, useRef, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, BarChart, Bar, Cell } from 'recharts';
import { ArrowUpRight, ArrowDownRight, DollarSign, TrendingUp, AlertCircle, Wifi, WifiOff, Activity, Settings, Info, ArrowRight } from 'lucide-react';

const TwilightTradingVisualizerLive = ({ onNavigateToCEX }) => {
  // ===================
  // CONFIGURATION
  // ===================
  const DEFAULT_TVL = 300; // $300 TVL for testing
  const BINANCE_TAKER_FEE = 0.0004; // 0.04% taker fee
  const BINANCE_MAKER_FEE = 0.0002; // 0.02% maker fee
  const TWILIGHT_FEE = 0; // 0% fee on Twilight
  const TWILIGHT_FUNDING_PSI = 1.0; // Sensitivity parameter for Twilight funding
  const TWILIGHT_FUNDING_SCALE = 100; // Scale factor so rate is in realistic % (formula was 100x too large)

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

  // Bybit inverse BTCUSD state
  const [bybitPrice, setBybitPrice] = useState(0);
  const [bybitFundingRate, setBybitFundingRate] = useState(0.0001); // 0.01% default
  const [bybitNextFundingTime, setBybitNextFundingTime] = useState(null);
  const [isBybitConnected, setIsBybitConnected] = useState(false);
  const [lastBybitUpdate, setLastBybitUpdate] = useState(null);

  // Pool state (for Twilight funding rate calculation)
  const [twilightLongSize, setTwilightLongSize] = useState(0);
  const [twilightShortSize, setTwilightShortSize] = useState(0);
  // Twilight funding rate cap as % of Binance (0 = no cap). Step 1%, range 0–100.
  const [twilightFundingCapPct, setTwilightFundingCapPct] = useState(0);
  // When true, Twilight funding rate is pegged to (cap% of Binance), ignoring pool imbalance.
  const [pegTwilightToCapRate, setPegTwilightToCapRate] = useState(false);

  // Trading parameters
  const [tvl, setTvl] = useState(DEFAULT_TVL);
  const [useManualMode, setUseManualMode] = useState(false);
  const [selectedStrategy, setSelectedStrategy] = useState(null);
  const [tradeSize, setTradeSize] = useState(100); // Trade size for impact calculator

  // Price/funding history for charts
  const [priceHistory, setPriceHistory] = useState([]);
  const [fundingHistory, setFundingHistory] = useState([]);
  const maxHistoryLength = 50;

  // WebSocket refs
  const spotWsRef = useRef(null);
  const futuresWsRef = useRef(null);
  const markPriceWsRef = useRef(null);
  const bybitWsRef = useRef(null);

  // ===================
  // WEBSOCKET CONNECTIONS
  // ===================

  // Throttle refs to prevent excessive re-renders
  const lastSpotPriceRef = useRef(0);
  const lastFuturesPriceRef = useRef(0);
  const lastUpdateTimeRef = useRef(0);
  const UPDATE_THROTTLE_MS = 100; // Update at most every 100ms

  // Connect to Binance Spot WebSocket (for Twilight pricing)
  useEffect(() => {
    if (useManualMode) return;

    const connectSpotWebSocket = () => {
      try {
        // Use aggTrade for slightly less frequent but still real-time updates
        const spotWs = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@aggTrade');

        spotWs.onopen = () => {
          console.log('Connected to Binance Spot WebSocket');
          setIsSpotConnected(true);
        };

        spotWs.onmessage = (event) => {
          const now = Date.now();
          const data = JSON.parse(event.data);
          const price = parseFloat(data.p);
          const roundedPrice = Math.round(price);

          // Only update if price changed and throttle time passed
          if (roundedPrice !== lastSpotPriceRef.current &&
              now - lastUpdateTimeRef.current > UPDATE_THROTTLE_MS) {
            lastSpotPriceRef.current = roundedPrice;
            lastUpdateTimeRef.current = now;
            setTwilightPrice(roundedPrice);
            setLastSpotUpdate(new Date().toLocaleTimeString());
          }
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
        // Use aggTrade for slightly less frequent but still real-time updates
        const futuresWs = new WebSocket('wss://fstream.binance.com/ws/btcusdt@aggTrade');

        futuresWs.onopen = () => {
          console.log('Connected to Binance Futures WebSocket');
          setIsFuturesConnected(true);
        };

        futuresWs.onmessage = (event) => {
          const now = Date.now();
          const data = JSON.parse(event.data);
          const price = parseFloat(data.p);
          const roundedPrice = Math.round(price);

          // Only update if price changed
          if (roundedPrice !== lastFuturesPriceRef.current &&
              now - lastUpdateTimeRef.current > UPDATE_THROTTLE_MS) {
            lastFuturesPriceRef.current = roundedPrice;
            setCexPrice(roundedPrice);
            setLastFuturesUpdate(new Date().toLocaleTimeString());
          }
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
        const markPriceWs = new WebSocket('wss://fstream.binance.com/ws/btcusdt@markPrice@1s');

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

  // Connect to Bybit Inverse BTCUSD WebSocket
  // Endpoint: wss://stream.bybit.com/v5/public/inverse
  const lastBybitPriceRef = useRef(0);
  useEffect(() => {
    if (useManualMode) return;

    let reconnectTimeout = null;
    let pingInterval = null;

    const connectBybitWebSocket = () => {
      try {
        // Bybit V5 public inverse WebSocket
        const bybitWs = new WebSocket('wss://stream.bybit.com/v5/public/inverse');

        bybitWs.onopen = () => {
          console.log('Connected to Bybit Inverse WebSocket');
          setIsBybitConnected(true);

          // Subscribe to BTCUSD ticker and tickers (for funding rate)
          const subscribeMsg = {
            op: 'subscribe',
            args: ['tickers.BTCUSD']
          };
          bybitWs.send(JSON.stringify(subscribeMsg));

          // Bybit requires ping every 20 seconds to keep connection alive
          pingInterval = setInterval(() => {
            if (bybitWs.readyState === WebSocket.OPEN) {
              bybitWs.send(JSON.stringify({ op: 'ping' }));
            }
          }, 20000);
        };

        bybitWs.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);

            // Handle pong response
            if (message.op === 'pong' || message.ret_msg === 'pong') {
              return;
            }

            // Handle subscription confirmation
            if (message.op === 'subscribe') {
              console.log('Bybit subscription:', message.success ? 'success' : 'failed');
              return;
            }

            // Handle ticker data
            // Format: { topic: "tickers.BTCUSD", data: { symbol, lastPrice, fundingRate, nextFundingTime, ... } }
            if (message.topic && message.topic.startsWith('tickers.BTCUSD') && message.data) {
              const data = message.data;
              const price = parseFloat(data.lastPrice) || parseFloat(data.markPrice) || 0;
              const fundingRate = parseFloat(data.fundingRate) || 0;
              const nextFunding = parseInt(data.nextFundingTime) || null;

              // Throttle updates
              const roundedPrice = Math.round(price);
              if (roundedPrice > 0 && roundedPrice !== lastBybitPriceRef.current) {
                lastBybitPriceRef.current = roundedPrice;
                setBybitPrice(roundedPrice);
                setLastBybitUpdate(new Date().toLocaleTimeString());
              }

              if (fundingRate !== 0) {
                setBybitFundingRate(fundingRate);
              }
              if (nextFunding) {
                setBybitNextFundingTime(nextFunding);
              }
            }
          } catch (e) {
            console.log('Bybit WebSocket parse error:', e);
          }
        };

        bybitWs.onerror = (error) => {
          console.log('Bybit WebSocket error:', error);
          setIsBybitConnected(false);
        };

        bybitWs.onclose = () => {
          console.log('Bybit WebSocket closed, reconnecting in 5s...');
          setIsBybitConnected(false);
          if (pingInterval) clearInterval(pingInterval);
          reconnectTimeout = setTimeout(connectBybitWebSocket, 5000);
        };

        bybitWsRef.current = bybitWs;
      } catch (error) {
        console.log('Bybit WebSocket connection error:', error);
        setIsBybitConnected(false);
        reconnectTimeout = setTimeout(connectBybitWebSocket, 5000);
      }
    };

    connectBybitWebSocket();

    return () => {
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (pingInterval) clearInterval(pingInterval);
      if (bybitWsRef.current) {
        bybitWsRef.current.close();
        bybitWsRef.current = null;
      }
    };
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
    const raw = calculateTwilightFundingRate();
    const rate = (pegTwilightToCapRate && twilightFundingCapPct > 0)
      ? (twilightFundingCapPct / 100) * binanceFundingRate
      : applyTwilightFundingCap(raw, binanceFundingRate, twilightFundingCapPct);
    setFundingHistory(prev => {
      const newHistory = [...prev, {
        time: new Date().toLocaleTimeString(),
        binance: binanceFundingRate * 100, // Convert to percentage
        twilight: rate * 100
      }];
      return newHistory.length > maxHistoryLength ? newHistory.slice(-maxHistoryLength) : newHistory;
    });
  }, [binanceFundingRate, twilightLongSize, twilightShortSize, twilightFundingCapPct, pegTwilightToCapRate]);

  // ===================
  // CALCULATIONS
  // ===================

  const spread = twilightPrice - cexPrice;
  const spreadPercent = ((spread / cexPrice) * 100).toFixed(4);

  // Twilight-Bybit spread (both are inverse perps)
  const bybitSpread = bybitPrice > 0 ? twilightPrice - bybitPrice : 0;
  const bybitSpreadPercent = bybitPrice > 0 ? ((bybitSpread / bybitPrice) * 100).toFixed(4) : '0.0000';

  // Calculate Twilight funding rate based on pool imbalance (per 8h, decimal)
  // Formula: fundingrate = ((totallong - totalshort) / allpositionsize)² / (psi * 8.0 * TWILIGHT_FUNDING_SCALE). Applied 3x per day (every 8h).
  function calculateTwilightFundingRate() {
    const allPositionSize = twilightLongSize + twilightShortSize;
    if (allPositionSize === 0) return 0;

    const imbalance = (twilightLongSize - twilightShortSize) / allPositionSize;
    const fundingRate = Math.pow(imbalance, 2) / (TWILIGHT_FUNDING_PSI * 8.0 * TWILIGHT_FUNDING_SCALE);

    // Sign: positive = longs pay, negative = shorts pay
    return imbalance >= 0 ? fundingRate : -fundingRate;
  }

  // Apply cap: Twilight rate cannot exceed (capPct/100) of Binance rate. 0% = no cap.
  // Binance positive: cap positive Twilight at cap% of Binance. Binance negative: floor negative Twilight at cap% of Binance (closer to zero).
  function applyTwilightFundingCap(rawTwilight, binanceRate, capPct) {
    if (capPct <= 0) return rawTwilight;
    const capValue = (capPct / 100) * binanceRate;
    if (binanceRate >= 0) return rawTwilight > capValue ? capValue : rawTwilight;
    return rawTwilight < capValue ? capValue : rawTwilight;
  }

  const rawTwilightFundingRate = calculateTwilightFundingRate();
  const twilightFundingRate = pegTwilightToCapRate && twilightFundingCapPct > 0
    ? (twilightFundingCapPct / 100) * binanceFundingRate
    : applyTwilightFundingCap(rawTwilightFundingRate, binanceFundingRate, twilightFundingCapPct);

  // Calculate trade impact on pool skew and funding rate
  const calculateTradeImpact = (tradeSizeUSD, direction) => {
    const newLongs = direction === 'LONG'
      ? twilightLongSize + tradeSizeUSD
      : twilightLongSize;
    const newShorts = direction === 'SHORT'
      ? twilightShortSize + tradeSizeUSD
      : twilightShortSize;

    const totalSize = newLongs + newShorts;
    if (totalSize === 0) return { newSkew: 0.5, newFundingRate: 0, skewChange: 0, annualizedAPY: 0, youPay: false, youEarn: false, helpsBalance: false };

    const currentSkew = (twilightLongSize + twilightShortSize) > 0
      ? twilightLongSize / (twilightLongSize + twilightShortSize)
      : 0.5;
    const newSkew = newLongs / totalSize;
    const skewChange = newSkew - currentSkew;

    const imbalance = (newLongs - newShorts) / totalSize;
    const newFundingRateRaw = Math.pow(imbalance, 2) / (TWILIGHT_FUNDING_PSI * 8.0 * TWILIGHT_FUNDING_SCALE);
    const signedFundingRate = imbalance >= 0 ? newFundingRateRaw : -newFundingRateRaw;
    const cappedFundingRate = pegTwilightToCapRate && twilightFundingCapPct > 0
      ? (twilightFundingCapPct / 100) * binanceFundingRate
      : applyTwilightFundingCap(signedFundingRate, binanceFundingRate, twilightFundingCapPct);

    // Annualized APY (per-8h rate × 3 payments/day × 365 days)
    const annualizedAPY = Math.abs(cappedFundingRate) * 3 * 365 * 100;

    // Determine if you pay or earn
    const longsDominate = newSkew > 0.5;
    const youPay = direction === 'LONG' && longsDominate;
    const youEarn = direction === 'SHORT' && longsDominate;

    // Helps balance if your trade moves skew toward 50%
    const helpsBalance = (direction === 'LONG' && currentSkew < 0.5) ||
                         (direction === 'SHORT' && currentSkew > 0.5);

    return {
      newSkew,
      newLongs,
      newShorts,
      skewChange,
      newFundingRate: cappedFundingRate,
      annualizedAPY,
      youPay,
      youEarn,
      helpsBalance
    };
  };

  const longImpact = calculateTradeImpact(tradeSize, 'LONG');
  const shortImpact = calculateTradeImpact(tradeSize, 'SHORT');
  const currentSkew = (twilightLongSize + twilightShortSize) > 0
    ? twilightLongSize / (twilightLongSize + twilightShortSize)
    : 0.5;
  const currentTwilightAPY = Math.abs(twilightFundingRate) * 3 * 365 * 100;

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

  // Time until next Bybit funding
  const getTimeUntilBybitFunding = () => {
    if (!bybitNextFundingTime) return 'N/A';
    const now = Date.now();
    const diff = bybitNextFundingTime - now;
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
    // IMPORTANT: Twilight = INVERSE PERP (BTC-margined), Binance = LINEAR PERP (USDT-margined)
    const calculateStrategyAPY = (strategy) => {
      const {
        twilightPosition, twilightSize, twilightLeverage,
        binancePosition, binanceSize, binanceLeverage,
        holdingDays = 30
      } = strategy;

      // Maintenance margin rates
      const TWILIGHT_MAINT_MARGIN = 0.005; // 0.5%
      const BINANCE_MAINT_MARGIN = 0.004; // 0.4%

      // ===================
      // MARGIN CALCULATIONS
      // ===================

      // TWILIGHT (Inverse Perp): Margin is in BTC
      // Position size is in USD, margin = positionSize / (leverage × btcPrice) = BTC
      const twilightMarginBTC = twilightSize > 0 ? twilightSize / (twilightLeverage * btcPrice) : 0;
      const twilightMarginUSD = twilightMarginBTC * btcPrice; // Convert to USD for comparison

      // BINANCE (Linear Perp): Margin is in USDT
      // Position size is in USD, margin = positionSize / leverage = USDT
      const binanceMarginUSDT = binanceSize > 0 ? binanceSize / binanceLeverage : 0;

      // Total margin in USD equivalent (for ROI calculation)
      const totalMarginUSD = twilightMarginUSD + binanceMarginUSDT;

      // ===================
      // LIQUIDATION PRICES
      // ===================

      // TWILIGHT (Inverse Perp) Liquidation:
      // Long: Liq = Entry × Leverage / (Leverage + 1 - Leverage × MaintMargin)
      // Short: Liq = Entry × Leverage / (Leverage - 1 + Leverage × MaintMargin)
      let twilightLiquidationPrice = null;
      let twilightLiquidationPct = null;
      if (twilightPosition === 'LONG' && twilightLeverage > 0) {
        twilightLiquidationPrice = btcPrice * twilightLeverage / (twilightLeverage + 1 - twilightLeverage * TWILIGHT_MAINT_MARGIN);
        twilightLiquidationPct = ((btcPrice - twilightLiquidationPrice) / btcPrice) * 100;
      } else if (twilightPosition === 'SHORT' && twilightLeverage > 1) {
        twilightLiquidationPrice = btcPrice * twilightLeverage / (twilightLeverage - 1 + twilightLeverage * TWILIGHT_MAINT_MARGIN);
        twilightLiquidationPct = ((twilightLiquidationPrice - btcPrice) / btcPrice) * 100;
      }

      // BINANCE (Linear Perp) Liquidation:
      // Long: Liq = Entry × (1 - (1 - MaintMargin) / Leverage)
      // Short: Liq = Entry × (1 + (1 - MaintMargin) / Leverage)
      let binanceLiquidationPrice = null;
      let binanceLiquidationPct = null;
      if (binancePosition === 'LONG' && binanceLeverage > 0) {
        binanceLiquidationPrice = cexPrice * (1 - (1 - BINANCE_MAINT_MARGIN) / binanceLeverage);
        binanceLiquidationPct = ((cexPrice - binanceLiquidationPrice) / cexPrice) * 100;
      } else if (binancePosition === 'SHORT' && binanceLeverage > 0) {
        binanceLiquidationPrice = cexPrice * (1 + (1 - BINANCE_MAINT_MARGIN) / binanceLeverage);
        binanceLiquidationPct = ((binanceLiquidationPrice - cexPrice) / cexPrice) * 100;
      }

      // ===================
      // STOP LOSS & TAKE PROFIT
      // ===================

      // Stop Loss: Set at 50% of the way to liquidation (to protect capital)
      let twilightStopLoss = null;
      let twilightStopLossPct = null;
      if (twilightLiquidationPrice && twilightPosition === 'LONG') {
        twilightStopLoss = btcPrice - (btcPrice - twilightLiquidationPrice) * 0.5;
        twilightStopLossPct = ((btcPrice - twilightStopLoss) / btcPrice) * 100;
      } else if (twilightLiquidationPrice && twilightPosition === 'SHORT') {
        twilightStopLoss = btcPrice + (twilightLiquidationPrice - btcPrice) * 0.5;
        twilightStopLossPct = ((twilightStopLoss - btcPrice) / btcPrice) * 100;
      }

      let binanceStopLoss = null;
      let binanceStopLossPct = null;
      if (binanceLiquidationPrice && binancePosition === 'LONG') {
        binanceStopLoss = cexPrice - (cexPrice - binanceLiquidationPrice) * 0.5;
        binanceStopLossPct = ((cexPrice - binanceStopLoss) / cexPrice) * 100;
      } else if (binanceLiquidationPrice && binancePosition === 'SHORT') {
        binanceStopLoss = cexPrice + (binanceLiquidationPrice - cexPrice) * 0.5;
        binanceStopLossPct = ((binanceStopLoss - cexPrice) / cexPrice) * 100;
      }

      // Max loss at stop loss (in USD)
      const twilightMaxLoss = twilightStopLossPct ? (twilightStopLossPct / 100) * twilightSize : 0;
      const binanceMaxLoss = binanceStopLossPct ? (binanceStopLossPct / 100) * binanceSize : 0;
      const totalMaxLoss = twilightMaxLoss + binanceMaxLoss;

      if (totalMarginUSD === 0) return {
        apy: 0, dailyPnL: 0, monthlyPnL: 0, totalMargin: 0,
        twilightMarginBTC: 0, twilightMarginUSD: 0, binanceMarginUSDT: 0,
        totalFees: 0, basisProfit: 0, monthlyFundingPnL: 0,
        twilightLiquidationPrice: null, twilightLiquidationPct: null,
        binanceLiquidationPrice: null, binanceLiquidationPct: null,
        twilightStopLoss: null, twilightStopLossPct: null,
        binanceStopLoss: null, binanceStopLossPct: null,
        totalMaxLoss: 0, breakEvenDays: 0
      };

      // ===================
      // FEE CALCULATIONS
      // ===================

      // Twilight: 0% fee
      const twilightEntryFee = twilightSize * TWILIGHT_FEE;
      // Binance: 0.04% taker fee
      const binanceEntryFee = binanceSize * BINANCE_TAKER_FEE;
      const totalEntryFee = twilightEntryFee + binanceEntryFee;
      const totalExitFee = totalEntryFee;
      const totalFees = totalEntryFee + totalExitFee;

      // ===================
      // FUNDING CALCULATIONS
      // ===================

      // BINANCE (Linear): Funding paid/received in USDT
      // Payment = Position Size × Funding Rate (3x per day)
      const binanceFundingPerDayUSDT = binanceSize * binanceFundingRate * 3;

      // TWILIGHT (Inverse): Funding paid/received in BTC
      // Payment = Position Size × Funding Rate / BTC Price (3x per day, every 8h)
      // Then convert to USD for comparison
      const twilightFundingPerDayBTC = (twilightSize * Math.abs(twilightFundingRate) * 3) / btcPrice;
      const twilightFundingPerDayUSD = twilightFundingPerDayBTC * btcPrice;

      // Determine funding direction
      let dailyFundingPnL = 0;

      // Binance funding: positive rate = longs pay shorts
      if (binancePosition === 'LONG' && binanceFundingRate > 0) {
        dailyFundingPnL -= binanceFundingPerDayUSDT;
      } else if (binancePosition === 'LONG' && binanceFundingRate < 0) {
        dailyFundingPnL += Math.abs(binanceFundingPerDayUSDT);
      } else if (binancePosition === 'SHORT' && binanceFundingRate > 0) {
        dailyFundingPnL += binanceFundingPerDayUSDT;
      } else if (binancePosition === 'SHORT' && binanceFundingRate < 0) {
        dailyFundingPnL -= Math.abs(binanceFundingPerDayUSDT);
      }

      // Twilight funding: based on pool imbalance (converted to USD)
      if (twilightPosition === 'LONG' && twilightFundingRate > 0) {
        dailyFundingPnL -= twilightFundingPerDayUSD;
      } else if (twilightPosition === 'LONG' && twilightFundingRate < 0) {
        dailyFundingPnL += twilightFundingPerDayUSD;
      } else if (twilightPosition === 'SHORT' && twilightFundingRate > 0) {
        dailyFundingPnL += twilightFundingPerDayUSD;
      } else if (twilightPosition === 'SHORT' && twilightFundingRate < 0) {
        dailyFundingPnL -= twilightFundingPerDayUSD;
      }

      // ===================
      // BASIS PROFIT
      // ===================

      // For hedged positions, capture the spread
      let basisProfit = 0;
      if (twilightPosition && binancePosition && twilightPosition !== binancePosition) {
        // Delta-neutral: capture spread when positions converge
        // Spread profit = |spread| × position BTC size
        const positionBTC = Math.min(twilightSize, binanceSize) / btcPrice;
        basisProfit = Math.abs(spread) * positionBTC;
      }

      // ===================
      // TOTAL P&L (Funding Only - Flat Price)
      // ===================

      const monthlyFundingPnL = dailyFundingPnL * 30;
      const monthlyPnLFlat = basisProfit + monthlyFundingPnL - totalFees;
      const dailyPnL = monthlyPnLFlat / 30;

      // Break-even: days until fees are covered by funding
      const breakEvenDays = dailyFundingPnL > 0 ? Math.ceil(totalFees / dailyFundingPnL) : Infinity;

      // ===================
      // PRICE MOVEMENT SCENARIOS
      // ===================

      // Calculate P&L at different price movements (+5%, -5%, +10%, -10%)
      const priceMovements = [0.05, -0.05, 0.10, -0.10]; // 5%, -5%, 10%, -10%

      // For leveraged positions:
      // Long P&L = priceChange × leverage × positionSize
      // Short P&L = -priceChange × leverage × positionSize

      const calculatePricePnL = (priceChangePct) => {
        const newBtcPrice = btcPrice * (1 + priceChangePct);

        let twilightPricePnL = 0;
        let binancePricePnL = 0;
        let marginValueChange = 0;

        // ===================
        // TWILIGHT (INVERSE PERP) - BTC-margined
        // ===================
        // 1. Position P&L from price movement (settled in BTC, converted to USD)
        // 2. PLUS: Margin value change (BTC margin changes USD value)
        if (twilightPosition === 'LONG') {
          // Position P&L: Long profits when price goes up
          // For inverse perp: PnL(BTC) = contracts * (1/entry - 1/exit)
          // Simplified: PnL ≈ positionSize * priceChange% (in USD terms)
          twilightPricePnL = priceChangePct * twilightLeverage * twilightMarginUSD;

          // Margin value change: BTC margin now worth different USD amount
          // marginBTC * newPrice - marginBTC * oldPrice = marginBTC * priceChange
          marginValueChange += twilightMarginBTC * (newBtcPrice - btcPrice);
        } else if (twilightPosition === 'SHORT') {
          // Short profits when price goes down
          twilightPricePnL = -priceChangePct * twilightLeverage * twilightMarginUSD;

          // Margin still changes value even for shorts
          marginValueChange += twilightMarginBTC * (newBtcPrice - btcPrice);
        }

        // ===================
        // BINANCE (LINEAR PERP) - USDT-margined
        // ===================
        // Position P&L from price movement (settled in USDT)
        // No margin value change - USDT stays at $1
        if (binancePosition === 'LONG') {
          binancePricePnL = priceChangePct * binanceLeverage * binanceMarginUSDT;
        } else if (binancePosition === 'SHORT') {
          binancePricePnL = -priceChangePct * binanceLeverage * binanceMarginUSDT;
        }

        // Net position P&L (without margin value change)
        const netPositionPnL = twilightPricePnL + binancePricePnL;

        // Total price-related P&L includes margin value change
        const netPricePnL = netPositionPnL + marginValueChange;

        // Total P&L = Price P&L + Margin Change + Basis Capture + Funding P&L (30 days) - Fees
        const totalPricePnL = netPricePnL + basisProfit + monthlyFundingPnL - totalFees;

        return {
          total: totalPricePnL,
          priceOnly: netPricePnL,
          positionPnL: netPositionPnL,
          marginChange: marginValueChange
        };
      };

      const pnlUp5Result = calculatePricePnL(0.05);
      const pnlDown5Result = calculatePricePnL(-0.05);
      const pnlUp10Result = calculatePricePnL(0.10);
      const pnlDown10Result = calculatePricePnL(-0.10);

      const pnlUp5 = pnlUp5Result.total;
      const pnlDown5 = pnlDown5Result.total;
      const pnlUp10 = pnlUp10Result.total;
      const pnlDown10 = pnlDown10Result.total;

      // Price-only P&L (includes position P&L + margin value change)
      const priceOnlyUp5 = pnlUp5Result.priceOnly;
      const priceOnlyDown5 = pnlDown5Result.priceOnly;
      const priceOnlyUp10 = pnlUp10Result.priceOnly;
      const priceOnlyDown10 = pnlDown10Result.priceOnly;

      // Margin value change (BTC margin appreciates/depreciates with price)
      const marginChangeUp5 = pnlUp5Result.marginChange;
      const marginChangeDown5 = pnlDown5Result.marginChange;
      const marginChangeUp10 = pnlUp10Result.marginChange;
      const marginChangeDown10 = pnlDown10Result.marginChange;

      // Determine market direction this strategy is best for
      let marketDirection = 'NEUTRAL';
      let directionDescription = '';

      if (twilightPosition && binancePosition && twilightPosition !== binancePosition) {
        // Hedged/Delta-neutral
        marketDirection = 'NEUTRAL';
        directionDescription = 'Profits from funding regardless of price direction. Best for sideways/ranging markets.';
      } else if ((twilightPosition === 'LONG' && !binancePosition) ||
                 (binancePosition === 'LONG' && !twilightPosition) ||
                 (twilightPosition === 'LONG' && binancePosition === 'LONG')) {
        marketDirection = 'BULLISH';
        directionDescription = 'Profits when BTC price goes UP. Loses when price goes DOWN.';
      } else if ((twilightPosition === 'SHORT' && !binancePosition) ||
                 (binancePosition === 'SHORT' && !twilightPosition) ||
                 (twilightPosition === 'SHORT' && binancePosition === 'SHORT')) {
        marketDirection = 'BEARISH';
        directionDescription = 'Profits when BTC price goes DOWN. Loses when price goes UP.';
      }

      // Calculate break-even price move needed (to cover funding costs if negative)
      let breakEvenPriceMove = 0;
      if (monthlyFundingPnL < 0) {
        // Need price to move to cover funding losses
        const totalLevMargin = (twilightPosition ? twilightLeverage * twilightMarginUSD : 0) +
                               (binancePosition ? binanceLeverage * binanceMarginUSDT : 0);
        if (totalLevMargin > 0) {
          // For longs: need price up, for shorts: need price down
          breakEvenPriceMove = Math.abs(monthlyFundingPnL - totalFees) / totalLevMargin;
        }
      }

      // APY calculation based on total capital deployed (flat price scenario)
      const monthlyROI = (monthlyPnLFlat / totalMarginUSD) * 100;
      const apy = monthlyROI * 12;

      // APY with +5% price move
      const apyUp5 = ((pnlUp5 / totalMarginUSD) * 100) * 12;
      const apyDown5 = ((pnlDown5 / totalMarginUSD) * 100) * 12;

      return {
        apy: isNaN(apy) ? 0 : apy,
        dailyPnL: isNaN(dailyPnL) ? 0 : dailyPnL,
        monthlyPnL: isNaN(monthlyPnLFlat) ? 0 : monthlyPnLFlat,
        totalMargin: totalMarginUSD,
        twilightMarginBTC,
        twilightMarginUSD,
        binanceMarginUSDT,
        totalFees,
        basisProfit,
        monthlyFundingPnL,
        // Risk management
        twilightLiquidationPrice,
        twilightLiquidationPct,
        binanceLiquidationPrice,
        binanceLiquidationPct,
        twilightStopLoss,
        twilightStopLossPct,
        binanceStopLoss,
        binanceStopLossPct,
        totalMaxLoss,
        breakEvenDays: isFinite(breakEvenDays) ? breakEvenDays : null,
        // Price movement scenarios
        marketDirection,
        directionDescription,
        pnlUp5,
        pnlDown5,
        pnlUp10,
        pnlDown10,
        // Price-only P&L (position P&L + margin value change)
        priceOnlyUp5,
        priceOnlyDown5,
        priceOnlyUp10,
        priceOnlyDown10,
        // BTC margin value change (only for inverse perp positions)
        marginChangeUp5,
        marginChangeDown5,
        marginChangeUp10,
        marginChangeDown10,
        apyUp5: isNaN(apyUp5) ? 0 : apyUp5,
        apyDown5: isNaN(apyDown5) ? 0 : apyDown5,
        breakEvenPriceMove: breakEvenPriceMove * 100 // Convert to percentage
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

    // ===================
    // PROFITABLE SHORT STRATEGIES (No Double Funding Bleed)
    // ===================

    // Strategy: Stablecoin Position (SHORT only, no CEX hedge)
    // For BTC holders who want USD-stable exposure without double funding costs
    const stablecoinSize = Math.min(150, tvl);
    strategies.push({
      id: id++,
      name: `Stablecoin Position (No Hedge)`,
      description: `SHORT on Twilight only. No CEX hedge = no funding bleed. Creates stable USD value if you hold spot BTC. Earn funding when longs > shorts.`,
      category: 'Capital Efficient',
      twilightPosition: 'SHORT',
      twilightSize: stablecoinSize,
      twilightLeverage: 10,
      binancePosition: null,
      binanceSize: 0,
      binanceLeverage: 0,
      risk: 'LOW',
      ...calculateStrategyAPY({
        twilightPosition: 'SHORT', twilightSize: stablecoinSize, twilightLeverage: 10,
        binancePosition: null, binanceSize: 0, binanceLeverage: 0
      })
    });

    // Strategy: Funding Harvesting (SHORT when book is long-heavy)
    // Only profitable when Twilight longs > shorts (shorts receive funding)
    const harvestSize = Math.min(200, tvl);
    const isLongHeavy = currentSkew > 0.55;
    strategies.push({
      id: id++,
      name: `Funding Harvest ${isLongHeavy ? '✓' : '✗'} (SHORT)`,
      description: isLongHeavy
        ? `PROFITABLE NOW! Book is ${(currentSkew * 100).toFixed(1)}% long. Shorts EARN ${currentTwilightAPY.toFixed(1)}% APY. No CEX hedge needed.`
        : `NOT PROFITABLE NOW. Book is ${(currentSkew * 100).toFixed(1)}% long. Wait until >55% long to SHORT.`,
      category: 'Funding Harvest',
      twilightPosition: 'SHORT',
      twilightSize: harvestSize,
      twilightLeverage: 15,
      binancePosition: null,
      binanceSize: 0,
      binanceLeverage: 0,
      risk: isLongHeavy ? 'LOW' : 'HIGH',
      ...calculateStrategyAPY({
        twilightPosition: 'SHORT', twilightSize: harvestSize, twilightLeverage: 15,
        binancePosition: null, binanceSize: 0, binanceLeverage: 0
      }),
      // Override APY to show actual funding earned/paid
      apy: isLongHeavy ? currentTwilightAPY : -currentTwilightAPY,
      monthlyPnL: isLongHeavy
        ? (harvestSize * (currentTwilightAPY / 100) / 12)
        : -(harvestSize * (currentTwilightAPY / 100) / 12)
    });

    // Strategy: Pure LONG Position (LONG only, no CEX hedge)
    // For traders who want leveraged BTC exposure without hedge costs
    strategies.push({
      id: id++,
      name: `Leveraged Long (No Hedge)`,
      description: `LONG on Twilight only. No CEX hedge = no funding bleed. Earn funding when shorts > longs (book is short-heavy).`,
      category: 'Capital Efficient',
      twilightPosition: 'LONG',
      twilightSize: stablecoinSize,
      twilightLeverage: 10,
      binancePosition: null,
      binanceSize: 0,
      binanceLeverage: 0,
      risk: 'MEDIUM',
      ...calculateStrategyAPY({
        twilightPosition: 'LONG', twilightSize: stablecoinSize, twilightLeverage: 10,
        binancePosition: null, binanceSize: 0, binanceLeverage: 0
      })
    });

    // Strategy: LONG Funding Harvesting (LONG when book is short-heavy)
    const isShortHeavy = currentSkew < 0.45;
    strategies.push({
      id: id++,
      name: `Funding Harvest ${isShortHeavy ? '✓' : '✗'} (LONG)`,
      description: isShortHeavy
        ? `PROFITABLE NOW! Book is ${(currentSkew * 100).toFixed(1)}% long. Longs EARN ${currentTwilightAPY.toFixed(1)}% APY. No CEX hedge needed.`
        : `NOT PROFITABLE NOW. Book is ${(currentSkew * 100).toFixed(1)}% long. Wait until <45% long to go LONG.`,
      category: 'Funding Harvest',
      twilightPosition: 'LONG',
      twilightSize: harvestSize,
      twilightLeverage: 15,
      binancePosition: null,
      binanceSize: 0,
      binanceLeverage: 0,
      risk: isShortHeavy ? 'LOW' : 'HIGH',
      ...calculateStrategyAPY({
        twilightPosition: 'LONG', twilightSize: harvestSize, twilightLeverage: 15,
        binancePosition: null, binanceSize: 0, binanceLeverage: 0
      }),
      // Override APY to show actual funding earned/paid
      apy: isShortHeavy ? currentTwilightAPY : -currentTwilightAPY,
      monthlyPnL: isShortHeavy
        ? (harvestSize * (currentTwilightAPY / 100) / 12)
        : -(harvestSize * (currentTwilightAPY / 100) / 12)
    });

    // Strategy: Dual Funding Arbitrage (Only when BOTH rates align)
    // SHORT Twilight + SHORT Binance (only when Binance funding is negative)
    const isBinanceNegative = binanceFundingRate < 0;
    const isDualArbProfitable = isLongHeavy && isBinanceNegative;
    strategies.push({
      id: id++,
      name: `Dual SHORT Arb ${isDualArbProfitable ? '✓✓' : '✗'}`,
      description: isDualArbProfitable
        ? `RARE OPPORTUNITY! Both sides pay YOU. Twilight: shorts earn (${(currentSkew * 100).toFixed(0)}% long). Binance: shorts earn (${(binanceFundingRate * 100).toFixed(4)}% negative).`
        : `NOT PROFITABLE. Need: Twilight long-heavy (${isLongHeavy ? '✓' : '✗'}) AND Binance funding negative (${isBinanceNegative ? '✓' : '✗'}).`,
      category: 'Dual Arb',
      twilightPosition: 'SHORT',
      twilightSize: harvestSize,
      twilightLeverage: 15,
      binancePosition: 'SHORT',
      binanceSize: harvestSize,
      binanceLeverage: 5,
      risk: isDualArbProfitable ? 'LOW' : 'HIGH',
      ...calculateStrategyAPY({
        twilightPosition: 'SHORT', twilightSize: harvestSize, twilightLeverage: 15,
        binancePosition: 'SHORT', binanceSize: harvestSize, binanceLeverage: 5
      }),
      // Override to show combined earnings when profitable
      apy: isDualArbProfitable
        ? currentTwilightAPY + Math.abs(binanceFundingRate * 3 * 365 * 100)
        : -(currentTwilightAPY + Math.abs(binanceFundingRate * 3 * 365 * 100))
    });

    // Strategy: Dual LONG Arbitrage (Only when BOTH rates align opposite way)
    const isBinancePositive = binanceFundingRate > 0.0001;
    const isDualLongArbProfitable = isShortHeavy && isBinancePositive;
    strategies.push({
      id: id++,
      name: `Dual LONG Arb ${isDualLongArbProfitable ? '✓✓' : '✗'}`,
      description: isDualLongArbProfitable
        ? `RARE OPPORTUNITY! Both sides pay YOU. Twilight: longs earn (${(currentSkew * 100).toFixed(0)}% short-heavy). Binance: longs earn (${(binanceFundingRate * 100).toFixed(4)}% positive).`
        : `NOT PROFITABLE. Need: Twilight short-heavy (${isShortHeavy ? '✓' : '✗'}) AND Binance funding positive (${isBinancePositive ? '✓' : '✗'}).`,
      category: 'Dual Arb',
      twilightPosition: 'LONG',
      twilightSize: harvestSize,
      twilightLeverage: 15,
      binancePosition: 'LONG',
      binanceSize: harvestSize,
      binanceLeverage: 5,
      risk: isDualLongArbProfitable ? 'LOW' : 'HIGH',
      ...calculateStrategyAPY({
        twilightPosition: 'LONG', twilightSize: harvestSize, twilightLeverage: 15,
        binancePosition: 'LONG', binanceSize: harvestSize, binanceLeverage: 5
      }),
      apy: isDualLongArbProfitable
        ? currentTwilightAPY + Math.abs(binanceFundingRate * 3 * 365 * 100)
        : -(currentTwilightAPY + Math.abs(binanceFundingRate * 3 * 365 * 100))
    });

    // ===================
    // BYBIT INVERSE BTCUSD STRATEGIES
    // Both Twilight and Bybit are inverse (BTC-margined) perpetuals
    // This creates true BTC-denominated delta-neutral positions
    // ===================
    if (bybitPrice > 0) {
      const BYBIT_TAKER_FEE = 0.00055; // 0.055% taker fee
      const bybitAnnualizedFunding = Math.abs(bybitFundingRate) * 3 * 365 * 100; // Bybit has 3 funding payments per day
      const isBybitNegative = bybitFundingRate < 0;
      const isBybitPositive = bybitFundingRate > 0.00005;

      // Calculate full strategy metrics for Bybit inverse strategies
      const calculateBybitStrategy = (twilightPos, twilightSize, twilightLev, bybitPos, bybitSize, bybitLev) => {
        // Twilight margin (BTC-margined inverse perp)
        const twilightMarginBTC = twilightSize / (twilightLev * btcPrice);
        const twilightMarginUSD = twilightMarginBTC * btcPrice;

        // Bybit margin (BTC-margined inverse perp)
        const bybitMarginBTC = bybitSize / (bybitLev * bybitPrice);
        const bybitMarginUSD = bybitMarginBTC * bybitPrice;

        // Total margin in USD
        const totalMargin = twilightMarginUSD + bybitMarginUSD;

        // Twilight funding calculation
        const twilightFundingEarned = twilightPos === 'LONG'
          ? (isShortHeavy ? currentTwilightAPY : -currentTwilightAPY)
          : (isLongHeavy ? currentTwilightAPY : -currentTwilightAPY);

        // Bybit funding calculation
        const bybitFundingEarned = bybitPos === 'LONG'
          ? (isBybitNegative ? bybitAnnualizedFunding : -bybitAnnualizedFunding)
          : (isBybitPositive ? bybitAnnualizedFunding : -bybitAnnualizedFunding);

        // Combined APY
        const combinedAPY = twilightFundingEarned + bybitFundingEarned;

        // Monthly funding P&L
        const twilightMonthlyFunding = twilightSize * (twilightFundingEarned / 100) / 12;
        const bybitMonthlyFunding = bybitSize * (bybitFundingEarned / 100) / 12;
        const monthlyFundingPnL = twilightMonthlyFunding + bybitMonthlyFunding;

        // Fees (Bybit only - Twilight is 0%)
        const bybitFees = bybitSize * BYBIT_TAKER_FEE * 2; // Entry + exit
        const totalFees = bybitFees;

        // Monthly P&L
        const monthlyPnL = monthlyFundingPnL - (totalFees / 12);

        // P&L at different price moves (delta-neutral so price P&L should cancel)
        // For inverse perps, both positions move in BTC terms
        const pnlUp5 = monthlyPnL; // Delta neutral
        const pnlUp10 = monthlyPnL;
        const pnlDown5 = monthlyPnL;
        const pnlDown10 = monthlyPnL;

        // Liquidation prices
        const twilightLiqPct = 100 / twilightLev * 0.9;
        const twilightLiqPrice = twilightPos === 'LONG'
          ? btcPrice * (1 - twilightLiqPct / 100)
          : btcPrice * (1 + twilightLiqPct / 100);

        const bybitLiqPct = 100 / bybitLev * 0.9;
        const bybitLiqPrice = bybitPos === 'LONG'
          ? bybitPrice * (1 - bybitLiqPct / 100)
          : bybitPrice * (1 + bybitLiqPct / 100);

        return {
          twilightMarginBTC,
          twilightMarginUSD,
          bybitMarginBTC,
          bybitMarginUSD,
          totalMargin,
          monthlyFundingPnL,
          basisProfit: 0, // No basis profit for same-direction hedge
          totalFees,
          monthlyPnL,
          apy: (monthlyPnL / totalMargin) * 12 * 100,
          pnlUp5,
          pnlUp10,
          pnlDown5,
          pnlDown10,
          priceOnlyUp5: 0,
          priceOnlyUp10: 0,
          priceOnlyDown5: 0,
          priceOnlyDown10: 0,
          marginChangeUp5: 0,
          marginChangeUp10: 0,
          marginChangeDown5: 0,
          marginChangeDown10: 0,
          twilightLiquidationPrice: twilightLiqPrice,
          twilightLiquidationPct: twilightLiqPct,
          bybitLiquidationPrice: bybitLiqPrice,
          bybitLiquidationPct: bybitLiqPct,
          twilightStopLoss: twilightPos === 'LONG' ? twilightLiqPrice * 1.1 : twilightLiqPrice * 0.9,
          twilightStopLossPct: twilightLiqPct * 0.8,
          totalMaxLoss: totalMargin * 0.1,
          breakEvenDays: totalFees > 0 ? Math.ceil(totalFees / (monthlyFundingPnL / 30)) : 1
        };
      };

      // Strategy 1: SHORT Twilight + LONG Bybit Inverse (10x)
      const bybitSize1 = Math.min(200, tvl);
      const strat1 = calculateBybitStrategy('SHORT', bybitSize1, 10, 'LONG', bybitSize1, 10);
      const isShortTwiLongBybitProfitable = isLongHeavy && isBybitNegative;

      strategies.push({
        id: id++,
        name: `Inverse Arb: Short Twi / Long Bybit ${isShortTwiLongBybitProfitable ? '✓✓' : ''}`,
        description: isShortTwiLongBybitProfitable
          ? `INVERSE PERP ARB! Both BTC-margined. Twilight shorts earn (${(currentSkew * 100).toFixed(0)}% long). Bybit longs earn (${(bybitFundingRate * 100).toFixed(4)}% negative). True BTC delta-neutral.`
          : `Inverse perp hedge. Twilight: ${isLongHeavy ? 'shorts earn ✓' : 'shorts pay ✗'}. Bybit: ${isBybitNegative ? 'longs earn ✓' : 'longs pay ✗'}. Both BTC-margined = no USD conversion risk.`,
        category: 'Bybit Inverse',
        twilightPosition: 'SHORT',
        twilightSize: bybitSize1,
        twilightLeverage: 10,
        binancePosition: 'LONG', // Use binance fields for Bybit to work with existing UI
        binanceSize: bybitSize1,
        binanceLeverage: 10,
        risk: isShortTwiLongBybitProfitable ? 'LOW' : 'MEDIUM',
        isBybitStrategy: true,
        bybitPrice,
        bybitFundingRate,
        ...strat1
      });

      // Strategy 2: LONG Twilight + SHORT Bybit Inverse (10x)
      const strat2 = calculateBybitStrategy('LONG', bybitSize1, 10, 'SHORT', bybitSize1, 10);
      const isLongTwiShortBybitProfitable = isShortHeavy && isBybitPositive;

      strategies.push({
        id: id++,
        name: `Inverse Arb: Long Twi / Short Bybit ${isLongTwiShortBybitProfitable ? '✓✓' : ''}`,
        description: isLongTwiShortBybitProfitable
          ? `INVERSE PERP ARB! Both BTC-margined. Twilight longs earn (${(currentSkew * 100).toFixed(0)}% short-heavy). Bybit shorts earn (${(bybitFundingRate * 100).toFixed(4)}% positive). True BTC delta-neutral.`
          : `Inverse perp hedge. Twilight: ${isShortHeavy ? 'longs earn ✓' : 'longs pay ✗'}. Bybit: ${isBybitPositive ? 'shorts earn ✓' : 'shorts pay ✗'}. Both BTC-margined = no USD conversion risk.`,
        category: 'Bybit Inverse',
        twilightPosition: 'LONG',
        twilightSize: bybitSize1,
        twilightLeverage: 10,
        binancePosition: 'SHORT',
        binanceSize: bybitSize1,
        binanceLeverage: 10,
        risk: isLongTwiShortBybitProfitable ? 'LOW' : 'MEDIUM',
        isBybitStrategy: true,
        bybitPrice,
        bybitFundingRate,
        ...strat2
      });

      // Strategy 3: Max Leverage (20x)
      const maxInverseSize = Math.min(300, tvl);
      const strat3 = calculateBybitStrategy('SHORT', maxInverseSize, 20, 'LONG', maxInverseSize, 20);

      strategies.push({
        id: id++,
        name: `Max Inverse Arb 20x: Short Twi / Long Bybit`,
        description: `Maximum leverage inverse arb. Both platforms BTC-margined. Position: $${maxInverseSize} each side @ 20x. Delta-neutral in BTC terms.`,
        category: 'Bybit Inverse',
        twilightPosition: 'SHORT',
        twilightSize: maxInverseSize,
        twilightLeverage: 20,
        binancePosition: 'LONG',
        binanceSize: maxInverseSize,
        binanceLeverage: 20,
        risk: 'HIGH',
        isBybitStrategy: true,
        bybitPrice,
        bybitFundingRate,
        ...strat3
      });

      // Strategy 4: Conservative (5x)
      const strat4 = calculateBybitStrategy('SHORT', 100, 5, 'LONG', 100, 5);

      strategies.push({
        id: id++,
        name: `Conservative Inverse 5x: Short Twi / Long Bybit`,
        description: `Low leverage inverse arb for safety. Both BTC-margined. Lower liquidation risk. Good for beginners.`,
        category: 'Bybit Inverse',
        twilightPosition: 'SHORT',
        twilightSize: 100,
        twilightLeverage: 5,
        binancePosition: 'LONG',
        binanceSize: 100,
        binanceLeverage: 5,
        risk: 'LOW',
        isBybitStrategy: true,
        bybitPrice,
        bybitFundingRate,
        ...strat4
      });

      // Strategy 5: High Funding Capture 15x
      const strat5 = calculateBybitStrategy('SHORT', 200, 15, 'LONG', 200, 15);

      strategies.push({
        id: id++,
        name: `Funding Capture 15x: Short Twi / Long Bybit ${isShortTwiLongBybitProfitable ? '✓' : ''}`,
        description: `Higher leverage (15x) for amplified funding capture. Both BTC-margined inverse perps. Moderate liquidation risk with higher returns.`,
        category: 'Bybit Inverse',
        twilightPosition: 'SHORT',
        twilightSize: 200,
        twilightLeverage: 15,
        binancePosition: 'LONG',
        binanceSize: 200,
        binanceLeverage: 15,
        risk: 'MEDIUM',
        isBybitStrategy: true,
        bybitPrice,
        bybitFundingRate,
        ...strat5
      });

      // Strategy 6: Large Position 10x ($500)
      const largeSize = Math.min(500, tvl);
      const strat6 = calculateBybitStrategy('SHORT', largeSize, 10, 'LONG', largeSize, 10);

      strategies.push({
        id: id++,
        name: `Large Inverse Arb 10x: Short Twi / Long Bybit`,
        description: `Larger $${largeSize} position @ 10x on both sides. More absolute profit potential with standard risk.`,
        category: 'Bybit Inverse',
        twilightPosition: 'SHORT',
        twilightSize: largeSize,
        twilightLeverage: 10,
        binancePosition: 'LONG',
        binanceSize: largeSize,
        binanceLeverage: 10,
        risk: 'MEDIUM',
        isBybitStrategy: true,
        bybitPrice,
        bybitFundingRate,
        ...strat6
      });

      // Strategy 7: Mini Position 3x (Very Conservative)
      const strat7 = calculateBybitStrategy('SHORT', 50, 3, 'LONG', 50, 3);

      strategies.push({
        id: id++,
        name: `Mini Inverse 3x: Short Twi / Long Bybit`,
        description: `Minimal leverage (3x) for beginners. Very low liquidation risk. $50 position. Learn inverse perp arb safely.`,
        category: 'Bybit Inverse',
        twilightPosition: 'SHORT',
        twilightSize: 50,
        twilightLeverage: 3,
        binancePosition: 'LONG',
        binanceSize: 50,
        binanceLeverage: 3,
        risk: 'VERY LOW',
        isBybitStrategy: true,
        bybitPrice,
        bybitFundingRate,
        ...strat7
      });

      // Strategy 8: Asymmetric Leverage (5x Twi / 10x Bybit)
      // Lower leverage on Twilight for safety, higher on Bybit for returns
      const strat8 = calculateBybitStrategy('SHORT', 150, 5, 'LONG', 150, 10);

      strategies.push({
        id: id++,
        name: `Asymmetric 5x/10x: Short Twi / Long Bybit`,
        description: `Lower leverage on Twilight (5x) for safety, higher on Bybit (10x). Asymmetric risk profile. Safer on shorts.`,
        category: 'Bybit Inverse',
        twilightPosition: 'SHORT',
        twilightSize: 150,
        twilightLeverage: 5,
        binancePosition: 'LONG',
        binanceSize: 150,
        binanceLeverage: 10,
        risk: 'LOW',
        isBybitStrategy: true,
        bybitPrice,
        bybitFundingRate,
        ...strat8
      });

      // Strategy 9: Spread Capture Strategy
      // When Twilight-Bybit spread is significant, capture the price difference
      const spreadBps = bybitPrice > 0 ? Math.abs((twilightPrice - bybitPrice) / bybitPrice * 10000) : 0;
      const isSpreadSignificant = spreadBps > 5; // >5 bps spread
      const strat9 = calculateBybitStrategy('SHORT', 300, 10, 'LONG', 300, 10);

      strategies.push({
        id: id++,
        name: `Spread Capture 10x ${isSpreadSignificant ? '📈' : ''}`,
        description: isSpreadSignificant
          ? `SPREAD OPPORTUNITY! ${spreadBps.toFixed(1)} bps spread. Short higher-priced venue, long lower-priced. Spread: $${Math.abs(twilightPrice - bybitPrice).toFixed(2)}`
          : `Capture price spread between venues. Current spread: ${spreadBps.toFixed(1)} bps. More profitable when spread widens.`,
        category: 'Bybit Inverse',
        twilightPosition: twilightPrice > bybitPrice ? 'SHORT' : 'LONG',
        twilightSize: 300,
        twilightLeverage: 10,
        binancePosition: twilightPrice > bybitPrice ? 'LONG' : 'SHORT',
        binanceSize: 300,
        binanceLeverage: 10,
        risk: 'MEDIUM',
        isBybitStrategy: true,
        bybitPrice,
        bybitFundingRate,
        spreadBps,
        ...strat9
      });

      // Strategy 10: Funding Differential Capture
      // Pure funding arbitrage - earn from both platforms when funding aligns (both per 8h)
      const twilightPer8hPct = twilightFundingRate * 100;
      const bybitPer8hPct = bybitFundingRate * 100;
      const fundingDiff = Math.abs(twilightPer8hPct - bybitPer8hPct);
      const isFundingDiffLarge = fundingDiff > 0.001;
      const strat10 = calculateBybitStrategy('SHORT', 250, 10, 'LONG', 250, 10);

      strategies.push({
        id: id++,
        name: `Funding Diff Capture ${isFundingDiffLarge ? '💰' : ''}`,
        description: `Capture funding rate differential. Twilight: ${twilightPer8hPct.toFixed(4)}%/8h. Bybit: ${bybitPer8hPct.toFixed(4)}%/8h. Diff: ${fundingDiff.toFixed(4)}%/8h.`,
        category: 'Bybit Inverse',
        twilightPosition: 'SHORT',
        twilightSize: 250,
        twilightLeverage: 10,
        binancePosition: 'LONG',
        binanceSize: 250,
        binanceLeverage: 10,
        risk: 'MEDIUM',
        isBybitStrategy: true,
        bybitPrice,
        bybitFundingRate,
        fundingDiff,
        ...strat10
      });

      // Strategy 11: Reverse Large Position (Long Twi / Short Bybit)
      const strat11 = calculateBybitStrategy('LONG', largeSize, 10, 'SHORT', largeSize, 10);

      strategies.push({
        id: id++,
        name: `Large Reverse Arb 10x: Long Twi / Short Bybit ${isLongTwiShortBybitProfitable ? '✓' : ''}`,
        description: `Larger $${largeSize} reverse position. Long Twilight + Short Bybit. Profitable when shorts dominate Twilight & Bybit positive funding.`,
        category: 'Bybit Inverse',
        twilightPosition: 'LONG',
        twilightSize: largeSize,
        twilightLeverage: 10,
        binancePosition: 'SHORT',
        binanceSize: largeSize,
        binanceLeverage: 10,
        risk: isLongTwiShortBybitProfitable ? 'LOW' : 'MEDIUM',
        isBybitStrategy: true,
        bybitPrice,
        bybitFundingRate,
        ...strat11
      });

      // Strategy 12: Conservative Reverse (5x)
      const strat12 = calculateBybitStrategy('LONG', 100, 5, 'SHORT', 100, 5);

      strategies.push({
        id: id++,
        name: `Conservative Reverse 5x: Long Twi / Short Bybit`,
        description: `Low leverage reverse position. Long Twilight + Short Bybit. Good when Twilight shorts dominate.`,
        category: 'Bybit Inverse',
        twilightPosition: 'LONG',
        twilightSize: 100,
        twilightLeverage: 5,
        binancePosition: 'SHORT',
        binanceSize: 100,
        binanceLeverage: 5,
        risk: 'LOW',
        isBybitStrategy: true,
        bybitPrice,
        bybitFundingRate,
        ...strat12
      });
    }

    return strategies.sort((a, b) => b.apy - a.apy);
  }, [twilightPrice, cexPrice, spread, binanceFundingRate, twilightFundingRate, tvl, currentSkew, currentTwilightAPY, bybitPrice, bybitFundingRate]);

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
      case 'Capital Efficient': return 'bg-emerald-100 text-emerald-800';
      case 'Funding Harvest': return 'bg-amber-100 text-amber-800';
      case 'Dual Arb': return 'bg-cyan-100 text-cyan-800';
      case 'Bybit Inverse': return 'bg-violet-100 text-violet-800';
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
              <h1 className="text-3xl font-bold text-slate-800">
                Twilight Strategy Tester
                {!useManualMode && <span className="text-red-500 animate-pulse ml-3 text-xl">LIVE</span>}
              </h1>
              {onNavigateToCEX && (
                <button
                  onClick={onNavigateToCEX}
                  className="flex items-center gap-1 px-3 py-1 bg-purple-600 text-white rounded-lg text-sm hover:bg-purple-700 transition"
                >
                  Compare CEX
                  <ArrowRight className="w-4 h-4" />
                </button>
              )}
            </div>
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
            <div className="flex items-center gap-1">
              {isBybitConnected ? <Wifi className="w-4 h-4 text-green-500" /> : <WifiOff className="w-4 h-4 text-red-500" />}
              <span className="text-xs">Bybit</span>
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
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 mb-6">
        <div className="bg-white rounded-lg p-3 shadow">
          <div className="text-xs text-slate-500">Twilight (Spot)</div>
          <div className="text-xl font-bold text-blue-600">${twilightPrice.toLocaleString()}</div>
          <div className="text-xs text-slate-400">{lastSpotUpdate || 'Connecting...'}</div>
        </div>

        <div className="bg-white rounded-lg p-3 shadow">
          <div className="text-xs text-slate-500">Binance Perp (Linear)</div>
          <div className="text-xl font-bold text-purple-600">${cexPrice.toLocaleString()}</div>
          <div className="text-xs text-slate-400">{lastFuturesUpdate || 'Connecting...'}</div>
        </div>

        <div className="bg-white rounded-lg p-3 shadow border-2 border-violet-200">
          <div className="text-xs text-slate-500">Bybit Inverse BTCUSD</div>
          <div className="text-xl font-bold text-violet-600">
            {bybitPrice > 0 ? `$${bybitPrice.toLocaleString()}` : 'Connecting...'}
          </div>
          <div className="text-xs text-slate-400">{lastBybitUpdate || 'Waiting...'}</div>
        </div>

        <div className="bg-white rounded-lg p-3 shadow">
          <div className="text-xs text-slate-500">Spread (Twi-Bin)</div>
          <div className={`text-xl font-bold ${spread >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {spread >= 0 ? '+' : ''}{spreadPercent}%
          </div>
          <div className="text-xs text-slate-400">${spread.toFixed(2)}</div>
        </div>

        <div className="bg-white rounded-lg p-3 shadow border-2 border-violet-200">
          <div className="text-xs text-slate-500">Spread (Twi-Bybit)</div>
          <div className={`text-xl font-bold ${bybitSpread >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {bybitSpread >= 0 ? '+' : ''}{bybitSpreadPercent}%
          </div>
          <div className="text-xs text-slate-400">${bybitSpread.toFixed(2)}</div>
        </div>

        <div className="bg-white rounded-lg p-3 shadow">
          <div className="text-xs text-slate-500">Binance Funding (8h)</div>
          <div className={`text-xl font-bold ${binanceFundingRate >= 0 ? 'text-orange-600' : 'text-blue-600'}`}>
            {binanceFundingRate >= 0 ? '+' : ''}{(binanceFundingRate * 100).toFixed(6)}%
          </div>
          <div className="text-xs text-slate-400">Next: {getTimeUntilFunding()}</div>
        </div>

        <div className="bg-white rounded-lg p-3 shadow border-2 border-violet-200">
          <div className="text-xs text-slate-500">Bybit Funding (8h)</div>
          <div className={`text-xl font-bold ${bybitFundingRate >= 0 ? 'text-orange-600' : 'text-blue-600'}`}>
            {bybitFundingRate >= 0 ? '+' : ''}{(bybitFundingRate * 100).toFixed(4)}%
          </div>
          <div className="text-xs text-slate-400">Next: {getTimeUntilBybitFunding()} | APY: {(Math.abs(bybitFundingRate) * 3 * 365 * 100).toFixed(1)}%</div>
        </div>
      </div>

      {/* Twilight-Bybit Arbitrage Opportunity Banner */}
      {bybitPrice > 0 && (
        <div className={`rounded-lg p-4 shadow mb-6 ${Math.abs(parseFloat(bybitSpreadPercent)) > 0.05 ? 'bg-gradient-to-r from-violet-100 to-purple-100 border-2 border-violet-300' : 'bg-white'}`}>
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <Activity className="w-6 h-6 text-violet-600" />
              <div>
                <div className="font-bold text-slate-800">Twilight ↔ Bybit Inverse Arbitrage</div>
                <div className="text-sm text-slate-600">
                  Spread: <span className={`font-bold ${bybitSpread >= 0 ? 'text-green-600' : 'text-red-600'}`}>{bybitSpread >= 0 ? '+' : ''}{bybitSpreadPercent}%</span>
                  {' '}| Combined APY: <span className="font-bold text-violet-600">{(currentTwilightAPY + Math.abs(bybitFundingRate) * 3 * 365 * 100).toFixed(1)}%</span>
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  Twilight: <span className={currentSkew > 0.5 ? 'text-green-600' : 'text-red-600'}>{currentSkew > 0.5 ? 'Shorts earn' : 'Longs earn'}</span>
                  {' '}| Bybit: <span className={bybitFundingRate > 0 ? 'text-green-600' : 'text-red-600'}>{bybitFundingRate > 0 ? 'Shorts earn' : 'Longs earn'}</span>
                  {' '}| Best: <span className="font-bold text-violet-700">
                    {currentSkew > 0.5 && bybitFundingRate < 0 ? 'Short Twi + Long Bybit ✓✓' :
                     currentSkew <= 0.5 && bybitFundingRate > 0 ? 'Long Twi + Short Bybit ✓✓' :
                     currentSkew > 0.5 ? 'Short Twi + Long Bybit ✓' : 'Long Twi + Short Bybit ✓'}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              {Math.abs(parseFloat(bybitSpreadPercent)) > 0.05 && (
                <span className="px-3 py-1 bg-violet-500 text-white rounded-full text-sm font-bold animate-pulse">
                  SPREAD
                </span>
              )}
              {(currentSkew > 0.5 && bybitFundingRate < 0) || (currentSkew <= 0.5 && bybitFundingRate > 0) ? (
                <span className="px-3 py-1 bg-green-500 text-white rounded-full text-sm font-bold">
                  DOUBLE EARN
                </span>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* TVL and Pool State Settings */}
      <div className="bg-white rounded-lg p-4 shadow mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Settings className="w-5 h-5 text-slate-600" />
          <h3 className="font-bold text-slate-800">Test Parameters</h3>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
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
          <div className="min-w-[10rem] w-40">
            <label className="block text-xs text-slate-600 mb-1 whitespace-nowrap">Cap Tw FR as % of Bin.</label>
            <select
              value={twilightFundingCapPct}
              onChange={(e) => setTwilightFundingCapPct(Number(e.target.value))}
              className="w-full px-2 py-1 border rounded text-sm bg-white"
            >
              {Array.from({ length: 100 }, (_, i) => 99 - i).map((pct) => (
                <option key={pct} value={pct}>{pct}%</option>
              ))}
            </select>
            <p className="text-xs text-slate-400 mt-0.5">0% = no cap</p>
          </div>
          <div className="pl-0 -ml-1">
            <label htmlFor="peg-to-cap-rate" className="block text-xs text-slate-600 mb-1 cursor-pointer">Peg to cap rate</label>
            <div className="flex items-center min-h-[26px] py-0.5">
              <input
                type="checkbox"
                id="peg-to-cap-rate"
                checked={pegTwilightToCapRate}
                onChange={(e) => setPegTwilightToCapRate(e.target.checked)}
                className="rounded border-slate-300 cursor-pointer"
              />
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-col items-center justify-center text-center">
          <label className="block text-xs text-slate-600 mb-1">Twilight Funding Rate</label>
          <div className={`px-3 py-1.5 rounded text-sm font-mono ${twilightFundingRate >= 0 ? 'bg-orange-50 text-orange-700' : 'bg-blue-50 text-blue-700'}`}>
            {twilightFundingRate >= 0 ? '+' : ''}{(twilightFundingRate * 100).toFixed(6)}%/8h
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

      {/* Pool Balance Gauge */}
      <div className="bg-white rounded-lg p-4 shadow mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Activity className="w-5 h-5 text-purple-600" />
          <h3 className="font-bold text-slate-800">Pool Balance</h3>
          <span className={`ml-auto px-3 py-1 rounded-full text-sm font-bold ${
            currentSkew > 0.55 ? 'bg-orange-100 text-orange-700' :
            currentSkew < 0.45 ? 'bg-blue-100 text-blue-700' :
            'bg-green-100 text-green-700'
          }`}>
            {currentSkew > 0.55 ? 'SHORTS EARN' : currentSkew < 0.45 ? 'LONGS EARN' : 'BALANCED'}
          </span>
        </div>

        {/* Visual Gauge */}
        <div className="relative h-8 bg-gradient-to-r from-blue-200 via-green-200 to-orange-200 rounded-full overflow-hidden mb-2">
          <div
            className="absolute top-0 h-full w-1 bg-slate-800 z-10"
            style={{ left: `${currentSkew * 100}%`, transform: 'translateX(-50%)' }}
          />
          <div className="absolute top-0 left-1/2 h-full w-0.5 bg-slate-400 z-5" />
          <div
            className="absolute top-1 left-0 h-6 rounded-full bg-blue-500/30"
            style={{ width: `${(1 - currentSkew) * 100}%`, right: 0, left: 'auto' }}
          />
          <div
            className="absolute top-1 h-6 rounded-full bg-orange-500/30"
            style={{ width: `${currentSkew * 100}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-slate-500 mb-4">
          <span>0% (All Shorts)</span>
          <span className="font-bold text-slate-700">{(currentSkew * 100).toFixed(1)}% Longs</span>
          <span>100% (All Longs)</span>
        </div>

        <div className="grid grid-cols-3 gap-4 text-center">
          <div className="bg-blue-50 rounded-lg p-3">
            <div className="text-blue-600 text-xs">Total Shorts</div>
            <div className="text-xl font-bold text-blue-700">${twilightShortSize.toLocaleString()}</div>
          </div>
          <div className={`rounded-lg p-3 ${currentSkew > 0.5 ? 'bg-orange-100' : currentSkew < 0.5 ? 'bg-blue-100' : 'bg-green-100'}`}>
            <div className={`text-xs ${currentSkew > 0.5 ? 'text-orange-600' : currentSkew < 0.5 ? 'text-blue-600' : 'text-green-600'}`}>
              Current Funding APY
            </div>
            <div className={`text-xl font-bold ${currentSkew > 0.5 ? 'text-orange-700' : currentSkew < 0.5 ? 'text-blue-700' : 'text-green-700'}`}>
              {currentTwilightAPY.toFixed(1)}%
            </div>
            <div className="text-xs text-slate-500">
              {currentSkew > 0.5 ? 'Shorts earn, Longs pay' : currentSkew < 0.5 ? 'Longs earn, Shorts pay' : 'No funding'}
            </div>
          </div>
          <div className="bg-orange-50 rounded-lg p-3">
            <div className="text-orange-600 text-xs">Total Longs</div>
            <div className="text-xl font-bold text-orange-700">${twilightLongSize.toLocaleString()}</div>
          </div>
        </div>
      </div>

      {/* Trade Impact Calculator */}
      {(twilightLongSize > 0 || twilightShortSize > 0) && (
        <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg p-4 shadow mb-6 border-2 border-purple-200">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-5 h-5 text-purple-600" />
            <h3 className="font-bold text-slate-800">Trade Impact Calculator</h3>
            <Info className="w-4 h-4 text-slate-400" />
          </div>

          {/* Trade Size Input */}
          <div className="mb-4">
            <label className="block text-sm text-slate-600 mb-1">Your Trade Size ($)</label>
            <input
              type="number"
              value={tradeSize}
              onChange={(e) => setTradeSize(Number(e.target.value))}
              className="w-full px-3 py-2 border-2 border-purple-300 rounded-lg text-lg font-bold"
              placeholder="Enter position size in USD"
            />
          </div>

          {/* Side by Side Comparison */}
          <div className="grid grid-cols-2 gap-4">
            {/* IF YOU GO LONG */}
            <div className={`rounded-xl p-4 border-2 ${longImpact.youPay ? 'bg-red-50 border-red-300' : 'bg-green-50 border-green-300'}`}>
              <div className="flex items-center gap-2 mb-3">
                <ArrowUpRight className={`w-6 h-6 ${longImpact.youPay ? 'text-red-600' : 'text-green-600'}`} />
                <span className="font-bold text-lg">IF YOU GO LONG ${tradeSize.toLocaleString()}</span>
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-600">New Pool:</span>
                  <span className="font-mono">${longImpact.newLongs?.toLocaleString()} / ${longImpact.newShorts?.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">New Skew:</span>
                  <span className={`font-bold ${longImpact.skewChange > 0 ? 'text-orange-600' : 'text-blue-600'}`}>
                    {(longImpact.newSkew * 100).toFixed(1)}% ({longImpact.skewChange > 0 ? '+' : ''}{(longImpact.skewChange * 100).toFixed(1)}%)
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">New Funding Rate:</span>
                  <span className="font-mono">{(longImpact.newFundingRate * 100).toFixed(4)}%/8h</span>
                </div>
                <div className={`rounded-lg p-3 mt-3 ${longImpact.youPay ? 'bg-red-100' : 'bg-green-100'}`}>
                  <div className={`text-xs ${longImpact.youPay ? 'text-red-600' : 'text-green-600'}`}>
                    {longImpact.youPay ? 'YOU PAY' : 'YOU EARN'}
                  </div>
                  <div className={`text-2xl font-bold ${longImpact.youPay ? 'text-red-700' : 'text-green-700'}`}>
                    {longImpact.annualizedAPY.toFixed(1)}% APY
                  </div>
                </div>
              </div>

              <div className={`mt-3 flex items-center gap-2 text-sm ${longImpact.helpsBalance ? 'text-green-600' : 'text-orange-600'}`}>
                {longImpact.helpsBalance ? (
                  <><span className="text-lg">+</span> Helps balance pool</>
                ) : (
                  <><AlertCircle className="w-4 h-4" /> Increases imbalance</>
                )}
              </div>
            </div>

            {/* IF YOU GO SHORT */}
            <div className={`rounded-xl p-4 border-2 ${shortImpact.youEarn ? 'bg-green-50 border-green-300' : 'bg-red-50 border-red-300'}`}>
              <div className="flex items-center gap-2 mb-3">
                <ArrowDownRight className={`w-6 h-6 ${shortImpact.youEarn ? 'text-green-600' : 'text-red-600'}`} />
                <span className="font-bold text-lg">IF YOU GO SHORT ${tradeSize.toLocaleString()}</span>
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-600">New Pool:</span>
                  <span className="font-mono">${shortImpact.newLongs?.toLocaleString()} / ${shortImpact.newShorts?.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">New Skew:</span>
                  <span className={`font-bold ${shortImpact.skewChange < 0 ? 'text-blue-600' : 'text-orange-600'}`}>
                    {(shortImpact.newSkew * 100).toFixed(1)}% ({shortImpact.skewChange > 0 ? '+' : ''}{(shortImpact.skewChange * 100).toFixed(1)}%)
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">New Funding Rate:</span>
                  <span className="font-mono">{(shortImpact.newFundingRate * 100).toFixed(4)}%/8h</span>
                </div>
                <div className={`rounded-lg p-3 mt-3 ${shortImpact.youEarn ? 'bg-green-100' : 'bg-red-100'}`}>
                  <div className={`text-xs ${shortImpact.youEarn ? 'text-green-600' : 'text-red-600'}`}>
                    {shortImpact.youEarn ? 'YOU EARN' : 'YOU PAY'}
                  </div>
                  <div className={`text-2xl font-bold ${shortImpact.youEarn ? 'text-green-700' : 'text-red-700'}`}>
                    {shortImpact.annualizedAPY.toFixed(1)}% APY
                  </div>
                </div>
              </div>

              <div className={`mt-3 flex items-center gap-2 text-sm ${shortImpact.helpsBalance ? 'text-green-600' : 'text-orange-600'}`}>
                {shortImpact.helpsBalance ? (
                  <><span className="text-lg">+</span> Helps balance pool</>
                ) : (
                  <><AlertCircle className="w-4 h-4" /> Increases imbalance</>
                )}
              </div>
            </div>
          </div>

          {/* Gaming Warning */}
          <div className="mt-4 bg-yellow-100 rounded-lg p-3 border border-yellow-300">
            <div className="flex items-center gap-2 text-yellow-800 text-sm">
              <AlertCircle className="w-4 h-4" />
              <span className="font-semibold">Gaming Risk:</span>
              <span>Funding rate may change as other traders enter positions. The APY shown is based on your trade only.</span>
            </div>
          </div>
        </div>
      )}

      {/* Funding Rate Chart */}
      {fundingHistory.length > 3 && (
        <div className="bg-white rounded-lg p-4 shadow mb-6">
          <h3 className="font-bold text-slate-800 mb-2 flex items-center gap-2">
            <Activity className="w-5 h-5 text-blue-600" />
            Funding Rate Comparison (%/8h)
          </h3>
          <ResponsiveContainer width="100%" height={120}>
            <LineChart data={fundingHistory}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="time" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${v.toFixed(3)}%`} />
              <Tooltip formatter={(v) => `${v.toFixed(4)}%/8h`} />
              <Line type="monotone" dataKey="binance" stroke="#f97316" strokeWidth={2} dot={false} name="Binance %/8h" />
              <Line type="monotone" dataKey="twilight" stroke="#3b82f6" strokeWidth={2} dot={false} name="Twilight %/8h" />
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

      {/* LONG Twilight Strategies Table */}
      <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg p-4 shadow mb-6 border-2 border-green-200">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-slate-800 flex items-center gap-2">
            <ArrowUpRight className="w-5 h-5 text-green-600" />
            LONG on Twilight Strategies
          </h3>
          {currentSkew < 0.5 && (twilightLongSize > 0 || twilightShortSize > 0) && (
            <span className="px-3 py-1 bg-green-500 text-white rounded-full text-sm font-bold animate-pulse">
              EARNS {currentTwilightAPY.toFixed(1)}% APY
            </span>
          )}
          {currentSkew > 0.5 && (twilightLongSize > 0 || twilightShortSize > 0) && (
            <span className="px-3 py-1 bg-red-500 text-white rounded-full text-sm font-bold">
              PAYS {currentTwilightAPY.toFixed(1)}% APY
            </span>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-green-100">
                <th className="text-left p-2">#</th>
                <th className="text-left p-2">Strategy</th>
                <th className="text-center p-2">Category</th>
                <th className="text-left p-2">Risk</th>
                <th className="text-right p-2">Margin</th>
                <th className="text-right p-2">Monthly P&L</th>
                <th className="text-right p-2">APY</th>
                <th className="text-right p-2 text-green-700">If +5%</th>
                <th className="text-right p-2 text-red-700">If -5%</th>
                <th className="text-center p-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const longStrategies = generateStrategies.filter(s => s.twilightPosition === 'LONG');
                const twilightOnlyLong = longStrategies.filter(s => !s.isBybitStrategy && !s.binancePosition);
                const binanceLong = longStrategies.filter(s => !s.isBybitStrategy && s.binancePosition);
                const bybitLong = longStrategies.filter(s => s.isBybitStrategy);
                const renderLongRow = (strategy, idx) => (
                  <tr
                    key={strategy.id}
                    className={`border-b hover:bg-green-50 cursor-pointer ${selectedStrategy?.id === strategy.id ? 'bg-green-100' : ''}`}
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
                    <td className="p-2">
                      <span className={`px-2 py-0.5 rounded text-xs ${getRiskColor(strategy.risk)}`}>
                        {strategy.risk}
                      </span>
                    </td>
                    <td className="p-2 text-right font-mono">${strategy.totalMargin.toFixed(2)}</td>
                    <td className={`p-2 text-right font-mono ${strategy.monthlyPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {strategy.monthlyPnL >= 0 ? '+' : ''}${strategy.monthlyPnL?.toFixed(2) || '0'}
                    </td>
                    <td className={`p-2 text-right font-mono font-bold ${getAPYColor(strategy.apy)}`}>
                      {strategy.apy >= 0 ? '+' : ''}{strategy.apy?.toFixed(1) || '0'}%
                    </td>
                    <td className={`p-2 text-right font-mono font-bold ${strategy.pnlUp5 >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {strategy.pnlUp5 >= 0 ? '+' : ''}${strategy.pnlUp5?.toFixed(2) || '0'}
                    </td>
                    <td className={`p-2 text-right font-mono font-bold ${strategy.pnlDown5 >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {strategy.pnlDown5 >= 0 ? '+' : ''}${strategy.pnlDown5?.toFixed(2) || '0'}
                    </td>
                    <td className="p-2 text-center">
                      <button
                        className="px-2 py-1 bg-green-500 text-white rounded text-xs hover:bg-green-600"
                        onClick={(e) => { e.stopPropagation(); setSelectedStrategy(strategy); }}
                      >
                        Details
                      </button>
                    </td>
                  </tr>
                );
                return (
                  <>
                    {twilightOnlyLong.length > 0 && (
                      <>
                        <tr className="bg-slate-200/80">
                          <td colSpan={10} className="p-2 font-semibold text-slate-800">Twilight only</td>
                        </tr>
                        {twilightOnlyLong.map((s, i) => renderLongRow(s, i))}
                      </>
                    )}
                    {binanceLong.length > 0 && (
                      <>
                        <tr className="bg-green-200/80">
                          <td colSpan={10} className="p-2 font-semibold text-slate-800">Binance strategies</td>
                        </tr>
                        {binanceLong.map((s, i) => renderLongRow(s, i))}
                      </>
                    )}
                    {bybitLong.length > 0 && (
                      <>
                        <tr className="bg-violet-200/80">
                          <td colSpan={10} className="p-2 font-semibold text-slate-800">Bybit strategies</td>
                        </tr>
                        {bybitLong.map((s, i) => renderLongRow(s, i))}
                      </>
                    )}
                  </>
                );
              })()}
            </tbody>
          </table>
        </div>
      </div>

      {/* SHORT Twilight Strategies Table */}
      <div className="bg-gradient-to-r from-red-50 to-orange-50 rounded-lg p-4 shadow mb-6 border-2 border-red-200">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-slate-800 flex items-center gap-2">
            <ArrowDownRight className="w-5 h-5 text-red-600" />
            SHORT on Twilight Strategies
          </h3>
          {currentSkew > 0.5 && (twilightLongSize > 0 || twilightShortSize > 0) && (
            <span className="px-3 py-1 bg-green-500 text-white rounded-full text-sm font-bold animate-pulse">
              EARNS {currentTwilightAPY.toFixed(1)}% APY
            </span>
          )}
          {currentSkew < 0.5 && (twilightLongSize > 0 || twilightShortSize > 0) && (
            <span className="px-3 py-1 bg-red-500 text-white rounded-full text-sm font-bold">
              PAYS {currentTwilightAPY.toFixed(1)}% APY
            </span>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-red-100">
                <th className="text-left p-2">#</th>
                <th className="text-left p-2">Strategy</th>
                <th className="text-center p-2">Category</th>
                <th className="text-left p-2">Risk</th>
                <th className="text-right p-2">Margin</th>
                <th className="text-right p-2">Monthly P&L</th>
                <th className="text-right p-2">APY</th>
                <th className="text-right p-2 text-green-700">If +5%</th>
                <th className="text-right p-2 text-red-700">If -5%</th>
                <th className="text-center p-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const shortStrategies = generateStrategies.filter(s => s.twilightPosition === 'SHORT');
                const twilightOnlyShort = shortStrategies.filter(s => !s.isBybitStrategy && !s.binancePosition);
                const binanceShort = shortStrategies.filter(s => !s.isBybitStrategy && s.binancePosition);
                const bybitShort = shortStrategies.filter(s => s.isBybitStrategy);
                const renderShortRow = (strategy, idx) => (
                  <tr
                    key={strategy.id}
                    className={`border-b hover:bg-red-50 cursor-pointer ${selectedStrategy?.id === strategy.id ? 'bg-red-100' : ''}`}
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
                    <td className="p-2">
                      <span className={`px-2 py-0.5 rounded text-xs ${getRiskColor(strategy.risk)}`}>
                        {strategy.risk}
                      </span>
                    </td>
                    <td className="p-2 text-right font-mono">${strategy.totalMargin.toFixed(2)}</td>
                    <td className={`p-2 text-right font-mono ${strategy.monthlyPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {strategy.monthlyPnL >= 0 ? '+' : ''}${strategy.monthlyPnL?.toFixed(2) || '0'}
                    </td>
                    <td className={`p-2 text-right font-mono font-bold ${getAPYColor(strategy.apy)}`}>
                      {strategy.apy >= 0 ? '+' : ''}{strategy.apy?.toFixed(1) || '0'}%
                    </td>
                    <td className={`p-2 text-right font-mono font-bold ${strategy.pnlUp5 >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {strategy.pnlUp5 >= 0 ? '+' : ''}${strategy.pnlUp5?.toFixed(2) || '0'}
                    </td>
                    <td className={`p-2 text-right font-mono font-bold ${strategy.pnlDown5 >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {strategy.pnlDown5 >= 0 ? '+' : ''}${strategy.pnlDown5?.toFixed(2) || '0'}
                    </td>
                    <td className="p-2 text-center">
                      <button
                        className="px-2 py-1 bg-red-500 text-white rounded text-xs hover:bg-red-600"
                        onClick={(e) => { e.stopPropagation(); setSelectedStrategy(strategy); }}
                      >
                        Details
                      </button>
                    </td>
                  </tr>
                );
                return (
                  <>
                    {twilightOnlyShort.length > 0 && (
                      <>
                        <tr className="bg-slate-200/80">
                          <td colSpan={10} className="p-2 font-semibold text-slate-800">Twilight only</td>
                        </tr>
                        {twilightOnlyShort.map((s, i) => renderShortRow(s, i))}
                      </>
                    )}
                    {binanceShort.length > 0 && (
                      <>
                        <tr className="bg-red-200/80">
                          <td colSpan={10} className="p-2 font-semibold text-slate-800">Binance strategies</td>
                        </tr>
                        {binanceShort.map((s, i) => renderShortRow(s, i))}
                      </>
                    )}
                    {bybitShort.length > 0 && (
                      <>
                        <tr className="bg-violet-200/80">
                          <td colSpan={10} className="p-2 font-semibold text-slate-800">Bybit strategies</td>
                        </tr>
                        {bybitShort.map((s, i) => renderShortRow(s, i))}
                      </>
                    )}
                  </>
                );
              })()}
            </tbody>
          </table>
        </div>
      </div>

      {/* Binance Only Strategies Table */}
      <div className="bg-white rounded-lg p-4 shadow mb-6">
        <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
          <DollarSign className="w-5 h-5 text-purple-600" />
          Binance Only Strategies (No Twilight)
        </h3>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-slate-50">
                <th className="text-left p-2">#</th>
                <th className="text-left p-2">Strategy</th>
                <th className="text-center p-2">Category</th>
                <th className="text-left p-2">Risk</th>
                <th className="text-right p-2">Margin</th>
                <th className="text-right p-2">Monthly P&L</th>
                <th className="text-right p-2">APY</th>
                <th className="text-right p-2 text-green-700">If +5%</th>
                <th className="text-right p-2 text-red-700">If -5%</th>
                <th className="text-center p-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {generateStrategies
                .filter(s => !s.twilightPosition)
                .map((strategy, idx) => (
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
                  <td className="p-2">
                    <span className={`px-2 py-0.5 rounded text-xs ${getRiskColor(strategy.risk)}`}>
                      {strategy.risk}
                    </span>
                  </td>
                  <td className="p-2 text-right font-mono">${strategy.totalMargin.toFixed(2)}</td>
                  <td className={`p-2 text-right font-mono ${strategy.monthlyPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {strategy.monthlyPnL >= 0 ? '+' : ''}${strategy.monthlyPnL?.toFixed(2) || '0'}
                  </td>
                  <td className={`p-2 text-right font-mono font-bold ${getAPYColor(strategy.apy)}`}>
                    {strategy.apy >= 0 ? '+' : ''}{strategy.apy?.toFixed(1) || '0'}%
                  </td>
                  <td className={`p-2 text-right font-mono font-bold ${strategy.pnlUp5 >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {strategy.pnlUp5 >= 0 ? '+' : ''}${strategy.pnlUp5?.toFixed(2) || '0'}
                  </td>
                  <td className={`p-2 text-right font-mono font-bold ${strategy.pnlDown5 >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {strategy.pnlDown5 >= 0 ? '+' : ''}${strategy.pnlDown5?.toFixed(2) || '0'}
                  </td>
                  <td className="p-2 text-center">
                    <button
                      className="px-2 py-1 bg-purple-500 text-white rounded text-xs hover:bg-purple-600"
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
              'bg-gradient-to-r from-blue-600 to-purple-600'
            } text-white`}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <span className={`px-3 py-1 rounded-full text-sm font-bold ${
                      selectedStrategy.marketDirection === 'BULLISH' ? 'bg-white text-green-700' :
                      selectedStrategy.marketDirection === 'BEARISH' ? 'bg-white text-red-700' :
                      'bg-white text-gray-700'
                    }`}>
                      {selectedStrategy.marketDirection === 'BULLISH' ? '↑ BULLISH - Price Up' :
                       selectedStrategy.marketDirection === 'BEARISH' ? '↓ BEARISH - Price Down' :
                       '↔ NEUTRAL - Any Direction'}
                    </span>
                  </div>
                  <h2 className="text-xl font-bold">{selectedStrategy.name}</h2>
                  <p className="text-white/80 text-sm mt-1">{selectedStrategy.directionDescription}</p>
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
                <span className={`px-2 py-1 rounded text-xs font-semibold ${selectedStrategy.category === 'Delta-Neutral' ? 'bg-purple-200 text-purple-800' : selectedStrategy.category === 'Funding Arb' ? 'bg-orange-200 text-orange-800' : selectedStrategy.category === 'Conservative' ? 'bg-green-200 text-green-800' : 'bg-gray-200 text-gray-800'}`}>
                  {selectedStrategy.category}
                </span>
                <span className={`px-2 py-1 rounded text-xs font-semibold ${getRiskColor(selectedStrategy.risk)}`}>
                  {selectedStrategy.risk} RISK
                </span>
              </div>
            </div>

            {/* PRICE SCENARIOS - KEY SECTION */}
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
                  {selectedStrategy.marginChangeDown10 !== 0 && (
                    <div className={`text-xs ${selectedStrategy.marginChangeDown10 >= 0 ? 'text-orange-600' : 'text-orange-600'}`}>
                      BTC margin: {selectedStrategy.marginChangeDown10 >= 0 ? '+' : ''}${selectedStrategy.marginChangeDown10?.toFixed(2) || '0'}
                    </div>
                  )}
                </div>
                <div className="bg-red-50 rounded-lg p-3">
                  <div className="text-red-500 text-xs font-semibold">If -5%</div>
                  <div className={`text-xl font-bold ${selectedStrategy.pnlDown5 >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                    {selectedStrategy.pnlDown5 >= 0 ? '+' : ''}${selectedStrategy.pnlDown5?.toFixed(2) || '0'}
                  </div>
                  <div className={`text-xs ${selectedStrategy.priceOnlyDown5 >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    Price: {selectedStrategy.priceOnlyDown5 >= 0 ? '+' : ''}${selectedStrategy.priceOnlyDown5?.toFixed(2) || '0'}
                  </div>
                  {selectedStrategy.marginChangeDown5 !== 0 && (
                    <div className={`text-xs ${selectedStrategy.marginChangeDown5 >= 0 ? 'text-orange-600' : 'text-orange-600'}`}>
                      BTC margin: {selectedStrategy.marginChangeDown5 >= 0 ? '+' : ''}${selectedStrategy.marginChangeDown5?.toFixed(2) || '0'}
                    </div>
                  )}
                </div>
                <div className="bg-gray-100 rounded-lg p-3 border-2 border-gray-300">
                  <div className="text-gray-600 text-xs font-semibold">Flat (0%)</div>
                  <div className={`text-xl font-bold ${selectedStrategy.monthlyPnL >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                    {selectedStrategy.monthlyPnL >= 0 ? '+' : ''}${selectedStrategy.monthlyPnL?.toFixed(2) || '0'}
                  </div>
                  <div className="text-xs text-gray-500">Funding only</div>
                </div>
                <div className="bg-green-50 rounded-lg p-3">
                  <div className="text-green-500 text-xs font-semibold">If +5%</div>
                  <div className={`text-xl font-bold ${selectedStrategy.pnlUp5 >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                    {selectedStrategy.pnlUp5 >= 0 ? '+' : ''}${selectedStrategy.pnlUp5?.toFixed(2) || '0'}
                  </div>
                  <div className={`text-xs ${selectedStrategy.priceOnlyUp5 >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    Price: {selectedStrategy.priceOnlyUp5 >= 0 ? '+' : ''}${selectedStrategy.priceOnlyUp5?.toFixed(2) || '0'}
                  </div>
                  {selectedStrategy.marginChangeUp5 !== 0 && (
                    <div className={`text-xs ${selectedStrategy.marginChangeUp5 >= 0 ? 'text-orange-600' : 'text-orange-600'}`}>
                      BTC margin: {selectedStrategy.marginChangeUp5 >= 0 ? '+' : ''}${selectedStrategy.marginChangeUp5?.toFixed(2) || '0'}
                    </div>
                  )}
                </div>
                <div className="bg-green-100 rounded-lg p-3">
                  <div className="text-green-600 text-xs font-semibold">If +10%</div>
                  <div className={`text-xl font-bold ${selectedStrategy.pnlUp10 >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                    {selectedStrategy.pnlUp10 >= 0 ? '+' : ''}${selectedStrategy.pnlUp10?.toFixed(2) || '0'}
                  </div>
                  <div className={`text-xs ${selectedStrategy.priceOnlyUp10 >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    Price: {selectedStrategy.priceOnlyUp10 >= 0 ? '+' : ''}${selectedStrategy.priceOnlyUp10?.toFixed(2) || '0'}
                  </div>
                  {selectedStrategy.marginChangeUp10 !== 0 && (
                    <div className={`text-xs ${selectedStrategy.marginChangeUp10 >= 0 ? 'text-orange-600' : 'text-orange-600'}`}>
                      BTC margin: {selectedStrategy.marginChangeUp10 >= 0 ? '+' : ''}${selectedStrategy.marginChangeUp10?.toFixed(2) || '0'}
                    </div>
                  )}
                </div>
              </div>
              {/* Explanation for hedged strategies with inverse perp */}
              {selectedStrategy.twilightPosition && selectedStrategy.binancePosition && (
                <div className="mt-3 bg-orange-100 rounded-lg p-2 text-center">
                  <span className="text-orange-800 text-sm">
                    <strong>BTC Margin Effect:</strong> Your Twilight margin is in BTC. When price goes UP, your BTC margin is worth more USD. When price goes DOWN, it's worth less. This creates asymmetry even in "hedged" positions.
                  </span>
                </div>
              )}
              {selectedStrategy.breakEvenPriceMove > 0 && (
                <div className="mt-3 bg-yellow-100 rounded-lg p-2 text-center">
                  <span className="text-yellow-800 text-sm">
                    <strong>Break-even price move:</strong> {selectedStrategy.marketDirection === 'BULLISH' ? '+' : '-'}{selectedStrategy.breakEvenPriceMove?.toFixed(2)}% to cover funding costs
                  </span>
                </div>
              )}
            </div>

            {/* Position Details - PROMINENT */}
            <div className="p-4 bg-slate-50 border-b-4 border-blue-500">
              <h3 className="font-bold text-slate-800 text-lg mb-4 flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-blue-600" />
                EXACT POSITION DETAILS
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Twilight Position Card - INVERSE PERP (BTC-margined) */}
                <div className={`rounded-xl p-4 ${selectedStrategy.twilightPosition ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-400'}`}>
                  <div className="flex justify-between items-center mb-1">
                    <div className="text-sm opacity-80">TWILIGHT POSITION</div>
                    <span className="bg-orange-500 text-white text-xs px-2 py-0.5 rounded font-bold">INVERSE PERP</span>
                  </div>
                  {selectedStrategy.twilightPosition ? (
                    <>
                      <div className="flex items-center gap-2 mb-3">
                        {selectedStrategy.twilightPosition === 'LONG' ? (
                          <ArrowUpRight className="w-8 h-8" />
                        ) : (
                          <ArrowDownRight className="w-8 h-8" />
                        )}
                        <span className="text-3xl font-bold">{selectedStrategy.twilightPosition}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div className="bg-white/20 rounded-lg p-2">
                          <div className="opacity-70">Position Size (USD)</div>
                          <div className="text-xl font-bold">${selectedStrategy.twilightSize}</div>
                        </div>
                        <div className="bg-white/20 rounded-lg p-2">
                          <div className="opacity-70">Leverage</div>
                          <div className="text-xl font-bold">{selectedStrategy.twilightLeverage}x</div>
                        </div>
                        <div className="bg-yellow-500/30 rounded-lg p-2 col-span-2">
                          <div className="opacity-90 font-semibold">Margin Required (BTC)</div>
                          <div className="text-2xl font-bold">{selectedStrategy.twilightMarginBTC?.toFixed(6) || (selectedStrategy.twilightSize / (selectedStrategy.twilightLeverage * twilightPrice)).toFixed(6)} BTC</div>
                          <div className="text-xs opacity-70">~${selectedStrategy.twilightMarginUSD?.toFixed(2) || (selectedStrategy.twilightSize / selectedStrategy.twilightLeverage).toFixed(2)} USD</div>
                        </div>
                        <div className="bg-white/20 rounded-lg p-2 col-span-2">
                          <div className="opacity-70">Trading Fee</div>
                          <div className="text-xl font-bold text-green-300">$0.00 (0%)</div>
                        </div>
                      </div>
                      <div className="mt-3 text-xs bg-white/10 rounded p-2">
                        <div className="font-semibold mb-1">How Inverse Perp Works:</div>
                        <div>You deposit BTC as margin. P&L is settled in BTC.</div>
                        <div className="mt-1">Position: {(selectedStrategy.twilightSize / twilightPrice).toFixed(6)} BTC worth at ${twilightPrice.toLocaleString()}</div>
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-4">No Twilight Position</div>
                  )}
                </div>

                {/* Binance/Bybit Position Card */}
                <div className={`rounded-xl p-4 ${selectedStrategy.binancePosition ? (selectedStrategy.isBybitStrategy ? 'bg-violet-600 text-white' : 'bg-purple-600 text-white') : 'bg-gray-100 text-gray-400'}`}>
                  <div className="flex justify-between items-center mb-1">
                    <div className="text-sm opacity-80">{selectedStrategy.isBybitStrategy ? 'BYBIT POSITION' : 'BINANCE POSITION'}</div>
                    <span className={`text-white text-xs px-2 py-0.5 rounded font-bold ${selectedStrategy.isBybitStrategy ? 'bg-orange-500' : 'bg-green-500'}`}>
                      {selectedStrategy.isBybitStrategy ? 'INVERSE PERP' : 'LINEAR PERP'}
                    </span>
                  </div>
                  {selectedStrategy.binancePosition ? (
                    <>
                      <div className="flex items-center gap-2 mb-3">
                        {selectedStrategy.binancePosition === 'LONG' ? (
                          <ArrowUpRight className="w-8 h-8" />
                        ) : (
                          <ArrowDownRight className="w-8 h-8" />
                        )}
                        <span className="text-3xl font-bold">{selectedStrategy.binancePosition}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div className="bg-white/20 rounded-lg p-2">
                          <div className="opacity-70">Position Size (USD)</div>
                          <div className="text-xl font-bold">${selectedStrategy.binanceSize}</div>
                        </div>
                        <div className="bg-white/20 rounded-lg p-2">
                          <div className="opacity-70">Leverage</div>
                          <div className="text-xl font-bold">{selectedStrategy.binanceLeverage}x</div>
                        </div>
                        <div className={`rounded-lg p-2 col-span-2 ${selectedStrategy.isBybitStrategy ? 'bg-orange-500/30' : 'bg-green-500/30'}`}>
                          <div className="opacity-90 font-semibold">Margin Required ({selectedStrategy.isBybitStrategy ? 'BTC' : 'USDT'})</div>
                          {selectedStrategy.isBybitStrategy ? (
                            <>
                              <div className="text-2xl font-bold">{selectedStrategy.bybitMarginBTC?.toFixed(6) || (selectedStrategy.binanceSize / (selectedStrategy.binanceLeverage * (selectedStrategy.bybitPrice || cexPrice))).toFixed(6)} BTC</div>
                              <div className="text-xs opacity-70">~${selectedStrategy.bybitMarginUSD?.toFixed(2) || (selectedStrategy.binanceSize / selectedStrategy.binanceLeverage).toFixed(2)} USD</div>
                            </>
                          ) : (
                            <div className="text-2xl font-bold">{selectedStrategy.binanceMarginUSDT?.toFixed(2) || (selectedStrategy.binanceSize / selectedStrategy.binanceLeverage).toFixed(2)} USDT</div>
                          )}
                        </div>
                        <div className="bg-white/20 rounded-lg p-2 col-span-2">
                          <div className="opacity-70">Trading Fee</div>
                          <div className="text-xl font-bold text-orange-300">
                            ${(selectedStrategy.binanceSize * (selectedStrategy.isBybitStrategy ? 0.00055 : BINANCE_TAKER_FEE) * 2).toFixed(2)} ({selectedStrategy.isBybitStrategy ? '0.055%' : '0.04%'} x2)
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 text-xs bg-white/10 rounded p-2">
                        {selectedStrategy.isBybitStrategy ? (
                          <>
                            <div className="font-semibold mb-1">How Bybit Inverse Perp Works:</div>
                            <div>You deposit BTC as margin. P&L is settled in BTC. Same as Twilight!</div>
                            <div className="mt-1">Position: {(selectedStrategy.binanceSize / (selectedStrategy.bybitPrice || bybitPrice)).toFixed(6)} BTC worth at ${(selectedStrategy.bybitPrice || bybitPrice).toLocaleString()}</div>
                            <div className="mt-1 text-yellow-300">Funding: {(selectedStrategy.bybitFundingRate * 100).toFixed(4)}% per 8h</div>
                          </>
                        ) : (
                          <>
                            <div className="font-semibold mb-1">How Linear Perp Works:</div>
                            <div>You deposit USDT as margin. P&L is settled in USDT.</div>
                            <div className="mt-1">Position: {(selectedStrategy.binanceSize / cexPrice).toFixed(6)} BTC worth at ${cexPrice.toLocaleString()}</div>
                          </>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-4">No {selectedStrategy.isBybitStrategy ? 'Bybit' : 'Binance'} Position</div>
                  )}
                </div>
              </div>

              {/* Capital Requirements Summary */}
              <div className="mt-4 bg-white rounded-lg p-4 border-2 border-slate-300">
                <h4 className="font-bold text-slate-800 mb-2">Total Capital Required</h4>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div className="text-center">
                    <div className="text-slate-500">BTC Needed (Twilight)</div>
                    <div className="text-xl font-bold text-orange-600">
                      {selectedStrategy.twilightMarginBTC?.toFixed(6) || (selectedStrategy.twilightPosition ? (selectedStrategy.twilightSize / (selectedStrategy.twilightLeverage * twilightPrice)).toFixed(6) : '0')} BTC
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-slate-500">{selectedStrategy.isBybitStrategy ? 'BTC Needed (Bybit)' : 'USDT Needed (Binance)'}</div>
                    <div className={`text-xl font-bold ${selectedStrategy.isBybitStrategy ? 'text-violet-600' : 'text-green-600'}`}>
                      {selectedStrategy.isBybitStrategy
                        ? `${selectedStrategy.bybitMarginBTC?.toFixed(6) || (selectedStrategy.binancePosition ? (selectedStrategy.binanceSize / (selectedStrategy.binanceLeverage * (selectedStrategy.bybitPrice || bybitPrice))).toFixed(6) : '0')} BTC`
                        : `${selectedStrategy.binanceMarginUSDT?.toFixed(2) || (selectedStrategy.binancePosition ? (selectedStrategy.binanceSize / selectedStrategy.binanceLeverage).toFixed(2) : '0')} USDT`
                      }
                    </div>
                  </div>
                  <div className="text-center bg-slate-100 rounded-lg p-2">
                    <div className="text-slate-500">Total (USD equiv)</div>
                    <div className="text-xl font-bold text-slate-800">
                      ${selectedStrategy.totalMargin?.toFixed(2) || '0'}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Funding Rates */}
            <div className="p-4 bg-white border-b">
              <h3 className="font-bold text-slate-800 mb-3">Funding Rate Impact</h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="bg-blue-50 rounded-lg p-3">
                  <div className="text-blue-600 font-semibold">Twilight Funding</div>
                  <div className="text-2xl font-bold text-blue-800">{(twilightFundingRate * 100).toFixed(4)}%/8h</div>
                  <div className="text-xs text-blue-600 mt-1">
                    {twilightFundingRate > 0 ? 'Longs pay, Shorts receive' : twilightFundingRate < 0 ? 'Shorts pay, Longs receive' : 'Balanced (no payments)'}
                  </div>
                </div>
                <div className="bg-purple-50 rounded-lg p-3">
                  <div className="text-purple-600 font-semibold">Binance Funding</div>
                  <div className="text-2xl font-bold text-purple-800">{(binanceFundingRate * 100).toFixed(6)}%/8h</div>
                  <div className="text-xs text-purple-600 mt-1">
                    {binanceFundingRate > 0 ? 'Longs pay, Shorts receive' : 'Shorts pay, Longs receive'}
                  </div>
                </div>
              </div>
            </div>

            {/* P&L Breakdown */}
            <div className="p-4 bg-white border-b">
              <h3 className="font-bold text-slate-800 mb-3">Projected Monthly P&L</h3>
              <div className="grid grid-cols-5 gap-2 text-sm">
                <div className="bg-slate-100 rounded-lg p-3 text-center">
                  <div className="text-slate-500 text-xs">Total Margin</div>
                  <div className="font-bold text-slate-800 text-lg">${selectedStrategy.totalMargin.toFixed(2)}</div>
                </div>
                <div className="bg-blue-100 rounded-lg p-3 text-center">
                  <div className="text-blue-600 text-xs">Basis Capture</div>
                  <div className="font-bold text-blue-800 text-lg">${selectedStrategy.basisProfit.toFixed(2)}</div>
                </div>
                <div className={`rounded-lg p-3 text-center ${selectedStrategy.monthlyFundingPnL >= 0 ? 'bg-green-100' : 'bg-red-100'}`}>
                  <div className={`text-xs ${selectedStrategy.monthlyFundingPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>Funding P&L</div>
                  <div className={`font-bold text-lg ${selectedStrategy.monthlyFundingPnL >= 0 ? 'text-green-800' : 'text-red-800'}`}>
                    {selectedStrategy.monthlyFundingPnL >= 0 ? '+' : ''}${selectedStrategy.monthlyFundingPnL.toFixed(2)}
                  </div>
                </div>
                <div className="bg-red-100 rounded-lg p-3 text-center">
                  <div className="text-red-600 text-xs">Fees</div>
                  <div className="font-bold text-red-800 text-lg">-${selectedStrategy.totalFees.toFixed(2)}</div>
                </div>
                <div className={`rounded-lg p-3 text-center ${selectedStrategy.monthlyPnL >= 0 ? 'bg-green-500' : 'bg-red-500'} text-white`}>
                  <div className="text-xs opacity-80">Net P&L</div>
                  <div className="font-bold text-lg">
                    {selectedStrategy.monthlyPnL >= 0 ? '+' : ''}${selectedStrategy.monthlyPnL.toFixed(2)}
                  </div>
                </div>
              </div>
              <div className="mt-4 bg-gradient-to-r from-green-500 to-emerald-600 rounded-lg p-4 text-white text-center">
                <div className="text-sm opacity-80">Projected Annual APY</div>
                <div className="text-4xl font-bold">
                  {selectedStrategy.apy >= 0 ? '+' : ''}{selectedStrategy.apy.toFixed(2)}%
                </div>
              </div>
            </div>

            {/* RISK MANAGEMENT - CRITICAL SECTION */}
            <div className="p-4 bg-red-50 border-b-4 border-red-500">
              <h3 className="font-bold text-red-800 text-lg mb-3 flex items-center gap-2">
                <AlertCircle className="w-6 h-6 text-red-600" />
                RISK MANAGEMENT - STOP LOSS & LIQUIDATION
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                {/* Twilight Risk */}
                {selectedStrategy.twilightPosition && (
                  <div className="bg-white rounded-lg p-4 border-2 border-red-200">
                    <div className="font-bold text-blue-700 mb-2">Twilight Position Risk</div>
                    <div className="space-y-3">
                      <div className="bg-red-100 rounded-lg p-3">
                        <div className="text-red-600 text-xs font-semibold">LIQUIDATION PRICE</div>
                        <div className="text-2xl font-bold text-red-700">
                          ${selectedStrategy.twilightLiquidationPrice?.toLocaleString(undefined, {maximumFractionDigits: 0}) || 'N/A'}
                        </div>
                        <div className="text-xs text-red-600">
                          {selectedStrategy.twilightLiquidationPct?.toFixed(1)}% {selectedStrategy.twilightPosition === 'LONG' ? 'below' : 'above'} entry
                        </div>
                        <div className="text-xs text-red-500 mt-1">
                          Position goes to $0 at this price
                        </div>
                      </div>
                      <div className="bg-orange-100 rounded-lg p-3">
                        <div className="text-orange-600 text-xs font-semibold">RECOMMENDED STOP LOSS</div>
                        <div className="text-2xl font-bold text-orange-700">
                          ${selectedStrategy.twilightStopLoss?.toLocaleString(undefined, {maximumFractionDigits: 0}) || 'N/A'}
                        </div>
                        <div className="text-xs text-orange-600">
                          {selectedStrategy.twilightStopLossPct?.toFixed(1)}% {selectedStrategy.twilightPosition === 'LONG' ? 'below' : 'above'} entry
                        </div>
                        <div className="text-xs text-orange-500 mt-1">
                          Max loss: ~${((selectedStrategy.twilightStopLossPct || 0) / 100 * selectedStrategy.twilightSize).toFixed(2)}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Binance Risk */}
                {selectedStrategy.binancePosition && (
                  <div className="bg-white rounded-lg p-4 border-2 border-red-200">
                    <div className="font-bold text-purple-700 mb-2">Binance Position Risk</div>
                    <div className="space-y-3">
                      <div className="bg-red-100 rounded-lg p-3">
                        <div className="text-red-600 text-xs font-semibold">LIQUIDATION PRICE</div>
                        <div className="text-2xl font-bold text-red-700">
                          ${selectedStrategy.binanceLiquidationPrice?.toLocaleString(undefined, {maximumFractionDigits: 0}) || 'N/A'}
                        </div>
                        <div className="text-xs text-red-600">
                          {selectedStrategy.binanceLiquidationPct?.toFixed(1)}% {selectedStrategy.binancePosition === 'LONG' ? 'below' : 'above'} entry
                        </div>
                        <div className="text-xs text-red-500 mt-1">
                          Position goes to $0 at this price
                        </div>
                      </div>
                      <div className="bg-orange-100 rounded-lg p-3">
                        <div className="text-orange-600 text-xs font-semibold">RECOMMENDED STOP LOSS</div>
                        <div className="text-2xl font-bold text-orange-700">
                          ${selectedStrategy.binanceStopLoss?.toLocaleString(undefined, {maximumFractionDigits: 0}) || 'N/A'}
                        </div>
                        <div className="text-xs text-orange-600">
                          {selectedStrategy.binanceStopLossPct?.toFixed(1)}% {selectedStrategy.binancePosition === 'LONG' ? 'below' : 'above'} entry
                        </div>
                        <div className="text-xs text-orange-500 mt-1">
                          Max loss: ~${((selectedStrategy.binanceStopLossPct || 0) / 100 * selectedStrategy.binanceSize).toFixed(2)}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Combined Risk Summary */}
              <div className="bg-white rounded-lg p-4 border-2 border-red-300">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                  <div>
                    <div className="text-slate-500 text-xs">Total Max Loss (at SL)</div>
                    <div className="text-xl font-bold text-red-600">
                      -${selectedStrategy.totalMaxLoss?.toFixed(2) || '0'}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500 text-xs">Max Loss % of Margin</div>
                    <div className="text-xl font-bold text-red-600">
                      -{((selectedStrategy.totalMaxLoss || 0) / (selectedStrategy.totalMargin || 1) * 100).toFixed(1)}%
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500 text-xs">Break-even Days</div>
                    <div className="text-xl font-bold text-blue-600">
                      {selectedStrategy.breakEvenDays || 'N/A'} days
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500 text-xs">Risk/Reward</div>
                    <div className={`text-xl font-bold ${(selectedStrategy.monthlyPnL || 0) / (selectedStrategy.totalMaxLoss || 1) > 0.5 ? 'text-green-600' : 'text-red-600'}`}>
                      {selectedStrategy.totalMaxLoss > 0 ? ((selectedStrategy.monthlyPnL || 0) / selectedStrategy.totalMaxLoss).toFixed(2) : 'N/A'}
                    </div>
                  </div>
                </div>
              </div>

              {/* When to Close */}
              <div className="mt-4 bg-yellow-100 rounded-lg p-4 border border-yellow-400">
                <div className="font-bold text-yellow-800 mb-2">When to Close Positions</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div>
                    <div className="font-semibold text-green-700 mb-1">Take Profit Triggers:</div>
                    <ul className="text-slate-700 space-y-1 list-disc list-inside">
                      <li>Funding rate flips direction significantly</li>
                      <li>Spread converges (for hedged strategies)</li>
                      <li>After {selectedStrategy.breakEvenDays ? selectedStrategy.breakEvenDays * 3 : 30}+ days of funding collection</li>
                      <li>Monthly ROI target reached ({((selectedStrategy.monthlyPnL || 0) / (selectedStrategy.totalMargin || 1) * 100).toFixed(1)}%)</li>
                    </ul>
                  </div>
                  <div>
                    <div className="font-semibold text-red-700 mb-1">Exit Immediately If:</div>
                    <ul className="text-slate-700 space-y-1 list-disc list-inside">
                      <li>Price hits stop loss level</li>
                      <li>Funding rate changes dramatically against you</li>
                      <li>One leg approaches liquidation</li>
                      <li>Unable to add margin when needed</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>

            {/* Step by Step Execution */}
            <div className="p-4 bg-yellow-50">
              <h3 className="font-bold text-yellow-800 mb-3 flex items-center gap-2">
                <AlertCircle className="w-5 h-5" />
                Step-by-Step Execution Guide
              </h3>
              <div className="space-y-3">
                {selectedStrategy.twilightPosition && (
                  <div className="bg-white rounded-lg p-3 border-l-4 border-orange-500">
                    <div className="flex justify-between items-center">
                      <div className="font-bold text-blue-700">Step 1: Open Twilight Position (Inverse Perp)</div>
                      <span className="bg-orange-100 text-orange-700 text-xs px-2 py-0.5 rounded">BTC-MARGINED</span>
                    </div>
                    <div className="text-sm text-slate-700 mt-2">
                      <span className="font-mono bg-blue-100 px-2 py-0.5 rounded">{selectedStrategy.twilightPosition}</span>
                      {' '}${selectedStrategy.twilightSize} USD worth of BTC at{' '}
                      <span className="font-mono bg-blue-100 px-2 py-0.5 rounded">{selectedStrategy.twilightLeverage}x</span> leverage
                    </div>
                    <div className="mt-2 p-2 bg-orange-50 rounded text-sm">
                      <div className="font-semibold text-orange-800">BTC Margin Required:</div>
                      <div className="text-xl font-bold text-orange-700">
                        {(selectedStrategy.twilightSize / (selectedStrategy.twilightLeverage * twilightPrice)).toFixed(6)} BTC
                      </div>
                      <div className="text-xs text-orange-600">
                        (~${(selectedStrategy.twilightSize / selectedStrategy.twilightLeverage).toFixed(2)} USD at current price)
                      </div>
                    </div>
                  </div>
                )}
                {selectedStrategy.binancePosition && (
                  <div className="bg-white rounded-lg p-3 border-l-4 border-green-500">
                    <div className="flex justify-between items-center">
                      <div className="font-bold text-purple-700">Step {selectedStrategy.twilightPosition ? '2' : '1'}: Open Binance Position (Linear Perp)</div>
                      <span className="bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded">USDT-MARGINED</span>
                    </div>
                    <div className="text-sm text-slate-700 mt-2">
                      <span className="font-mono bg-purple-100 px-2 py-0.5 rounded">{selectedStrategy.binancePosition}</span>
                      {' '}${selectedStrategy.binanceSize} USD worth of BTC-PERP at{' '}
                      <span className="font-mono bg-purple-100 px-2 py-0.5 rounded">{selectedStrategy.binanceLeverage}x</span> leverage
                    </div>
                    <div className="mt-2 p-2 bg-green-50 rounded text-sm">
                      <div className="font-semibold text-green-800">USDT Margin Required:</div>
                      <div className="text-xl font-bold text-green-700">
                        {(selectedStrategy.binanceSize / selectedStrategy.binanceLeverage).toFixed(2)} USDT
                      </div>
                    </div>
                  </div>
                )}
                <div className="bg-white rounded-lg p-3 border-l-4 border-slate-500">
                  <div className="font-bold text-slate-700">Step {(selectedStrategy.twilightPosition ? 1 : 0) + (selectedStrategy.binancePosition ? 1 : 0) + 1}: Monitor & Manage</div>
                  <div className="text-sm text-slate-700 mt-1">
                    Monitor funding rates. Close both positions simultaneously when taking profit or if conditions change.
                  </div>
                  <div className="text-xs text-slate-500 mt-2">
                    Note: P&L on Twilight is in BTC, P&L on Binance is in USDT
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Fee & Contract Comparison */}
      <div className="bg-white rounded-lg p-4 shadow">
        <h3 className="font-bold text-slate-800 mb-3">Contract Type & Fee Structure</h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="bg-blue-50 rounded-lg p-3 border-2 border-blue-200">
            <div className="flex justify-between items-center mb-2">
              <div className="font-bold text-blue-800">Twilight</div>
              <span className="bg-orange-500 text-white text-xs px-2 py-0.5 rounded font-bold">INVERSE PERP</span>
            </div>
            <div className="text-blue-700">Margin: <span className="font-bold">BTC</span></div>
            <div className="text-blue-700">P&L Settlement: <span className="font-bold">BTC</span></div>
            <div className="text-blue-700">Trading Fee: <span className="font-bold text-green-600">0%</span></div>
            <div className="text-blue-700">Funding: Hourly, imbalance-based</div>
          </div>
          <div className="bg-purple-50 rounded-lg p-3 border-2 border-purple-200">
            <div className="flex justify-between items-center mb-2">
              <div className="font-bold text-purple-800">Binance</div>
              <span className="bg-green-500 text-white text-xs px-2 py-0.5 rounded font-bold">LINEAR PERP</span>
            </div>
            <div className="text-purple-700">Margin: <span className="font-bold">USDT</span></div>
            <div className="text-purple-700">P&L Settlement: <span className="font-bold">USDT</span></div>
            <div className="text-purple-700">Taker Fee: <span className="font-bold text-orange-600">0.04%</span></div>
            <div className="text-purple-700">Funding: Every 8 hours</div>
          </div>
        </div>
        <div className="mt-3 p-2 bg-yellow-50 rounded text-xs text-yellow-800">
          <strong>Important:</strong> Hedged strategies require BOTH BTC (for Twilight) AND USDT (for Binance) capital.
        </div>
      </div>
    </div>
  );
};

export default TwilightTradingVisualizerLive;
