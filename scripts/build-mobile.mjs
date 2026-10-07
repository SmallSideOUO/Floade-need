import fs from 'node:fs/promises'
import path from 'node:path'
import zlib from 'node:zlib'

const output = path.resolve('docs/mobile')
await fs.mkdir(path.join(output, 'vendor'), { recursive: true })
for (const name of await fs.readdir('mobile')) await fs.copyFile(path.join('mobile', name), path.join(output, name))
for (const [from, name] of [['node_modules/marked/lib/marked.umd.js', 'marked.umd.js'], ['node_modules/dompurify/dist/purify.min.js', 'purify.min.js'], ['node_modules/marked/LICENSE', 'marked-LICENSE.md'], ['node_modules/dompurify/LICENSE', 'dompurify-LICENSE']]) {
  await fs.copyFile(from, path.join(output, 'vendor', name))
}
function crc(buffer) {
  let result = 0xffffffff
  for (const byte of buffer) { result ^= byte; for (let bit = 0; bit < 8; bit++) result = (result >>> 1) ^ (result & 1 ? 0xedb88320 : 0) }
  return (result ^ 0xffffffff) >>> 0
}
function chunk(type, content) {
  const name = Buffer.from(type), size = Buffer.alloc(4), checksum = Buffer.alloc(4)
  size.writeUInt32BE(content.length); checksum.writeUInt32BE(crc(Buffer.concat([name, content])))
  return Buffer.concat([size, name, content, checksum])
}
// Rasterize the app's simple geometric icon. No external asset service is needed.
for (const size of [192, 512]) {
  const pixels = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const radius = Math.hypot(x + .5 - size / 2, y + .5 - size / 2) / size
    const color = radius < 38 / 512 ? [255, 255, 255] : radius < 152 / 512 ? [8, 8, 9] : radius < 158 / 512 ? [53, 53, 60] : [12, 12, 15]
    const index = y * (size * 4 + 1) + 1 + x * 4
    pixels.set([...color, 255], index)
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6
  await fs.writeFile(path.join(output, `icon-${size}.png`), Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]))
}
await fs.writeFile('docs/.nojekyll', '')
await fs.writeFile('docs/index.html', '<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=./mobile/"><title>Floade</title><a href="./mobile/">開啟 Floade 手機文件</a></html>\n')
console.log(`Mobile app built: ${output}`)
