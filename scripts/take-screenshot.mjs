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
  // thedrums: V6, 5 versions (matching Ethan's real app exactly)
  { name: 'thedrums v6.wav',                  date: '2026-03-16T21:04:53.000Z' },
  { name: 'thedrums v5.wav',                  date: '2026-02-22T00:41:57.000Z' },
  { name: 'thedrums v4.wav',                  date: '2025-12-29T01:52:06.000Z' },
  { name: 'thedrumsv3.wav',                   date: '2025-12-09T23:23:50.000Z' },
  { name: 'thedrumsv2.wav',                   date: '2025-12-05T23:10:31.000Z' },
  // barber smith: V3, 2 versions
  { name: 'barber smith v3.wav',              date: '2025-11-19T02:06:38.000Z' },
  { name: 'barber smith v1.wav',              date: '2025-09-15T10:00:00.000Z' },
  // bend the knees: V6, 4 versions
  { name: 'bend the knees v6.wav',            date: '2025-12-13T17:31:21.000Z' },
  { name: 'bend the knees v4.wav',            date: '2025-11-20T09:00:00.000Z' },
  { name: 'bend the knees v2.wav',            date: '2025-10-25T18:00:00.000Z' },
  { name: 'bend the knees v1.wav',            date: '2025-10-05T11:00:00.000Z' },
  // Engineering|Alignment: V5, 4 versions
  { name: 'Engineering|Alignment v5.wav',     date: '2026-03-16T23:17:44.000Z' },
  { name: 'Engineering|Alignment v3.wav',     date: '2026-03-01T20:00:00.000Z' },
  { name: 'Engineering|Alignment v2.wav',     date: '2026-02-20T16:00:00.000Z' },
  { name: 'Engineering|Alignment v1.wav',     date: '2026-02-10T12:00:00.000Z' },
  // leaky: V6, 5 versions
  { name: 'leaky v6.wav',                     date: '2026-03-08T00:13:12.000Z' },
  { name: 'leaky v5.wav',                     date: '2026-03-01T15:00:00.000Z' },
  { name: 'leaky v4.wav',                     date: '2026-02-22T10:00:00.000Z' },
  { name: 'leaky v2.wav',                     date: '2026-02-05T22:00:00.000Z' },
  { name: 'leaky v1.wav',                     date: '2026-01-20T14:00:00.000Z' },
  // holy fuck kevin parker: V14, 12 versions
  { name: 'holy fuck kevin parker v14.wav',   date: '2026-03-10T01:27:28.000Z' },
  { name: 'holy fuck kevin parker v13.wav',   date: '2026-03-05T20:00:00.000Z' },
  { name: 'holy fuck kevin parker v12.wav',   date: '2026-02-28T15:00:00.000Z' },
  { name: 'holy fuck kevin parker v11.wav',   date: '2026-02-20T10:00:00.000Z' },
  { name: 'holy fuck kevin parker v10.wav',   date: '2026-02-15T08:00:00.000Z' },
  { name: 'holy fuck kevin parker v9.wav',    date: '2026-02-10T12:00:00.000Z' },
  { name: 'holy fuck kevin parker v8.wav',    date: '2026-02-01T16:00:00.000Z' },
  { name: 'holy fuck kevin parker v7.wav',    date: '2026-01-25T14:00:00.000Z' },
  { name: 'holy fuck kevin parker v6.wav',    date: '2026-01-20T10:00:00.000Z' },
  { name: 'holy fuck kevin parker v5.wav',    date: '2026-01-15T11:00:00.000Z' },
  { name: 'holy fuck kevin parker v3.wav',    date: '2025-12-20T16:00:00.000Z' },
  { name: 'holy fuck kevin parker v1.wav',    date: '2025-11-15T11:00:00.000Z' },
  // geetar seshnew: V9, 8 versions
  { name: 'geetar seshnew v9.wav',            date: '2026-03-13T00:14:10.000Z' },
  { name: 'geetar seshnew v8.wav',            date: '2026-03-08T18:00:00.000Z' },
  { name: 'geetar seshnew v7.wav',            date: '2026-03-01T14:00:00.000Z' },
  { name: 'geetar seshnew v6.wav',            date: '2026-02-22T12:00:00.000Z' },
  { name: 'geetar seshnew v5.wav',            date: '2026-02-15T10:00:00.000Z' },
  { name: 'geetar seshnew v4.wav',            date: '2026-02-08T08:00:00.000Z' },
  { name: 'geetar seshnew v2.wav',            date: '2026-01-25T15:00:00.000Z' },
  { name: 'geetar seshnew v1.wav',            date: '2026-01-20T09:00:00.000Z' },
  // smokeweedwav: V5, 5 versions (estimated)
  { name: 'smokeweedwav v5.wav',              date: '2026-03-12T11:30:00.000Z' },
  { name: 'smokeweedwav v4.wav',              date: '2026-03-05T09:00:00.000Z' },
  { name: 'smokeweedwav v3.wav',              date: '2026-02-25T15:00:00.000Z' },
  { name: 'smokeweedwav v2.wav',              date: '2026-02-15T12:00:00.000Z' },
  { name: 'smokeweedwav v1.wav',              date: '2026-02-01T10:00:00.000Z' },
  // 4 additional songs to reach 12 tracks total (placeholder names — update when known)
  { name: 'bassline theory v3.wav',           date: '2026-03-14T16:00:00.000Z' },
  { name: 'bassline theory v2.wav',           date: '2026-03-01T12:00:00.000Z' },
  { name: 'bassline theory v1.wav',           date: '2026-02-10T14:00:00.000Z' },
  { name: 'night terrace v4.wav',             date: '2026-03-11T20:00:00.000Z' },
  { name: 'night terrace v2.wav',             date: '2026-02-15T18:00:00.000Z' },
  { name: 'night terrace v1.wav',             date: '2026-01-28T10:00:00.000Z' },
  { name: 'soft collapse v2.wav',             date: '2026-03-09T14:00:00.000Z' },
  { name: 'soft collapse v1.wav',             date: '2026-02-20T11:00:00.000Z' },
  { name: 'dopamine rush v7.wav',             date: '2026-03-15T22:00:00.000Z' },
  { name: 'dopamine rush v5.wav',             date: '2026-03-05T15:00:00.000Z' },
  { name: 'dopamine rush v3.wav',             date: '2026-02-18T09:00:00.000Z' },
  { name: 'dopamine rush v1.wav',             date: '2026-01-30T12:00:00.000Z' },
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

    // Link the fixture folder via IPC (path-linker UI was removed)
    console.log('Linking sample folder...');
    await page.evaluate(async (p) => { await window.producerPlayer.linkFolder(p); }, fixtureDir);

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

      // Ratings matching Ethan's real app: thedrums=9, barber smith=8, bend the knees=8, Engineering|Alignment=9, leaky=8, holy fuck kevin parker=8, geetar seshnew=7, smokeweedwav=7, + 4 extras
      const ratingValues = [9, 8, 8, 9, 8, 8, 7, 7, 8, 7, 6, 9];
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

    // Hide test-mode-only UI elements and long paths that shouldn't appear in screenshots
    await page.addStyleTag({ content: '.path-linker { display: none !important; } .folder-row-path { display: none !important; }' });

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
