/* Source discovery runs in the player's MAIN world, without changing playback. */
(function (root) {
  function discover(expectedVideoId, since = 0) {
    const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
    let response = null;
    try { response = document.getElementById('movie_player')?.getPlayerResponse?.() || window.ytInitialPlayerResponse; } catch {}
    const responses = [response, window.ytInitialPlayerResponse].filter(p => p && (!expectedVideoId || p.videoDetails?.videoId === expectedVideoId));
    if (responses.length) response = responses[0];
    const matches = !expectedVideoId || response?.videoDetails?.videoId === expectedVideoId;
    const duration = Number(response?.videoDetails?.lengthSeconds) || Number(video?.duration) || 0;
    if (matches && response?.videoDetails?.isLiveContent && !duration) return { sources: [], live: true };
    if (duration > 600) return { sources: [], tooLong: true };
    const sources = [];
    if (matches) {
      const formats = responses.flatMap(p => p.streamingData?.adaptiveFormats || []);
      for (const format of formats.filter(f => /^audio\//.test(f.mimeType || '')).sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))) {
        if (format.url) sources.push(format.url);
      }
    }
    // These are the actual signed URLs the player already requested, including
    // its signature/throttling parameters. No signature deciphering is attempted.
    const observed = [];
    for (const entry of performance.getEntriesByType('resource').slice().reverse()) {
      if (entry.startTime < since) continue;
      try {
        const url = new URL(entry.name);
        const audio = /^audio\//.test(url.searchParams.get('mime') || '') ||
          ['139','140','141','171','172','249','250','251','256','258','325','328','599','600'].includes(url.searchParams.get('itag'));
        if (url.protocol === 'https:' && /(^|\.)googlevideo\.com$/.test(url.hostname) &&
            audio && !url.searchParams.has('sq') && url.searchParams.get('ump') !== '1') observed.push(url.href);
      } catch {}
    }
    sources.unshift(...observed);
    const direct = video?.currentSrc || video?.src;
    if (direct && /^https:\/\//.test(direct) && !/googlevideo\.com/.test(direct)) sources.unshift(direct);
    return { sources: [...new Set(sources)].slice(0, 3), duration: Number.isFinite(duration) ? duration : 0,
      videoId: matches ? response?.videoDetails?.videoId || null : expectedVideoId || null,
      title: matches ? response?.videoDetails?.title || document.title || '' : document.title || '' };
  }
  root.YTBMTrackSource = { discover };
  if (typeof module !== 'undefined') module.exports = root.YTBMTrackSource;
})(globalThis);
