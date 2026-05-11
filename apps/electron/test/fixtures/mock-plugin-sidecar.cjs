const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');

function encodeFloat32Interleaved(samples) {
  const buffer = Buffer.alloc(samples.length * 4);
  samples.forEach((sample, index) => {
    buffer.writeFloatLE(sample, index * 4);
  });
  return buffer.toString('base64');
}

function decodeFloat32Interleaved(bufferBase64) {
  const buffer = Buffer.from(bufferBase64, 'base64');
  const samples = [];
  for (let offset = 0; offset < buffer.length; offset += 4) {
    samples.push(buffer.readFloatLE(offset));
  }
  return samples;
}

function stateForGain(gain) {
  return Buffer.from(JSON.stringify({ gain }), 'utf8').toString('base64');
}

function parseGainState(stateBase64, fallbackGain) {
  try {
    const parsed = JSON.parse(Buffer.from(stateBase64, 'base64').toString('utf8'));
    return typeof parsed.gain === 'number' && Number.isFinite(parsed.gain)
      ? parsed.gain
      : fallbackGain;
  } catch {
    return fallbackGain;
  }
}

function gainFromPath(pluginPath) {
  const match = String(pluginPath).match(/gain-([0-9]+(?:\.[0-9]+)?)/i);
  return match ? Number(match[1]) : 2;
}

function makeMockPluginSidecar({ requests = [] } = {}) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const child = new EventEmitter();
  const loaded = new Map();

  child.stdin = stdin;
  child.stdout = stdout;
  child.stderr = stderr;
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    child.emit('exit', 0, null);
  };

  function ok(id, body = {}) {
    stdout.write(`${JSON.stringify({ id, ok: true, ...body })}\n`);
  }

  function fail(id, error) {
    stdout.write(`${JSON.stringify({ id, ok: false, error: String(error) })}\n`);
  }

  function handle(req) {
    const params = req.params ?? {};
    if (req.method === 'scan_plugins') {
      ok(req.id, {
        plugins: [
          {
            id: 'vst3:mock-gain',
            name: 'Producer Player Mock Gain',
            vendor: 'Producer Player Tests',
            format: 'vst3',
            version: '1.0.0',
            path: '/mock/Producer Player Mock Gain gain-2.vst3',
            categories: ['Fx', 'Utility'],
            isSupported: true,
            failureReason: null,
          },
        ],
        scanVersion: 1,
      });
      return;
    }

    if (req.method === 'load_plugin') {
      const gain = gainFromPath(params.pluginPath);
      const stateBase64 = stateForGain(gain);
      loaded.set(params.instanceId, {
        gain,
        stateBase64,
      });
      ok(req.id, {
        instanceId: params.instanceId,
        reportedLatencySamples: 0,
        numInputs: 2,
        numOutputs: 2,
      });
      return;
    }

    if (req.method === 'unload_plugin') {
      const wasLoaded = loaded.delete(params.instanceId);
      ok(req.id, { instanceId: params.instanceId, wasLoaded });
      return;
    }

    if (req.method === 'get_plugin_state') {
      const slot = loaded.get(params.instanceId);
      if (!slot) {
        fail(req.id, 'get_plugin_state: unknown instanceId');
        return;
      }
      ok(req.id, { stateBase64: slot.stateBase64 });
      return;
    }

    if (req.method === 'set_plugin_state') {
      const slot = loaded.get(params.instanceId);
      if (!slot) {
        fail(req.id, 'set_plugin_state: unknown instanceId');
        return;
      }
      slot.stateBase64 = params.stateBase64;
      slot.gain = parseGainState(params.stateBase64, slot.gain);
      ok(req.id);
      return;
    }

    if (req.method === 'process_block') {
      const channels = params.channels ?? 2;
      const frames = params.frames;
      const chain = Array.isArray(params.chain) ? params.chain : [];
      const enabledSlots = chain.filter((item) => item.enabled && loaded.has(item.instanceId));
      if (enabledSlots.length === 0) {
        ok(req.id, {
          channels,
          frames,
          bufferBase64: params.bufferBase64,
          processedSlots: 0,
        });
        return;
      }

      const samples = decodeFloat32Interleaved(params.bufferBase64);
      const processed = samples.slice();
      for (const item of enabledSlots) {
        const slot = loaded.get(item.instanceId);
        for (let index = 0; index < processed.length; index += 1) {
          processed[index] *= slot.gain;
        }
      }
      ok(req.id, {
        channels,
        frames,
        bufferBase64: encodeFloat32Interleaved(processed),
        processedSlots: enabledSlots.length,
      });
      return;
    }

    fail(req.id, `no mock for ${req.method}`);
  }

  let buffered = '';
  stdin.on('data', (chunk) => {
    buffered += chunk.toString('utf8');
    for (;;) {
      const newlineIndex = buffered.indexOf('\n');
      if (newlineIndex < 0) return;
      const line = buffered.slice(0, newlineIndex);
      buffered = buffered.slice(newlineIndex + 1);
      if (!line.trim()) continue;
      try {
        const req = JSON.parse(line);
        requests.push(req);
        handle(req);
      } catch (err) {
        fail(undefined, err);
      }
    }
  });

  setImmediate(() => {
    stdout.write(`${JSON.stringify({ event: 'ready', version: 'mock-plugin-sidecar' })}\n`);
  });

  return child;
}

module.exports = {
  decodeFloat32Interleaved,
  encodeFloat32Interleaved,
  makeMockPluginSidecar,
  stateForGain,
};
