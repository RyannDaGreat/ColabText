// ColabText video chat: a party call, no server. Everyone who opens the page joins one big grid.
//   Trystero handles peer discovery (Nostr relays) AND media: addStream() sends a stream to a peer,
//   onPeerStream fires when theirs arrives, with metadata telling camera and screen share apart.
import {joinRoom} from 'https://esm.sh/trystero@0.25.3'

// TURN relay fallback for NAT-hostile networks (duplicated from the parent demo: sub-demos are self-contained).
const TURN_SERVER = {
  urls: 'turn:free.expressturn.com:3478',   // no ?transport=tcp variant: Safari rejects TURN URLs with a query string
  username: '000000002102714863',
  credential: 'N7bwZqx8Q776diSA+rrvCrliDqs=',
}
const STATS_INTERVAL_MS = 1000

const grid = document.getElementById('grid')
const status = document.getElementById('status')
// Surface any uncaught error in the status bar — a dead page must say why (Safari especially).
window.onerror = (message) => { status.textContent = `Error: ${message}` }
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

const room = joinRoom({appId: 'ColabText-videochat', turnConfig: [TURN_SERVER]}, location.hash.slice(1) || 'lobby', {
  onJoinError: ({error}) => { status.textContent = `Could not connect to a peer: ${error}` },
})
const screenOff = room.makeAction('screenoff')   // tells peers to drop my screen tile
let screenStream = null

room.onPeerJoin = peer => {
  room.addStream(selfStream, {target: peer, metadata: 'camera'})
  if (screenStream) room.addStream(screenStream, {target: peer, metadata: 'screen'})
  showPeers()
}
room.onPeerStream = (stream, peer, metadata) => addVideo(metadata === 'screen' ? peer + '-screen' : peer, stream)
room.onPeerLeave = peer => { removeVideo(peer); removeVideo(peer + '-screen'); showPeers() }
screenOff.onMessage = (_, {peerId}) => removeVideo(peerId + '-screen')
showPeers()

// Toolbar. Mute stops your mic reaching others (kills feedback loops between nearby devices);
// stopping video drops the encoder to near-zero bitrate. Both toggle track.enabled, which keeps
// the connection up and is instantly reversible.
micButton.onclick = () => toggleTrack(selfStream.getAudioTracks()[0], micButton, 'mdi:microphone', 'mdi:microphone-off')
camButton.onclick = () => toggleTrack(selfStream.getVideoTracks()[0], camButton, 'mdi:video', 'mdi:video-off')
screenButton.onclick = toggleScreenShare

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

// Data counter: cumulative WebRTC bytes (sent + received, every peer), shown bottom right.
// Per-peer last readings are kept so the total survives peers leaving.
let bytesTotal = 0
const bytesSeen = {}
setInterval(async () => {
  for (const [peer, pc] of Object.entries(room.getPeers())) {
    let bytes = 0
    for (const stat of (await pc.getStats()).values())
      if (stat.type === 'transport') bytes += (stat.bytesSent ?? 0) + (stat.bytesReceived ?? 0)
    bytesTotal += Math.max(0, bytes - (bytesSeen[peer] ?? 0))
    bytesSeen[peer] = bytes
  }
  dataCounter.textContent = formatBytes(bytesTotal)
}, STATS_INTERVAL_MS)

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

/**
 * Command. Adds a tile to the grid playing `stream` (replacing any existing tile for `id`).
 * The self tiles are muted (no echo); the camera one is mirrored (what people expect of their own image).
 */
function addVideo(id, stream, {muted = false, mirrored = false} = {}) {
  removeVideo(id)
  const video = document.createElement('video')
  video.id = 'video-' + id
  video.classList.toggle('mirrored', mirrored)
  video.srcObject = stream
  video.autoplay = true
  video.playsInline = true
  video.muted = muted
  grid.append(video)
}

/** Command. Removes the tile for `id`, if present. */
function removeVideo(id) {
  document.getElementById('video-' + id)?.remove()
}

/** Command. Writes the number of connected peers to the status bar. */
function showPeers() {
  const n = Object.keys(room.getPeers()).length
  status.textContent = `${n} other ${n === 1 ? 'person' : 'people'} here. Share this URL: ${location.href}`
}
