const benny = require('benny');

// Original implementation
function naiveFactorialOriginal(n) {
  if (n < 0) {throw new Error('Cannot compute factorial of negative numbers.');}
  if (n === 0 || n === 1) {return 1;}

  let result = 1;
  for (let i = 2; i <= n; i++) {
    let intermediate = 0;
    for (let j = 0; j < i; j++) {
      intermediate += result; // Repeated addition
    }
    result = intermediate;
  }

  return result;
}

function processNumbersOriginal(numbers) {
  const results = [];
  for (const num of numbers) {
    const fact = naiveFactorialOriginal(num);
    results.push({
      original: num,
      factorial: fact,
    });
  }
  return results;
}

// Alternate 1: Direct multiplication
function naiveFactorialAlt1(n) {
  if (n < 0) {throw new Error('Cannot compute factorial of negative numbers.');}
  if (n === 0 || n === 1) {return 1;}

  let result = 1;
  for (let i = 2; i <= n; i++) {
    result *= i;
  }

  return result;
}

function processNumbersAlt1(numbers) {
  const results = [];
  for (const num of numbers) {
    const fact = naiveFactorialAlt1(num);
    results.push({
      original: num,
      factorial: fact,
    });
  }
  return results;
}

// Alternate 2: Using Array and reduce
function naiveFactorialAlt2(n) {
  if (n < 0) {throw new Error('Cannot compute factorial of negative numbers.');}
  if (n === 0 || n === 1) {return 1;}

  return Array.from({ length: n }, (_, i) => i + 1).reduce((acc, val) => acc * val, 1);
}

function processNumbersAlt2(numbers) {
  return numbers.map(num => ({
    original: num,
    factorial: naiveFactorialAlt2(num),
  }));
}

// Benchmark suite
benny.suite(
  'processNumbers Performance',

  // Benchmark Original implementation
  benny.add('Original (numbers=[5, 10, 15])', () => {
    processNumbersOriginal([5, 10, 15]);
  }),

  // Benchmark Alternate 1
  benny.add('Alternate 1 (numbers=[5, 10, 15])', () => {
    processNumbersAlt1([5, 10, 15]);
  }),

  // Benchmark Alternate 2
  benny.add('Alternate 2 (numbers=[5, 10, 15])', () => {
    processNumbersAlt2([5, 10, 15]);
  }),

  // Output results
  benny.cycle(),
  benny.complete(),
);