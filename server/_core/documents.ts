const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const PAGE_MARGIN_X = 42;
const PAGE_MARGIN_BOTTOM = 52;

type PdfFont = "F1" | "F2";
type PdfRgb = [number, number, number];
type PdfPage = {
  commands: string[];
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

function createPage(): PdfPage {
  return { commands: [] };
}

function toPdfRectY(top: number, height: number) {
  return PAGE_HEIGHT - top - height;
}

function toPdfTextY(top: number, fontSize: number) {
  return PAGE_HEIGHT - top - fontSize;
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
  const y = toPdfRectY(top, height);
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
    `${formatNumber(x1)} ${formatNumber(PAGE_HEIGHT - top1)} m ${formatNumber(x2)} ${formatNumber(
      PAGE_HEIGHT - top2
    )} l S`
  );
  page.commands.push("Q");
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
    `1 0 0 1 ${formatNumber(x)} ${formatNumber(toPdfTextY(params.top, params.fontSize))} Tm`
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
  const centerX = PAGE_WIDTH / 2;
  const centerY = PAGE_HEIGHT / 2;
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
  const objects: string[] = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj",
    `2 0 obj\n<< /Type /Pages /Kids [${pages
      .map((_, index) => `${5 + index * 2} 0 R`)
      .join(" ")}] /Count ${pages.length} >>\nendobj`,
    "3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj",
  ];

  pages.forEach((page, index) => {
    const pageObjectId = 5 + index * 2;
    const contentObjectId = pageObjectId + 1;
    const stream = page.commands.join("\n");

    objects.push(
      `${pageObjectId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjectId} 0 R >>\nendobj`
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
    fontSize: 9,
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
    border: [0.86, 0.88, 0.91] as PdfRgb,
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

    const badgeWidth = Math.max(
      78,
      measureTextWidth(params.badgeText.toUpperCase(), 12, "F2") + 26
    );
    const badgeX = 36 + 540 - badgeWidth - 24;
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
      ? wrapText(detailText, descriptionWidth, 9.5, "F1", 4)
      : [];
    const rowHeight = Math.max(
      42,
      descriptionLines.length * 15 + detailLines.length * 12 + 18
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
        fontSize: 9.5,
        color: palette.muted,
        leading: 12,
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
      fontSize: 9,
      color: palette.muted,
    });
    drawText(pdfPage, {
      x: PAGE_WIDTH - PAGE_MARGIN_X - 90,
      top: PAGE_HEIGHT - 42,
      width: 90,
      text: `Página ${index + 1} / ${pages.length}`,
      fontSize: 9,
      color: palette.muted,
      align: "right",
    });
  });

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
