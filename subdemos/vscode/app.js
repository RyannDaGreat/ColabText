// ColabText VS Code demo: one shared Python editor showing everyone's cursors, no server.
//   Yjs               - CRDT merging everyone's edits (same as the main textarea demo).
//   Trystero          - WebRTC peer discovery over public Nostr relays.
//   CodeMirror 6      - the editor: Python syntax highlighting, dark theme.
//   y-codemirror.next - binds CodeMirror to Yjs; renders each peer's named, colored cursor + selection.
import * as Y from 'yjs'
import {joinRoom, selfId} from 'trystero'
import {Awareness, encodeAwarenessUpdate, applyAwarenessUpdate} from 'y-protocols/awareness'
import {EditorView, basicSetup} from 'codemirror'
import {python} from '@codemirror/lang-python'
import {oneDark} from '@codemirror/theme-one-dark'
import {yCollab} from 'y-codemirror.next'

// TURN relay fallback for NAT-hostile networks (duplicated from the parent demo: sub-demos are self-contained).
const TURN_SERVER = {
  urls: ['turn:free.expressturn.com:3478', 'turn:free.expressturn.com:3478?transport=tcp'],
  username: '000000002102714863',
  credential: 'N7bwZqx8Q776diSA+rrvCrliDqs=',
}
const USER_COLORS = ['#30bced', '#6eeb83', '#ffbc42', '#ecd444', '#ee6352', '#9ac2c9', '#8acb88', '#1be7ff']

const status = document.getElementById('status')
const doc = new Y.Doc()
const text = doc.getText()
const room = joinRoom({appId: 'ColabText-vscode', turnConfig: [TURN_SERVER]}, location.hash.slice(1) || 'lobby', {
  onJoinError: ({error}) => { status.textContent = `Could not connect to a peer: ${error}` },
})
const updates = room.makeAction('update')
const cursors = room.makeAction('cursors')

// Awareness = ephemeral per-person state (cursor, selection, name, color) that isn't part of the document.
// y-codemirror.next reads the 'user' field to draw each peer's labeled cursor.
const awareness = new Awareness(doc)
const color = USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)]
awareness.setLocalStateField('user', {name: selfId.slice(0, 4), color, colorLight: color + '33'})

// Doc sync: broadcast my edits, apply everyone else's, give newcomers the whole doc.
doc.on('update', (update, origin) => { if (origin !== 'remote') updates.send(update) })
updates.onMessage = update => Y.applyUpdate(doc, new Uint8Array(update), 'remote')

// Cursor sync: same broadcast pattern, using the awareness protocol's own encoding.
awareness.on('update', ({added, updated, removed}) => {
  cursors.send(encodeAwarenessUpdate(awareness, [...added, ...updated, ...removed]))
})
cursors.onMessage = data => applyAwarenessUpdate(awareness, new Uint8Array(data), 'remote')

room.onPeerJoin = peer => {
  updates.send(Y.encodeStateAsUpdate(doc), {target: peer})
  cursors.send(encodeAwarenessUpdate(awareness, [...awareness.getStates().keys()]), {target: peer})
  showPeers()
}
room.onPeerLeave = showPeers
showPeers()

new EditorView({
  parent: document.getElementById('editor'),
  extensions: [basicSetup, python(), oneDark, yCollab(text, awareness)],
})

/** Command. Writes the number of connected peers to the status bar. */
function showPeers() {
  const n = Object.keys(room.getPeers()).length
  status.textContent = `${n} other ${n === 1 ? 'person' : 'people'} here. Share this URL: ${location.href}`
}
