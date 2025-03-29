// Sample function to analyze - a function that finds the sum of all numbers in an array
function sumArray(arr) {
    let sum = 0;
    for (let i = 0; i < arr.length; i++) {
        sum += arr[i];
    }
    return sum;
}

// Test the function
const numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
console.log(sumArray(numbers)); 