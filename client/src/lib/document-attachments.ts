const PDF_MAX_BYTES = 10 * 1000 * 1000;
const IMAGE_TARGET_BYTES = 3 * 1024 * 1024;
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 2000;

export type PreparedDocumentAttachment = {
  fileName: string;
  fileData: string;
  mimeType: string;
  fileSize: number;
};

const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function getExtension(fileName: string) {
  return fileName.trim().toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
}

function getBaseName(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "").trim() || "adjunto";
}

function isPdfFile(file: File) {
  return file.type === "application/pdf" || getExtension(file.name) === "pdf";
}

function isSupportedImageFile(file: File) {
  const extension = getExtension(file.name);
  return (
    IMAGE_MIME_TYPES.has(file.type) ||
    ["jpg", "jpeg", "png", "webp"].includes(extension)
  );
}

function readBlobAsBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result ?? "");
      resolve(value.includes(",") ? value.split(",")[1] ?? "" : value);
    };
    reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
    reader.readAsDataURL(blob);
  });
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("No se pudo procesar la imagen"));
    };
    image.src = url;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number
) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      blob => {
        if (!blob) {
          reject(new Error("No se pudo comprimir la imagen"));
          return;
        }
        resolve(blob);
      },
      mimeType,
      quality
    );
  });
}

function getScaledSize(width: number, height: number) {
  const longestSide = Math.max(width, height);
  if (longestSide <= MAX_IMAGE_DIMENSION) {
    return { width, height };
  }
  const ratio = MAX_IMAGE_DIMENSION / longestSide;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

function canUseWebp(canvas: HTMLCanvasElement) {
  return canvas.toDataURL("image/webp").startsWith("data:image/webp");
}

async function compressImage(file: File): Promise<PreparedDocumentAttachment> {
  const image = await loadImage(file);
  const { width, height } = getScaledSize(image.naturalWidth, image.naturalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("No se pudo procesar la imagen");
  }

  const preferredMimeType = canUseWebp(canvas) ? "image/webp" : "image/jpeg";
  if (preferredMimeType === "image/jpeg") {
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
  }
  context.drawImage(image, 0, 0, width, height);

  let bestBlob: Blob | null = null;
  for (const quality of [0.82, 0.72, 0.62, 0.52, 0.42]) {
    const blob = await canvasToBlob(canvas, preferredMimeType, quality);
    bestBlob = blob;
    if (blob.size <= IMAGE_TARGET_BYTES) break;
  }

  if (!bestBlob || bestBlob.size > IMAGE_MAX_BYTES) {
    throw new Error("La imagen comprimida no puede superar 5 MB");
  }

  const extension = preferredMimeType === "image/webp" ? "webp" : "jpg";
  return {
    fileName: `${getBaseName(file.name)}.${extension}`,
    fileData: await readBlobAsBase64(bestBlob),
    mimeType: preferredMimeType,
    fileSize: bestBlob.size,
  };
}

async function preparePdf(file: File): Promise<PreparedDocumentAttachment> {
  if (file.size > PDF_MAX_BYTES) {
    throw new Error("El PDF no puede superar 10 MB");
  }
  return {
    fileName: file.name,
    fileData: await readBlobAsBase64(file),
    mimeType: "application/pdf",
    fileSize: file.size,
  };
}

export async function prepareDocumentAttachment(
  file: File
): Promise<PreparedDocumentAttachment> {
  if (isPdfFile(file)) {
    return preparePdf(file);
  }
  if (isSupportedImageFile(file)) {
    return compressImage(file);
  }
  throw new Error("Solo se permiten archivos PDF o imagenes JPG, PNG y WebP");
}

export function formatAttachmentSize(size?: number | null) {
  if (!size || size <= 0) return "Archivo adjunto";
  if (size >= 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}
