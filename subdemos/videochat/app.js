// ColabText video chat: a party call, no server. Everyone who opens the page joins one big grid.
//   Trystero handles peer discovery (Nostr relays) AND media: addStream() sends my camera to a peer,
//   onPeerStream fires when theirs arrives. WebRTC carries the video browser-to-browser.
import {joinRoom} from 'https://esm.sh/trystero@0.25.3'

// TURN relay fallback for NAT-hostile networks (duplicated from the parent demo: sub-demos are self-contained).
const TURN_SERVER = {
  urls: 'turn:free.expressturn.com:3478',
  username: '000000002102714863',
  credential: 'N7bwZqx8Q776diSA+rrvCrliDqs=',
}

const grid = document.getElementById('grid')
const status = document.getElementById('status')

// Ask for camera + mic up front; the page is pointless without them, so a denial is shown and re-thrown.
const selfStream = await navigator.mediaDevices.getUserMedia({video: true, audio: true}).catch(error => {
  status.textContent = `Camera/microphone access failed: ${error.message}`
  throw error
})
addVideo('self', selfStream, {muted: true, mirrored: true})

const room = joinRoom({appId: 'ColabText-videochat', turnConfig: [TURN_SERVER]}, location.hash.slice(1) || 'lobby', {
  onJoinError: ({error}) => { status.textContent = `Could not connect to a peer: ${error}` },
})
room.onPeerJoin = peer => { room.addStream(selfStream, {target: peer}); showPeers() }
room.onPeerStream = (stream, peer) => addVideo(peer, stream)
room.onPeerLeave = peer => { document.getElementById('video-' + peer)?.remove(); showPeers() }
showPeers()

/**
 * Command. Adds a tile to the grid playing `stream` (replacing any existing tile for `id`).
 * The self tile is muted (no echo) and mirrored (what people expect of their own image).
 */
function addVideo(id, stream, {muted = false, mirrored = false} = {}) {
  document.getElementById('video-' + id)?.remove()
  const video = document.createElement('video')
  video.id = 'video-' + id
  video.classList.toggle('mirrored', mirrored)
  video.srcObject = stream
  video.autoplay = true
  video.playsInline = true
  video.muted = muted
  grid.append(video)
}

/** Command. Writes the number of connected peers to the status bar. */
function showPeers() {
  const n = Object.keys(room.getPeers()).length
  status.textContent = `${n} other ${n === 1 ? 'person' : 'people'} here. Share this URL: ${location.href}`
}
