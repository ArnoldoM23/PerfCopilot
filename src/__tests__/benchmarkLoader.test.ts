import * as fs from 'fs';
import * as vm from 'vm';
import { loadAndValidateBenchmarkModule } from '../utils/benchmarkRunner';

// Mock dependencies
jest.mock('fs');

// FIX: Define mocks inside the factory and export references
jest.mock('vm', () => {
    const mockScriptRunInContext = jest.fn();
    const mockScript = jest.fn(() => ({ runInContext: mockScriptRunInContext }));

    return {
        // Keep real vm parts if needed, but override what we use
        ...jest.requireActual('vm'), 
        // Standard exports
        Script: mockScript,
        createContext: jest.fn((init) => init || {}),
        // Add references for test access
        __esModule: true, // Indicate module mock
        __mockScript: mockScript, 
        __mockScriptRunInContext: mockScriptRunInContext,
    };
});

describe('loadAndValidateBenchmarkModule', () => {
    // Define mock FS functions for easier access
    let mockExistsSync: jest.Mock;
    let mockReadFileSync: jest.Mock;
    // Define VM mock references for easier access
    let vmMock: any;

    beforeEach(() => {
        jest.clearAllMocks();

        // Assign mock functions from the mocked fs module
        mockExistsSync = fs.existsSync as jest.Mock;
        mockReadFileSync = fs.readFileSync as jest.Mock;

        // Assign VM mock object for easier access
        vmMock = vm as any;

        // Reset vm mocks using exported references
        if (vmMock.__mockScript) vmMock.__mockScript.mockClear();
        if (vmMock.__mockScriptRunInContext) vmMock.__mockScriptRunInContext.mockClear();
        (vm.createContext as jest.Mock).mockClear(); // Use direct import here

        // Default mock behaviors
        mockExistsSync.mockReturnValue(true); // Assume file exists by default
        // Default valid module content (object literal string)
        mockReadFileSync.mockReturnValue(`{
            implementations: { 'fn': '() => {}' },
            testData: [1, 2],
            entryPointName: 'fn'
        }`);
        // Default script execution: successfully populates exports
        if (vmMock.__mockScriptRunInContext) { 
            vmMock.__mockScriptRunInContext.mockImplementation((context: any) => {
                try {
                    // Simulate evaluating the default mockReadFileSync content
                    const defaultData = {
                        implementations: { 'fn': '() => {}' },
                        testData: [1, 2],
                        entryPointName: 'fn'
                    };
                    context.module.exports = defaultData;
                } catch (e) { 
                    console.error("Error in default mockScriptRunInContext", e);
                }
            });
        }
    });

    // Test Cases 
    test('should throw error if file path is not provided', async () => {
        // @ts-expect-error - Intentionally testing invalid input
        await expect(loadAndValidateBenchmarkModule(undefined)).rejects.toThrow('No functions file path provided.');
        // @ts-expect-error - Intentionally testing invalid input
        await expect(loadAndValidateBenchmarkModule(null)).rejects.toThrow('No functions file path provided.');
        await expect(loadAndValidateBenchmarkModule('')).rejects.toThrow('No functions file path provided.');
    });

    test('should throw error if file does not exist', async () => {
        mockExistsSync.mockReturnValue(false);
        const testPath = '/fake/nonexistent.js';
        await expect(loadAndValidateBenchmarkModule(testPath)).rejects.toThrow(
            `Functions file not found: ${testPath}`
        );
        expect(mockExistsSync).toHaveBeenCalledWith(testPath);
    });

    test('should throw error if file read fails', async () => {
        const readError = new Error('Permission denied');
        mockReadFileSync.mockImplementation(() => {
            throw readError;
        });
        const testPath = '/fake/readerror.js';
        await expect(loadAndValidateBenchmarkModule(testPath)).rejects.toThrow(
            `Failed to read functions file ${testPath}: ${readError.message}`
        );
        expect(mockExistsSync).toHaveBeenCalledWith(testPath);
        expect(mockReadFileSync).toHaveBeenCalledWith(testPath, 'utf-8');
    });

    test('should throw error if file content is invalid JS syntax', async () => {
        const invalidSyntax = 'module.exports = { test: \'abc \''; // Missing closing brace
        mockReadFileSync.mockReturnValue(invalidSyntax);
        // Mock vm.Script constructor to throw a SyntaxError
        const syntaxError = new SyntaxError('Unexpected end of input');
        // FIX: Access mock via vmMock reference
        vmMock.__mockScript.mockImplementationOnce(() => {
            throw syntaxError;
        });
        
        const testPath = '/fake/invalidsyntax.js';
        await expect(loadAndValidateBenchmarkModule(testPath)).rejects.toThrow(
            `Failed to parse module content from ${testPath}: ${syntaxError.message}`
        );
        expect(mockExistsSync).toHaveBeenCalledWith(testPath);
        expect(mockReadFileSync).toHaveBeenCalledWith(testPath, 'utf-8');
        // FIX: Access mock via vmMock reference
        expect(vmMock.__mockScript).toHaveBeenCalledWith(invalidSyntax, { filename: testPath });
    });
    
    test('should throw error if script execution fails', async () => {
        const execError = new Error('Execution timeout');
        // FIX: Access mock via vmMock reference
        vmMock.__mockScriptRunInContext.mockImplementationOnce(() => {
            throw execError;
        });
        const testPath = '/fake/execerror.js';
        await expect(loadAndValidateBenchmarkModule(testPath)).rejects.toThrow(
            `Failed to parse module content from ${testPath}: ${execError.message}`
        );
        // FIX: Access mock via vmMock reference
        expect(vmMock.__mockScript).toHaveBeenCalled();
        expect(vmMock.__mockScriptRunInContext).toHaveBeenCalledTimes(1);
    });

    test('should throw error if module does not evaluate to an object', async () => {
        // FIX: Access mock via vmMock reference
        vmMock.__mockScriptRunInContext.mockImplementationOnce((context: any) => {
            context.module.exports = null; // Simulate non-object export
        });
        const testPath = '/fake/notobject.js';
        await expect(loadAndValidateBenchmarkModule(testPath)).rejects.toThrow(
            'Module content did not evaluate to an object.'
        );
        expect(vmMock.__mockScriptRunInContext).toHaveBeenCalledTimes(1);
    });

    test('should throw error if required exports are missing (implementations)', async () => {
        vmMock.__mockScriptRunInContext.mockImplementationOnce((context: any) => {
            context.module.exports = { testData: [], entryPointName: 'test' };
        });
        const testPath = '/fake/missingimpl.js';
        await expect(loadAndValidateBenchmarkModule(testPath)).rejects.toThrow(
            `Loaded module from ${testPath} is missing required exports or has incorrect types (implementations: object, testData: array, entryPointName: string).`
        );
    });

    test('should throw error if required exports are missing (testData)', async () => {
        vmMock.__mockScriptRunInContext.mockImplementationOnce((context: any) => {
            context.module.exports = { implementations: {}, entryPointName: 'test' };
        });
        const testPath = '/fake/missingdata.js';
        await expect(loadAndValidateBenchmarkModule(testPath)).rejects.toThrow(
            `Loaded module from ${testPath} is missing required exports or has incorrect types (implementations: object, testData: array, entryPointName: string).`
        );
    });
    
    test('should throw error if required exports are missing (entryPointName)', async () => {
        vmMock.__mockScriptRunInContext.mockImplementationOnce((context: any) => {
            context.module.exports = { implementations: {}, testData: [] };
        });
        const testPath = '/fake/missingentry.js';
        await expect(loadAndValidateBenchmarkModule(testPath)).rejects.toThrow(
            `Loaded module from ${testPath} is missing required exports or has incorrect types (implementations: object, testData: array, entryPointName: string).`
        );
    });

    test('should throw error if required exports have incorrect types', async () => {
        vmMock.__mockScriptRunInContext.mockImplementationOnce((context: any) => {
            context.module.exports = {
                 implementations: 'not-an-object', // Incorrect type
                 testData: [1], 
                 entryPointName: 'test' 
            };
        });
        const testPath = '/fake/wrongtype.js';
        await expect(loadAndValidateBenchmarkModule(testPath)).rejects.toThrow(
             `Loaded module from ${testPath} is missing required exports or has incorrect types (implementations: object, testData: array, entryPointName: string).`
        );
    });

    test('should throw error if implementations object is empty', async () => {
        // FIX: Access mock via vmMock reference
         vmMock.__mockScriptRunInContext.mockImplementationOnce((context: any) => {
            context.module.exports = {
                 implementations: {}, // Empty object
                 testData: [1], 
                 entryPointName: 'test' 
            };
        });
        const testPath = '/fake/emptyimpl.js';
        await expect(loadAndValidateBenchmarkModule(testPath)).rejects.toThrow(
            `No implementations found in the loaded module from ${testPath}`
        );
    });

    test('should return validated module data on successful load', async () => {
        const testPath = '/fake/valid.js';
        const expectedImplementations = { 'fn': '() => {}' };
        const expectedTestData = [1, 2];
        const expectedEntryPoint = 'fn';
        
        // Ensure mocks are set for success (using defaults is fine here)

        const result = await loadAndValidateBenchmarkModule(testPath);

        expect(result).toEqual({
            implementations: expectedImplementations,
            testData: expectedTestData,
            entryPointName: expectedEntryPoint,
        });
        expect(mockExistsSync).toHaveBeenCalledWith(testPath);
        expect(mockReadFileSync).toHaveBeenCalledWith(testPath, 'utf-8');
        // FIX: Access mock via vmMock reference
        expect(vmMock.__mockScript).toHaveBeenCalledTimes(1);
        expect(vmMock.__mockScript).toHaveBeenCalledWith(expect.stringContaining('implementations'), { filename: testPath });
        expect(vmMock.__mockScriptRunInContext).toHaveBeenCalledTimes(1);
    });

}); 