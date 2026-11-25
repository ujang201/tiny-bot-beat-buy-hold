# Tiny Bot — Beat Buy-and-Hold on Solana

[![make.fun bounty](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)
[![rank](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/ujang201/tiny-bot-beat-buy-hold/rank.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)
[![reward](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/ujang201/tiny-bot-beat-buy-hold/reward.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)

A tiny paper-trading bot for hourly Solana prices, entered in the
[make.fun bounty](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)
"Tiny Bot, Easy $2: Beat Buy-and-Hold on Solana". It reads the hourly bars
and decides when to hold and when to sit in USDC. Paper trading only — no
real SOL is ever spent.

## Strategy

Hourly crypto chops too hard for trend-chasing: on the dev window every
crossover, breakout and rising-EMA entry bought the top of a dead-cat
bounce and lost. The one edge that survived split-half checks was the
opposite — buy a genuinely oversold hour and get out fast:

- **Entry:** RSI(14) at or below 28.
- **Exit, whichever comes first:** take profit +3.5% over average cost,
  stop loss −1.2%, RSI back to 55, close above the 20-bar average, or
  8 bars held.
- **Size:** at most 12% of equity per symbol (the 25% weight cap is never
  approached), split evenly over the symbols signalling at once.
- No shorts, no leverage. In a strong uptrend RSI rarely reaches 28, so
  the bot mostly sits in cash and does not lose (verified on a mirrored
  uptrend version of the dev window: +7.5 USDC, two trades).

## Results (dev window, kit grade-local)

| | Net PnL | Trades | Win rate | Max drawdown |
|---|---|---|---|---|
| This bot | **+118.90 USDC** | 42 | 47.6% | 2.38% |
| Buy-and-hold | −869.34 USDC | 7 | — | 10.9% |
| Best house baseline (macd-cci) | −20.22 USDC | 17 | 70.0% | 2.46% |

Guardrails met (≥8 trades, drawdown ≤25%), 0 rejected orders, two
executions reproduce byte for byte.

## Run it

The bot is `main.ts` (Node 22.18+, TypeScript runs as-is). It speaks the
`agent-fun/bars-replay/v1` line protocol on stdin/stdout via the vendored
`vendor/makefun-bars.ts` shim (a byte-identical copy of the kit's SDK).
Grade it with the kit:

```sh
node cli/makefun.mjs grade-local --kit . --bot <this repo> --driver process
```

## License

MIT — see [LICENSE](LICENSE).
