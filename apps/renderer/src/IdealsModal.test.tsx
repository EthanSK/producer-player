import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { IdealsModal, type IdealStemAnalysisSource } from './IdealsModal';

// Vitest runs this suite in Node; source/CSS contract checks read files directly.
// @ts-ignore -- renderer tsconfig intentionally excludes Node ambient types.
const { readFileSync } = await import('node:fs');
const idealsSource = readFileSync(new URL('./IdealsModal.tsx', import.meta.url), 'utf8') as string;
const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8') as string;

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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const blockedCopyTerms = [
  ['Source', ' place', 'hold', 'er'].join(''),
  ['Citation', ' TO', 'DO'].join(''),
  ['source', 'Place', 'hold', 'er'].join(''),
  ['TO', 'DO'].join(''),
  ['FIX', 'ME'].join(''),
  ['not', ' implemented'].join(''),
  ['coming', ' soon'].join(''),
  ['UI', '-only'].join(''),
  ['fut', 'ure', '-disabled'].join(''),
];
const blockedCopyPattern = new RegExp(blockedCopyTerms.map(escapeRegExp).join('|'), 'i');

describe('IdealsModal', () => {
  it('renders actionable mix/reference stem workflow with honest provider disclosure', () => {
    const markup = renderToStaticMarkup(
      <IdealsModal
        open
        onClose={() => undefined}
        mixSource={mixSource}
        referenceSource={null}
      />,
    );

    expect(markup).toContain('Stem Separate Yours');
    expect(markup).toContain('Stem Separate Reference');
    expect(markup).toContain('Stem Separate Both');
    expect(markup).toContain('No reference loaded');
    expect(markup).toContain('Current provider: Web Audio proxy stems');
    expect(markup).toContain('not ML-grade source separation');
    expect(markup).toContain('not clean or lossless stem exports');
    expect(markup).toContain('A/B Your Stem vs Mix');
    expect(markup).toContain('Stem Proxy');
    expect(markup).toContain('Full Mix');
    expect(markup).toContain('data-testid="ideals-mix-slot-vocals"');
    expect(markup).toContain('data-testid="ideals-reference-slot-vocals"');
    expect(markup).toContain('data-testid="ideals-stem-ab-vocals"');
    expect(markup).not.toMatch(blockedCopyPattern);
  });

  it('can render a per-stem focused dialog above the main Ideals dialog', () => {
    const markup = renderToStaticMarkup(
      <IdealsModal
        open
        onClose={() => undefined}
        mixSource={mixSource}
        referenceSource={null}
        initialFullscreenStemId="vocals"
      />,
    );

    expect(markup).toContain('data-testid="ideals-modal"');
    expect(markup).toContain('data-testid="ideals-stem-fullscreen"');
    expect(markup).toContain('data-testid="ideals-stem-fullscreen-close"');
    expect(markup).toContain('Focused stem view');
    expect(markup).toContain('Production note:');
    expect(markup).toContain('data-testid="ideals-stem-ab-vocals"');
    expect(markup).not.toMatch(blockedCopyPattern);
  });

  it('keeps the per-stem focused dialog fixed above the Ideals card with a strong backdrop', () => {
    expect(styles).toContain('--z-ideals-modal: 1110;');
    expect(styles).toContain('--z-ideals-stem-fullscreen: 1120;');
    expect(styles).toMatch(
      /\.ideals-overlay\s*\{[\s\S]*z-index:\s*var\(--z-ideals-modal\);[\s\S]*background:\s*rgba\(7, 11, 18, 0\.88\);[\s\S]*overscroll-behavior:\s*contain;/,
    );
    expect(styles).toMatch(
      /\.ideals-stem-fullscreen-overlay\s*\{[\s\S]*position:\s*fixed;[\s\S]*z-index:\s*var\(--z-ideals-stem-fullscreen\);[\s\S]*background:\s*rgba\(4, 8, 14, 0\.92\);[\s\S]*overscroll-behavior:\s*contain;/,
    );
    expect(styles).toMatch(/\.ideals-stem-grid\s*\{[\s\S]*grid-template-columns:\s*1fr;/);
  });

  it('makes full-view stem graphs interactive and adds a stem-vs-mix A/B control', () => {
    expect(idealsSource).toContain('onPointerMove={updateActiveFrequencyFromPointer}');
    expect(idealsSource).toContain('data-testid={`ideals-curve-readout-${guide.id}`}');
    expect(idealsSource).toContain('findNearestCurvePoint');
    expect(idealsSource).toContain('function StemAuditionCompare');
    expect(idealsSource).toContain('switchAuditionTarget');
    expect(idealsSource).toContain('syncAudioTime');
  });

  it('handles Escape and backdrop clicks at the focused-dialog layer before closing Ideals', () => {
    expect(idealsSource).toMatch(
      /if \(selectedFullscreenStemId\) \{[\s\S]*setSelectedFullscreenStemId\(null\);[\s\S]*return;[\s\S]*\}\n\s*onClose\(\);/,
    );
    expect(idealsSource).toMatch(
      /className="ideals-stem-fullscreen-overlay"[\s\S]*event\.stopPropagation\(\);[\s\S]*event\.target === event\.currentTarget[\s\S]*setSelectedFullscreenStemId\(null\);/,
    );
    expect(idealsSource).toMatch(
      /onKeyDown=\{\(event\) => \{[\s\S]*event\.key === 'Escape'[\s\S]*event\.stopPropagation\(\);[\s\S]*setSelectedFullscreenStemId\(null\);/,
    );
  });
});
