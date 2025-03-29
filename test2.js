// A function that finds the first non-repeating character in a string
function findFirstNonRepeating(str) {
    const charCount = {};
    
    // Count occurrences of each character
    for (let char of str) {
        charCount[char] = (charCount[char] || 0) + 1;
    }
    
    // Find first character with count of 1
    for (let char of str) {
        if (charCount[char] === 1) {
            return char;
        }
    }
    
    return null;
}

// Test the function
const testString = "leetcode";
console.log(findFirstNonRepeating(testString)); 