// Signature tools: clean up an uploaded photo/scan, or draw one with mouse, pen or finger.
// Output is always a trimmed, transparent PNG data URL.

const MAX_W = 700;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('That file could not be read as an image.'));
    img.src = src;
  });
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Could not read the file.'));
    r.readAsDataURL(file);
  });
}

// Crop to the ink with a little padding. Returns a canvas.
function trim(canvas, pad = 12) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 16) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null; // blank
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad);
  maxY = Math.min(height - 1, maxY + pad);
  const out = document.createElement('canvas');
  out.width = maxX - minX + 1;
  out.height = maxY - minY + 1;
  out.getContext('2d').drawImage(canvas, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

// Turns a photo or scan of a signature into dark ink on a transparent background.
export async function processUpload(file, { removeBackground = true } = {}) {
  if (!file || !/^image\//.test(file.type)) throw new Error('Please choose an image (PNG or JPG).');
  if (file.size > 8 * 1024 * 1024) throw new Error('That image is over 8 MB. Try a smaller one.');
  const img = await loadImage(await readFile(file));
  const scale = Math.min(1, MAX_W * 2 / img.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  if (removeBackground) {
    const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = id.data;
    // estimate the paper brightness from the image border
    let sum = 0, n = 0;
    const sample = (x, y) => {
      const i = (y * canvas.width + x) * 4;
      sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      n++;
    };
    for (let x = 0; x < canvas.width; x += 4) { sample(x, 0); sample(x, canvas.height - 1); }
    for (let y = 0; y < canvas.height; y += 4) { sample(0, y); sample(canvas.width - 1, y); }
    const paper = n ? sum / n : 255;
    const inkCut = Math.min(paper - 40, 200);
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      if (lum >= paper - 12) {
        d[i + 3] = 0;
      } else {
        // soft edge between ink and paper
        const t = Math.max(0, Math.min(1, (paper - 12 - lum) / Math.max(1, paper - 12 - inkCut)));
        d[i + 3] = Math.round(d[i + 3] * t);
      }
    }
    ctx.putImageData(id, 0, 0);
  }
  const trimmed = trim(canvas) || canvas;
  return finalize(trimmed);
}

function finalize(canvas) {
  if (canvas.width <= MAX_W) return canvas.toDataURL('image/png');
  const s = MAX_W / canvas.width;
  const out = document.createElement('canvas');
  out.width = MAX_W;
  out.height = Math.round(canvas.height * s);
  const ctx = out.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}

// A drawing pad. Call pad.toDataURL() to get the result, pad.clear(), pad.undo().
export function createPad(canvas, { color = '#111111', onChange } = {}) {
  const ctx = canvas.getContext('2d');
  let strokes = [];
  let current = null;
  let penColor = color;

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * ratio));
    canvas.height = Math.max(1, Math.round(rect.height * ratio));
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    redraw();
  }

  function drawStroke(s) {
    const pts = s.points;
    if (!pts.length) return;
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, 1.4, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      ctx.lineWidth = b.w;
      ctx.beginPath();
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      if (i === 1) ctx.moveTo(a.x, a.y);
      else ctx.moveTo((pts[i - 2].x + a.x) / 2, (pts[i - 2].y + a.y) / 2);
      ctx.quadraticCurveTo(a.x, a.y, mx, my);
      ctx.stroke();
    }
  }

  function redraw() {
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    strokes.forEach(drawStroke);
    if (current) drawStroke(current);
  }

  function point(e) {
    const rect = canvas.getBoundingClientRect();
    const pressure = e.pressure && e.pointerType === 'pen' ? e.pressure : 0.5;
    return { x: e.clientX - rect.left, y: e.clientY - rect.top, w: 1.4 + pressure * 2.4 };
  }

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    current = { color: penColor, points: [point(e)] };
    redraw();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!current) return;
    const p = point(e);
    const last = current.points[current.points.length - 1];
    // thinner when moving fast, like real ink
    const dist = Math.hypot(p.x - last.x, p.y - last.y);
    if (dist < 0.8) return;
    p.w = Math.max(1.1, Math.min(p.w, p.w * (1.6 - Math.min(dist, 30) / 30)));
    current.points.push(p);
    redraw();
  });
  const end = () => {
    if (!current) return;
    strokes.push(current);
    current = null;
    onChange?.(strokes.length);
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.style.touchAction = 'none';

  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  return {
    clear() { strokes = []; redraw(); onChange?.(0); },
    undo() { strokes.pop(); redraw(); onChange?.(strokes.length); },
    setColor(c) { penColor = c; },
    isEmpty() { return strokes.length === 0; },
    toDataURL() {
      if (!strokes.length) return null;
      const t = trim(canvas, 14);
      return t ? finalize(t) : null;
    },
    destroy() { ro.disconnect(); },
  };
}
