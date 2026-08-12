import { app, BrowserWindow, dialog, ipcMain, net, protocol } from "electron";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { Readable, Writable } from "node:stream";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import ffmpegPathRaw from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import type {
  AudioMode,
  ExportFinishResult,
  ExportStartRequest,
  ExportStartResult,
  SnapshotRequest,
  VideoMetadata
} from "../shared/types";

interface RegisteredVideo extends VideoMetadata {
  path: string;
}

interface ExportJob {
  id: string;
  process: ChildProcessByStdio<Writable, null, Readable>;
  outputPath: string;
  stderr: string;
  done: Promise<ExportFinishResult>;
  resolveDone: (result: ExportFinishResult) => void;
  rejectDone: (error: Error) => void;
}

const videos = new Map<string, RegisteredVideo>();
const exportJobs = new Map<string, ExportJob>();

protocol.registerSchemesAsPrivileged([
  {
    scheme: "brick-video",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true
    }
  }
]);

function resolveBundledPath(binaryPath: string | null | undefined): string {
  if (!binaryPath) {
    throw new Error("Bundled FFmpeg binary was not found.");
  }
  return app.isPackaged ? binaryPath.replace("app.asar", "app.asar.unpacked") : binaryPath;
}

function parseRational(value?: string): number | undefined {
  if (!value || value === "0/0") return undefined;
  const [a, b] = value.split("/").map(Number);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return undefined;
  return a / b;
}

function runProcess(command: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ stdout, stderr, code: code ?? 1 });
    });
  });
}

async function probeVideo(filePath: string): Promise<Omit<VideoMetadata, "id" | "name" | "url">> {
  const ffprobePath = resolveBundledPath(ffprobeStatic.path);
  const result = await runProcess(ffprobePath, [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    filePath
  ]);

  if (result.code !== 0) {
    throw new Error(result.stderr || "FFprobe could not read this video.");
  }

  const payload = JSON.parse(result.stdout) as {
    format?: { duration?: string };
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      width?: number;
      height?: number;
      duration?: string;
      avg_frame_rate?: string;
      r_frame_rate?: string;
    }>;
  };

  const videoStream = payload.streams?.find((stream) => stream.codec_type === "video");
  if (!videoStream?.width || !videoStream.height) {
    throw new Error("No video stream was found in this file.");
  }

  const audioStream = payload.streams?.find((stream) => stream.codec_type === "audio");
  const fps =
    parseRational(videoStream.avg_frame_rate) ??
    parseRational(videoStream.r_frame_rate) ??
    30;

  return {
    width: videoStream.width,
    height: videoStream.height,
    duration: Number(payload.format?.duration ?? videoStream.duration ?? 0),
    fps: Math.min(Math.max(fps, 1), 120),
    hasAudio: Boolean(audioStream),
    audioCodec: audioStream?.codec_name
  };
}

async function registerVideo(filePath: string): Promise<RegisteredVideo> {
  const metadata = await probeVideo(filePath);
  const id = randomUUID();
  const name = path.basename(filePath);
  const video: RegisteredVideo = {
    id,
    name,
    path: filePath,
    url: `brick-video://${id}/${encodeURIComponent(name)}`,
    ...metadata
  };
  videos.set(id, video);
  return video;
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1040,
    minHeight: 720,
    title: "Brick Mosaic Animator",
    backgroundColor: "#f5f6f8",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  protocol.handle("brick-video", async (request) => {
    const url = new URL(request.url);
    const video = videos.get(url.hostname);
    if (!video) {
      return new Response("Video not registered", { status: 404 });
    }
    return net.fetch(pathToFileURL(video.path).toString());
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  for (const job of exportJobs.values()) {
    job.process.kill();
  }
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("video:open", async () => {
  const result = await dialog.showOpenDialog({
    title: "Open video",
    properties: ["openFile"],
    filters: [
      { name: "Videos", extensions: ["mp4", "mov", "m4v", "webm", "mkv", "avi"] },
      { name: "All files", extensions: ["*"] }
    ]
  });

  if (result.canceled || result.filePaths.length === 0) return null;
  return registerVideo(result.filePaths[0]);
});

ipcMain.handle("video:register-path", async (_event, filePath: string) => {
  return registerVideo(filePath);
});

ipcMain.handle("snapshot:save", async (_event, request: SnapshotRequest) => {
  const result = await dialog.showSaveDialog({
    title: "Save snapshot",
    defaultPath: request.defaultName,
    filters: [{ name: "PNG image", extensions: ["png"] }]
  });

  if (result.canceled || !result.filePath) return null;
  const base64 = request.dataUrl.replace(/^data:image\/png;base64,/, "");
  await fs.writeFile(result.filePath, Buffer.from(base64, "base64"));
  return result.filePath;
});

ipcMain.handle("export:start", async (_event, request: ExportStartRequest): Promise<ExportStartResult> => {
  const source = videos.get(request.sourceId);
  if (!source) {
    throw new Error("The selected source video is no longer available.");
  }

  const selectedPath =
    request.outputPath ??
    (
      await dialog.showSaveDialog({
        title: "Export MP4",
        defaultPath: request.defaultName,
        filters: [{ name: "MP4 video", extensions: ["mp4"] }]
      })
    ).filePath;

  if (!selectedPath) return { canceled: true };

  const ffmpegPath = resolveBundledPath(ffmpegPathRaw);
  const jobId = randomUUID();
  const audioArgs =
    source.hasAudio && request.audioMode === "copy"
      ? ["-c:a", "copy"]
      : source.hasAudio
        ? ["-c:a", "aac", "-b:a", "320k"]
        : ["-an"];

  const args = [
    "-hide_banner",
    "-y",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgba",
    "-s",
    `${request.outputWidth}x${request.outputHeight}`,
    "-r",
    String(request.fps),
    "-i",
    "pipe:0",
    "-i",
    source.path,
    "-map",
    "0:v:0",
    "-map",
    "1:a?",
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "14",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    ...audioArgs,
    "-shortest",
    selectedPath
  ];

  const child = spawn(ffmpegPath, args, {
    stdio: ["pipe", "ignore", "pipe"],
    windowsHide: true
  });

  let resolveDone!: (result: ExportFinishResult) => void;
  let rejectDone!: (error: Error) => void;
  const done = new Promise<ExportFinishResult>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });

  const job: ExportJob = {
    id: jobId,
    process: child,
    outputPath: selectedPath,
    stderr: "",
    done,
    resolveDone,
    rejectDone
  };
  exportJobs.set(jobId, job);

  child.stderr.on("data", (chunk: Buffer) => {
    job.stderr += chunk.toString();
  });
  child.on("error", (error) => {
    exportJobs.delete(jobId);
    rejectDone(error);
  });
  child.on("close", (code) => {
    exportJobs.delete(jobId);
    if (code === 0) {
      resolveDone({ outputPath: selectedPath, stderr: job.stderr });
    } else {
      rejectDone(new Error(job.stderr || `FFmpeg exited with code ${code ?? 1}.`));
    }
  });

  return {
    canceled: false,
    jobId,
    outputPath: selectedPath,
    audioMode: request.audioMode
  };
});

ipcMain.handle("export:frame", async (_event, jobId: string, frame: ArrayBuffer) => {
  const job = exportJobs.get(jobId);
  if (!job) {
    throw new Error("Export job is no longer active.");
  }

  await new Promise<void>((resolve, reject) => {
    const chunk = Buffer.from(new Uint8Array(frame));
    const onError = (error: Error) => {
      job.process.stdin.off("drain", onDrain);
      reject(error);
    };
    const onDrain = () => {
      job.process.stdin.off("error", onError);
      resolve();
    };

    job.process.stdin.once("error", onError);
    if (job.process.stdin.write(chunk)) {
      job.process.stdin.off("error", onError);
      resolve();
    } else {
      job.process.stdin.once("drain", onDrain);
    }
  });
});

ipcMain.handle("export:finish", async (_event, jobId: string) => {
  const job = exportJobs.get(jobId);
  if (!job) {
    throw new Error("Export job is no longer active.");
  }
  job.process.stdin.end();
  return job.done;
});

ipcMain.handle("export:cancel", async (_event, jobId: string) => {
  const job = exportJobs.get(jobId);
  if (!job) return;
  job.process.kill();
  exportJobs.delete(jobId);
});
