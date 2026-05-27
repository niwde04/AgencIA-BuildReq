export const PRINT_LOGO_SRC = "/logo_heh.png";

export function getPrintLogoMarkup(className = "logo") {
  return `<img class="${className}" src="${PRINT_LOGO_SRC}" alt="Hidalgo e Hidalgo Constructores" />`;
}

export function printWindowWhenReady(printWindow: Window) {
  const images = Array.from(printWindow.document.images);
  let printed = false;

  const finish = () => {
    if (printed) return;
    printed = true;
    printWindow.focus();
    printWindow.print();
  };

  const pendingImages = images.filter(image => !image.complete);
  if (pendingImages.length === 0) {
    finish();
    return;
  }

  let remaining = pendingImages.length;
  const timeoutId = window.setTimeout(finish, 1500);

  const markLoaded = () => {
    remaining -= 1;
    if (remaining <= 0) {
      window.clearTimeout(timeoutId);
      finish();
    }
  };

  pendingImages.forEach(image => {
    image.addEventListener("load", markLoaded, { once: true });
    image.addEventListener("error", markLoaded, { once: true });
  });
}
