import { CameraProtocol } from "@projectqai/proto/world";

export type ConnectionState = "idle" | "connecting" | "connected" | "reconnecting" | "failed";

export type VideoProtocol = "webrtc" | "hls" | "mjpeg" | "image";

export type VideoStreamProps = {
  url: string;
  protocol: VideoProtocol;
  objectFit?: "contain" | "cover";
};

export type StreamComponentProps = {
  url: string;
  objectFit?: "contain" | "cover";
};

export function toVideoProtocol(proto: CameraProtocol): VideoProtocol {
  switch (proto) {
    case CameraProtocol.CameraProtocolHls:
      return "hls";
    case CameraProtocol.CameraProtocolMjpeg:
      return "mjpeg";
    case CameraProtocol.CameraProtocolImage:
      return "image";
    case CameraProtocol.CameraProtocolWebrtc:
    case CameraProtocol.CameraProtocolUnspecified:
    default:
      return "webrtc";
  }
}
