// Sample function to test performance analysis
function sumArray(arr) {
    let sum = 0;
    for (let i = 0; i < arr.length; i++) {
        sum += arr[i];
    }
    return sum;
}

// Test data
const testArray = Array.from({length: 1000}, (_, i) => i + 1);
console.log('Sum:', sumArray(testArray)); 