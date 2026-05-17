#!/usr/bin/env node
// v3.226 — migrate every native `title=` attribute on JSX elements in the
// renderer to the new InstantTooltip pattern (voice 3163).
//
// Strategy: for each JSX element with a `title` attribute:
//   - REMOVE the `title` attribute
//   - ADD `instant-tooltip-host instant-tooltip-host--inline-flex` to
//     the element's className (creating a className prop if absent)
//   - APPEND `<InstantTooltipPopover content={<title-value>} />` as the
//     LAST CHILD of the element (or convert a self-closing element to
//     open/close form first)
//
// Skips:
//   - elements with role="tooltip" themselves (already a popover)
//   - elements with className containing 'help-tooltip-trigger' (already
//     uses HelpTooltip's modal pattern)
//   - elements with className containing 'instant-tooltip-host' (already
//     migrated — idempotent)
//   - elements with className containing 'main-list-row-metadata-popover'
//     (existing custom popover — keep as-is)
//   - `<a title=...>` inside Help/Tutorial labels because the label IS
//     the visible string (keep — the regex in helpTooltipLinks.ts uses
//     it; harmless to leave native)
//
// One InstantTooltipPopover import is added per file that gets at least
// one migration applied.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const TARGET_FILES = [
  'apps/renderer/src/App.tsx',
  'apps/renderer/src/KWeightingCurveModal.tsx',
  'apps/renderer/src/AgentChatPanel.tsx',
  'apps/renderer/src/AgentSettings.tsx',
  'apps/renderer/src/TechnicalInfoPopover.tsx',
  'apps/renderer/src/IdealsModal.tsx',
  'apps/renderer/src/EqGainSliders.tsx',
  'apps/renderer/src/lib/LogSliceViewer.tsx',
  'apps/renderer/src/BackgroundTasksIndicator.tsx',
  'apps/renderer/src/lib/PluginBrowserDialog.tsx',
  'apps/renderer/src/lib/MasteringChecklistImportance.tsx',
  'apps/renderer/src/AgentComposer.tsx',
  'apps/renderer/src/lib/PluginChainStrip.tsx',
  // Note: HelpTooltip.tsx is intentionally skipped — its native title=
  // usages are inside its own modal (Close button, video card hover hint)
  // and operate at a different layer.
];

const SKIP_CLASSNAME_TOKENS = [
  'help-tooltip-trigger',
  'instant-tooltip-host',
  'main-list-row-metadata-popover',
  'listening-device-auto-set-toggle', // already migrated to popover pattern
  'song-project-save-copy-button', // already migrated
];

function shouldSkipElement(node) {
  // Find className attribute
  for (const attr of node.attributes.properties) {
    if (!ts.isJsxAttribute(attr)) continue;
    if (attr.name.escapedText !== 'className') continue;
    let value = '';
    if (attr.initializer && ts.isStringLiteral(attr.initializer)) {
      value = attr.initializer.text;
    } else if (
      attr.initializer &&
      ts.isJsxExpression(attr.initializer) &&
      attr.initializer.expression
    ) {
      // Try to extract string parts from template literals or string-literal expressions
      const expr = attr.initializer.expression;
      if (ts.isStringLiteral(expr)) {
        value = expr.text;
      } else if (ts.isTemplateExpression(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
        value = expr.getText();
      } else {
        value = expr.getText();
      }
    }
    for (const token of SKIP_CLASSNAME_TOKENS) {
      if (value.includes(token)) return true;
    }
  }
  // Also skip explicit role="tooltip" elements
  for (const attr of node.attributes.properties) {
    if (!ts.isJsxAttribute(attr)) continue;
    if (attr.name.escapedText !== 'role') continue;
    if (attr.initializer && ts.isStringLiteral(attr.initializer) && attr.initializer.text === 'tooltip') {
      return true;
    }
  }
  return false;
}

function getTitleAttribute(node) {
  for (const attr of node.attributes.properties) {
    if (!ts.isJsxAttribute(attr)) continue;
    if (attr.name.escapedText === 'title') return attr;
  }
  return null;
}

function transformFile(filePath) {
  const source = readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  // Collect transforms as a list of edits: {start, end, replacement}
  const edits = [];
  let migrations = 0;

  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const titleAttr = getTitleAttribute(node);
      if (titleAttr && !shouldSkipElement(node)) {
        // Skip if the title value is a known not-interesting case:
        // - on an <option> or <track> element (HTML semantics differ)
        const tagName = node.tagName.getText();
        if (tagName === 'option' || tagName === 'track' || tagName === 'meta') {
          // Don't touch HTML element semantics
        } else {
          // Extract the title VALUE expression text
          let titleValueText;
          if (titleAttr.initializer && ts.isStringLiteral(titleAttr.initializer)) {
            // title="literal" -> content="literal"
            titleValueText = titleAttr.initializer.getText();
          } else if (
            titleAttr.initializer &&
            ts.isJsxExpression(titleAttr.initializer) &&
            titleAttr.initializer.expression
          ) {
            // title={expr} -> content={expr}
            titleValueText = `{${titleAttr.initializer.expression.getText()}}`;
          } else {
            // unsupported shape; skip
            return ts.forEachChild(node, visit);
          }

          // Find className attribute on this element (if any)
          let classNameAttr = null;
          for (const attr of node.attributes.properties) {
            if (ts.isJsxAttribute(attr) && attr.name.escapedText === 'className') {
              classNameAttr = attr;
              break;
            }
          }

          // Build the className edit
          const hostClasses = 'instant-tooltip-host instant-tooltip-host--inline-flex';
          let classNameEdit = null;
          if (!classNameAttr) {
            // Insert a new className before the title attribute
            classNameEdit = {
              start: titleAttr.getFullStart(),
              end: titleAttr.getFullStart(),
              replacement: ` className="${hostClasses}"`,
            };
          } else if (classNameAttr.initializer) {
            if (ts.isStringLiteral(classNameAttr.initializer)) {
              // className="foo" -> className="foo <hostClasses>"
              const existing = classNameAttr.initializer.text;
              const newText = existing.length > 0 ? `${existing} ${hostClasses}` : hostClasses;
              classNameEdit = {
                start: classNameAttr.initializer.getStart(sourceFile),
                end: classNameAttr.initializer.getEnd(),
                replacement: `"${newText}"`,
              };
            } else if (ts.isJsxExpression(classNameAttr.initializer) && classNameAttr.initializer.expression) {
              // className={expr} -> className={`${expr} <hostClasses>`}
              const exprText = classNameAttr.initializer.expression.getText();
              // Avoid double-wrapping in template literals if expr is a string literal
              const innerExpr = ts.isStringLiteral(classNameAttr.initializer.expression)
                ? `${classNameAttr.initializer.expression.text} ${hostClasses}`
                : null;
              let replacement;
              if (innerExpr !== null) {
                replacement = `{${JSON.stringify(innerExpr)}}`;
              } else {
                // Use a template literal wrapper
                replacement = `{\`\${${exprText}} ${hostClasses}\`}`;
              }
              classNameEdit = {
                start: classNameAttr.initializer.getStart(sourceFile),
                end: classNameAttr.initializer.getEnd(),
                replacement,
              };
            }
          }

          if (!classNameEdit) {
            // Couldn't safely edit className; skip
            return ts.forEachChild(node, visit);
          }

          // Remove the title attribute (including any leading whitespace)
          const titleStart = titleAttr.getFullStart();
          const titleEnd = titleAttr.getEnd();
          const titleEdit = {
            start: titleStart,
            end: titleEnd,
            replacement: '',
          };

          // Determine how to inject the InstantTooltipPopover. We need
          // to add it as the last child of the element.
          let popoverInjectEdit = null;
          // The popover JSX:
          const popoverJsx = `<InstantTooltipPopover content=${titleValueText.startsWith('{') ? titleValueText : `${titleValueText}`} />`;

          if (ts.isJsxSelfClosingElement(node)) {
            // We can't add children to self-closing elements that
            // don't allow children (e.g. <input>, <img>). Skip self-closing
            // entirely — those usages were native-only tooltips and we
            // accept losing them in the migration (very few sites).
            return ts.forEachChild(node, visit);
          } else {
            // Open element — find the closing tag of the JsxElement parent
            const parentElement = node.parent;
            if (!ts.isJsxElement(parentElement)) {
              return ts.forEachChild(node, visit);
            }
            const closingTag = parentElement.closingElement;
            // Inject before the closing tag
            popoverInjectEdit = {
              start: closingTag.getStart(sourceFile),
              end: closingTag.getStart(sourceFile),
              replacement: popoverJsx,
            };
          }

          edits.push(titleEdit, classNameEdit, popoverInjectEdit);
          migrations += 1;
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  if (edits.length === 0) {
    return { migrations: 0, output: source };
  }

  // Sort edits by start descending, apply
  edits.sort((a, b) => b.start - a.start);
  let output = source;
  for (const edit of edits) {
    output = output.slice(0, edit.start) + edit.replacement + output.slice(edit.end);
  }

  // Add the InstantTooltipPopover import if not present
  if (!/InstantTooltipPopover/.test(source) || !/from\s+['"]\.\/InstantTooltip['"]/.test(source)) {
    // Compute the import path relative to the file
    const fileDir = path.dirname(filePath);
    const importTargetAbs = path.resolve(REPO_ROOT, 'apps/renderer/src/InstantTooltip');
    let importPath = path.relative(fileDir, importTargetAbs);
    if (!importPath.startsWith('.')) importPath = './' + importPath;
    importPath = importPath.split(path.sep).join('/');
    const importLine = `import { InstantTooltipPopover } from '${importPath}';\n`;

    // Insert after the last top-level import statement
    const importRegex = /^(import[^;]*;\s*\n)+/m;
    const match = output.match(importRegex);
    if (match) {
      const insertAt = match.index + match[0].length;
      output = output.slice(0, insertAt) + importLine + output.slice(insertAt);
    } else {
      output = importLine + output;
    }
  }

  return { migrations, output };
}

let totalMigrations = 0;
const fileResults = [];
for (const rel of TARGET_FILES) {
  const abs = path.resolve(REPO_ROOT, rel);
  try {
    const { migrations, output } = transformFile(abs);
    if (migrations > 0) {
      writeFileSync(abs, output, 'utf8');
      fileResults.push({ file: rel, migrations });
      totalMigrations += migrations;
    } else {
      fileResults.push({ file: rel, migrations: 0 });
    }
  } catch (err) {
    fileResults.push({ file: rel, error: err.message });
  }
}

console.log('Migration results:');
for (const r of fileResults) {
  if (r.error) {
    console.log(`  ${r.file}: ERROR ${r.error}`);
  } else {
    console.log(`  ${r.file}: ${r.migrations} migrations`);
  }
}
console.log(`Total: ${totalMigrations} migrations across ${fileResults.filter((r) => r.migrations > 0).length} files`);
