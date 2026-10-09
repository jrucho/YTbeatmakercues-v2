// Native, video-only local WebRTC feeds. BroadcastChannel carries signaling,
// never decoded frames. No STUN/TURN service or external media relay is used.
(function (root) {
  class LiveVJTransport {
    constructor(options) {
      this.options = options;
      this.id = options.id;
      this.peers = new Map();
      this.connections = new Map();
      this.videos = new Map();
      this.receiverId = null;
      this.running = false;
      this.sourceError = null;
      this.capture = null;
      this.captureVideo = null;
      this.captureSrc = null;
      this.statsBusy = false;
    }

    start() {
      if (this.running) return;
      this.running = true;
      this.channel = new BroadcastChannel('ytbm_vj_live_v2');
      this.channel.onmessage = (event) => this.receive(event.data).catch((error) => {
        this.connectionError = error.message;
        this.options.onUpdate?.();
      });
      this.timer = setInterval(() => this.tick(), 1500);
      this.tick();
    }

    send(message) {
      if (this.running) this.channel.postMessage({ ...message, from: this.id });
    }

    tick() {
      if (!this.running) return;
      const video = this.options.getVideo();
      const src = video?.currentSrc || video?.src || '';
      if (this.capture && (video !== this.captureVideo || src !== this.captureSrc ||
        !this.capture.getVideoTracks().some((track) => track.readyState === 'live'))) {
        this.releaseCapture();
        for (const [key, connection] of this.connections) if (connection.role === 'send') this.closeConnection(key);
      }
      if (video !== this.errorVideo || src !== this.errorSrc || Date.now() - (this.sourceErrorAt || 0) > 5000) this.sourceError = null;
      const info = {
        type: 'hello', priority: this.options.getPriority(), epoch: this.options.getEpoch?.() || 0,
        ready: !!video && video.readyState >= 2, paused: !!video?.paused,
        recording: !!this.options.getRecording?.(),
        sourceError: this.sourceError, limits: this.options.getLimits(), timestamp: Date.now()
      };
      this.peers.set(this.id, info);
      this.send(info);
      for (const [id, peer] of this.peers) {
        if (id !== this.id && Date.now() - peer.timestamp > 20000) {
          this.peers.delete(id);
          this.closeConnection('receive:' + id);
          this.closeConnection('send:' + id);
        }
      }
      this.elect();
      for (const connection of this.connections.values()) {
        if (connection.role !== 'send' || !connection.sender || connection.pc.signalingState !== 'stable') continue;
        const limits = this.peers.get(connection.remote)?.limits || {};
        const signature = `${limits.width || 960}:${limits.height || 540}`;
        if (signature !== connection.limitsSignature) {
          connection.limitsSignature = signature;
          this.configureSender(connection, limits).catch(() => {});
        }
      }
      if (this.isReceiver() || this.options.getRecording?.()) {
        const desired = (this.options.getSources?.() || [...this.peers.keys()]).slice(0, 8);
        for (const [key, connection] of this.connections) {
          if (connection.role === 'receive' && !desired.includes(connection.remote)) this.closeConnection(key);
        }
        for (const [id, peer] of this.peers) {
          if (id !== this.id && desired.includes(id) && peer.ready && !peer.sourceError) this.requestSource(id);
        }
      }
      this.collectStats();
      this.options.onUpdate?.();
    }

    elect() {
      const candidates = [...this.peers].filter(([, peer]) => peer.priority > 0);
      candidates.sort((a, b) => b[1].priority - a[1].priority || b[1].epoch - a[1].epoch || a[0].localeCompare(b[0]));
      const receiver = candidates[0]?.[0] || null;
      const changed = receiver !== this.receiverId;
      this.receiverId = receiver;
      for (const [key, connection] of this.connections) {
        if ((connection.role === 'receive' && receiver !== this.id && !this.options.getRecording?.()) ||
          (connection.role === 'send' && connection.remote !== receiver && !this.peers.get(connection.remote)?.recording)) this.closeConnection(key);
      }
      if (changed) this.options.onUpdate?.();
    }

    isReceiver() { return this.running && this.receiverId === this.id; }
    hasNativeSender() {
      return [...this.connections.values()].some((connection) =>
        connection.role === 'send' && connection.pc.connectionState === 'connected');
    }

    requestSource(id) {
      const key = 'receive:' + id;
      const existing = this.connections.get(key);
      if (existing && Date.now() - existing.createdAt < 12000 && existing.pc.connectionState !== 'failed') return;
      if (existing?.pc.connectionState === 'connected') return;
      if (existing) this.closeConnection(key);
      const session = this.id + ':' + Date.now() + ':' + Math.random().toString(36).slice(2);
      try { this.createConnection('receive', id, session); }
      catch (error) { this.connectionError = error.message; this.options.onUpdate?.(); return; }
      this.send({ type: 'request', to: id, session, limits: this.options.getLimits() });
    }

    createConnection(role, remote, session) {
      const key = role + ':' + remote;
      const pc = new RTCPeerConnection({ iceServers: [] });
      const connection = { pc, role, remote, session, createdAt: Date.now(), ice: [], chain: Promise.resolve(), lastFrameAt: Date.now() };
      this.connections.set(key, connection);
      pc.onicecandidate = (event) => {
        if (event.candidate) this.send({ type: 'ice', to: remote, role, session, candidate: event.candidate.toJSON() });
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed') this.closeConnection(key, connection);
        this.options.onUpdate?.();
      };
      if (role === 'receive') {
        pc.ontrack = (event) => {
          if (!this.running || this.connections.get(key) !== connection || event.track.kind !== 'video') return;
          // Local feeds do not need a deliberate network playout cushion.
          // This is only a hint; Chrome retains its codec/decoder requirements.
          try {
            if (event.receiver && 'jitterBufferTarget' in event.receiver) event.receiver.jitterBufferTarget = 0;
          } catch {}
          const video = document.createElement('video');
          video.muted = true;
          video.autoplay = true;
          video.playsInline = true;
          video.setAttribute('aria-hidden', 'true');
          video.className = 'ytbm-native-vj-feed';
          video.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-10px;top:-10px';
          video.srcObject = new MediaStream([event.track]);
          document.body.appendChild(video);
          video.play().catch(() => {});
          const previous = this.videos.get(remote);
          if (previous) { previous.video.pause(); previous.video.remove(); }
          this.videos.set(remote, { video, fps: 0, decoded: 0, dropped: 0, receivedAt: Date.now() });
          this.options.onUpdate?.();
        };
      }
      return connection;
    }

    getCapture() {
      const video = this.options.getVideo();
      if (!video || typeof video.captureStream !== 'function') throw new Error('Video captureStream unavailable');
      if (!this.capture) {
        this.capture = video.captureStream();
        this.captureVideo = video;
        this.captureSrc = video.currentSrc || video.src || '';
      }
      const track = this.capture.getVideoTracks().find((track) => track.readyState === 'live');
      if (!track) throw new Error('No live video capture track');
      return track;
    }

    async receive(message) {
      if (!this.running || !message || typeof message.from !== 'string' || message.from === this.id || (message.to && message.to !== this.id)) return;
      if (message.type === 'hello') {
        this.peers.set(message.from, { ...message, timestamp: Date.now() });
        this.elect();
        if ((this.isReceiver() || this.options.getRecording?.()) && message.ready && !message.sourceError &&
          (this.options.getSources?.() || [...this.peers.keys()]).slice(0, 8).includes(message.from)) this.requestSource(message.from);
        return;
      }
      if (message.type === 'bye') {
        this.peers.delete(message.from);
        this.closeConnection('receive:' + message.from);
        this.closeConnection('send:' + message.from);
        this.elect();
        return;
      }
      if (message.type === 'request') {
        if (message.from !== this.receiverId && !this.peers.get(message.from)?.recording) return;
        const key = 'send:' + message.from;
        const old = this.connections.get(key);
        if (old?.session === message.session) return;
        if (old) this.closeConnection(key);
        let connection;
        try {
          const track = this.getCapture();
          connection = this.createConnection('send', message.from, message.session);
          connection.sender = connection.pc.addTrack(track, this.capture);
          await connection.pc.setLocalDescription(await connection.pc.createOffer());
          if (this.connections.get(key) !== connection) return;
          await this.configureSender(connection, message.limits);
          this.send({ type: 'offer', to: message.from, session: message.session, description: connection.pc.localDescription.toJSON() });
        } catch (error) {
          this.sourceError = error.message;
          this.sourceErrorAt = Date.now();
          this.errorVideo = this.options.getVideo();
          this.errorSrc = this.errorVideo?.currentSrc || this.errorVideo?.src || '';
          this.closeConnection(key, connection);
          this.tick();
        }
        return;
      }
      const role = message.type === 'offer' ? 'receive' : (message.type === 'answer' ? 'send' : (message.role === 'send' ? 'receive' : 'send'));
      const connection = this.connections.get(role + ':' + message.from);
      if (!connection || connection.session !== message.session) return;
      if (message.type === 'disconnect') { this.closeConnection(role + ':' + message.from, connection); return; }
      connection.chain = connection.chain.then(async () => {
        if (!this.running || connection.pc.signalingState === 'closed') return;
        if (message.type === 'ice') {
          if (connection.pc.remoteDescription) await connection.pc.addIceCandidate(message.candidate);
          else connection.ice.push(message.candidate);
          return;
        }
        if (message.type !== 'offer' && message.type !== 'answer') return;
        await connection.pc.setRemoteDescription(message.description);
        for (const candidate of connection.ice.splice(0)) await connection.pc.addIceCandidate(candidate);
        if (message.type === 'offer') {
          await connection.pc.setLocalDescription(await connection.pc.createAnswer());
          this.send({ type: 'answer', to: message.from, session: message.session, description: connection.pc.localDescription.toJSON() });
        }
      }).catch(() => this.closeConnection(role + ':' + message.from, connection));
    }

    async configureSender(connection, limits = {}) {
      const parameters = connection.sender.getParameters();
      if (!parameters.encodings?.length) return;
      const video = this.options.getVideo();
      const scale = Math.max(1, (video?.videoWidth || 960) / (limits.width || 960), (video?.videoHeight || 540) / (limits.height || 540));
      for (const encoding of parameters.encodings) {
        encoding.maxFramerate = 30;
        encoding.maxBitrate = 3000000;
        encoding.scaleResolutionDownBy = scale;
      }
      await connection.sender.setParameters(parameters).catch(() => {});
    }

    async collectStats() {
      if ((!this.isReceiver() && !this.options.getRecording?.()) || this.statsBusy) return;
      this.statsBusy = true;
      try {
        for (const [key, connection] of this.connections) {
          if (connection.role !== 'receive' || connection.pc.connectionState !== 'connected') continue;
          const report = await connection.pc.getStats();
          report.forEach((stat) => {
            if (stat.type !== 'inbound-rtp' || (stat.kind || stat.mediaType) !== 'video') return;
            const feed = this.videos.get(connection.remote);
            if (!feed) return;
            const count = stat.framesDecoded || 0;
            if (count > feed.decoded) connection.lastFrameAt = Date.now();
            const previous = connection.lastStats;
            feed.fps = previous && stat.timestamp > previous.timestamp
              ? Math.max(0, (count - previous.count) * 1000 / (stat.timestamp - previous.timestamp)) : (stat.framesPerSecond || 0);
            feed.decoded = count;
            feed.dropped = stat.framesDropped || 0;
            feed.jitterBufferMs = stat.jitterBufferEmittedCount
              ? (stat.jitterBufferDelay || 0) * 1000 / stat.jitterBufferEmittedCount : 0;
            feed.receivedAt = connection.lastFrameAt;
            connection.lastStats = { count, timestamp: stat.timestamp };
          });
          if (!this.peers.get(connection.remote)?.paused && Date.now() - connection.lastFrameAt > 8000) this.closeConnection(key);
        }
      } catch {} finally {
        this.statsBusy = false;
        this.options.onUpdate?.();
      }
    }

    closeConnection(key, expected) {
      const connection = this.connections.get(key);
      if (!connection || (expected && expected !== connection)) return;
      this.connections.delete(key);
      if (this.running) this.send({ type: 'disconnect', to: connection.remote, role: connection.role, session: connection.session });
      connection.pc.onconnectionstatechange = null;
      connection.pc.ontrack = null;
      connection.pc.onicecandidate = null;
      connection.pc.close();
      if (connection.role === 'receive') {
        const feed = this.videos.get(connection.remote);
        if (feed) { feed.video.pause(); feed.video.srcObject = null; feed.video.remove(); }
        this.videos.delete(connection.remote);
      }
      if (connection.role === 'send' && ![...this.connections.values()].some((c) => c.role === 'send')) this.releaseCapture();
      this.options.onUpdate?.();
    }

    releaseCapture() {
      this.capture?.getTracks().forEach((track) => track.stop());
      this.capture = null;
      this.captureVideo = null;
      this.captureSrc = null;
    }

    stop() {
      if (!this.running) return;
      this.send({ type: 'bye' });
      this.running = false;
      clearInterval(this.timer);
      for (const key of [...this.connections.keys()]) this.closeConnection(key);
      this.releaseCapture();
      this.channel.close();
      this.peers.clear();
      this.receiverId = null;
    }
  }
  root.YTBMLiveVJ = LiveVJTransport;
  if (typeof module !== 'undefined' && module.exports) module.exports = LiveVJTransport;
})(typeof globalThis !== 'undefined' ? globalThis : window);
