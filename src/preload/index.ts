import { contextBridge, ipcRenderer, webUtils } from "electron";
import type {
  ExportFinishResult,
  ExportStartRequest,
  ExportStartResult,
  SnapshotRequest,
  VideoMetadata
} from "../shared/types";

const api = {
  openVideo: (): Promise<VideoMetadata | null> => ipcRenderer.invoke("video:open"),
  registerVideoPath: (filePath: string): Promise<VideoMetadata> =>
    ipcRenderer.invoke("video:register-path", filePath),
  getPathForDraggedFile: (file: File): string => webUtils.getPathForFile(file),
  saveSnapshot: (request: SnapshotRequest): Promise<string | null> =>
    ipcRenderer.invoke("snapshot:save", request),
  startExport: (request: ExportStartRequest): Promise<ExportStartResult> =>
    ipcRenderer.invoke("export:start", request),
  writeExportFrame: (jobId: string, frame: ArrayBuffer): Promise<void> =>
    ipcRenderer.invoke("export:frame", jobId, frame),
  finishExport: (jobId: string): Promise<ExportFinishResult> =>
    ipcRenderer.invoke("export:finish", jobId),
  cancelExport: (jobId: string): Promise<void> => ipcRenderer.invoke("export:cancel", jobId)
};

contextBridge.exposeInMainWorld("brick", api);

export type BrickApi = typeof api;
