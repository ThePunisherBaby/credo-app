// audio-engine.js — Persistent Live Radio Stream Engine & Neural Human Voice Reader
// Plays 100% real audio streams (Aire 96 FM, Reflexionando la Palabra, Credo Radio Rosario 24/7,
// Rosary Mystery Repertoire, and Catholic Instrumental Music) with automatic stream failover
// + Media Session API + Sleep Timer + Neural Human Voice (es-DO-EmilioNeural) Gospel/Prayer Reader.

class CredoAudioEngine {
  constructor() {
    this.channel = null;
    this.playing = false;
    this.volume = 0.88;
    this.sleepMinutes = 0;
    this.sleepEndsAt = 0;
    this._sleepTimer = null;
    this._audioEl = null;
    this._ttsEl = null;
    this._listeners = new Set();
    this._gospelSpeaking = false;
    this._stallTimer = null;
    this._playToken = 0;
  }

  _ensureAudioEl() {
    if (!this._audioEl) {
      let el = document.getElementById('credoLiveAudio');
      if (!el) {
        el = document.createElement('audio');
        el.id = 'credoLiveAudio';
        el.preload = 'none';
        el.setAttribute('playsinline', '');
        el.style.display = 'none';
        document.body?.appendChild(el);
      }
      this._audioEl = el;
    }
    return this._audioEl;
  }

  _ensureTtsEl() {
    if (!this._ttsEl) {
      let el = document.getElementById('credoTtsAudio');
      if (!el) {
        el = document.createElement('audio');
        el.id = 'credoTtsAudio';
        el.preload = 'none';
        el.setAttribute('playsinline', '');
        el.style.display = 'none';
        document.body?.appendChild(el);
      }
      this._ttsEl = el;
    }
    return this._ttsEl;
  }

  _clearStallTimer() {
    if (this._stallTimer) {
      clearTimeout(this._stallTimer);
      this._stallTimer = null;
    }
  }

  _stopRealStream() {
    this._clearStallTimer();
    this._playToken += 1;
    if (this._audioEl) {
      try {
        this._audioEl.onplaying = null;
        this._audioEl.onerror = null;
        this._audioEl.onended = null;
        this._audioEl.pause();
      } catch {}
    }
  }

  _buildCandidateUrls(channel) {
    const list = [];
    const add = (u) => {
      if (u && !list.includes(u)) list.push(u);
    };
    add(channel?.stream_url);
    add(channel?.direct_stream_url);

    if (channel?.slug === 'aire-96' || channel?.slug === 'reflexionando-la-palabra') {
      add(`/api/v1/live/stream/${channel.slug}`);
      add('https://paginas.moisespaulino.com/proxy/moises2020/stream');
    } else if (channel?.slug === 'credo-rosario') {
      add('/api/v1/rosary/stream');
      add('/api/v1/rosary/audio/today');
    }
    return list;
  }

  _startChannelAudio(channel) {
    this._clearStallTimer();
    const token = ++this._playToken;
    const candidates = this._buildCandidateUrls(channel);
    if (candidates.length === 0) return;

    const el = this._ensureAudioEl();
    el.volume = this.volume;

    const tryCandidate = (idx) => {
      if (token !== this._playToken || !this.playing) return;
      if (idx >= candidates.length) {
        console.warn('[audio-engine] All stream candidates exhausted for', channel?.name);
        return;
      }

      const rawUrl = candidates[idx];
      // Add cache-buster only to live stream endpoints so browsers never serve a dead cached socket
      const isLiveStream = rawUrl.includes('/stream');
      const sep = rawUrl.includes('?') ? '&' : '?';
      const finalUrl = isLiveStream ? `${rawUrl}${sep}_t=${Date.now()}` : rawUrl;

      this._clearStallTimer();

      el.onplaying = () => {
        if (token !== this._playToken) return;
        this._clearStallTimer();
      };

      el.onerror = () => {
        if (token !== this._playToken) return;
        this._clearStallTimer();
        console.warn('[audio-engine] Stream candidate failed, trying next:', rawUrl);
        tryCandidate(idx + 1);
      };

      // Loop on-demand Rosary / Music tracks seamlessly when they finish
      el.onended = () => {
        if (token !== this._playToken || !this.playing) return;
        try {
          el.currentTime = 0;
          el.play().catch(() => {});
        } catch {}
      };

      // If stream hasn't started playing within 6.5s and there is a fallback candidate, switch
      if (idx + 1 < candidates.length) {
        this._stallTimer = setTimeout(() => {
          if (token === this._playToken && this.playing && (el.paused || el.readyState < 2)) {
            console.warn('[audio-engine] Stream candidate stalled, switching to fallback:', candidates[idx + 1]);
            tryCandidate(idx + 1);
          }
        }, 6500);
      }

      try {
        el.src = finalUrl;
        const p = el.play();
        if (p && typeof p.catch === 'function') {
          p.catch((err) => {
            if (token !== this._playToken) return;
            console.warn('[audio-engine] play() rejected on candidate', rawUrl, err.message);
            if (idx + 1 < candidates.length) {
              tryCandidate(idx + 1);
            }
          });
        }
      } catch (err) {
        if (idx + 1 < candidates.length) {
          tryCandidate(idx + 1);
        }
      }
    };

    tryCandidate(0);
  }

  subscribe(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _emit() {
    const snap = this.getState();
    for (const fn of this._listeners) {
      try {
        fn(snap);
      } catch (err) {
        console.error('[audio-engine]', err);
      }
    }
  }

  getState() {
    return {
      channel: this.channel,
      playing: this.playing,
      sleepMinutes: this.sleepMinutes,
      sleepEndsAt: this.sleepEndsAt,
      gospelSpeaking: this._gospelSpeaking,
    };
  }

  playChannel(channel) {
    if (!channel) return;
    this.stopGospelSpeech();

    // If this exact stream is already actively playing, keep it playing without interruption
    if (
      this.playing &&
      this.channel &&
      this.channel.id === channel.id &&
      this.channel.stream_url === channel.stream_url &&
      this._audioEl &&
      !this._audioEl.paused
    ) {
      this.channel = channel;
      this._emit();
      return;
    }

    this.channel = channel;
    this.playing = true;
    this._startChannelAudio(channel);
    this._updateMediaSession(channel, true);
    this._emit();
  }

  togglePlay() {
    if (!this.channel) return;
    if (this.playing) {
      this.playing = false;
      this._stopRealStream();
      this._updateMediaSession(this.channel, false);
    } else {
      this.stopGospelSpeech();
      this.playing = true;
      this._startChannelAudio(this.channel);
      this._updateMediaSession(this.channel, true);
    }
    this._emit();
  }

  stop() {
    this.playing = false;
    this.channel = null;
    this.setSleepTimer(0);
    this._stopRealStream();
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.playbackState = 'none';
      } catch {}
    }
    this._emit();
  }

  setSleepTimer(minutes) {
    if (this._sleepTimer) {
      clearTimeout(this._sleepTimer);
      this._sleepTimer = null;
    }
    this.sleepMinutes = Number(minutes) || 0;
    if (this.sleepMinutes > 0) {
      this.sleepEndsAt = Date.now() + this.sleepMinutes * 60 * 1000;
      this._sleepTimer = setTimeout(() => {
        if (this.playing) this.togglePlay();
        this.sleepMinutes = 0;
        this.sleepEndsAt = 0;
        this._emit();
      }, this.sleepMinutes * 60 * 1000);
    } else {
      this.sleepEndsAt = 0;
    }
    this._emit();
  }

  _updateMediaSession(channel, isPlaying) {
    if (!('mediaSession' in navigator) || !channel) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: channel.current_program || channel.name,
        artist: `${channel.name} · EN VIVO`,
        album: 'Credo · Radio Católica y Santo Rosario',
        artwork: channel.cover_url
          ? [{ src: channel.cover_url, sizes: '512x512', type: 'image/png' }]
          : [],
      });
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
      navigator.mediaSession.setActionHandler('play', () => {
        if (!this.playing) this.togglePlay();
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        if (this.playing) this.togglePlay();
      });
      navigator.mediaSession.setActionHandler('stop', () => this.stop());
    } catch {}
  }

  toggleGospelSpeech(text, lang = 'es') {
    if (this._gospelSpeaking) {
      this.stopGospelSpeech();
      return false;
    }
    if (this.playing) this.togglePlay();

    const clean = String(text || '').trim().slice(0, 3200);
    if (!clean) return false;

    const ttsEl = this._ensureTtsEl();
    ttsEl.volume = this.volume;
    ttsEl.onended = () => {
      this._gospelSpeaking = false;
      this._emit();
    };
    ttsEl.onerror = () => {
      // Fallback to browser SpeechSynthesis only if neural endpoint is unreachable
      if ('speechSynthesis' in window) {
        try {
          window.speechSynthesis.cancel();
          const utter = new SpeechSynthesisUtterance(clean);
          const langMap = { es: 'es-DO', en: 'en-US', it: 'it-IT', pt: 'pt-BR', fr: 'fr-FR' };
          utter.lang = langMap[lang] || 'es-DO';
          utter.rate = 0.95;
          utter.onend = () => { this._gospelSpeaking = false; this._emit(); };
          utter.onerror = () => { this._gospelSpeaking = false; this._emit(); };
          window.speechSynthesis.speak(utter);
          return;
        } catch {}
      }
      this._gospelSpeaking = false;
      this._emit();
    };

    this._gospelSpeaking = true;
    this._emit();
    ttsEl.src = `/api/v1/rosary/tts?text=${encodeURIComponent(clean)}`;
    ttsEl.play().catch(() => {
      ttsEl.onerror?.();
    });
    return true;
  }

  stopGospelSpeech() {
    if (this._ttsEl) {
      try {
        this._ttsEl.onended = null;
        this._ttsEl.onerror = null;
        this._ttsEl.pause();
      } catch {}
    }
    if ('speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {}
    }
    if (this._gospelSpeaking) {
      this._gospelSpeaking = false;
      this._emit();
    }
  }
}

export const audioEngine = new CredoAudioEngine();
