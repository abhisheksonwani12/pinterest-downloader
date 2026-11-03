#!/usr/bin/env python3
"""
Simple Pinterest Artifact Downloader.
Downloads original images and videos from Pinterest pin links (including pin.it short links).
"""

import argparse
import json
import os
import re
import sys
from urllib.parse import urlparse
import requests
from bs4 import BeautifulSoup

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
}

def to_original_image_url(url: str) -> str:
    """Upgrades a Pinterest thumbnail URL to original full resolution."""
    return re.sub(r"/(\d+x|\d+x\d+)/", "/originals/", url)

def extract_media_url_from_html(html: str) -> tuple[str, str]:
    """
    Extracts (media_url, media_type) from Pinterest HTML.
    media_type is either 'video' or 'image'.
    """
    soup = BeautifulSoup(html, "html.parser")

    # 1. Try __PWS_DATA__ script
    pws = soup.find("script", id="__PWS_DATA__")
    if pws and pws.string:
        try:
            data = json.loads(pws.string)
            props = data.get("props", {}).get("initialReduxState", {})
            pins = props.get("pins", {})
            for _, pin_data in pins.items():
                videos = pin_data.get("videos")
                if videos and "video_list" in videos:
                    v_list = videos["video_list"]
                    for key in ["V_720P", "V_EXP7", "V_EXP6", "V_EXP5", "V_EXP4"]:
                        if key in v_list and v_list[key].get("url", "").endswith(".mp4"):
                            return v_list[key]["url"], "video"
                    for item in v_list.values():
                        if isinstance(item, dict) and item.get("url", "").endswith(".mp4"):
                            return item["url"], "video"

                images = pin_data.get("images", {})
                if "originals" in images and "url" in images["originals"]:
                    return images["originals"]["url"], "image"
        except Exception:
            pass

    # 2. Try JSON-LD schema
    for script in soup.find_all("script", type="application/ld+json"):
        if not script.string:
            continue
        try:
            ld = json.loads(script.string)
            if isinstance(ld, dict):
                if "video" in ld and isinstance(ld["video"], dict):
                    v_url = ld["video"].get("contentUrl")
                    if v_url:
                        return v_url, "video"
                img_url = ld.get("image")
                if isinstance(img_url, str):
                    return to_original_image_url(img_url), "image"
                elif isinstance(img_url, dict) and "url" in img_url:
                    return to_original_image_url(img_url["url"]), "image"
        except Exception:
            continue

    # 3. Fallback to OpenGraph meta tags
    og_video = soup.find("meta", property="og:video") or soup.find("meta", property="og:video:secure_url")
    if og_video and og_video.get("content"):
        return og_video["content"], "video"

    og_image = soup.find("meta", property="og:image")
    if og_image and og_image.get("content"):
        return to_original_image_url(og_image["content"]), "image"

    raise ValueError("Could not find image or video in Pinterest page.")

def download_pinterest_artifact(url: str, output_dir: str = "./downloads") -> str:
    """Downloads the Pinterest artifact from a URL and saves it to output_dir."""
    session = requests.Session()
    session.headers.update(HEADERS)

    # Resolve shortlinks (e.g. pin.it)
    resp = session.get(url, allow_redirects=True, timeout=15)
    resp.raise_for_status()

    media_url, media_type = extract_media_url_from_html(resp.text)

    os.makedirs(output_dir, exist_ok=True)
    parsed = urlparse(media_url)
    filename = os.path.basename(parsed.path)
    if not filename or "." not in filename:
        ext = ".mp4" if media_type == "video" else ".jpg"
        filename = f"pinterest_artifact{ext}"

    out_path = os.path.join(output_dir, filename)

    media_resp = session.get(media_url, stream=True, timeout=30)
    media_resp.raise_for_status()

    with open(out_path, "wb") as f:
        for chunk in media_resp.iter_content(chunk_size=8192):
            if chunk:
                f.write(chunk)

    return out_path

def run_tests():
    """Self-check verification tests."""
    thumb = "https://i.pinimg.com/736x/ab/cd/ef/abcdef123456.jpg"
    orig = to_original_image_url(thumb)
    assert orig == "https://i.pinimg.com/originals/ab/cd/ef/abcdef123456.jpg", f"Unexpected: {orig}"

    sample_html = '<html><head><meta property="og:image" content="https://i.pinimg.com/474x/11/22/33/112233.jpg"/></head></html>'
    url, mtype = extract_media_url_from_html(sample_html)
    assert mtype == "image"
    assert url == "https://i.pinimg.com/originals/11/22/33/112233.jpg"

    sample_video_html = '''<html><head>
    <script type="application/ld+json">
    {"@context": "http://schema.org", "video": {"contentUrl": "https://v.pinimg.com/videos/test.mp4"}}
    </script>
    </head></html>'''
    url, mtype = extract_media_url_from_html(sample_video_html)
    assert mtype == "video"
    assert url == "https://v.pinimg.com/videos/test.mp4"

    print("All internal tests passed.")

def main():
    parser = argparse.ArgumentParser(description="Download Pinterest images or videos from link.")
    parser.add_argument("url", nargs="?", help="Pinterest Pin URL or pin.it short link")
    parser.add_argument("-o", "--output-dir", default="./downloads", help="Output directory (default: ./downloads)")
    parser.add_argument("--test", action="store_true", help="Run internal tests")
    args = parser.parse_args()

    if args.test:
        run_tests()
        return

    if not args.url:
        parser.print_help()
        sys.exit(1)

    print(f"Fetching {args.url}...")
    try:
        saved_file = download_pinterest_artifact(args.url, args.output_dir)
        print(f"Saved: {saved_file}")
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
