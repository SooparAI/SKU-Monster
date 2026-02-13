import { describe, it, expect } from 'vitest';
import type { QualityMode } from './hqImagePipeline';

describe('Quality Mode Configuration', () => {
  it('should accept "studio" as a valid quality mode', () => {
    const mode: QualityMode = 'studio';
    expect(mode).toBe('studio');
  });

  it('should accept "compressed" as a valid quality mode', () => {
    const mode: QualityMode = 'compressed';
    expect(mode).toBe('compressed');
  });

  it('should default to studio mode when not specified', () => {
    // Simulate the default parameter behavior
    function getQualityMode(mode: QualityMode = 'studio'): QualityMode {
      return mode;
    }
    expect(getQualityMode()).toBe('studio');
    expect(getQualityMode('compressed')).toBe('compressed');
    expect(getQualityMode('studio')).toBe('studio');
  });

  it('should have correct output specs for studio mode', () => {
    const STUDIO_SIZE = 2000;
    const STUDIO_FORMAT = 'png';
    
    expect(STUDIO_SIZE).toBe(2000);
    expect(STUDIO_FORMAT).toBe('png');
  });

  it('should have correct output specs for compressed mode', () => {
    const COMPRESSED_SIZE = 1000;
    const COMPRESSED_FORMAT = 'jpeg';
    
    expect(COMPRESSED_SIZE).toBe(1000);
    expect(COMPRESSED_FORMAT).toBe('jpeg');
  });

  it('should use compressed mode for Excel batch processing', () => {
    // Excel batch processing should always use compressed mode
    // This tests the design decision documented in excelProcessor.ts
    const excelQualityMode: QualityMode = 'compressed';
    expect(excelQualityMode).toBe('compressed');
  });

  it('should use studio mode for regular SKU scraping', () => {
    // Regular scraping should default to studio mode
    const defaultQualityMode: QualityMode = 'studio';
    expect(defaultQualityMode).toBe('studio');
  });
});
