#!/usr/bin/env python3
"""
Pinterest Downloader Web App.
FastAPI server providing a modern, minimal chat UI and download API.
"""

import os
import re
import shutil
import subprocess
import sys
from typing import List, Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DOWNLOAD_DIR = os.path.join(BASE_DIR, "Downloaded_Pins")
STATIC_DIR = os.path.join(BASE_DIR, "static")

os.makedirs(DOWNLOAD_DIR, exist_ok=True)
os.makedirs(STATIC_DIR, exist_ok=True)

app = FastAPI(title="Pinterest Artifact Downloader")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount downloaded files for direct browser streaming/downloading
app.mount("/downloads", StaticFiles(directory=DOWNLOAD_DIR), name="downloads")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

def get_gallery_dl_path() -> str:
    path = shutil.which("gallery-dl")
    if not path:
        fallback = "/Library/Frameworks/Python.framework/Versions/3.14/bin/gallery-dl"
        if os.path.exists(fallback):
            return fallback
        raise RuntimeError("gallery-dl binary not found. Install via: pip install gallery-dl")
    return path

def format_size(bytes_num: int) -> str:
    for unit in ["B", "KB", "MB", "GB"]:
        if bytes_num < 1024.0:
            return f"{bytes_num:.1f} {unit}"
        bytes_num /= 1024.0
    return f"{bytes_num:.1f} TB"

def get_media_type(filename: str) -> str:
    ext = os.path.splitext(filename)[1].lower()
    if ext in [".mp4", ".webm", ".mov", ".m4v"]:
        return "video"
    if ext in [".jpg", ".jpeg", ".png", ".webp", ".gif"]:
        return "image"
    return "file"

class DownloadRequest(BaseModel):
    url: str

class FileInfo(BaseModel):
    name: str
    url: str
    size: str
    media_type: str

class DownloadResponse(BaseModel):
    success: bool
    message: str
    files: List[FileInfo]
    error: Optional[str] = None

@app.get("/", response_class=HTMLResponse)
async def serve_index():
    index_file = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_file):
        with open(index_file, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    return HTMLResponse("<h1>Index file not found in static/</h1>")

@app.get("/api/history", response_model=List[FileInfo])
async def get_history():
    """Lists existing downloaded pins sorted newest first."""
    items = []
    if os.path.exists(DOWNLOAD_DIR):
        filenames = sorted(
            os.listdir(DOWNLOAD_DIR),
            key=lambda f: os.path.getmtime(os.path.join(DOWNLOAD_DIR, f)),
            reverse=True
        )
        for name in filenames:
            if name.startswith("."):
                continue
            path = os.path.join(DOWNLOAD_DIR, name)
            if os.path.isfile(path):
                size_str = format_size(os.path.getsize(path))
                items.append(FileInfo(
                    name=name,
                    url=f"/downloads/{name}",
                    size=size_str,
                    media_type=get_media_type(name)
                ))
    return items

@app.post("/api/download", response_model=DownloadResponse)
async def process_download(req: DownloadRequest):
    url = req.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="URL cannot be empty")

    if not re.search(r"(pinterest\.[a-z.]+|pin\.it)", url, re.IGNORECASE):
        raise HTTPException(status_code=400, detail="Invalid link. Please provide a pinterest.com or pin.it link.")

    try:
        bin_path = get_gallery_dl_path()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    # Snapshot existing files before download
    existing_files = set(os.listdir(DOWNLOAD_DIR))

    cmd = [
        bin_path,
        "--directory", DOWNLOAD_DIR,
        "--sleep", "0.5",
        "--sleep-request", "0.5",
        "--sleep-429", "10",
        url
    ]

    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Download timed out after 120 seconds.")

    all_output = (proc.stdout or "") + "\n" + (proc.stderr or "")

    # 1. Identify newly created files
    new_files = [
        f for f in os.listdir(DOWNLOAD_DIR)
        if f not in existing_files and not f.startswith(".")
    ]

    # 2. If already downloaded previously, parse gallery-dl stdout/stderr path matches
    if not new_files:
        matches = re.findall(rf"{re.escape(DOWNLOAD_DIR)}/([^ \r\n\t]+)", all_output)
        for m in matches:
            clean_name = os.path.basename(m.strip().rstrip("/"))
            if os.path.exists(os.path.join(DOWNLOAD_DIR, clean_name)) and clean_name not in new_files:
                new_files.append(clean_name)

    # 3. Fallback: check most recently modified file if returncode was 0
    if not new_files and proc.returncode == 0:
        candidates = [
            f for f in os.listdir(DOWNLOAD_DIR)
            if not f.startswith(".") and os.path.isfile(os.path.join(DOWNLOAD_DIR, f))
        ]
        if candidates:
            newest = max(candidates, key=lambda f: os.path.getmtime(os.path.join(DOWNLOAD_DIR, f)))
            new_files.append(newest)

    if not new_files and proc.returncode != 0:
        clean_error = proc.stderr.strip() or proc.stdout.strip() or "Failed to download media from Pinterest."
        # Extract the relevant error line
        lines = [l for l in clean_error.splitlines() if "[error]" in l or "Error" in l]
        err_msg = lines[-1] if lines else clean_error
        return DownloadResponse(
            success=False,
            message="Download failed",
            files=[],
            error=err_msg
        )

    file_infos = []
    for name in new_files:
        path = os.path.join(DOWNLOAD_DIR, name)
        size_str = format_size(os.path.getsize(path)) if os.path.exists(path) else "Unknown"
        file_infos.append(FileInfo(
            name=name,
            url=f"/downloads/{name}",
            size=size_str,
            media_type=get_media_type(name)
        ))

    return DownloadResponse(
        success=True,
        message=f"Successfully downloaded {len(file_infos)} artifact{'s' if len(file_infos) > 1 else ''}!",
        files=file_infos
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)
