# Kazla (Козёл)

The Russian card game Kozel in the browser, for 2–4 players.

- `index.html`: the online game. The host creates a room and shares the 5-letter code or
  invite link. Empty seats can be bots. Game length: one deal, to 6, or to 12 bad points.
- `rules.html`: visual rulebook.
- `engine.js`: the rules engine (also runs in Node for testing).
- `app.js`: lobby, networking and UI.

## Publish

Settings → Pages → Source: **Deploy from a branch** → `main` / `/ (root)` → Save.
After about a minute the game is at `https://<username>.github.io/kazla/`.

## How online play works

The host's browser runs the game. Players' messages travel through free public MQTT
relays (EMQX, with HiveMQ as a second option) over secure WebSockets, so it works on
mobile data and Wi-Fi without any direct device-to-device connection. Every message is
end-to-end encrypted (ECDH key exchange + AES-GCM), so the relay and anyone listening
can't see the cards. There is no backend of our own, so it runs on GitHub Pages.

The host has to keep their tab open for the whole game. Players who drop can rejoin
with the same link.

For local testing you can point the page at your own broker: `?broker=ws://localhost:8888`.

## Releasing a change

After changing `app.js`, `engine.js` or `net.js`, bump the `?v=` value on their
`<script>` tags in `index.html` so phones load the new code instead of a cached copy.
