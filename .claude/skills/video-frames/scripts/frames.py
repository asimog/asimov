#!/usr/bin/env python3
"""Extract frames from a short video so an agent can look at them.

Writes timestamp-labelled JPG frames, contact sheets (many frames in one
image), and manifest.json. Needs ffmpeg and ffprobe on PATH. Stdlib only.
"""
import argparse, json, os, re, shutil, subprocess, sys, tempfile
from pathlib import Path

FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
    "/System/Library/Fonts/Menlo.ttc",
    "C:/Windows/Fonts/consola.ttf",
]


def die(msg):
    sys.exit(f"frames.py: {msg}")


def probe(video):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height,avg_frame_rate,nb_frames:format=duration",
         "-of", "json", str(video)],
        capture_output=True, text=True)
    if out.returncode:
        die(f"ffprobe failed: {out.stderr.strip()}")
    d = json.loads(out.stdout)
    if not d.get("streams"):
        die("no video stream found")
    s = d["streams"][0]
    num, den = (s.get("avg_frame_rate") or "0/1").split("/")
    fps = float(num) / float(den) if float(den) else 0.0
    return {
        "duration": float(d.get("format", {}).get("duration") or 0),
        "fps": round(fps, 3),
        "width": s.get("width"),
        "height": s.get("height"),
    }


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("video")
    mode = p.add_mutually_exclusive_group()
    mode.add_argument("--count", type=int, help="N frames spread evenly (default 16)")
    mode.add_argument("--every", type=float, help="one frame every SEC seconds")
    mode.add_argument("--scenes", type=float, help="frames at scene changes; threshold 0..1, try 0.3")
    mode.add_argument("--all", action="store_true", help="every frame (frame by frame)")
    p.add_argument("--start", type=float, default=0.0, help="start second")
    p.add_argument("--end", type=float, help="end second")
    p.add_argument("--width", type=int, default=640, help="frame width in px (default 640)")
    p.add_argument("--sheet", default="4x4", help="contact sheet grid COLSxROWS, or 'none'")
    p.add_argument("--max", type=int, default=300, help="refuse to write more frames than this")
    p.add_argument("--out", help="output folder (default: a new temp folder)")
    p.add_argument("--no-label", action="store_true", help="do not burn timestamps into frames")
    a = p.parse_args()

    for tool in ("ffmpeg", "ffprobe"):
        if not shutil.which(tool):
            die(f"{tool} not found on PATH")
    video = Path(a.video)
    if not video.exists():
        die(f"no such file: {video}")

    info = probe(video)
    end = a.end if a.end is not None else info["duration"]
    clip = max(end - a.start, 0.001)

    if a.all:
        expected = clip * (info["fps"] or 30)
        vf = []
    elif a.every:
        expected = clip / a.every
        vf = [f"fps=1/{a.every}"]
    elif a.scenes is not None:
        expected = None
        vf = [f"select='gt(scene,{a.scenes})'"]
    else:
        n = a.count or 16
        expected = n
        vf = [f"fps={n}/{clip}"]
    if expected and expected > a.max:
        die(f"would write about {int(expected)} frames (> --max {a.max}); narrow --start/--end or raise --max")

    vf.append(f"scale={a.width}:-2")
    font = next((f for f in FONT_CANDIDATES if os.path.exists(f)), None)
    has_drawtext = " drawtext " in subprocess.run(
        ["ffmpeg", "-hide_banner", "-filters"], capture_output=True, text=True).stdout
    if font and has_drawtext and not a.no_label:
        vf.append(
            f"drawtext=fontfile='{font}':text='%{{pts\\:hms\\:{a.start}}}  #%{{n}}'"
            ":x=8:y=8:fontsize=18:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=4")
    vf.append("showinfo")

    out = Path(a.out) if a.out else Path(tempfile.mkdtemp(prefix=f"frames-{video.stem}-"))
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("f_*.jpg"):
        old.unlink()
    for old in out.glob("sheet_*.jpg"):
        old.unlink()

    cmd = ["ffmpeg", "-hide_banner", "-y", "-ss", str(a.start)]
    if a.end is not None:
        cmd += ["-to", str(a.end)]
    cmd += ["-i", str(video), "-vf", ",".join(vf), "-fps_mode", "vfr",
            "-frames:v", str(a.max), "-q:v", "3", str(out / "f_%04d.jpg")]
    run = subprocess.run(cmd, capture_output=True, text=True)
    if run.returncode:
        die(f"ffmpeg failed:\n{run.stderr[-2000:]}")

    times = [a.start + float(t) for t in re.findall(r"pts_time:([0-9.]+)", run.stderr)]
    files = sorted(out.glob("f_*.jpg"))
    frames = [{"file": str(f), "t": round(times[i], 3) if i < len(times) else None}
              for i, f in enumerate(files)]

    sheets = []
    if a.sheet != "none" and len(files) > 1:
        cols, rows = (int(x) for x in a.sheet.lower().split("x"))
        s = subprocess.run(
            ["ffmpeg", "-hide_banner", "-y", "-framerate", "1", "-i", str(out / "f_%04d.jpg"),
             "-vf", f"tile={cols}x{rows}:padding=4:margin=4", "-fps_mode", "vfr",
             "-q:v", "3", str(out / "sheet_%03d.jpg")],
            capture_output=True, text=True)
        if s.returncode:
            die(f"contact sheet failed:\n{s.stderr[-2000:]}")
        per = cols * rows
        for i, f in enumerate(sorted(out.glob("sheet_*.jpg"))):
            chunk = frames[i * per:(i + 1) * per]
            sheets.append({"file": str(f), "frames": [c["t"] for c in chunk]})

    manifest = {"video": str(video), "probe": info, "start": a.start, "end": end,
                "frames": frames, "sheets": sheets}
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2))

    print(f"video: {video}  duration {info['duration']:.2f}s  {info['width']}x{info['height']} @ {info['fps']} fps")
    print(f"frames: {len(frames)}  sheets: {len(sheets)}  folder: {out}")
    for s in sheets:
        ts = [t for t in s["frames"] if t is not None]
        span = f"{ts[0]:.2f}s to {ts[-1]:.2f}s" if ts else "?"
        print(f"  sheet {s['file']}  ({len(s['frames'])} frames, {span})")
    if not sheets:
        for f in frames:
            print(f"  frame {f['file']}  t={f['t']}")
    print(f"manifest: {out / 'manifest.json'}")


if __name__ == "__main__":
    main()
