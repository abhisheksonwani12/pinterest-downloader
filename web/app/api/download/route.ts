import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";

const execFileAsync = promisify(execFile);
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

/**
 * Serverless-native scraper for Pinterest pins.
 * Runs on Vercel without requiring Python, binaries, or disk storage.
 */
async function extractDirectMedia(pinUrl: string) {
  const res = await fetch(pinUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    redirect: "follow",
  });

  if (!res.ok) {
    throw new Error(`Pinterest returned status ${res.status}`);
  }

  const html = await res.text();

  // 1. Check for MP4 videos
  const mp4Matches = html.match(/https?:\/\/[^\s"'<>]+?\.mp4/g);
  if (mp4Matches && mp4Matches.length > 0) {
    // Pick the highest resolution video URL if available
    const videoUrl = mp4Matches[0];
    const urlObj = new URL(videoUrl);
    const fname = path.basename(urlObj.pathname) || "pinterest_video.mp4";
    return {
      name: fname,
      rawUrl: videoUrl,
      mediaType: "video" as const,
    };
  }

  // 2. Check for originals image
  const origMatches = html.match(
    /https?:\/\/i\.pinimg\.com\/originals\/[^\s"'<>]+\.(?:jpg|jpeg|png|webp)/g
  );
  if (origMatches && origMatches.length > 0) {
    const imgUrl = origMatches[0];
    const urlObj = new URL(imgUrl);
    const fname = path.basename(urlObj.pathname) || "pinterest_image.jpg";
    return {
      name: fname,
      rawUrl: imgUrl,
      mediaType: "image" as const,
    };
  }

  // 3. Fallback: check 736x thumbnail and upgrade
  const thumbMatches = html.match(
    /https?:\/\/i\.pinimg\.com\/736x\/[^\s"'<>]+\.(?:jpg|jpeg|png|webp)/g
  );
  if (thumbMatches && thumbMatches.length > 0) {
    const upgradedUrl = thumbMatches[0].replace("/736x/", "/originals/");
    const urlObj = new URL(upgradedUrl);
    const fname = path.basename(urlObj.pathname) || "pinterest_image.jpg";
    return {
      name: fname,
      rawUrl: upgradedUrl,
      mediaType: "image" as const,
    };
  }

  return null;
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

    // Try serverless native extraction first (works in Vercel Lambdas)
    try {
      const direct = await extractDirectMedia(url);
      if (direct) {
        // Probe size with HEAD request
        let sizeStr = "Direct CDN";
        try {
          const headRes = await fetch(direct.rawUrl, { method: "HEAD" });
          const len = headRes.headers.get("content-length");
          if (len) {
            sizeStr = formatBytes(parseInt(len, 10));
          }
        } catch {}

        const proxyDownloadUrl = `/api/proxy?url=${encodeURIComponent(direct.rawUrl)}&name=${encodeURIComponent(direct.name)}`;

        return NextResponse.json({
          success: true,
          message: "Successfully retrieved artifact!",
          files: [
            {
              name: direct.name,
              url: direct.rawUrl,
              downloadUrl: proxyDownloadUrl,
              size: sizeStr,
              mediaType: direct.mediaType,
            },
          ],
        });
      }
    } catch (e: any) {
      console.warn("Serverless extraction fallback:", e.message);
    }

    // Secondary fallback: gallery-dl (if running on a server with gallery-dl installed)
    const galleryDlPath = "/Library/Frameworks/Python.framework/Versions/3.14/bin/gallery-dl";
    const hasGalleryDl = fs.existsSync(/*turbopackIgnore: true*/ galleryDlPath);

    if (hasGalleryDl) {
      if (!fs.existsSync(DOWNLOAD_DIR)) {
        fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
      }

      const beforeFiles = new Set(fs.readdirSync(DOWNLOAD_DIR));
      const args = ["--directory", DOWNLOAD_DIR, "--sleep", "0.5", "--sleep-request", "0.5", url];

      let stdout = "";
      let stderr = "";
      try {
        const res = await execFileAsync(galleryDlPath, args, { timeout: 120000 });
        stdout = res.stdout;
        stderr = res.stderr;
      } catch (err: any) {
        stdout = err.stdout || "";
        stderr = err.stderr || err.message || "";
      }

      const combined = `${stdout}\n${stderr}`;
      const afterFiles = fs.readdirSync(DOWNLOAD_DIR);
      let matched = afterFiles.filter((f) => !f.startsWith(".") && !beforeFiles.has(f));

      if (matched.length === 0) {
        const matches = combined.match(new RegExp(`${DOWNLOAD_DIR}/([^ \\r\\n\\t]+)`, "g"));
        if (matches) {
          for (const m of matches) {
            const fname = path.basename(m.trim());
            if (fs.existsSync(path.join(DOWNLOAD_DIR, fname)) && !matched.includes(fname)) {
              matched.push(fname);
            }
          }
        }
      }

      if (matched.length > 0) {
        const files = matched.map((name) => {
          const stat = fs.statSync(path.join(DOWNLOAD_DIR, name));
          return {
            name,
            url: `/api/media/${encodeURIComponent(name)}`,
            downloadUrl: `/api/media/${encodeURIComponent(name)}`,
            size: formatBytes(stat.size),
            mediaType: getMediaType(name),
          };
        });

        return NextResponse.json({
          success: true,
          message: `Downloaded ${files.length} artifact${files.length > 1 ? "s" : ""}!`,
          files,
        });
      }
    }

    return NextResponse.json({
      success: false,
      error: "Could not extract original media from this link.",
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
