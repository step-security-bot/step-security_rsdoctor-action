import { describe, expect, it } from 'rstack/test';
import { isIntelligenceEnabled } from '../src/settings';

describe('isIntelligenceEnabled', () => {
  it('is enabled by default', () => {
    expect(isIntelligenceEnabled('')).toBe(true);
    expect(isIntelligenceEnabled('true')).toBe(true);
    expect(isIntelligenceEnabled(' TRUE ')).toBe(true);
  });

  it('is disabled only when explicitly set to false', () => {
    expect(isIntelligenceEnabled('false')).toBe(false);
    expect(isIntelligenceEnabled(' FALSE ')).toBe(false);
  });
});
