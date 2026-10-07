import assert from 'node:assert/strict';
import { compareResults, speedup, efficiency, median } from '../frontend/js/metrics.js';

const base = { records: 10, positiveRecords: 4, negativeRecords: 5, returnCount: 10, highestPrice: 9, lowestPrice: 1,
  averageOpen: 5, averageClose: 5, totalVolume: 8.54472947647730e14, averageVolume: 4.27e8, averageReturn: -0.0073 };

// identical -> match
assert.equal(compareResults(base, { ...base }).match, true);
// float-reorder noise -> still match (tolerance), but not bit identical
const noisy = { ...base, totalVolume: base.totalVolume + 322 };
let r = compareResults(base, noisy);
assert.equal(r.match, true); assert.equal(r.allBitIdentical, false);
// integer difference -> mismatch
assert.equal(compareResults(base, { ...base, positiveRecords: 5 }).match, false);
// max differs -> mismatch (exact rule)
assert.equal(compareResults(base, { ...base, highestPrice: 9.0000001 }).match, false);
// real error in a sum -> mismatch
assert.equal(compareResults(base, { ...base, totalVolume: base.totalVolume * 1.001 }).match, false);

assert.equal(speedup(2, 1), 2); assert.equal(speedup(1, 0), null);
assert.equal(efficiency(3, 4), 75); assert.equal(efficiency(null, 4), null);
assert.equal(median([3, 1, 2]), 2); assert.equal(median([1, 2, 3, 4]), 2.5);
console.log('metrics tests passed');
