# Stop Motion Studio

A local web app for aligning photos and rendering stop-motion MP4 videos with FFmpeg.

## Run with Docker

```sh
docker compose up --build
```

Open http://localhost:3000. Uploaded photos and exports are stored in the `stopmotion-data` Docker volume. To run without Docker, install Node.js 20+ and FFmpeg (including libx264), then run `npm install` and `npm start`.

## Workflow

1. Add JPEG, PNG, or WebP photos (up to 500 per upload, 100 MB each). They appear in upload order.
2. Select a frame and drag it to reposition; adjust scale, rotation and precise offsets in the sidebar. Use the grid and previous/next onion-skin overlays to align photos. Use the arrows to reorder and Preview to play the sequence.
3. Open **Export video**, set an even output width and height, frame rate, seconds per photo and quality (CRF), and render. Download the resulting H.264 MP4 when ready. The canvas aspect ratio follows the export dimensions.

The optional **Insert 50% frame overlaps** export setting adds a blend of each pair of adjacent aligned frames between the originals. Each blend lasts the same number of seconds as a photo, so three photos at one second each produce a five-second video. The editor's onion-skin and grid settings do not appear in the export.

Photos are fit within a black output canvas before the per-frame scale and position are applied. The video frame rate quantizes photo timing to the nearest available video frames. Exports may need significant disk space and time, especially for large images and resolutions.

Edits and settings are automatically saved in this browser's local storage. Local saves reference the uploaded photos on the server, so keep the server's data volume. Use **Save project** to download a portable backup containing the photos and edits; **Import project** replaces the current project with a backup. Project files can be large.

This is intended for trusted local use: there is no authentication, storage quota, or automatic cleanup. Uploaded files and completed videos persist in `data/`. Render jobs are not recoverable after a server restart. Do not expose the service to an untrusted network without additional security and resource controls.
