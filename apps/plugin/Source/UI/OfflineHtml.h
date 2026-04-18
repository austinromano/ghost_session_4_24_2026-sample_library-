#pragma once

#include "JuceHeader.h"

// Standalone offline landing page embedded in the plugin binary.
// Shown via a data: URL when the production app URL cannot be reached.
// Auto-redirects to the live app once /health responds.
namespace GhostOffline
{
    inline const char* kHtml = R"HTML(<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ghost Session — Offline</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; height: 100%; }
  body {
    background: #0A0412;
    color: #fff;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  .wrap { text-align: center; max-width: 460px; padding: 24px; position: relative; z-index: 1; }
  .ghost { display: inline-block; margin-bottom: 28px; position: relative; animation: float 3.2s ease-in-out infinite; }
  .ghost::before {
    content: ""; position: absolute; inset: -20px;
    background: radial-gradient(circle, rgba(236,72,153,0.25) 0%, rgba(124,58,237,0.1) 50%, transparent 75%);
    filter: blur(24px); z-index: -1;
  }
  @keyframes float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
  h1 {
    font-size: 28px; font-weight: 700; letter-spacing: -0.02em;
    margin: 0 0 10px; line-height: 1.15;
  }
  .grad {
    background: linear-gradient(120deg,#EC4899 0%,#7C3AED 100%);
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }
  p { font-size: 15px; color: rgba(255,255,255,0.55); line-height: 1.55; margin: 0 auto 28px; max-width: 380px; }
  button {
    background: linear-gradient(135deg,#7C3AED 0%,#4C1D95 100%);
    color: white; border: 0; padding: 0 28px; height: 48px; border-radius: 24px;
    font-size: 15px; font-weight: 600; cursor: pointer;
    box-shadow: 0 4px 14px rgba(124,58,237,0.45), inset 0 1px 0 rgba(255,255,255,0.2), inset 0 0 0 1px rgba(255,255,255,0.08);
    transition: transform .15s ease, filter .15s ease;
  }
  button:hover { transform: scale(1.03); filter: brightness(1.08); }
  button:active { transform: scale(0.97); }
  .hint { font-size: 12px; color: rgba(255,255,255,0.3); margin-top: 24px; }
  .orb {
    position: fixed; pointer-events: none; border-radius: 50%; filter: blur(120px);
  }
  .orb-a {
    top: -160px; left: -160px; width: 420px; height: 420px;
    background: radial-gradient(circle, rgba(236,72,153,0.15) 0%, transparent 70%);
    animation: drift 14s ease-in-out infinite;
  }
  .orb-b {
    bottom: -180px; right: -160px; width: 440px; height: 440px;
    background: radial-gradient(circle, rgba(124,58,237,0.18) 0%, transparent 70%);
    animation: drift2 16s ease-in-out infinite;
  }
  @keyframes drift { 0%,100% { transform: translate(0,0); } 50% { transform: translate(30px,-15px); } }
  @keyframes drift2 { 0%,100% { transform: translate(0,0); } 50% { transform: translate(-24px,24px); } }
</style>
</head>
<body>
<div class="orb orb-a"></div>
<div class="orb orb-b"></div>
<div class="wrap">
  <div class="ghost">
    <svg width="110" height="120" viewBox="0 0 20 22" fill="none">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="20" y2="22" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#EC4899"/>
          <stop offset="100%" stop-color="#7C3AED"/>
        </linearGradient>
      </defs>
      <path d="M10 1C5.5 1 2 4.5 2 9v8l2-2 2 2 2-2 2 2 2-2 2 2 2-2 2 2V9c0-4.5-3.5-8-8-8z"
        fill="rgba(236,72,153,0.08)" stroke="url(#g)" stroke-width="1.4" stroke-linejoin="round"/>
      <g stroke="url(#g)" stroke-width="0.9" stroke-linecap="round">
        <line x1="6.3" y1="8.3" x2="8.7" y2="10.7"/>
        <line x1="8.7" y1="8.3" x2="6.3" y2="10.7"/>
        <line x1="11.3" y1="8.3" x2="13.7" y2="10.7"/>
        <line x1="13.7" y1="8.3" x2="11.3" y2="10.7"/>
      </g>
    </svg>
  </div>
  <h1>Oops — <span class="grad">you're offline</span></h1>
  <p>Looks like you aren't connected to the internet. Ghost Session needs a live connection to sync with your collaborators.</p>
  <button id="retry">Try again</button>
  <p class="hint">This screen disappears automatically when you reconnect.</p>
</div>
<script>
(function(){
  var PROD = 'https://ghost-session-beta-production.up.railway.app';
  var params = location.search || '?mode=plugin';
  function goLive(){ location.href = PROD + '/' + params; }
  function tryLive(){
    fetch(PROD + '/health', { cache: 'no-store', mode: 'cors' })
      .then(function(r){ if (r && r.ok) goLive(); })
      .catch(function(){});
  }
  document.getElementById('retry').addEventListener('click', tryLive);
  setInterval(tryLive, 5000);
  // First check shortly after render so the reload is snappy.
  setTimeout(tryLive, 1200);
})();
</script>
</body>
</html>
)HTML";

    /** Return a data: URL the WebView can navigate to. */
    inline juce::String toDataUrl()
    {
        juce::String html(kHtml);
        // data URLs don't need base64 if we URL-escape the HTML — simpler and keeps it debuggable.
        return "data:text/html;charset=utf-8," + juce::URL::addEscapeChars(html, false);
    }
}
