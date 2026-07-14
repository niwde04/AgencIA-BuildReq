import { deflateSync, inflateSync } from "node:zlib";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const PAGE_MARGIN_X = 42;
const PAGE_MARGIN_BOTTOM = 52;
const HEH_LOGO_PNG_BASE64 =
  "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";

type PdfFont = "F1" | "F2";
type PdfRgb = [number, number, number];
type PdfPage = {
  commands: string[];
  width: number;
  height: number;
  images: Set<string>;
};

type PdfImage = {
  name: string;
  width: number;
  height: number;
  rgbData: Buffer;
};

type ProcurementField = {
  label: string;
  value: string;
};

type ProcurementItem = {
  description: string;
  quantityLabel: string;
  amountLabel?: string;
  metaLines?: string[];
};

type ProcurementSummaryRow = {
  label: string;
  value: string;
  emphasized?: boolean;
};

function readPngChunks(buffer: Buffer) {
  const signature = "89504e470d0a1a0a";
  if (buffer.subarray(0, 8).toString("hex") !== signature) {
    throw new Error("Invalid PNG signature");
  }

  const chunks: Array<{ type: string; data: Buffer }> = [];
  let offset = 8;

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    chunks.push({ type, data });
    offset += 12 + length;
    if (type === "IEND") break;
  }

  return chunks;
}

function paethPredictor(left: number, up: number, upLeft: number) {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);

  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  if (upDistance <= upLeftDistance) return up;
  return upLeft;
}

function readPackedSample(row: Buffer, index: number, bitDepth: number) {
  if (bitDepth === 8) return row[index];

  const samplesPerByte = 8 / bitDepth;
  const byte = row[Math.floor(index / samplesPerByte)];
  const shift = 8 - bitDepth - (index % samplesPerByte) * bitDepth;
  return (byte >> shift) & ((1 << bitDepth) - 1);
}

function flattenOverWhite(red: number, green: number, blue: number, alpha = 255) {
  const opacity = alpha / 255;
  return [
    Math.round(red * opacity + 255 * (1 - opacity)),
    Math.round(green * opacity + 255 * (1 - opacity)),
    Math.round(blue * opacity + 255 * (1 - opacity)),
  ];
}

function createPdfImageFromPngBase64(name: string, base64: string): PdfImage {
  const chunks = readPngChunks(Buffer.from(base64, "base64"));
  const ihdr = chunks.find(chunk => chunk.type === "IHDR")?.data;
  if (!ihdr) throw new Error("PNG missing IHDR chunk");

  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const bitDepth = ihdr[8];
  const colorType = ihdr[9];
  const compression = ihdr[10];
  const filter = ihdr[11];
  const interlace = ihdr[12];

  if (compression !== 0 || filter !== 0 || interlace !== 0) {
    throw new Error("Unsupported PNG encoding");
  }

  const paletteChunk = chunks.find(chunk => chunk.type === "PLTE")?.data;
  const transparencyChunk = chunks.find(chunk => chunk.type === "tRNS")?.data;
  const idat = Buffer.concat(
    chunks.filter(chunk => chunk.type === "IDAT").map(chunk => chunk.data)
  );
  const inflated = inflateSync(idat);
  const bitsPerPixel =
    colorType === 6
      ? bitDepth * 4
      : colorType === 2
        ? bitDepth * 3
        : bitDepth;
  const filterBytesPerPixel = Math.max(1, Math.ceil(bitsPerPixel / 8));
  const scanlineBytes = Math.ceil((width * bitsPerPixel) / 8);
  const rows: Buffer[] = [];
  let sourceOffset = 0;

  for (let rowIndex = 0; rowIndex < height; rowIndex += 1) {
    const filterType = inflated[sourceOffset];
    const source = inflated.subarray(sourceOffset + 1, sourceOffset + 1 + scanlineBytes);
    const previous = rows[rowIndex - 1];
    const row = Buffer.alloc(scanlineBytes);

    for (let index = 0; index < scanlineBytes; index += 1) {
      const left = index >= filterBytesPerPixel ? row[index - filterBytesPerPixel] : 0;
      const up = previous?.[index] ?? 0;
      const upLeft =
        index >= filterBytesPerPixel ? (previous?.[index - filterBytesPerPixel] ?? 0) : 0;

      if (filterType === 0) row[index] = source[index];
      else if (filterType === 1) row[index] = (source[index] + left) & 0xff;
      else if (filterType === 2) row[index] = (source[index] + up) & 0xff;
      else if (filterType === 3) row[index] = (source[index] + Math.floor((left + up) / 2)) & 0xff;
      else if (filterType === 4) {
        row[index] = (source[index] + paethPredictor(left, up, upLeft)) & 0xff;
      } else {
        throw new Error(`Unsupported PNG filter ${filterType}`);
      }
    }

    rows.push(row);
    sourceOffset += scanlineBytes + 1;
  }

  const palette =
    paletteChunk && colorType === 3
      ? Array.from({ length: paletteChunk.length / 3 }, (_, index) => [
          paletteChunk[index * 3],
          paletteChunk[index * 3 + 1],
          paletteChunk[index * 3 + 2],
        ])
      : [];
  const rgbData = Buffer.alloc(width * height * 3);

  rows.forEach((row, rowIndex) => {
    for (let column = 0; column < width; column += 1) {
      let red = 255;
      let green = 255;
      let blue = 255;
      let alpha = 255;

      if (colorType === 3) {
        const paletteIndex = readPackedSample(row, column, bitDepth);
        const paletteColor = palette[paletteIndex] ?? [255, 255, 255];
        [red, green, blue] = paletteColor;
        alpha = transparencyChunk?.[paletteIndex] ?? 255;
      } else if (colorType === 6 && bitDepth === 8) {
        const index = column * 4;
        red = row[index];
        green = row[index + 1];
        blue = row[index + 2];
        alpha = row[index + 3];
      } else if (colorType === 2 && bitDepth === 8) {
        const index = column * 3;
        red = row[index];
        green = row[index + 1];
        blue = row[index + 2];
      } else if (colorType === 0 && bitDepth === 8) {
        red = green = blue = row[column];
      } else {
        throw new Error(`Unsupported PNG color type ${colorType} with bit depth ${bitDepth}`);
      }

      const outputIndex = (rowIndex * width + column) * 3;
      const flattened = flattenOverWhite(red, green, blue, alpha);
      rgbData[outputIndex] = flattened[0];
      rgbData[outputIndex + 1] = flattened[1];
      rgbData[outputIndex + 2] = flattened[2];
    }
  });

  return { name, width, height, rgbData };
}

const HEH_LOGO_IMAGE = createPdfImageFromPngBase64("HehLogo", HEH_LOGO_PNG_BASE64);

function sanitizePdfText(value: string) {
  return value
    .replace(/\u00A0/g, " ")
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/[“”«»]/g, '"')
    .replace(/[‘’´`]/g, "'")
    .replace(/\u2026/g, "...")
    .replace(/\u2022/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .split("")
    .map((char) => {
      const code = char.charCodeAt(0);
      if (code <= 255) return char;

      const normalized = char.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (normalized && normalized.charCodeAt(0) <= 255) return normalized;
      return "?";
    })
    .join("");
}

function encodePdfHex(value: string) {
  return Buffer.from(sanitizePdfText(value), "latin1")
    .toString("hex")
    .toUpperCase();
}

function formatNumber(value: number) {
  return Number(value.toFixed(2))
    .toString()
    .replace(/\.0+$/, "");
}

function rgb(color: PdfRgb) {
  return `${formatNumber(color[0])} ${formatNumber(color[1])} ${formatNumber(color[2])}`;
}

function createPage(options: { width?: number; height?: number } = {}): PdfPage {
  return {
    commands: [],
    width: options.width ?? PAGE_WIDTH,
    height: options.height ?? PAGE_HEIGHT,
    images: new Set<string>(),
  };
}

function toPdfRectY(page: PdfPage, top: number, height: number) {
  return page.height - top - height;
}

function toPdfTextY(page: PdfPage, top: number, fontSize: number) {
  return page.height - top - fontSize;
}

function measureTextWidth(text: string, fontSize: number, font: PdfFont = "F1") {
  let units = 0;

  for (const char of sanitizePdfText(text)) {
    if (char === " ") {
      units += 0.28;
    } else if ("ilI1|!".includes(char)) {
      units += 0.28;
    } else if ("mwMW@#%&".includes(char)) {
      units += 0.9;
    } else if (/[0-9]/.test(char)) {
      units += 0.56;
    } else if (/[A-ZÁÉÍÓÚÜÑ]/.test(char)) {
      units += 0.62;
    } else if (/[.,;:]/.test(char)) {
      units += 0.24;
    } else {
      units += font === "F2" ? 0.58 : 0.52;
    }
  }

  return units * fontSize;
}

function breakLongWord(word: string, maxWidth: number, fontSize: number, font: PdfFont) {
  const fragments: string[] = [];
  let remaining = word;

  while (remaining && measureTextWidth(remaining, fontSize, font) > maxWidth) {
    let sliceLength = 1;
    while (
      sliceLength < remaining.length &&
      measureTextWidth(remaining.slice(0, sliceLength + 1), fontSize, font) <= maxWidth
    ) {
      sliceLength += 1;
    }
    fragments.push(remaining.slice(0, sliceLength));
    remaining = remaining.slice(sliceLength);
  }

  if (remaining) fragments.push(remaining);
  return fragments;
}

function wrapText(
  text: string,
  maxWidth: number,
  fontSize: number,
  font: PdfFont = "F1",
  maxLines?: number
) {
  const normalized = sanitizePdfText(text);
  if (!normalized) return [""];

  const lines: string[] = [];
  let current = "";

  for (const rawWord of normalized.split(" ")) {
    const wordParts =
      measureTextWidth(rawWord, fontSize, font) <= maxWidth
        ? [rawWord]
        : breakLongWord(rawWord, maxWidth, fontSize, font);

    for (const word of wordParts) {
      const candidate = current ? `${current} ${word}` : word;
      if (measureTextWidth(candidate, fontSize, font) <= maxWidth) {
        current = candidate;
        continue;
      }

      if (current) lines.push(current);
      current = word;

      if (maxLines && lines.length >= maxLines) {
        const truncated = lines.slice(0, maxLines);
        truncated[maxLines - 1] = `${truncated[maxLines - 1]}...`;
        return truncated;
      }
    }
  }

  if (current) lines.push(current);

  if (maxLines && lines.length > maxLines) {
    const truncated = lines.slice(0, maxLines);
    truncated[maxLines - 1] = `${truncated[maxLines - 1]}...`;
    return truncated;
  }

  return lines;
}

function drawRect(
  page: PdfPage,
  x: number,
  top: number,
  width: number,
  height: number,
  options: {
    fill?: PdfRgb;
    stroke?: PdfRgb;
    lineWidth?: number;
  } = {}
) {
  const y = toPdfRectY(page, top, height);
  page.commands.push("q");
  if (options.fill) page.commands.push(`${rgb(options.fill)} rg`);
  if (options.stroke) page.commands.push(`${rgb(options.stroke)} RG`);
  if (options.lineWidth) page.commands.push(`${formatNumber(options.lineWidth)} w`);
  page.commands.push(
    `${formatNumber(x)} ${formatNumber(y)} ${formatNumber(width)} ${formatNumber(height)} re`
  );
  page.commands.push(
    options.fill && options.stroke ? "B" : options.fill ? "f" : "S"
  );
  page.commands.push("Q");
}

function drawLine(
  page: PdfPage,
  x1: number,
  top1: number,
  x2: number,
  top2: number,
  color: PdfRgb,
  width = 1
) {
  page.commands.push("q");
  page.commands.push(`${rgb(color)} RG`);
  page.commands.push(`${formatNumber(width)} w`);
  page.commands.push(
    `${formatNumber(x1)} ${formatNumber(page.height - top1)} m ${formatNumber(x2)} ${formatNumber(
      page.height - top2
    )} l S`
  );
  page.commands.push("Q");
}

function drawImage(
  page: PdfPage,
  image: PdfImage,
  x: number,
  top: number,
  width: number,
  height: number
) {
  page.images.add(image.name);
  page.commands.push("q");
  page.commands.push(
    `${formatNumber(width)} 0 0 ${formatNumber(height)} ${formatNumber(x)} ${formatNumber(
      toPdfRectY(page, top, height)
    )} cm`
  );
  page.commands.push(`/${image.name} Do`);
  page.commands.push("Q");
}

function drawImageContained(
  page: PdfPage,
  image: PdfImage,
  params: {
    x: number;
    top: number;
    width: number;
    height: number;
    background?: PdfRgb;
  }
) {
  if (params.background) {
    drawRect(page, params.x, params.top, params.width, params.height, {
      fill: params.background,
    });
  }

  const scale = Math.min(params.width / image.width, params.height / image.height);
  const imageWidth = image.width * scale;
  const imageHeight = image.height * scale;

  drawImage(
    page,
    image,
    params.x + (params.width - imageWidth) / 2,
    params.top + (params.height - imageHeight) / 2,
    imageWidth,
    imageHeight
  );
}

function drawText(
  page: PdfPage,
  params: {
    x: number;
    top: number;
    text: string;
    fontSize: number;
    color?: PdfRgb;
    font?: PdfFont;
    align?: "left" | "center" | "right";
    width?: number;
  }
) {
  const text = sanitizePdfText(params.text);
  if (!text) return;

  const font = params.font ?? "F1";
  const color = params.color ?? [0.1, 0.12, 0.16];
  const width = measureTextWidth(text, params.fontSize, font);
  let x = params.x;

  if (params.align === "center" && params.width) {
    x = params.x + (params.width - width) / 2;
  } else if (params.align === "right" && params.width) {
    x = params.x + params.width - width;
  }

  page.commands.push("BT");
  page.commands.push(`/${font} ${formatNumber(params.fontSize)} Tf`);
  page.commands.push(`${rgb(color)} rg`);
  page.commands.push(
    `1 0 0 1 ${formatNumber(x)} ${formatNumber(toPdfTextY(page, params.top, params.fontSize))} Tm`
  );
  page.commands.push(`<${encodePdfHex(text)}> Tj`);
  page.commands.push("ET");
}

function drawTextBlock(
  page: PdfPage,
  params: {
    x: number;
    top: number;
    width: number;
    text: string;
    fontSize: number;
    color?: PdfRgb;
    font?: PdfFont;
    leading?: number;
    maxLines?: number;
  }
) {
  const lines = wrapText(
    params.text,
    params.width,
    params.fontSize,
    params.font ?? "F1",
    params.maxLines
  );
  const leading = params.leading ?? params.fontSize * 1.35;

  lines.forEach((line, index) => {
    drawText(page, {
      x: params.x,
      top: params.top + index * leading,
      text: line,
      fontSize: params.fontSize,
      color: params.color,
      font: params.font,
    });
  });

  return {
    lines,
    height: lines.length * leading,
  };
}

function drawWatermark(
  page: PdfPage,
  params: {
    text: string;
    fontSize?: number;
    color?: PdfRgb;
    font?: PdfFont;
    angleDegrees?: number;
  }
) {
  const text = sanitizePdfText(params.text);
  if (!text) return;

  const font = params.font ?? "F2";
  const fontSize = params.fontSize ?? 72;
  const color = params.color ?? [0.9, 0.91, 0.94];
  const angleRadians = ((params.angleDegrees ?? 32) * Math.PI) / 180;
  const cos = Math.cos(angleRadians);
  const sin = Math.sin(angleRadians);
  const width = measureTextWidth(text, fontSize, font);
  const centerX = page.width / 2;
  const centerY = page.height / 2;
  const startX = centerX - (width * cos) / 2;
  const startY = centerY - (width * sin) / 2 - fontSize * 0.14;

  page.commands.push("q");
  page.commands.push("BT");
  page.commands.push(`/${font} ${formatNumber(fontSize)} Tf`);
  page.commands.push(`${rgb(color)} rg`);
  page.commands.push(
    `${formatNumber(cos)} ${formatNumber(sin)} ${formatNumber(-sin)} ${formatNumber(
      cos
    )} ${formatNumber(startX)} ${formatNumber(startY)} Tm`
  );
  page.commands.push(`<${encodePdfHex(text)}> Tj`);
  page.commands.push("ET");
  page.commands.push("Q");
}

function buildPdfBase64FromPages(pages: PdfPage[]) {
  const imageRegistry = new Map([[HEH_LOGO_IMAGE.name, HEH_LOGO_IMAGE]]);
  const imageNames = Array.from(
    new Set(pages.flatMap(page => Array.from(page.images)))
  );
  const images = imageNames.map(name => {
    const image = imageRegistry.get(name);
    if (!image) throw new Error(`Unknown PDF image ${name}`);
    return image;
  });
  const imageObjectStartId = 5;
  const pageObjectStartId = imageObjectStartId + images.length;
  const imageObjectIds = new Map(
    images.map((image, index) => [image.name, imageObjectStartId + index])
  );
  const objects: string[] = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj",
    `2 0 obj\n<< /Type /Pages /Kids [${pages
      .map((_, index) => `${pageObjectStartId + index * 2} 0 R`)
      .join(" ")}] /Count ${pages.length} >>\nendobj`,
    "3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj",
  ];

  images.forEach(image => {
    const objectId = imageObjectIds.get(image.name)!;
    const stream = `${deflateSync(image.rgbData).toString("hex").toUpperCase()}>`;

    objects.push(
      `${objectId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter [/ASCIIHexDecode /FlateDecode] /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}\nendstream\nendobj`
    );
  });

  pages.forEach((page, index) => {
    const pageObjectId = pageObjectStartId + index * 2;
    const contentObjectId = pageObjectId + 1;
    const stream = page.commands.join("\n");
    const xObjectEntries = Array.from(page.images)
      .map(name => `/${name} ${imageObjectIds.get(name)!} 0 R`)
      .join(" ");
    const xObjectResources = xObjectEntries
      ? ` /XObject << ${xObjectEntries} >>`
      : "";

    objects.push(
      `${pageObjectId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${formatNumber(page.width)} ${formatNumber(page.height)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>${xObjectResources} >> /Contents ${contentObjectId} 0 R >>\nendobj`
    );
    objects.push(
      `${contentObjectId} 0 obj\n<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}\nendstream\nendobj`
    );
  });

  let output = "%PDF-1.4\n";
  const offsets = [0];

  for (const object of objects) {
    offsets.push(Buffer.byteLength(output, "ascii"));
    output += `${object}\n`;
  }

  const xrefOffset = Buffer.byteLength(output, "ascii");
  output += `xref\n0 ${objects.length + 1}\n`;
  output += "0000000000 65535 f \n";
  for (let index = 1; index <= objects.length; index += 1) {
    output += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }

  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(output, "ascii").toString("base64");
}

function drawInfoCard(
  page: PdfPage,
  params: {
    x: number;
    top: number;
    width: number;
    height: number;
    label: string;
    value: string;
    accent: PdfRgb;
    valueFontSize?: number;
    maxLines?: number;
  }
) {
  drawRect(page, params.x, params.top, params.width, params.height, {
    fill: [0.97, 0.98, 0.985],
    stroke: [0.87, 0.89, 0.92],
    lineWidth: 0.8,
  });
  drawRect(page, params.x, params.top, params.width, 4, {
    fill: params.accent,
  });
  drawText(page, {
    x: params.x + 14,
    top: params.top + 14,
    text: params.label.toUpperCase(),
    fontSize: 10,
    color: [0.42, 0.46, 0.52],
    font: "F2",
  });
  drawTextBlock(page, {
    x: params.x + 14,
    top: params.top + 32,
    width: params.width - 28,
    text: params.value,
    fontSize: params.valueFontSize ?? 13,
    font: "F2",
    color: [0.13, 0.15, 0.2],
    leading: 15.5,
    maxLines: params.maxLines ?? 3,
  });
}

export function buildSimplePdfBase64(title: string, lines: string[]) {
  const page = createPage();
  drawText(page, {
    x: 50,
    top: 42,
    text: title,
    fontSize: 18,
    font: "F2",
  });

  let top = 82;
  for (const line of lines.slice(0, 30)) {
    drawText(page, {
      x: 50,
      top,
      text: line,
      fontSize: 12,
      color: [0.18, 0.2, 0.24],
    });
    top += 20;
  }

  return buildPdfBase64FromPages([page]);
}

export function buildProcurementPdfBase64(params: {
  title: string;
  documentNumber: string;
  badgeText: string;
  primaryFields: [ProcurementField, ProcurementField];
  secondaryFields: ProcurementField[];
  items: ProcurementItem[];
  summaryRows?: ProcurementSummaryRow[];
  generatedLabel: string;
  footerNote?: string;
  watermarkText?: string;
  detailTitle?: string;
  detailDescription?: string;
}) {
  const palette = {
    ink: [0.11, 0.14, 0.2] as PdfRgb,
    accent: [0.82, 0.16, 0.22] as PdfRgb,
    accentSoft: [0.96, 0.9, 0.92] as PdfRgb,
    border: [0, 0, 0] as PdfRgb,
    muted: [0.45, 0.48, 0.54] as PdfRgb,
    white: [1, 1, 1] as PdfRgb,
    rowAlt: [0.985, 0.988, 0.992] as PdfRgb,
  };

  const pages: PdfPage[] = [];
  let page = createPage();
  pages.push(page);
  const hasAmountColumn = params.items.some((item) => Boolean(item.amountLabel));
  const descriptionWidth = hasAmountColumn ? 274 : 340;
  const quantityColumnX = hasAmountColumn ? 388 : 454;
  const quantityColumnWidth = hasAmountColumn ? 68 : 98;
  const amountColumnX = 464;
  const amountColumnWidth = 88;

  const drawFirstPageHeader = () => {
    drawRect(page, 36, 34, 540, 92, { fill: palette.ink });
    drawRect(page, 36, 120, 540, 6, { fill: palette.accent });
    drawText(page, {
      x: 56,
      top: 52,
      text: params.title.toUpperCase(),
      fontSize: 10,
      font: "F2",
      color: [0.84, 0.87, 0.93],
    });
    drawText(page, {
      x: 56,
      top: 72,
      text: params.documentNumber,
      fontSize: 25,
      font: "F2",
      color: palette.white,
    });
    drawText(page, {
      x: 56,
      top: 106,
      text: `Generado: ${params.generatedLabel}`,
      fontSize: 10.5,
      color: [0.84, 0.87, 0.93],
    });

    const logoX = 454;
    drawImageContained(page, HEH_LOGO_IMAGE, {
      x: logoX,
      top: 47,
      width: 96,
      height: 66,
      background: palette.white,
    });

    const badgeWidth = Math.max(
      78,
      measureTextWidth(params.badgeText.toUpperCase(), 12, "F2") + 26
    );
    const badgeX = logoX - badgeWidth - 16;
    drawRect(page, badgeX, 58, badgeWidth, 30, {
      fill: palette.accent,
    });
    drawText(page, {
      x: badgeX,
      top: 67,
      width: badgeWidth,
      text: params.badgeText.toUpperCase(),
      fontSize: 12,
      font: "F2",
      color: palette.white,
      align: "center",
    });
  };

  const drawContinuationHeader = () => {
    drawText(page, {
      x: PAGE_MARGIN_X,
      top: 38,
      text: params.title.toUpperCase(),
      fontSize: 10,
      font: "F2",
      color: palette.muted,
    });
    drawText(page, {
      x: PAGE_MARGIN_X,
      top: 56,
      text: params.documentNumber,
      fontSize: 20,
      font: "F2",
      color: palette.ink,
    });
    drawLine(page, PAGE_MARGIN_X, 88, PAGE_WIDTH - PAGE_MARGIN_X, 88, palette.border, 1);
  };

  drawFirstPageHeader();
  drawInfoCard(page, {
    x: 42,
    top: 150,
    width: 258,
    height: 88,
    label: params.primaryFields[0].label,
    value: params.primaryFields[0].value,
    accent: palette.accent,
    valueFontSize: 13,
    maxLines: 3,
  });
  drawInfoCard(page, {
    x: 312,
    top: 150,
    width: 258,
    height: 88,
    label: params.primaryFields[1].label,
    value: params.primaryFields[1].value,
    accent: palette.accent,
    valueFontSize: 13,
    maxLines: 3,
  });

  params.secondaryFields.slice(0, 3).forEach((field, index) => {
    drawInfoCard(page, {
      x: 42 + index * 180,
      top: 252,
      width: 168,
      height: 76,
      label: field.label,
      value: field.value,
      accent: [0.79, 0.81, 0.86],
      valueFontSize: 12,
      maxLines: 2,
    });
  });

  drawText(page, {
    x: 42,
    top: 350,
    text: params.detailTitle ?? "Detalle del pedido",
    fontSize: 14,
    font: "F2",
    color: palette.ink,
  });
  drawText(page, {
    x: 42,
    top: 368,
    text:
      params.detailDescription ??
      "Resumen de artículos solicitados para gestionar la compra.",
    fontSize: 10.5,
    color: palette.muted,
  });

  const drawItemsTableHeader = (top: number) => {
    drawRect(page, 42, top, 528, 34, { fill: palette.ink });
    drawText(page, {
      x: 56,
      top: top + 10,
      text: "#",
      fontSize: 10.5,
      font: "F2",
      color: palette.white,
    });
    drawText(page, {
      x: 94,
      top: top + 10,
      text: "Descripción",
      fontSize: 10.5,
      font: "F2",
      color: palette.white,
    });
    drawText(page, {
      x: quantityColumnX,
      top: top + 10,
      width: quantityColumnWidth,
      text: "Cantidad",
      fontSize: 10.5,
      font: "F2",
      color: palette.white,
      align: "right",
    });
    if (hasAmountColumn) {
      drawText(page, {
        x: amountColumnX,
        top: top + 10,
        width: amountColumnWidth,
        text: "Importe",
        fontSize: 10.5,
        font: "F2",
        color: palette.white,
        align: "right",
      });
    }
  };

  const startNewPage = () => {
    page = createPage();
    pages.push(page);
    drawContinuationHeader();
    drawItemsTableHeader(106);
    return 140;
  };

  let currentTop = 388;
  drawItemsTableHeader(currentTop);
  currentTop += 36;

  params.items.forEach((item, index) => {
    const descriptionLines = wrapText(
      item.description,
      descriptionWidth,
      11.5,
      "F1",
      6
    );
    const detailText = (item.metaLines ?? []).filter(Boolean).join(" | ");
    const detailLines = detailText
      ? wrapText(detailText, descriptionWidth, 10, "F1", 4)
      : [];
    const rowHeight = Math.max(
      42,
      descriptionLines.length * 15 + detailLines.length * 12.5 + 18
    );

    if (currentTop + rowHeight > PAGE_HEIGHT - PAGE_MARGIN_BOTTOM - 26) {
      currentTop = startNewPage();
    }

    drawRect(page, 42, currentTop, 528, rowHeight, {
      fill: index % 2 === 0 ? palette.rowAlt : palette.white,
      stroke: palette.border,
      lineWidth: 0.7,
    });
    drawText(page, {
      x: 56,
      top: currentTop + 12,
      text: String(index + 1).padStart(2, "0"),
      fontSize: 10.5,
      font: "F2",
      color: palette.accent,
    });
    drawTextBlock(page, {
      x: 94,
      top: currentTop + 10,
      width: descriptionWidth,
      text: item.description,
      fontSize: 11.5,
      color: palette.ink,
      leading: 15,
      maxLines: 6,
    });
    if (detailLines.length > 0) {
      drawTextBlock(page, {
        x: 94,
        top: currentTop + 14 + descriptionLines.length * 15,
        width: descriptionWidth,
        text: detailLines.join("\n"),
        fontSize: 10,
        color: palette.muted,
        leading: 12.5,
        maxLines: 4,
      });
    }
    drawText(page, {
      x: quantityColumnX,
      top: currentTop + Math.max(11, rowHeight / 2 - 4),
      width: quantityColumnWidth,
      text: item.quantityLabel,
      fontSize: 11.5,
      font: "F2",
      color: palette.ink,
      align: "right",
    });
    if (hasAmountColumn) {
      drawText(page, {
        x: amountColumnX,
        top: currentTop + Math.max(11, rowHeight / 2 - 4),
        width: amountColumnWidth,
        text: item.amountLabel ?? "-",
        fontSize: 11.5,
        font: "F2",
        color: palette.ink,
        align: "right",
      });
    }

    currentTop += rowHeight;
  });

  if ((params.summaryRows ?? []).length > 0) {
    const summaryRows = params.summaryRows ?? [];
    const summaryWidth = 228;
    const summaryRowHeight = 20;
    const summaryHeight = summaryRows.length * summaryRowHeight + 20;

    if (currentTop + summaryHeight > PAGE_HEIGHT - PAGE_MARGIN_BOTTOM - 26) {
      currentTop = startNewPage();
    } else {
      currentTop += 14;
    }

    const summaryX = PAGE_WIDTH - PAGE_MARGIN_X - summaryWidth;
    drawRect(page, summaryX, currentTop, summaryWidth, summaryHeight, {
      fill: palette.white,
      stroke: palette.border,
      lineWidth: 0.8,
    });

    summaryRows.forEach((row, index) => {
      const rowTop = currentTop + 10 + index * summaryRowHeight;
      if (index > 0) {
        drawLine(
          page,
          summaryX + 12,
          rowTop - 4,
          summaryX + summaryWidth - 12,
          rowTop - 4,
          palette.border,
          0.6
        );
      }
      drawText(page, {
        x: summaryX + 14,
        top: rowTop,
        text: row.label,
        fontSize: row.emphasized ? 10.5 : 10,
        font: row.emphasized ? "F2" : "F1",
        color: palette.ink,
      });
      drawText(page, {
        x: summaryX + 100,
        top: rowTop,
        width: summaryWidth - 114,
        text: row.value,
        fontSize: row.emphasized ? 10.5 : 10,
        font: "F2",
        color: palette.ink,
        align: "right",
      });
    });
  }

  pages.forEach((pdfPage, index) => {
    if (params.watermarkText) {
      drawWatermark(pdfPage, {
        text: params.watermarkText.toUpperCase(),
      });
    }
    drawLine(
      pdfPage,
      PAGE_MARGIN_X,
      PAGE_HEIGHT - 54,
      PAGE_WIDTH - PAGE_MARGIN_X,
      PAGE_HEIGHT - 54,
      palette.border,
      0.8
    );
    drawText(pdfPage, {
      x: PAGE_MARGIN_X,
      top: PAGE_HEIGHT - 42,
      text: params.footerNote ?? "Documento generado automáticamente por BuildReq.",
      fontSize: 10,
      color: palette.muted,
    });
    drawText(pdfPage, {
      x: PAGE_WIDTH - PAGE_MARGIN_X - 90,
      top: PAGE_HEIGHT - 42,
      width: 90,
      text: `Página ${index + 1} / ${pages.length}`,
      fontSize: 10,
      color: palette.muted,
      align: "right",
    });
  });

  return buildPdfBase64FromPages(pages);
}

export function buildPurchaseOrderPrintPdfBase64(params: {
  orderNumber: string;
  orderId: string;
  projectLabel: string;
  supplierLabel: string;
  createdDateLabel: string;
  deliveryDateLabel: string;
  paymentMethodLabel?: string | null;
  currencyLabel: string;
  pricesIncludeTax?: boolean;
  requestedByLabel: string;
  preparedByLabel?: string | null;
  originalRequestLabel: string;
  salesAdvisorLabel: string;
  observations: string;
  quoteLabel: string;
  items: Array<{
    itemNumber: string;
    description: string;
    destinationLabel: string;
    partNumber: string;
    quantityLabel: string;
    unitPriceLabel: string;
    subtotalLabel: string;
  }>;
  summaryRows: Array<{
    label: string;
    value: string;
    emphasized?: boolean;
  }>;
}) {
  const pageWidth = 595;
  const pageHeight = 842;
  const marginX = 28;
  const contentWidth = pageWidth - marginX * 2;
  const ink = [0, 0, 0] as PdfRgb;
  const border = [0, 0, 0] as PdfRgb;
  const lightBorder = [0, 0, 0] as PdfRgb;
  const pages: PdfPage[] = [];
  let page = createPage({ width: pageWidth, height: pageHeight });
  pages.push(page);

  function drawCenteredText(
    x: number,
    top: number,
    width: number,
    text: string,
    fontSize: number,
    font: PdfFont = "F1"
  ) {
    drawText(page, {
      x,
      top,
      width,
      text,
      fontSize,
      font,
      color: ink,
      align: "center",
    });
  }

  function drawCenteredWrappedText(
    x: number,
    top: number,
    width: number,
    text: string,
    fontSize: number,
    font: PdfFont,
    leading: number,
    maxLines?: number
  ) {
    const lines = wrapText(text, width, fontSize, font, maxLines);
    lines.forEach((line, index) => {
      drawCenteredText(x, top + index * leading, width, line, fontSize, font);
    });
    return lines.length * leading;
  }

  function drawLabelValue(params: {
    x: number;
    top: number;
    labelWidth: number;
    valueWidth: number;
    label: string;
    value: string;
    maxLines?: number;
    fontSize?: number;
    leading?: number;
  }) {
    const fontSize = params.fontSize ?? 10.4;
    const leading = params.leading ?? 13.2;

    drawText(page, {
      x: params.x,
      top: params.top,
      text: params.label,
      fontSize,
      font: "F2",
      color: ink,
    });

    const valueLines = wrapText(
      params.value || "-",
      params.valueWidth,
      fontSize,
      "F2",
      params.maxLines ?? 2
    );

    valueLines.forEach((line, index) => {
      drawText(page, {
        x: params.x + params.labelWidth,
        top: params.top + index * leading,
        width: params.valueWidth,
        text: line,
        fontSize,
        font: "F2",
        color: ink,
      });
    });

    return Math.max(15, valueLines.length * leading);
  }

  function drawLogo(top: number) {
    drawImageContained(page, HEH_LOGO_IMAGE, {
      x: marginX,
      top,
      width: 82,
      height: 48,
    });
  }

  function drawFirstPageHeader() {
    const headerTop = 22;
    const titleX = marginX + 96;
    const titleWidth = contentWidth - 192;

    drawLogo(headerTop);
    drawCenteredText(
      titleX,
      headerTop + 2,
      titleWidth,
      "HIDALGO E HIDALGO HONDURAS SA DE CV",
      14.5,
      "F2"
    );
    drawCenteredText(
      titleX,
      headerTop + 20,
      titleWidth,
      "RTN: 08019013549808",
      11,
      "F2"
    );
    drawCenteredText(
      titleX,
      headerTop + 36,
      titleWidth,
      "ORDEN DE COMPRA",
      13.2,
      "F2"
    );
    drawCenteredWrappedText(
      titleX,
      headerTop + 52,
      titleWidth,
      params.projectLabel,
      11.2,
      "F2",
      12.8,
      2
    );

    drawLine(page, marginX, 91, marginX + contentWidth, 91, ink, 1.1);
    drawLine(page, marginX, 95, marginX + contentWidth, 95, ink, 1.1);

    let leftTop = 108;
    let middleTop = 108;
    let rightTop = 108;
    const middleX = marginX + 266;
    const rightX = marginX + 392;

    leftTop +=
      drawLabelValue({
        x: marginX,
        top: leftTop,
        labelWidth: 82,
        valueWidth: 178,
        label: "Fecha:",
        value: params.createdDateLabel,
      }) + 3;
    leftTop +=
      drawLabelValue({
        x: marginX,
        top: leftTop,
        labelWidth: 82,
        valueWidth: 178,
        label: "Proveedor:",
        value: params.supplierLabel,
        maxLines: 2,
      }) + 3;
    leftTop +=
      drawLabelValue({
        x: marginX,
        top: leftTop,
        labelWidth: 82,
        valueWidth: 178,
        label: "Asesor Vta:",
        value: params.salesAdvisorLabel || "-",
        maxLines: 2,
      }) + 3;
    leftTop +=
      drawLabelValue({
        x: marginX,
        top: leftTop,
        labelWidth: 82,
        valueWidth: 178,
        label: "Entrega:",
        value: params.deliveryDateLabel,
      }) + 3;
    middleTop +=
      drawLabelValue({
        x: middleX,
        top: middleTop,
        labelWidth: 58,
        valueWidth: 66,
        label: "Pedido:",
        value: params.orderId,
      }) + 3;
    middleTop +=
      drawLabelValue({
        x: middleX,
        top: middleTop,
        labelWidth: 58,
        valueWidth: 66,
        label: "F Pago:",
        value: params.paymentMethodLabel?.trim() || "-",
      }) + 3;
    middleTop +=
      drawLabelValue({
        x: middleX,
        top: middleTop,
        labelWidth: 58,
        valueWidth: 66,
        label: "Moneda:",
        value: params.currencyLabel,
      }) + 3;
    middleTop +=
      drawLabelValue({
        x: middleX,
        top: middleTop,
        labelWidth: 58,
        valueWidth: 66,
        label: "Precios:",
        value: params.pricesIncludeTax ? "INCLUYEN ISV" : "SIN ISV",
      }) + 3;
    middleTop +=
      drawLabelValue({
        x: middleX,
        top: middleTop,
        labelWidth: 58,
        valueWidth: 66,
        label: "O Compra:",
        value: params.orderNumber,
      }) + 3;
    rightTop +=
      drawLabelValue({
        x: rightX,
        top: rightTop,
        labelWidth: 78,
        valueWidth: 96,
        label: "Solicitado:",
        value: params.requestedByLabel,
        maxLines: 2,
      }) + 3;
    rightTop +=
      drawLabelValue({
        x: rightX,
        top: rightTop,
        labelWidth: 78,
        valueWidth: 96,
        label: "Requisición:",
        value: params.originalRequestLabel,
        maxLines: 2,
      }) + 3;
    rightTop +=
      drawLabelValue({
        x: rightX,
        top: rightTop,
        labelWidth: 78,
        valueWidth: 96,
        label: "Observaciones:",
        value: params.observations,
        maxLines: 2,
      }) + 3;
    rightTop +=
      drawLabelValue({
        x: rightX,
        top: rightTop,
        labelWidth: 78,
        valueWidth: 96,
        label: "Cotización:",
        value: params.quoteLabel,
      }) + 3;

    return Math.max(204, leftTop, middleTop, rightTop) + 10;
  }

  function drawContinuationHeader() {
    drawText(page, {
      x: marginX,
      top: 24,
      text: "ORDEN DE COMPRA",
      fontSize: 10,
      font: "F2",
      color: ink,
    });
    drawText(page, {
      x: marginX,
      top: 42,
      text: params.orderNumber,
      fontSize: 16,
      font: "F2",
      color: ink,
    });
    drawLine(page, marginX, 67, marginX + contentWidth, 67, ink, 1);
    return 84;
  }

  const tableColumns = [
    { key: "item", label: "Ítem", x: marginX, width: 34 },
    { key: "description", label: "Descripcion", x: marginX + 34, width: 154 },
    { key: "destination", label: "Destino", x: marginX + 188, width: 105 },
    { key: "part", label: "No. Parte", x: marginX + 293, width: 72 },
    { key: "quantity", label: "Cant.", x: marginX + 365, width: 54 },
    {
      key: "unitPrice",
      label: params.pricesIncludeTax ? "Valor U c/ISV" : "Valor U",
      x: marginX + 419,
      width: 60,
    },
    {
      key: "subtotal",
      label: params.pricesIncludeTax ? "Base" : "Valor T",
      x: marginX + 479,
      width: 60,
    },
  ];

  function drawTableHeader(top: number) {
    tableColumns.forEach(column => {
      drawCenteredText(column.x, top + 6, column.width, column.label, 10.5, "F2");
    });
    drawLine(
      page,
      marginX,
      top + 22,
      marginX + contentWidth,
      top + 22,
      border,
      1.1
    );
  }

  function startNewPage(withTableHeader: boolean) {
    page = createPage({ width: pageWidth, height: pageHeight });
    pages.push(page);
    const top = drawContinuationHeader();
    if (!withTableHeader) return top;
    drawTableHeader(top);
    return top + 24;
  }

  function drawWrappedCell(params: {
    x: number;
    top: number;
    width: number;
    text: string;
    fontSize: number;
    font?: PdfFont;
    align?: "left" | "center" | "right";
    leading?: number;
    maxLines?: number;
  }) {
    const lines = wrapText(
      params.text || "-",
      params.width,
      params.fontSize,
      params.font ?? "F1",
      params.maxLines
    );

    lines.forEach((line, index) => {
      drawText(page, {
        x: params.x,
        top: params.top + index * (params.leading ?? 12),
        width: params.width,
        text: line,
        fontSize: params.fontSize,
        font: params.font ?? "F1",
        color: ink,
        align: params.align,
      });
    });

    return lines;
  }

  function drawItemRow(item: (typeof params.items)[number], top: number) {
    const descriptionLines = wrapText(
      item.description || "-",
      tableColumns[1].width - 12,
      10.2,
      "F1",
      4
    );
    const destinationLines = wrapText(
      item.destinationLabel || "-",
      tableColumns[2].width - 12,
      10,
      "F1",
      4
    );
    const partLines = wrapText(
      item.partNumber || "-",
      tableColumns[3].width - 12,
      10,
      "F1",
      3
    );
    const rowHeight = Math.max(
      32,
      descriptionLines.length * 12.4 + 14,
      destinationLines.length * 12 + 14,
      partLines.length * 12 + 14
    );

    drawWrappedCell({
      x: tableColumns[0].x,
      top: top + 8,
      width: tableColumns[0].width,
      text: item.itemNumber,
      fontSize: 10.5,
      align: "center",
      maxLines: 1,
    });
    drawWrappedCell({
      x: tableColumns[1].x + 6,
      top: top + 7,
      width: tableColumns[1].width - 12,
      text: item.description,
      fontSize: 10.2,
      leading: 12.4,
      maxLines: 4,
    });
    drawWrappedCell({
      x: tableColumns[2].x + 6,
      top: top + 7,
      width: tableColumns[2].width - 12,
      text: item.destinationLabel,
      fontSize: 10,
      leading: 12,
      maxLines: 4,
    });
    drawWrappedCell({
      x: tableColumns[3].x + 6,
      top: top + 7,
      width: tableColumns[3].width - 12,
      text: item.partNumber,
      fontSize: 10,
      align: "center",
      leading: 12,
      maxLines: 3,
    });
    drawText(page, {
      x: tableColumns[4].x + 6,
      top: top + Math.max(8, rowHeight / 2 - 4),
      width: tableColumns[4].width - 12,
      text: item.quantityLabel,
      fontSize: 10.5,
      color: ink,
      align: "right",
    });
    drawText(page, {
      x: tableColumns[5].x + 6,
      top: top + Math.max(8, rowHeight / 2 - 4),
      width: tableColumns[5].width - 12,
      text: item.unitPriceLabel,
      fontSize: 10.5,
      color: ink,
      align: "right",
    });
    drawText(page, {
      x: tableColumns[6].x + 6,
      top: top + Math.max(8, rowHeight / 2 - 4),
      width: tableColumns[6].width - 12,
      text: item.subtotalLabel,
      fontSize: 10.5,
      color: ink,
      align: "right",
    });
    drawLine(
      page,
      marginX,
      top + rowHeight,
      marginX + contentWidth,
      top + rowHeight,
      lightBorder,
      0.8
    );

    return rowHeight;
  }

  function drawSummary(top: number) {
    const summaryWidth = 190;
    const summaryX = marginX + contentWidth - summaryWidth;
    const rowHeight = 15.2;
    const height = params.summaryRows.length * rowHeight;

    drawRect(page, summaryX, top, summaryWidth, height, {
      stroke: border,
      lineWidth: 0.8,
    });

    params.summaryRows.forEach((row, index) => {
      const rowTop = top + index * rowHeight;
      if (index > 0) {
        drawLine(
          page,
          summaryX,
          rowTop,
          summaryX + summaryWidth,
          rowTop,
          border,
          0.7
        );
      }
      drawText(page, {
        x: summaryX + 6,
        top: rowTop + 3.2,
        text: row.label,
        fontSize: row.emphasized ? 10.4 : 10,
        font: row.emphasized ? "F2" : "F1",
        color: ink,
      });
      drawText(page, {
        x: summaryX + 116,
        top: rowTop + 3.2,
        width: summaryWidth - 124,
        text: row.value,
        fontSize: row.emphasized ? 10.4 : 10,
        font: "F2",
        color: ink,
        align: "right",
      });
    });

    return { summaryX, summaryWidth, height };
  }

  function drawLowerSection(top: number) {
    const summary = drawSummary(top);
    const signaturesTop = top + summary.height + 34;
    const signatureWidth = 160;
    const firstSignatureX = marginX + 88;
    const secondSignatureX = firstSignatureX + 206;
    const preparedByLabel =
      params.preparedByLabel?.trim() || params.requestedByLabel || "-";

    drawCenteredWrappedText(
      firstSignatureX,
      signaturesTop - 25,
      signatureWidth,
      preparedByLabel,
      10,
      "F2",
      11.8,
      2
    );

    drawLine(
      page,
      firstSignatureX,
      signaturesTop,
      firstSignatureX + signatureWidth,
      signaturesTop,
      ink,
      1.4
    );
    drawLine(
      page,
      secondSignatureX,
      signaturesTop,
      secondSignatureX + signatureWidth,
      signaturesTop,
      ink,
      1.4
    );
    drawCenteredText(
      firstSignatureX,
      signaturesTop + 7,
      signatureWidth,
      "Elaborado por:",
      10.2,
      "F2"
    );
    drawCenteredText(
      secondSignatureX,
      signaturesTop + 7,
      signatureWidth,
      "Autorizado por:",
      10.2,
      "F2"
    );

    const noteTop = signaturesTop + 38;
    const noteX = marginX + 24;
    const noteWidth = contentWidth - 48;
    const noteHeight = 64;
    drawRect(page, noteX, noteTop, noteWidth, noteHeight, {
      stroke: ink,
      lineWidth: 1.2,
    });
    drawCenteredText(noteX, noteTop + 8, noteWidth, "Tomar Nota:", 10.5, "F2");
    drawCenteredWrappedText(
      noteX + 18,
      noteTop + 22,
      noteWidth - 36,
      "Emitir factura a nombre de: HIDALGO e HIDALGO HONDURAS SA DE CV; RTN: 08019013549808; Dirección: Blvd. Suyapa, Edificio Metropolis, Torre 2, Piso 20, Ofi. 22004. Presentar con la factura su constancia de estar sujetos al RÉGIMEN DE PAGOS A CUENTA vigente, caso contrario se procederá con las retenciones correspondientes.",
      10,
      "F1",
      11.4,
      4
    );
  }

  const tableTop = drawFirstPageHeader();
  drawTableHeader(tableTop);
  let currentTop = tableTop + 24;
  const printableBottom = pageHeight - 32;
  const rows =
    params.items.length > 0
      ? params.items
      : [
          {
            itemNumber: "-",
            description: "Sin ítems",
            destinationLabel: "-",
            partNumber: "-",
            quantityLabel: "-",
            unitPriceLabel: "-",
            subtotalLabel: "-",
          },
        ];

  rows.forEach(item => {
    const rowHeight = Math.max(
      32,
      wrapText(
        item.description || "-",
        tableColumns[1].width - 12,
        10.2,
        "F1",
        4
      ).length *
        12.4 +
        14,
      wrapText(
        item.destinationLabel || "-",
        tableColumns[2].width - 12,
        10,
        "F1",
        4
      ).length *
        12 +
        14,
      wrapText(item.partNumber || "-", tableColumns[3].width - 12, 10, "F1", 3)
        .length *
        12 +
        14
    );
    if (currentTop + rowHeight > printableBottom) {
      currentTop = startNewPage(true);
    }
    currentTop += drawItemRow(item, currentTop);
  });

  if (currentTop + 10 + 282 > printableBottom) {
    currentTop = startNewPage(false);
  } else {
    currentTop += 10;
  }
  drawLowerSection(currentTop);

  return buildPdfBase64FromPages(pages);
}

export function buildEmailPreview(params: {
  to: string | null | undefined;
  subject: string;
  lines: string[];
}) {
  return {
    to: params.to || "pendiente@proveedor.local",
    subject: params.subject,
    content: params.lines.join("\n"),
  };
}
