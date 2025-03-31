// Sample function to test performance analysis
function sumArray(arr) {
    let sum = 0;
    for (let i = 0; i < arr.length; i++) {
        sum += arr[i];
    }
    return sum;
}

// Alternative implementations for comparison
// Using Array.reduce
function sumArrayReduce(arr) {
    return arr.reduce((sum, value) => sum + value, 0);
}

// Using for...of loop
function sumArrayForOf(arr) {
    let sum = 0;
    for (const value of arr) {
        sum += value;
    }
    return sum;
}

// Test with different array sizes
function runTests() {
    console.log('Running tests for sumArray implementations...\n');
    
    // Test case 1: Small array
    const smallArray = [1, 2, 3, 4, 5];
    console.log('Test case 1: Small array [1, 2, 3, 4, 5]');
    console.log('Original implementation:', sumArray(smallArray));
    console.log('Reduce implementation:', sumArrayReduce(smallArray));
    console.log('For...of implementation:', sumArrayForOf(smallArray));
    console.log('');
    
    // Test case 2: Medium array
    const mediumArray = Array.from({length: 1000}, (_, i) => i + 1);
    console.log('Test case 2: Medium array (1000 elements)');
    console.log('Original implementation:', sumArray(mediumArray));
    console.log('Reduce implementation:', sumArrayReduce(mediumArray));
    console.log('For...of implementation:', sumArrayForOf(mediumArray));
    console.log('');
    
    // Test case 3: Edge cases
    console.log('Test case 3: Edge cases');
    console.log('Empty array:');
    console.log('Original implementation:', sumArray([]));
    console.log('Reduce implementation:', sumArrayReduce([]));
    console.log('For...of implementation:', sumArrayForOf([]));
    
    console.log('\nArray with negative numbers:');
    const negativeArray = [-5, -3, -1, 2, 4];
    console.log('Original implementation:', sumArray(negativeArray));
    console.log('Reduce implementation:', sumArrayReduce(negativeArray));
    console.log('For...of implementation:', sumArrayForOf(negativeArray));
}

// Simple benchmark function
function simpleBenchmark() {
    console.log('\n--- Simple Benchmark ---');
    const largeArray = Array.from({length: 10000000}, () => Math.random());
    
    console.log('Benchmarking with array of 10,000,000 random numbers');
    
    console.time('Original for loop');
    sumArray(largeArray);
    console.timeEnd('Original for loop');
    
    console.time('Array.reduce');
    sumArrayReduce(largeArray);
    console.timeEnd('Array.reduce');
    
    console.time('for...of loop');
    sumArrayForOf(largeArray);
    console.timeEnd('for...of loop');
}

// Run the tests
runTests();

// Run simple benchmark
// Comment out if you don't want to run the benchmark
simpleBenchmark(); 