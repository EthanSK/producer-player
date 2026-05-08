import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { IdealsModal, type IdealStemAnalysisSource } from './IdealsModal';

const mixSource: IdealStemAnalysisSource = {
  kind: 'mix',
  label: 'Your Mix',
  fileName: 'mix-v4.wav',
  filePath: '/Songs/mix-v4.wav',
  url: 'producer-media://mix-v4.wav',
  sizeBytes: 1000,
  modifiedAt: '2026-05-08T20:00:00.000Z',
  versionId: 'mix-version-4',
  sourceStrategy: 'direct-file',
  exists: true,
};

describe('IdealsModal', () => {
  it('renders actionable mix/reference stem workflow instead of future-disabled placeholders', () => {
    const markup = renderToStaticMarkup(
      <IdealsModal
        open
        onClose={() => undefined}
        mixSource={mixSource}
        referenceSource={null}
      />,
    );

    expect(markup).toContain('Separate/analyse yours');
    expect(markup).toContain('Separate/analyse all');
    expect(markup).toContain('No reference loaded');
    expect(markup).toContain('Current provider: Web Audio proxy stems');
    expect(markup).toContain('data-testid="ideals-mix-slot-vocals"');
    expect(markup).toContain('data-testid="ideals-reference-slot-vocals"');
    expect(markup).not.toContain('future');
    expect(markup).not.toContain('Phase 1 is UI-only');
  });
});
