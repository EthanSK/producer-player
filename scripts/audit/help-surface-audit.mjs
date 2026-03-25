#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import ts from 'typescript';

const repoRoot = process.cwd();
const appFilePath = path.join(repoRoot, 'apps/renderer/src/App.tsx');
const linksFilePath = path.join(repoRoot, 'apps/renderer/src/helpTooltipLinks.ts');
const siteFilePath = path.join(repoRoot, 'site/index.html');
const outDir = path.join(repoRoot, 'artifacts/help-audit');

const TOPIC_KEYWORDS = {
  LUFS_LINKS: ['lufs', 'loudness'],
  TRUE_PEAK_LINKS: ['true peak', 'inter-sample', 'dBTP', 'limiter'],
  LRA_LINKS: ['lra', 'loudness range', 'dynamic range'],
  STEREO_CORRELATION_LINKS: ['correlation', 'phase', 'mono', 'stereo'],
  SPECTRUM_ANALYZER_LINKS: ['spectrum', 'analyser', 'analyzer', 'frequency', 'span'],
  LEVEL_METER_LINKS: ['meter', 'lufs', 'rms', 'peak', 'level'],
  WAVEFORM_LINKS: ['waveform', 'clipping', 'clip', 'transient'],
  VECTORSCOPE_LINKS: ['vectorscope', 'stereo', 'phase', 'imaging'],
  PLATFORM_NORMALIZATION_LINKS: ['normalization', 'spotify', 'apple', 'youtube', 'lufs'],
  REFERENCE_TRACK_LINKS: ['reference', 'a/b', 'ab'],
  MID_SIDE_LINKS: ['mid/side', 'mid side', 'stereo width'],
  K_METERING_LINKS: ['k-system', 'k system', 'k-meter', 'k meter', 'bob katz'],
  CREST_FACTOR_LINKS: ['crest factor', 'peak', 'loudness'],
  DC_OFFSET_LINKS: ['dc offset'],
  DYNAMIC_RANGE_LINKS: ['dynamic range', 'loudness war'],
  TONAL_BALANCE_LINKS: ['tonal balance', 'frequency balance'],
  LOUDNESS_HISTORY_LINKS: ['loudness', 'lufs'],
  CLIP_COUNT_LINKS: ['clipping', 'clip'],
  MEAN_VOLUME_LINKS: ['rms', 'mean', 'volume', 'peak', 'lufs'],
  MASTERING_CHECKLIST_LINKS: ['checklist', 'ready for mastering', 'mix finished'],
  CREST_FACTOR_HISTORY_LINKS: ['crest factor', 'loudness', 'peak'],
  MID_SIDE_SPECTRUM_LINKS: ['mid/side', 'mid side', 'spectrum', 'span'],
  LOUDNESS_HISTOGRAM_LINKS: ['loudness', 'lufs', 'histogram', 'distribution'],
  SPECTROGRAM_LINKS: ['spectrogram'],
};

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'for', 'to', 'in', 'of', 'on', 'with', 'how',
  'what', 'is', 'you', 'your', 'vs', 'this', 'that', 'do', 'it', 'by', 'using',
  'music', 'audio', 'mixing', 'mastering', 'tutorial', 'explained', 'tips'
]);

function normalizeText(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function tokenize(value) {
  return new Set(
    normalizeText(value)
      .split(' ')
      .filter((token) => token.length > 2 && !STOP_WORDS.has(token))
  );
}

function jaccardScore(a, b) {
  const left = tokenize(a);
  const right = tokenize(b);
  if (left.size === 0 && right.size === 0) {
    return 1;
  }
  const union = new Set([...left, ...right]);
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) {
      intersection += 1;
    }
  }
  return intersection / Math.max(1, union.size);
}

function extractYoutubeVideoId(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'youtu.be') {
      return parsed.pathname.slice(1) || null;
    }
    if (parsed.hostname.includes('youtube.com')) {
      if (parsed.pathname.startsWith('/shorts/')) {
        const maybeId = parsed.pathname.split('/')[2];
        return maybeId || null;
      }
      return parsed.searchParams.get('v');
    }
    return null;
  } catch {
    return null;
  }
}

function parseHelpLinkSets(sourceText) {
  const sourceFile = ts.createSourceFile(
    linksFilePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );

  const result = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) {
      continue;
    }
    const isExported = statement.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword
    );
    if (!isExported) {
      continue;
    }

    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) {
        continue;
      }
      if (!declaration.initializer || !ts.isArrayLiteralExpression(declaration.initializer)) {
        continue;
      }

      const setName = declaration.name.text;
      const entries = [];
      for (const element of declaration.initializer.elements) {
        if (!ts.isObjectLiteralExpression(element)) {
          continue;
        }
        let label = null;
        let url = null;
        for (const prop of element.properties) {
          if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) {
            continue;
          }
          if (!ts.isStringLiteralLike(prop.initializer)) {
            continue;
          }
          if (prop.name.text === 'label') {
            label = prop.initializer.text;
          } else if (prop.name.text === 'url') {
            url = prop.initializer.text;
          }
        }
        if (label && url) {
          entries.push({ label, url, videoId: extractYoutubeVideoId(url) });
        }
      }
      result.push({ setName, entries });
    }
  }

  return result;
}

function parseAppTooltips(sourceText) {
  const sourceFile = ts.createSourceFile(
    appFilePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const lines = sourceText.split('\n');
  const items = [];

  function visit(node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(sourceFile) === 'HelpTooltip') {
      let linksSet = null;
      let textKind = 'unknown';

      for (const attr of node.attributes.properties) {
        if (!ts.isJsxAttribute(attr) || !attr.name) {
          continue;
        }
        const attrName = attr.name.getText(sourceFile);
        if (attrName === 'links') {
          const init = attr.initializer;
          if (init && ts.isJsxExpression(init) && init.expression && ts.isIdentifier(init.expression)) {
            linksSet = init.expression.text;
          }
        }
        if (attrName === 'text') {
          const init = attr.initializer;
          if (init && ts.isStringLiteral(init)) {
            textKind = 'string';
          } else if (init && ts.isJsxExpression(init)) {
            textKind = 'expression';
          }
        }
      }

      const lineZeroBased = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line;
      const line = lineZeroBased + 1;
      const codeLine = lines[lineZeroBased]?.trim() ?? '';

      items.push({
        line,
        linksSet,
        textKind,
        codeLine,
      });
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return items;
}

function parseSiteHelpSurfaces(siteHtml) {
  const videoSourceMatches = [...siteHtml.matchAll(/<source\s+src="([^"]+)"\s+type="video\/mp4"\s*\/?>(?:\s*)/gi)];
  const helpIconClaims = [...siteHtml.matchAll(/help icon/gi)];
  return {
    embeddedVideos: videoSourceMatches.map((match) => match[1]),
    helpIconCopyMentions: helpIconClaims.length,
  };
}

async function mapWithConcurrency(items, worker, concurrency = 8) {
  const queue = [...items];
  const out = new Array(items.length);
  let cursor = 0;

  async function runWorker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await worker(items[index], index);
    }
  }

  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, () => runWorker());
  await Promise.all(workers);
  return out;
}

async function fetchYoutubeOEmbed(url) {
  const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
  try {
    const response = await fetch(endpoint, { redirect: 'follow' });
    if (!response.ok) {
      return { ok: false, status: response.status };
    }
    const payload = await response.json();
    return {
      ok: true,
      title: payload.title ?? null,
      author: payload.author_name ?? null,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function evaluateTopicRelevance(setName, label, title = '') {
  const keywords = TOPIC_KEYWORDS[setName] ?? [];
  if (keywords.length === 0) {
    return {
      matched: true,
      matchedKeywords: [],
      checkedKeywords: [],
    };
  }

  const haystack = `${label} ${title}`.toLowerCase();
  const matchedKeywords = keywords.filter((keyword) => haystack.includes(keyword.toLowerCase()));
  return {
    matched: matchedKeywords.length > 0,
    matchedKeywords,
    checkedKeywords: keywords,
  };
}

function summarizeIssues(audit) {
  const issues = [];
  for (const set of audit.linkSets) {
    for (const link of set.entries) {
      if (!link.metadata.ok) {
        issues.push({
          severity: 'error',
          setName: set.setName,
          url: link.url,
          reason: `oEmbed fetch failed (${link.metadata.status ?? link.metadata.error ?? 'unknown'})`,
        });
      }
      if (!link.topicRelevance.matched) {
        issues.push({
          severity: 'warn',
          setName: set.setName,
          url: link.url,
          reason: 'Label/title do not contain expected topic keywords',
        });
      }
      if (link.labelTitleJaccard < 0.12) {
        issues.push({
          severity: 'warn',
          setName: set.setName,
          url: link.url,
          reason: `Label vs fetched title mismatch score too low (${link.labelTitleJaccard.toFixed(2)})`,
        });
      }
    }
  }
  return issues;
}

function toMarkdownReport(audit) {
  const lines = [];
  lines.push('# Help Surface & Tutorial Link Audit');
  lines.push('');
  lines.push(`Generated: ${audit.generatedAt}`);
  lines.push('');
  lines.push('## Coverage');
  lines.push(`- App HelpTooltip instances: **${audit.app.totalHelpTooltips}**`);
  lines.push(`- App HelpTooltip instances with tutorial links: **${audit.app.helpTooltipsWithLinks}**`);
  lines.push(`- App HelpTooltip instances without links: **${audit.app.helpTooltipsWithoutLinks}**`);
  lines.push(`- Distinct tutorial link sets: **${audit.linkSets.length}**`);
  lines.push(`- Distinct tutorial URLs audited: **${audit.totals.distinctTutorialUrls}**`);
  lines.push(`- Total tutorial link placements (set entries): **${audit.totals.tutorialLinkPlacements}**`);
  lines.push(`- Website embedded videos: **${audit.site.embeddedVideos.length}**`);
  lines.push('');

  lines.push('## Link sets by usage in App.tsx');
  for (const [setName, usage] of Object.entries(audit.app.linkSetUsage).sort((a, b) => b[1] - a[1])) {
    lines.push(`- ${setName}: ${usage} tooltip instance(s)`);
  }
  lines.push('');

  lines.push('## Issues flagged');
  if (audit.issues.length === 0) {
    lines.push('- None');
  } else {
    for (const issue of audit.issues) {
      lines.push(`- [${issue.severity}] ${issue.setName}: ${issue.reason} (${issue.url})`);
    }
  }

  return `${lines.join('\n')}\n`;
}

async function main() {
  const [appSource, linksSource, siteSource] = await Promise.all([
    readFile(appFilePath, 'utf8'),
    readFile(linksFilePath, 'utf8'),
    readFile(siteFilePath, 'utf8'),
  ]);

  const linkSets = parseHelpLinkSets(linksSource);
  const appTooltips = parseAppTooltips(appSource);
  const siteSurfaces = parseSiteHelpSurfaces(siteSource);

  const allLinks = linkSets.flatMap((set) =>
    set.entries.map((entry) => ({ ...entry, setName: set.setName }))
  );

  const metadataList = await mapWithConcurrency(
    allLinks,
    async (link) => fetchYoutubeOEmbed(link.url),
    10
  );

  const linkedEntries = allLinks.map((link, index) => {
    const metadata = metadataList[index];
    const fetchedTitle = metadata.ok ? metadata.title ?? '' : '';
    const labelTitleJaccard = metadata.ok ? jaccardScore(link.label, fetchedTitle) : 0;
    const topicRelevance = evaluateTopicRelevance(link.setName, link.label, fetchedTitle);
    return {
      ...link,
      metadata,
      labelTitleJaccard,
      topicRelevance,
    };
  });

  const entriesBySet = new Map();
  for (const entry of linkedEntries) {
    if (!entriesBySet.has(entry.setName)) {
      entriesBySet.set(entry.setName, []);
    }
    entriesBySet.get(entry.setName).push(entry);
  }

  const linkSetsWithMetadata = linkSets.map((set) => ({
    setName: set.setName,
    entries: entriesBySet.get(set.setName) ?? [],
  }));

  const linkSetUsage = {};
  let helpTooltipsWithLinks = 0;
  for (const tooltip of appTooltips) {
    if (tooltip.linksSet) {
      helpTooltipsWithLinks += 1;
      linkSetUsage[tooltip.linksSet] = (linkSetUsage[tooltip.linksSet] ?? 0) + 1;
    }
  }

  const distinctUrls = new Set(linkedEntries.map((entry) => entry.url));

  const audit = {
    generatedAt: new Date().toISOString(),
    app: {
      file: path.relative(repoRoot, appFilePath),
      totalHelpTooltips: appTooltips.length,
      helpTooltipsWithLinks,
      helpTooltipsWithoutLinks: appTooltips.length - helpTooltipsWithLinks,
      linkSetUsage,
      helpTooltips: appTooltips,
    },
    site: {
      file: path.relative(repoRoot, siteFilePath),
      ...siteSurfaces,
    },
    linkSets: linkSetsWithMetadata,
    totals: {
      tutorialLinkPlacements: linkedEntries.length,
      distinctTutorialUrls: distinctUrls.size,
      helpSurfacesAudited:
        appTooltips.length +
        siteSurfaces.embeddedVideos.length +
        siteSurfaces.helpIconCopyMentions,
    },
  };

  audit.issues = summarizeIssues(audit);

  await mkdir(outDir, { recursive: true });
  const dateStamp = new Date().toISOString().slice(0, 10);
  const jsonOutPath = path.join(outDir, `help-surface-audit-${dateStamp}.json`);
  const mdOutPath = path.join(outDir, `help-surface-audit-${dateStamp}.md`);
  const latestJsonPath = path.join(outDir, 'help-surface-audit-latest.json');
  const latestMdPath = path.join(outDir, 'help-surface-audit-latest.md');

  const jsonText = `${JSON.stringify(audit, null, 2)}\n`;
  const markdownText = toMarkdownReport(audit);

  await Promise.all([
    writeFile(jsonOutPath, jsonText, 'utf8'),
    writeFile(mdOutPath, markdownText, 'utf8'),
    writeFile(latestJsonPath, jsonText, 'utf8'),
    writeFile(latestMdPath, markdownText, 'utf8'),
  ]);

  console.log(`Wrote ${path.relative(repoRoot, latestJsonPath)}`);
  console.log(`Wrote ${path.relative(repoRoot, latestMdPath)}`);
  console.log(`Wrote ${path.relative(repoRoot, jsonOutPath)}`);
  console.log(`Wrote ${path.relative(repoRoot, mdOutPath)}`);
  console.log(`Total HelpTooltip instances: ${audit.app.totalHelpTooltips}`);
  console.log(`Tutorial link placements: ${audit.totals.tutorialLinkPlacements}`);
  console.log(`Distinct tutorial URLs: ${audit.totals.distinctTutorialUrls}`);
  console.log(`Issues flagged: ${audit.issues.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
