// Pure helper functions shared by the browser UI and the Node backend.
// No fake data is created here: everything is computed from values
// that were printed by the real sequential / OpenMP programs.

// How each field of the program output is compared in the correctness check.
//  exact : integers, min and max must be identical.
//  tol   : floating-point sums/averages. OpenMP's reduction(+:...) adds
//          partial sums in a different order than the sequential loop, so the
//          last few bits may differ. We accept a relative error <= REL_TOL.
export const REL_TOL = 1e-9;

export const FIELDS = [
  { key: 'records',         label: 'Total EQ records',        rule: 'exact', group: 'count'  },
  { key: 'positiveRecords', label: 'Positive records',        rule: 'exact', group: 'count'  },
  { key: 'negativeRecords', label: 'Negative records',        rule: 'exact', group: 'count'  },
  { key: 'returnCount',     label: 'Records with valid return', rule: 'exact', group: 'count' },
  { key: 'highestPrice',    label: 'Highest price',           rule: 'exact', group: 'minmax' },
  { key: 'lowestPrice',     label: 'Lowest price',            rule: 'exact', group: 'minmax' },
  { key: 'averageOpen',     label: 'Average open price',      rule: 'tol',   group: 'sumavg' },
  { key: 'averageClose',    label: 'Average close price',     rule: 'tol',   group: 'sumavg' },
  { key: 'totalVolume',     label: 'Total trading volume',    rule: 'tol',   group: 'sumavg' },
  { key: 'averageVolume',   label: 'Average trading volume',  rule: 'tol',   group: 'sumavg' },
  { key: 'averageReturn',   label: 'Average daily return (%)', rule: 'tol',  group: 'return' },
];

export function compareResults(seq, par) {
  const rows = FIELDS.map(f => {
    const a = seq[f.key], b = par[f.key];
    const absDiff = Math.abs(a - b);
    const denom = Math.max(Math.abs(a), Math.abs(b));
    const relDiff = denom === 0 ? 0 : absDiff / denom;
    const identical = a === b;
    const ok = f.rule === 'exact' ? identical : relDiff <= REL_TOL;
    return { ...f, seq: a, par: b, absDiff, relDiff, identical, ok };
  });
  return { rows, match: rows.every(r => r.ok), allBitIdentical: rows.every(r => r.identical) };
}

export const speedup = (tSeq, tPar) => (tPar > 0 ? tSeq / tPar : null);
export const efficiency = (sp, threads) => (sp == null || !threads ? null : (sp / threads) * 100);

export function median(arr) {
  const s = [...arr].sort((x, y) => x - y);
  const n = s.length;
  if (!n) return null;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}
