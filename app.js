// ColabText: one shared textarea, no server. Two libraries do all the work:
//   Yjs      - a CRDT: every peer applies everyone's edits, in any order, and converges.
//   Trystero - WebRTC peer discovery over public Nostr relays, so a static host is enough.
import * as Y from 'https://esm.sh/yjs@13.6.32'
import {joinRoom} from 'https://esm.sh/trystero@0.25.3'

const area = document.getElementById('text')
const status = document.getElementById('status')

const doc = new Y.Doc()
const text = doc.getText()
const room = joinRoom({appId: 'ColabText'}, location.hash.slice(1) || 'lobby')
const updates = room.makeAction('update')

// Network: broadcast my edits, apply everyone else's, and give newcomers the whole doc.
doc.on('update', (update, origin) => { if (origin !== 'remote') updates.send(update) })
updates.onMessage = update => Y.applyUpdate(doc, new Uint8Array(update), 'remote')
room.onPeerJoin = peer => { updates.send(Y.encodeStateAsUpdate(doc), {target: peer}); showPeers() }
room.onPeerLeave = showPeers
showPeers()

// Textarea -> Yjs: each keystroke becomes a small delete + insert.
// (A CRDT needs real inserts/deletes; replacing the whole string would make concurrent edits collide.)
area.addEventListener('input', () => {
  const {start, remove, insert} = diff(text.toString(), area.value)
  doc.transact(() => { text.delete(start, remove); text.insert(start, insert) })
})

// Yjs -> textarea: remote edits replace the text, keeping my cursor where it was.
text.observe((event, transaction) => {
  if (transaction.local) return
  const cursor = shiftCursor(area.selectionStart, event.delta)
  area.value = text.toString()
  area.setSelectionRange(cursor, cursor)
})

/**
 * Pure function. The single edit that turns `before` into `after`,
 * keeping the longest unchanged prefix and suffix.
 * @example diff('hello', 'help')    // {start: 3, remove: 2, insert: 'p'}
 * @example diff('abc', 'aXbc')      // {start: 1, remove: 0, insert: 'X'}
 */
function diff(before, after) {
  const shorter = Math.min(before.length, after.length)
  let start = 0
  while (start < shorter && before[start] === after[start]) start++
  let end = 0
  while (end < shorter - start && before.at(-1 - end) === after.at(-1 - end)) end++
  return {start, remove: before.length - start - end, insert: after.slice(start, after.length - end)}
}

/**
 * Pure function. Where a cursor ends up after a Yjs delta edits the text around it.
 * @example shiftCursor(5, [{retain: 2}, {insert: 'abc'}])  // 8  (inserted before cursor)
 * @example shiftCursor(5, [{retain: 7}, {insert: 'abc'}])  // 5  (inserted after cursor)
 * @example shiftCursor(5, [{retain: 2}, {delete: 10}])     // 2  (deletion swallowed the cursor)
 */
function shiftCursor(cursor, delta) {
  let i = 0
  for (const op of delta) {
    if (op.retain) i += op.retain
    else if (op.insert && i < cursor) { cursor += op.insert.length; i += op.insert.length }
    else if (op.delete && i < cursor) cursor -= Math.min(op.delete, cursor - i)
  }
  return cursor
}

/** Command. Writes the number of connected peers to the status bar. */
function showPeers() {
  const n = Object.keys(room.getPeers()).length
  status.textContent = `${n} other ${n === 1 ? 'person' : 'people'} here. Share this URL: ${location.href}`
}
