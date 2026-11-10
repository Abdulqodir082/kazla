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

The host's browser runs the game and talks to the other players directly (WebRTC via
PeerJS's free public signalling server). There is no backend, so it runs on GitHub Pages.
The host has to keep their tab open for the whole game. Players who drop can rejoin
with the same link.
