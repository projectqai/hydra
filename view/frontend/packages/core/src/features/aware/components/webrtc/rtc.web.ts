export const RTCPeerConnection =
  typeof window !== "undefined" ? window.RTCPeerConnection : (undefined as never);
export const RTCSessionDescription =
  typeof window !== "undefined" ? window.RTCSessionDescription : (undefined as never);
export const MediaStream =
  typeof window !== "undefined" ? window.MediaStream : (undefined as never);
