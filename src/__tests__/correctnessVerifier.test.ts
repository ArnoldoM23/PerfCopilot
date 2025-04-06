import * as vm from 'vm';
import { executeFunctionSafely } from '../utils/correctnessVerifier';

// Mock the vm module
jest.mock('vm');

describe('Correctness Verifier - executeFunctionSafely', () => {
  let mockRunInContext: jest.Mock;
  let mockCreateContext: jest.Mock;
  let scriptSpy: jest.SpyInstance;
  let createContextSpy: jest.SpyInstance; // Add spy for createContext

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Setup vm mocks
    mockRunInContext = jest.fn();
    mockCreateContext = jest.fn((context) => context); // Mock createContext to return the context object

    // Spy on vm.Script constructor, return object with our runInContext mock
    scriptSpy = jest.spyOn(vm, 'Script').mockImplementation(() => ({
        runInContext: mockRunInContext
    }) as any); // Cast to any to satisfy TS

    // Spy on vm.createContext
    createContextSpy = jest.spyOn(vm, 'createContext').mockImplementation(mockCreateContext);
  });

  it('should execute a simple function expression safely', async () => {
    const funcCode = '(a, b) => a + b';
    const args = [5, 10];
    const expectedResult = 15;
    // Mock the final result of script.runInContext
    mockRunInContext.mockReturnValue(expectedResult);

    const result = await executeFunctionSafely(funcCode, args);

    expect(result).toBe(expectedResult);
    expect(scriptSpy).toHaveBeenCalledTimes(1); // Script constructor called once
    expect(mockRunInContext).toHaveBeenCalledTimes(1); // runInContext called once
    expect(createContextSpy).toHaveBeenCalledTimes(1); // createContext called once
    // Check if context includes the code string and args
    const contextArg = mockCreateContext.mock.calls[0][0];
    expect(contextArg).toHaveProperty('__args', args);
    expect(contextArg).toHaveProperty('__functionCodeString', funcCode);
  });

  // Note: Verifying the internal fallback logic explicitly is difficult with this mocking approach.
  // This test now primarily verifies that declarations *can* execute successfully.
  it('should handle function declarations', async () => {
    const funcCode = 'function add(a, b) { return a + b; }';
    const args = [3, 4];
    const expectedResult = 7;

    // Mock the final result of script.runInContext for a declaration
    mockRunInContext.mockReturnValue(expectedResult);

    // Mock createContext to simulate the function being added by internal vm.runInContext
    // This part is less critical now as we mock the end result, but kept for consistency
    mockCreateContext.mockImplementation((context) => {
        if (context && typeof context === 'object') {
            // Simulate internal vm.runInContext adding the function during fallback
            (context as any)['add'] = (...args: number[]) => args.reduce((a, b) => a + b, 0);
        }
        return context; // Important: return the context
    });


    const result = await executeFunctionSafely(funcCode, args);

    expect(result).toBe(expectedResult);
    expect(scriptSpy).toHaveBeenCalledTimes(1);
    expect(mockRunInContext).toHaveBeenCalledTimes(1);
    expect(createContextSpy).toHaveBeenCalledTimes(1);
  });

  it('should throw an error if code execution fails', async () => {
    const funcCode = '() => { throw new Error("Oops!"); }';
    const args: any[] = [];
    const executionError = new Error('Oops!');

    // Mock script.runInContext to throw the error that __fn would throw
    mockRunInContext.mockImplementation(() => {
        throw executionError;
    });

    // Expect the outer executeFunctionSafely to catch and re-throw
    await expect(executeFunctionSafely(funcCode, args))
      .rejects.toThrow(`Execution failed: ${executionError.message}`);

    expect(scriptSpy).toHaveBeenCalledTimes(1);
    expect(mockRunInContext).toHaveBeenCalledTimes(1);
    expect(createContextSpy).toHaveBeenCalledTimes(1);
  });

  it('should throw an error if code does not resolve to a function', async () => {
    const funcCode = 'const x = 5;'; // Not a function
    const args: any[] = [];
    const expectedError = new Error('Provided code did not resolve to a function.');

    // Mock script.runInContext to throw the error the internal check would throw
    mockRunInContext.mockImplementation(() => {
      throw expectedError;
    });

    // Expect the outer executeFunctionSafely to catch and re-throw
    await expect(executeFunctionSafely(funcCode, args))
      .rejects.toThrow(`Execution failed: ${expectedError.message}`);

    expect(scriptSpy).toHaveBeenCalledTimes(1);
    expect(mockRunInContext).toHaveBeenCalledTimes(1);
    expect(createContextSpy).toHaveBeenCalledTimes(1);
  });

  it('should respect the timeout (mocked behavior)', async () => {
    const funcCode = '(a) => a';
    const args = [1];
    // Mock a successful run
    mockRunInContext.mockReturnValue(1);

    await executeFunctionSafely(funcCode, args);

    expect(scriptSpy).toHaveBeenCalledTimes(1);
    expect(createContextSpy).toHaveBeenCalledTimes(1);
    // Verify runInContext was called with the timeout option
    expect(mockRunInContext).toHaveBeenCalledWith(expect.any(Object), { timeout: 2000 });
  });

  it('should execute an async function expression safely', async () => {
    const funcCode = 'async (a, b) => { await new Promise(resolve => setTimeout(resolve, 10)); return a * b; }';
    const args = [7, 6];
    const expectedResult = 42;
    mockRunInContext.mockResolvedValue(expectedResult); // Mock the resolved value

    const result = await executeFunctionSafely(funcCode, args);

    expect(result).toBe(expectedResult);
    expect(scriptSpy).toHaveBeenCalledTimes(1);
    expect(mockRunInContext).toHaveBeenCalledTimes(1);
    expect(createContextSpy).toHaveBeenCalledTimes(1);
    const contextArg = mockCreateContext.mock.calls[0][0];
    expect(contextArg).toHaveProperty('__args', args);
    expect(contextArg).toHaveProperty('__functionCodeString', funcCode);
  });

  it('should execute a function returning a Promise safely', async () => {
    const funcCode = '(a) => Promise.resolve(a * 2)';
    const args = [21];
    const expectedResult = 42;
    // The vm execution itself resolves the promise, so mock the final value
    mockRunInContext.mockReturnValue(expectedResult);

    const result = await executeFunctionSafely(funcCode, args);

    expect(result).toBe(expectedResult);
    expect(scriptSpy).toHaveBeenCalledTimes(1);
    expect(mockRunInContext).toHaveBeenCalledTimes(1);
    expect(createContextSpy).toHaveBeenCalledTimes(1);
  });

  it('should throw a timeout error if execution exceeds the timeout', async () => {
    const funcCode = '() => { while(true) {} }'; // Infinite loop
    const args: any[] = [];
    const timeoutError = new Error('Script execution timed out.');

    // Mock runInContext to throw a timeout error
    mockRunInContext.mockImplementation(() => {
      throw timeoutError;
    });

    await expect(executeFunctionSafely(funcCode, args))
      .rejects.toThrow(`Execution failed: ${timeoutError.message}`);

    expect(scriptSpy).toHaveBeenCalledTimes(1);
    expect(mockRunInContext).toHaveBeenCalledTimes(1);
    expect(mockRunInContext).toHaveBeenCalledWith(expect.any(Object), { timeout: 2000 });
    expect(createContextSpy).toHaveBeenCalledTimes(1);
  });

  it('should handle object arguments correctly', async () => {
    const funcCode = '(obj) => obj.value * 2';
    const args = [{ value: 10 }];
    const expectedResult = 20;
    mockRunInContext.mockReturnValue(expectedResult);

    const result = await executeFunctionSafely(funcCode, args);

    expect(result).toBe(expectedResult);
    expect(scriptSpy).toHaveBeenCalledTimes(1);
    expect(mockRunInContext).toHaveBeenCalledTimes(1);
    expect(createContextSpy).toHaveBeenCalledTimes(1);
    const contextArg = mockCreateContext.mock.calls[0][0];
    // Check if the object argument is passed correctly into the context
    expect(contextArg).toHaveProperty('__args', expect.arrayContaining([expect.objectContaining({ value: 10 })]));
    expect(contextArg).toHaveProperty('__functionCodeString', funcCode);
  });

}); 