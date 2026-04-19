# pp-audio-host — Producer Player native plugin-host sidecar
#
# Phase 1a scaffold (v3.39):
#  - Depends on JUCE 8.0.12 vendored at ./JUCE
#  - Builds a console app that speaks newline-delimited JSON on stdio
#  - Implements `scan_plugins` against the user's VST3 + AudioUnit folders
#  - All other commands (load, unload, process, set_parameter, shutdown)
#    are stubs returning {"ok":false,"error":"not implemented"} so the
#    Electron integration has a real binary to exercise end-to-end.
#
# Later phases fill in the audio graph, plugin instantiation, and native
# editor windows.

cmake_minimum_required(VERSION 3.22)

project(pp-audio-host VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# macOS-first ship — min target matches Producer Player's Electron build so
# Gatekeeper / codesign behave consistently. Later phases raise this only
# when a JUCE feature demands it.
if(APPLE)
    set(CMAKE_OSX_DEPLOYMENT_TARGET "11.0" CACHE STRING "macOS deployment target")
endif()

# Vendored JUCE (submodule-like clone at ./JUCE, pinned to 8.0.12).
add_subdirectory(JUCE)

juce_add_console_app(pp-audio-host
    PRODUCT_NAME "Producer Player Audio Host"
    BUNDLE_ID    com.ethansk.producerplayer.audiohost
    COMPANY_NAME EthanSK)

target_sources(pp-audio-host PRIVATE
    src/main.cpp)

target_compile_definitions(pp-audio-host PRIVATE
    JUCE_PLUGINHOST_VST3=1
    JUCE_PLUGINHOST_AU=1
    # CLAP hosting arrives in Phase 2 via clap-juce-extensions; for now
    # the scaffold scans VST3 + AU which cover ~95% of installed effects
    # on a typical macOS producer machine.
    JUCE_USE_CURL=0
    JUCE_WEB_BROWSER=0
    # v3.42 Phase 3: opens native plugin-editor windows. The REPL pumps
    # the message loop in ~20ms slices between stdin commands, which uses
    # `runDispatchLoopUntil` — gated behind this flag.
    JUCE_MODAL_LOOPS_PERMITTED=1)

target_link_libraries(pp-audio-host PRIVATE
    juce::juce_audio_utils
    juce::juce_audio_processors
    juce::juce_audio_formats
    juce::juce_core
    juce::juce_data_structures
    juce::juce_events
    juce::juce_recommended_config_flags
    juce::juce_recommended_lto_flags
    juce::juce_recommended_warning_flags)

# Drop the binary next to CMakeLists so the Electron packaging script can
# copy a stable relative path regardless of generator.
set_target_properties(pp-audio-host PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}/bin")
