/**
 * Lending Pool + Perp Hedge Strategies
 * -----------------------------------
 * When you lend to the Twilight pool you earn APY. Depending on skew:
 * - Pool long-heavy (long_pct > 0.5) → lender is effectively short → hedge with Long Twilight perp.
 * - Pool short-heavy (short_pct > 0.5) → lender is effectively long → hedge with Short Twilight perp.
 * Strategies combine pool APY (from last_day_apy) with perp hedge P&L from the main calculator.
 */

const LEND_SIZE_DEFAULT = 100_000; // USD notional for lend leg
const HEDGE_LEVERAGE = 10;

/**
 * Build lending-pool strategy objects.
 * @param {Object} params
 * @param {number} params.idStart
 * @param {Object} params.marketStats - { longPct, shortPct, poolEquityBtc, utilization, status }
 * @param {number|null} params.poolApy24h - last 24h APY % (e.g. 8.21)
 * @param {number} params.btcPrice - for USD conversion
 * @param {number} params.tvl
 * @param {Function} params.calculateStrategyAPY - (strategy) => metrics (Twilight perp leg only; binancePosition null)
 * @returns {Array<Object>} Strategy objects with isLendingPoolStrategy: true, category: 'Lending Pool'
 */
export function buildLendingPoolStrategies({
  idStart,
  marketStats,
  poolApy24h,
  btcPrice,
  tvl,
  calculateStrategyAPY,
}) {
  const strategies = [];
  let nextId = idStart;

  if (!marketStats || btcPrice <= 0) return strategies;
  const { longPct, shortPct } = marketStats;
  const apyDisplay = poolApy24h != null ? poolApy24h.toFixed(2) : '—';
  const lendSize = Math.min(LEND_SIZE_DEFAULT, tvl);
  const hedgeSize = lendSize;

  // Pool long-heavy → lender short → hedge with Long perp
  if (longPct > 0.5) {
    const hedgeMetrics = calculateStrategyAPY({
      twilightPosition: 'LONG',
      twilightSize: hedgeSize,
      twilightLeverage: HEDGE_LEVERAGE,
      binancePosition: null,
      binanceSize: 0,
      binanceLeverage: 0,
    });
    const poolApy = poolApy24h ?? 0;
    const combinedApy = poolApy + (hedgeMetrics.apy ?? 0);
    strategies.push({
      id: nextId++,
      name: `Lend to pool + Long perp hedge ${HEDGE_LEVERAGE}x`,
      description: `Pool ${(longPct * 100).toFixed(1)}% long → lender is short. Earn pool APY (${apyDisplay}%) + hedge with Long Twilight perp.`,
      category: 'Lending Pool',
      isLendingPoolStrategy: true,
      twilightPosition: 'LONG',
      twilightSize: hedgeSize,
      twilightLeverage: HEDGE_LEVERAGE,
      binancePosition: null,
      binanceSize: 0,
      binanceLeverage: 0,
      risk: 'LOW',
      poolApy24h: poolApy24h,
      ...hedgeMetrics,
      apy: combinedApy,
      monthlyPnL: (lendSize * (combinedApy / 100) / 12) + (hedgeMetrics.monthlyPnL ?? 0),
    });
  }

  // Pool short-heavy → lender long → hedge with Short perp
  if (shortPct > 0.5) {
    const hedgeMetrics = calculateStrategyAPY({
      twilightPosition: 'SHORT',
      twilightSize: hedgeSize,
      twilightLeverage: HEDGE_LEVERAGE,
      binancePosition: null,
      binanceSize: 0,
      binanceLeverage: 0,
    });
    const poolApy = poolApy24h ?? 0;
    const combinedApy = poolApy + (hedgeMetrics.apy ?? 0);
    strategies.push({
      id: nextId++,
      name: `Lend to pool + Short perp hedge ${HEDGE_LEVERAGE}x`,
      description: `Pool ${(shortPct * 100).toFixed(1)}% short → lender is long. Earn pool APY (${apyDisplay}%) + hedge with Short Twilight perp.`,
      category: 'Lending Pool',
      isLendingPoolStrategy: true,
      twilightPosition: 'SHORT',
      twilightSize: hedgeSize,
      twilightLeverage: HEDGE_LEVERAGE,
      binancePosition: null,
      binanceSize: 0,
      binanceLeverage: 0,
      risk: 'LOW',
      poolApy24h: poolApy24h,
      ...hedgeMetrics,
      apy: combinedApy,
      monthlyPnL: (lendSize * (combinedApy / 100) / 12) + (hedgeMetrics.monthlyPnL ?? 0),
    });
  }

  // Lend only (no hedge) for comparison
  strategies.push({
    id: nextId++,
    name: `Lend to pool only (no hedge)`,
    description: `Earn pool APY (${apyDisplay}%). You take skew risk: long-heavy pool = you are short; short-heavy = you are long.`,
    category: 'Lending Pool',
    isLendingPoolStrategy: true,
    twilightPosition: null,
    twilightSize: 0,
    twilightLeverage: 0,
    binancePosition: null,
    binanceSize: 0,
    binanceLeverage: 0,
    risk: 'MEDIUM',
    poolApy24h: poolApy24h,
    totalMargin: lendSize,
    monthlyPnL: poolApy24h != null ? lendSize * (poolApy24h / 100) / 12 : 0,
    apy: poolApy24h ?? 0,
    pnlUp5: null,
    pnlDown5: null,
    targetTwilightRatePct: null,
  });

  return strategies;
}
