import type { ConcreteTarget } from "@/models/common";
import type { ExecutionContext } from "@/models/options";
import { translate, type UILocale } from "@/ui/i18n";

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

export function promptUseInstruction(targetLabel: string, context: ExecutionContext, locale: UILocale = "tr"): string {
  const t = (tr: string, en: string, zh: string) => translate(locale, tr, en, zh);
  const destination = context === "agent"
    ? t(`${targetLabel} agentinde ilgili projeyi aç.`, `Open the relevant project in your ${targetLabel} agent.`, `在 ${targetLabel} agent 中打开相关项目。`)
    : context === "mobile"
      ? t(`Telefonundaki ${targetLabel} uygulamasında yeni bir sohbet aç.`, `Start a new chat in ${targetLabel} on your phone.`, `在手机的 ${targetLabel} 中新建对话。`)
      : context === "browser"
        ? t(`${targetLabel} ile tarayıcıda yeni bir çalışma başlat.`, `Start a new task with ${targetLabel} in your browser.`, `在浏览器中使用 ${targetLabel} 开始新任务。`)
        : t(`${targetLabel} içinde yeni bir sohbet aç.`, `Start a new chat in ${targetLabel}.`, `在 ${targetLabel} 中新建对话。`);
  return `${destination} ${t("Kopyaladığın promptun tamamını tek mesaj olarak yapıştır. Görevin için gereken dosya veya bağlamı ekle, ardından gönder.", "Paste the entire copied prompt as one message. Add the files or context your task needs, then send it.", "将完整提示词作为一条消息粘贴，添加任务所需的文件或背景，再发送。")}`;
}

/** Adds an owner-visible directive without deleting their current request. */
export function appendComposerHint(text: string, hint: string, limit: number): string {
  const suffix = `${text && !text.endsWith("\n") ? "\n" : ""}${hint}`;
  return text.length + suffix.length <= limit ? text + suffix : text;
}
