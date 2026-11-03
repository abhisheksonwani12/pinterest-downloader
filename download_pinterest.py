#!/usr/bin/env python3
"""
Pinterest Downloader (No API Key Required).
Downloads original resolution images/videos from Pin, Board, or Profile links.
"""

import argparse
import os
import shutil
import subprocess
import sys

DEFAULT_DOWNLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "Downloaded_Pins")

def get_gallery_dl_bin() -> str:
    """Finds gallery-dl executable."""
    path = shutil.which("gallery-dl")
    if not path:
        # Fallback check standard Python bin paths
        py_bin = "/Library/Frameworks/Python.framework/Versions/3.14/bin/gallery-dl"
        if os.path.exists(py_bin):
            return py_bin
        raise RuntimeError("gallery-dl is not installed. Install it with: pip install gallery-dl")
    return path

def download_link(url: str, output_dir: str = DEFAULT_DOWNLOAD_DIR, sleep_delay: float = 0.5) -> int:
    """Invokes gallery-dl to download media from a Pinterest link."""
    bin_path = get_gallery_dl_bin()
    os.makedirs(output_dir, exist_ok=True)

    cmd = [
        bin_path,
        "--directory", output_dir,
        "--sleep", str(sleep_delay),
        "--sleep-request", str(sleep_delay),
        "--sleep-429", "10",
        url
    ]

    print(f"\n--> Downloading: {url}")
    print(f"--> Destination: {output_dir}\n")

    result = subprocess.run(cmd)
    return result.returncode

def interactive_mode(output_dir: str):
    """Continuous interactive loop to paste links."""
    print("=" * 60)
    print(" Pinterest Link Downloader (No API Key Required)")
    print(f" Destination folder: {output_dir}")
    print(" Paste any Pinterest link (pin, board, or pin.it shortlink).")
    print(" Press Ctrl+C or type 'exit' to quit.")
    print("=" * 60)

    while True:
        try:
            url = input("\nPaste Pinterest Link: ").strip()
            if not url:
                continue
            if url.lower() in ("exit", "quit", "q"):
                print("Exiting.")
                break
            download_link(url, output_dir=output_dir)
        except (KeyboardInterrupt, EOFError):
            print("\nExiting.")
            break

def main():
    parser = argparse.ArgumentParser(description="Download Pinterest media from links without API key.")
    parser.add_argument("url", nargs="?", help="Pinterest URL (pin, board, or shortlink)")
    parser.add_argument("-o", "--output-dir", default=DEFAULT_DOWNLOAD_DIR, help="Destination directory (default: ./Downloaded_Pins)")
    parser.add_argument("--test", action="store_true", help="Run self-check")
    args = parser.parse_args()

    if args.test:
        bin_path = get_gallery_dl_bin()
        assert os.path.exists(bin_path), f"Binary not found: {bin_path}"
        print(f"Self-check passed: gallery-dl available at {bin_path}")
        return

    if args.url:
        sys.exit(download_link(args.url, output_dir=args.output_dir))
    else:
        interactive_mode(output_dir=args.output_dir)

if __name__ == "__main__":
    main()
