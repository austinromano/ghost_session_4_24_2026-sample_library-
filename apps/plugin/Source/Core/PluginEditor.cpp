#include "PluginEditor.h"
#include "GhostLog.h"

//==============================================================================
// DragStrip — native JUCE strip for dragging tracks to DAW
//==============================================================================

void DragStrip::setTracks(const juce::Array<TrackItem>& items)
{
    tracks = items;
    repaint();
}

void DragStrip::clear()
{
    tracks.clear();
    repaint();
}

int DragStrip::getTrackAt(int x) const
{
    if (tracks.isEmpty()) return -1;
    int itemW = getWidth() / tracks.size();
    if (itemW < 1) itemW = 1;
    int idx = x / itemW;
    return juce::jlimit(0, tracks.size() - 1, idx);
}

void DragStrip::paint(juce::Graphics& g)
{
    g.fillAll(juce::Colour(0xFF0A0412));

    if (tracks.isEmpty())
    {
        g.setColour(juce::Colour(0xFF6D6F78));
        g.setFont(juce::Font(11.0f));
        g.drawText("Click export to load tracks here for drag-to-DAW",
                   getLocalBounds(), juce::Justification::centred);
        return;
    }

    int itemW = getWidth() / tracks.size();
    for (int i = 0; i < tracks.size(); ++i)
    {
        auto bounds = juce::Rectangle<int>(i * itemW, 0, itemW, getHeight()).reduced(2);

        // Background
        g.setColour(juce::Colour(0xFF1a1a24));
        g.fillRoundedRectangle(bounds.toFloat(), 4.0f);
        g.setColour(juce::Colour(0xFF7C3AED).withAlpha(0.3f));
        g.drawRoundedRectangle(bounds.toFloat(), 4.0f, 1.0f);

        // Track name
        g.setColour(juce::Colours::white.withAlpha(0.8f));
        g.setFont(juce::Font(10.0f, juce::Font::bold));
        g.drawText(tracks[i].name, bounds.reduced(4, 0), juce::Justification::centredLeft);

        // Drag icon
        auto iconArea = bounds.removeFromRight(20);
        g.setColour(juce::Colour(0xFF00FFC8).withAlpha(0.6f));
        g.setFont(juce::Font(9.0f));
        g.drawText(juce::CharPointer_UTF8("\xe2\x87\xa7"), iconArea, juce::Justification::centred); // ⇧
    }
}

void DragStrip::mouseDown(const juce::MouseEvent& e)
{
    dragIndex = getTrackAt(e.x);
}

void DragStrip::mouseDrag(const juce::MouseEvent& e)
{
    if (dragIndex >= 0 && dragIndex < tracks.size()
        && e.getDistanceFromDragStart() > 4
        && tracks[dragIndex].file.existsAsFile())
    {
        GhostLog::write("[DragStrip] Dragging: " + tracks[dragIndex].file.getFullPathName());
        int idx = dragIndex;
        dragIndex = -1;
        juce::DragAndDropContainer::performExternalDragDropOfFiles(
            { tracks[idx].file.getFullPathName() }, false, this);
    }
}

//==============================================================================
// DragOverlay — native overlay that appears on top of a track for dragging
//==============================================================================

void DragOverlay::showForTrack(const juce::String& trackName, const juce::File& trackFile,
                               juce::Rectangle<int> bounds)
{
    name = trackName;
    file = trackFile;
    active = true;
    dragging = false;
    setBounds(bounds);
    setVisible(true);
    toFront(true);
    repaint();
    GhostLog::write("[DragOverlay] Showing for: " + trackName + " at " +
                    juce::String(bounds.getX()) + "," + juce::String(bounds.getY()) +
                    " " + juce::String(bounds.getWidth()) + "x" + juce::String(bounds.getHeight()));
}

void DragOverlay::dismiss()
{
    active = false;
    dragging = false;
    setVisible(false);
}

void DragOverlay::paint(juce::Graphics& g)
{
    if (!active) return;

    // Semi-transparent background with green border
    g.setColour(juce::Colour(0xDD0A0412));
    g.fillRoundedRectangle(getLocalBounds().toFloat(), 6.0f);
    g.setColour(juce::Colour(0xFF00FFC8));
    g.drawRoundedRectangle(getLocalBounds().toFloat().reduced(1.0f), 6.0f, 2.0f);

    // Track name
    g.setColour(juce::Colours::white);
    g.setFont(juce::Font(13.0f, juce::Font::bold));
    g.drawText(name, getLocalBounds().reduced(12, 0), juce::Justification::centredLeft);

    // "Drag to DAW" hint on right
    g.setColour(juce::Colour(0xFF00FFC8).withAlpha(0.8f));
    g.setFont(juce::Font(11.0f));
    g.drawText("Drag to DAW", getLocalBounds().reduced(12, 0), juce::Justification::centredRight);
}

void DragOverlay::mouseDown(const juce::MouseEvent& e)
{
    dragStart = e.getPosition();
    dragging = false;
}

void DragOverlay::mouseDrag(const juce::MouseEvent& e)
{
    if (!active || !file.existsAsFile()) return;
    if (!dragging && e.getDistanceFromDragStart() > 4)
    {
        dragging = true;
        GhostLog::write("[DragOverlay] Starting drag: " + file.getFullPathName());
        juce::DragAndDropContainer::performExternalDragDropOfFiles(
            { file.getFullPathName() }, false, this);
    }
}

void DragOverlay::mouseUp(const juce::MouseEvent&)
{
    if (!dragging)
        dismiss(); // Click without drag = dismiss
}

//==============================================================================
// GhostSessionEditor
//==============================================================================

GhostSessionEditor::GhostSessionEditor(GhostSessionProcessor& p)
    : AudioProcessorEditor(&p), proc(p)
{
    auto options = juce::WebBrowserComponent::Options()
        .withBackend(juce::WebBrowserComponent::Options::Backend::webview2)
        .withKeepPageLoadedWhenBrowserIsHidden()
        .withNativeIntegrationEnabled()
        .withUserAgent("GhostSession/2.0 JUCE-Plugin")
        .withNativeFunction("exportForDrag", [this](const juce::Array<juce::var>& args,
                                                     juce::WebBrowserComponent::NativeFunctionCompletion complete)
        {
            GhostLog::write("[Export] exportForDrag CALLED with " + juce::String(args.size()) + " args");

            if (args.isEmpty()) { complete(juce::var("no args")); return; }

            auto jsonStr = args[0].toString();
            GhostLog::write("[Export] JSON: " + jsonStr.substring(0, 200));

            auto parsed = juce::JSON::parse(jsonStr);
            if (!parsed.isArray())
            {
                GhostLog::write("[Export] Not an array, trying direct");
                complete(juce::var("bad json"));
                return;
            }

            auto* arr = parsed.getArray();
            GhostLog::write("[Export] Got " + juce::String(arr->size()) + " items");

            auto td = juce::File::getSpecialLocation(juce::File::tempDirectory).getChildFile("GhostSession");
            if (!td.exists()) td.createDirectory();

            // Download synchronously — blocks briefly but guarantees DragStrip shows
            juce::Array<DragStrip::TrackItem> downloaded;
            for (int i = 0; i < arr->size(); ++i)
            {
                auto url = (*arr)[i].getProperty("url", "").toString();
                auto name = (*arr)[i].getProperty("name", "").toString();
                if (url.isEmpty() || name.isEmpty()) continue;

                GhostLog::write("[Export] Downloading: " + name);
                auto destFile = td.getChildFile(name);
                if (!destFile.existsAsFile() || destFile.getSize() == 0)
                {
                    juce::URL u(url);
                    auto stream = u.createInputStream(
                        juce::URL::InputStreamOptions(juce::URL::ParameterHandling::inAddress)
                            .withConnectionTimeoutMs(30000));
                    if (stream)
                    {
                        juce::FileOutputStream fos(destFile);
                        if (fos.openedOk()) { fos.writeFromInputStream(*stream, -1); fos.flush(); }
                    }
                }

                if (destFile.existsAsFile() && destFile.getSize() > 0)
                {
                    GhostLog::write("[Export] Ready: " + name + " (" + juce::String(destFile.getSize()) + " bytes)");
                    downloaded.add({ name, destFile });
                }
            }

            GhostLog::write("[Export] Setting DragStrip with " + juce::String(downloaded.size()) + " stems");
            dragStrip.setTracks(downloaded);
            resized();

            complete(juce::var(downloaded.size()));
        })
        .withNativeFunction("prepareTrackDrag", [this](const juce::Array<juce::var>& args,
                                                      juce::WebBrowserComponent::NativeFunctionCompletion complete)
        {
            // Args: [{ url, name, x, y, width, height }]
            if (args.isEmpty()) { complete(juce::var(false)); return; }
            auto* obj = args[0].getDynamicObject();
            if (!obj) { complete(juce::var(false)); return; }

            auto url = obj->getProperty("url").toString();
            auto trackName = obj->getProperty("name").toString();
            int x = (int)obj->getProperty("x");
            int y = (int)obj->getProperty("y");
            int w = (int)obj->getProperty("width");
            int h = (int)obj->getProperty("height");

            if (url.isEmpty() || trackName.isEmpty()) { complete(juce::var(false)); return; }

            GhostLog::write("[PrepDrag] Track: " + trackName + " at " +
                            juce::String(x) + "," + juce::String(y));

            // Download file to temp
            auto tempDir = juce::File::getSpecialLocation(juce::File::tempDirectory)
                               .getChildFile("GhostSession");
            if (!tempDir.exists()) tempDir.createDirectory();

            auto fileName = trackName + ".wav";
            auto destFile = tempDir.getChildFile(fileName);

            if (!destFile.existsAsFile() || destFile.getSize() == 0)
            {
                GhostLog::write("[PrepDrag] Downloading: " + fileName);
                juce::URL downloadUrl(url);
                auto stream = downloadUrl.createInputStream(
                    juce::URL::InputStreamOptions(juce::URL::ParameterHandling::inAddress)
                        .withConnectionTimeoutMs(15000));
                if (stream)
                {
                    juce::FileOutputStream fos(destFile);
                    if (fos.openedOk()) { fos.writeFromInputStream(*stream, -1); fos.flush(); }
                }
            }

            if (destFile.existsAsFile() && destFile.getSize() > 0)
            {
                // Position overlay on top of the track in the WebView
                auto webBounds = webView->getBounds();
                auto overlayBounds = juce::Rectangle<int>(
                    webBounds.getX() + x, webBounds.getY() + y, w, h);

                juce::MessageManager::callAsync([this, trackName, destFile, overlayBounds]()
                {
                    dragOverlay.showForTrack(trackName, destFile, overlayBounds);
                });

                complete(juce::var(true));
            }
            else
            {
                complete(juce::var(false));
            }
        })
        .withUserScript(
            "function __ghostWaitForJuce(cb) {"
            "  if (window.__JUCE__ && window.__JUCE__.backend && window.__JUCE__.getNativeFunction) { cb(); return; }"
            "  var iv = setInterval(function() {"
            "    if (window.__JUCE__ && window.__JUCE__.backend && window.__JUCE__.getNativeFunction) { clearInterval(iv); cb(); }"
            "  }, 50);"
            "}"
            "__ghostWaitForJuce(function() {"
            "  var _exportFn = window.__JUCE__.getNativeFunction('exportForDrag');"
            "  var _dragFn = window.__JUCE__.getNativeFunction('prepareTrackDrag');"
            "  window.__ghostExportForDrag = function(items) {"
            "    _exportFn(JSON.stringify(items));"
            "  };"
            "  window.__ghostPrepareTrackDrag = function(info) {"
            "    _dragFn(JSON.stringify(info));"
            "  };"
            "  console.log('[GhostSession] Native drag functions ready');"
            "});"
        );

    webView = std::make_unique<GhostWebView>(options, p);

    // When a stem is downloaded via ghost://download-stem, add it to the DragStrip
    webView->onStemDownloaded = [this](const juce::String& name, const juce::File& file)
    {
        GhostLog::write("[Editor] Stem downloaded, adding to DragStrip: " + name);
        auto current = dragStrip.getTracks();
        current.add({ name, file });
        dragStrip.setTracks(current);
        resized();
    };

    addAndMakeVisible(*webView);
    addAndMakeVisible(dragStrip);
    addChildComponent(dragOverlay); // Hidden initially

    webView->goToURL(getAppUrl());

    setResizable(true, true);
    setResizeLimits(900, 500, 1920, 1200);
    setSize(1100, 720);
}

GhostSessionEditor::~GhostSessionEditor()
{
    if (webView)
    {
        webView->shutdown();
        removeChildComponent(webView.get());
        webView->setVisible(false);
    }
    webView = nullptr;
}

void GhostSessionEditor::paint(juce::Graphics& g)
{
    g.fillAll(juce::Colour(0xFF1A1A2E));

    if (!webView || !webView->isVisible())
    {
        g.setColour(juce::Colour(0xFF8B5CF6));
        g.setFont(juce::Font(18.0f));
        g.drawText("Welcome to Ghost Session",
                   getLocalBounds(), juce::Justification::centred);
    }
}

void GhostSessionEditor::resized()
{
    auto area = getLocalBounds();

    if (dragStrip.hasItems())
    {
        dragStrip.setBounds(area.removeFromBottom(36));
        dragStrip.setVisible(true);
    }
    else
    {
        dragStrip.setVisible(false);
    }

    if (webView)
        webView->setBounds(area);
}

juce::String GhostSessionEditor::getAppUrl() const
{
    juce::String url = "https://ghost-session-beta-production.up.railway.app";
    auto token = proc.getClient().getAuthToken();
    if (token.isNotEmpty())
        url += "?token=" + juce::URL::addEscapeChars(token, true) + "&mode=plugin";
    else
        url += "?mode=plugin";
    return url;
}
