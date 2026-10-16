'use strict';
// PPT 슬라이드를 '그대로' 그림으로 만든다
// - PowerPoint 가 설치돼 있으면 슬라이드마다 PNG 로 내보낸다 (.ppt .pps .pptx .ppsx 모두, 화면 그대로)
// - 없으면 .pptx/.ppsx 는 압축을 풀어 슬라이드 글자와 배경 그림만 꺼낸다

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFile } = require('child_process');

let ppAvailable = null;
/** PowerPoint 설치 여부 (레지스트리의 PowerPoint.Application) */
function hasPowerPoint() {
  if (ppAvailable !== null) return Promise.resolve(ppAvailable);
  if (process.platform !== 'win32') return Promise.resolve(ppAvailable = false);
  return new Promise(res => execFile('reg', ['query', 'HKCR\\PowerPoint.Application\\CurVer'], { windowsHide: true }, err => res(ppAvailable = !err)));
}

const PS = `
$ErrorActionPreference = 'Stop'
$pp = New-Object -ComObject PowerPoint.Application
try {
  $p = $pp.Presentations.Open($env:WC_PPT_FILE, -1, 0, 0)
  $sw = $p.PageSetup.SlideWidth; $sh = $p.PageSetup.SlideHeight
  # (PowerShell 변수는 대소문자를 가리지 않는다)
  $outW = 1920; $outH = [int](1920 * $sh / $sw)
  $n = 0
  foreach ($s in $p.Slides) {
    if ($s.SlideShowTransition.Hidden) { continue }
    $n++
    $s.Export((Join-Path $env:WC_PPT_OUT ('slide-{0:D3}.png' -f $n)), 'PNG', $outW, $outH)
  }
  $p.Close()
  Write-Output "OK $n $outW $outH"
} finally {
  if ($pp.Presentations.Count -eq 0) { $pp.Quit() }
}
`;

/** PowerPoint 로 슬라이드를 PNG 로 내보낸다 → ['slide-001.png', …] */
function exportWithPowerPoint(file, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const enc = Buffer.from(PS, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc], {
      windowsHide: true, timeout: 120000,
      env: { ...process.env, WC_PPT_FILE: path.resolve(file), WC_PPT_OUT: path.resolve(outDir) },
    }, (err, stdout, stderr) => {
      const m = String(stdout).match(/OK (\d+) (\d+) (\d+)/);
      if (err || !m) {
        const msg = String(stderr || (err && err.message) || '');
        if (/password|암호/i.test(msg)) return reject(new Error('암호가 걸린 파일이라 열 수 없습니다. PowerPoint 에서 암호를 풀고 저장해 주세요.'));
        return reject(new Error('PowerPoint 로 슬라이드를 만들지 못했습니다. ' + (msg.split('\n').find(l => l.trim()) || '')));
      }
      const files = fs.readdirSync(outDir).filter(f => /^slide-\d{3}\.png$/.test(f)).sort();
      resolve({ files, width: +m[2], height: +m[3] });
    });
  });
}

// ---------------- .pptx (zip) ----------------
function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('pptx 파일 형식이 아닙니다.');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let k = 0; k < count && buf.readUInt32LE(p) === 0x02014b50; k++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const off = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString('utf8');
    entries.set(name, { method, csize, off });
    p += 46 + nlen + xlen + clen;
  }
  const get = name => {
    const e = entries.get(name);
    if (!e) return null;
    const start = e.off + 30 + buf.readUInt16LE(e.off + 26) + buf.readUInt16LE(e.off + 28);
    const raw = buf.subarray(start, start + e.csize);
    return e.method === 8 ? zlib.inflateRawSync(raw) : raw;
  };
  return { names: [...entries.keys()], get };
}

const xmlText = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** .pptx → { background, texts[][] } (PowerPoint 가 없을 때) */
function extractPptx(file) {
  const z = readZip(fs.readFileSync(file));
  const slides = z.names.filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]);
  const texts = [];
  const used = new Map();
  for (const s of slides) {
    const xml = z.get(s).toString('utf8');
    const paras = [...xml.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)].map(m => [...m[1].matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(t => xmlText(t[1])).join('')).filter(t => t.trim());
    texts.push(paras);
    const rels = z.get(s.replace('slides/', 'slides/_rels/') + '.rels');
    if (rels) for (const m of rels.toString('utf8').matchAll(/Target="\.\.\/media\/([^"]+\.(png|jpe?g))"/gi)) used.set(m[1], (used.get(m[1]) || 0) + 1);
  }
  // 슬라이드에 그림이 없으면 레이아웃·마스터(배경이 보통 여기에)
  if (!used.size) {
    for (const n of z.names.filter(x => /^ppt\/(slideLayouts|slideMasters)\/_rels\/.+\.rels$/.test(x))) {
      for (const m of z.get(n).toString('utf8').matchAll(/Target="\.\.\/media\/([^"]+\.(png|jpe?g))"/gi)) used.set(m[1], (used.get(m[1]) || 0) + 1);
    }
  }
  // 가장 많은 슬라이드에 쓰인 그림 = 배경
  let background = null;
  const best = [...used.entries()].sort((a, b) => b[1] - a[1])[0];
  if (best) background = { ext: /png$/i.test(best[0]) ? 'png' : 'jpg', data: z.get('ppt/media/' + best[0]) };
  return { background, scores: [], texts };
}

module.exports = { hasPowerPoint, exportWithPowerPoint, extractPptx, readZip };
