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
