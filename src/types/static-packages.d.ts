declare module "ffmpeg-static" {
  const ffmpegPath: string | null;
  export default ffmpegPath;
}

declare module "ffprobe-static" {
  const ffprobe: {
    path: string;
    version?: string;
    url?: string;
  };
  export default ffprobe;
}
