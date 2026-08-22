// ColabText video chat: a party call, no server. Everyone who opens the page joins one big grid.
//   Trystero handles peer discovery (Nostr relays) AND media: addStream() sends a stream to a peer,
//   onPeerStream fires when theirs arrives, with metadata telling camera and screen share apart.
import {joinRoom, getRelaySockets} from 'https://esm.sh/trystero@0.25.3'

// TURN relay fallback for NAT-hostile networks (duplicated from the parent demo: sub-demos are self-contained).
// Trystero picks this many public Nostr relays (shuffled deterministically by appId, so every
// client uses the same set). The default 5 leaves discovery crawling when a couple are down.
const RELAY_COUNT = 10
const TURN_SERVER = {
  // ExpressTURN's hostname round-robins across servers and one can be dead while still answering;
  // listing each server lets ICE try them all and use whichever actually relays.
  // (No ?transport=tcp variants: Safari rejects TURN URLs with a query string.)
  urls: ['turn:51.158.147.206:3478', 'turn:62.210.205.50:3478', 'turn:free.expressturn.com:3478'],
  username: '000000002102714863',
  credential: 'N7bwZqx8Q776diSA+rrvCrliDqs=',
}
const STATS_INTERVAL_MS = 1000
const STREAM_START_TIMEOUT_MS = 5000   // remote tile still black after this -> ask the peer to re-send
const DEFAULT_ASPECT = 4 / 3           // a tile's aspect ratio until its video reports a size
const SCALE_SEARCH_STEPS = 30          // tile-packing binary search: box size / 2^30 is far below a pixel

const grid = document.getElementById('grid')
const status = document.getElementById('status')
// Surface any uncaught error in the status bar — a dead page must say why (Safari especially).
window.onerror = (message) => { status.textContent = `Error: ${message}` }
window.onunhandledrejection = ({reason}) => { status.textContent = `Error: ${reason}` }
const dataCounter = document.getElementById('data')
const micButton = document.getElementById('mic')
const camButton = document.getElementById('cam')
const screenButton = document.getElementById('screen')

// Ask for camera + mic up front; the page is pointless without them, so a denial is shown and re-thrown.
const selfStream = await navigator.mediaDevices.getUserMedia({video: true, audio: true}).catch(error => {
  status.textContent = `Camera/microphone access failed: ${error.message}`
  throw error
})
addVideo('self', selfStream, {muted: true, mirrored: true})

const room = joinRoom({appId: 'ColabText-videochat', turnConfig: [TURN_SERVER], relayConfig: {redundancy: RELAY_COUNT}}, location.hash.slice(1) || 'lobby', {
  onJoinError: ({error}) => { status.textContent = `Could not connect to a peer: ${error}` },
})
const screenOff = room.makeAction('screenoff')   // tells peers to drop my screen tile
const resend = room.makeAction('resend')         // "your stream never started here, send it again"
let screenStream = null

room.onPeerJoin = peer => { sendStreams(peer); showPeers() }
room.onPeerStream = (stream, peer, metadata) => {
  const video = addVideo(metadata === 'screen' ? peer + '-screen' : peer, stream)
  // Safari sometimes loses the renegotiation race and a stream arrives but never plays; a fresh
  // add from the sender's side kicks off a new negotiation that does.
  setTimeout(() => { if (video.isConnected && !video.videoWidth) resend.send(null, {target: peer}) }, STREAM_START_TIMEOUT_MS)
}
resend.onMessage = (_, {peerId}) => { room.removeStream(selfStream, {target: peerId}); sendStreams(peerId) }
room.onPeerLeave = peer => { removeVideo(peer); removeVideo(peer + '-screen'); showPeers() }
screenOff.onMessage = (_, {peerId}) => removeVideo(peerId + '-screen')
showPeers()

// Refresh = reload: the page re-registers on the signaling relays and searches for everyone from
// scratch. (Trystero's room.leave() never resolves once peers drop the connection, so a true
// in-page rejoin isn't possible; a reload is the honest version.)
document.getElementById('refresh').onclick = () => location.reload()

// Toolbar. Mute stops your mic reaching others (kills feedback loops between nearby devices);
// stopping video drops the encoder to near-zero bitrate. Both toggle track.enabled, which keeps
// the connection up and is instantly reversible.
micButton.onclick = () => toggleTrack(selfStream.getAudioTracks()[0], micButton, 'mdi:microphone', 'mdi:microphone-off')
camButton.onclick = () => toggleTrack(selfStream.getVideoTracks()[0], camButton, 'mdi:video', 'mdi:video-off')
screenButton.onclick = toggleScreenShare

/** Command. Sends my camera and, if sharing, my screen to one peer. */
function sendStreams(peer) {
  room.addStream(selfStream, {target: peer, metadata: 'camera'})
  if (screenStream) room.addStream(screenStream, {target: peer, metadata: 'screen'})
}

/** Command. Flips track.enabled and restyles the button to show the new state. */
function toggleTrack(track, button, onIcon, offIcon) {
  track.enabled = !track.enabled
  setButton(button, track.enabled, onIcon, offIcon)
}

/** Command. Starts or stops broadcasting this screen as an extra tile on every peer. */
async function toggleScreenShare() {
  if (screenStream) {
    room.removeStream(screenStream)
    screenStream.getTracks().forEach(track => track.stop())
    screenStream = null
    removeVideo('self-screen')
    screenOff.send(null)
  } else {
    screenStream = await navigator.mediaDevices.getDisplayMedia({video: true})
    addVideo('self-screen', screenStream, {muted: true})
    room.addStream(screenStream, {metadata: 'screen'})
    screenStream.getVideoTracks()[0].onended = () => screenStream && toggleScreenShare()   // browser's own "Stop sharing" bar
  }
  setButton(screenButton, !!screenStream, 'mdi:monitor-share', 'mdi:monitor-off')
}

/** Command. Sets a toolbar button's icon and its off-state styling. */
function setButton(button, on, onIcon, offIcon) {
  button.classList.toggle('off', !on)
  button.querySelector('iconify-icon').setAttribute('icon', on ? onIcon : offIcon)
}

// Bottom-right readout: how many signaling relays are connected (discovery needs at least one that
// the other person also reaches), whether each live connection is direct peer-to-peer or through
// the TURN relay, and cumulative WebRTC bytes (sent + received, every peer).
// Per-peer last readings are kept so the byte total survives peers leaving.
let bytesTotal = 0
const bytesSeen = {}
setInterval(async () => {
  const kinds = []
  for (const [peer, pc] of Object.entries(room.getPeers())) {
    const stats = await pc.getStats()
    let bytes = 0
    for (const stat of stats.values())
      if (stat.type === 'transport') bytes += (stat.bytesSent ?? 0) + (stat.bytesReceived ?? 0)
    bytesTotal += Math.max(0, bytes - (bytesSeen[peer] ?? 0))
    bytesSeen[peer] = bytes
    kinds.push(connectionKind(stats))
  }
  const relaysOpen = Object.values(getRelaySockets()).filter(socket => socket.readyState === WebSocket.OPEN).length
  dataCounter.textContent = [`${relaysOpen} relays`, ...summarize(kinds), formatBytes(bytesTotal)].join(' · ')
}, STATS_INTERVAL_MS)

/**
 * Pure function. How one peer connection is carried, from its WebRTC stats: 'direct' if the
 * nominated candidate pair uses no relay, 'relay' if either end is a TURN relay candidate,
 * 'connecting' if no pair has succeeded yet.
 *
 * @param {RTCStatsReport} stats - result of RTCPeerConnection.getStats()
 * @returns {'direct' | 'relay' | 'connecting'}
 *
 * @example connectionKind(new Map([['p', {type: 'candidate-pair', state: 'succeeded', nominated: true, localCandidateId: 'l', remoteCandidateId: 'r'}], ['l', {candidateType: 'srflx'}], ['r', {candidateType: 'relay'}]]))  // 'relay'
 * @example connectionKind(new Map([['p', {type: 'candidate-pair', state: 'succeeded', nominated: true, localCandidateId: 'l', remoteCandidateId: 'r'}], ['l', {candidateType: 'host'}], ['r', {candidateType: 'host'}]]))   // 'direct'
 * @example connectionKind(new Map())  // 'connecting'
 */
function connectionKind(stats) {
  const pair = [...stats.values()].find(s => s.type === 'candidate-pair' && s.state === 'succeeded' && s.nominated)
  if (!pair) return 'connecting'
  const relayed = [pair.localCandidateId, pair.remoteCandidateId].some(id => stats.get(id)?.candidateType === 'relay')
  return relayed ? 'relay' : 'direct'
}

/**
 * Pure function. Counts repeated labels into "N label" strings, in first-seen order.
 *
 * @param {string[]} labels
 * @returns {string[]}
 *
 * @example summarize(['direct', 'relay', 'direct'])  // ['2 direct', '1 relay']
 * @example summarize([])                             // []
 */
function summarize(labels) {
  const counts = new Map()
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1)
  return [...counts].map(([label, n]) => `${n} ${label}`)
}

/**
 * Pure function. Human-readable byte count (binary units).
 *
 * Args:
 *     bytes (number): Non-negative byte count
 *
 * @returns {string}
 *
 * @example formatBytes(0)      // "0 B"
 * @example formatBytes(1536)   // "1.5 KB"
 * @example formatBytes(2.6e6)  // "2.5 MB"
 */
function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB']
  const i = bytes ? Math.min(units.length - 1, Math.floor(Math.log2(bytes) / 10)) : 0
  return (bytes / 2 ** (10 * i)).toFixed(i ? 1 : 0) + ' ' + units[i]
}

// Layout: the grid is a fixed box (never scrolls). Whenever tiles or the window change, every tile
// is packed into the box at its own aspect ratio and ONE shared scale (constant "DPI": a portrait
// phone and a landscape laptop show faces the same size), as large as will fit. Pure geometry below.
new ResizeObserver(layoutGrid).observe(grid)

/** Command. Packs all tiles into the grid box and positions each video absolutely. */
function layoutGrid() {
  const tiles = [...grid.children]
  if (!tiles.length) return
  const gap = parseFloat(getComputedStyle(grid).getPropertyValue('--tile-gap'))
  // Unit-height sizes: equal tile heights. (Use {width: videoWidth, height: videoHeight} for literal same-DPI.)
  const sizes = tiles.map(v => ({width: v.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : DEFAULT_ASPECT, height: 1}))
  const {rects} = packTiles(sizes, grid.clientWidth, grid.clientHeight, gap)
  tiles.forEach((video, i) => Object.assign(video.style,
    {left: rects[i].x + 'px', top: rects[i].y + 'px', width: rects[i].width + 'px', height: rects[i].height + 'px'}))
}

/**
 * Pure function. Packs rectangles of the given sizes (any unit) into a boxWidth x boxHeight box,
 * `gap` px apart, all multiplied by ONE scale factor — the largest at which they still fit.
 * Tiles keep their order and flow into rows left to right (first-fit shelf packing); rows are
 * centered horizontally and the block vertically. Fitting is monotone in the scale, so a binary
 * search finds the optimum to sub-pixel precision.
 *
 * @param {{width: number, height: number}[]} sizes
 * @returns {{scale: number, rects: {x: number, y: number, width: number, height: number}[], coverage: number}}
 *
 * @example packTiles([{width: 1, height: 1}, {width: 1, height: 1}], 200, 100, 0)   // scale 100: two squares side by side, coverage 1
 * @example packTiles([{width: 1, height: 1}, {width: 1, height: 1}], 100, 200, 0)   // scale 100: stacked, coverage 1
 * @example packTiles([{width: 16, height: 9}, {width: 9, height: 16}], 300, 300, 0)  // scale 12: a 192x108 tile beside a 108x192 one, coverage ≈ 0.46
 */
function packTiles(sizes, boxWidth, boxHeight, gap) {
  let low = 0, high = boxHeight / Math.min(...sizes.map(s => s.height))
  for (let step = 0; step < SCALE_SEARCH_STEPS; step++) {
    const mid = (low + high) / 2
    if (fits(shelfRows(sizes, mid, boxWidth, gap), mid, boxWidth, boxHeight, gap)) low = mid; else high = mid
  }
  const rows = shelfRows(sizes, low, boxWidth, gap), rects = []
  let y = (boxHeight - rows.reduce((sum, row) => sum + rowHeight(row, low), 0) - gap * (rows.length - 1)) / 2
  for (const row of rows) {
    const h = rowHeight(row, low)
    let x = (boxWidth - rowWidth(row, low, gap)) / 2
    for (const s of row) { rects.push({x, y: y + (h - s.height * low) / 2, width: s.width * low, height: s.height * low}); x += s.width * low + gap }
    y += h + gap
  }
  return {scale: low, rects, coverage: rects.reduce((sum, r) => sum + r.width * r.height, 0) / (boxWidth * boxHeight)}
}

/**
 * Pure function. Splits ordered sizes into rows: each joins the current row if the row still fits
 * the width at this scale, else starts a new one (first-fit shelf packing, order preserved).
 * @example shelfRows([{width: 1, height: 1}, {width: 1, height: 1}, {width: 1, height: 1}], 100, 250, 0)   // [[first, second], [third]]
 */
function shelfRows(sizes, scale, boxWidth, gap) {
  const rows = [[]]
  for (const s of sizes) {
    const row = rows[rows.length - 1]
    if (row.length && rowWidth([...row, s], scale, gap) > boxWidth) rows.push([s]); else row.push(s)
  }
  return rows
}

/** Pure function. Width of a row at this scale, gaps included. @example rowWidth([{width: 1, height: 1}, {width: 2, height: 1}], 100, 10)   // 310 */
function rowWidth(row, scale, gap) {
  return row.reduce((sum, s) => sum + s.width * scale, 0) + gap * (row.length - 1)
}

/** Pure function. Height of a row at this scale: its tallest tile. @example rowHeight([{width: 1, height: 1}, {width: 1, height: 2}], 100)   // 200 */
function rowHeight(row, scale) {
  return Math.max(...row.map(s => s.height * scale))
}

/**
 * Pure function. Whether these rows, at this scale, fit the box in both directions.
 * @example fits([[{width: 1, height: 1}, {width: 1, height: 1}]], 100, 200, 100, 0)   // true
 * @example fits([[{width: 1, height: 1}, {width: 1, height: 1}]], 100, 150, 100, 0)   // false (row is 200 wide)
 */
function fits(rows, scale, boxWidth, boxHeight, gap) {
  return rows.every(row => rowWidth(row, scale, gap) <= boxWidth) &&
    rows.reduce((sum, row) => sum + rowHeight(row, scale), 0) + gap * (rows.length - 1) <= boxHeight
}

/**
 * Command. Adds a tile to the grid playing `stream` (replacing any existing tile for `id`); returns it.
 * The self tiles are muted (no echo); the camera one is mirrored (what people expect of their own image).
 */
function addVideo(id, stream, {muted = false, mirrored = false} = {}) {
  removeVideo(id)
  const video = document.createElement('video')
  video.id = 'video-' + id
  video.classList.toggle('mirrored', mirrored)
  video.autoplay = true      // Safari: playback flags must be set BEFORE srcObject,
  video.playsInline = true   // and remote streams need an explicit play() or they sit black.
  video.muted = muted
  video.srcObject = stream
  video.onloadedmetadata = layoutGrid   // aspect ratio is known now
  grid.append(video)
  video.play().catch(error => { if (error.name !== 'AbortError') throw error })   // AbortError = tile replaced mid-play, expected
  layoutGrid()
  return video
}

/** Command. Removes the tile for `id`, if present, and re-solves the layout. */
function removeVideo(id) {
  document.getElementById('video-' + id)?.remove()
  layoutGrid()
}

/** Command. Writes the number of connected peers to the status bar. */
function showPeers() {
  const n = Object.keys(room.getPeers()).length
  status.textContent = `${n} other ${n === 1 ? 'person' : 'people'} here. Share this URL: ${location.href}`
}
