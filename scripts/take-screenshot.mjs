/**
 * take-screenshot.mjs
 *
 * Launches the Producer Player Electron app with realistic sample data,
 * seeds checklist items with timestamps, opens the checklist modal,
 * and captures a hero screenshot for the landing page and README.
 */
import { _electron as electron } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, '..');
const electronEntry = path.join(workspaceRoot, 'apps/electron/dist/main.cjs');

const SCREENSHOT_DIR = path.join(workspaceRoot, 'site/assets/screenshots');

// Realistic song names for a producer's album (6 songs, fits cleanly in window)
const SAMPLE_SONGS = [
  { name: 'Fever Dream v1.wav',         date: '2026-03-12T11:30:00.000Z' },
  { name: 'Slow Burn v1.wav',           date: '2026-03-10T15:00:00.000Z' },
  { name: 'Lost Signal v3.wav',         date: '2026-03-08T09:30:00.000Z' },
  { name: 'Lost Signal v2.wav',         date: '2026-03-03T14:00:00.000Z' },
  { name: 'Lost Signal v1.wav',         date: '2026-02-22T18:00:00.000Z' },
  { name: 'Echoes v2.wav',              date: '2026-03-05T12:00:00.000Z' },
  { name: 'Echoes v1.wav',              date: '2026-02-28T22:30:00.000Z' },
  { name: 'Neon Lights v4.wav',         date: '2026-03-01T08:15:00.000Z' },
  { name: 'Neon Lights v3.wav',         date: '2026-02-25T20:30:00.000Z' },
  { name: 'Neon Lights v2.wav',         date: '2026-02-18T13:00:00.000Z' },
  { name: 'Neon Lights v1.wav',         date: '2026-02-08T17:45:00.000Z' },
  { name: 'Golden Hour v2.wav',         date: '2026-02-20T16:45:00.000Z' },
  { name: 'Golden Hour v1.wav',         date: '2026-02-12T11:00:00.000Z' },
];

// Checklist items with timestamps for the screenshot
const CHECKLIST_ITEMS = [
  { id: randomUUID(), text: 'Add more low-end to the chorus', completed: false, timestampSeconds: 47 },
  { id: randomUUID(), text: 'Fix the hi-hat pattern', completed: false, timestampSeconds: 125 },
  { id: randomUUID(), text: 'Bring up the vocal in the bridge', completed: false, timestampSeconds: 186 },
  { id: randomUUID(), text: 'Check compression on the master', completed: true, timestampSeconds: 0 },
  { id: randomUUID(), text: 'Add reverb tail to the outro', completed: false, timestampSeconds: 224 },
];

/**
 * Generate a valid WAV file buffer with a sine wave (not silence).
 * This makes analysis results (LUFS, dynamics) look realistic.
 * @param {number} durationSeconds - Length of audio
 * @param {number} sampleRate - Sample rate (default 44100)
 * @param {number} channels - Number of channels (default 2 = stereo)
 * @param {number} bitsPerSample - Bit depth (default 16)
 * @param {number} frequency - Sine wave frequency in Hz (default 440)
 * @param {number} amplitude - Amplitude 0-1 (default 0.3 ≈ -10 dB)
 */
function createToneWav(durationSeconds = 5, sampleRate = 44100, channels = 2, bitsPerSample = 16, frequency = 440, amplitude = 0.3) {
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = channels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const numSamples = Math.floor(durationSeconds * sampleRate);
  const dataSize = numSamples * blockAlign;
  const headerSize = 44;
  const buffer = Buffer.alloc(headerSize + dataSize);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  // fmt chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);            // PCM format
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);

  // data chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Write sine wave samples with amplitude envelope for realistic dynamics
  const maxVal = Math.pow(2, bitsPerSample - 1) - 1;
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    // Amplitude envelope: oscillates between 0.15 and full amplitude at ~0.5Hz
    // This creates a ~6dB dynamics range, which looks realistic
    const envelope = 0.5 + 0.5 * Math.sin(2 * Math.PI * 0.5 * t);
    const dynAmplitude = amplitude * (0.3 + 0.7 * envelope);
    const sample = Math.round(dynAmplitude * maxVal * Math.sin(2 * Math.PI * frequency * i / sampleRate));
    for (let ch = 0; ch < channels; ch++) {
      buffer.writeInt16LE(sample, offset);
      offset += bytesPerSample;
    }
  }

  return buffer;
}

async function main() {
  console.log('Creating temp directories for sample data...');
  const fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pp-screenshot-fixture-'));
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pp-screenshot-userdata-'));

  // Write valid WAV files with actual audio content for realistic LUFS/dynamics
  console.log('Writing sample audio files (valid WAV with tone)...');
  const wavBuffer = createToneWav(5, 44100, 2, 16, 440, 0.3);  // 5s tone, ~-10dB
  for (const song of SAMPLE_SONGS) {
    const filePath = path.join(fixtureDir, song.name);
    await fs.writeFile(filePath, wavBuffer);
    const timestamp = new Date(song.date);
    await fs.utimes(filePath, timestamp, timestamp);
  }

  console.log('Launching Electron app...');
  const electronApp = await electron.launch({
    args: [electronEntry],
    env: {
      ...process.env,
      PRODUCER_PLAYER_USER_DATA_DIR: userDataDir,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      PRODUCER_PLAYER_TEST_ID: randomUUID(),
      // Don't use background mode — we want a real visible window for screenshot
    },
  });

  try {
    const page = await electronApp.firstWindow();
    console.log('Waiting for app shell...');
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 30000 });

    // Link the fixture folder
    console.log('Linking sample folder...');
    await page.getByTestId('link-folder-path-input').fill(fixtureDir);
    await page.getByTestId('link-folder-path-button').click();

    // Wait for songs to appear
    console.log('Waiting for songs to load...');
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="main-list-row"]').length >= 6,
      { timeout: 15000 }
    );
    
    // Give the app a moment to settle and render fully
    await page.waitForTimeout(1000);

    // Get the first song's ID so we can seed checklist data
    const firstSongId = await page.evaluate(() => {
      const el = document.querySelector('[data-song-id]');
      return el?.getAttribute('data-song-id') ?? null;
    });

    if (firstSongId) {
      console.log(`Seeding checklist items for song: ${firstSongId}`);

      // Get all song IDs so we can set varied ratings
      const allSongIds = await page.evaluate(() => {
        const els = document.querySelectorAll('[data-song-id]');
        return Array.from(els).map(el => el.getAttribute('data-song-id')).filter(Boolean);
      });

      // Seed varied ratings for a natural look
      const ratingValues = [8, 6, 9, 7, 10, 4, 7];
      const ratings = {};
      allSongIds.forEach((id, i) => {
        if (id) ratings[id] = ratingValues[i % ratingValues.length];
      });

      await page.evaluate(({ songId, items, ratings }) => {
        const checklists = { [songId]: items };
        window.localStorage.setItem(
          'producer-player.song-checklists.v1',
          JSON.stringify(checklists)
        );
        window.localStorage.setItem(
          'producer-player.song-ratings.v1',
          JSON.stringify(ratings)
        );
      }, { songId: firstSongId, items: CHECKLIST_ITEMS, ratings });

      // Reload to pick up localStorage changes
      await page.reload();
      await page.waitForSelector('[data-testid="app-shell"]', { timeout: 15000 });
      await page.waitForFunction(
        () => document.querySelectorAll('[data-testid="main-list-row"]').length >= 6,
        { timeout: 15000 }
      );
      await page.waitForTimeout(1000);

      // Open the checklist modal for the first song
      console.log('Opening checklist modal...');
      const checklistButton = page.getByTestId('song-checklist-button').first();
      if (await checklistButton.isVisible()) {
        await checklistButton.click();
        await page.waitForSelector('[data-testid="song-checklist-modal"]', { timeout: 5000 });
        await page.waitForTimeout(500);
        console.log('Checklist modal opened with timestamp badges visible');
      }
    }

    // Set a good window size for the screenshot
    const window = await electronApp.browserWindow(page);
    await window.evaluate((win) => {
      win.setSize(1600, 2000);
      win.center();
    });
    await page.waitForTimeout(500);

    // Take the screenshot WITH checklist modal open
    console.log('Taking screenshot with checklist modal...');
    await fs.mkdir(SCREENSHOT_DIR, { recursive: true });

    const heroChecklistPath = path.join(SCREENSHOT_DIR, 'app-hero-checklist.png');
    await page.screenshot({ path: heroChecklistPath, type: 'png' });
    console.log(`Checklist screenshot saved to: ${heroChecklistPath}`);

    // Close the modal and take a clean screenshot of the main track list
    const doneButton = page.getByText('Done', { exact: true });
    if (await doneButton.isVisible().catch(() => false)) {
      await doneButton.click();
      await page.waitForTimeout(500);
    }

    // Take the main hero screenshot (track list visible, no modal)
    const heroPath = path.join(SCREENSHOT_DIR, 'app-hero.png');
    await page.screenshot({ path: heroPath, type: 'png' });
    console.log(`Hero screenshot saved to: ${heroPath}`);

    // Also copy for README
    const readmePath = path.join(SCREENSHOT_DIR, 'app-hero-readme.png');
    await fs.copyFile(heroPath, readmePath);
    console.log(`README screenshot saved to: ${readmePath}`);

    const stats = await fs.stat(heroPath);
    console.log(`Screenshot size: ${(stats.size / 1024).toFixed(1)} KB`);

  } finally {
    console.log('Closing app...');
    await electronApp.close();

    // Cleanup temp dirs
    await fs.rm(fixtureDir, { recursive: true, force: true });
    await fs.rm(userDataDir, { recursive: true, force: true });
    console.log('Done!');
  }
}

main().catch((err) => {
  console.error('Screenshot failed:', err);
  process.exit(1);
});
