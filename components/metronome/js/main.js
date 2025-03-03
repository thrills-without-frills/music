const Metronome = (function () {
    let config = {
        timeSignature: [4, 4],
        tempo: 120,
        clickSounds: {},
        audioContext: null,
        useGeneratedSounds: false,
        scheduleAheadTime: 0.5,
        lookaheadMs: 25,
    };

    const ClickSoundGenerator = window.ClickSoundGenerator || {
        random: function(beats, minFreq, maxFreq, minDuration, maxDuration, minGain, maxGain) {
            this.buffers = {};
            for (let i = 1; i <= beats; i++) {
                const freq = i === 1 ? maxFreq : minFreq;
                const duration = i === 1 ? maxDuration : minDuration;
                const gain = i === 1 ? maxGain : minGain;
                this.generateBuffer(i, freq, duration, gain);
            }
        },
        generateBuffer: function(position, freq, duration, gain) {
            if (!config.audioContext) return null;
            const sampleRate = config.audioContext.sampleRate;
            const buffer = config.audioContext.createBuffer(1, sampleRate * duration, sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < buffer.length; i++) {
                const t = i / sampleRate;
                data[i] = Math.sin(2 * Math.PI * freq * t) * gain * Math.exp(-t / (duration / 3));
            }
            this.buffers[position] = buffer;
            return buffer;
        },
        getBuffer: function(position) {
            return this.buffers[position] || null;
        },
        buffers: {}
    };

    let beatCount = 0;
    let measureCount = 0;
    let nextNoteTime = 0;
    let audioBuffers = {};
    let events = new Map();
    let isRunning = false;
    let secondsPerBeat = 0;
    let notesInQueue = [];
    let timerWorker = null;
    let gainNode = null;

    function ensureAudioContext() {
        if (!config.audioContext) {
            config.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        } else if (config.audioContext.state === 'suspended') {
            config.audioContext.resume();
        }
        if (!gainNode && config.audioContext) {
            gainNode = config.audioContext.createGain();
            gainNode.connect(config.audioContext.destination);
        }
        return config.audioContext;
    }

    function createWorker() {
        if (timerWorker) {
            timerWorker.terminate();
        }
        const workerString = `let timerID = null; let interval = 25; self.onmessage = function(e) { if (e.data.action === "start") { timerID = setInterval(() => self.postMessage({ action: "tick" }), interval); } else if (e.data.action === "stop") { clearInterval(timerID); timerID = null; } else if (e.data.action === "interval") { interval = e.data.interval; if (timerID) { clearInterval(timerID); timerID = setInterval(() => self.postMessage({ action: "tick" }), interval); } } };`;
        const blob = new Blob([workerString], { type: 'application/javascript' });
        timerWorker = new Worker(URL.createObjectURL(blob));
        timerWorker.onerror = (error) => console.error('Worker error:', error);
        return timerWorker;
    }

    function loadAudio(url, beatPosition) {
        ensureAudioContext();
        return fetch(url)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! Status: ${response.status}`);
                }
                return response.arrayBuffer();
            })
            .then(arrayBuffer => config.audioContext.decodeAudioData(arrayBuffer))
            .then(buffer => {
                const position = parseInt(beatPosition, 10) || beatPosition;
                audioBuffers[position] = buffer;
                return buffer;
            })
            .catch(error => {
                console.error('Audio loading error:', error, 'URL:', url);
                return null;
            });
    }

    function scheduleNote(beat, time) {
        notesInQueue.push({ beat, time });
        const sound = audioBuffers[beat];
        if (sound) {
            try {
                ensureAudioContext();
                const source = config.audioContext.createBufferSource();
                source.buffer = sound;
                source.connect(gainNode);
                source.start(time);
                trigger('beat', beat);
                if (beat === 1) {
                    trigger('measure', measureCount);
                }
            } catch (error) {
                console.error('Error scheduling note:', error);
            }
        }
    }

    function scheduler() {
        if (!isRunning) return;
        while (notesInQueue.length && notesInQueue[0].time < config.audioContext.currentTime) {
            notesInQueue.shift();
        }
        while (nextNoteTime < config.audioContext.currentTime + config.scheduleAheadTime) {
            scheduleNote(beatCount, nextNoteTime);
            nextNoteTime += secondsPerBeat;
            beatCount++;
            if (beatCount > config.timeSignature[0]) {
                beatCount = 1;
                measureCount++;
            }
        }
    }

    function prepareAudioBuffers() {
        audioBuffers = {};
        let loadPromises = [];
        if (config.useGeneratedSounds) {
            ClickSoundGenerator.random(config.timeSignature[0], 440, 1760, 0.05, 0.15, 0.3, 0.7);
            for (let i = 1; i <= config.timeSignature[0]; i++) {
                const buffer = ClickSoundGenerator.getBuffer(i);
                if (buffer) {
                    audioBuffers[i] = buffer;
                }
            }
            return Promise.resolve();
        } else {
            loadPromises = Object.entries(config.clickSounds).map(([pos, url]) => loadAudio(url, pos));
            return Promise.all(loadPromises);
        }
    }

    function start(userConfig = {}) {
        if (isRunning) {
            stop();
        }
        config = { ...config, ...userConfig };
        ensureAudioContext();
        beatCount = 1;
        measureCount = 0;
        secondsPerBeat = 60.0 / config.tempo;
        if (!timerWorker) {
            createWorker();
        }
        timerWorker.onmessage = (e) => {
            if (e.data.action === "tick" && isRunning) {
                scheduler();
            }
        };
        timerWorker.postMessage({ action: "interval", interval: config.lookaheadMs });
        prepareAudioBuffers()
            .then(() => {
                notesInQueue = [];
                nextNoteTime = config.audioContext.currentTime + 0.05;
                isRunning = true;
                timerWorker.postMessage({ action: "start" });
                trigger('start');
            })
            .catch(error => {
                console.error('Failed to start metronome:', error);
                isRunning = false;
            });
    }

    function pause() {
        if (!isRunning) return;
        timerWorker.postMessage({ action: "stop" });
        isRunning = false;
        trigger('pause');
    }

    function stop() {
        if (!isRunning) return;
        timerWorker.postMessage({ action: "stop" });
        beatCount = 1;
        measureCount = 0;
        isRunning = false;
        notesInQueue = [];
        trigger('stop');
    }

    function on(eventName, callback) {
        if (!events.has(eventName)) {
            events.set(eventName, []);
        }
        events.get(eventName).push(callback);
        return () => off(eventName, callback);
    }

    function off(eventName, callback) {
        if (events.has(eventName)) {
            const callbacks = events.get(eventName);
            events.set(eventName, callbacks.filter(cb => cb !== callback));
        }
    }

    function trigger(eventName, data) {
        if (events.has(eventName)) {
            events.get(eventName).forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`Error in ${eventName} event handler:, error`);
                }
            });
        }
    }

    function setTempo(bpm) {
        if (bpm <= 0) return;
        config.tempo = bpm;
        secondsPerBeat = 60.0 / config.tempo;
        if (isRunning) {
            nextNoteTime = config.audioContext.currentTime + 0.05;
        }
    }

    function setTimeSignature(timeSig) {
        if (!Array.isArray(timeSig) || timeSig.length !== 2) return;
        const wasRunning = isRunning;
        const needsRestart = wasRunning && (beatCount > timeSig[0] || config.useGeneratedSounds);
        if (needsRestart) {
            pause();
        }
        config.timeSignature = timeSig;
        if (beatCount > config.timeSignature[0]) {
            beatCount = 1;
        }
        if (config.useGeneratedSounds) {
            prepareAudioBuffers();
        }
        if (needsRestart) {
            start();
        }
    }

    function setClickSounds(clickSounds) {
        const wasRunning = isRunning;
        if (wasRunning) {
            pause();
        }
        config.clickSounds = clickSounds;
        config.useGeneratedSounds = false;
        prepareAudioBuffers().then(() => {
            if (wasRunning) {
                start(config);
            }
        });
    }

    function useGeneratedClickSounds() {
        const wasRunning = isRunning;
        if (wasRunning) {
            pause();
        }
        config.useGeneratedSounds = true;
        prepareAudioBuffers().then(() => {
            if (wasRunning) {
                start(config);
            }
        });
    }

    function setVolume(level) {
        if (!gainNode) return;
        level = Math.max(0, Math.min(1, level));
        gainNode.gain.value = level;
    }

    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible' && isRunning && config.audioContext?.state === 'suspended') {
            config.audioContext.resume();
        }
    });

    window.addEventListener('beforeunload', function () {
        if (timerWorker) {
            timerWorker.postMessage({ action: "stop" });
            timerWorker.terminate();
            timerWorker = null;
        }
    });

    return {
        start: start,
        pause: pause,
        stop: stop,
        on: on,
        off: off,
        setTempo: setTempo,
        setTimeSignature: setTimeSignature,
        setClickSounds: setClickSounds,
        useGeneratedClickSounds: useGeneratedClickSounds,
        setVolume: setVolume,
        getConfig: () => ({...config}),
        isRunning: () => isRunning,
    };
})();