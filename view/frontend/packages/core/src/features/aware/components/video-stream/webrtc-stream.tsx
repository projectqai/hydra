type WebRTCStreamProps = {
  url: string;
  objectFit?: "contain" | "cover";
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function WebRTCStream(props: WebRTCStreamProps): React.ReactNode {
  throw new Error("Platform-specific implementation not loaded");
}
