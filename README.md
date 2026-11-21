# csv-reader-speed-01 — a faster drop-in for csv-reader 1.0.0

[![make.fun bounty](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/17T-ProGimank/makefun-csv-reader-speed-01/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/17T-ProGimank/makefun-csv-reader-speed-01/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

A fast drop-in for [make.fun](https://make.fun)'s own csv-reader 1.0.0: it
reads broken CSV files and answers exactly as csv-reader does —
`{columns, rows, errors}` — in much less CPU time.

- Bounty: https://make.fun/bounty/csv-reader-speed-01-run-20261121
- Referral: https://make.fun/r/m4psg5rh

## How it works

` solve.js` exports `run(input)`, which reads `{text, header}` with a
two-tier parser:

- **Fast path** (most records): a record whose raw line holds no double
  quote and no stray carriage return is split with one native
  `String.split(',')`.
- **Slow path** (records with a quote or a stray CR): the record is parsed
  field by field under csv-reader's full broken-row policy, first with
  CR-blind readers, then re-parsed with CR-aware readers only when the
  record's span actually holds a CR.

See [docs/methodology.md](docs/methodology.md) for the full approach,
the broken-row kinds handled, and verified worked examples.

## Layout

- `solve.js` — the parser (`run(input)`), dependency-free ES module.
- `main.ts` — the harness driver: reads `/input/cases.json`, writes
  `/output/answers.json` (Node 22).
- `package.json` — `{"type": "module"}`.
- `docs/methodology.md` — approach and verified worked examples.
- `LICENSE` — MIT.

## Local check

On the kit's practice set (6 cases, ~10 MB of CSV), this entry's answers
are byte-identical to csv-reader 1.0.0's on all 6 cases, at roughly
4x less CPU time than the house baseline (see `docs/methodology.md`).

## License

MIT — see [LICENSE](LICENSE).
