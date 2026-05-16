import { describe, expect, it } from 'vitest';

// Vitest's CSS transform stubs stylesheet imports to an empty string in CI,
// so this contract test reads the source files directly.
// @ts-ignore -- Vitest runs in Node; renderer tsconfig intentionally excludes Node ambient types.
const { readFileSync } = await import('node:fs');
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const styles = stripComments(
  readFileSync(new URL('./styles.css', import.meta.url), 'utf8') as string
);
const agentChat = stripComments(
  readFileSync(new URL('./agent-chat.css', import.meta.url), 'utf8') as string
);

/**
 * Regression pin (v3.212): Floating triggers along the bottom edge must NOT
 * collide on wide viewports.
 *
 * Layout (post-v3.192):
 *   inspector toggle:    right:16px   (narrow-viewport only)
 *   agent chat trigger:  right:68px
 *   quick song switcher: right:120px
 *   version switcher:    right:172px
 *   platform preview:    right:224px
 *
 * v3.45's wide-viewport override that shifted `version-switcher`
 * 172→120 and `floating-platform-preview-indicator` 224→172 was
 * removed in v3.212 — under the new (v3.192) slot order, the
 * inspector occupies the OUTERMOST slot (right:16), so hiding it on
 * wide viewports leaves a gap at the viewport edge, NOT in the middle.
 * The remaining triggers' 52px rhythm holds without any shift.
 *
 * If a future change re-introduces a wide-viewport `right: 120px` on
 * `.version-switcher-trigger` or `.version-switcher-panel`, the quick
 * song switcher (also at `right: 120px`) will be visually covered by
 * the version switcher (same z-index, version rendered later in DOM).
 */
describe('floating trigger slots — regression pin v3.212', () => {
  it('quick-switcher-toggle is pinned at right:120px (narrow + wide)', () => {
    expect(styles).toMatch(/\.quick-switcher-toggle\s*\{[^}]*right:\s*120px/);
  });

  it('version-switcher-trigger is pinned at right:172px (narrow + wide)', () => {
    expect(styles).toMatch(/\.version-switcher-trigger\s*\{[^}]*right:\s*172px/);
  });

  it('floating-platform-preview-indicator is pinned at right:224px (narrow + wide)', () => {
    expect(styles).toMatch(/\.floating-platform-preview-indicator\s*\{[^}]*right:\s*224px/);
  });

  it('no wide-viewport @media block contains a .version-switcher-trigger right:120px rule (collides with song switcher)', () => {
    // v3.45 had: @media (min-width: 1281px) { .version-switcher-trigger, .version-switcher-panel { right: 120px; } }
    // Post-v3.192 that collides with the quick-switcher-toggle (same slot). Strip & block its return.
    const widePxRegex = /@media[^{]*min-width:\s*1281px[^{]*\{((?:[^{}]|\{[^{}]*\})*)\}/g;
    for (const match of styles.matchAll(widePxRegex)) {
      const body = match[1];
      expect(body).not.toMatch(/\.version-switcher-trigger[\s\S]*?right:\s*120px/);
      expect(body).not.toMatch(/\.version-switcher-panel[\s\S]*?right:\s*120px/);
    }
  });

  it('no wide-viewport @media block contains a .floating-platform-preview-indicator right:172px rule (collides with version switcher)', () => {
    const widePxRegex = /@media[^{]*min-width:\s*1281px[^{]*\{((?:[^{}]|\{[^{}]*\})*)\}/g;
    for (const match of styles.matchAll(widePxRegex)) {
      const body = match[1];
      expect(body).not.toMatch(/\.floating-platform-preview-indicator[\s\S]*?right:\s*172px/);
    }
  });

  it('inspector-toggle-button sits at right:16px (outermost slot post-v3.192)', () => {
    expect(styles).toMatch(/\.inspector-toggle-button\s*\{[^}]*right:\s*16px/);
  });
});

/**
 * Regression pin (v3.212): The agent chat panel default anchor must sit
 * 16px from the viewport right edge — NOT 68px (where v3.192 erroneously
 * placed it). At 68px the 380px-wide panel left a visible empty 68px gap
 * on its right side. The toggle (44px wide) correctly stays at right:68px
 * (middle slot in the v3.192 reshuffle), but the panel is much wider and
 * must extend flush to the viewport edge so no space is wasted.
 */
describe('agent chat panel default anchor — regression pin v3.212', () => {
  it('default .agent-chat-panel anchor is right:16px (flush to viewport edge)', () => {
    expect(agentChat).toMatch(/\.agent-chat-panel\s*\{[^}]*right:\s*16px/);
  });

  it('agent-toggle-button stays at right:68px (middle slot per v3.192)', () => {
    expect(agentChat).toMatch(/\.agent-toggle-button\s*\{[^}]*right:\s*68px/);
  });

  it('.agent-chat-panel default does NOT regress to right:68px (creates 68px right-side gap)', () => {
    // Match the .agent-chat-panel base rule (not the --positioned variant or :hover etc).
    // `agentChat` already has comments stripped at top of file.
    const baseRule = agentChat.match(/\.agent-chat-panel\s*\{[^}]*\}/);
    expect(baseRule, 'expected .agent-chat-panel base rule').not.toBeNull();
    expect(baseRule![0]).not.toMatch(/right:\s*68px/);
  });
});
