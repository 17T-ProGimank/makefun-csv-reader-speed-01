# Methodology — csv-reader-speed-01

A fast drop-in for csv-reader 1.0.0 (make.fun's own CSV reader). `solve.js`
exports `run(input)`, which returns exactly csv-reader's answer
`{columns, rows, errors}` for every `{text, header}`, in much less CPU
time. Written from the competition's description of csv-reader's reading
policy; no other entry's code was read or copied.

## The reading policy (as the competition states it)

- A U+FEFF at the very start of the text is dropped.
- A record ends at LF or CRLF; a line left with no characters is no record.
- Outside quotes a CR not followed by LF is dropped (`stray_cr`).
- A field that opens with a quote runs to the next quote that is not
  doubled; `""` inside it is one quote, and each CRLF or lone CR inside it
  is read as LF; what follows its closing quote, up to the next comma or
  line break, is appended as it stands (`quote_junk`, when the field ends);
  a quote that never closes is a literal character and the text after it is
  read again as unquoted (`unterminated_quote`).
- A quote inside an unquoted field is a literal character. Fields stay
  strings, never trimmed or converted.
- `columns` is the first record when `header` is true, else null; `rows`
  holds the records after it, each padded with `""` (`short_row`, with
  `fields`: its field count) or cut (`long_row`, with `extra`: the cut
  fields) to the first record's width.
- Each error is `{code, line, row}`, in the order met; `line` is the
  1-based line the record starts on (counting every LF, CRLF and lone CR
  inside quotes) and `row` is the record's index in `rows` (null for the
  header).

## Approach: two tiers, verify-and-reparse

csv-reader reads one character at a time and grows every field a character
at a time. This reader works a record at a time and only slows down where
a record forces it to.

**Tier 1 — fast path (about 24% of practice records).** A record whose raw
line holds no double quote and no stray CR is its line split on commas
with one native `String.split(',')`. The line is found with one
`indexOf('\n')`; the quote/CR test runs on the line's own slice, so no scan
ever runs past the record it belongs to. A CR at the very end of a line
that ends in LF is the CRLF break (stripped from the last split field);
a CR at the end of the last line (no LF) is a stray CR and sends the
record to tier 2.

**Tier 2 — slow path (about 76% of practice records: any record holding a
quote).** The record is parsed field by field under the full policy, but
each field is scanned in slices between the characters that can end or
change it (`,` and LF for unquoted fields, `"` and LF for quoted ones)
with `indexOf`, instead of one step per character. Two reader pairs are
kept:

- *Blind readers* assume the record holds no CR except a record-ending
  CRLF. They are the ones that run first.
- *Full (CR-aware) readers* handle stray CRs and CRs inside quotes.

After the blind parse, one scan checks the record's span (minus its
terminating line break and a CRLF's CR) for a CR. If one is found, the
record is rewound (`pos`, `line`, and the error list truncated) and
re-parsed with the full readers. CRs are rare (a stray CR hits about
0.4% of records), so the re-parse almost never runs — but when it does,
the answer is exactly the full policy's. The same rewind machinery
covers the blind parse's `quote_junk` / `unterminated_quote` errors, so
no wrong error can survive a re-parse.

Record boundaries cannot differ between the blind and full parses: a CR
never ends a record except as the CR of a CRLF, where the LF ends it in
both. Line counting is exact in both: the blind readers count every LF
inside quotes, and any lone CR inside quotes is caught by the span check.

**Other choices.** Field results travel in shared slots instead of a
fresh object per field; `main.ts` is the kit's driver (with V8's
incremental marking off, as the house baseline runs). Nothing is cached
between cases, and nothing depends on a clock, randomness, or locale, so
the two graded executions write byte-identical outputs.

## What was tried and kept

- V1 (regex segment scans, one result object per field): 3.25x the
  baseline's CPU on the practice set.
- V2 (indexOf segment scans, shared result slots, no regex): 3.3x.
- V3 (V2 + blind parse with a per-record CR check and full re-parse):
  ~4–5x. Kept.
- V4 (whole unquoted runs split at once): ~1.5x *slower* than V3 on a
  head-to-head in one process — discarded.
- V5 (regex for unquoted fields instead of two `indexOf` calls): ~9%
  slower than V3 — discarded.
- Final edit on top of V3: the fast path now settles the quote/CR check
  with a single `indexOf('\r')` (the first CR is the CRLF one only when
  it sits at the line's very end) and strips the CRLF from the last split
  field, instead of allocating a second slice of the line.

## Measured on the practice set

Kit practice set: 6 cases, 1.4–1.85M characters each (~10 MB of CSV),
8–18 columns, 6,250–14,171 rows per case, 179–392 errors per case.
Timed locally with `node --no-incremental-marking`, median CPU over
repeated runs of `run()` on all 6 cases (machine is shared, so figures
move between runs; the ratio below is from head-to-head runs in one
process):

| | CPU (median) |
|---|---|
| csv-reader 1.0.0 (house baseline) | ~1,300 ms |
| this entry | ~250–340 ms |
| speedup | ~4–5x |

All 6 practice cases byte-identical to the oracle
(`practice/reference/expected.json`) and to csv-reader 1.0.0's own
`readCsv` run here.

## Worked examples (verified)

Each input below was run through this entry's `run()` and through
csv-reader 1.0.0's `readCsv`; the two outputs matched in every case
(16/16). Inputs are shown JSON-escaped.

### 1. Clean, header, LF

- input: `"a,b,c\n1,2,3\n4,5,6\n"` header=true
- output: `{"columns":["a","b","c"],"rows":[["1","2","3"],["4","5","6"]],"errors":[]}`

### 2. CRLF + BOM, no header

- input: `"\uFEFFx,y\r\n7,8\r\n9,10"` header=false
- output: `{"columns":null,"rows":[["x","y"],["7","8"],["9","10"]],"errors":[]}`

### 3. Quoted comma + doubled quote + junk

- input: `"h1,h2\n\"a,b\",\"c\"\"d\"kg\n"` header=true
- output: `{"columns":["h1","h2"],"rows":[["a,b","c\"dkg"]],"errors":[{"code":"quote_junk","line":2,"row":0}]}`

### 4. Quoted field spanning lines, lone CR inside

- input: `"h\n\"line1\rline2\nline3\"\n"` header=true
- output: `{"columns":["h"],"rows":[["line1\nline2\nline3"]],"errors":[]}` — the lone
  CR inside the quotes becomes LF, and the LF inside the quotes stays LF.

### 5. Stray CR in an unquoted field

- input: `"a,b\nx\ry,z\n"` header=true
- output: `{"columns":["a","b"],"rows":[["xy","z"]],"errors":[{"code":"stray_cr","line":2,"row":0}]}`

### 6. Short row, long row, blank line

- input: `"a,b,c\n1,2\n\n1,2,3,4,5\n"` header=true
- output: `{"columns":["a","b","c"],"rows":[["1","2",""],["1","2","3"]],"errors":[{"code":"short_row","line":2,"row":0,"fields":2},{"code":"long_row","line":4,"row":1,"extra":["4","5"]}]}` — the blank line is no record.

### 7. Unterminated quote (tail)

- input: `"a,b\n\"1,2,3\n4,5,6\n"` header=true
- output: `{"columns":["a","b"],"rows":[["\"1","2"],["4","5"]],"errors":[{"code":"unterminated_quote","line":2,"row":0},{"code":"long_row","line":2,"row":0,"extra":["3"]},{"code":"long_row","line":3,"row":1,"extra":["6"]}]}` — the opening quote is a
  literal character and the rest of the line is read again as unquoted; the
  records after it hold no quote and parse normally.

### 8. Empty fields, quoted empty, only-stray-CRs line

- input: `"a,b\n,\n\"\"\n\r\n1,2\n"` header=true
- output: `{"columns":["a","b"],"rows":[["",""],["",""],["1","2"]],"errors":[{"code":"short_row","line":3,"row":1,"fields":1}]}` — the `""` record is one
  empty field (short row); the `\r\n` line is blank and no record.

### 9. Quote inside an unquoted field is literal

- input: `"a,b\nx\"y,z\n"` header=true
- output: `{"columns":["a","b"],"rows":[["x\"y","z"]],"errors":[]}`

### 10. No trailing newline, last record short

- input: `"a,b,c\n1,2"` header=true
- output: `{"columns":["a","b","c"],"rows":[["1","2",""]],"errors":[{"code":"short_row","line":2,"row":0,"fields":2}]}`

### 11. Empty text, header true

- input: `""` header=true
- output: `{"columns":[],"rows":[],"errors":[]}`

### 12. BOM only

- input: `"\uFEFF"` header=false
- output: `{"columns":null,"rows":[],"errors":[]}`

### 13. Header only, no rows

- input: `"a,b,c\n"` header=true
- output: `{"columns":["a","b","c"],"rows":[],"errors":[]}`

### 14. CRLF inside quotes becomes LF

- input: `"h\n\"a\r\nb\"\n"` header=true
- output: `{"columns":["h"],"rows":[["a\nb"]],"errors":[]}`

### 15. Junk of only a stray CR is not quote_junk

- input: `"h\n\"a\"\r,x\n"` header=true
- output: `{"columns":["h"],"rows":[["a"]],"errors":[{"code":"stray_cr","line":2,"row":0},{"code":"long_row","line":2,"row":0,"extra":["x"]}]}` — the CR after the
  closing quote is dropped (stray_cr), so nothing was kept as junk and no
  `quote_junk` is recorded; the `x` is a second field, cut as long_row.

### 16. Short header row then long row, no header

- input: `"1,2\n3,4,5,6\n"` header=false
- output: `{"columns":null,"rows":[["1","2"],["3","4"]],"errors":[{"code":"long_row","line":2,"row":1,"extra":["5","6"]}]}` — the first record sets the width
  even without a header.
