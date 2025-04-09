import { suite, add, cycle, complete } from 'benny';

// ---------------
// Function 1: Medium slow (nested sums)
function slowSumMedium(n) {
  let total = 0;
  for (let i = 0; i < n; i++) {
    total += (i + 1) * (i + 2) / 2;
  }
  return total;
}

// ---------------
// Function 2: Fast (direct formula)
function slowSumFast(n) {
  return (n * (n + 1) * (n + 2)) / 6;
}

// ---------------
// Function 3: Extremely slow (triple nested loops)
function slowSumVerySlow(n) {
  let total = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      for (let k = 0; k <= j; k++) {
        total += 1;
      }
    }
  }
  return total;
}

// ---------------
// Run Benchmark Suite
await suite(
  'Slow Sum Benchmarks',

  add('slowSumMedium (nested sums)', () => {
    slowSumMedium(100);
  }),

  add('slowSumFast (direct formula)', () => {
    slowSumFast(100);
  }),

  add('slowSumVerySlow (triple nested loops)', () => {
    slowSumVerySlow(100);
  }),

  cycle(),
  complete()
);