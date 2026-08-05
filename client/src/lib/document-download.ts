export function downloadBase64Document(params: {
  base64: string | null | undefined;
  fileName: string | null | undefined;
  mimeType?: string | null;
}) {
  if (!params.base64) return false;

  const binary = window.atob(params.base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  const blob = new Blob([bytes], {
    type: params.mimeType || "application/octet-stream",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = params.fileName || "documento";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return true;
}

export function openBase64Pdf(params: {
  base64: string | null | undefined;
  fileName?: string | null;
}) {
  if (!params.base64) return false;

  const popup = window.open("", "_blank");
  if (!popup) return false;

  const binary = window.atob(params.base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const url = URL.createObjectURL(
    new Blob([bytes], { type: "application/pdf" })
  );
  const requestedFileName = params.fileName?.trim() || "orden-de-compra.pdf";
  const safeFileName = (
    requestedFileName.toLowerCase().endsWith(".pdf")
      ? requestedFileName
      : `${requestedFileName}.pdf`
  ).replace(/[\\/:*?"<>|]/g, "-");
  const popupDocument = popup.document;
  popupDocument.title = safeFileName;
  popupDocument.body.replaceChildren();
  Object.assign(popupDocument.body.style, {
    background: "#202124",
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    margin: "0",
    overflow: "hidden",
  });

  const toolbar = popupDocument.createElement("div");
  Object.assign(toolbar.style, {
    alignItems: "center",
    background: "#2d2f31",
    color: "#fff",
    display: "flex",
    fontFamily: "Arial, sans-serif",
    gap: "16px",
    justifyContent: "space-between",
    padding: "10px 16px",
  });

  const title = popupDocument.createElement("span");
  title.textContent = safeFileName;
  title.style.fontSize = "14px";
  title.style.overflow = "hidden";
  title.style.textOverflow = "ellipsis";
  title.style.whiteSpace = "nowrap";

  const download = popupDocument.createElement("a");
  download.href = url;
  download.download = safeFileName;
  download.textContent = "Descargar PDF";
  Object.assign(download.style, {
    background: "#dc2626",
    borderRadius: "4px",
    color: "#fff",
    flexShrink: "0",
    fontSize: "14px",
    fontWeight: "600",
    padding: "8px 14px",
    textDecoration: "none",
  });

  const viewer = popupDocument.createElement("iframe");
  viewer.src = `${url}#toolbar=0&navpanes=0`;
  viewer.title = safeFileName;
  viewer.style.border = "0";
  viewer.style.flex = "1";
  viewer.style.width = "100%";

  toolbar.append(title, download);
  popupDocument.body.append(toolbar, viewer);
  window.setTimeout(() => URL.revokeObjectURL(url), 60 * 60 * 1000);
  return true;
}
