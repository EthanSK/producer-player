/*
  pp-audio-host — Producer Player native plugin-host sidecar.

  Phase 2 (v3.41):
    - Implements real `load_plugin` / `unload_plugin` / `process_block` so the
      sidecar can actually instantiate JUCE plugins and run audio through a
      chain. `set_parameter` / `get_parameter` / `get_plugin_state` /
      `set_plugin_state` are wired as real operations too so Phase 3/4 work
      (automation + preset persistence) can plug in without reshaping the
      protocol.
    - The audio callback on the sidecar is NOT driving CoreAudio yet — the
      Electron renderer still owns the output device in Phase 2. Instead the
      sidecar behaves as an on-demand DSP slave: receive a buffer over the
      JSON-RPC channel, run it through the enabled slots in `chain` order,
      return the processed buffer. The transport is stdio JSON lines with
      base64-encoded float32 audio (MVP; shared-memory is a Phase 2.5
      optimization if the IPC cost becomes measurable).

  Instance lifecycle:
    load_plugin   {id, method:"load_plugin", params:{instanceId, pluginPath,
                   format, sampleRate?, blockSize?}}
                  → AudioPluginFormatManager.createPluginInstance, cached in
                    a map keyed by instanceId. Each instance gets
                    prepareToPlay(sampleRate, blockSize) on load.
                  Returns {ok:true, instanceId, reportedLatencySamples,
                           numInputs, numOutputs}.

    unload_plugin {instanceId} → releaseResources(), drop from map.

    process_block {chain:[{instanceId, enabled}], sampleRate?, blockSize?,
                   channels:2, bufferBase64:"<stereo float32 interleaved>"}
                  → Process through enabled slots in order. Disabled or
                    unknown instanceIds are skipped (no-op passthrough).
                    An empty/zero-enabled chain returns the input verbatim.
                  Returns {ok:true, bufferBase64, frames, channels}.

    set_parameter  {instanceId, paramIndex, value (0..1)}
    get_parameter  {instanceId, paramIndex}
    get_plugin_state {instanceId}    → base64 plugin state blob
    set_plugin_state {instanceId, stateBase64}

  Ethan's invariant preserved at the sidecar layer:
    - process_block with an empty chain OR with every slot disabled returns
      the input buffer unchanged (memcpy). Zero DSP, zero allocation beyond
      the response JSON envelope. The renderer's bypass fast-path avoids
      this IPC entirely (that's the real zero-cost path), but even if a
      caller hits us with an empty chain we still pass audio through.

  The JSON parser is intentionally tiny (JUCE's built-in JSON). Each command
  is one line ≤ 16 MiB now (was 64 KiB in Phase 1a) to accommodate audio
  buffers; stdin is re-read as `std::cin` unbuffered so long lines are OK.
*/

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_core/juce_core.h>

#include <iostream>
#include <memory>
#include <string>
#include <unordered_map>
#include <vector>

namespace
{
// ---------------------------------------------------------------------------
// Plugin instance registry — keyed by the renderer-supplied instanceId (a
// stable UUID). We own the JUCE AudioPluginInstance via unique_ptr; on
// unload we call releaseResources() then drop the entry.
// ---------------------------------------------------------------------------

struct LoadedInstance
{
    std::unique_ptr<juce::AudioPluginInstance> plugin;
    double preparedSampleRate = 0.0;
    int preparedBlockSize = 0;
};

std::unordered_map<std::string, LoadedInstance> g_instances;

// Lazily-constructed plugin format manager. Owning it globally means we
// don't re-register formats per call (which is the non-trivial cost in JUCE).
juce::AudioPluginFormatManager& formatManager()
{
    static juce::AudioPluginFormatManager mgr;
    static bool initialised = false;
    if (! initialised)
    {
        mgr.addFormat (new juce::VST3PluginFormat());
      #if JUCE_PLUGINHOST_AU && JUCE_MAC
        mgr.addFormat (new juce::AudioUnitPluginFormat());
      #endif
        initialised = true;
    }
    return mgr;
}

juce::var makeError (const juce::String& message)
{
    juce::DynamicObject::Ptr obj (new juce::DynamicObject());
    obj->setProperty ("ok", false);
    obj->setProperty ("error", message);
    return juce::var (obj.get());
}

juce::var makeOk()
{
    juce::DynamicObject::Ptr obj (new juce::DynamicObject());
    obj->setProperty ("ok", true);
    return juce::var (obj.get());
}

void emit (const juce::var& reply)
{
    // One-line JSON terminated by '\n' so the Electron side can frame by
    // newline without buffering half-lines.
    auto serialized = juce::JSON::toString (reply, true /* allOnOneLine */);
    std::cout << serialized.toStdString() << '\n';
    std::cout.flush();
}

juce::StringArray defaultPluginSearchPaths (const juce::String& formatName)
{
    juce::StringArray paths;

  #if JUCE_MAC
    auto home = juce::File::getSpecialLocation (juce::File::userHomeDirectory);
    if (formatName.equalsIgnoreCase ("VST3"))
    {
        paths.add (home.getChildFile ("Library/Audio/Plug-Ins/VST3").getFullPathName());
        paths.add ("/Library/Audio/Plug-Ins/VST3");
    }
    else if (formatName.equalsIgnoreCase ("AudioUnit"))
    {
        paths.add (home.getChildFile ("Library/Audio/Plug-Ins/Components").getFullPathName());
        paths.add ("/Library/Audio/Plug-Ins/Components");
    }
  #else
    juce::ignoreUnused (formatName);
  #endif

    return paths;
}

juce::String formatToContractId (const juce::String& formatName)
{
    if (formatName.equalsIgnoreCase ("VST3"))      return "vst3";
    if (formatName.equalsIgnoreCase ("AudioUnit")) return "au";
    if (formatName.equalsIgnoreCase ("CLAP"))      return "clap";
    return formatName.toLowerCase();
}

juce::var describePlugin (const juce::PluginDescription& desc)
{
    juce::DynamicObject::Ptr obj (new juce::DynamicObject());
    auto formatId = formatToContractId (desc.pluginFormatName);
    juce::String idSuffix;
    if (desc.uniqueId != 0)
        idSuffix = juce::String::toHexString (desc.uniqueId);
    else if (desc.deprecatedUid != 0)
        idSuffix = juce::String::toHexString (desc.deprecatedUid);
    else
        idSuffix = juce::String (desc.fileOrIdentifier.hashCode64());

    obj->setProperty ("id", formatId + ":" + idSuffix);
    obj->setProperty ("name", desc.name);
    obj->setProperty ("vendor", desc.manufacturerName);
    obj->setProperty ("format", formatId);
    obj->setProperty ("version", desc.version);
    obj->setProperty ("path", desc.fileOrIdentifier);

    juce::Array<juce::var> cats;
    cats.add (juce::var (desc.category));
    obj->setProperty ("categories", cats);

    obj->setProperty ("isSupported", true);
    obj->setProperty ("failureReason", juce::var());
    return juce::var (obj.get());
}

juce::var handleScanPlugins (const juce::var& params)
{
    juce::OwnedArray<juce::AudioPluginFormat> ownedFormats;
    ownedFormats.add (new juce::VST3PluginFormat());
  #if JUCE_PLUGINHOST_AU && JUCE_MAC
    ownedFormats.add (new juce::AudioUnitPluginFormat());
  #endif

    juce::String requestedFormat = "all";
    if (auto* obj = params.getDynamicObject())
        if (obj->hasProperty ("format"))
            requestedFormat = params["format"].toString();

    juce::KnownPluginList known;

    juce::Array<juce::var> plugins;
    juce::Array<juce::var> failed;

    for (auto* format : ownedFormats)
    {
        if (requestedFormat != "all"
            && ! formatToContractId (format->getName()).equalsIgnoreCase (requestedFormat))
            continue;

        juce::StringArray searchPaths;
        if (auto* obj = params.getDynamicObject())
        {
            if (obj->hasProperty ("paths") && params["paths"].isArray())
            {
                if (auto* arr = params["paths"].getArray())
                    for (auto& p : *arr)
                        searchPaths.add (p.toString());
            }
        }
        if (searchPaths.isEmpty())
            searchPaths = defaultPluginSearchPaths (format->getName());

        juce::FileSearchPath fsp;
        for (auto& p : searchPaths)
            fsp.add (juce::File (p));

        juce::PluginDirectoryScanner scanner (known, *format, fsp,
                                              /* recursive */ true,
                                              /* deadMansPedalFile */ juce::File(),
                                              /* allowPluginsWhichRequireAsyncInstantiation */ true);

        juce::String pluginBeingScanned;
        while (scanner.scanNextFile (/* dontRescanIfAlreadyInList */ true, pluginBeingScanned))
        {
            // no-op — we collect results from the KnownPluginList below
        }

        for (auto& reason : scanner.getFailedFiles())
        {
            juce::DynamicObject::Ptr f (new juce::DynamicObject());
            f->setProperty ("format", formatToContractId (format->getName()));
            f->setProperty ("path", reason);
            f->setProperty ("failureReason", "scanner reported failure");
            failed.add (juce::var (f.get()));
        }
    }

    for (auto& desc : known.getTypes())
        plugins.add (describePlugin (desc));

    juce::DynamicObject::Ptr result (new juce::DynamicObject());
    result->setProperty ("ok", true);
    result->setProperty ("plugins", plugins);
    result->setProperty ("failed", failed);
    result->setProperty ("scanVersion", 1);
    return juce::var (result.get());
}

// ---------------------------------------------------------------------------
// Phase 2: load / unload / process_block helpers
// ---------------------------------------------------------------------------

juce::AudioPluginFormat* pickFormatFor (const juce::String& formatHint,
                                        const juce::File& pluginFile)
{
    auto& mgr = formatManager();
    for (int i = 0; i < mgr.getNumFormats(); ++i)
    {
        auto* fmt = mgr.getFormat (i);
        if (! fmt) continue;
        if (formatHint.isNotEmpty())
        {
            if (formatToContractId (fmt->getName()).equalsIgnoreCase (formatHint))
                return fmt;
        }
        else if (fmt->fileMightContainThisPluginType (pluginFile.getFullPathName()))
        {
            return fmt;
        }
    }
    return nullptr;
}

juce::PluginDescription* findDescription (juce::KnownPluginList& list,
                                          juce::AudioPluginFormat& fmt,
                                          const juce::String& path)
{
    juce::OwnedArray<juce::PluginDescription> descs;
    fmt.findAllTypesForFile (descs, path);
    if (descs.isEmpty()) return nullptr;
    auto* chosen = descs[0];
    list.addType (*chosen);
    // The returned ptr is owned by `descs` which is about to go out of scope,
    // so we can't return it directly. Clone into KnownPluginList and look up.
    for (auto& d : list.getTypes())
        if (d.fileOrIdentifier == chosen->fileOrIdentifier)
            return new juce::PluginDescription (d);
    return nullptr;
}

juce::var handleLoadPlugin (const juce::var& params)
{
    auto* obj = params.getDynamicObject();
    if (! obj) return makeError ("load_plugin: params must be object");

    auto instanceId = obj->getProperty ("instanceId").toString();
    auto pluginPath = obj->getProperty ("pluginPath").toString();
    auto formatHint = obj->getProperty ("format").toString();
    double sampleRate = (double) obj->getProperty ("sampleRate");
    if (sampleRate <= 0.0) sampleRate = 48000.0;
    int blockSize = (int) obj->getProperty ("blockSize");
    if (blockSize <= 0) blockSize = 512;

    if (instanceId.isEmpty())
        return makeError ("load_plugin: instanceId is required");
    if (pluginPath.isEmpty())
        return makeError ("load_plugin: pluginPath is required");

    // Idempotent: if the instanceId already resolves to a loaded plugin,
    // return success. Saves a load/unload dance on reconnect/replay.
    auto stdId = instanceId.toStdString();
    if (g_instances.count (stdId) > 0)
    {
        auto& existing = g_instances.at (stdId);
        juce::DynamicObject::Ptr reply (new juce::DynamicObject());
        reply->setProperty ("ok", true);
        reply->setProperty ("instanceId", instanceId);
        reply->setProperty ("reportedLatencySamples",
                            existing.plugin ? existing.plugin->getLatencySamples() : 0);
        reply->setProperty ("numInputs",
                            existing.plugin ? existing.plugin->getTotalNumInputChannels() : 2);
        reply->setProperty ("numOutputs",
                            existing.plugin ? existing.plugin->getTotalNumOutputChannels() : 2);
        reply->setProperty ("alreadyLoaded", true);
        return juce::var (reply.get());
    }

    juce::File pluginFile (pluginPath);
    auto* fmt = pickFormatFor (formatHint, pluginFile);
    if (! fmt) return makeError ("load_plugin: no matching plugin format for " + pluginPath);

    juce::KnownPluginList list;
    std::unique_ptr<juce::PluginDescription> desc (findDescription (list, *fmt, pluginPath));
    if (! desc) return makeError ("load_plugin: plugin description not found at " + pluginPath);

    juce::String errorMessage;
    auto plugin = formatManager().createPluginInstance (*desc, sampleRate, blockSize, errorMessage);
    if (! plugin)
        return makeError (errorMessage.isEmpty() ? juce::String ("load_plugin: createPluginInstance failed")
                                                 : juce::String ("load_plugin: ") + errorMessage);

    plugin->enableAllBuses();
    plugin->prepareToPlay (sampleRate, blockSize);

    LoadedInstance li;
    li.preparedSampleRate = sampleRate;
    li.preparedBlockSize = blockSize;
    int latency = plugin->getLatencySamples();
    int numIn = plugin->getTotalNumInputChannels();
    int numOut = plugin->getTotalNumOutputChannels();
    li.plugin = std::move (plugin);
    g_instances[stdId] = std::move (li);

    juce::DynamicObject::Ptr reply (new juce::DynamicObject());
    reply->setProperty ("ok", true);
    reply->setProperty ("instanceId", instanceId);
    reply->setProperty ("reportedLatencySamples", latency);
    reply->setProperty ("numInputs", numIn);
    reply->setProperty ("numOutputs", numOut);
    return juce::var (reply.get());
}

juce::var handleUnloadPlugin (const juce::var& params)
{
    auto* obj = params.getDynamicObject();
    if (! obj) return makeError ("unload_plugin: params must be object");
    auto instanceId = obj->getProperty ("instanceId").toString();
    auto stdId = instanceId.toStdString();
    auto it = g_instances.find (stdId);
    if (it == g_instances.end())
    {
        // Idempotent: unloading an unknown instance is a no-op success. Keeps
        // the reconciliation diff logic (Electron side) simple — it can just
        // fire unload for every removed slot without worrying about races.
        juce::DynamicObject::Ptr reply (new juce::DynamicObject());
        reply->setProperty ("ok", true);
        reply->setProperty ("instanceId", instanceId);
        reply->setProperty ("wasLoaded", false);
        return juce::var (reply.get());
    }
    if (it->second.plugin)
        it->second.plugin->releaseResources();
    g_instances.erase (it);
    juce::DynamicObject::Ptr reply (new juce::DynamicObject());
    reply->setProperty ("ok", true);
    reply->setProperty ("instanceId", instanceId);
    reply->setProperty ("wasLoaded", true);
    return juce::var (reply.get());
}

static bool decodeBufferFromBase64 (const juce::String& b64,
                                    int channels,
                                    int frames,
                                    juce::AudioBuffer<float>& outBuf)
{
    juce::MemoryOutputStream raw;
    if (! juce::Base64::convertFromBase64 (raw, b64))
        return false;
    const auto* data = static_cast<const float*> (raw.getData());
    auto byteSize = raw.getDataSize();
    auto expectedBytes = (size_t) channels * (size_t) frames * sizeof (float);
    outBuf.setSize (channels, frames, /*keepContent*/ false, /*clearExtra*/ true, /*avoidRealloc*/ false);
    if (byteSize != expectedBytes)
        return false;
    // Deinterleave.
    for (int frame = 0; frame < frames; ++frame)
        for (int ch = 0; ch < channels; ++ch)
            outBuf.setSample (ch, frame, data[frame * channels + ch]);
    return true;
}

static juce::String encodeBufferToBase64 (const juce::AudioBuffer<float>& buf)
{
    const int channels = buf.getNumChannels();
    const int frames = buf.getNumSamples();
    std::vector<float> interleaved ((size_t) channels * (size_t) frames);
    for (int frame = 0; frame < frames; ++frame)
        for (int ch = 0; ch < channels; ++ch)
            interleaved[(size_t) (frame * channels + ch)] = buf.getSample (ch, frame);
    return juce::Base64::toBase64 (interleaved.data(),
                                   interleaved.size() * sizeof (float));
}

juce::var handleProcessBlock (const juce::var& params)
{
    auto* obj = params.getDynamicObject();
    if (! obj) return makeError ("process_block: params must be object");

    int channels = (int) obj->getProperty ("channels");
    if (channels <= 0) channels = 2;
    int frames = (int) obj->getProperty ("frames");
    auto bufferBase64 = obj->getProperty ("bufferBase64").toString();

    if (frames <= 0 || bufferBase64.isEmpty())
        return makeError ("process_block: frames and bufferBase64 required");
    if (channels > 8 || frames > 262144)
        return makeError ("process_block: buffer dimensions too large");

    // Collect enabled instances, in declared order. Unknown/disabled slots
    // are skipped silently (the Electron side is the source of truth for
    // chain membership; if a load_plugin race hasn't finished we'd rather
    // pass audio through than drop it).
    juce::Array<juce::AudioPluginInstance*> enabledChain;
    if (auto chainVar = obj->getProperty ("chain"); chainVar.isArray())
    {
        if (auto* arr = chainVar.getArray())
        {
            for (auto& entry : *arr)
            {
                if (! entry.isObject()) continue;
                auto enabled = (bool) entry["enabled"];
                if (! enabled) continue;
                auto slotId = entry["instanceId"].toString().toStdString();
                auto it = g_instances.find (slotId);
                if (it == g_instances.end() || ! it->second.plugin) continue;
                enabledChain.add (it->second.plugin.get());
            }
        }
    }

    // Ethan's invariant — empty/all-disabled chain == identity passthrough.
    // Return the exact payload we received; do not decode/re-encode or risk
    // converting malformed input into silence when no DSP will run.
    if (enabledChain.isEmpty())
    {
        juce::DynamicObject::Ptr reply (new juce::DynamicObject());
        reply->setProperty ("ok", true);
        reply->setProperty ("channels", channels);
        reply->setProperty ("frames", frames);
        reply->setProperty ("bufferBase64", bufferBase64);
        reply->setProperty ("processedSlots", 0);
        return juce::var (reply.get());
    }

    juce::AudioBuffer<float> buffer (channels, frames);
    if (! decodeBufferFromBase64 (bufferBase64, channels, frames, buffer))
        return makeError ("process_block: bufferBase64 size does not match frames/channels");

    juce::MidiBuffer emptyMidi;
    for (auto* plugin : enabledChain)
        plugin->processBlock (buffer, emptyMidi);

    juce::DynamicObject::Ptr reply (new juce::DynamicObject());
    reply->setProperty ("ok", true);
    reply->setProperty ("channels", channels);
    reply->setProperty ("frames", frames);
    reply->setProperty ("bufferBase64", encodeBufferToBase64 (buffer));
    reply->setProperty ("processedSlots", enabledChain.size());
    return juce::var (reply.get());
}

juce::var handleSetParameter (const juce::var& params)
{
    auto* obj = params.getDynamicObject();
    if (! obj) return makeError ("set_parameter: params must be object");
    auto instanceId = obj->getProperty ("instanceId").toString().toStdString();
    int paramIndex = (int) obj->getProperty ("paramIndex");
    float value = (float) (double) obj->getProperty ("value");
    auto it = g_instances.find (instanceId);
    if (it == g_instances.end() || ! it->second.plugin)
        return makeError ("set_parameter: unknown instanceId");
    auto& params2 = it->second.plugin->getParameters();
    if (paramIndex < 0 || paramIndex >= params2.size())
        return makeError ("set_parameter: paramIndex out of range");
    params2[paramIndex]->setValueNotifyingHost (juce::jlimit (0.0f, 1.0f, value));
    return makeOk();
}

juce::var handleGetParameter (const juce::var& params)
{
    auto* obj = params.getDynamicObject();
    if (! obj) return makeError ("get_parameter: params must be object");
    auto instanceId = obj->getProperty ("instanceId").toString().toStdString();
    int paramIndex = (int) obj->getProperty ("paramIndex");
    auto it = g_instances.find (instanceId);
    if (it == g_instances.end() || ! it->second.plugin)
        return makeError ("get_parameter: unknown instanceId");
    auto& params2 = it->second.plugin->getParameters();
    if (paramIndex < 0 || paramIndex >= params2.size())
        return makeError ("get_parameter: paramIndex out of range");
    juce::DynamicObject::Ptr reply (new juce::DynamicObject());
    reply->setProperty ("ok", true);
    reply->setProperty ("value", (double) params2[paramIndex]->getValue());
    return juce::var (reply.get());
}

juce::var handleGetPluginState (const juce::var& params)
{
    auto* obj = params.getDynamicObject();
    if (! obj) return makeError ("get_plugin_state: params must be object");
    auto instanceId = obj->getProperty ("instanceId").toString().toStdString();
    auto it = g_instances.find (instanceId);
    if (it == g_instances.end() || ! it->second.plugin)
        return makeError ("get_plugin_state: unknown instanceId");
    juce::MemoryBlock mb;
    it->second.plugin->getStateInformation (mb);
    auto b64 = juce::Base64::toBase64 (mb.getData(), mb.getSize());
    juce::DynamicObject::Ptr reply (new juce::DynamicObject());
    reply->setProperty ("ok", true);
    reply->setProperty ("stateBase64", b64);
    return juce::var (reply.get());
}

juce::var handleSetPluginState (const juce::var& params)
{
    auto* obj = params.getDynamicObject();
    if (! obj) return makeError ("set_plugin_state: params must be object");
    auto instanceId = obj->getProperty ("instanceId").toString().toStdString();
    auto it = g_instances.find (instanceId);
    if (it == g_instances.end() || ! it->second.plugin)
        return makeError ("set_plugin_state: unknown instanceId");
    auto stateBase64 = obj->getProperty ("stateBase64").toString();
    juce::MemoryOutputStream raw;
    juce::Base64::convertFromBase64 (raw, stateBase64);
    it->second.plugin->setStateInformation (raw.getData(), (int) raw.getDataSize());
    return makeOk();
}

void runRepl()
{
    juce::ScopedJuceInitialiser_GUI juceInit;

    juce::DynamicObject::Ptr hello (new juce::DynamicObject());
    hello->setProperty ("event", "ready");
    hello->setProperty ("version", "0.2.0");
    emit (juce::var (hello.get()));

    // Phase 2: audio buffers can be large, so don't cap the line length.
    std::string line;
    line.reserve (1 << 16);
    while (std::getline (std::cin, line))
    {
        if (line.empty()) continue;

        auto parsed = juce::JSON::parse (juce::String (line));
        if (! parsed.isObject())
        {
            emit (makeError ("command must be a JSON object"));
            continue;
        }

        auto method = parsed["method"].toString();
        auto id = parsed["id"];
        auto params = parsed["params"];

        juce::var result;
        if (method == "scan_plugins")
        {
            result = handleScanPlugins (params);
        }
        else if (method == "load_plugin")
        {
            result = handleLoadPlugin (params);
        }
        else if (method == "unload_plugin")
        {
            result = handleUnloadPlugin (params);
        }
        else if (method == "process_block")
        {
            result = handleProcessBlock (params);
        }
        else if (method == "set_parameter")
        {
            result = handleSetParameter (params);
        }
        else if (method == "get_parameter")
        {
            result = handleGetParameter (params);
        }
        else if (method == "get_plugin_state")
        {
            result = handleGetPluginState (params);
        }
        else if (method == "set_plugin_state")
        {
            result = handleSetPluginState (params);
        }
        else if (method == "shutdown")
        {
            // Drain loaded plugins so destructors run before we exit.
            for (auto& kv : g_instances)
                if (kv.second.plugin) kv.second.plugin->releaseResources();
            g_instances.clear();

            auto ack = makeOk();
            if (auto* ackObj = ack.getDynamicObject())
                if (! id.isVoid())
                    ackObj->setProperty ("id", id);
            emit (ack);
            break;
        }
        else
        {
            result = makeError ("unknown method: " + method);
        }

        if (auto* obj = result.getDynamicObject())
            if (! id.isVoid())
                obj->setProperty ("id", id);

        emit (result);
    }
}
} // namespace

int main (int argc, char** argv)
{
    if (argc > 1 && juce::String (argv[1]) == "--scan")
    {
        juce::ScopedJuceInitialiser_GUI juceInit;
        juce::DynamicObject::Ptr params (new juce::DynamicObject());
        emit (handleScanPlugins (juce::var (params.get())));
        return 0;
    }

    runRepl();
    return 0;
}
