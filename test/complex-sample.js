// A more complex function to test performance analysis
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

// Test data
const testString = "leetcode";
console.log('First non-repeating character:', findFirstNonRepeating(testString)); 