# Brick Mosaic Animator

A Windows-first Electron application that turns video frames into generic brick-stud mosaics. It previews the effect interactively, exports still PNGs, and streams rendered RGBA frames to bundled FFmpeg for MP4 output.

## Features

- Open or drag a local video into the app.
- Choose grid columns/rows, stud size, gap, lighting depth, edge treatment, brightness, contrast, and dithering.
- Quantize sampled pixels to a curated brick-like color palette.
- Use no dithering, ordered Bayer dithering, or Floyd–Steinberg error diffusion.
- Save the current frame as PNG.
- Export H.264 MP4 while copying compatible source audio or retrying with AAC.
- Cancel an in-progress export cleanly.

## Pipeline

```text
video -> FFprobe metadata -> browser video element -> downsampled canvas
      -> palette quantization -> unbranded stud texture tinting -> preview/export canvas
      -> raw RGBA pipe -> FFmpeg H.264 + optional source audio -> MP4
```

The renderer recolors `stud-texture.svg`, an original unbranded texture. No branded brick image is included, and the app is not affiliated with a toy manufacturer.

## Install and run

Requirements: Node.js 20+ on Windows.

```bash
npm install
npm run dev
```

Build/type-check:

```bash
npm run build
```

Create an unpacked Windows build or installer:

```bash
npm run pack
npm run dist
```

FFmpeg and FFprobe are installed through `ffmpeg-static` and `ffprobe-static`; their binaries are not committed directly.

## Architecture and security

The Electron window uses context isolation, no renderer Node integration, and a sandboxed renderer. A narrow preload API exposes file dialogs, trusted drag-path resolution, video registration, snapshots, and export jobs. A custom `brick-video` protocol serves only paths explicitly registered by the main process.

Videos remain local. Exporting can be CPU-intensive and may require substantial temporary disk space. The application does not provide DRM circumvention; process only media you are authorized to transform.

## Limitations

- Desktop Electron application; packaging is currently Windows-oriented.
- Very large grids or long videos can be slow and memory intensive.
- Audio stream copy depends on codec/container compatibility; AAC fallback changes the audio encoding.
- The palette is an artistic approximation, not a bill of materials or physical inventory tool.

## License

Original source is MIT licensed. `stud-texture.svg` is CC0; see `ASSET_LICENSES.md`. Electron, React, FFmpeg, FFprobe, and npm dependencies retain their upstream licenses.
