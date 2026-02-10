/**
 * Funding averages (past 1y) with hybrid storage:
 * 1. Try static /funding-averages.json; if TTL fresh, use it.
 * 2. Else try localStorage; if TTL fresh, use it.
 * 3. Else fetch Binance + Bybit history, compute averages, save to localStorage.
 */

const STORAGE_KEY = 'fundingAverages';
const BINANCE_API = 'https://fapi.binance.com/fapi/v1/fundingRate';
const BYBIT_API = 'https://api.bybit.com/v5/market/funding/history';
const PERIODS_PER_DAY = 3;
const MS_PER_DAY = 86400 * 1000;

function isFresh(data) {
  if (!data || data.fetchedAt == null || data.ttlSeconds == null) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  return nowSec < data.fetchedAt + data.ttlSeconds;
}

async function fetchBinanceAverage() {
  const now = Date.now();
  const oneYearAgo = now - 365 * MS_PER_DAY;
  const allRates = [];

  let endTime = now;
  while (allRates.length < 1100) {
    const url = `${BINANCE_API}?symbol=BTCUSDT&limit=1000&endTime=${endTime}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Binance: ${res.status}`);
    const arr = await res.json();
    if (!Array.isArray(arr) || arr.length === 0) break;
    allRates.push(...arr.map((r) => parseFloat(r.fundingRate)));
    const oldest = arr[0];
    const firstTime = typeof oldest.fundingTime === 'number' ? oldest.fundingTime : parseInt(oldest.fundingTime, 10);
    if (firstTime <= oneYearAgo) break;
    endTime = firstTime - 1;
  }

  if (allRates.length === 0) return 0;
  return allRates.reduce((a, b) => a + b, 0) / allRates.length;
}

async function fetchBybitAverage() {
  const now = Date.now();
  const oneYearAgo = now - 365 * MS_PER_DAY;
  const allRates = [];

  let endTime = now;
  while (allRates.length < 1100) {
    const url = `${BYBIT_API}?category=inverse&symbol=BTCUSD&limit=200&endTime=${endTime}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Bybit: ${res.status}`);
    const json = await res.json();
    const list = json?.result?.list;
    if (!Array.isArray(list) || list.length === 0) break;
    for (const r of list) {
      allRates.push(parseFloat(r.fundingRate));
    }
    const oldest = list[list.length - 1];
    const firstTime = parseInt(oldest.fundingRateTimestamp, 10);
    if (firstTime <= oneYearAgo) break;
    endTime = firstTime - 1;
  }

  if (allRates.length === 0) return 0;
  return allRates.reduce((a, b) => a + b, 0) / allRates.length;
}

/**
 * Returns { binanceAvg1y, bybitAvg1y, fetchedAt, ttlSeconds, source }.
 * source is 'static' | 'localStorage' | 'api'.
 */
export async function getFundingAverages() {
  const ttlSeconds = 86400; // default 24h if not in file

  try {
    const staticRes = await fetch('/funding-averages.json');
    if (staticRes.ok) {
      const data = await staticRes.json();
      const ttl = data.ttlSeconds ?? ttlSeconds;
      const payload = {
        binanceAvg1y: data.binanceAvg1y ?? 0,
        bybitAvg1y: data.bybitAvg1y ?? 0,
        fetchedAt: data.fetchedAt ?? 0,
        ttlSeconds: ttl
      };
      if (isFresh(payload)) {
        return { ...payload, source: 'static' };
      }
    }
  } catch (_) {
    // ignore
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (isFresh(data)) {
        return { ...data, source: 'localStorage' };
      }
    }
  } catch (_) {
    // ignore
  }

  const binanceAvg1y = await fetchBinanceAverage();
  const bybitAvg1y = await fetchBybitAverage();
  const fetchedAt = Math.floor(Date.now() / 1000);
  const payload = {
    binanceAvg1y,
    bybitAvg1y,
    fetchedAt,
    ttlSeconds
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (_) {}
  return { ...payload, source: 'api' };
}

/**
 * APR from average 8h funding rate, as % of notional.
 * Matches strategy funding P&L: per 8h payment = positionSize * rate; 3 payments/day; 365 days.
 * So annual $ P&L = positionSize * avgRate * (3*365) => APR = avgRate * 3 * 365 * 100.
 * SHORT earns when rate > 0 (+APR); LONG pays when rate > 0 (-APR).
 */
export function avgRateToAPR(avgRatePer8h) {
  return avgRatePer8h * PERIODS_PER_DAY * 365 * 100;
}
