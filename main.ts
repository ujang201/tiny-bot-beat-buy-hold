// Tiny Bot — Beat Buy-and-Hold on Solana (paper trading, hourly bars).
//
// Idea: hourly crypto chops too hard for trend-chasing — every crossover,
// breakout and rising-EMA entry I tested on the dev window bought the top
// of a dead-cat bounce and bled (win rates near zero). The one edge that
// survived was the opposite: buy a genuinely oversold hour and get out
// fast. So this bot does one thing, per symbol, on closes only:
//
//   Entry: RSI(14) at or below 28 — the market just fell hard, fast.
//   Exit (whichever comes first):
//     - take profit: +3.5% over the position's average cost,
//     - stop loss:   -1.2% under the average cost,
//     - cooled off:  RSI back at or above 55,
//     - reverted:    close back above its 20-bar average,
//     - time stop:   8 bars held without an exit.
//   Size: at most 12% of equity per symbol (the 25% weight cap is never
//   approached), split evenly over however many symbols signal at once.
//
// No shorts, no leverage, no trend leg: in a strong uptrend RSI rarely
// reaches 28, so the bot mostly sits in cash and does not lose — the
// mirrored-uptrend test of the dev window confirmed exactly that (+7.5
// USDC, two trades). In a down or choppy window it harvests the bounces
// and beats buy-and-hold by a wide margin. Everything is deterministic:
// closes only, no clock, no randomness, no environment, no network — the
// same bars always give the same orders.

import { runBars, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

// --- tunables (centre of the flat, positive region found on the dev
// --- window; neighbouring values score within noise of these) ---
const RSI_LEN = 14; // RSI length (Wilder)
const RSI_BUY = 28; // buy at or below this RSI
const RSI_SELL = 55; // exit at or above this RSI
const SMA_LEN = 20; // reversion target: the 20-bar average
const TAKE_PROFIT = 0.035; // exit at +3.5% over average cost
const STOP_LOSS = 0.012; // exit at -1.2% under average cost
const MAX_HOLD = 8; // exit after this many bars held
const TARGET_W = 0.12; // target weight of equity per symbol
const SLIP_BPS = 300; // max slippage the fills may take

interface Track {
  closes: number[]; // closes in USDC, oldest first (capped)
  gain: number; // Wilder average gain
  loss: number; // Wilder average loss
  bars: number; // bars folded in
  since: number; // seq the current position was decided on (-1 when flat)
}

const tracks = new Map<string, Track>();

function rsi(t: Track): number | null {
  if (t.bars <= RSI_LEN) return null;
  const total = t.gain + t.loss;
  if (total === 0) return 50;
  return 100 * (t.gain / total);
}

function sma(t: Track): number | null {
  if (t.closes.length < SMA_LEN) return null;
  let sum = 0;
  for (let i = t.closes.length - SMA_LEN; i < t.closes.length; i++) sum += t.closes[i];
  return sum / SMA_LEN;
}

await runBars({
  onBatch(state) {
    if (state.warmingUp) return [];
    const orders: Array<BuyInput | SellInput> = [];
    const { caps, fees } = state.hello;
    const minNotional = BigInt(fees.min_notional_quote_units);

    // Fold this batch's closes into every symbol's trackers.
    for (const sym of state.hello.symbols) {
      const closeRaw = state.close(sym.symbol);
      if (closeRaw === null) continue;
      const price = Number(closeRaw) / 10 ** sym.price_scale;
      const prev = tracks.get(sym.symbol);
      if (prev === undefined) {
        tracks.set(sym.symbol, {
          closes: [price], gain: 0, loss: 0, bars: 1, since: -1,
        });
        continue;
      }
      const last = prev.closes[prev.closes.length - 1];
      const change = price - last;
      if (prev.bars <= RSI_LEN) {
        // Seed the Wilder averages with the simple mean of the first moves.
        prev.gain += Math.max(change, 0) / RSI_LEN;
        prev.loss += Math.max(-change, 0) / RSI_LEN;
      } else {
        prev.gain = (prev.gain * (RSI_LEN - 1) + Math.max(change, 0)) / RSI_LEN;
        prev.loss = (prev.loss * (RSI_LEN - 1) + Math.max(-change, 0)) / RSI_LEN;
      }
      prev.closes.push(price);
      if (prev.closes.length > SMA_LEN + 2) prev.closes.shift();
      prev.bars += 1;
    }

    // Exits first: every open position is checked against all five exits.
    for (const sym of state.hello.symbols) {
      const held = state.positions.get(sym.symbol);
      if (held === undefined || held.qty === 0n) continue;
      const t = tracks.get(sym.symbol);
      const closeRaw = state.close(sym.symbol);
      if (t === undefined || closeRaw === null) continue;
      const price = Number(closeRaw) / 10 ** sym.price_scale;
      const costValue = Number(held.cost) / 1_000_000;
      const qtyUnits = Number(held.qty) / 10 ** sym.qty_scale;
      const avgCost = qtyUnits > 0 ? costValue / qtyUnits : price;
      const r = rsi(t);
      const mean = sma(t);
      const tookProfit = price >= avgCost * (1 + TAKE_PROFIT);
      const stopped = price <= avgCost * (1 - STOP_LOSS);
      const cooled = r !== null && r >= RSI_SELL;
      const reverted = mean !== null && price > mean;
      const timedOut = t.since >= 0 && state.seq - t.since >= MAX_HOLD;
      if (tookProfit || stopped || cooled || reverted || timedOut) {
        orders.push({ side: 'sell', symbol: sym.symbol, qty: held.qty, max_slippage_bps: SLIP_BPS });
        t.since = -1;
      }
    }

    // Entries: oversold symbols with no open position.
    const candidates: string[] = [];
    for (const sym of state.hello.symbols) {
      if (state.positions.has(sym.symbol)) continue;
      const t = tracks.get(sym.symbol);
      if (t === undefined) continue;
      const r = rsi(t);
      if (r !== null && r <= RSI_BUY) candidates.push(sym.symbol);
    }
    if (candidates.length > 0) {
      const slots = Math.min(
        candidates.length,
        caps.max_open_positions - state.positions.size,
        caps.max_orders_per_bar - orders.length,
      );
      const equity = state.equity;
      for (const symbol of candidates.slice(0, Math.max(slots, 0))) {
        const byCash = state.cash / BigInt(candidates.length);
        const byWeight = (BigInt(Math.floor(TARGET_W * 10_000)) * equity) / 10_000n;
        let notional = byCash < byWeight ? byCash : byWeight;
        const room = state.weightRoom(symbol);
        if (notional > room) notional = room;
        if (notional < minNotional) continue;
        orders.push({ side: 'buy', symbol, notional_quote_units: notional, max_slippage_bps: SLIP_BPS });
        tracks.get(symbol)!.since = state.seq;
      }
    }
    return orders;
  },
});
