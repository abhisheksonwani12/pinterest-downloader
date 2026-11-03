# PinDrop — Pinterest Artifact Downloader & Web Interface

A modern, minimal tool to download full-resolution images and videos from Pinterest pin links, boards, and short links (`pin.it`).

Includes both a Next.js chat interface and standalone Python CLI tools.

---

## ⚡ Features

- **Next.js Web Interface**: Minimalist dark-themed chat app to paste links and download media.
- **Embedded Media Previews**: Video player for MP4 video pins and inline previews for high-resolution images.
- **Original Quality**: Fetches original uncompressed images directly from Pinterest CDN.
- **No API Token Required**: Built on `gallery-dl` with automatic request throttling and rate-limit backoff.
- **Pinterest API v5 Script**: Also includes an official API-based downloader for boards.
- **History Drawer**: Keeps track of all downloaded artifacts with one-click saves.

---

## 🚀 Quick Start

### 1. Web Application (Next.js)

```bash
cd web
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### 2. Standalone CLI Downloader (No API key needed)

Ensure Python and `gallery-dl` are installed:
```bash
pip install gallery-dl
```

Run interactively:
```bash
python3 download_pinterest.py
# Paste any pin or board link when prompted
```

Or pass a URL directly:
```bash
python3 download_pinterest.py "https://pin.it/Gk3NpJ8K0"
```

Files are saved directly to `Downloaded_Pins/`.

### 3. Pinterest API v5 Downloader (Requires Access Token)

```bash
python3 download_board_pins.py --board-id <YOUR_BOARD_ID> --token <YOUR_ACCESS_TOKEN>
```

---

## 📁 Project Structure

```text
pinterest-downloader/
├── web/                     # Next.js web application
│   ├── app/
│   │   ├── page.tsx         # Chat UI
│   │   └── api/
│   │       ├── download/    # Download endpoint
│   │       ├── history/     # Download history endpoint
│   │       └── media/       # Media streaming endpoint
│   └── package.json
├── download_pinterest.py    # Python CLI wrapper (gallery-dl)
├── downloader.py            # Standalone scraper tool
├── download_board_pins.py   # Official Pinterest API v5 script
└── Downloaded_Pins/         # Local download destination (gitignored)
```

---

## 📜 License

MIT
