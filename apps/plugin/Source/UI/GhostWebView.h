#pragma once

#include "JuceHeader.h"
#include <map>

class GhostSessionProcessor;

//==============================================================================
class GhostWebView : public juce::WebBrowserComponent,
                     private juce::Timer
{
public:
    GhostWebView(const Options& options, GhostSessionProcessor& processor);
    ~GhostWebView() override;

    bool pageAboutToLoad(const juce::String& newURL) override;
    void shutdown() { stopTimer(); }

    /** Pre-cache a file to temp so drag-to-DAW is instant. */
    void precacheFile(const juce::String& downloadUrl, const juce::String& fileName);

    /** Called when a stem is downloaded via ghost://download-stem */
    std::function<void(const juce::String& name, const juce::File& file)> onStemDownloaded;

private:
    juce::File tempDir;
    GhostSessionProcessor& proc;
    bool exportProcessing = false;

    // Pre-cached file paths: downloadUrl -> local file
    std::map<juce::String, juce::File> fileCache;
    juce::CriticalSection cacheLock;

    void timerCallback() override;

    void handleDragToDaw(const juce::String& urlString);
    void handleStartRecording();
    void handleStopRecording();
    void handleUploadRecording(const juce::String& urlString);
    void handlePlayRecording();
    void handleStopPlayback();
    void handleWebMessage(const juce::String& message);

    juce::File downloadToTemp(const juce::String& downloadUrl, const juce::String& fileName);
    static juce::String getQueryParam(const juce::String& url, const juce::String& paramName);

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(GhostWebView)
};
