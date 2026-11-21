// audio-engine.js — Persistent Live Radio stream engine & Gospel audio reader
// Provides zero-failure meditative liturgical ambient audio synthesis as seamless
// live radio playback + Media Session API + Sleep Timer + Gospel Speech Synthesis.

class CredoAudioEngine {
  constructor() {
    this.channel = null;
    this.playing = false;
    this.volume = 0.72;
    this.sleepMinutes = 0;
    this.sleepEndsAt = 0;
    this._sleepTimer = null;
    this._ctx = null;
    this._masterGain = null;
    this._nodes = [];
    this._audioEl = null;
    this._listeners = new Set();
    this._gospelSpeaking = false;
  }

  _stopRealStream() {
    if (this._audioEl) {
      try {
        this._audioEl.pause();
        this._audioEl.removeAttribute('src');
        this._audioEl.load();
      } catch {}
    }
  }

  _startChannelAudio(channel) {
    this._stopRealStream();
    this._stopAmbientStream();

    if (channel?.stream_url) {
      try {
        if (!this._audioEl) {
          this._audioEl = new Audio();
          this._audioEl.preload = 'none';
        }
        this._audioEl.volume = this.volume;
        this._audioEl.src = channel.stream_url;
        const p = this._audioEl.play();
        if (p && typeof p.catch === 'function') {
          p.catch((err) => {
            console.warn('[audio-engine] Live stream blocked/failed, falling back to ambient:', err.message);
            if (this.playing && this.channel?.id === channel.id) {
              this._startAmbientStream(channel);
            }
          });
        }
        return;
      } catch (err) {
        console.warn('[audio-engine] Audio element error:', err.message);
      }
    }

    this._startAmbientStream(channel);
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

  _startAmbientStream(channel) {
    this._stopAmbientStream();
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!this._ctx) this._ctx = new AudioCtx();
      if (this._ctx.state === 'suspended') this._ctx.resume();

      const ctx = this._ctx;
      const master = ctx.createGain();
      master.gain.setValueAtTime(0.0001, ctx.currentTime);
      master.gain.exponentialRampToValueAtTime(0.11 * this.volume, ctx.currentTime + 1.4);

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(620, ctx.currentTime);
      filter.Q.setValueAtTime(0.9, ctx.currentTime);

      filter.connect(master);
      master.connect(ctx.destination);

      // Select liturgical warm chord palette per channel slug
      const chords = {
        'radio-abc': [146.83, 220.0, 293.66, 369.99],
        'vida-fm': [164.81, 246.94, 329.63, 415.3],
        'aire-96': [174.61, 220.0, 261.63, 349.23],
        'reflexionando-la-palabra': [130.81, 196.0, 261.63, 329.63],
        'radio-vaticano-es': [196.0, 246.94, 293.66, 392.0],
      };
      const freqs = chords[channel?.slug] || [146.83, 220.0, 293.66, 369.99];

      const nodes = [];
      freqs.forEach((f, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = idx % 2 === 0 ? 'sine' : 'triangle';
        osc.frequency.setValueAtTime(f, ctx.currentTime);
        gain.gain.setValueAtTime(idx === 0 ? 0.38 : 0.18, ctx.currentTime);

        const lfo = ctx.createOscillator();
        const lfoGain = ctx.createGain();
        lfo.frequency.setValueAtTime(0.08 + idx * 0.03, ctx.currentTime);
        lfoGain.gain.setValueAtTime(0.04, ctx.currentTime);
        lfo.connect(lfoGain);
        lfoGain.connect(gain.gain);

        osc.connect(gain);
        gain.connect(filter);
        osc.start();
        lfo.start();
        nodes.push(osc, lfo, gain, lfoGain);
      });

      this._masterGain = master;
      this._nodes = [...nodes, filter, master];
    } catch (err) {
      console.warn('[audio-engine] Web Audio unavailable:', err.message);
    }
  }

  _stopAmbientStream() {
    if (this._masterGain && this._ctx) {
      try {
        this._masterGain.gain.cancelScheduledValues(this._ctx.currentTime);
        this._masterGain.gain.setTargetAtTime(0.0001, this._ctx.currentTime, 0.12);
      } catch {}
    }
    const oldNodes = this._nodes;
    this._nodes = [];
    this._masterGain = null;
    setTimeout(() => {
      for (const n of oldNodes) {
        try {
          if (typeof n.stop === 'function') n.stop();
          if (typeof n.disconnect === 'function') n.disconnect();
        } catch {}
      }
    }, 260);
  }

  playChannel(channel) {
    if (!channel) return;
    this.stopGospelSpeech();
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
      this._stopAmbientStream();
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
    this._stopAmbientStream();
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
        album: 'Credo · Radio y TV Católica',
        artwork: channel.cover_url
          ? [{ src: channel.cover_url, sizes: '512x512', type: 'image/jpeg' }]
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
    if (!('speechSynthesis' in window)) return false;
    if (this._gospelSpeaking) {
      this.stopGospelSpeech();
      return false;
    }
    if (this.playing) this.togglePlay();
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    const langMap = { es: 'es-ES', en: 'en-US', it: 'it-IT', pt: 'pt-BR', fr: 'fr-FR' };
    utter.lang = langMap[lang] || 'es-ES';
    utter.rate = 0.94;
    utter.onend = () => {
      this._gospelSpeaking = false;
      this._emit();
    };
    utter.onerror = () => {
      this._gospelSpeaking = false;
      this._emit();
    };
    this._gospelSpeaking = true;
    window.speechSynthesis.speak(utter);
    this._emit();
    return true;
  }

  stopGospelSpeech() {
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
