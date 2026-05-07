import { describe, expect, it } from 'vitest';
import styles from './styles.css?raw';

describe('mastering overlay floating controls clearance', () => {
  it('keeps scrollable fullscreen content clear of the floating mix/reference controls', () => {
    expect(styles).toContain('--mastering-overlay-floating-controls-clearance');
    expect(styles).toMatch(
      /\.analysis-overlay-card\s*\{[\s\S]*padding:\s*20px 20px calc\(20px \+ var\(--mastering-overlay-floating-controls-clearance\)\);[\s\S]*scroll-padding-bottom:\s*var\(--mastering-overlay-floating-controls-clearance\);/
    );
    expect(styles).toMatch(
      /@media \(max-width: 1360px\), \(max-height: 860px\)[\s\S]*\.analysis-overlay-card\s*\{[\s\S]*padding:\s*14px 14px calc\(14px \+ var\(--mastering-overlay-floating-controls-clearance\)\);/
    );
  });
});
