const assert = require('node:assert/strict');
const { gzipSync } = require('node:zlib');
const test = require('node:test');

const {
  extractAbletonTempoBpmFromProjectBuffer,
  extractAbletonTempoBpmFromProjectXml,
  isAbletonProjectPath,
} = require('../dist/ableton-tempo.test.cjs');

test('extractAbletonTempoBpmFromProjectXml reads the global Ableton Tempo manual value', () => {
  const xml = `
    <Ableton>
      <LiveSet>
        <Mixer>
          <Tempo>
            <LomId Value="0" />
            <Manual Value="152" />
            <MidiControllerRange>
              <Min Value="60" />
              <Max Value="200" />
            </MidiControllerRange>
          </Tempo>
        </Mixer>
      </LiveSet>
    </Ableton>
  `;

  assert.equal(extractAbletonTempoBpmFromProjectXml(xml), 152);
});

test('extractAbletonTempoBpmFromProjectBuffer handles gzipped .als contents', () => {
  const xml = `
    <Ableton>
      <LiveSet>
        <Mixer>
          <Tempo>
            <Manual Value="127.45" />
          </Tempo>
        </Mixer>
      </LiveSet>
    </Ableton>
  `;

  // Real Ableton `.als` files are gzip streams. This fixture proves the app can
  // use the project tempo without requiring Ableton or a large user project in
  // the test suite.
  assert.equal(extractAbletonTempoBpmFromProjectBuffer(gzipSync(Buffer.from(xml))), 127.5);
});

test('extractAbletonTempoBpmFromProjectXml ignores unusable tempo values', () => {
  const xml = `
    <Ableton>
      <LiveSet>
        <Mixer>
          <Tempo><Manual Value="true" /></Tempo>
          <Tempo><Manual Value="9999" /></Tempo>
        </Mixer>
      </LiveSet>
    </Ableton>
  `;

  assert.equal(extractAbletonTempoBpmFromProjectXml(xml), null);
});

test('isAbletonProjectPath recognizes .als links only', () => {
  assert.equal(isAbletonProjectPath('/Projects/Track.als'), true);
  assert.equal(isAbletonProjectPath('/Projects/Track.ALS'), true);
  assert.equal(isAbletonProjectPath('/Projects/Track.logicx'), false);
  assert.equal(isAbletonProjectPath(null), false);
});
