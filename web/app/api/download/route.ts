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

// ---------------------------------------------------------
// PINTEREST EXTRACTION
// ---------------------------------------------------------

async function resolvePinterestPinId(inputUrl: string): Promise<string | null> {
  let url = inputUrl.trim();
  if (url.includes("pin.it")) {
    try {
      const res = await fetch(url, {
        method: "HEAD",
        redirect: "follow",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        },
      });
      url = res.url;
    } catch {
      try {
        const res = await fetch(url, { redirect: "follow" });
        url = res.url;
      } catch {}
    }
  }

  const match = url.match(/\/pin\/(\d+)/);
  return match ? match[1] : null;
}

async function resolveVideoUrl(hash: string): Promise<string | null> {
  const suffixes = ["_720w.mp4", "_t4.mp4", ".mp4", "_mobile.mp4"];
  for (const s of suffixes) {
    const candidate = `https://v1.pinimg.com/videos/iht/expMp4/${hash}${s}`;
    try {
      const head = await fetch(candidate, { method: "HEAD" });
      if (head.ok && head.headers.get("content-type")?.includes("video")) {
        return candidate;
      }
    } catch {}
  }
  return null;
}

async function extractPinterestArtifact(pinId: string) {
  // Strategy 1: PinResource internal API
  try {
    const csrf = Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);
    const data = JSON.stringify({ options: { id: pinId, field_set_key: "detailed" } });
    const apiUrl = `https://www.pinterest.com/resource/PinResource/get/?data=${encodeURIComponent(
      data
    )}&source_url=${encodeURIComponent(`/pin/${pinId}/`)}`;

    const res = await fetch(apiUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "X-Requested-With": "XMLHttpRequest",
        "X-APP-VERSION": "a89153f",
        "X-Pinterest-AppState": "active",
        "X-Pinterest-Source-Url": `/pin/${pinId}/`,
        "X-Pinterest-PWS-Handler": "www/[username].js",
        Cookie: `csrftoken=${csrf};`,
        "X-CSRFToken": csrf,
        Accept: "application/json, text/javascript, */*, q=0.01",
      },
    });

    if (res.ok) {
      const json = await res.json();
      const pinData = json.resource_response?.data;

      if (pinData) {
        if (pinData.story_pin_data?.pages) {
          for (const page of pinData.story_pin_data.pages) {
            for (const block of page.blocks || []) {
              const vList = block.video?.video_list;
              if (vList) {
                for (const item of Object.values(vList) as any[]) {
                  if (item.url && item.url.includes(".m3u8")) {
                    const hashMatch = item.url.match(/([a-f0-9]{2}\/[a-f0-9]{2}\/[a-f0-9]{2}\/[a-f0-9]+)/);
                    if (hashMatch) {
                      const mp4Url = await resolveVideoUrl(hashMatch[1]);
                      if (mp4Url) {
                        return {
                          url: mp4Url,
                          mediaType: "video" as const,
                          name: `pinterest_${pinId}.mp4`,
                        };
                      }
                    }
                  }
                  if (item.url && item.url.endsWith(".mp4")) {
                    return {
                      url: item.url,
                      mediaType: "video" as const,
                      name: `pinterest_${pinId}.mp4`,
                    };
                  }
                }
              }
            }
          }
        }

        if (pinData.videos?.video_list) {
          for (const item of Object.values(pinData.videos.video_list) as any[]) {
            if (item.url && item.url.endsWith(".mp4")) {
              return {
                url: item.url,
                mediaType: "video" as const,
                name: `pinterest_${pinId}.mp4`,
              };
            }
          }
        }

        if (pinData.images?.orig?.url) {
          const imgUrl = pinData.images.orig.url;
          const ext = path.extname(new URL(imgUrl).pathname) || ".jpg";
          return {
            url: imgUrl,
            mediaType: "image" as const,
            name: `pinterest_${pinId}${ext}`,
          };
        }
      }
    }
  } catch (err: any) {
    console.warn("PinResource error:", err.message);
  }

  // Strategy 2: Official Pinterest oEmbed
  try {
    const oembedUrl = `https://www.pinterest.com/oembed.json?url=${encodeURIComponent(
      `https://www.pinterest.com/pin/${pinId}/`
    )}`;
    const oembedRes = await fetch(oembedUrl);
    if (oembedRes.ok) {
      const oembed = await oembedRes.json();
      if (oembed.thumbnail_url) {
        const origUrl = oembed.thumbnail_url.replace(/\/(\d+x|\d+x\d+)\//, "/originals/");
        const ext = path.extname(new URL(origUrl).pathname) || ".jpg";
        return {
          url: origUrl,
          mediaType: "image" as const,
          name: `pinterest_${pinId}${ext}`,
        };
      }
    }
  } catch (err: any) {
    console.warn("oEmbed error:", err.message);
  }

  return null;
}

// ---------------------------------------------------------
// INSTAGRAM EXTRACTION
// ---------------------------------------------------------

const IG_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function shortcodeToMediaId(shortcode: string): string {
  let id = BigInt(0);
  for (let i = 0; i < shortcode.length; i++) {
    const val = BigInt(IG_ALPHABET.indexOf(shortcode[i]));
    id = id * BigInt(64) + val;
  }
  return id.toString();
}

function parseInstagramShortcode(url: string): string | null {
  const shareMatch = url.match(/\/share\/(?:p|reel|reels)\/([a-zA-Z0-9_-]+)/i);
  if (shareMatch) return shareMatch[1];
  const match = url.match(/\/(?:p|reel|reels)\/([a-zA-Z0-9_-]+)/i);
  return match ? match[1] : null;
}

async function extractInstagramArtifact(url: string) {
  const shortcode = parseInstagramShortcode(url);
  if (!shortcode) {
    throw new Error("Could not parse Instagram shortcode from URL.");
  }

  // 1. Check if local CLI tool (yt-dlp or gallery-dl) is installed on host
  const tools = [
    "/opt/homebrew/bin/yt-dlp",
    "/usr/local/bin/yt-dlp",
    "/Library/Frameworks/Python.framework/Versions/3.14/bin/yt-dlp",
    "yt-dlp",
  ];

  for (const bin of tools) {
    try {
      if (fs.existsSync(/*turbopackIgnore: true*/ bin) || bin === "yt-dlp") {
        const { stdout } = await execFileAsync(bin, ["--dump-single-json", "--no-warnings", url], {
          timeout: 20000,
        });
        const info = JSON.parse(stdout);
        const directUrl = info.url || info.requested_formats?.[0]?.url;
        if (directUrl) {
          return {
            name: `instagram_${shortcode}.mp4`,
            url: directUrl,
            mediaType: (info.ext === "mp4" || !info.ext ? "video" : "image") as "video" | "image",
          };
        }
      }
    } catch {}
  }

  // 2. Direct Instagram Web API
  try {
    const mediaId = shortcodeToMediaId(shortcode);
    const apiUrl = `https://www.instagram.com/api/v1/media/${mediaId}/info/`;
    const headers: Record<string, string> = {
      Accept: "*/*",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "X-IG-App-ID": "936619743392459",
      "X-ASBD-ID": "129477",
      "X-Requested-With": "XMLHttpRequest",
      Referer: "https://www.instagram.com/",
    };

    if (process.env.INSTAGRAM_COOKIE) {
      const rawCookie = process.env.INSTAGRAM_COOKIE.trim();
      let cookieHeader = rawCookie.includes("sessionid=") ? rawCookie : `sessionid=${rawCookie};`;
      if (!cookieHeader.includes("ds_user_id=")) {
        const match = cookieHeader.match(/sessionid=(\d+)%/);
        if (match) {
          cookieHeader += ` ds_user_id=${match[1]};`;
        }
      }
      headers["Cookie"] = cookieHeader;
    }

    const res = await fetch(apiUrl, { headers, redirect: "manual" });

    if (res.status === 404) {
      throw new Error("This Instagram post or reel does not exist. It may be deleted, expired, or private.");
    }

    if (res.status === 302 || res.status === 401 || res.status === 403) {
      if (!process.env.INSTAGRAM_COOKIE) {
        throw new Error(
          "Instagram requires a login session on cloud servers. Please add INSTAGRAM_COOKIE to Vercel environment variables."
        );
      }
      throw new Error(
        "Instagram could not access this post with your session. The post may be deleted or private."
      );
    }

    if (res.ok) {
      const json = await res.json();
      const item = json.items?.[0];
      if (item) {
        if (item.video_versions && item.video_versions.length > 0) {
          return {
            name: `instagram_${shortcode}.mp4`,
            url: item.video_versions[0].url,
            mediaType: "video" as const,
          };
        }
        if (item.image_versions2?.candidates && item.image_versions2.candidates.length > 0) {
          return {
            name: `instagram_${shortcode}.jpg`,
            url: item.image_versions2.candidates[0].url,
            mediaType: "image" as const,
          };
        }
        if (item.carousel_media && item.carousel_media.length > 0) {
          const first = item.carousel_media[0];
          if (first.video_versions && first.video_versions.length > 0) {
            return {
              name: `instagram_${shortcode}.mp4`,
              url: first.video_versions[0].url,
              mediaType: "video" as const,
            };
          }
          if (first.image_versions2?.candidates && first.image_versions2.candidates.length > 0) {
            return {
              name: `instagram_${shortcode}.jpg`,
              url: first.image_versions2.candidates[0].url,
              mediaType: "image" as const,
            };
          }
        }
      }
      throw new Error("Instagram returned an empty response. The post or reel may have been removed.");
    }
  } catch (err: any) {
    if (err.message && !err.message.includes("fetch failed")) {
      throw err;
    }
    console.warn("Instagram direct API error:", err.message);
  }

  return null;
}

// ---------------------------------------------------------
// YOUTUBE EXTRACTION
// ---------------------------------------------------------

function parseYouTubeVideoId(url: string): string | null {
  const match = url.match(
    /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([a-zA-Z0-9_-]{11})/i
  );
  return match ? match[1] : null;
}

async function extractYouTubeArtifact(url: string) {
  const videoId = parseYouTubeVideoId(url);
  if (!videoId) {
    throw new Error("Could not parse YouTube video ID from URL.");
  }

  // 1. Check if local CLI tool (yt-dlp) is installed
  const tools = [
    "/opt/homebrew/bin/yt-dlp",
    "/usr/local/bin/yt-dlp",
    "/Library/Frameworks/Python.framework/Versions/3.14/bin/yt-dlp",
    "yt-dlp",
  ];

  for (const bin of tools) {
    try {
      if (fs.existsSync(/*turbopackIgnore: true*/ bin) || bin === "yt-dlp") {
        const { stdout } = await execFileAsync(
          bin,
          ["--dump-single-json", "--no-warnings", url],
          { timeout: 30000 }
        );
        const info = JSON.parse(stdout);
        const formats = info.formats || [];

        // Progressive formats (both video and audio) are best for direct download
        const prog = formats.filter(
          (f: any) => f.url && f.vcodec && f.vcodec !== "none" && f.acodec && f.acodec !== "none"
        );
        const videoOnly = formats.filter(
          (f: any) => f.url && f.vcodec && f.vcodec !== "none"
        );
        const chosen = prog.length > 0 ? prog[prog.length - 1] : videoOnly[videoOnly.length - 1];

        const directUrl = chosen?.url || info.url;
        if (directUrl) {
          const cleanTitle = (info.title || `youtube_${videoId}`)
            .replace(/[^a-zA-Z0-9_-]/g, "_")
            .slice(0, 50);
          return {
            name: `${cleanTitle}.mp4`,
            url: directUrl,
            mediaType: "video" as const,
          };
        }
      }
    } catch (err: any) {
      console.warn("yt-dlp local execution error:", err.message);
    }
  }

  // 2. RapidAPI Cloud Resolver (when RAPIDAPI_KEY or YOUTUBE_API_KEY is configured)
  const apiKey = process.env.RAPIDAPI_KEY || process.env.YOUTUBE_API_KEY;
  if (apiKey) {
    try {
      const res = await fetch(`https://yt-api.p.rapidapi.com/dl?id=${videoId}`, {
        headers: {
          "x-rapidapi-host": "yt-api.p.rapidapi.com",
          "x-rapidapi-key": apiKey.trim(),
        },
      });
      if (res.ok) {
        const json = await res.json();
        const formats = json.formats || json.streamingData?.formats || [];
        const prog = formats.filter(
          (f: any) => f.url && f.mimeType?.includes("video/mp4")
        );
        const chosen = prog.length > 0 ? prog[prog.length - 1] : formats.find((f: any) => f.url);
        if (chosen?.url) {
          const cleanTitle = (json.title || `youtube_${videoId}`)
            .replace(/[^a-zA-Z0-9_-]/g, "_")
            .slice(0, 50);
          return {
            name: `${cleanTitle}.mp4`,
            url: chosen.url,
            mediaType: "video" as const,
          };
        }
      }
    } catch (err: any) {
      console.warn("RapidAPI execution error:", err.message);
    }
  }

  // 3. Fallback when running in cloud serverless environment
  let title = `youtube_${videoId}`;
  try {
    const oembedRes = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
    );
    if (oembedRes.ok) {
      const oembed = await oembedRes.json();
      if (oembed.title) {
        title = oembed.title;
      }
    }
  } catch {}

  throw new Error(
    `To download "${title}" on Vercel, set RAPIDAPI_KEY in environment variables, or run the app locally with "npm run dev".`
  );
}

// ---------------------------------------------------------
// POST HANDLER
// ---------------------------------------------------------

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const url = (body.url || "").trim();

    if (!url) {
      return NextResponse.json({ success: false, error: "URL is required" }, { status: 400 });
    }

    const isPinterest = /(pinterest\.[a-z.]+|pin\.it)/i.test(url);
    const isInstagram = /(instagram\.com|instagr\.am)/i.test(url);
    const isYouTube = /(?:youtube\.com\/(?:watch\?v=|watch\?.+&v=|shorts\/|embed\/|v\/)|youtu\.be\/)/i.test(url);

    if (!isPinterest && !isInstagram && !isYouTube) {
      return NextResponse.json(
        { success: false, error: "Please enter a valid Pinterest, Instagram, or YouTube link." },
        { status: 400 }
      );
    }

    // 1. Handle Pinterest
    if (isPinterest) {
      const pinId = await resolvePinterestPinId(url);
      if (!pinId) {
        return NextResponse.json(
          { success: false, error: "Could not find a valid Pin ID in this link." },
          { status: 400 }
        );
      }

      const artifact = await extractPinterestArtifact(pinId);
      if (!artifact) {
        return NextResponse.json(
          { success: false, error: "Could not retrieve media for this Pin. It might be private or deleted." },
          { status: 404 }
        );
      }

      let sizeStr = "High Quality";
      try {
        const head = await fetch(artifact.url, { method: "HEAD" });
        const len = head.headers.get("content-length");
        if (len) sizeStr = formatBytes(parseInt(len, 10));
      } catch {}

      const proxyDownloadUrl = `/api/proxy?url=${encodeURIComponent(artifact.url)}&name=${encodeURIComponent(
        artifact.name
      )}`;

      return NextResponse.json({
        success: true,
        message: `Successfully retrieved Pinterest ${artifact.mediaType}!`,
        files: [
          {
            name: artifact.name,
            url: artifact.url,
            downloadUrl: proxyDownloadUrl,
            size: sizeStr,
            mediaType: artifact.mediaType,
          },
        ],
      });
    }

    // 2. Handle Instagram
    if (isInstagram) {
      let artifact;
      try {
        artifact = await extractInstagramArtifact(url);
      } catch (err: any) {
        return NextResponse.json(
          {
            success: false,
            error: err.message || "Could not retrieve this Instagram media.",
          },
          { status: 400 }
        );
      }

      if (!artifact) {
        return NextResponse.json(
          {
            success: false,
            error: process.env.INSTAGRAM_COOKIE
              ? "Could not find media in this Instagram post. It may be deleted or private."
              : "Could not retrieve Instagram media. Meta enforces login requirements on cloud IPs. Try setting INSTAGRAM_COOKIE in environment variables.",
          },
          { status: 404 }
        );
      }

      let sizeStr = "High Quality";
      try {
        const head = await fetch(artifact.url, { method: "HEAD" });
        const len = head.headers.get("content-length");
        if (len) sizeStr = formatBytes(parseInt(len, 10));
      } catch {}

      const proxyDownloadUrl = `/api/proxy?url=${encodeURIComponent(artifact.url)}&name=${encodeURIComponent(
        artifact.name
      )}`;

      return NextResponse.json({
        success: true,
        message: `Successfully retrieved Instagram ${artifact.mediaType}!`,
        files: [
          {
            name: artifact.name,
            url: artifact.url,
            downloadUrl: proxyDownloadUrl,
            size: sizeStr,
            mediaType: artifact.mediaType,
          },
        ],
      });
    }

    // 3. Handle YouTube
    if (isYouTube) {
      let artifact;
      try {
        artifact = await extractYouTubeArtifact(url);
      } catch (err: any) {
        return NextResponse.json(
          {
            success: false,
            error: err.message || "Could not retrieve this YouTube video.",
          },
          { status: 400 }
        );
      }

      let sizeStr = "High Quality";
      try {
        const head = await fetch(artifact.url, { method: "HEAD" });
        const len = head.headers.get("content-length");
        if (len) sizeStr = formatBytes(parseInt(len, 10));
      } catch {}

      const proxyDownloadUrl = `/api/proxy?url=${encodeURIComponent(artifact.url)}&name=${encodeURIComponent(
        artifact.name
      )}`;

      return NextResponse.json({
        success: true,
        message: `Successfully retrieved YouTube video!`,
        files: [
          {
            name: artifact.name,
            url: artifact.url,
            downloadUrl: proxyDownloadUrl,
            size: sizeStr,
            mediaType: artifact.mediaType,
          },
        ],
      });
    }
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
