/* Kazla networking: messages go through public MQTT relays (works on any network,
 * no direct device-to-device connection needed), end-to-end encrypted with
 * ECDH (P-256) + AES-GCM so the relay and other listeners can't read hands. */
(function () {
  "use strict";
  const BROKERS = ["wss://broker.emqx.io:8084/mqtt", "wss://broker.hivemq.com:8884/mqtt"];
  const ROOT = "kazla/v2/";

  function brokerList() {
    const b = new URLSearchParams(location.search).get("broker");
    return b ? [b] : BROKERS;
  }
  const rand = n => { const a = new Uint8Array(n); crypto.getRandomValues(a); return [...a].map(x => x.toString(16).padStart(2, "0")).join(""); };
  const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

  async function genKeys() {
    return crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveKey"]);
  }
  async function exportPub(k) { return b64(await crypto.subtle.exportKey("raw", k)); }
  async function derive(priv, pubB64) {
    const pub = await crypto.subtle.importKey("raw", unb64(pubB64), { name: "ECDH", namedCurve: "P-256" }, false, []);
    return crypto.subtle.deriveKey({ name: "ECDH", public: pub }, priv, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function encrypt(key, obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
    return { iv: b64(iv), ct: b64(ct) };
  }
  async function decrypt(key, p) {
    try {
      const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(p.iv) }, key, unb64(p.ct));
      return JSON.parse(new TextDecoder().decode(pt));
    } catch (e) { return null; }
  }
  function parse(buf) { try { return JSON.parse(buf.toString()); } catch (e) { return null; } }
  function supported() { return typeof mqtt !== "undefined" && window.crypto && crypto.subtle; }

  /**
   * Host a room. handlers: onMessage(link, msg), onClose(link), onStatus(connected:boolean)
   * link: { cid, open, send(msg), seat? }
   */
  async function host(code, handlers) {
    const keys = await genKeys();
    const pub = await exportPub(keys.publicKey);
    const links = new Map();
    const infoTopic = ROOT + code + "/info";
    const clients = brokerList().map(url => {
      const c = mqtt.connect(url, {
        clientId: "kzh_" + rand(6), clean: true, reconnectPeriod: 2000, connectTimeout: 10000, keepalive: 30,
        will: { topic: infoTopic, payload: "", retain: true, qos: 1 }
      });
      c.on("connect", () => {
        c.subscribe(ROOT + code + "/h", { qos: 1 });
        c.publish(infoTopic, JSON.stringify({ pub, v: 2 }), { retain: true, qos: 1 });
        handlers.onStatus && handlers.onStatus(true, url);
      });
      c.on("offline", () => handlers.onStatus && handlers.onStatus(clients.some(x => x.connected), url));
      c.on("message", async (topic, buf) => {
        const m = parse(buf);
        if (!m || typeof m.cid !== "string" || !m.p) return;
        let link = links.get(m.cid);
        if (m.pub && (!link || link.pubKey !== m.pub || link.client !== c)) {
          const key = await derive(keys.privateKey, m.pub);
          const old = link;
          link = {
            cid: m.cid, key, pubKey: m.pub, client: c, open: true,
            send(msg) { encrypt(key, msg).then(p => c.publish(ROOT + code + "/c/" + m.cid, JSON.stringify(p), { qos: 1 })); }
          };
          if (old && typeof old.seat === "number") link.seat = old.seat;
          links.set(m.cid, link);
        }
        if (!link) return;
        const msg = await decrypt(link.key, m.p);
        if (!msg) return;
        if (msg.t === "bye") { link.open = false; handlers.onClose && handlers.onClose(link); return; }
        if (msg.t === "ping") return;
        handlers.onMessage(link, msg);
      });
      return c;
    });
    return {
      connected: () => clients.some(c => c.connected),
      close() {
        clients.forEach(c => { try { c.publish(infoTopic, "", { retain: true, qos: 1 }, () => c.end()); } catch (e) {} });
      }
    };
  }

  /**
   * Join a room. handlers: onOpen(), onMessage(msg), onError(kind) kind: "no-room" | "unreachable", onHostGone()
   * returns { send(msg), close() }
   */
  async function join(code, cid, handlers) {
    const keys = await genKeys();
    const pub = await exportPub(keys.publicKey);
    let chosen = null, key = null, opened = false, done = false;
    const infoTopic = ROOT + code + "/info", myTopic = ROOT + code + "/c/" + cid;
    const queue = [];

    async function sendRaw(msg, withPub) {
      if (!chosen || !key) { queue.push(msg); return; }
      const p = await encrypt(key, msg);
      chosen.publish(ROOT + code + "/h", JSON.stringify(withPub ? { cid, pub, p } : { cid, p }), { qos: 1 });
    }

    const clients = brokerList().map(url => {
      const c = mqtt.connect(url, { clientId: "kzc_" + rand(6), clean: true, reconnectPeriod: 2000, connectTimeout: 10000, keepalive: 30 });
      c.on("connect", () => {
        c.subscribe([infoTopic, myTopic], { qos: 1 });
        if (chosen === c && key && handlers.onReconnect) handlers.onReconnect();
      });
      c.on("message", async (topic, buf) => {
        if (topic === infoTopic) {
          const info = parse(buf);
          if (!info || !info.pub) { if (chosen === c && opened) handlers.onHostGone && handlers.onHostGone(); return; }
          if (chosen && chosen !== c) return;
          if (!chosen) {
            chosen = c;
            clients.forEach(o => { if (o !== c) try { o.end(true); } catch (e) {} });
          }
          key = await derive(keys.privateKey, info.pub);
          if (!opened) { opened = true; handlers.onOpen && handlers.onOpen(); }
          else handlers.onReconnect && handlers.onReconnect();
          while (queue.length) sendRaw(queue.shift(), true);
          return;
        }
        if (topic === myTopic && c === chosen && key) {
          const p = parse(buf);
          const msg = p && await decrypt(key, p);
          if (msg) handlers.onMessage(msg);
        }
      });
      return c;
    });

    setTimeout(() => {
      if (opened || done) return;
      handlers.onError && handlers.onError(clients.some(c => c.connected) ? "no-room" : "unreachable");
    }, 12000);
    const ping = setInterval(() => { if (opened) sendRaw({ t: "ping" }); }, 20000);

    return {
      send: (msg, withPub) => sendRaw(msg, withPub),
      close() {
        done = true; clearInterval(ping);
        if (opened) sendRaw({ t: "bye" }).finally(() => setTimeout(() => clients.forEach(c => { try { c.end(); } catch (e) {} }), 300));
        else clients.forEach(c => { try { c.end(true); } catch (e) {} });
      }
    };
  }

  window.KazlaNet = { host, join, supported, rand };
})();
