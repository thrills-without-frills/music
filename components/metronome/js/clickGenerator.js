const ClickSoundGenerator = (function () {
    let audioContext = null;
    let soundBuffers = {};

    function init(context) {
        audioContext = context;
    }

    function createClick(frequency, duration, volume) {
        if (!audioContext) return null;

        const bufferSize = audioContext.sampleRate * duration;
        const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
        const data = buffer.getChannelData(0);

        for (let i = 0; i < bufferSize; i++) {
            const time = i / audioContext.sampleRate;
            data[i] = volume * Math.sin(2 * Math.PI * frequency * time);
        }

        return buffer;
    }

    function playClick(buffer, time) {
        if (!audioContext || !buffer) return;

        const source = audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(audioContext.destination);
        source.start(time);
    }

    function random(count, minFrequency, maxFrequency, minDuration, maxDuration, minVolume, maxVolume) {
        if (!audioContext) return;

        soundBuffers = {}; // Clear existing sounds

        for (let i = 1; i <= count; i++) {
            const frequency = minFrequency + Math.random() * (maxFrequency - minFrequency);
            const duration = minDuration + Math.random() * (maxDuration - minDuration);
            const volume = minVolume + Math.random() * (maxVolume - minVolume);

            soundBuffers[i] = createClick(frequency, duration, volume);
        }
    }

    function getBuffer(index) {
        return soundBuffers[index];
    }

    return {
        init: init,
        createClick: createClick,
        playClick: playClick,
        random: random,
        getBuffer: getBuffer
    };
})();