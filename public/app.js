const $ = id => document.getElementById(id);
const canvas = $('canvas'), ctx = canvas.getContext('2d');
let frames = [], selected = -1, playing = null, dragging = null;
const storageKey = 'stopmotion-project-v1';
const settingsIds = ['width', 'height', 'fps', 'duration', 'crf', 'opacity', 'previous', 'next', 'grid', 'exportOverlap'];
let saveTimer, restoring = true, saveFailed = false;
function toast(message) { $('toast').textContent = message; $('toast').style.display = 'block'; clearTimeout(toast.timer); toast.timer = setTimeout(() => $('toast').style.display = 'none', 4500); }
function projectState() {
  return { version: 1, selected, frames: frames.map(({ id, name, url, x, y, scale, rotation }) => ({ id, name, url, x, y, scale, rotation })), settings: Object.fromEntries(settingsIds.map(id => [id, $(id).type === 'checkbox' ? $(id).checked : $(id).value])) };
}
function saveState() {
  if (restoring) return;
  try { const project = projectState(); validateProject(project); localStorage.setItem(storageKey, JSON.stringify(project)); saveFailed = false; }
  catch (error) { if (!saveFailed) toast('Could not save locally. Export your project to avoid losing changes.'); saveFailed = true; }
}
function scheduleSave() { if (!restoring) { clearTimeout(saveTimer); saveTimer = setTimeout(saveState, 250); } }
function validateProject(project, portable = false) {
  const validNumber = (n, min, max) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
  if (!project || project.version !== 1 || !Array.isArray(project.frames) || project.frames.length > 500 || !Number.isInteger(project.selected) || (project.frames.length ? project.selected < 0 || project.selected >= project.frames.length : project.selected !== -1) || !project.settings || typeof project.settings !== 'object') throw Error('Invalid project file.');
  for (const f of project.frames) {
    if (!f || typeof f.name !== 'string' || !validNumber(f.x, -5, 5) || !validNumber(f.y, -5, 5) || !validNumber(f.scale, 0.1, 10) || !validNumber(f.rotation, -360, 360) || (portable ? typeof f.data !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/i.test(f.data) : typeof f.id !== 'string' || !/^[a-f0-9]{32}$/.test(f.id) || f.url !== '/photos/' + f.id)) throw Error('Invalid project frame.');
  }
  const s = project.settings;
  for (const [id, min, max, integer] of [['width',64,3840,true], ['height',64,3840,true], ['fps',1,60,true], ['duration',0.02,60,false], ['crf',0,51,true], ['opacity',0,100,false]]) {
    if (typeof s[id] !== 'string' || !s[id].trim() || !validNumber(Number(s[id]), min, max) || (integer && !Number.isInteger(Number(s[id])))) throw Error('Invalid project settings.');
  }
  if (+s.width % 2 || +s.height % 2 || ['previous', 'next', 'grid'].some(id => typeof s[id] !== 'boolean') || (s.exportOverlap !== undefined && typeof s.exportOverlap !== 'boolean')) throw Error('Invalid project settings.');
}
function applyProject(project) {
  if (playing) { clearInterval(playing); playing = null; $('play').textContent = '▶ Preview'; }
  dragging = null;
  for (const id of settingsIds) { if ($(id).type === 'checkbox') $(id).checked = project.settings[id]; else $(id).value = project.settings[id]; }
  canvas.width = +$('width').value; canvas.height = +$('height').value; $('opacityValue').textContent = $('opacity').value + '%';
  frames = project.frames.map(f => { const image = new Image(); image.onload = draw; image.onerror = () => toast('A saved photo is unavailable on the server. Import a project backup to restore it.'); image.src = f.url; const rotation = f.rotation > 180 ? f.rotation - 360 : f.rotation < -180 ? f.rotation + 360 : f.rotation; return { ...f, rotation, image }; });
  selected = project.selected; refresh();
}
function blobData(blob) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); }); }
async function photoData(response) {
  const blob = await response.blob(), bytes = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const type = bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg' : bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 ? 'image/png' : bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50 ? 'image/webp' : null;
  if (!type) throw Error('Unsupported photo format.');
  return blobData(new Blob([blob], { type }));
}
$('exportProject').onclick = async () => {
  try {
    const project = projectState();
    validateProject(project); project.frames = await Promise.all(project.frames.map(async f => { const response = await fetch(f.url); if (!response.ok) throw Error(`Photo ${f.name} is unavailable.`); const data = await photoData(response); return { name: f.name, x: f.x, y: f.y, scale: f.scale, rotation: f.rotation, data }; }));
    const url = URL.createObjectURL(new Blob([JSON.stringify(project)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = 'stopmotion-project.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) { toast(`Could not save project: ${error.message}`); }
};
$('importProject').onchange = async e => {
  const file = e.target.files[0]; if (!file) return;
  try {
    const project = JSON.parse(await file.text()); validateProject(project, true);
    if (frames.length && !confirm('Replace the current project? Export it first if you want to keep it.')) return;
    const data = new FormData();
    for (const f of project.frames) { const response = await fetch(f.data); const blob = await response.blob(); data.append('photos', blob, f.name); }
    if (project.frames.length) {
      const response = await fetch('/api/photos', { method: 'POST', body: data }); const photos = await response.json(); if (!response.ok) throw Error(photos.error); if (photos.length !== project.frames.length) throw Error('Some photos could not be imported.');
      project.frames = project.frames.map((f, i) => ({ ...photos[i], name: f.name, x: f.x, y: f.y, scale: f.scale, rotation: f.rotation }));
    }
    validateProject(project); applyProject(project); saveState(); toast('Project imported.');
  } catch (error) { toast(`Could not import project: ${error.message}`); } finally { e.target.value = ''; }
};
function drawFrame(frame, alpha = 1) {
  if (!frame || !frame.image.complete || !frame.image.naturalWidth) return;
  const img = frame.image, fit = Math.min(canvas.width / img.naturalWidth, canvas.height / img.naturalHeight) * frame.scale;
  const w = img.naturalWidth * fit, h = img.naturalHeight * fit;
  ctx.save(); ctx.globalAlpha = alpha; ctx.translate(canvas.width / 2 + frame.x * canvas.width, canvas.height / 2 + frame.y * canvas.height); ctx.rotate(frame.rotation * Math.PI / 180); ctx.drawImage(img, -w / 2, -h / 2, w, h); ctx.restore();
}
function draw() {
  scheduleSave();
  const summary = $('timeline').querySelector('.frame.selected .frame-transform');
  if (summary && frames[selected]) updateTransformSummary(summary, frames[selected]);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawFrame(frames[selected]);
  const alpha = Number($('opacity').value) / 100;
  if ($('previous').checked) drawFrame(frames[selected - 1], alpha);
  if ($('next').checked) drawFrame(frames[selected + 1], alpha);
  if ($('grid').checked) {
    ctx.save(); ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)'; ctx.lineWidth = Math.max(1, canvas.width / 1000); ctx.beginPath();
    for (let i = 1; i < 3; i++) { const x = canvas.width * i / 3, y = canvas.height * i / 3; ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); }
    ctx.stroke(); ctx.restore();
  }
}
function updateTransformSummary(element, frame) {
  const edited = frame.rotation !== 0 || frame.scale !== 1 || frame.x !== 0 || frame.y !== 0;
  element.style.visibility = edited ? 'visible' : 'hidden';
  if (edited) { element.replaceChildren(); const first = document.createElement('div'), second = document.createElement('div'); first.textContent = `↻ ${+frame.rotation.toFixed(2)}° · Scale ${+(frame.scale * 100).toFixed(1)}%`; second.textContent = `X ${+(frame.x * 100).toFixed(2)}% · Y ${+(frame.y * 100).toFixed(2)}%`; element.append(first, second); }
}
function refresh() {
  $('empty').hidden = frames.length > 0; $('count').textContent = frames.length;
  $('frameLabel').textContent = selected < 0 ? 'No frame selected' : `FRAME ${selected + 1} / ${frames.length}`;
  $('canvasSize').textContent = `${canvas.width} × ${canvas.height}`;
  const f = frames[selected];
  for (const id of ['scale', 'rotation', 'x', 'y', 'reset', 'remove', 'left', 'right', 'play']) $(id).disabled = !f;
  if (f) { $('scale').value = f.scale; $('scaleValue').textContent = `${Math.round(f.scale * 100)}%`; $('rotation').value = f.rotation; $('rotationValue').textContent = `${f.rotation}°`; $('x').value = +(f.x * 100).toFixed(2); $('y').value = +(f.y * 100).toFixed(2); }
  $('timeline').replaceChildren();
  if (!frames.length) { const empty = document.createElement('div'); empty.className = 'timeline-empty'; empty.textContent = 'Your frames will appear here. Add some photos to get started.'; $('timeline').append(empty); }
  frames.forEach((frame, i) => { const item = document.createElement('div'); item.className = 'frame' + (i === selected ? ' selected' : ''); const summary = document.createElement('div'); summary.className = 'frame-transform'; updateTransformSummary(summary, frame); const image = document.createElement('img'); image.src = frame.url; image.alt = frame.name; const info = document.createElement('div'); info.className = 'frame-info'; const name = document.createElement('span'); name.className = 'frame-name'; name.textContent = frame.name; const index = document.createElement('span'); index.textContent = String(i + 1).padStart(2, '0'); info.append(name, index); item.append(summary, image, info); item.onclick = () => { selected = i; refresh(); }; $('timeline').append(item); });
  draw();
}
async function addFiles(input) {
  if (!input.files.length) return;
  const data = new FormData(); Array.from(input.files).forEach(file => data.append('photos', file));
  toast('Uploading photos…');
  try { const response = await fetch('/api/photos', { method: 'POST', body: data }); const result = await response.json(); if (!response.ok) throw Error(result.error); if (!result.length) throw Error('Please choose JPEG, PNG, or WebP photos.');
    for (const photo of result) { const image = new Image(); image.src = photo.url; image.onload = draw; frames.push({ ...photo, image, x: 0, y: 0, scale: 1, rotation: 0 }); }
    if (selected < 0) selected = 0; refresh(); toast(`Added ${result.length} photo${result.length === 1 ? '' : 's'}.`);
  } catch (error) { toast(error.message); } finally { input.value = ''; }
}
$('files').onchange = e => addFiles(e.target); $('emptyFiles').onchange = e => addFiles(e.target);
$('scale').oninput = e => { if (frames[selected]) { frames[selected].scale = +e.target.value; $('scaleValue').textContent = `${Math.round(e.target.value * 100)}%`; draw(); } };
$('rotation').oninput = e => { if (frames[selected]) { frames[selected].rotation = +e.target.value; $('rotationValue').textContent = `${e.target.value}°`; draw(); } };
for (const id of ['x', 'y']) $(id).oninput = e => { if (frames[selected] && e.target.value !== '') { frames[selected][id] = Math.max(-5, Math.min(5, +e.target.value / 100)); draw(); } };
$('reset').onclick = () => { Object.assign(frames[selected], { x: 0, y: 0, scale: 1, rotation: 0 }); refresh(); };
$('previous').onchange = $('next').onchange = $('grid').onchange = draw;
$('opacity').oninput = e => { $('opacityValue').textContent = e.target.value + '%'; draw(); };
canvas.onpointerdown = e => { if (selected < 0) return; canvas.setPointerCapture(e.pointerId); dragging = { x: e.clientX, y: e.clientY, fx: frames[selected].x, fy: frames[selected].y }; };
canvas.onpointermove = e => { if (!dragging || selected < 0) return; const rect = canvas.getBoundingClientRect(); const ratio = canvas.width / canvas.height; let w = rect.width, h = rect.height; if (w / h > ratio) w = h * ratio; else h = w / ratio; frames[selected].x = Math.max(-5, Math.min(5, dragging.fx + (e.clientX - dragging.x) / w)); frames[selected].y = Math.max(-5, Math.min(5, dragging.fy + (e.clientY - dragging.y) / h)); $('x').value = +(frames[selected].x * 100).toFixed(2); $('y').value = +(frames[selected].y * 100).toFixed(2); draw(); };
canvas.onpointerup = canvas.onpointercancel = () => { dragging = null; };
$('remove').onclick = () => { frames.splice(selected, 1); selected = Math.min(selected, frames.length - 1); if (!frames.length && playing) { clearInterval(playing); playing = null; $('play').textContent = '▶ Preview'; } refresh(); };
function move(delta) { const target = selected + delta; if (target < 0 || target >= frames.length) return; [frames[selected], frames[target]] = [frames[target], frames[selected]]; selected = target; refresh(); }
$('left').onclick = () => move(-1); $('right').onclick = () => move(1);
$('play').onclick = () => { if (playing) { clearInterval(playing); playing = null; $('play').textContent = '▶ Preview'; return; } const seconds = Math.max(.02, +$('duration').value || .25); $('play').textContent = '■ Stop'; playing = setInterval(() => { selected = (selected + 1) % frames.length; refresh(); }, seconds * 1000); };
$('exportTop').onclick = () => $('exportDialog').showModal(); $('close').onclick = () => $('exportDialog').close();
for (const id of ['width', 'height']) $(id).onchange = () => { const w = +$('width').value, h = +$('height').value; if (w >= 64 && w <= 3840 && h >= 64 && h <= 3840 && w % 2 === 0 && h % 2 === 0) { canvas.width = w; canvas.height = h; refresh(); } };
for (const id of ['fps', 'duration', 'crf']) $(id).addEventListener('change', scheduleSave);
$('exportOverlap').addEventListener('change', scheduleSave);
window.addEventListener('pagehide', () => { clearTimeout(saveTimer); saveState(); });
$('renderForm').onsubmit = async e => { e.preventDefault(); if (!frames.length) return toast('Add at least one photo first.'); const width = +$('width').value, height = +$('height').value; if (width % 2 || height % 2) return toast('Width and height must be even numbers.');
  $('renderButton').disabled = true; $('download').hidden = true; $('renderStatus').textContent = 'Starting render…';
  try { const response = await fetch('/api/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ frames: frames.map(({ id, x, y, scale, rotation }) => ({ id, x, y, scale, rotation })), width, height, fps: +$('fps').value, duration: +$('duration').value, crf: +$('crf').value, overlap: $('exportOverlap').checked }) }); let job = await response.json(); if (!response.ok) throw Error(job.error);
    while (job.status === 'rendering') { $('renderStatus').textContent = `Rendering… ${job.progress}%`; await new Promise(resolve => setTimeout(resolve, 1000)); const poll = await fetch(`/api/render/${job.id}`); job = await poll.json(); if (!poll.ok) throw Error(job.error); }
    if (job.status === 'error') throw Error(job.error); $('renderStatus').textContent = 'Your video is ready.'; $('download').href = job.url; $('download').hidden = false;
  } catch (error) { $('renderStatus').textContent = `Render failed: ${error.message}`; } finally { $('renderButton').disabled = false; }
};
try { const saved = localStorage.getItem(storageKey); if (saved) { const project = JSON.parse(saved); validateProject(project); applyProject(project); } else refresh(); }
catch (error) { refresh(); toast('Could not restore the locally saved project.'); }
restoring = false;
