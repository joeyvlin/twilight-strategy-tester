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
      // Payment = Position Size × Funding Rate / BTC Price (24x per day for hourly)
      // Then convert to USD for comparison
      const twilightFundingPerDayBTC = (twilightSize * Math.abs(twilightFundingRate) * 24) / btcPrice;
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
          All 20 Trading Strategies
        </h3>
        <p className="text-xs text-slate-500 mb-4">
          APY shown assumes flat price. Click "Details" to see P&L at different price movements.
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

                {/* Binance Position Card - LINEAR PERP (USDT-margined) */}
                <div className={`rounded-xl p-4 ${selectedStrategy.binancePosition ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-400'}`}>
                  <div className="flex justify-between items-center mb-1">
                    <div className="text-sm opacity-80">BINANCE POSITION</div>
                    <span className="bg-green-500 text-white text-xs px-2 py-0.5 rounded font-bold">LINEAR PERP</span>
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
                        <div className="bg-green-500/30 rounded-lg p-2 col-span-2">
                          <div className="opacity-90 font-semibold">Margin Required (USDT)</div>
                          <div className="text-2xl font-bold">{selectedStrategy.binanceMarginUSDT?.toFixed(2) || (selectedStrategy.binanceSize / selectedStrategy.binanceLeverage).toFixed(2)} USDT</div>
                        </div>
                        <div className="bg-white/20 rounded-lg p-2 col-span-2">
                          <div className="opacity-70">Trading Fee</div>
                          <div className="text-xl font-bold text-orange-300">${(selectedStrategy.binanceSize * BINANCE_TAKER_FEE * 2).toFixed(2)} (0.04% x2)</div>
                        </div>
                      </div>
                      <div className="mt-3 text-xs bg-white/10 rounded p-2">
                        <div className="font-semibold mb-1">How Linear Perp Works:</div>
                        <div>You deposit USDT as margin. P&L is settled in USDT.</div>
                        <div className="mt-1">Position: {(selectedStrategy.binanceSize / cexPrice).toFixed(6)} BTC worth at ${cexPrice.toLocaleString()}</div>
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-4">No Binance Position</div>
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
                    <div className="text-slate-500">USDT Needed (Binance)</div>
                    <div className="text-xl font-bold text-green-600">
                      {selectedStrategy.binanceMarginUSDT?.toFixed(2) || (selectedStrategy.binancePosition ? (selectedStrategy.binanceSize / selectedStrategy.binanceLeverage).toFixed(2) : '0')} USDT
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
                  <div className="text-2xl font-bold text-blue-800">{(twilightFundingRate * 100).toFixed(4)}%/hr</div>
                  <div className="text-xs text-blue-600 mt-1">
                    {twilightFundingRate > 0 ? 'Longs pay, Shorts receive' : twilightFundingRate < 0 ? 'Shorts pay, Longs receive' : 'Balanced (no payments)'}
                  </div>
                </div>
                <div className="bg-purple-50 rounded-lg p-3">
                  <div className="text-purple-600 font-semibold">Binance Funding</div>
                  <div className="text-2xl font-bold text-purple-800">{(binanceFundingRate * 100).toFixed(4)}%/8h</div>
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
