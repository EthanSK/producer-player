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
  // Neon Lights: 5 versions — most recent song, will be auto-selected to showcase version history
  { name: 'Neon Lights v5.wav',         date: '2026-03-14T10:00:00.000Z' },
  { name: 'Neon Lights v4.wav',         date: '2026-03-10T08:15:00.000Z' },
  { name: 'Neon Lights v3.wav',         date: '2026-03-05T20:30:00.000Z' },
  { name: 'Neon Lights v2.wav',         date: '2026-02-25T13:00:00.000Z' },
  { name: 'Neon Lights v1.wav',         date: '2026-02-15T17:45:00.000Z' },
  // Fever Dream: single version
  { name: 'Fever Dream v1.wav',         date: '2026-03-12T11:30:00.000Z' },
  { name: 'Slow Burn v1.wav',           date: '2026-03-09T15:00:00.000Z' },
  // Lost Signal: 4 versions
  { name: 'Lost Signal v4.wav',         date: '2026-03-08T09:30:00.000Z' },
  { name: 'Lost Signal v3.wav',         date: '2026-03-03T14:00:00.000Z' },
  { name: 'Lost Signal v2.wav',         date: '2026-02-22T18:00:00.000Z' },
  { name: 'Lost Signal v1.wav',         date: '2026-02-10T12:00:00.000Z' },
  // Echoes: 2 versions
  { name: 'Echoes v2.wav',              date: '2026-03-06T12:00:00.000Z' },
  { name: 'Echoes v1.wav',              date: '2026-02-28T22:30:00.000Z' },
  // Golden Hour: 3 versions
  { name: 'Golden Hour v3.wav',         date: '2026-03-01T16:45:00.000Z' },
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
 * Generate a rich WAV buffer with layered multi-frequency content.
 * Produces pink-noise-like spectrum with harmonics across the full frequency
 * range so the spectrum analyzer and level meter look populated in screenshots.
 *
 * Content: bass drone + mid harmonics + high shimmer + filtered noise,
 * all with slow amplitude modulation for realistic dynamics.
 */
function createRichWav(durationSeconds = 10, sampleRate = 44100, channels = 2, bitsPerSample = 16) {
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

  const maxVal = Math.pow(2, bitsPerSample - 1) - 1;
  const masterAmplitude = 0.35; // ~-9 dB, healthy level

  // Frequency layers with relative amplitudes (sum ~1.0)
  // Spread across sub, low, mid, high-mid, and high bands
  const tones = [
    // Sub / Bass
    { freq: 55,    amp: 0.25, modRate: 0.3 },   // Sub bass A1
    { freq: 110,   amp: 0.20, modRate: 0.4 },   // Bass A2
    // Low-mid
    { freq: 220,   amp: 0.12, modRate: 0.5 },   // A3
    { freq: 440,   amp: 0.10, modRate: 0.7 },   // A4
    // Mid
    { freq: 880,   amp: 0.08, modRate: 0.6 },   // A5
    { freq: 1320,  amp: 0.05, modRate: 0.9 },   // E6 (5th harmonic of A2)
    { freq: 2200,  amp: 0.04, modRate: 1.1 },   // Upper mid
    // High-mid
    { freq: 3500,  amp: 0.03, modRate: 1.3 },   // Presence
    { freq: 5000,  amp: 0.025, modRate: 0.8 },  // Clarity
    // High / Air
    { freq: 8000,  amp: 0.02, modRate: 1.5 },   // Brilliance
    { freq: 12000, amp: 0.015, modRate: 1.2 },   // Air
    { freq: 16000, amp: 0.01, modRate: 1.0 },    // Ultra-high
  ];

  // Simple PRNG for deterministic noise (seed-based)
  let noiseSeed = 42;
  function nextNoise() {
    noiseSeed = (noiseSeed * 1103515245 + 12345) & 0x7fffffff;
    return (noiseSeed / 0x7fffffff) * 2 - 1; // -1 to 1
  }

  // Simple one-pole lowpass for filtered noise (cutoff ~4kHz feel)
  let noiseState = 0;
  const noiseAlpha = 0.15;

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;

    // Sum all tonal layers with individual amplitude modulation
    let sampleL = 0;
    let sampleR = 0;
    for (const tone of tones) {
      // Slow amplitude modulation (0.3–1.0 range) at different rates per tone
      const mod = 0.65 + 0.35 * Math.sin(2 * Math.PI * tone.modRate * t);
      const val = tone.amp * mod * Math.sin(2 * Math.PI * tone.freq * i / sampleRate);
      sampleL += val;
      // Slight stereo variation: offset phase on right channel
      const valR = tone.amp * mod * Math.sin(2 * Math.PI * tone.freq * i / sampleRate + 0.3);
      sampleR += valR;
    }

    // Add filtered noise for natural texture (like tape hiss / room tone)
    const rawNoise = nextNoise();
    noiseState += noiseAlpha * (rawNoise - noiseState);
    const noiseContrib = noiseState * 0.06;
    sampleL += noiseContrib;
    sampleR += noiseContrib * 0.8 + nextNoise() * 0.01; // Slightly different noise in R

    // Overall slow dynamics envelope (~6dB range at ~0.3Hz)
    const masterEnv = 0.65 + 0.35 * Math.sin(2 * Math.PI * 0.3 * t);

    const clampedL = Math.max(-1, Math.min(1, sampleL * masterAmplitude * masterEnv));
    const clampedR = Math.max(-1, Math.min(1, sampleR * masterAmplitude * masterEnv));

    buffer.writeInt16LE(Math.round(clampedL * maxVal), offset);
    offset += bytesPerSample;
    if (channels === 2) {
      buffer.writeInt16LE(Math.round(clampedR * maxVal), offset);
      offset += bytesPerSample;
    }
  }

  return buffer;
}

async function main() {
  console.log('Creating temp directories for sample data...');
  const fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pp-screenshot-fixture-'));
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pp-screenshot-userdata-'));

  // Write valid WAV files with rich multi-frequency content for realistic spectrum display
  console.log('Writing sample audio files (rich multi-frequency WAV)...');
  const wavBuffer = createRichWav(10, 44100, 2, 16);  // 10s rich audio, ~-9dB
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

    // Set a normal desktop aspect ratio for the screenshot (~16:10)
    const window = await electronApp.browserWindow(page);
    await window.evaluate((win) => {
      win.setSize(1440, 900);
      win.center();
    });
    await page.waitForTimeout(500);

    // --- Start audio playback so spectrum analyzer & level meter are active ---
    // Close checklist modal first if open (we'll reopen it later for the checklist screenshot)
    const doneButtonPre = page.getByText('Done', { exact: true });
    if (await doneButtonPre.isVisible().catch(() => false)) {
      await doneButtonPre.click();
      await page.waitForTimeout(300);
    }

    // Double-click the first track row to start playback
    console.log('Starting audio playback for spectrum visualization...');
    const firstRow = page.getByTestId('main-list-row').first();
    await firstRow.dblclick();

    // Wait for playback to actually start and visualizations to populate
    // The spectrum analyzer needs a few animation frames of real data
    await page.waitForTimeout(2000);

    // Verify playback started by checking the play button changed to pause
    const isPlayingNow = await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="player-play-toggle"]');
      // The button shows pause icon when playing
      return btn?.textContent?.includes('⏸') || btn?.getAttribute('aria-label')?.includes('Pause') || false;
    });
    console.log(`Playback active: ${isPlayingNow}`);

    // Give extra time for the spectrum to look good (smooth animation needs ~30 frames)
    await page.waitForTimeout(1500);

    // --- Take screenshots with live spectrum data ---
    console.log('Taking screenshots with active spectrum...');
    await fs.mkdir(SCREENSHOT_DIR, { recursive: true });

    // 1. Main hero screenshot (track list + active spectrum/level meter)
    const heroPath = path.join(SCREENSHOT_DIR, 'app-hero.png');
    await page.screenshot({ path: heroPath, type: 'png' });
    console.log(`Hero screenshot saved to: ${heroPath}`);

    // Also copy for README
    const readmePath = path.join(SCREENSHOT_DIR, 'app-hero-readme.png');
    await fs.copyFile(heroPath, readmePath);
    console.log(`README screenshot saved to: ${readmePath}`);

    // 2. Now open checklist modal and take checklist screenshot (still playing)
    console.log('Opening checklist modal for screenshot (audio still playing)...');
    const checklistBtn2 = page.getByTestId('song-checklist-button').first();
    if (await checklistBtn2.isVisible()) {
      await checklistBtn2.click();
      await page.waitForSelector('[data-testid="song-checklist-modal"]', { timeout: 5000 });
      await page.waitForTimeout(800); // Let spectrum continue animating
    }

    const heroChecklistPath = path.join(SCREENSHOT_DIR, 'app-hero-checklist.png');
    await page.screenshot({ path: heroChecklistPath, type: 'png' });
    console.log(`Checklist screenshot saved to: ${heroChecklistPath}`);

    // Close the modal
    const doneButton = page.getByText('Done', { exact: true });
    if (await doneButton.isVisible().catch(() => false)) {
      await doneButton.click();
      await page.waitForTimeout(300);
    }

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
