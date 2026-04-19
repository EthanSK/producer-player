/*
  pp-audio-host — Producer Player native plugin-host sidecar.

  Phase 3 (v3.42):
    - Adds `open_editor` / `close_editor` JSON-RPC methods. Each opens (or
      closes) a JUCE `AudioProcessorEditor` inside a top-level
      `DocumentWindow` on the JUCE message thread. Editor windows are keyed
      by instanceId and tracked in g_openEditors.
    - When the user closes a window via the OS close button, we emit a
      `{"event":"editor_closed","instanceId":"..."}` JSON line on stdout so
      the renderer can clear its "open" state without the user having to
      click the in-app Edit button again.
    - To keep the JUCE message loop pumping while still reading stdin, the
      REPL was split in two: a background thread owns the blocking
      `std::getline`, and every parsed command is bounced back to the
      message thread via `MessageManager::callAsync`. The main thread pumps
      `MessageManager::runDispatchLoopUntil(20)` slices so Cocoa events
      (clicks, keystrokes, redraws in plugin GUIs) are serviced normally.
    - `shutdown` now flips g_shouldExit from the message thread after
      draining editors/plugins, so destructors run on the same thread that
      created them (mandatory for JUCE/Cocoa safety).

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
#include <atomic>
#include <memory>
#include <string>
#include <thread>
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

// ---------------------------------------------------------------------------
// Phase 3 — native plugin-editor windows.
//
// Each open editor is owned by an EditorWindow (a DocumentWindow that wraps
// the plugin's AudioProcessorEditor). We key them by instanceId so the
// renderer can ask us to open/close a specific slot and so that repeated
// open_editor calls idempotently bring an existing window to the front
// instead of leaking a second one.
//
// Everything in this map MUST be created, touched, and destroyed on the
// JUCE message thread. See g_messageThreadId and the callAsync dispatch
// in runRepl() below.
// ---------------------------------------------------------------------------

std::thread::id g_messageThreadId;
void emit (const juce::var& reply);                    // forward
juce::var makeError (const juce::String& message);     // forward
juce::var makeOk();                                    // forward

// Forward-declared so EditorWindow::closeButtonPressed can schedule its own
// destruction via callAsync before the container exists.
static bool eraseOpenEditor (const juce::String& instanceId);

void notifyEditorClosed (const juce::String& instanceId)
{
    juce::DynamicObject::Ptr ev (new juce::DynamicObject());
    ev->setProperty ("event", "editor_closed");
    ev->setProperty ("instanceId", instanceId);
    emit (juce::var (ev.get()));
}

class EditorWindow : public juce::DocumentWindow
{
public:
    EditorWindow (const juce::String& instanceIdIn,
                  juce::AudioProcessorEditor* editor,
                  const juce::String& titleText)
        : juce::DocumentWindow (titleText,
                                juce::Colours::darkgrey,
                                juce::DocumentWindow::closeButton,
                                /* addToDesktop */ true),
          instanceId (instanceIdIn)
    {
        setUsingNativeTitleBar (true);
        setResizable (editor->isResizable(), /*useBottomRightCornerResizer*/ false);
        // DocumentWindow takes ownership of the content component when the
        // deleteWhenRemoved flag is true. The plugin editor is owned by the
        // plugin instance; once the window removes it, JUCE deletes it,
        // which matches how standalone hosts run editors.
        setContentOwned (editor, /*resizeToFit*/ true);
        centreWithSize (getWidth(), getHeight());
        setVisible (true);
        toFront (true);
    }

    void closeButtonPressed() override
    {
        // Capture the id before `this` is destroyed by the erase() below.
        auto id = instanceId;

        // Destroy on the message thread after the current call stack
        // unwinds; deleting the window in the middle of its own callback
        // is a known JUCE footgun.
        juce::MessageManager::callAsync ([id]() {
            if (eraseOpenEditor (id))
                notifyEditorClosed (id);
        });
    }

    juce::String instanceId;
};

std::unordered_map<std::string, std::unique_ptr<EditorWindow>> g_openEditors;

static bool eraseOpenEditor (const juce::String& instanceId)
{
    auto it = g_openEditors.find (instanceId.toStdString());
    if (it != g_openEditors.end())
    {
        g_openEditors.erase (it);
        return true;
    }
    return false;
}

juce::var handleOpenEditor (const juce::var& params)
{
    auto* obj = params.getDynamicObject();
    if (! obj) return makeError ("open_editor: params must be object");
    auto instanceId = obj->getProperty ("instanceId").toString();
    if (instanceId.isEmpty())
        return makeError ("open_editor: instanceId is required");

    auto stdId = instanceId.toStdString();
    auto it = g_instances.find (stdId);
    if (it == g_instances.end() || ! it->second.plugin)
        return makeError ("open_editor: unknown instanceId (not loaded)");

    // Idempotent: if already open, just bring it forward and succeed.
    auto existing = g_openEditors.find (stdId);
    if (existing != g_openEditors.end() && existing->second)
    {
        existing->second->toFront (true);
        juce::DynamicObject::Ptr reply (new juce::DynamicObject());
        reply->setProperty ("ok", true);
        reply->setProperty ("instanceId", instanceId);
        reply->setProperty ("alreadyOpen", true);
        return juce::var (reply.get());
    }

    auto* plugin = it->second.plugin.get();
    auto* editor = plugin->createEditorIfNeeded();
    if (editor == nullptr)
        return makeError ("open_editor: plugin does not expose an editor");

    auto title = plugin->getName();
    auto window = std::make_unique<EditorWindow> (instanceId, editor, title);
    g_openEditors.emplace (stdId, std::move (window));

    juce::DynamicObject::Ptr reply (new juce::DynamicObject());
    reply->setProperty ("ok", true);
    reply->setProperty ("instanceId", instanceId);
    reply->setProperty ("alreadyOpen", false);
    return juce::var (reply.get());
}

juce::var handleCloseEditor (const juce::var& params)
{
    auto* obj = params.getDynamicObject();
    if (! obj) return makeError ("close_editor: params must be object");
    auto instanceId = obj->getProperty ("instanceId").toString();
    if (instanceId.isEmpty())
        return makeError ("close_editor: instanceId is required");
    auto stdId = instanceId.toStdString();
    auto it = g_openEditors.find (stdId);
    bool wasOpen = (it != g_openEditors.end());
    if (wasOpen)
        g_openEditors.erase (it);

    juce::DynamicObject::Ptr reply (new juce::DynamicObject());
    reply->setProperty ("ok", true);
    reply->setProperty ("instanceId", instanceId);
    reply->setProperty ("wasOpen", wasOpen);
    return juce::var (reply.get());
}

// Called when a plugin is being unloaded — close its editor first so we
// don't end up with a window pointing at a destroyed AudioProcessor.
void closeEditorForInstanceIfOpen (const std::string& stdId)
{
    auto it = g_openEditors.find (stdId);
    if (it == g_openEditors.end()) return;
    juce::String idCopy (it->first);
    g_openEditors.erase (it);
    notifyEditorClosed (idCopy);
}

void closeAllEditorsAndReleasePlugins()
{
    for (auto it = g_openEditors.begin(); it != g_openEditors.end(); )
    {
        auto idCopy = juce::String (it->first);
        it = g_openEditors.erase (it);
        notifyEditorClosed (idCopy);
    }

    for (auto& kv : g_instances)
        if (kv.second.plugin) kv.second.plugin->releaseResources();
    g_instances.clear();
}

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
    // Close any open editor first so the window isn't left pointing at
    // a plugin we're about to destroy. This also emits editor_closed so
    // the renderer can clear its "open" state without a race.
    closeEditorForInstanceIfOpen (stdId);

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

// ---------------------------------------------------------------------------
// Phase 3: we need a real JUCE message loop running on the main thread so
// plugin editor windows can receive Cocoa events. The previous design
// blocked the main thread in std::getline, which was fine while the sidecar
// had no GUI surface but would freeze any native editor we opened.
//
// Strategy:
//   - main thread     → MessageManager::runDispatchLoopUntil(20ms) slices
//   - stdin thread    → reads newline-delimited JSON from std::cin and
//                        bounces each command to the message thread via
//                        MessageManager::callAsync. Heavy work (plugin
//                        instantiation, editor creation) happens on the
//                        message thread.
//   - `shutdown`      → drains message-thread state, then flips g_shouldExit
//                        so main() can unwind cleanly.
//
// All touches of g_instances and g_openEditors happen on the message
// thread, so we don't need a mutex.
// ---------------------------------------------------------------------------

juce::var dispatchMethodOnMessageThread (const juce::String& method, const juce::var& params)
{
    jassert (std::this_thread::get_id() == g_messageThreadId);

    if (method == "scan_plugins")      return handleScanPlugins (params);
    if (method == "load_plugin")       return handleLoadPlugin (params);
    if (method == "unload_plugin")     return handleUnloadPlugin (params);
    if (method == "process_block")     return handleProcessBlock (params);
    if (method == "set_parameter")     return handleSetParameter (params);
    if (method == "get_parameter")     return handleGetParameter (params);
    if (method == "get_plugin_state")  return handleGetPluginState (params);
    if (method == "set_plugin_state")  return handleSetPluginState (params);
    if (method == "open_editor")       return handleOpenEditor (params);
    if (method == "close_editor")      return handleCloseEditor (params);

    return makeError ("unknown method: " + method);
}

void processCommandOnMessageThread (const juce::String& method,
                                    const juce::var& params,
                                    juce::var id,
                                    bool isShutdown)
{
    if (isShutdown)
    {
        closeAllEditorsAndReleasePlugins();

        auto ack = makeOk();
        if (auto* ackObj = ack.getDynamicObject())
            if (! id.isVoid())
                ackObj->setProperty ("id", id);
        emit (ack);

        // Outer loop owns exit — see g_shouldExit in runRepl().
        return;
    }

    auto result = dispatchMethodOnMessageThread (method, params);
    if (auto* obj = result.getDynamicObject())
        if (! id.isVoid())
            obj->setProperty ("id", id);
    emit (result);
}

// Global flag the stdin thread flips when the REPL should exit. We don't
// use MessageManager::stopDispatchLoop here because on a console app
// (no JUCEApplication) stopping the Cocoa runloop from inside a callAsync
// has caused crashes in testing (observed: SIGSEGV during NSApp teardown).
// Instead we own the outer loop and pump JUCE events in small slices.
std::atomic<bool> g_shouldExit { false };

void runRepl()
{
    juce::ScopedJuceInitialiser_GUI juceInit;
    g_messageThreadId = std::this_thread::get_id();

    juce::DynamicObject::Ptr hello (new juce::DynamicObject());
    hello->setProperty ("event", "ready");
    hello->setProperty ("version", "0.3.0");
    emit (juce::var (hello.get()));

    // stdin reader — runs on a background thread so the main thread stays
    // free to pump the message loop. Every parsed line is bounced back to
    // the message thread via callAsync (so plugin state, editor windows,
    // etc. are all touched from the same thread).
    std::thread stdinThread ([]() {
        std::string line;
        line.reserve (1 << 16);
        while (std::getline (std::cin, line))
        {
            if (g_shouldExit) break;
            if (line.empty()) continue;

            juce::String lineCopy (line);
            juce::MessageManager::callAsync ([lineCopy]() {
                auto parsed = juce::JSON::parse (lineCopy);
                if (! parsed.isObject())
                {
                    emit (makeError ("command must be a JSON object"));
                    return;
                }
                auto method = parsed["method"].toString();
                auto id = parsed["id"];
                auto params = parsed["params"];
                const bool isShutdown = (method == "shutdown");
                processCommandOnMessageThread (method, params, id, isShutdown);
                if (isShutdown) g_shouldExit = true;
            });
        }
        // If stdin closes while commands are queued, enqueue exit behind
        // those commands so piped requests still run before teardown.
        juce::MessageManager::callAsync ([]() { g_shouldExit = true; });
    });

    // Pump the JUCE message loop in small slices so Cocoa events (plugin
    // editor input, redraws) get serviced AND we can observe
    // g_shouldExit between slices. This avoids the stopDispatchLoop
    // crash path we saw when trying to tear down from inside callAsync.
    auto* mm = juce::MessageManager::getInstance();
    while (! g_shouldExit)
    {
        mm->runDispatchLoopUntil (20 /* ms */);
    }

    // Explicit EOF can set g_shouldExit without a shutdown command. Clean up
    // while ScopedJuceInitialiser_GUI is still alive, otherwise global plugin
    // destructors can run after JUCE/Cocoa teardown.
    closeAllEditorsAndReleasePlugins();

    // Detach — std::cin.read blocks and there's no portable way to
    // interrupt it. Process exit will reclaim the thread.
    stdinThread.detach();
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
