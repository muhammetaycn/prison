import type { ConcreteTarget } from "@/models/common";
import type { ExecutionContext } from "@/models/options";

/** The exported content is the chosen version, without additional instructions or metadata. */
export function promptExport(text: string, version: number, target: ConcreteTarget) {
  return {
    text,
    filename: `prison-v${Number.isSafeInteger(version) && version > 0 ? version : 1}-${target}.txt`,
    type: "text/plain;charset=utf-8",
  };
}

export async function copyPrompt(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    let area: HTMLTextAreaElement | undefined;
    try {
      area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      area?.remove();
    }
  }
}

export function downloadPrompt(text: string, version: number, target: ConcreteTarget): boolean {
  let url: string | undefined;
  let link: HTMLAnchorElement | undefined;
  try {
    const file = promptExport(text, version, target);
    url = URL.createObjectURL(new Blob([file.text], { type: file.type }));
    link = document.createElement("a");
    link.href = url;
    link.download = file.filename;
    document.body.appendChild(link);
    link.click();
    // Give the browser time to accept the download before releasing the blob.
    const acceptedUrl = url;
    window.setTimeout(() => URL.revokeObjectURL(acceptedUrl), 1000);
    url = undefined;
    return true;
  } catch {
    return false;
  } finally {
    link?.remove();
    if (url) URL.revokeObjectURL(url);
  }
}

export function promptUseInstruction(targetLabel: string, context: ExecutionContext): string {
  const destination = context === "agent"
    ? `${targetLabel} agentinde ilgili projeyi aç.`
    : context === "mobile"
      ? `Telefonundaki ${targetLabel} uygulamasında yeni bir sohbet aç.`
      : context === "browser"
        ? `${targetLabel} ile tarayıcıda yeni bir çalışma başlat.`
        : `${targetLabel} içinde yeni bir sohbet aç.`;
  return `${destination} Kopyaladığın promptun tamamını tek mesaj olarak yapıştır. Görevin için gereken dosya veya bağlamı ekle, ardından gönder.`;
}

/** Adds an owner-visible directive without deleting their current request. */
export function appendComposerHint(text: string, hint: string, limit: number): string {
  const suffix = `${text && !text.endsWith("\n") ? "\n" : ""}${hint}`;
  return text.length + suffix.length <= limit ? text + suffix : text;
}
