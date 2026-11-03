import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";

const execFileAsync = promisify(execFile);
const DOWNLOAD_DIR = path.resolve(process.cwd(), "..", "Downloaded_Pins");

function getGalleryDlBin(): string {
  const commonPaths = [
    "/Library/Frameworks/Python.framework/Versions/3.14/bin/gallery-dl",
    "/usr/local/bin/gallery-dl",
    "/opt/homebrew/bin/gallery-dl",
  ];
  for (const p of commonPaths) {
    if (fs.existsSync(/*turbopackIgnore: true*/ p)) return p;
  }
  return "gallery-dl";
}

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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const url = (body.url || "").trim();

    if (!url) {
      return NextResponse.json({ success: false, error: "URL is required" }, { status: 400 });
    }

    if (!/(pinterest\.[a-z.]+|pin\.it)/i.test(url)) {
      return NextResponse.json(
        { success: false, error: "Please enter a valid Pinterest pin or board link." },
        { status: 400 }
      );
    }

    if (!fs.existsSync(DOWNLOAD_DIR)) {
      fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
    }

    const beforeFiles = new Set(fs.readdirSync(DOWNLOAD_DIR));
    const binPath = getGalleryDlBin();

    const args = [
      "--directory", DOWNLOAD_DIR,
      "--sleep", "0.5",
      "--sleep-request", "0.5",
      "--sleep-429", "10",
      url,
    ];

    let stdout = "";
    let stderr = "";
    try {
      const res = await execFileAsync(binPath, args, { timeout: 120000 });
      stdout = res.stdout;
      stderr = res.stderr;
    } catch (err: any) {
      stdout = err.stdout || "";
      stderr = err.stderr || err.message || "";
    }

    const combinedOutput = `${stdout}\n${stderr}`;

    // 1. Check newly created files
    const afterFiles = fs.readdirSync(DOWNLOAD_DIR);
    let matchedFiles = afterFiles.filter((f) => !f.startsWith(".") && !beforeFiles.has(f));

    // 2. If already downloaded, parse stdout for matched filenames
    if (matchedFiles.length === 0) {
      const matches = combinedOutput.match(new RegExp(`${DOWNLOAD_DIR}/([^ \\r\\n\\t]+)`, "g"));
      if (matches) {
        for (const m of matches) {
          const fname = path.basename(m.trim());
          if (fs.existsSync(path.join(DOWNLOAD_DIR, fname)) && !matchedFiles.includes(fname)) {
            matchedFiles.push(fname);
          }
        }
      }
    }

    // 3. Fallback: newest modified file in download dir
    if (matchedFiles.length === 0) {
      const candidates = afterFiles.filter((f) => !f.startsWith("."));
      if (candidates.length > 0) {
        const sorted = candidates.sort(
          (a, b) =>
            fs.statSync(path.join(DOWNLOAD_DIR, b)).mtimeMs -
            fs.statSync(path.join(DOWNLOAD_DIR, a)).mtimeMs
        );
        matchedFiles.push(sorted[0]);
      }
    }

    if (matchedFiles.length === 0) {
      return NextResponse.json({
        success: false,
        error: stderr || "Could not download media from the specified link.",
      });
    }

    const files = matchedFiles.map((name) => {
      const stat = fs.statSync(path.join(DOWNLOAD_DIR, name));
      return {
        name,
        url: `/api/media/${encodeURIComponent(name)}`,
        size: formatBytes(stat.size),
        mediaType: getMediaType(name),
      };
    });

    return NextResponse.json({
      success: true,
      message: `Downloaded ${files.length} artifact${files.length > 1 ? "s" : ""}!`,
      files,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
