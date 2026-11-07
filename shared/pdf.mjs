// shared/pdf.mjs — 零依赖 JPEG → PDF（DCTDecode 直嵌，不重编码、无损画质）。
// 页面尺寸来自各 provider 的元数据（单位 pt）。
// 两套 agent 共用；产物是图像型 PDF，文字不可选中 / 搜索 / 复制。

// 从 JPEG SOF0/1/2 段解析像素尺寸
export function jpegSize(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error("不是 JPEG");
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  throw new Error("未找到 SOF 段");
}

export function buildPdf(images, { pageW = 597, pageH = 842, title = "" } = {}) {
  const enc = new TextEncoder();
  const chunks = [];
  let offset = 0;
  const offsets = [];
  const push = (data) => {
    const b = typeof data === "string" ? enc.encode(data) : data;
    chunks.push(b);
    offset += b.length;
  };
  const obj = (...parts) => {
    offsets.push(offset);
    push(`${offsets.length} 0 obj\n`);
    for (const p of parts) push(p);
    push("\nendobj\n");
  };

  push("%PDF-1.4\n%\xB5\xB5\xB5\xB5\n");

  const n = images.length;
  // 编号布局：1=Catalog, 2=Pages, [3=Info], 之后每页三个对象：Page / Image / Contents
  const base = 3 + (title ? 1 : 0);
  const kids = images.map((_, k) => `${base + k * 3} 0 R`).join(" ");

  obj("<< /Type /Catalog /Pages 2 0 R >>");
  obj(`<< /Type /Pages /Kids [${kids}] /Count ${n} >>`);
  if (title) obj(`<< /Info << /Title (${title.replace(/[()\\]/g, " ")}) >> >>`);

  images.forEach((img, k) => {
    const pageObj = base + k * 3;
    const imgObj = pageObj + 1;
    const contObj = pageObj + 2;
    const { width: pw, height: ph } = jpegSize(img.buf);
    const s = Math.min(pageW / pw, pageH / ph); // 等比适配页面
    const w = pw * s, h = ph * s;
    const x = (pageW - w) / 2, y = (pageH - h) / 2;
    const content = `q 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} cm ${w.toFixed(2)} 0 0 ${h.toFixed(2)} 0 0 cm /Im${k} Do Q`;

    obj(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] ` +
        `/Resources << /XObject << /Im${k} ${imgObj} 0 R >> /ProcSet [/PDF /ImageC] >> ` +
        `/Contents ${contObj} 0 R >>`
    );
    obj(
      `<< /Type /XObject /Subtype /Image /Width ${pw} /Height ${ph} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.buf.length} >>\nstream\n`,
      img.buf,
      "\nendstream"
    );
    obj(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });

  const xrefPos = offset;
  const total = offsets.length + 1;
  let xref = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (const o of offsets) xref += String(o).padStart(10, "0") + " 00000 n \n";
  push(xref);
  push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);

  return Buffer.concat(chunks);
}
