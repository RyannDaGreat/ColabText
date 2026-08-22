# ColabText

A proof of concept: one shared text box, realtime, hosted on GitHub Pages (a static server).

**Live:** https://ryanndagreat.github.io/ColabText/ — open it in two tabs (or send the link to someone) and type.
Add `#any-name` to the URL to get a separate room.

## How it works without a server

A static host can't relay edits, so the browsers talk to each other directly (WebRTC).
Two libraries, loaded straight from a CDN, do all the work — see `app.js` (~60 lines):

- **[Yjs](https://github.com/yjs/yjs)** — a CRDT. Every peer applies everyone's edits in any order and ends up with the same text. This is what makes concurrent typing merge instead of clobber.
- **[Trystero](https://github.com/dmotz/trystero)** — WebRTC peer discovery ("signaling") over public Nostr relays, so nobody has to run a signaling server. Payloads are end-to-end encrypted; the relays only help peers find each other.

## Sub-demos

Each entry in the top toolbar is a self-contained demo in `subdemos/` (own HTML/JS/CSS, no imports from the parent):

- **[VS Code](https://ryanndagreat.github.io/ColabText/subdemos/vscode/)** (`subdemos/vscode/`) — shared Python editor: CodeMirror 6 + [y-codemirror.next](https://github.com/yjs/y-codemirror.next), which renders every peer's named, colored cursor and selection via the Yjs awareness protocol. The import map in its `index.html` pins every package to one copy — CodeMirror breaks if `@codemirror/state` is ever loaded twice.
- **[Video Chat](https://ryanndagreat.github.io/ColabText/subdemos/videochat/)** (`subdemos/videochat/`) — party call: everyone who opens the page shares camera + mic into one grid. Trystero's `addStream`/`onPeerStream` carry the WebRTC media; there is no server, so with N people each browser uploads its stream N-1 times (a mesh — fine for a handful of people, an SFU is the scaling answer).

## Run locally

    python3 -m http.server 8000

then open http://localhost:8000 in two windows. (ES modules need http://, not file://.)

## Caveats (it's a POC)

- **No persistence.** The text lives only in open tabs. When the last one closes, it's gone.
- **NAT.** WebRTC uses free STUN; two peers both behind strict/symmetric NAT won't connect (that needs a TURN server).
- **No remote cursors.** Easy to add with Yjs awareness, left out to keep the code short.
