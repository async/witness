import { describe, expect, test } from 'vitest';
import { fileURLToPath, pathToFileURL } from '../src/file-url.ts';

describe('fileURLToPath', () => {
	test('converts a posix file URL to a path', () => {
		expect(fileURLToPath('file:///tmp/project/example.box.ts')).toBe(
			'/tmp/project/example.box.ts',
		);
	});

	test('accepts URL instances', () => {
		expect(fileURLToPath(new URL('file:///tmp/project'))).toBe('/tmp/project');
	});

	test('decodes percent-encoded characters', () => {
		expect(fileURLToPath('file:///tmp/with%20space')).toBe('/tmp/with space');
	});

	test('strips the URL-only leading slash from Windows drive paths', () => {
		expect(fileURLToPath('file:///C:/Users/dev/project')).toBe('C:/Users/dev/project');
	});

	test('keeps UNC hosts as a double-slash prefix', () => {
		expect(fileURLToPath('file://fileserver/share/project')).toBe('//fileserver/share/project');
	});

	test('rejects non-file URLs', () => {
		expect(() => fileURLToPath('https://example.com/box.ts')).toThrow();
	});
});

describe('pathToFileURL', () => {
	test('round-trips a posix path', () => {
		expect(fileURLToPath(pathToFileURL('/tmp/project/example.box.ts'))).toBe(
			'/tmp/project/example.box.ts',
		);
	});

	test('percent-encodes characters a URL parser would misread', () => {
		expect(pathToFileURL('/tmp/has space/100%/entry?.ts')).toBe(
			'file:///tmp/has%20space/100%25/entry%3F.ts',
		);
	});

	test('builds a drive-letter URL for Windows paths', () => {
		expect(pathToFileURL('C:/Users/dev/project')).toBe('file:///C:/Users/dev/project');
	});

	test('builds a host URL for UNC paths', () => {
		expect(pathToFileURL('//fileserver/share/project')).toBe('file://fileserver/share/project');
	});
});
