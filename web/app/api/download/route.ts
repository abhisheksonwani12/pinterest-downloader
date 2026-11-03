import { NextRequest, NextResponse } from "next/server";
import path from "path";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

/**
 * Resolves short links (pin.it) and extracts the numeric Pin ID.
 */
async function resolvePinId(inputUrl: string): Promise<string | null> {
  let url = inputUrl.trim();

  // Handle pin.it short links
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
      // If HEAD fails, try GET
      try {
        const res = await fetch(url, { redirect: "follow" });
        url = res.url;
      } catch {}
    }
  }

  const match = url.match(/\/pin\/(\d+)/);
  return match ? match[1] : null;
}

/**
 * Probes candidate video URLs for Pinterest video hashes.
 */
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

/**
 * Robust Pinterest Artifact Extractor.
 * Targets the authentic pin artifact without ever scraping arbitrary page assets.
 */
async function extractPinterestArtifact(pinId: string) {
  // Strategy 1: PinResource internal API (Provides high-res originals and video hashes)
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
        // 1. Check for Video in story_pin_data
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

        // 2. Check for Video in standard videos object
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

        // 3. Check for Original Image
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

  // Strategy 2: Official Pinterest oEmbed (100% reliable image fallback)
  try {
    const oembedUrl = `https://www.pinterest.com/oembed.json?url=${encodeURIComponent(
      `https://www.pinterest.com/pin/${pinId}/`
    )}`;
    const oembedRes = await fetch(oembedUrl);
    if (oembedRes.ok) {
      const oembed = await oembedRes.json();
      if (oembed.thumbnail_url) {
        // Upgrade thumbnail to uncompressed original image
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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const url = (body.url || "").trim();

    if (!url) {
      return NextResponse.json({ success: false, error: "URL is required" }, { status: 400 });
    }

    if (!/(pinterest\.[a-z.]+|pin\.it)/i.test(url)) {
      return NextResponse.json(
        { success: false, error: "Please enter a valid Pinterest pin link." },
        { status: 400 }
      );
    }

    const pinId = await resolvePinId(url);
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

    // Get exact file size via HEAD
    let sizeStr = "High Quality";
    try {
      const head = await fetch(artifact.url, { method: "HEAD" });
      const len = head.headers.get("content-length");
      if (len) {
        sizeStr = formatBytes(parseInt(len, 10));
      }
    } catch {}

    const proxyDownloadUrl = `/api/proxy?url=${encodeURIComponent(artifact.url)}&name=${encodeURIComponent(
      artifact.name
    )}`;

    return NextResponse.json({
      success: true,
      message: `Successfully retrieved ${artifact.mediaType === "video" ? "video" : "image"}!`,
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
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
