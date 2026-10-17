---
name: video-frames
description: >
  Look at a short video frame by frame. Extracts timestamped frames and contact
  sheets (many frames tiled into one image) with ffmpeg, so you can Read them
  as images. Use when the user shares or points to a video, screen recording,
  GIF or clip and asks what happens in it, wants a frame at a time, a
  keyframe, a thumbnail, scene changes, or to check an animation, a UI
  recording, a 3D scene capture or an agent-browser recording.
---

# video-frames

You cannot watch video. You can read images. This skill turns a video into images you can read, with exact timestamps.

Needs `ffmpeg` and `ffprobe` on PATH. Check with `ffmpeg -version`.

## Run

```bash
python3 <this skill's folder>/scripts/frames.py <video> [mode] [options]
```

The folder is `.claude/skills/video-frames` in a project, or `~/.claude/skills/video-frames` when installed globally.

| Mode | Use it for |
|---|---|
| (default) `--count 16` | First look. 16 frames spread over the whole clip, one contact sheet. |
| `--every 0.5` | Steady sampling: one frame every 0.5 s. |
| `--scenes 0.3` | Cuts and big changes only. Lower threshold = more frames. |
| `--all` | Frame by frame. Use with `--start`/`--end` on a short window. |

| Option | Default | Meaning |
|---|---|---|
| `--start S`, `--end S` | whole clip | Window in seconds |
| `--width W` | 640 | Frame width; height keeps the aspect ratio |
| `--sheet CxR` | 4x4 | Contact sheet grid, or `none` for single frames only |
| `--max N` | 300 | Refuses jobs that would write more frames |
| `--out DIR` | new temp folder | Where frames, sheets and `manifest.json` go |
| `--no-label` | labels on when possible | Skip burned-in `hh:mm:ss.ms #n` labels (only drawn if this ffmpeg has `drawtext`) |

The script prints the folder, each sheet with the time span it covers, and `manifest.json` (every frame file with its exact time in seconds).

## Workflow

1. Overview: run the default. Read the sheet image. Sheets go left to right, top to bottom, in time order; the printed span and the manifest give the times.
2. Zoom: pick the interesting window and rerun with `--start/--end` plus `--every 0.1` or `--all`.
3. Detail: Read single frames (`f_0001.jpg`...) when a sheet tile is too small. Raise `--width` for small text.
4. Report times from the manifest, not from guessing tile positions.

## Budget

- One 4x4 sheet costs about the same as one image. Prefer sheets over many single frames.
- `--all` on 30 fps video is 30 images per second. Keep windows short (a second or two) or use `--every`.
- For long videos, sample with `--scenes` or `--every`, then zoom.

## Ways it fails

1. `ffmpeg not found on PATH`: install ffmpeg (static builds work; no root needed in `~/.local/bin`).
2. `would write about N frames`: narrow the window, switch to `--every`, or raise `--max` on purpose.
3. `--scenes` returns 0 or 1 frames: the threshold is too high; try 0.15.
4. No timestamp labels on frames: this ffmpeg build lacks `drawtext`. Use the manifest and the printed spans instead.
5. Variable frame rate recordings: trust `manifest.json` times, not frame index × fps.
