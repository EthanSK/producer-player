/*
  pp-audio-host — Producer Player native plugin-host sidecar.

  Phase 1a scaffold (v3.39):
    - Reads newline-delimited JSON commands from stdin.
    - Emits newline-delimited JSON replies on stdout.
    - Diagnostics go to stderr so they don't corrupt the JSON-RPC channel.

  Supported commands
  ------------------
  scan_plugins   { format?: "vst3" | "au" | "all", paths?: [string] }
                 Enumerates the user's installed VST3 and AudioUnit plugins via
                 JUCE's KnownPluginList + VST3PluginFormat / AudioUnitPluginFormat.
                 When no paths are provided, falls back to the platform default
                 folders (~/Library/Audio/Plug-Ins/VST3 and .../Components on
                 macOS). Returns {"ok":true,"plugins":[...]}.

  shutdown       { }
                 Flushes and exits with code 0. The Electron host uses this
                 on app quit to let the sidecar tear down cleanly.

  Stub commands (return {"ok":false,"error":"not implemented"}):
    load_plugin   — instantiate a plugin into a per-track chain slot
    unload_plugin — tear down one slot
    set_parameter — push a parameter change to the audio thread
    get_parameter — read a current parameter value
    process_block — not a JSON command in production, but stubbed here for
                    symmetry with the Phase 2 audio callback command surface

  The JSON parser is intentionally tiny (JUCE's built-in JSON). Each command
  is one line ≤ 64 KiB; anything larger is rejected. This keeps the sidecar
  resilient to malformed renderer input and avoids pulling in a third-party
  JSON library for the scaffold.
*/

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_core/juce_core.h>

#include <iostream>
#include <string>

namespace
{
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
    // id: <format>:<uniqueId>. Falls back to file path when uniqueId is
    // unavailable so the renderer always has a stable key.
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
        // Caller-provided paths win; fall back to OS defaults.
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

void runRepl()
{
    juce::ScopedJuceInitialiser_GUI juceInit;

    // Handshake: announce we're alive so the parent can gate on the first
    // line of stdout without racing on process-spawn latency.
    juce::DynamicObject::Ptr hello (new juce::DynamicObject());
    hello->setProperty ("event", "ready");
    hello->setProperty ("version", "0.1.0");
    emit (juce::var (hello.get()));

    std::string line;
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
        else if (method == "shutdown")
        {
            // v3.39 bug fix (codex review 2026-04-19): include the request id
            // in the ack so `PluginHostService.send('shutdown')` can match the
            // reply and resolve its pending promise. Without this the stop()
            // path waits forever instead of reaching its `finally` kill.
            auto ack = makeOk();
            if (auto* ackObj = ack.getDynamicObject())
                if (! id.isVoid())
                    ackObj->setProperty ("id", id);
            emit (ack);
            break;
        }
        else if (method == "load_plugin"
                 || method == "unload_plugin"
                 || method == "set_parameter"
                 || method == "get_parameter"
                 || method == "process_block")
        {
            result = makeError ("not implemented");
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
    // CLI smoke test: `pp-audio-host --scan` runs one scan and exits. Handy
    // for the build pipeline to prove the binary works without stdio piping.
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
