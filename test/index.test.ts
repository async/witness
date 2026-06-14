import { describe, expect, test } from 'vitest';
import { witness } from '../src/index.ts';

describe('witness', () => {
	test('creates a Vite plugin shell', () => {
		expect(witness()).toEqual({
			name: 'async-witness',
		});
	});
});
