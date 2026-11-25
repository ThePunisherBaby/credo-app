// audio-engine.js — Persistent Live Radio Stream Engine, MediaSession + Native Media Notification & Human Voice
// Plays real Catholic streams, Rosary & Instrumental Music playlists with automatic failover
// + Universal Media Session API + Android Native Media Notification + Natural Spanish TTS.

const BIBLE_BOOK_SPOKEN = {
  Gn: 'Génesis', Ex: 'Éxodo', Lv: 'Levítico', Nm: 'Números', Dt: 'Deuteronomio',
  Jos: 'Josué', Jue: 'Jueces', Rt: 'Rut', '1Sm': 'Primera de Samuel', '2Sm': 'Segunda de Samuel',
  '1Re': 'Primera de los Reyes', '2Re': 'Segunda de los Reyes', Is: 'Isaías', Jr: 'Jeremías',
  Ez: 'Ezequiel', Dn: 'Daniel', Sal: 'Salmo', Pr: 'Proverbios', Sab: 'Sabiduría',
  Eclo: 'Eclesiástico', Mt: 'Mateo', Mc: 'Marcos', Lc: 'Lucas', Jn: 'Juan',
  Hch: 'Hechos de los Apóstoles', Rm: 'Romanos', '1Co': 'Primera a los Corintios',
  '2Co': 'Segunda a los Corintios', Ga: 'Gálatas', Ef: 'Efesios', Flp: 'Filipenses',
  Col: 'Colosenses', '1Ts': 'Primera a los Tesalonicenses', '2Ts': 'Segunda a los Tesalonicenses',
  '1Tm': 'Primera a Timoteo', '2Tm': 'Segunda a Timoteo', Hb: 'Hebreos',
  St: 'Santiago', '1Pe': 'Primera de Pedro', '2Pe': 'Segunda de Pedro',
  '1Jn': 'Primera de Juan', Ap: 'Apocalipsis',
};

export function cleanSpeechText(raw) {
  let s = String(raw || '')
    .normalize('NFC')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/[•·|│┃■□◆◇★☆✦✝🙏🕊️📿🕯️🎶🎵📻▶️🔊]/g, ', ');

  s = s.replace(/\b(?:VERDE|BLANCO|ROJO|MORADO|ROSADO)\b(?:\s*\n|\s*$)/g, '');
  s = s.replace(/(^|\s)R\/\.?\s*/gm, '$1Respuesta: ');
  s = s.replace(/(^|\s)V\/\.?\s*/gm, '$1Versículo: ');
  s = s.replace(/\bPbro\.\s*/gi, 'Presbítero ');
  s = s.replace(/\bMons\.\s*/gi, 'Monseñor ');
  s = s.replace(/\bNtra\.\s*Sra\.\s*/gi, 'Nuestra Señora ');
  s = s.replace(/\bSto\.\s*/gi, 'Santo ');
  s = s.replace(/\bSta\.\s*/gi, 'Santa ');
  s = s.replace(/\bS\.?\s*S\.?\s+/g, 'Su Santidad ');
  s = s.replace(/\b(\d{1,2}):00\s*(?:a\.?\s*m\.?|am)\b/gi, '$1 de la mañana');
  s = s.replace(/\b(\d{1,2}):00\s*(?:p\.?\s*m\.?|pm)\b/gi, (_, h) => (Number(h) >= 7 ? `${h} de la noche` : `${h} de la tarde`));

  s = s.replace(/\b(Gn|Ex|Lv|Nm|Dt|Jos|Jue|Rt|1Sm|2Sm|1Re|2Re|Is|Jr|Ez|Dn|Sal|Pr|Sab|Eclo|Mt|Mc|Lc|Jn|Hch|Rm|1Co|2Co|Ga|Ef|Flp|Col|1Ts|2Ts|1Tm|2Tm|Hb|St|1Pe|2Pe|1Jn|Ap)\s+(\d{1,3})\s*[,/]\s*(\d{1,3}[a-c]?)(?:[-–.]\d{1,3}[a-c]?)*\b/gi, (_, bk, ch, v) => {
    const found = Object.keys(BIBLE_BOOK_SPOKEN).find((k) => k.toLowerCase() === bk.toLowerCase());
    const name = found ? BIBLE_BOOK_SPOKEN[found] : bk;
    return `${name}, capítulo ${ch}, versículo ${v}`;
  });

  s = s.replace(/\b([IVXLCDM]{2,6})\b/g, (m) => {
    const map = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
    let total = 0;
    for (let i = 0; i < m.length; i++) {
      const cur = map[m[i]] || 0;
      const nxt = map[m[i + 1]] || 0;
      total += cur < nxt ? -cur : cur;
    }
    return total > 0 && total <= 50 ? String(total) : m;
  });

  s = s
    .replace(/\s*\/\s*/g, ', ')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n+/g, ', ')
    .replace(/\.{2,}/g, '.')
    .replace(/([,;:])\s*[.;,]+/g, '$1 ')
    .replace(/\s+\./g, '.')
    .replace(/\s+,/g, ',')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return s;
}

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
    this._speechMeta = null;
    this._externalMedia = null;
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
    } else if (channel?.slug === 'credo-rosario' || channel?.category === 'rosary') {
      add('/api/v1/rosary/audio/today');
    } else if (channel?.slug === 'credo-musica-oracion') {
      add('/api/v1/rosary/music');
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
      speechMeta: this._speechMeta,
      externalMedia: this._externalMedia,
    };
  }

  _pushNativeMediaNotification(payload) {
    try {
      window.CredoNative?.updateMediaNotification?.(JSON.stringify(payload));
    } catch {}
  }

  _syncMediaSessionActions(mode) {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.setActionHandler('play', () => this.handleNativeMediaAction('play'));
      navigator.mediaSession.setActionHandler('pause', () => this.handleNativeMediaAction('pause'));
      navigator.mediaSession.setActionHandler('stop', () => this.handleNativeMediaAction('stop'));
    } catch {}
  }

  playChannel(channel) {
    if (!channel) return;
    this.stopGospelSpeech();
    this._externalMedia = null;

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
    if (!this.channel && this._gospelSpeaking) {
      this.stopGospelSpeech();
      return;
    }
    if (!this.channel) return;
    if (this.playing) {
      this.playing = false;
      this._stopRealStream();
      this._updateMediaSession(this.channel, false);
    } else {
      this.stopGospelSpeech();
      this._externalMedia = null;
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
    this._externalMedia = null;
    if (!this._gospelSpeaking) {
      if ('mediaSession' in navigator) {
        try {
          navigator.mediaSession.playbackState = 'none';
        } catch {}
      }
      this._pushNativeMediaNotification({ playing: false, clear: true });
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
    if (!channel) return;
    const title = channel.current_program || channel.name || 'Credo';
    const artist = channel.is_live ? `${channel.name} · EN VIVO` : (channel.subtitle || channel.name || 'Credo Católica');
    const album = 'Credo · Oración y Radio Católica';
    const coverUrl = channel.cover_url || '/icons/credo-192.png';

    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title,
          artist,
          album,
          artwork: [{ src: coverUrl, sizes: '512x512', type: 'image/png' }],
        });
        navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
        this._syncMediaSessionActions('channel');
      } catch {}
    }

    this._pushNativeMediaNotification({
      title,
      artist,
      album,
      coverUrl,
      playing: !!isPlaying,
      source: 'channel',
    });
  }

  _updateSpeechMediaSession(isPlaying) {
    const meta = this._speechMeta || {
      title: 'Lectura Orante',
      artist: 'Credo · Voz Humana',
      cover_url: '/icons/art_gospel.png',
    };
    const album = 'Credo · Evangelio y Oraciones';
    const coverUrl = meta.cover_url || '/icons/art_gospel.png';

    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: meta.title,
          artist: meta.artist,
          album,
          artwork: [{ src: coverUrl, sizes: '512x512', type: 'image/png' }],
        });
        navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'none';
        this._syncMediaSessionActions('tts');
      } catch {}
    }

    this._pushNativeMediaNotification({
      title: meta.title,
      artist: meta.artist,
      album,
      coverUrl,
      playing: !!isPlaying,
      clear: !isPlaying,
      source: 'tts',
    });
  }

  notifyExternalMedia({ title, artist, coverUrl, playing = true, onAction = null } = {}) {
    if (!playing) {
      this._externalMedia = null;
      if (!this.playing && !this._gospelSpeaking) {
        if ('mediaSession' in navigator) {
          try { navigator.mediaSession.playbackState = 'none'; } catch {}
        }
        this._pushNativeMediaNotification({ playing: false, clear: true });
      }
      this._emit();
      return;
    }

    if (this.playing) this.togglePlay();
    if (this._gospelSpeaking) this.stopGospelSpeech();

    const cleanTitle = String(title || 'Video Católico').slice(0, 90);
    const cleanArtist = String(artist || 'Credo · Vids').slice(0, 90);
    const art = coverUrl || '/icons/credo-192.png';
    this._externalMedia = { title: cleanTitle, artist: cleanArtist, coverUrl: art, playing: true, onAction };

    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: cleanTitle,
          artist: cleanArtist,
          album: 'Credo · Videos',
          artwork: [{ src: art, sizes: '512x512', type: 'image/png' }],
        });
        navigator.mediaSession.playbackState = 'playing';
        this._syncMediaSessionActions('video');
      } catch {}
    }

    this._pushNativeMediaNotification({
      title: cleanTitle,
      artist: cleanArtist,
      album: 'Credo · Videos',
      coverUrl: art,
      playing: true,
      source: 'video',
    });
    this._emit();
  }

  handleNativeMediaAction(action) {
    const act = String(action || '').toLowerCase();
    if (this._externalMedia?.onAction) {
      try {
        this._externalMedia.onAction(act);
      } catch {}
      if (act === 'stop') this.notifyExternalMedia({ playing: false });
      return;
    }
    if (this._gospelSpeaking) {
      if (act === 'pause' || act === 'stop' || act === 'toggle') this.stopGospelSpeech();
      return;
    }
    if (this.channel) {
      if (act === 'play' && !this.playing) this.togglePlay();
      else if (act === 'pause' && this.playing) this.togglePlay();
      else if (act === 'toggle') this.togglePlay();
      else if (act === 'stop') this.stop();
    }
  }

  toggleGospelSpeech(text, lang = 'es', meta = null) {
    if (this._gospelSpeaking) {
      this.stopGospelSpeech();
      return false;
    }
    if (this.playing) this.togglePlay();
    this._externalMedia = null;

    const clean = cleanSpeechText(text).slice(0, 3200);
    if (!clean) return false;

    this._speechMeta = meta || {
      title: 'Palabra y Oración',
      artist: 'Credo · Voz Humana',
      cover_url: '/icons/art_gospel.png',
    };

    const ttsEl = this._ensureTtsEl();
    ttsEl.volume = this.volume;
    ttsEl.onended = () => {
      this._gospelSpeaking = false;
      this._speechMeta = null;
      this._updateSpeechMediaSession(false);
      this._emit();
    };
    ttsEl.onerror = () => {
      if ('speechSynthesis' in window) {
        try {
          window.speechSynthesis.cancel();
          const utter = new SpeechSynthesisUtterance(clean);
          const langMap = { es: 'es-DO', en: 'en-US', it: 'it-IT', pt: 'pt-BR', fr: 'fr-FR' };
          utter.lang = langMap[lang] || 'es-DO';
          utter.rate = 0.95;
          utter.onend = () => {
            this._gospelSpeaking = false;
            this._speechMeta = null;
            this._updateSpeechMediaSession(false);
            this._emit();
          };
          utter.onerror = () => {
            this._gospelSpeaking = false;
            this._speechMeta = null;
            this._updateSpeechMediaSession(false);
            this._emit();
          };
          window.speechSynthesis.speak(utter);
          return;
        } catch {}
      }
      this._gospelSpeaking = false;
      this._speechMeta = null;
      this._updateSpeechMediaSession(false);
      this._emit();
    };

    this._gospelSpeaking = true;
    this._updateSpeechMediaSession(true);
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
    const wasSpeaking = this._gospelSpeaking;
    this._gospelSpeaking = false;
    this._speechMeta = null;
    if (wasSpeaking) {
      this._updateSpeechMediaSession(false);
      this._emit();
    }
  }
}

export const audioEngine = new CredoAudioEngine();
window.__CREDO_AUDIO__ = audioEngine;

