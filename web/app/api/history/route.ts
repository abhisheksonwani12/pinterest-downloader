import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const DOWNLOAD_DIR = path.resolve(process.cwd(), "..", "Downloaded_Pins");

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function getMediaType(filename: string): "video" | "image" | "file" {
  const ext = path.extname(filename).toLowerCase();
  if ([".mp4", ".webm", ".mov"].includes(ext)) return "video";
  if ([".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext)) return "image";
  return "file";
}

export async function GET() {
  if (!fs.existsSync(DOWNLOAD_DIR)) {
    return NextResponse.json([]);
  }

  const files = fs
    .readdirSync(DOWNLOAD_DIR)
    .filter((f) => !f.startsWith("."))
    .map((name) => {
      const fullPath = path.join(DOWNLOAD_DIR, name);
      const stat = fs.statSync(fullPath);
      return {
        name,
        url: `/api/media/${encodeURIComponent(name)}`,
        size: formatBytes(stat.size),
        mediaType: getMediaType(name),
        mtime: stat.mtimeMs,
      };
    })
    .sort((a, b) => b.mtime - a.mtime);

  return NextResponse.json(files);
}
