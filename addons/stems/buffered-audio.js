/* Decode a contiguous prefix of the audio already buffered by the native
 * player, including SABR-delivered WebM/MP4. No signed song URL is needed. */
(function (root) {
  class BufferedAudioStore {
    constructor(decoder = bytes => new OfflineAudioContext(2, 1, 44100).decodeAudioData(bytes.buffer)) {
      this.entries = new Map(); this.decoder = decoder;
    }
    append(owner, id, packet, notify) {
      if (!Number.isInteger(packet.sequence) || packet.sequence < 0 || !(packet.bytes instanceof Uint8Array) ||
          !Number.isFinite(packet.end) || !Number.isFinite(packet.start) || packet.end < packet.start) throw new Error('Invalid buffered audio metadata');
      let entry = this.entries.get(owner);
      if (!entry || entry.id !== id || entry.stream !== packet.stream) {
        entry = { id, stream: packet.stream, chunks: [], bytes: 0, sequence: 0, revision: 0, notify };
        this.clear(owner); this.entries.set(owner, entry);
      }
      if (packet.sequence < entry.sequence) return;
      if (packet.gap || packet.start > 0.1 || packet.sequence !== entry.sequence) throw new Error('Buffered audio has a gap; retaining previously analysed sections');
      if (packet.duration > 600 || entry.bytes + packet.bytes.byteLength > 64 * 1024 * 1024) throw new Error('Buffered song exceeds the ten-minute / 64 MiB limit');
      entry.sequence++; entry.revision++;
      entry.chunks.push(packet.bytes); entry.bytes += packet.bytes.byteLength;
      entry.duration = packet.duration; entry.end = packet.end; entry.complete = packet.complete;
      entry.videoId = packet.videoId; entry.title = packet.title || entry.title || '';
      if (!entry.timer && !entry.decoding) entry.timer = setTimeout(() => { entry.timer = null; this.decode(owner, entry); }, 750);
    }
    async decode(owner, entry) {
      if (this.entries.get(owner) !== entry || entry.decoding) return;
      const revision = entry.revision;
      entry.decoding = true;
      const bytes = new Uint8Array(entry.bytes);
      let offset = 0;
      for (const chunk of entry.chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      try {
        const copy = this.downloads ? bytes.slice() : null;
        const audio = await this.decoder(bytes);
        if (this.entries.get(owner) !== entry) return;
        if (audio.sampleRate !== 44100 || !audio.length || audio.duration > 600) throw new Error('Invalid buffered audio decode');
        // Reject concatenated seek ranges instead of playing incorrectly timed audio.
        if (audio.duration > entry.end + 0.5) throw new Error('Buffered audio timestamps are discontinuous');
        if (!entry.audio || audio.length > entry.audio.length) entry.audio = audio;
        if (this.downloads && this.entries.get(owner) === entry) {
          entry.downloadPath = await this.downloads.save(`${owner}/buffer/${entry.id}`, { videoId: entry.videoId, title: entry.title,
            complete: !!entry.complete && Math.abs(audio.duration - entry.duration) < 0.25,
            decoded: true, loadedSeconds: audio.duration, expectedDuration: entry.duration }, copy);
        }
        if (this.entries.get(owner) !== entry) return;
        entry.error = null;
        entry.notify(this.info(entry));
      } catch (error) {
        entry.error = error.message;
        if (this.entries.get(owner) === entry) entry.notify(this.info(entry));
      }
      finally {
        entry.decoding = false;
        if (this.entries.get(owner) === entry && entry.revision !== revision) {
          entry.timer = setTimeout(() => { entry.timer = null; this.decode(owner, entry); }, 750);
        }
      }
    }
    info(entry) {
      return { stream: entry.stream, frames: entry.audio?.length || 0, duration: entry.audio?.duration || 0,
        songDuration: entry.duration || 0, complete: !!entry.audio && entry.complete && Math.abs(entry.audio.duration - entry.duration) < 0.25,
        encodedBytes: entry.bytes, error: entry.error || null };
    }
    segment(owner, id, stream, index) {
      const entry = this.entries.get(owner);
      if (!entry?.audio || entry.id !== id || entry.stream !== stream) throw new Error('Buffered audio source changed');
      const { SEG, HOP } = root.YTBMStemTimeline;
      const from = index * HOP;
      const validLength = Math.min(SEG, entry.audio.length - from);
      if (!Number.isInteger(index) || index < 0 || validLength <= 0 || (validLength < SEG && !this.info(entry).complete)) throw new Error('Buffered segment is not ready');
      const mix = new Float32Array(SEG * 2);
      mix.set(entry.audio.getChannelData(0).subarray(from, from + validLength));
      mix.set(entry.audio.getChannelData(Math.min(1, entry.audio.numberOfChannels - 1)).subarray(from, from + validLength), SEG);
      return { mix, validLength };
    }
    clear(owner, id) {
      const entry = this.entries.get(owner);
      if (!entry || (id && entry.id !== id)) return;
      if (entry.timer) clearTimeout(entry.timer);
      this.entries.delete(owner);
    }
    clearTab(tab) { for (const owner of [...this.entries.keys()]) if (owner.startsWith(tab + ':')) this.clear(owner); }
    clearAll() { for (const owner of [...this.entries.keys()]) this.clear(owner); }
  }
  root.YTBMBufferedAudioStore = { BufferedAudioStore };
  if (typeof module !== 'undefined') module.exports = root.YTBMBufferedAudioStore;
})(globalThis);
