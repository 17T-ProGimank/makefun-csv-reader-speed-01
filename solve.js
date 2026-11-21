// V3 experiment: blind slow path (no per-field CR checks) + one CR scan per
// record span; re-parse with the full CR-aware readers only when the span
// holds a CR. A record-ending CRLF's CR is excluded from the span.
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0;
  let line = 1;
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  let recordLine = 1;
  let recordRow = null;

  let outValue = '';
  let outEnded = END;
  let outAdded = 0;

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // ---------- full (CR-aware) readers, as in V2 ----------
  function readUnquotedFull(value) {
    let added = 0;
    while (pos < n) {
      const c = text.indexOf(',', pos);
      const l = text.indexOf('\n', pos);
      if (c === -1 && l === -1) {
        const seg = text.slice(pos);
        const r = seg.indexOf('\r');
        if (r === -1) {
          value += seg;
          added += seg.length;
          pos = n;
          outValue = value; outEnded = END; outAdded = added;
          return;
        }
        if (r > 0) { value += seg.slice(0, r); added += r; }
        error('stray_cr');
        pos += r + 1;
        continue;
      }
      let e;
      let isLF;
      if (l === -1 || (c !== -1 && c < l)) { e = c; isLF = false; } else { e = l; isLF = true; }
      const seg = text.slice(pos, e);
      const r = seg.indexOf('\r');
      if (r === -1) {
        value += seg;
        added += e - pos;
        if (isLF) { pos = e + 1; line += 1; outValue = value; outEnded = LINE_BREAK; outAdded = added; return; }
        pos = e + 1; outValue = value; outEnded = COMMA; outAdded = added; return;
      }
      if (r + 1 === e - pos && isLF) {
        if (r > 0) { value += seg.slice(0, r); added += r; }
        pos = e + 1; line += 1;
        outValue = value; outEnded = LINE_BREAK; outAdded = added; return;
      }
      if (r > 0) { value += seg.slice(0, r); added += r; }
      error('stray_cr');
      pos += r + 1;
    }
    outValue = value; outEnded = END; outAdded = added;
  }

  function readQuotedFull() {
    const open = pos;
    const openLine = line;
    let value = '';
    pos += 1;
    let closed = false;
    while (pos < n) {
      const q = text.indexOf('"', pos);
      if (q === -1) {
        pos = open + 1;
        line = openLine;
        error('unterminated_quote');
        readUnquotedFull('"');
        return;
      }
      const seg = text.slice(pos, q);
      const rn = seg.indexOf('\n');
      const rr = seg.indexOf('\r');
      if (rn === -1 && rr === -1) {
        value += seg;
        if (text.charCodeAt(q + 1) === 34) {
          value += '"';
          pos = q + 2;
          continue;
        }
        pos = q + 1;
        closed = true;
        break;
      }
      let s = 0;
      while (s < seg.length) {
        const a = seg.indexOf('\n', s);
        const b = seg.indexOf('\r', s);
        let bi = -1;
        let isCR = false;
        if (a !== -1 && (b === -1 || a < b)) { bi = a; isCR = false; }
        else if (b !== -1) { bi = b; isCR = true; }
        if (bi === -1) { value += seg.slice(s); break; }
        if (bi > s) value += seg.slice(s, bi);
        value += '\n';
        line += 1;
        s = isCR && seg.charCodeAt(bi + 1) === 10 ? bi + 2 : bi + 1;
      }
      if (text.charCodeAt(q + 1) === 34) {
        value += '"';
        pos = q + 2;
        continue;
      }
      pos = q + 1;
      closed = true;
      break;
    }
    if (!closed) {
      pos = open + 1;
      line = openLine;
      error('unterminated_quote');
      readUnquotedFull('"');
      return;
    }
    if (pos >= n) { outValue = value; outEnded = END; outAdded = 0; return; }
    const c = text[pos];
    if (c === ',') { pos += 1; outValue = value; outEnded = COMMA; outAdded = 0; return; }
    if (c === '\n') { pos += 1; line += 1; outValue = value; outEnded = LINE_BREAK; outAdded = 0; return; }
    if (c === '\r' && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; outValue = value; outEnded = LINE_BREAK; outAdded = 0; return; }
    readUnquotedFull(value);
    if (outAdded > 0) error('quote_junk');
  }

  // ---------- blind readers: no CR handling except a record-ending CRLF.
  // Any other CR in the record's span is caught by the caller's check and
  // the record is re-parsed with the full readers. ----------
  function readUnquotedBlind(value) {
    const c = text.indexOf(',', pos);
    const l = text.indexOf('\n', pos);
    if (c === -1 && l === -1) {
      const seg = text.slice(pos);
      outValue = value + seg;
      outAdded = seg.length;
      outEnded = END;
      pos = n;
      return;
    }
    let e;
    let isLF;
    if (l === -1 || (c !== -1 && c < l)) { e = c; isLF = false; } else { e = l; isLF = true; }
    let end = e;
    // A CR right before the LF that ends the field is the CRLF break.
    if (isLF && e > pos && text.charCodeAt(e - 1) === 13) end = e - 1;
    outValue = value + text.slice(pos, end);
    outAdded = end - pos;
    if (isLF) { pos = e + 1; line += 1; outEnded = LINE_BREAK; }
    else { pos = e + 1; outEnded = COMMA; }
  }

  function readQuotedBlind() {
    const open = pos;
    const openLine = line;
    let value = '';
    pos += 1;
    let closed = false;
    while (pos < n) {
      const q = text.indexOf('"', pos);
      if (q === -1) {
        pos = open + 1;
        line = openLine;
        error('unterminated_quote');
        readUnquotedBlind('"');
        return;
      }
      const seg = text.slice(pos, q);
      let idx = seg.indexOf('\n');
      if (idx !== -1) {
        let cnt = 0;
        do { cnt++; idx = seg.indexOf('\n', idx + 1); } while (idx !== -1);
        line += cnt;
      }
      value += seg;
      if (text.charCodeAt(q + 1) === 34) {
        value += '"';
        pos = q + 2;
        continue;
      }
      pos = q + 1;
      closed = true;
      break;
    }
    if (!closed) {
      pos = open + 1;
      line = openLine;
      error('unterminated_quote');
      readUnquotedBlind('"');
      return;
    }
    if (pos >= n) { outValue = value; outEnded = END; outAdded = 0; return; }
    const c = text[pos];
    if (c === ',') { pos += 1; outValue = value; outEnded = COMMA; outAdded = 0; return; }
    if (c === '\n') { pos += 1; line += 1; outValue = value; outEnded = LINE_BREAK; outAdded = 0; return; }
    if (c === '\r' && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; outValue = value; outEnded = LINE_BREAK; outAdded = 0; return; }
    readUnquotedBlind(value);
    if (outAdded > 0) error('quote_junk');
  }

  function parseBlind() {
    const fields = [];
    let quoted = false;
    let ended = END;
    do {
      quoted = text.charCodeAt(pos) === 34;
      if (quoted) readQuotedBlind(); else readUnquotedBlind('');
      fields.push(outValue);
      ended = outEnded;
    } while (ended === COMMA);
    return { fields, ended, quoted };
  }

  function parseFull() {
    const fields = [];
    let quoted = false;
    let ended = END;
    do {
      quoted = text.charCodeAt(pos) === 34;
      if (quoted) readQuotedFull(); else readUnquotedFull('');
      fields.push(outValue);
      ended = outEnded;
    } while (ended === COMMA);
    return { fields, ended, quoted };
  }

  function finishRecord(fields) {
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      return;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  while (true) {
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) { pos += 1; line += 1; }
      else if (c === 13 && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; }
      else break;
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    const eol = text.indexOf('\n', pos);
    const hasNL = eol !== -1;
    const end = hasNL ? eol : n;
    const rawLine = text.slice(pos, end);
    // A CR at the very end of a line that ends in LF is the CRLF break, not
    // a stray CR; a CR at the end of the last line (no LF) is a stray CR.
    // The first CR in the line is the CRLF one only when it sits at the
    // very end, so one indexOf settles both the check and the strip.
    const crAt = rawLine.indexOf('\r');
    const crlf = hasNL && crAt === rawLine.length - 1;
    if (rawLine.indexOf('"') === -1 && (crAt === -1 || crlf)) {
      const fields = rawLine.split(',');
      if (crlf) {
        const last = fields[fields.length - 1];
        fields[fields.length - 1] = last.slice(0, -1);
      }
      pos = hasNL ? end + 1 : n;
      if (hasNL) line += 1;
      finishRecord(fields);
      continue;
    }

    const start = pos;
    const startLine = line;
    const errLen = errors.length;
    let rec = parseBlind();
    // The record's span, minus its terminating line break (and a CRLF's
    // CR): any CR left in it means the blind parse cannot be trusted.
    let contentEnd = pos;
    if (rec.ended === LINE_BREAK) {
      contentEnd = pos - 1;
      if (contentEnd > start && text.charCodeAt(contentEnd - 1) === 13) contentEnd -= 1;
    }
    if (text.slice(start, contentEnd).indexOf('\r') !== -1) {
      pos = start;
      line = startLine;
      errors.length = errLen;
      rec = parseFull();
    }

    if (rec.fields.length === 1 && rec.fields[0] === '' && !rec.quoted) continue;

    finishRecord(rec.fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
