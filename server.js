const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const app = express();
const root = path.join(__dirname, 'data');
const uploads = path.join(root, 'uploads');
const jobsDir = path.join(root, 'jobs');
fs.mkdirSync(uploads, { recursive: true });
fs.mkdirSync(jobsDir, { recursive: true });
const jobs = new Map();
const upload = multer({ dest: uploads, limits: { fileSize: 100 * 1024 * 1024, files: 500 }, fileFilter: (req, file, cb) => cb(null, /^image\/(jpeg|png|webp)$/.test(file.mimetype)) });
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/photos', express.static(uploads, { immutable: true, maxAge: '1d' }));
app.post('/api/photos', upload.array('photos', 500), (req, res) => {
  res.json((req.files || []).map(f => ({ id: f.filename, name: f.originalname, url: '/photos/' + f.filename })));
});
function run(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
    let error = '';
    proc.stderr.on('data', d => { error += d.toString(); });
    proc.on('error', reject);
    proc.on('close', code => code === 0 ? resolve() : reject(new Error(error || `FFmpeg exited with code ${code}`)));
  });
}
function number(value, min, max) { return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max; }
app.post('/api/render', (req, res) => {
  const { frames, width, height, fps, duration, crf } = req.body;
  if (!Array.isArray(frames) || !frames.length || frames.length > 500 || !Number.isInteger(width) || !Number.isInteger(height) || !number(width, 64, 3840) || !number(height, 64, 3840) || width % 2 || height % 2 || !Number.isInteger(fps) || !number(fps, 1, 60) || !number(duration, 0.02, 60) || !Number.isInteger(crf) || !number(crf, 0, 51) || frames.some(f => !f || !/^[a-f0-9]{32}$/.test(f.id) || !fs.existsSync(path.join(uploads, f.id)) || !number(f.x, -5, 5) || !number(f.y, -5, 5) || !number(f.scale, 0.1, 10) || (f.rotation !== undefined && !number(f.rotation, -360, 360)))) return res.status(400).json({ error: 'Invalid render settings or frames.' });
  const id = crypto.randomUUID();
  const dir = path.join(jobsDir, id);
  fs.mkdirSync(dir);
  const job = { id, status: 'rendering', progress: 0 };
  jobs.set(id, job);
  res.json(job);
  (async () => {
    try {
      // Normalize every source to the output canvas using the same contain/scale/offset model as the editor.
      for (let i = 0; i < frames.length; i++) {
        const f = frames[i];
        const angle = (f.rotation || 0) * Math.PI / 180;
        const filter = `scale=w='max(1,round(min(${width}/iw,${height}/ih)*iw*${f.scale}))':h='max(1,round(min(${width}/iw,${height}/ih)*ih*${f.scale}))',format=rgba,rotate=${angle}:ow='rotw(${angle})':oh='roth(${angle})':c=none[photo];color=c=black:s=${width}x${height}[bg];[bg][photo]overlay=x='(W-w)/2+${f.x * width}':y='(H-h)/2+${f.y * height}':shortest=1,format=rgb24`;
        await run(['-i', path.join(uploads, f.id), '-filter_complex', filter, '-frames:v', '1', '-threads', '1', path.join(dir, `${i}.png`)]);
        job.progress = Math.round((i + 1) / frames.length * 80);
      }
      const list = frames.map((_, i) => `file '${i}.png'\noption framerate 1000\nduration ${duration}\n`).join('') + `file '${frames.length - 1}.png'\noption framerate 1000\n`;
      fs.writeFileSync(path.join(dir, 'frames.txt'), list);
      await run(['-f', 'concat', '-safe', '0', '-i', path.join(dir, 'frames.txt'), '-t', String(frames.length * duration), '-vf', `fps=${fps},format=yuv420p`, '-c:v', 'libx264', '-crf', String(crf), '-movflags', '+faststart', path.join(dir, 'video.mp4')]);
      job.progress = 100; job.status = 'done'; job.url = `/api/render/${id}/download`;
      for (let i = 0; i < frames.length; i++) fs.rmSync(path.join(dir, `${i}.png`), { force: true });
      fs.rmSync(path.join(dir, 'frames.txt'), { force: true });
    } catch (error) { job.status = 'error'; job.error = error.message; }
  })();
});
app.get('/api/render/:id', (req, res) => { const job = jobs.get(req.params.id); if (!job) return res.status(404).json({ error: 'Render not found.' }); res.json(job); });
app.get('/api/render/:id/download', (req, res) => { const job = jobs.get(req.params.id); if (!job || job.status !== 'done') return res.sendStatus(404); res.download(path.join(jobsDir, job.id, 'video.mp4'), 'stop-motion.mp4'); });
app.use((err, req, res, next) => res.status(400).json({ error: err.message || 'Upload failed.' }));
app.listen(process.env.PORT || 3000, '0.0.0.0', () => console.log(`Stop Motion Studio listening on port ${process.env.PORT || 3000}`));
