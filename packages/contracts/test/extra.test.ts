import { describe, expect, it } from 'vitest';
import { isValidPriceExtra } from '../src/index.ts';
import { EXTRA_CASES } from './extra-cases.ts';

describe('kontrak extra (X-10, D-66)', () => {
  it.each(EXTRA_CASES)('$label', ({ value, valid }) => {
    expect(isValidPriceExtra(value)).toBe(valid);
  });
});
