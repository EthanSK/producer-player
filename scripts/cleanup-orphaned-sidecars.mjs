#!/usr/bin/env node
/**
 * One-shot maintenance script for cleaning up companion files
 * (DAW sidecars like Ableton `.asd`, Reaper `.reapeaks`, Logic `.peak`,
 * plus arbitrary user companions like `.bak` / `.notes` / future DAW
 * formats) that were left stranded at the top level of a Producer Player
 * folder because earlier versions of the app moved audio files into
 * `old/` without bringing their companions along.
 *
 * Usage:
 *   node scripts/cleanup-orphaned-sidecars.mjs /path/to/MusicOutput
 *   node scripts/cleanup-orphaned-sidecars.mjs --dry-run /path/to/MusicOutput
 *
 * Detection is DAW-agnostic: any top-level file whose name starts with
 * `<audio-filename>.` (the full audio filename plus a literal trailing
 * dot, where `<audio-filename>` is some file that currently lives in
 * `old/`) is considered a stranded companion and is moved into `old/`
 * alongside its audio. Subdirectories are skipped even if they match.
 *
 * Safe to run multiple times. Use --dry-run first to inspect what would
 * change without touching disk.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function parseArgs(argv) {
  const args = { dryRun: false, folder: null };
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run' || arg === '-n') {
      args.dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (!args.folder) {
      args.folder = arg;
    } else {
      throw new Error(`Unexpected extra argument: ${arg}`);
    }
  }
  return args;
}

function printUsage() {
  console.log(
    'Usage: node scripts/cleanup-orphaned-sidecars.mjs [--dry-run] <folder>\n' +
      '\n' +
      'Move stranded companion files from the top level of <folder> into\n' +
      '<folder>/old/ when their matching audio file is already in <folder>/old/.\n' +
      'A companion is any regular file whose name starts with `<audio>.` where\n' +
      '<audio> matches an audio file currently in <folder>/old/.\n'
  );
}

async function pathExists(absolutePath) {
  try {
    await fs.access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveNonCollidingPath(targetPath) {
  if (!(await pathExists(targetPath))) {
    return targetPath;
  }

  const parsed = path.parse(targetPath);
  let counter = 1;
  // Mirror the service's `-archived-N` collision strategy.
  while (true) {
    const candidate = path.join(
      parsed.dir,
      `${parsed.name}-archived-${counter}${parsed.ext}`
    );
    if (!(await pathExists(candidate))) {
      return candidate;
    }
    counter += 1;
  }
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    printUsage();
    process.exit(2);
  }

  if (args.help || !args.folder) {
    printUsage();
    process.exit(args.help ? 0 : 2);
  }

  const folder = path.resolve(args.folder);
  const oldFolder = path.join(folder, 'old');

  let folderStat;
  try {
    folderStat = await fs.stat(folder);
  } catch (error) {
    console.error(`Cannot access folder: ${folder}`);
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
  if (!folderStat.isDirectory()) {
    console.error(`Not a directory: ${folder}`);
    process.exit(1);
  }

  let topEntries;
  try {
    topEntries = await fs.readdir(folder, { withFileTypes: true });
  } catch (error) {
    console.error(`Failed to read folder: ${folder}`);
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  const oldFolderExists = await pathExists(oldFolder);

  // Index the set of audio (and other) filenames currently in `old/` so we can
  // match top-level companions against them with a prefix-anchored lookup.
  // Each entry maps the audio filename to its absolute path inside `old/`.
  const oldFileNames = [];
  if (oldFolderExists) {
    try {
      const oldEntries = await fs.readdir(oldFolder, { withFileTypes: true });
      for (const oldEntry of oldEntries) {
        if (oldEntry.isFile()) {
          oldFileNames.push(oldEntry.name);
        }
      }
    } catch (error) {
      console.error(`Failed to read old/ folder: ${oldFolder}`);
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  }

  // Sort longest-first so that when a candidate matches multiple potential
  // "audio" prefixes (e.g. `foo.wav` and `foo.wav.bak` both happen to be in
  // `old/`), we associate the companion with the most specific (longest)
  // anchor. In practice this is paranoia — companions in `old/` won't usually
  // themselves act as audio anchors — but it makes the matching deterministic.
  oldFileNames.sort((a, b) => b.length - a.length);

  let moved = 0;
  let skipped = 0;

  for (const entry of topEntries) {
    if (!entry.isFile()) {
      continue;
    }

    // Find the longest old/ filename `X` such that `entry.name` starts with
    // `X.` (literal trailing dot). That `X` is the audio anchor for this
    // companion.
    let audioFileName = null;
    for (const candidate of oldFileNames) {
      const prefix = `${candidate}.`;
      if (entry.name.length > prefix.length && entry.name.startsWith(prefix)) {
        audioFileName = candidate;
        break;
      }
    }

    if (!audioFileName) {
      // Not a recognised companion (no anchor in old/), or the top-level audio
      // is still present (handled implicitly: if the audio is at top level,
      // it's not in old/ and won't match). Leave the file alone.
      continue;
    }

    // Don't touch a companion if the audio is ALSO at top level — the
    // companion belongs alongside the top-level audio, not in old/.
    const topLevelAudioPath = path.join(folder, audioFileName);
    if (await pathExists(topLevelAudioPath)) {
      skipped += 1;
      continue;
    }

    const sourceSidecar = path.join(folder, entry.name);
    const desiredTarget = path.join(oldFolder, entry.name);
    const finalTarget = await resolveNonCollidingPath(desiredTarget);

    if (args.dryRun) {
      console.log(`would move: ${sourceSidecar} -> ${finalTarget}`);
      moved += 1;
      continue;
    }

    try {
      await fs.rename(sourceSidecar, finalTarget);
      console.log(`moved: ${sourceSidecar} -> ${finalTarget}`);
      moved += 1;
    } catch (error) {
      // Fallback for cross-device renames.
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'EXDEV'
      ) {
        try {
          await fs.copyFile(sourceSidecar, finalTarget);
          await fs.unlink(sourceSidecar);
          console.log(`moved (copy+unlink): ${sourceSidecar} -> ${finalTarget}`);
          moved += 1;
        } catch (copyError) {
          console.error(
            `failed: ${sourceSidecar}: ${copyError instanceof Error ? copyError.message : String(copyError)}`
          );
          skipped += 1;
        }
      } else {
        console.error(
          `failed: ${sourceSidecar}: ${error instanceof Error ? error.message : String(error)}`
        );
        skipped += 1;
      }
    }
  }

  console.log(
    `${args.dryRun ? '[dry-run] ' : ''}moved ${moved} orphan${moved === 1 ? '' : 's'}, skipped ${skipped} (no match)`
  );
}

await main();
