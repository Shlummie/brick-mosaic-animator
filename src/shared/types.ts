export type DitherMode = "none" | "ordered" | "floyd-steinberg";

export type ExportFps = "source" | 24 | 30 | 60;

export type AudioMode = "copy" | "aac";

export interface RenderSettings {
  columns: number;
  rows: number;
  studSizePx: number;
  gapPx: number;
  brightness: number;
  contrast: number;
  ditherMode: DitherMode;
  lightingDepth: number;
  showStudEdges: boolean;
  exportFps: ExportFps;
}

export interface VideoMetadata {
  id: string;
  name: string;
  url: string;
  width: number;
  height: number;
  duration: number;
  fps: number;
  hasAudio: boolean;
  audioCodec?: string;
}

export interface ExportStartRequest {
  sourceId: string;
  outputWidth: number;
  outputHeight: number;
  fps: number;
  duration: number;
  audioMode: AudioMode;
  defaultName: string;
  outputPath?: string;
}

export interface ExportStartResult {
  canceled: boolean;
  jobId?: string;
  outputPath?: string;
  audioMode?: AudioMode;
}

export interface ExportFinishResult {
  outputPath: string;
  stderr: string;
}

export interface SnapshotRequest {
  dataUrl: string;
  defaultName: string;
}
