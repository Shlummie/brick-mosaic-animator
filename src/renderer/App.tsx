import {
  Camera,
  Download,
  FileVideo,
  FolderOpen,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Square,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AudioMode, DitherMode, RenderSettings, VideoMetadata } from "../shared/types";
import { StudRenderer } from "./studRenderer";
import studUrl from "../../stud-texture.svg?url";

interface ExportState {
  active: boolean;
  frame: number;
  totalFrames: number;
  message: string;
  outputPath?: string;
}

const initialSettings: RenderSettings = {
  columns: 96,
  rows: 54,
  studSizePx: 10,
  gapPx: 1,
  brightness: 0,
  contrast: 0,
  ditherMode: "ordered",
  lightingDepth: 72,
  showStudEdges: true,
  exportFps: "source"
};

function deriveRows(columns: number, metadata: VideoMetadata | null): number {
  if (!metadata?.width || !metadata.height) return Math.round(columns * 9 / 16);
  return Math.max(8, Math.round(columns * metadata.height / metadata.width));
}

function outputSize(settings: RenderSettings): { width: number; height: number } {
  return {
    width: settings.columns * settings.studSizePx + (settings.columns - 1) * settings.gapPx,
    height: settings.rows * settings.studSizePx + (settings.rows - 1) * settings.gapPx
  };
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "00:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

function resolveFps(setting: RenderSettings["exportFps"], metadata: VideoMetadata): number {
  if (setting === "source") return Math.min(Math.max(metadata.fps || 30, 1), 60);
  return setting;
}

function waitForLoadedMetadata(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= 1) return Promise.resolve();
  return new Promise((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("Could not load video metadata."));
  });
}

function waitForSeek(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const target = Math.max(0, Math.min(time, Math.max(0, video.duration - 0.001)));
    const cleanup = () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
    };
    const finish = () => {
      if (video.requestVideoFrameCallback) {
        video.requestVideoFrameCallback(() => resolve());
      } else {
        requestAnimationFrame(() => resolve());
      }
    };
    const onSeeked = () => {
      cleanup();
      finish();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Video seek failed during export."));
    };

    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onError, { once: true });
    if (Math.abs(video.currentTime - target) < 0.0005) {
      cleanup();
      finish();
    } else {
      video.currentTime = target;
    }
  });
}

export function App(): JSX.Element {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<StudRenderer | null>(null);
  const cancelExportRef = useRef(false);
  const activeJobRef = useRef<string | null>(null);

  const [rendererReady, setRendererReady] = useState(false);
  const [video, setVideo] = useState<VideoMetadata | null>(null);
  const [settings, setSettings] = useState<RenderSettings>(initialSettings);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [status, setStatus] = useState("Open a video to begin.");
  const [exportState, setExportState] = useState<ExportState>({
    active: false,
    frame: 0,
    totalFrames: 0,
    message: "Idle"
  });

  const renderSettings = useMemo<RenderSettings>(
    () => ({
      ...settings,
      rows: deriveRows(settings.columns, video)
    }),
    [settings, video]
  );
  const previewSize = useMemo(() => outputSize(renderSettings), [renderSettings]);

  const renderPreview = useCallback(() => {
    const renderer = rendererRef.current;
    const source = videoRef.current;
    const canvas = canvasRef.current;
    if (!rendererReady || !renderer || !source || !canvas || !video || source.readyState < 2) return;
    renderer.renderFrame({ source, canvas, settings: renderSettings });
  }, [renderSettings, rendererReady, video]);

  useEffect(() => {
    const renderer = new StudRenderer(studUrl);
    rendererRef.current = renderer;
    renderer.ready().then(() => {
      setRendererReady(true);
      setStatus("Stud texture loaded.");
    }).catch((error) => setStatus(error.message));
  }, []);

  useEffect(() => {
    const source = videoRef.current;
    if (!source) return;

    const syncTime = () => setCurrentTime(source.currentTime);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => setIsPlaying(false);
    source.addEventListener("timeupdate", syncTime);
    source.addEventListener("seeked", renderPreview);
    source.addEventListener("play", onPlay);
    source.addEventListener("pause", onPause);
    source.addEventListener("ended", onEnded);

    return () => {
      source.removeEventListener("timeupdate", syncTime);
      source.removeEventListener("seeked", renderPreview);
      source.removeEventListener("play", onPlay);
      source.removeEventListener("pause", onPause);
      source.removeEventListener("ended", onEnded);
    };
  }, [renderPreview]);

  useEffect(() => {
    const source = videoRef.current;
    if (!source || !video || !rendererReady) return;

    let raf = 0;
    let videoFrame = 0;
    let canceled = false;

    const draw = () => {
      if (canceled) return;
      renderPreview();
      setCurrentTime(source.currentTime);
      if (!source.paused && !source.ended) schedule();
    };

    const schedule = () => {
      if (source.requestVideoFrameCallback) {
        videoFrame = source.requestVideoFrameCallback(draw);
      } else {
        raf = requestAnimationFrame(draw);
      }
    };

    renderPreview();
    if (!source.paused && !source.ended) schedule();

    return () => {
      canceled = true;
      if (videoFrame && source.cancelVideoFrameCallback) source.cancelVideoFrameCallback(videoFrame);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [isPlaying, renderPreview, rendererReady, video]);

  async function loadVideo(info: VideoMetadata): Promise<void> {
    const source = videoRef.current;
    if (!source) return;
    source.pause();
    source.src = info.url;
    source.load();
    setVideo(info);
    setCurrentTime(0);
    setIsPlaying(false);
    setStatus(`${info.name} loaded.`);
    await waitForLoadedMetadata(source);
    renderPreview();
  }

  async function openVideo(): Promise<void> {
    const info = await window.brick.openVideo();
    if (info) await loadVideo(info);
  }

  async function registerDroppedFile(file: File): Promise<void> {
    const filePath = window.brick.getPathForDraggedFile(file);
    if (!filePath) {
      setStatus("Dropped file path could not be read.");
      return;
    }
    const info = await window.brick.registerVideoPath(filePath);
    await loadVideo(info);
  }

  async function togglePlayback(): Promise<void> {
    const source = videoRef.current;
    if (!source || !video) return;
    if (source.paused) {
      await source.play();
    } else {
      source.pause();
    }
  }

  function seekTo(time: number): void {
    const source = videoRef.current;
    if (!source || !video) return;
    source.currentTime = Math.max(0, Math.min(time, source.duration || video.duration));
    setCurrentTime(source.currentTime);
  }

  function frameStep(direction: -1 | 1): void {
    const source = videoRef.current;
    if (!source || !video) return;
    source.pause();
    seekTo(source.currentTime + direction / Math.max(video.fps || 30, 1));
  }

  async function saveSnapshot(): Promise<void> {
    const canvas = canvasRef.current;
    if (!canvas || !video) return;
    const filePath = await window.brick.saveSnapshot({
      dataUrl: canvas.toDataURL("image/png"),
      defaultName: `${baseName(video.name)}-brick-frame.png`
    });
    if (filePath) setStatus(`Snapshot saved: ${filePath}`);
  }

  async function runExport(audioMode: AudioMode, outputPath?: string): Promise<string | null> {
    if (!video || !rendererRef.current) return null;
    const renderer = rendererRef.current;
    await renderer.ready();

    const fps = resolveFps(renderSettings.exportFps, video);
    const duration = Math.max(video.duration, 0.001);
    const totalFrames = Math.max(1, Math.ceil(duration * fps));
    const size = outputSize(renderSettings);
    const start = await window.brick.startExport({
      sourceId: video.id,
      outputWidth: size.width,
      outputHeight: size.height,
      fps,
      duration,
      audioMode,
      defaultName: `${baseName(video.name)}-brick.mp4`,
      outputPath
    });

    if (start.canceled || !start.jobId || !start.outputPath) return null;
    activeJobRef.current = start.jobId;

    const exportVideo = document.createElement("video");
    exportVideo.src = video.url;
    exportVideo.muted = true;
    exportVideo.preload = "auto";
    await waitForLoadedMetadata(exportVideo);

    const exportCanvas = document.createElement("canvas");
    setExportState({
      active: true,
      frame: 0,
      totalFrames,
      outputPath: start.outputPath,
      message: audioMode === "copy" ? "Encoding with copied source audio..." : "Encoding with AAC audio..."
    });

    for (let frame = 0; frame < totalFrames; frame += 1) {
      if (cancelExportRef.current) {
        await window.brick.cancelExport(start.jobId);
        activeJobRef.current = null;
        return null;
      }

      await waitForSeek(exportVideo, frame / fps);
      renderer.renderFrame({ source: exportVideo, canvas: exportCanvas, settings: renderSettings });
      await window.brick.writeExportFrame(start.jobId, renderer.readRawRgba(exportCanvas));

      if (frame % 4 === 0 || frame === totalFrames - 1) {
        setExportState((state) => ({
          ...state,
          frame: frame + 1,
          message: `${audioMode === "copy" ? "Copying source audio" : "Muxing AAC audio"} · ${frame + 1}/${totalFrames} frames`
        }));
      }
    }

    const result = await window.brick.finishExport(start.jobId);
    activeJobRef.current = null;
    return result.outputPath;
  }

  async function exportMp4(): Promise<void> {
    if (!video || exportState.active) return;
    cancelExportRef.current = false;
    setStatus("Export started.");

    try {
      let outputPath = await runExport("copy");
      if (!outputPath) {
        setExportState((state) => ({ ...state, active: false, message: "Export canceled." }));
        setStatus("Export canceled.");
        return;
      }

      setExportState((state) => ({ ...state, active: false, outputPath, message: "Export complete." }));
      setStatus(`Export complete: ${outputPath}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const previousOutput = exportState.outputPath;
      if (video.hasAudio && previousOutput) {
        setStatus("Audio copy failed; retrying export with AAC audio.");
        cancelExportRef.current = false;
        try {
          const outputPath = await runExport("aac", previousOutput);
          if (outputPath) {
            setExportState((state) => ({ ...state, active: false, outputPath, message: "Export complete." }));
            setStatus(`Export complete: ${outputPath}`);
            return;
          }
        } catch (fallbackError) {
          setStatus(fallbackError instanceof Error ? fallbackError.message : String(fallbackError));
        }
      } else {
        setStatus(message);
      }
      setExportState((state) => ({ ...state, active: false, message: "Export failed." }));
    }
  }

  async function cancelExport(): Promise<void> {
    cancelExportRef.current = true;
    const jobId = activeJobRef.current;
    if (jobId) await window.brick.cancelExport(jobId);
    activeJobRef.current = null;
    setExportState((state) => ({ ...state, active: false, message: "Export canceled." }));
    setStatus("Export canceled.");
  }

  function updateSetting<K extends keyof RenderSettings>(key: K, value: RenderSettings[K]): void {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  const progress = video?.duration ? currentTime / video.duration : 0;
  const exportProgress = exportState.totalFrames
    ? Math.round((exportState.frame / exportState.totalFrames) * 100)
    : 0;

  return (
    <main
      className={`app ${isDragging ? "is-dragging" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={async (event) => {
        event.preventDefault();
        setIsDragging(false);
        const file = event.dataTransfer.files[0];
        if (file) await registerDroppedFile(file);
      }}
    >
      <video ref={videoRef} className="source-video" playsInline muted />

      <header className="toolbar">
        <div className="brand">
          <div className="brand-mark" />
          <span>Brick Mosaic Animator</span>
        </div>
        <button className="toolbar-button" onClick={openVideo}>
          <FolderOpen size={18} />
          Open Video
        </button>
        <div className="file-status">
          <FileVideo size={16} />
          <span>{video?.name ?? "No video selected"}</span>
          {video && (
            <span className="metadata">
              {video.width}×{video.height} · {video.fps.toFixed(2)} FPS · {formatTime(video.duration)}
            </span>
          )}
        </div>
        <button className="primary-button" disabled={!video || exportState.active} onClick={exportMp4}>
          <Download size={18} />
          Export MP4
        </button>
      </header>

      <section className="workspace">
        <div className="stage-column">
          <div className="preview-shell">
            {video ? (
              <canvas
                ref={canvasRef}
                className="preview-canvas"
                style={{ aspectRatio: `${Math.max(previewSize.width, 1)} / ${Math.max(previewSize.height, 1)}` }}
              />
            ) : (
              <button className="drop-zone" onClick={openVideo}>
                <FileVideo size={38} />
                <span>Open or drop a video</span>
              </button>
            )}
          </div>

          <div className="timeline-panel">
            <div className="time-row">
              <span>{formatTime(currentTime)}</span>
              <input
                aria-label="Seek"
                disabled={!video}
                type="range"
                min={0}
                max={video?.duration || 0}
                step={0.01}
                value={currentTime}
                onChange={(event) => seekTo(Number(event.target.value))}
                style={{ backgroundSize: `${Math.max(0, Math.min(1, progress)) * 100}% 100%` }}
              />
              <span>{formatTime(video?.duration ?? 0)}</span>
            </div>
            <div className="transport-row">
              <button className="icon-button" disabled={!video} onClick={() => frameStep(-1)} title="Previous frame">
                <SkipBack size={18} />
              </button>
              <button className="play-button" disabled={!video} onClick={togglePlayback}>
                {isPlaying ? <Pause size={18} /> : <Play size={18} />}
                {isPlaying ? "Pause" : "Play"}
              </button>
              <button className="icon-button" disabled={!video} onClick={() => frameStep(1)} title="Next frame">
                <SkipForward size={18} />
              </button>
              <button className="toolbar-button" disabled={!video} onClick={saveSnapshot}>
                <Camera size={17} />
                Snapshot
              </button>
              {exportState.active ? (
                <button className="danger-button" onClick={cancelExport}>
                  <X size={17} />
                  Cancel Export
                </button>
              ) : (
                <button className="toolbar-button" disabled={!video} onClick={() => seekTo(0)}>
                  <Square size={15} />
                  Reset
                </button>
              )}
            </div>
            <div className="status-row">
              <span>{status}</span>
              {exportState.active && (
                <span className="export-progress">
                  {exportProgress}% · {exportState.message}
                </span>
              )}
            </div>
          </div>
        </div>

        <aside className="inspector">
          <div className="tabs">
            <button className="active">Design</button>
            <button>Lighting</button>
            <button>Export</button>
          </div>

          <Control label="Stud Resolution" value={`${renderSettings.columns} × ${renderSettings.rows}`}>
            <input
              type="range"
              min={24}
              max={220}
              step={1}
              value={settings.columns}
              onChange={(event) => updateSetting("columns", Number(event.target.value))}
            />
          </Control>

          <Control label="Stud Size" value={`${settings.studSizePx}px`}>
            <input
              type="range"
              min={6}
              max={18}
              step={1}
              value={settings.studSizePx}
              onChange={(event) => updateSetting("studSizePx", Number(event.target.value))}
            />
          </Control>

          <Control label="Gap Between Studs" value={`${settings.gapPx}px`}>
            <input
              type="range"
              min={0}
              max={5}
              step={1}
              value={settings.gapPx}
              onChange={(event) => updateSetting("gapPx", Number(event.target.value))}
            />
          </Control>

          <Control label="Color Mode" value="Brick Palette">
            <select disabled value="brick">
              <option value="brick">Brick Palette</option>
            </select>
          </Control>

          <Control label="Brightness" value={`${settings.brightness}`}>
            <input
              type="range"
              min={-80}
              max={80}
              step={1}
              value={settings.brightness}
              onChange={(event) => updateSetting("brightness", Number(event.target.value))}
            />
          </Control>

          <Control label="Contrast" value={`${settings.contrast}`}>
            <input
              type="range"
              min={-80}
              max={80}
              step={1}
              value={settings.contrast}
              onChange={(event) => updateSetting("contrast", Number(event.target.value))}
            />
          </Control>

          <Control label="Dithering" value="">
            <select
              value={settings.ditherMode}
              onChange={(event) => updateSetting("ditherMode", event.target.value as DitherMode)}
            >
              <option value="ordered">Ordered</option>
              <option value="floyd-steinberg">Floyd-Steinberg</option>
              <option value="none">Off</option>
            </select>
          </Control>

          <Control label="Lighting / Depth" value={`${settings.lightingDepth}%`}>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={settings.lightingDepth}
              onChange={(event) => updateSetting("lightingDepth", Number(event.target.value))}
            />
          </Control>

          <div className="switch-row">
            <span>Show Stud Edges</span>
            <label className="switch">
              <input
                type="checkbox"
                checked={settings.showStudEdges}
                onChange={(event) => updateSetting("showStudEdges", event.target.checked)}
              />
              <span />
            </label>
          </div>

          <Control label="Export FPS" value="">
            <select
              value={settings.exportFps}
              onChange={(event) => {
                const value = event.target.value;
                updateSetting("exportFps", value === "source" ? "source" : (Number(value) as 24 | 30 | 60));
              }}
            >
              <option value="source">Source, capped at 60</option>
              <option value={24}>24 FPS</option>
              <option value={30}>30 FPS</option>
              <option value={60}>60 FPS</option>
            </select>
          </Control>

          <div className="export-card">
            <span>Canvas Output</span>
            <strong>{previewSize.width} × {previewSize.height}</strong>
            <small>{video?.hasAudio ? `Source audio: ${video.audioCodec ?? "detected"}` : "No source audio track detected"}</small>
          </div>
        </aside>
      </section>
    </main>
  );
}

function Control({
  label,
  value,
  children
}: {
  label: string;
  value: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <label className="control">
      <span>
        {label}
        {value && <strong>{value}</strong>}
      </span>
      {children}
    </label>
  );
}
