/* Kazla: lobby, networking (host is authoritative, see net.js), and UI. */
(function () {
  "use strict";
  const E = window.KozelEngine;
  const $ = id => document.getElementById(id);
  const BROKER_Q = new URLSearchParams(location.search).get("broker") ? "broker=" + encodeURIComponent(new URLSearchParams(location.search).get("broker")) : "";
  const RED = s => s === "♥" || s === "♦";
  const FACE = r => r === "J" || r === "Q" || r === "K";

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };
  let token = store.get("kozel-token", null);
  if (!token) { token = Math.random().toString(36).slice(2) + Date.now().toString(36); store.set("kozel-token", token); }

  const app = {
    role: null,          // "host" | "client"
    seat: null,          // my seat index
    code: null,
    net: null,
    online: false,
    conns: [],           // host: per seat connection
    seats: [],           // host: [{name, kind: host|remote|bot|empty, token, online}]
    cfg: { n: 2, teams: true, target: 12 },
    state: null,         // host only
    lobby: null,         // last lobby info (both roles)
    view: null,          // last game view
    selected: new Set(),
    botTimer: null,
    dealTimer: null,
    offlineTimer: null
  };

  /* ---------- helpers ---------- */
  function toast(msg) {
    const t = $("toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 2600);
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  const C = window.KazlaCards;
  document.body.insertAdjacentHTML("afterbegin", C.sprite());
  document.documentElement.style.setProperty("--back", `url("${C.BACK}")`);
  const RUNAME = { A: "ace", K: "king", Q: "queen", J: "jack" };
  // \uFE0E asks for the plain text symbol, not the emoji, so ♥ stays a card suit on phones
  const sym = x => `<span class="sym ${RED(x) ? "red" : ""}">${x}\uFE0E</span>`;
  function cardHTML(c, size, extra, style) {
    size = size || "";
    const st = style ? ` style="${style}"` : "";
    if (c === "back") return `<div class="card back ${size} ${extra || ""}"${st} role="img" aria-label="face-down card"></div>`;
    const s = c.slice(-1), r = c.slice(0, -1);
    const isT = app.view && app.view.trump === s;
    const cls = ["card", size, isT ? "trump" : "", extra || ""].join(" ");
    const label = (RUNAME[r] || r) + " of " + E.suitName(s) + (isT ? ", trump" : "");
    return `<div class="${cls}" data-card="${c}"${st} role="img" aria-label="${label}">${C.svg(c)}</div>`;
  }

  /* ---------- motion helpers ---------- */
  const RM = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  function center(r) { return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
  /** Animate an element from where `from` (a rect) is to where it now sits. */
  function flyIn(el, from, delay, rot) {
    if (RM || !from || !el.animate) return;
    const to = el.getBoundingClientRect();
    if (!to.width) return;
    const a = center(from), b = center(to);
    const end = getComputedStyle(el).transform;
    const sc = Math.max(.35, Math.min(1.6, from.width / to.width));
    el.animate([
      { transform: `translate(${a.x - b.x}px, ${a.y - b.y}px) scale(${sc}) rotate(${rot == null ? -14 : rot}deg)`, opacity: .9 },
      { transform: end === "none" ? "none" : end, opacity: 1 }
    ], { duration: 460, delay: delay || 0, easing: "cubic-bezier(.2,.8,.2,1)", fill: "backwards" });
  }
  /** A card back that flies from one rect to another and disappears (deal / draw for others). */
  function ghost(from, to, delay, cw) {
    if (RM || !from || !to || !document.body.animate) return;
    const g = document.createElement("div");
    g.className = "card back fly";
    g.style.setProperty("--cw", cw + "px");
    const a = center(from), b = center(to);
    g.style.left = (a.x - cw / 2) + "px"; g.style.top = (a.y - cw * .7) + "px";
    document.body.appendChild(g);
    const anim = g.animate([
      { transform: "translate(0,0) rotate(0deg)", opacity: 0 },
      { transform: "translate(0,0) rotate(0deg)", opacity: 1, offset: .1 },
      { transform: `translate(${b.x - a.x}px, ${b.y - a.y}px) rotate(${(Math.random() * 30 - 15).toFixed(0)}deg) scale(.7)`, opacity: .15 }
    ], { duration: 560, delay: delay || 0, easing: "cubic-bezier(.3,.7,.3,1)", fill: "both" });
    anim.onfinish = () => g.remove();
  }
  function deckRect() { const d = document.querySelector("#g-deckpile .stack .card:last-child") || $("g-deckpile"); return d && d.getBoundingClientRect(); }
  function seatRect(p) {
    if (app.view && p === app.view.me) return $("g-hand").getBoundingClientRect();
    const el = document.querySelector(`.opp[data-seat="${p}"] .backs`) || document.querySelector(`.opp[data-seat="${p}"]`);
    return el && el.getBoundingClientRect();
  }
  let current = "home", portraitOk = false;
  function show(screen) { current = screen; ["home", "room", "game"].forEach(id => { $(id).hidden = id !== screen; }); layout(); }
  function layout() {
    const wide = window.innerWidth > window.innerHeight;
    const inGame = current === "game";
    document.body.classList.toggle("land", inGame && wide);
    $("rotate").hidden = !(inGame && !wide && !portraitOk && window.innerWidth < 760);
  }
  window.addEventListener("resize", layout);
  window.addEventListener("orientationchange", () => setTimeout(layout, 200));
  function cfgText(c) {
    const who = c.n === 4 ? (c.teams ? "4 players in two pairs" : "4 players, everyone alone") : c.n + " players";
    const len = c.target === 1 ? "one deal" : "first to " + c.target + " bad points is the goat";
    return who + " · " + len;
  }
  function makeCode() {
    const A = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    let s = ""; for (let i = 0; i < 5; i++) s += A[Math.floor(Math.random() * A.length)];
    return s;
  }
  function inviteLink(code) {
    return location.origin + location.pathname + "?room=" + code + (BROKER_Q ? "&" + BROKER_Q : "");
  }

  /* ---------- home screen ---------- */
  (function heroFan() {
    const cards = ["J♣", "Q♥", "K♠", "A♦"];
    $("hero-fan").innerHTML = cards.map((c, i) => {
      const k = i - 1.5;
      return cardHTML(c, "", "", `transform:translateX(-50%) rotate(${k * 13}deg) translateY(${Math.abs(k) * 6}px);animation-delay:${i * 0.12}s`);
    }).join("");
  })();
  const GOAT = `<svg viewBox="0 0 64 64" aria-hidden="true"><g fill="none" stroke="#b3121f" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
    <path d="M25 20C20 10 12 7 6 9c6 1 10 6 12 13"/><path d="M39 20c5-10 13-13 19-11-6 1-10 6-12 13"/>
    <path d="M18 24l-9 3 8 4M46 24l9 3-8 4"/>
    <path d="M20 24c2-6 22-6 24 0l-3 18c-1 6-5 9-9 9s-8-3-9-9z" fill="#fbf6ea"/>
    <path d="M28 50l4 10 4-10"/><circle cx="26" cy="31" r="1.6" fill="#b3121f"/><circle cx="38" cy="31" r="1.6" fill="#b3121f"/>
    <path d="M29 43h6"/></g></svg>`;
  $("name").value = store.get("kozel-name", "");
  $("name").addEventListener("input", () => store.set("kozel-name", $("name").value.trim()));
  function myName() { return ($("name").value.trim() || "Player").slice(0, 16); }

  function bindSeg(id, key, parse) {
    const el = $(id);
    el.addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b) return;
      app.cfg[key] = parse(b.dataset.v); renderCfg();
    });
  }
  bindSeg("cfg-n", "n", v => +v);
  bindSeg("cfg-teams", "teams", v => v === "1");
  bindSeg("cfg-target", "target", v => +v);
  function renderCfg() {
    const c = app.cfg;
    $("cfg-n").querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", +b.dataset.v === c.n));
    $("cfg-teams").querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", (b.dataset.v === "1") === c.teams));
    $("cfg-target").querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", +b.dataset.v === c.target));
    $("cfg-teams-row").hidden = c.n !== 4;
    $("cfg-hint").textContent = cfgText(c) + ".";
  }
  renderCfg();

  const params = new URLSearchParams(location.search);
  if (params.get("room")) { $("join-code").value = params.get("room").toUpperCase(); }

  $("create").onclick = () => hostCreate();
  $("join").onclick = () => clientJoin($("join-code").value.trim().toUpperCase());
  $("join-code").addEventListener("keydown", e => { if (e.key === "Enter") $("join").click(); });

  /* ================= HOST ================= */
  function hostCreate() {
    store.set("kozel-name", myName());
    app.role = "host"; app.seat = 0;
    const c = app.cfg;
    app.seats = Array(c.n).fill(null).map((_, i) => i === 0
      ? { name: myName(), kind: "host", token, online: true }
      : { name: "", kind: "empty", token: null, online: false });
    app.conns = Array(c.n).fill(null);
    app.code = makeCode();
    show("room");
    renderRoom();
    startHostPeer();
  }

  async function startHostPeer() {
    if (!window.KazlaNet || !KazlaNet.supported()) { setOffline("Online play isn't available in this browser. You can still play against bots."); return; }
    try {
      app.net = await KazlaNet.host(app.code, {
        onMessage: hostOnMessage,
        onClose: hostOnClose,
        onStatus: up => {
          const was = app.online;
          app.online = up || app.net && app.net.connected();
          if (app.online) { $("room-warn").hidden = true; clearTimeout(app.offlineTimer); }
          if (app.online && !was && app.state) broadcastAll(); // resend everything after a reconnect
          renderRoom();
        }
      });
      app.offlineTimer = setTimeout(() => { if (!app.online) setOffline("Still trying to go online… Check your internet connection. You can play against bots meanwhile."); }, 12000);
    } catch (e) { setOffline("Couldn't go online. You can still play against bots."); }
  }
  function setOffline(msg) { app.online = false; $("room-warn").textContent = msg; $("room-warn").hidden = false; renderRoom(); }

  function lobbyInfo() {
    return { code: app.code, cfg: app.cfg, seats: app.seats.map(s => ({ name: s.name, kind: s.kind, online: s.online })), started: !!app.state };
  }
  function send(conn, msg) { try { if (conn && conn.open) conn.send(msg); } catch (e) {} }

  function hostOnMessage(conn, msg) {
    if (!msg || typeof msg !== "object") return;
    if (msg.t === "join") {
      const name = String(msg.name || "Player").slice(0, 16);
      let idx = app.seats.findIndex(s => s.token && s.token === msg.token);
      if (idx < 0) {
        if (app.state) { send(conn, { t: "reject", reason: "The game has already started." }); return; }
        idx = app.seats.findIndex(s => s.kind === "empty");
        if (idx < 0) { send(conn, { t: "reject", reason: "The room is full." }); return; }
      }
      const seat = app.seats[idx];
      if (seat.kind === "host") { send(conn, { t: "reject", reason: "You're already the host in another tab." }); return; }
      if (seat.kind !== "bot") { seat.kind = "remote"; seat.name = name; }
      seat.token = msg.token; seat.online = true;
      app.conns[idx] = conn; conn.seat = idx;
      send(conn, { t: "welcome", seat: idx });
      if (app.state) { app.state.players[idx].name = seat.name; }
      broadcastAll();
      return;
    }
    if (msg.t === "act" && typeof conn.seat === "number") {
      hostDispatch(conn.seat, msg.a);
    }
  }
  function hostOnClose(conn) {
    const idx = conn.seat;
    if (typeof idx !== "number" || app.conns[idx] !== conn) return;
    app.conns[idx] = null;
    const seat = app.seats[idx];
    seat.online = false;
    if (!app.state) { seat.kind = "empty"; seat.name = ""; seat.token = null; }
    broadcastAll();
  }

  function broadcastAll() {
    const lobby = lobbyInfo();
    app.lobby = lobby;
    app.conns.forEach((c, i) => {
      if (!c) return;
      send(c, { t: "lobby", lobby });
      if (app.state) send(c, { t: "view", view: E.viewFor(app.state, i) });
    });
    if (app.state) { app.view = E.viewFor(app.state, 0); show("game"); renderGame(); }
    else renderRoom();
  }

  function hostStart() {
    app.seats.forEach((s, i) => { if (s.kind === "empty") { s.kind = "bot"; s.name = "Bot " + (i + 1); s.online = true; } });
    newGame();
  }
  function newGame() {
    app.state = E.createGame({ players: app.seats.map(s => ({ name: s.name, bot: s.kind === "bot" })), teams: app.cfg.teams, target: app.cfg.target });
    app.selected.clear();
    tick();
  }

  function hostDispatch(seat, a) {
    const s = app.state;
    if (!s || !a) return;
    try {
      if (a.type === "next") {
        if (seat !== 0) return;
        if (s.phase === "dealEnd") E.startDeal(s);
        else if (s.phase === "gameOver") { newGame(); return; }
        else return;
      } else {
        E.apply(s, seat, a);
      }
    } catch (err) {
      if (seat === 0) toast(err.message); else send(app.conns[seat], { t: "error", msg: err.message });
      return;
    }
    tick();
  }

  function tick() {
    broadcastAll();
    const s = app.state;
    clearTimeout(app.botTimer); clearTimeout(app.dealTimer);
    if (s.phase === "picked") {
      app.dealTimer = setTimeout(() => { if (app.state === s && s.phase === "picked") { E.startDeal(s); tick(); } }, 3200);
      return;
    }
    const w = E.waitingOn(s);
    const botSeat = w.find(i => s.players[i].bot);
    if (botSeat !== undefined) {
      app.botTimer = setTimeout(() => {
        if (app.state !== s) return;
        const a = E.botAction(s, botSeat);
        if (a) { try { E.apply(s, botSeat, a); } catch (e) { console.warn("bot", e); } }
        tick();
      }, s.phase === "pick" ? 700 : (s.phase === "lead" && s.lastTurn && s.turn.plays.length === 0) ? 2800 : 1400);
    }
  }

  /* ================= CLIENT ================= */
  async function clientJoin(code) {
    if (!/^[A-Z]{5}$/.test(code)) { $("join-msg").textContent = "Enter the 5-letter code from the host."; return; }
    if (!window.KazlaNet || !KazlaNet.supported()) { $("join-msg").textContent = "The online part didn't load. Check your internet connection and reload the page."; return; }
    store.set("kozel-name", myName());
    app.role = "client"; app.code = code;
    $("join-msg").textContent = "Connecting…";
    $("join").disabled = true;
    const hello = () => app.net.send({ t: "join", name: myName(), token }, true);
    try {
      app.net = await KazlaNet.join(code, KazlaNet.rand(8), {
        onOpen: () => { $("join-msg").textContent = "Found the room. Joining…"; hello(); },
        onReconnect: () => hello(),
        onMessage: clientOnMessage,
        onHostGone: () => toast("The host went offline. Waiting for them to come back…"),
        onError: kind => {
          $("join").disabled = false;
          $("join-msg").textContent = kind === "no-room"
            ? "No open room with code " + code + ". Check the code, and make sure the host's page is still open."
            : "Couldn't reach the game server. Check your internet connection, or try switching between Wi-Fi and mobile data.";
        }
      });
    } catch (e) { $("join").disabled = false; $("join-msg").textContent = "Couldn't connect: " + e.message; }
  }
  function clientOnMessage(msg) {
    if (!msg || typeof msg !== "object") return;
    if (msg.t === "welcome") { app.seat = msg.seat; $("join-msg").textContent = ""; $("join").disabled = false; history.replaceState(null, "", "?room=" + app.code + (BROKER_Q ? "&" + BROKER_Q : "")); }
    else if (msg.t === "reject") { $("join-msg").textContent = msg.reason; $("join").disabled = false; show("home"); }
    else if (msg.t === "lobby") { app.lobby = msg.lobby; if (!msg.lobby.started) { show("room"); renderRoom(); } }
    else if (msg.t === "view") { app.view = msg.view; show("game"); renderGame(); }
    else if (msg.t === "error") toast(msg.msg);
  }

  /* ---------- actions from the UI ---------- */
  function act(a) {
    if (app.role === "host") hostDispatch(0, a);
    else if (app.net) app.net.send({ t: "act", a });
  }

  /* ---------- room screen ---------- */
  function renderRoom() {
    const isHost = app.role === "host";
    const L = isHost ? lobbyInfo() : app.lobby;
    if (!L) return;
    $("room-code").textContent = L.code;
    $("room-link").textContent = inviteLink(L.code);
    $("room-cfg").textContent = cfgText(L.cfg) + ".";
    $("seats").innerHTML = L.seats.map((s, i) => {
      const team = L.cfg.n === 4 && L.cfg.teams ? (i % 2 === 0 ? "Team A" : "Team B") : "Seat " + (i + 1);
      const who = s.kind === "empty" ? `<span class="muted">Waiting for a player…</span>` : esc(s.name) + (i === app.seat ? " (you)" : "");
      const tag = s.kind === "host" ? "host" : s.kind === "bot" ? "bot" : s.kind === "remote" ? (s.online ? "joined" : "offline") : "";
      return `<div class="seat"><span><span class="tag">${team}</span> · ${who}</span><span class="tag">${tag}</span></div>`;
    }).join("");
    const empty = L.seats.filter(s => s.kind === "empty").length;
    $("start").hidden = !isHost;
    $("start").textContent = empty ? `Start with ${empty} bot${empty > 1 ? "s" : ""}` : "Start game";
    $("room-status").textContent = isHost
      ? (app.online ? "Share the code. Partners sit opposite: seats 1 & 3, seats 2 & 4." : "")
      : "Waiting for the host to start…";
    if (!(L.cfg.n === 4 && L.cfg.teams) && isHost) $("room-status").textContent = app.online ? "Share the code or the link with your friends." : "";
  }
  $("start").onclick = () => hostStart();
  $("copy-link").onclick = () => {
    const link = $("room-link").textContent;
    try { navigator.clipboard.writeText(link).then(() => toast("Invite link copied"), () => toast("Copy the link below")); }
    catch (e) { toast("Copy the link below"); }
  };
  function leave() {
    try { app.net && app.net.close(); } catch (e) {}
    setTimeout(() => { location.href = location.pathname + (BROKER_Q ? "?" + BROKER_Q : ""); }, 400);
  }
  $("leave").onclick = leave;
  $("rot-skip").onclick = () => { portraitOk = true; layout(); };
  $("g-full").onclick = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
        try { await screen.orientation.lock("landscape"); } catch (e) {}
      } else await document.exitFullscreen();
    } catch (e) { toast("Full screen isn't available here. Turn your phone sideways instead."); }
  };
  document.addEventListener("fullscreenchange", () => { $("g-full").textContent = document.fullscreenElement ? "Exit full screen" : "Full screen"; setTimeout(layout, 100); });
  $("g-leave").onclick = () => {
    if ($("g-leave").dataset.confirm) leave();
    else { $("g-leave").dataset.confirm = "1"; $("g-leave").textContent = "Tap again"; setTimeout(() => { delete $("g-leave").dataset.confirm; $("g-leave").textContent = "Leave"; }, 3000); }
  };

  /* ---------- game screen ---------- */
  function nameOf(i) { return app.view.players[i].name + (i === app.view.me ? " (you)" : ""); }
  function sideCls(side) { return side === 0 ? "side-a" : side === 1 ? "side-b" : ""; }

  function renderGame() {
    const v = app.view;
    if (!v) return;
    const me = v.me;
    // keep only selected cards still in hand
    const hand = v.hand || [];
    app.selected.forEach(c => { if (!hand.includes(c)) app.selected.delete(c); });

    // what changed since the last screen (for animations)
    const prev = app.prevView;
    const sameDeal = !!(prev && prev.dealNo === v.dealNo && v.dealNo);
    const turnDone = sameDeal && v.turnNo !== prev.turnNo;
    let newFrom = 0;
    if (sameDeal && !turnDone && prev.turn && v.turn && prev.turn.leader === v.turn.leader && !(v.turn.fourTrumps && !prev.turn.fourTrumps)) newFrom = prev.turn.plays.length;
    const fx = {
      newFrom, turnDone,
      drawnCards: turnDone ? hand.filter(c => !(prev.hand || []).includes(c)) : [],
      draws: turnDone ? (v.lastDraw || []) : [],
      trumpChanged: sameDeal && v.hiddenCard && !prev.hiddenCard
    };
    if (fx.trumpChanged) toast(v.trump === E.suitOf(v.firstFaceUp) ? "Hidden card " + v.hiddenCard + ": trump stays " + E.suitName(v.trump) : "Trump changes to " + E.suitName(v.trump) + " " + v.trump + "!");
    app.prevView = v;

    // trump bar
    const SN = { "♠": "Spades", "♥": "Hearts", "♦": "Diamonds", "♣": "Clubs" };
    $("g-deal").textContent = v.dealNo || "–";
    if (!v.dealNo) { $("g-trump").textContent = "—"; $("g-deck").textContent = "Revealed after the deal."; $("g-deckpile").innerHTML = ""; }
    if (v.dealNo) {
      $("g-trump").innerHTML = v.trump + "\uFE0E " + SN[v.trump];
      $("g-trump").className = "tb-suit" + (RED(v.trump) ? " red" : "");
      const left = v.stockCount - (v.faceUp ? 1 : 0) - (v.hiddenInStock ? 1 : 0);
      const layers = Math.min(5, Math.max(0, Math.ceil(left / 5)));
      $("g-deckpile").innerHTML =
        `<div class="pilebox"><div class="under ${v.faceUp ? "" : "taken"}">${cardHTML(v.firstFaceUp, "", "")}</div>` +
        `<div class="stack">${Array.from({ length: layers }, (_, i) => cardHTML("back", "", "", `left:${i * 1.5}px;top:${-i * 1.5}px`)).join("")}</div>` +
        (left > 0 ? `<div class="count"><span>${left}</span></div>` : "") + `</div>` +
        `<div class="hid">${v.hiddenCard ? cardHTML(v.hiddenCard, "", fx.trumpChanged ? "flip" : "") : v.hiddenInStock ? cardHTML("back") : ""}<small>${v.hiddenCard ? "hidden card" : v.hiddenInStock ? "hidden" : ""}</small></div>`;
      $("g-deck").textContent = v.stockCount
        ? v.stockCount + " card" + (v.stockCount === 1 ? "" : "s") + " left in the deck" + (v.hiddenInStock ? ". The last one is hidden and can change the trump." : "")
        : (v.hiddenCard && v.trump !== E.suitOf(v.firstFaceUp) ? "Deck is empty. The hidden card changed the trump." : "Deck is empty.");
      if (fx.trumpChanged) { const tb = $("g-trumpbar"); tb.classList.remove("changed"); void tb.offsetWidth; tb.classList.add("changed"); }
    }
    $("g-scores").innerHTML = `<span class="scores-k">Bad points</span>` + v.sideNames.map((nm, i) => {
      const mine = (v.teams ? me % 2 : me) === i;
      const pct = v.target === 1 ? Math.min(100, v.sideBad[i] / 6 * 100) : Math.min(100, v.sideBad[i] / v.target * 100);
      const short = v.teams ? "Team " + (i === 0 ? "A" : "B") : v.players[i].name;
      return `<div class="chip score ${mine ? "mine" : ""}"><span class="k">${esc(short)}${mine ? " · you" : ""}</span>
        <span class="v mono">${v.sideBad[i]}${v.target > 1 ? ` <span class="muted" style="font-size:.8rem">/ ${v.target}</span>` : ""}</span>
        <span class="bar"><i style="width:${pct}%"></i></span></div>`;
    }).join("") + (v.eggs ? `<div class="chip"><span class="k">Eggs</span><span class="v">×2 next deal</span></div>` : "");

    // opponents
    const waiting = v.phase === "pick" ? v.pick.current : v.turn ? (v.phase === "lead" ? v.turn.leader : v.turn.toAct) : -1;
    const order = [...Array(v.n).keys()].map(k => (me + 1 + k) % v.n).filter(i => i !== me);
    $("g-opps").innerHTML = order.map(i => {
      const p = v.players[i];
      const partner = v.teams && i % 2 === me % 2;
      const team = v.teams ? `<span class="${sideCls(p.side)}" style="font-size:.75rem">${partner ? "partner" : "Team " + (p.side === 0 ? "A" : "B")}</span>` : "";
      const d = fx.draws.find(x => x.p === i);
      const drew = d ? ` <span class="badge">draws ${d.n}</span>` : "";
      const turnTag = waiting === i ? ` <span class="badge gold pulse">${v.phase === "lead" ? "leading" : "thinking"}</span>` : "";
      return `<div class="opp ${waiting === i ? "turn" : ""}" data-seat="${i}"><div class="nm"><span>${esc(p.name)}${p.bot ? ' <span class="muted" style="font-size:.75rem">bot</span>' : ""}${turnTag}${drew}</span>${team}</div>
        <div class="backs">${Array.from({ length: p.count }, (_, k) => cardHTML("back", "", "", `--i:${k};--n:${p.count}`)).join("") || '<span class="muted" style="font-size:.8rem">no cards</span>'}</div></div>`;
    }).join("");

    const newDeal = !!(v.dealNo && (!prev || prev.dealNo !== v.dealNo) && ["lead", "answer"].includes(v.phase));
    renderTable(v, fx);
    renderControls(v, fx);
    requestAnimationFrame(() => motion(v, fx, newDeal));

    $("g-log").innerHTML = v.log.slice().reverse().map(l => `<div>${esc(l)}</div>`).join("");
    renderOverlay(v);
  }

  function motion(v, fx, newDeal) {
    const deck = deckRect();
    if (newDeal) {
      // deal: 4 cards to every seat, one at a time around the table
      const order = [...Array(v.n).keys()].map(k => (v.turn.leader + k) % v.n);
      let t = 0;
      for (let r = 0; r < 4; r++) for (const p of order) {
        if (p === v.me) {
          const el = document.querySelectorAll("#g-hand .card")[r];
          if (el) flyIn(el, deck, t, -30);
        } else ghost(deck, seatRect(p), t, 30);
        t += 90;
      }
      return;
    }
    // cards just played fly in from the player's seat (or from your hand)
    document.querySelectorAll("#g-table .grp.enter").forEach((g, gi) => {
      const p = +g.dataset.p;
      g.querySelectorAll(".card").forEach((el, ci) => {
        const from = (p === v.me && app.handRects && app.handRects[el.dataset.card]) || seatRect(p);
        flyIn(el, from, ci * 70, p === v.me ? 0 : -18);
      });
    });
    // after a turn: everyone draws from the deck, winner first
    if (fx.turnDone && fx.draws.length) {
      let t = 500;
      for (const d of fx.draws) {
        for (let j = 0; j < d.n; j++) {
          if (d.p === v.me) {
            const els = [...document.querySelectorAll("#g-hand .card")].filter(el => fx.drawnCards.includes(el.dataset.card));
            if (els[j]) flyIn(els[j], deck, t, -25);
          } else ghost(deck, seatRect(d.p), t, 30);
          t += 120;
        }
      }
    }
  }

  function playRows(plays, winner, fx, done) {
    return `<div class="lt-groups">` + plays.map((pl, idx) => {
      const label = pl.kind === "lead" ? "led" : pl.kind === "beat" ? "beats" : "face down";
      const isWin = winner === pl.p;
      const cls = ["grp", isWin ? "win" : "", idx >= fx.newFrom && !done ? "enter" : "", isWin && done && fx.turnDone ? "fresh" : ""].join(" ");
      return (idx ? `<span class="arrow" aria-hidden="true">›</span>` : "") +
        `<div class="${cls}" data-p="${pl.p}"><div class="gl">${esc(nameOf(pl.p))} <small>${label}</small>${isWin && done ? '<span class="tag-win">WINS</span>' : ""}</div>
        <div class="gc">${pl.cards.map(c => cardHTML(c, "sm")).join("")}</div></div>`;
    }).join("") + `</div>`;
  }

  function describe(pl, v) {
    const k = pl.cards.length, nm = esc(nameOf(pl.p));
    if (pl.kind === "lead") return `${nm} ${v.turn && v.turn.fourTrumps ? "plays FOUR TRUMPS" : "leads " + k + " card" + (k > 1 ? "s" : "")}`;
    if (pl.kind === "beat") return `${nm} beats ${k > 1 ? "all " + k + " cards" : "it"}`;
    return `${nm} throws ${k} card${k > 1 ? "s" : ""} face down`;
  }

  function renderTable(v, fx) {
    const t = v.turn;
    let html = "";
    if (t && t.plays.length) {
      html += `<div class="event">${describe(t.plays[t.plays.length - 1], v)}</div>`;
      html += playRows(t.plays, t.winning, fx, false);
    } else if (v.lastTurn && v.dealNo) {
      const lt = v.lastTurn;
      const draws = (v.lastDraw || []).map(d => (d.p === v.me ? "you" : esc(v.players[d.p].name)) + " " + d.n).join(", ");
      html += `<div class="event">${esc(nameOf(lt.winner))} wins the turn and takes ${lt.count} cards</div>`;
      html += playRows(lt.plays, lt.winner, fx, true);
      html += `<div class="head"><span>${draws ? "Drawing from the deck, winner first: " + draws : "No cards left to draw."}</span><span>${esc(nameOf(lt.winner))} leads next</span></div>`;
    } else {
      html += `<div class="empty-table"><span>${v.dealNo ? esc(nameOf(v.turn ? v.turn.leader : 0)) + " leads the first turn." : "The table is empty."}</span></div>`;
    }
    $("g-table").innerHTML = html;
  }

  function winningCards(v) {
    const t = v.turn; if (!t) return [];
    for (let i = t.plays.length - 1; i >= 0; i--) if (t.plays[i].p === t.winning) return t.plays[i].cards;
    return [];
  }

  function cheapest(hand, k, trump) {
    const cost = c => (E.suitOf(c) === trump ? 40 : 0) + E.pts(c) * 2 + E.power(c);
    return hand.slice().sort((a, b) => cost(a) - cost(b)).slice(0, k);
  }

  function renderControls(v, fx) {
    fx = fx || { drawnCards: [], draws: [] };
    const me = v.me, hand = v.hand || [], t = v.turn;
    const sel = [...app.selected];
    let status = "", mine = false, buttons = [], hint = "";
    const myDraw = (fx.draws || []).find(d => d.p === me);
    if (["lead", "answer"].includes(v.phase) && t) {
      if (v.phase === "lead" && t.leader === me) {
        mine = true;
        status = "Your lead: pick 1–4 cards of one suit.";
        const err = sel.length ? E.validLead(null, sel) : "Select cards";
        buttons.push(`<button type="button" class="btn" data-act="lead" ${err ? "disabled" : ""}>Lead ${sel.length || ""} card${sel.length === 1 ? "" : "s"}</button>`);
        if (sel.length && err) status += " " + err + ".";
      } else if (v.phase === "answer" && t.toAct === me) {
        mine = true;
        const k = t.plays[0].cards.length;
        const partnerWins = v.teams && t.winning % 2 === me % 2;
        status = `Your answer: beat all ${k > 1 ? k + " cards" : "of it"}, or throw ${k} face down.`;
        if (partnerWins) status = `Your partner is winning. Throw ${k} face down (high points help your team), or beat anyway.`;
        const canBeat = sel.length === k && E.findAssignment(sel, winningCards(v), v.trump);
        buttons.push(`<button type="button" class="btn" data-act="beat" ${canBeat ? "" : "disabled"}>Beat</button>`);
        buttons.push(`<button type="button" class="btn ghost" data-act="throw">Throw ${k} face down</button>`);
        hint = sel.length === k ? (canBeat ? "Beat with the selected cards, or throw them face down." : "These cards can't beat all of them. You can still throw them face down.")
          : sel.length === 0 ? `Select ${k} card${k > 1 ? "s" : ""} to beat. Throw face down without selecting and your ${k > 1 ? k + " lowest cards go" : "lowest card goes"}.`
          : `Select ${k} card${k > 1 ? "s" : ""} (you have ${sel.length}).`;
      } else {
        const w = v.phase === "lead" ? t.leader : t.toAct;
        status = `Waiting for ${esc(v.players[w].name)}…`;
      }
      if (v.canFour) buttons.unshift(`<button type="button" class="btn gold" data-act="four">Play 4 trumps!</button>`);
    } else if (v.phase === "pick" || v.phase === "picked") {
      status = "Deciding who goes first…";
    } else if (v.phase === "dealEnd") status = "Deal over.";
    else if (v.phase === "gameOver") status = "Game over.";
    if (myDraw) status = `<span class="badge">You drew ${myDraw.n}</span> ` + status;
    $("g-status").innerHTML = status;
    $("g-status").className = "status" + (mine ? " mine" : "");
    $("g-actions").innerHTML = buttons.join("") + (hint ? `<span class="hint">${hint}</span>` : "");
    $("g-hand").className = "hand" + (mine || v.canFour ? "" : " off");
    const n = hand.length;
    $("g-hand").innerHTML = hand.map((c, i) =>
      cardHTML(c, "", app.selected.has(c) ? "sel" : "", `--i:${i};--n:${n};--d:${Math.abs(i - (n - 1) / 2).toFixed(2)}`)
    ).join("") || `<span class="none">No cards in hand.</span>`;
  }

  $("g-hand").addEventListener("click", e => {
    const el = e.target.closest("[data-card]"); if (!el) return;
    const c = el.dataset.card;
    if (app.selected.has(c)) app.selected.delete(c); else app.selected.add(c);
    renderControls(app.view);
  });
  $("g-actions").addEventListener("click", e => {
    const b = e.target.closest("[data-act]"); if (!b || b.disabled) return;
    const type = b.dataset.act, v = app.view;
    app.handRects = {};
    document.querySelectorAll("#g-hand [data-card]").forEach(el => { app.handRects[el.dataset.card] = el.getBoundingClientRect(); });
    if (type === "four") act({ type: "four" });
    else if (type === "throw") {
      const k = v.turn.plays[0].cards.length;
      let cards = [...app.selected];
      if (cards.length === 0) cards = cheapest(v.hand, k, v.trump);
      else if (cards.length !== k) { toast(`Select exactly ${k} card${k > 1 ? "s" : ""}, or none to throw your lowest.`); return; }
      act({ type: "throw", cards });
    } else act({ type, cards: [...app.selected] });
    app.selected.clear();
  });

  /* ---------- overlays ---------- */
  function optLabel(o) {
    if (o === "red") return `<span class="sym red">Red ♥\uFE0E♦\uFE0E</span>`;
    if (o === "black") return `<span class="sym">Black ♠\uFE0E♣\uFE0E</span>`;
    return sym(o);
  }
  function pileHTML(v) {
    const pile = v.myPile;
    const who = v.teams ? "your team" : "you";
    if (!pile.length) return `<div class="pile"><h3>Cards ${who} won</h3><p class="muted">No cards this deal.</p></div>`;
    const suits = ["♠", "♥", "♦", "♣"].sort((a, b) => (a === v.trump) - (b === v.trump));
    const rows = suits.map(su => {
      const cs = pile.filter(c => E.suitOf(c) === su).sort((a, b) => E.power(b) - E.power(a));
      if (!cs.length) return "";
      const pts = E.sum(cs);
      return `<div class="pile-row"><span class="pile-suit ${RED(su) ? "red" : ""}">${su}\uFE0E${su === v.trump ? '<small>trump</small>' : ""}</span>
        <div class="pile-cards">${cs.map(c => cardHTML(c, "sm", E.pts(c) ? "" : "zero")).join("")}</div>
        <span class="pile-pts mono">${pts}</span></div>`;
    }).join("");
    return `<div class="pile"><h3>Cards ${who} won · ${pile.length} cards · <span class="mono">${E.sum(pile)}</span> points</h3>${rows}</div>`;
  }
  function renderOverlay(v) {
    const ov = $("overlay"), m = $("modal");
    let html = null;
    const isHost = app.role === "host";
    if (v.phase === "pick" || v.phase === "picked") {
      const pk = v.pick;
      const what = pk.kind === "color" ? "colour" : "suit";
      const made = Object.keys(pk.choices).map(k => `<div>${esc(nameOf(+k))}: <strong>${pk.choices[k].map(optLabel).join(", ")}</strong></div>`).join("");
      html = `<span class="eyebrow">Who goes first</span><h2>Pick a ${what}</h2>
        <p class="muted">A random card is turned. Whoever picked its ${what} starts the game.${v.teams ? " One player picks for each team." : ""}</p>
        <div class="log" style="color:var(--ink)">${made || ""}</div>`;
      if (v.phase === "pick") {
        if (pk.current === v.me) {
          html += `<div class="opts">${pk.remaining.map(o => `<button type="button" class="opt ${o === "red" || RED(o) ? "red" : ""} ${o.length > 1 ? "wide" : ""}" data-pick="${o}">${optLabel(o)}</button>`).join("")}</div>`;
        } else html += `<p>Waiting for ${esc(v.players[pk.current].name)} to pick…</p>`;
      } else {
        html += `<div class="row">${cardHTML(pk.card, "lg", "pick-card")}<div><strong>${esc(nameOf(pk.winner))}</strong> goes first.<br><span class="muted">Dealing…</span></div></div>`;
      }
    } else if (v.phase === "dealEnd" || v.phase === "gameOver") {
      const r = v.lastResult;
      const rows = v.sideNames.map((nm, i) => `<tr><td>${esc(nm)}</td><td class="n">${r.points[i]}</td><td class="n ${r.bad[i] ? "bad" : ""}">${r.bad[i] ? "+" + r.bad[i] : "0"}</td><td class="n">${r.totals[i]}</td></tr>`).join("");
      html = `<span class="eyebrow">Deal ${r.deal} result</span>`;
      if (v.phase === "gameOver") {
        const g = v.goat || [];
        html += g.length ? `<div class="goat">${GOAT}Козёл!</div><h2>${g.map(i => esc(v.sideNames[i])).join(" & ")} ${g.length > 1 || v.teams ? "are" : "is"} the goat.</h2>`
                         : `<h2>No goat this time.</h2>`;
      } else html += `<h2>Deal over</h2>`;
      if (r.eggs) html += `<p class="warn">60 : 60, eggs! Nobody gets bad points. Next deal counts double.</p>`;
      if (r.doubled) html += `<p class="warn">This deal counted double because of eggs.</p>`;
      html += `<div class="res-grid"><div style="overflow-x:auto"><table class="res"><thead><tr><th>Player</th><th style="text-align:right">Card pts</th><th style="text-align:right">Bad</th><th style="text-align:right">Total bad</th></tr></thead><tbody>${rows}</tbody></table></div>${v.myPile ? pileHTML(v) : ""}</div>`;
      if (v.target > 1 && v.phase === "dealEnd") html += `<p class="muted">First to ${v.target} bad points is the goat.</p>`;
      html += isHost
        ? `<div class="row"><button type="button" class="btn" data-next="1">${v.phase === "gameOver" ? "Play again" : "Next deal"}</button>${v.phase === "gameOver" ? `<button type="button" class="btn ghost" data-leave="1">Leave</button>` : ""}</div>`
        : `<p class="muted">Waiting for the host to ${v.phase === "gameOver" ? "start a new game" : "deal"}…</p>`;
    }
    if (html === null) { ov.hidden = true; return; }
    m.innerHTML = html; ov.hidden = false;
  }
  $("modal").addEventListener("click", e => {
    const p = e.target.closest("[data-pick]"); if (p) { act({ type: "pick", option: p.dataset.pick }); return; }
    if (e.target.closest("[data-next]")) { act({ type: "next" }); return; }
    if (e.target.closest("[data-leave]")) leave();
  });

  window.addEventListener("pagehide", () => { if (app.role === "client" && app.net) try { app.net.close(); } catch (e) {} });
  window.addEventListener("beforeunload", e => {
    if (app.role === "host" && app.state && app.state.phase !== "gameOver") { e.preventDefault(); e.returnValue = ""; }
  });

  // test hook
  window.__kozel = app;
})();
