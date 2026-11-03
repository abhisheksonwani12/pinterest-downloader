#!/usr/bin/env python3
"""
Downloads all high-resolution pin images from a Pinterest Board using Pinterest API v5.
"""

import argparse
import os
import re
import sys
import time
from urllib.parse import urlparse
import requests

API_BASE = "https://api.pinterest.com/v5"

def extract_high_res_image_url(pin: dict) -> str | None:
    """Extracts highest resolution image URL from a Pinterest v5 Pin object."""
    media = pin.get("media") or {}
    images = media.get("images") or pin.get("images") or {}

    # 1. Prefer 'originals'
    if "originals" in images and images["originals"].get("url"):
        return images["originals"]["url"]

    # 2. Check standard size keys and upgrade thumbnail URL to originals
    for key in ["1200x", "600x", "400x300", "150x150"]:
        if key in images and images[key].get("url"):
            return re.sub(r"/(\d+x|\d+x\d+)/", "/originals/", images[key]["url"])

    return None

def fetch_board_pins(board_id: str, access_token: str, delay: float = 0.5):
    """
    Yields pin items from the board using pagination.
    Handles rate-limits (HTTP 429) and network retries.
    """
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Accept": "application/json",
    }
    url = f"{API_BASE}/boards/{board_id}/pins"
    bookmark = None

    while True:
        params = {"page_size": 100}
        if bookmark:
            params["bookmark"] = bookmark

        # Retry loop for rate-limiting (429) or transient 5xx errors
        resp = None
        for attempt in range(5):
            try:
                resp = requests.get(url, headers=headers, params=params, timeout=20)
                if resp.status_code == 429:
                    retry_after = int(resp.headers.get("Retry-After", 2 ** attempt))
                    print(f"[Rate Limited] Waiting {retry_after}s before retry...")
                    time.sleep(retry_after)
                    continue
                resp.raise_for_status()
                break
            except requests.RequestException as e:
                if attempt == 4:
                    raise
                time.sleep(2 ** attempt)

        if resp is None:
            break

        data = resp.json()
        items = data.get("items", [])
        for item in items:
            yield item

        bookmark = data.get("bookmark")
        if not bookmark:
            break

        # Rate-limiting delay between page fetches
        time.sleep(delay)

def download_image(url: str, output_dir: str, pin_id: str) -> str:
    """Downloads a single image file into output_dir."""
    parsed = urlparse(url)
    ext = os.path.splitext(parsed.path)[1] or ".jpg"
    filename = f"{pin_id}{ext}"
    out_path = os.path.join(output_dir, filename)

    if os.path.exists(out_path):
        return out_path

    resp = requests.get(url, stream=True, timeout=30)
    resp.raise_for_status()

    with open(out_path, "wb") as f:
        for chunk in resp.iter_content(chunk_size=8192):
            if chunk:
                f.write(chunk)

    return out_path

def download_board(board_id: str, access_token: str, output_dir: str = "Downloaded_Pins", delay: float = 0.5):
    """Fetches pins and downloads high-res images."""
    os.makedirs(output_dir, exist_ok=True)
    count = 0
    failed = 0

    print(f"Connecting to Pinterest Board ID: {board_id}")
    for pin in fetch_board_pins(board_id, access_token, delay=delay):
        pin_id = pin.get("id", str(count))
        img_url = extract_high_res_image_url(pin)

        if not img_url:
            print(f"[-] Pin {pin_id}: No image URL found.")
            continue

        try:
            path = download_image(img_url, output_dir, pin_id)
            count += 1
            print(f"[+] ({count}) Downloaded: {path}")
            # Rate-limiting delay between image downloads
            time.sleep(delay)
        except Exception as e:
            failed += 1
            print(f"[!] Error downloading Pin {pin_id}: {e}", file=sys.stderr)

    print(f"\nCompleted: {count} downloaded, {failed} failed -> saved to '{output_dir}'.")

def run_tests():
    """Unit test for image extraction and thumbnail upgrading."""
    mock_pin_orig = {
        "id": "1001",
        "media": {
            "images": {
                "originals": {"url": "https://i.pinimg.com/originals/11/22/test.jpg"},
                "600x": {"url": "https://i.pinimg.com/600x/11/22/test.jpg"}
            }
        }
    }
    assert extract_high_res_image_url(mock_pin_orig) == "https://i.pinimg.com/originals/11/22/test.jpg"

    mock_pin_thumb = {
        "id": "1002",
        "media": {
            "images": {
                "1200x": {"url": "https://i.pinimg.com/1200x/33/44/test2.png"}
            }
        }
    }
    assert extract_high_res_image_url(mock_pin_thumb) == "https://i.pinimg.com/originals/33/44/test2.png"
    print("All internal tests passed.")

def main():
    parser = argparse.ArgumentParser(description="Download all high-res pins from a Pinterest Board.")
    parser.add_argument("--board-id", help="Pinterest Board ID")
    parser.add_argument("--token", help="Pinterest API Access Token (or set PINTEREST_ACCESS_TOKEN env var)")
    parser.add_argument("--output-dir", default="Downloaded_Pins", help="Folder name to save images (default: Downloaded_Pins)")
    parser.add_argument("--delay", type=float, default=0.5, help="Delay in seconds between requests for rate-limiting (default: 0.5)")
    parser.add_argument("--test", action="store_true", help="Run internal tests")
    args = parser.parse_args()

    if args.test:
        run_tests()
        return

    token = args.token or os.environ.get("PINTEREST_ACCESS_TOKEN")
    if not token:
        token = input("Enter Pinterest Access Token: ").strip()

    board_id = args.board_id
    if not board_id:
        board_id = input("Enter Pinterest Board ID: ").strip()

    if not token or not board_id:
        print("Error: Both Access Token and Board ID are required.", file=sys.stderr)
        sys.exit(1)

    try:
        download_board(board_id, token, output_dir=args.output_dir, delay=args.delay)
    except KeyboardInterrupt:
        print("\nProcess interrupted by user.")
    except Exception as e:
        print(f"\nFatal error: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
