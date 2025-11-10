import { HLSStream } from "./hls-stream";
import { ImageStream } from "./image-stream";
import { MJPEGStream } from "./mjpeg-stream";
import type { VideoStreamProps } from "./types";
import { WebRTCStream } from "./webrtc-stream";

export function VideoStream({ url, protocol, objectFit }: VideoStreamProps) {
  switch (protocol) {
    case "hls":
      return <HLSStream url={url} objectFit={objectFit} />;
    case "mjpeg":
      return <MJPEGStream url={url} objectFit={objectFit} />;
    case "image":
      return <ImageStream url={url} objectFit={objectFit} />;
    case "webrtc":
    default:
      return <WebRTCStream url={url} objectFit={objectFit} />;
  }
}
