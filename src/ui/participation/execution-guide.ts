import type { ConcreteTarget } from "@/models/common";
import type { ExecutionContext } from "@/models/options";
import { translate, type UILocale } from "@/ui/i18n";

export const EXECUTION_DESTINATIONS = ["codex", "claude-code", "chatgpt", "claude", "gemini", "kimi"] as const;
export type ExecutionDestination = typeof EXECUTION_DESTINATIONS[number];
export type ExecutionKind = "model3d" | "code" | "research" | "data" | "image" | "video" | "writing" | "general";
export interface ExecutionGuideInput {
  goal?: string;
  rawRequest?: string;
  taskType?: string;
  target: ConcreteTarget;
  context: ExecutionContext;
  deliverables?: string[];
  successCriteria?: string[];
}
export interface GuideLink { label: string; href: string }
export interface ExecutionGuidePlan {
  kind: ExecutionKind;
  destination: ExecutionDestination;
  destinationLabel: string;
  title: string;
  reason: string;
  prepare: string;
  steps: string[];
  verify: string;
  limitation: string;
  links: GuideLink[];
}

export const DESTINATION_LABELS: Record<ExecutionDestination, string> = {
  codex: "Codex", "claude-code": "Claude Code", chatgpt: "ChatGPT", claude: "Claude", gemini: "Gemini", kimi: "Kimi",
};

/** Navigation only: user text, prompts and keys are never appended to these URLs. */
const DESTINATION_URLS: Record<ExecutionDestination, string> = {
  codex: "https://learn.chatgpt.com/docs/quickstart",
  "claude-code": "https://code.claude.com/docs/en/quickstart",
  chatgpt: "https://chatgpt.com/", claude: "https://claude.ai/", gemini: "https://gemini.google.com/", kimi: "https://www.kimi.com/",
};

function fold(text: string) {
  return text.normalize("NFKC").toLowerCase().replace(/ı/g, "i").replace(/İ/g, "i").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** This is a visible starter route, not an AI assessment or a promise of execution. */
export function executionKind(input: Pick<ExecutionGuideInput, "goal" | "rawRequest" | "taskType">): ExecutionKind {
  // A revised version's structured goal takes precedence over the original request.
  const text = fold(input.goal?.trim() || input.rawRequest || "");
  const task = input.taskType ?? "";
  const blender = /\b(blender|bpy)\b/.test(text);
  const geometryAsset = /\b(glb|gltf|low[- ]?poly)\b/.test(text);
  const softwareTask = ["coding", "debugging", "automation", "software_architecture", "ui_ux", "security_analysis", "agent_task"].includes(task);
  const softwareSurface = /\b(three[.-]?js|react|webgl|r3f|renderer|viewer|loader|parser|endpoint|yukleyici|goruntuleyici\w*)\b|渲染器|查看器|加载器|网页应用/.test(text);
  // Loading an existing model in software is different from authoring a Blender asset.
  if (softwareSurface && !/\bbpy\b/.test(text) && (softwareTask || /\b(three[.-]?js|react|webgl|viewer|loader)\b|查看器|加载器/.test(text))) return "code";
  const image = ["image_generation", "image_editing"].includes(task);
  const machineLearning = /\b(language model|data model|llm|machine learning|neural|regression|veri modeli|dil modeli|yapay zeka modeli)\b|语言模型|机器学习|数据模型/.test(text);
  const dimensional = /\b(3d|3-d|three[- ]dimensional)\b|三维|3维|建模/.test(text);
  const physicalModel = /\b(modelle\w*|model\w*)\b|模型/.test(text)
    && /\b(ucak\w*|airplane\w*|aircraft|karakter\w*|character\w*|robot|araba\w*|car|bina\w*|building|gemi\w*|ship)\b|飞机|角色|建筑|汽车/.test(text);
  if (blender || (!image && !machineLearning && (dimensional || physicalModel || geometryAsset))) return "model3d";
  if (image) return "image";
  if (task === "video_generation") return "video";
  if (softwareTask) return "code";
  if (task === "data_analysis") return "data";
  if (["research", "deep_research", "file_analysis"].includes(task)) return "research";
  if (["writing", "content_generation", "document_generation", "social_media", "marketing", "seo"].includes(task)) return "writing";
  if (/\b(kodla\w*|kod yaz|code|coding|debug|python|typescript|javascript|repository|repo|otomasyon|automation)\b|编程|写代码|代码|调试/.test(text)) return "code";
  if (/\b(csv|xlsx|dataset|veri analizi|data analysis|spreadsheet)\b|数据分析|表格/.test(text)) return "data";
  if (/\b(arastir\w*|research|kaynakli|sources)\b|研究|调研/.test(text)) return "research";
  return "general";
}

export function defaultExecutionDestination(target: ConcreteTarget, context: ExecutionContext): ExecutionDestination {
  if (target === "codex") return "codex";
  if (target === "claude") return context === "agent" ? "claude-code" : "claude";
  return target === "gemini" ? "gemini" : "chatgpt";
}

export function buildExecutionGuide(input: ExecutionGuideInput, locale: UILocale, override?: ExecutionDestination): ExecutionGuidePlan {
  const t = (tr: string, en: string, zh: string) => translate(locale, tr, en, zh);
  const kind = executionKind(input);
  const destination = override ?? defaultExecutionDestination(input.target, input.context);
  const destinationLabel = DESTINATION_LABELS[destination];
  const agent = destination === "codex" || destination === "claude-code";
  const remoteCodex = destination === "codex" && (input.context === "mobile" || input.context === "browser");
  const setup = destination === "claude-code"
    ? t("Resmî Claude Code başlangıç rehberinden işletim sistemine uygun kurulumu yap ve girişini tamamla. Proje klasöründe terminal açıp claude ile bir oturum başlat.", "Follow the official Claude Code quickstart for your operating system and sign in. Open a terminal in the project folder and start a session with claude.", "按照 Claude Code 官方入门指南安装并登录。在项目文件夹中打开终端，用 claude 启动会话。")
    : destination === "codex"
      ? remoteCodex
        ? t("Codex Cloud rehberini aç. Web veya masaüstünde proje deposuna bağlı bir ortam hazırla; telefonda yayımlanmış ortamı seçip görevi başlat.", "Open the Codex Cloud guide. Prepare an environment connected to your repository on web or desktop; on mobile, select a published environment and start a task.", "打开 Codex Cloud 指南。在网页或桌面端为代码仓库准备环境；在手机上选择已发布的环境并开始任务。")
        : t("Resmî başlangıç rehberini aç. Masaüstü uygulamasında giriş yap, Codex'i seç ve üzerinde çalışılacak klasörü aç; terminal tercih edersen Codex CLI rehberini izle.", "Open the official quickstart. Sign in to the desktop app, select Codex and open the working folder; for a terminal workflow, follow the Codex CLI guide.", "打开官方入门指南。登录桌面应用，选择 Codex 并打开工作文件夹；如果使用终端，请按 Codex CLI 指南操作。")
      : input.context === "mobile"
        ? t(`${destinationLabel}'ın resmî sitesini telefonda aç veya sağlayıcının kendi indirme bağlantısından uygulamasına geç. Yeni bir sohbet başlat.`, `Open the official ${destinationLabel} site on your phone, or use the provider's own link to its app. Start a new chat.`, `在手机上打开 ${destinationLabel} 官方网站，或使用服务商提供的应用下载链接。新建一个对话。`)
        : t(`${destinationLabel}'ın resmî sitesinde giriş yap ve yeni bir sohbet aç.`, `Sign in on the official ${destinationLabel} site and start a new chat.`, `登录 ${destinationLabel} 官方网站并新建对话。`);
  const paste = t("Tam promptu kopyala ve tamamını tek mesaj olarak yapıştır. Görevin dosyalarını, örneklerini ve eksik bağlamını ekle.", "Copy the full prompt and paste it as one message. Add the task files, examples and missing context.", "复制完整提示词并作为一条消息粘贴。添加任务文件、示例及所需背景信息。");
  const links: GuideLink[] = [{ label: agent ? t(`${destinationLabel} kurulum ve başlangıç`, `${destinationLabel} setup and quickstart`, `${destinationLabel} 安装与入门`) : t(`${destinationLabel}'ı aç`, `Open ${destinationLabel}`, `打开 ${destinationLabel}`), href: remoteCodex ? "https://learn.chatgpt.com/docs/cloud" : DESTINATION_URLS[destination] }];
  if (destination === "codex" && !remoteCodex) links.push({ label: "Codex CLI", href: "https://learn.chatgpt.com/docs/codex/cli" });

  const recipes: Record<ExecutionKind, Omit<ExecutionGuidePlan, "kind" | "destination" | "destinationLabel" | "links">> = {
    model3d: {
      title: t("Fikrinden açılabilir bir 3D dosyaya", "From your idea to an editable 3D file", "把创意变成可编辑的 3D 文件"),
      reason: t("Hedefinde 3D modelleme işareti var. Bu başlangıç rotası AI'dan üretim adımlarını alıp modeli Blender'da açmana yardımcı olur.", "Your goal includes a 3D modeling signal. This starter route helps you get creation steps from AI and open the model in Blender.", "目标中有 3D 建模线索。这条入门路线帮助你向 AI 获取制作步骤，再在 Blender 中打开模型。"),
      prepare: t("Ölçü veya ölçek, stil, referans görsel ve istenen dosya biçimini hazırla. Blender'ı resmî bağlantıdan işletim sistemine uygun indir; mevcut çalışmanın bir kopyasıyla başla.", "Prepare dimensions or scale, style, references and the required file format. Download Blender for your operating system from the official link; start with a copy of existing work.", "准备尺寸或比例、风格、参考图和所需文件格式。从官方链接下载对应系统的 Blender；已有项目请使用副本。"),
      steps: [setup, paste, agent
        ? t("Agentten Blender sürümüne uygun bir bpy betiği ve çalıştırma adımları iste. Blender erişimi varsa gerçek dosyayı üretip açarak doğrulasın; yoksa betiği sana teslim etsin.", "Ask the agent for a bpy script matching your Blender version and run instructions. If Blender is available, have it create and open the actual file to verify it; otherwise ask it to deliver the script.", "请 agent 提供适配 Blender 版本的 bpy 脚本及运行步骤。如可访问 Blender，让它生成并打开实际文件进行验证；否则交付脚本。")
        : t("Yanıtta bir bpy betiği varsa Blender'da Scripting → Text Editor → New yolunu aç, Python betiğini yapıştır ve Run Script'i kullan. Normal prompt metnini Python alanına yapıştırma; adım adım modelleme anlatımı geldiyse o adımları izle.", "If the response contains a bpy script, open Blender → Scripting → Text Editor → New, paste the Python script and use Run Script. Keep the ordinary prompt out of the Python editor; if the response is a modeling walkthrough, follow its steps.", "若回答提供 bpy 脚本，打开 Blender → Scripting → Text Editor → New，粘贴 Python 脚本并选择 Run Script。不要把普通提示词当 Python 代码；若得到建模教程，则按步骤操作。"),
        t("Sahneyi incele, .blend dosyasını kaydet ve gerekiyorsa istediğin dışa aktarma biçimini üret. Sorun varsa hata metni veya ekran görüntüsüyle düzeltme iste.", "Inspect the scene, save the .blend file and export the requested format if needed. Ask for a correction with the error text or a screenshot when something is wrong.", "检查场景，保存 .blend 文件，并按需要导出指定格式。如有问题，附上错误信息或截图请求修正。")],
      verify: t("Dosya yeniden açılıyor mu? Ölçek, parçalar ve referansa benzerlik doğru mu? İstenen format başka uygulamada açılıyor mu? Bir görsel önizleme ile modelin kendisini ayrı kontrol et.", "Does the saved file reopen? Are scale, parts and reference accuracy correct? Does the export open in another app? Check the preview and the editable model separately.", "保存的文件能重新打开吗？比例、部件和参考一致吗？导出的格式能在其他软件打开吗？分别检查预览图和可编辑模型。"),
      limitation: t("Telefonda promptu ve betiği hazırlayabilirsin; yerel Blender adımı masaüstü bilgisayar gerektirir. Bu rota görsel 3D model içindir; fiziksel bir uçağın mühendislik veya uçuş uygunluğunu doğrulamaz.", "You can prepare the prompt and script on a phone; the local Blender step needs a desktop computer. This route creates a visual 3D model and does not certify a physical aircraft's engineering or airworthiness.", "手机可以准备提示词和脚本；本地 Blender 步骤需要桌面电脑。这条路线用于视觉 3D 模型，不验证实体飞机的工程或适航性。"),
    },
    code: {
      title: t("İstediğin değişikliği çalışan projede gör", "See the change working in your project", "在项目中看到实际运行的改动"),
      reason: t("Bu görevde dosyaları okuyup değiştirmek ve sonucu çalıştırmak gerekebilir. Codex veya Claude Code gibi proje erişimli bir agent bunun için bir kullanım yolu sunar.", "This task may need file changes and a working run. A project-aware agent such as Codex or Claude Code offers a route for that work.", "任务可能需要读取和修改文件并实际运行。能够访问项目的 Codex 或 Claude Code 等 agent 可用于完成这些步骤。"),
      prepare: t("Proje klasörünü veya deposunu, hatayı yeniden üretme adımlarını ve beklediğin davranışı hazırla. Değişiklikleri geri alabileceğin bir kopya ya da Git kaydı oluştur.", "Prepare the project folder or repository, reproduction steps and expected behavior. Keep a copy or Git checkpoint so you can revert changes.", "准备项目文件夹或仓库、问题复现步骤和预期行为。保留副本或 Git 检查点以便恢复。"),
      steps: [setup, paste, agent
        ? t("Agentin önce ilgili dosyaları incelemesini, ardından değişikliği uygulayıp proje komutlarıyla çalıştırmasını iste. Projeyi açtığını ve gereken araçlara eriştiğini kontrol et.", "Ask the agent to inspect the relevant files, apply the change and run the project's commands. Check that it opened the project and can access the required tools.", "让 agent 先检查相关文件，再应用改动并执行项目命令。确认它已打开项目并能访问所需工具。")
        : t("Sohbette verilen kod kendi projende uygulanmış sayılmaz. Dosyaları kendin uygula veya kullanım yerini Codex / Claude Code olarak değiştirip projeyi orada aç.", "Code returned in chat has not yet been applied to your project. Apply the files yourself or switch the destination to Codex / Claude Code and open the project there.", "聊天中返回的代码尚未应用到你的项目。请自行应用文件，或改用 Codex / Claude Code 并在那里打开项目。"),
        t("İlgili testleri ve uygulamayı çalıştır. Değişen dosyaları incele; çalışan sonucu kabul ettikten sonra kaydet veya yayımla.", "Run the relevant tests and the app. Review changed files, then save or publish after accepting the working result.", "运行相关测试和应用，检查改动文件；确认实际结果后再保存或发布。")],
      verify: t("Beklediğin davranışı gerçek girdilerle dene. Test çıktısı ve çalışan ekran, kodun yalnızca yazılmış olmasından daha güçlü kanıttır.", "Try the expected behavior with real inputs. Test output and a working screen provide stronger evidence than code alone.", "用真实输入验证预期行为。测试输出和可运行界面比仅有代码更能证明结果。"),
      limitation: t("Agentin dosya ve komut erişimi seçtiğin ortamın izinlerine bağlıdır. Normal sohbet, projeyi açmadan bilgisayarındaki dosyaları değiştiremez.", "Agent file and command access depend on the selected environment's permissions. An ordinary chat cannot modify local files without access to the project.", "agent 的文件和命令访问取决于所选环境的权限。普通聊天无法在未访问项目的情况下修改本地文件。"),
    },
    research: {
      title: t("Yanıttan kontrol edilebilir bulgulara", "From an answer to checkable findings", "从回答到可核查的发现"),
      reason: t("Araştırma veya dosya inceleme görevi kaynak ve bağlam gerektirir; hedef soruna yanıt veren kanıtları birlikte kontrol edebilirsin.", "Research or file review needs sources and context; you can check the evidence against your question.", "研究或文件分析需要资料和背景，你可以对照问题检查证据。"),
      prepare: t("İncelenecek dosyaları, soruyu, tarih aralığını ve kullanılmasını istediğin kaynakları hazırla.", "Prepare the files, question, time range and preferred sources.", "准备待分析文件、问题、时间范围和希望使用的来源。"),
      steps: [setup, paste, t("Güncel web araştırması istiyorsan seçtiğin araçta web erişimi olduğundan emin ol; yoksa kaynakları sen ekle. Bulgularla yorumların ayrı verilmesini iste.", "For current web research, check that the selected tool has web access; otherwise provide the sources. Ask it to separate findings from interpretation.", "如需最新网络研究，请确认所选工具可访问网络；否则自行提供资料。要求区分发现和解释。")],
      verify: t("Kaynak bağlantılarını aç; tarihleri, alıntıların konumunu ve soruna gerçekten yanıt verip vermediklerini kontrol et.", "Open source links and check dates, cited locations and whether they actually support the answer.", "打开来源链接，检查日期、引用位置及其是否确实支持结论。"),
      limitation: t("Kaynak veya dosya erişimi olmayan bir AI'ın bunları okuduğunu varsayma. Eksik bilgiyi belirtmesini iste.", "Do not assume an AI read sources or files it cannot access. Ask it to identify missing information.", "不要假设 AI 阅读了无法访问的来源或文件。要求它指出缺失信息。"),
    },
    data: {
      title: t("Verini açıklanabilir bir sonuca dönüştür", "Turn your data into an explainable result", "把数据转化为可解释的结果"),
      reason: t("Veri analizi için asıl veri ve hesaplamaları çalıştıran araç gerekir. Prompt bunların nasıl ele alınacağını tarif eder.", "Data analysis needs the actual data and tools that run calculations. The prompt specifies how to use them.", "数据分析需要真实数据和计算工具，提示词说明如何使用它们。"),
      prepare: t("CSV / XLSX dosyanı, sütunların anlamını ve ölçmek istediğin şeyi hazırla; paylaşmak istemediğin bilgileri önce çıkar.", "Prepare the CSV / XLSX file, column meanings and the metric or question; remove information you do not want to share.", "准备 CSV / XLSX 文件、列的含义以及所需指标或问题；先去除不想共享的信息。"),
      steps: [setup, paste, t("Dosyayı ekle. Hesaplama araçları varsa analizi çalıştırıp tablo/grafik dosyalarını üretmesini iste; yoksa çalıştırılabilir betik ve yerel çalıştırma adımları al.", "Attach the file. If calculation tools are available, ask it to run the analysis and create table/chart files; otherwise request a runnable script and local run instructions.", "附上文件。如有计算工具，请它执行分析并生成表格或图表文件；否则获取可运行脚本和本地运行步骤。")],
      verify: t("Satır sayısı, eksik değerler ve birkaç örnek hesaplamayı karşılaştır. İndirilen dosyayı aç ve grafikteki birimleri kontrol et.", "Compare row counts, missing values and a few sample calculations. Open the downloaded file and check chart units.", "核对行数、缺失值及若干示例计算。打开下载文件，检查图表单位。"),
      limitation: t("AI'a yüklenmeyen veri analiz edilmiş sayılmaz; sonuçtaki sayıların hangi hesaplamadan geldiği görünür olmalı.", "Data that was not provided has not been analyzed; each reported number should have a visible calculation method.", "未提供给 AI 的数据不能算作已分析；每个报告的数字应有可查的计算方法。"),
    },
    image: {
      title: t("Görsel tarifini gerçek görsele taşı", "Turn the visual brief into an actual image", "把视觉描述变成实际图像"),
      reason: t("Bu görev görsel üretme veya düzenleme özelliği gerektiriyor. Sohbet modelinin yanında doğru görsel aracını açman gerekir.", "This task needs image generation or editing. Enable the appropriate image tool alongside the chat model.", "任务需要图像生成或编辑能力。应在聊天模型之外启用合适的图像工具。"),
      prepare: t("Boyut, kullanım yeri, stil ve korunacak ayrıntıları hazırla. Düzenleme için kaynak görseli ekle.", "Prepare dimensions, intended use, style and details to preserve. For editing, attach the source image.", "准备尺寸、用途、风格和需保留的细节。编辑任务请附上原图。"),
      steps: [setup, paste, t("Seçtiğin AI'da görsel üretim / düzenleme aracı varsa kullan. Yalnızca metin yanıtı geldiyse çıkan görsel tarifini bu özelliği olan bir araca taşı.", "Use image generation / editing if the selected AI provides it. If you receive text only, take its visual brief to a tool with that capability.", "如果所选 AI 支持图像生成或编辑，请使用该功能。如只收到文字，请把视觉描述交给有该能力的工具。")],
      verify: t("Üretilen dosyayı indirip gerçek boyut, metin doğruluğu, korunacak ayrıntılar ve kullanım alanına uygunluk açısından incele.", "Download the generated file and inspect dimensions, text accuracy, preserved details and suitability for its intended use.", "下载实际图像文件，检查尺寸、文字准确性、保留细节及用途适配性。"),
      limitation: t("Bir model adı tek başına görsel üretme yeteneğini göstermez. Seçtiğin hesapta bu aracın açık olması gerekir.", "A model name alone does not establish image capability. The tool needs to be available in your selected account.", "仅凭模型名称不能确定图像能力；所选账号需要提供相应工具。"),
    },
    video: {
      title: t("Sahne fikrinden izlenebilir videoya", "From a scene idea to a playable video", "从场景创意到可播放视频"),
      reason: t("Video görevi gerçek üretim veya kurgu aracına ihtiyaç duyar; sahne planı bu araçta uygulanacak çalışma tarifidir.", "Video tasks need actual generation or editing tools; a scene plan is the brief to execute in that tool.", "视频任务需要实际生成或剪辑工具；场景方案是在工具中执行的制作说明。"),
      prepare: t("Süre, en-boy oranı, sahne referansları ve varsa kaynak videoları hazırla.", "Prepare duration, aspect ratio, scene references and any source videos.", "准备时长、画面比例、场景参考及已有视频素材。"),
      steps: [setup, paste, t("Seçtiğin araçta video üretimi varsa sahneleri orada üret; yoksa sahne planını kullandığın video / kurgu aracına aktar. Önce kısa bir deneme çekimini incele, ardından kalan sahneleri üret.", "If the tool supports video, generate the scenes there; otherwise take the plan to your video or editing tool. Review a short trial shot before creating the remaining scenes.", "如所选工具支持视频，可在那里生成场景；否则将方案交给视频或剪辑工具。先检查简短试拍，再制作其余场景。")],
      verify: t("Gerçek videoyu oynat; süre, sahne devamlılığı, ses uyumu ve istediğin dışa aktarma biçimini kontrol et.", "Play the actual video and check duration, scene continuity, audio alignment and the required export format.", "播放实际视频，核对时长、场景连续性、音画同步和导出格式。"),
      limitation: t("Metin veya storyboard tamamlanmış video değildir. Üretim erişimi ve limitleri seçtiğin hizmete bağlıdır.", "Text or a storyboard is not a finished video. Generation access and limits depend on the selected service.", "文字或分镜不等于成片；生成权限和限制取决于所选服务。"),
    },
    writing: {
      title: t("Taslağı kullanacağın işe uyarla", "Shape the draft for its real use", "让草稿适用于实际用途"),
      reason: t("Bu görevde metnin hedef kitleye ve istenen biçime uyması belirleyici. Referansların yanıtı kendi işine yaklaştırır.", "Audience and format are central to this task. Your references make the response more specific to your work.", "受众和格式是该任务的关键；参考材料能让回答更贴合你的实际需要。"),
      prepare: t("Hedef kitleyi, tonunu, uzunluğu, örnek metinleri ve kullanılacak bilgileri hazırla.", "Prepare audience, tone, length, sample texts and facts to include.", "准备受众、语气、长度、示例文本和必须使用的信息。"),
      steps: [setup, paste, t("Önce bir taslak al; somut olarak iyi ve eksik bulduğun yerleri belirt. Dosya gerekiyorsa araç desteğine göre istediğin formatta dışa aktarmasını veya biçimlendirme adımlarını iste.", "Get a first draft, then point out specific strengths and gaps. For a file, request the format if tools support it, or ask for formatting steps.", "先获得初稿，再指出具体优点和不足。如需文件，请在工具支持时要求指定格式，或获取格式化步骤。")],
      verify: t("Bilgileri, hedef kitleye uygunluğu, uzunluğu ve istenen biçimi kontrol et. Bir dosya üretildiyse açıp düzenini incele.", "Check facts, audience fit, length and required format. If a file was created, open it and inspect the layout.", "核对事实、受众适配、长度和格式。如已生成文件，请打开检查排版。"),
      limitation: t("Dışa aktarılabilir dosya üretimi, kullandığın AI'ın araçlarına bağlıdır; düz metni dosya teslimi olarak değerlendirme.", "Exportable file creation depends on the AI's tools; plain text alone is not a delivered file.", "可导出文件的生成取决于 AI 工具；纯文本本身不等于文件交付。"),
    },
    general: {
      title: t("İlk gerçek adımı birlikte netleştir", "Make the first real step clear", "明确第一个实际步骤"),
      reason: t("Bu hedef için belirli bir üretim aracı seçmek henüz güvenilir değil. Önce beklediğin çıktıyı netleştir; kullanım rotasını değiştirebilirsin.", "There is not enough evidence to select a specific creation tool yet. Clarify the expected output first; you can change the destination.", "目前还不足以可靠地选择特定制作工具。先明确预期产物；你也可以更换使用平台。"),
      prepare: t("Ne elde etmek istediğini, elindeki dosyaları ve başarıyı nasıl anlayacağını hazırla.", "Prepare the desired result, available files and how you will judge success.", "准备期望结果、已有文件及判断成功的方法。"),
      steps: [setup, paste, t("Yanıtta ilk uygulanabilir adımı ve gereken araçları iste. Görsel model, yazılım, fiziksel ürün veya yalnızca bir açıklama mı istediğini netleştir; gerekiyorsa burada geri bildirimle promptu uyarlat.", "Ask for the first actionable step and required tools. Clarify whether you need a visual model, software, a physical product or an explanation; refine the prompt here with feedback if needed.", "要求提供第一个可执行步骤及所需工具。明确需要的是视觉模型、软件、实体产品还是解释；必要时在此反馈以调整提示词。")],
      verify: t("Yanıtın tarif etmekle kalmayıp istediğin çıktıya götüren adımlar içerip içermediğini kontrol et. Eksik dosya veya erişim varsa bunu tamamla.", "Check whether the answer provides steps toward your desired output. Supply any missing files or access.", "检查回答是否包含实现预期产物的实际步骤；补齐缺少的文件或访问条件。"),
      limitation: t("Burada hazırlanan prompt görevin tarifidir. Çıktıyı üretmek için seçtiğin araçta onu çalıştırıp sonucu kontrol etmen gerekir.", "The prompt prepared here is the task brief. Run it in your selected tool and check the result to create the output.", "这里生成的提示词是任务说明。你需要在所选工具中执行并检查结果，才能获得实际产物。"),
    },
  };
  if (kind === "model3d") {
    links.push({ label: t("Blender'ı resmî siteden indir", "Download Blender from its official site", "从官方网站下载 Blender"), href: "https://www.blender.org/download/" });
    links.push({ label: t("Blender betik rehberi", "Blender scripting guide", "Blender 脚本指南"), href: "https://docs.blender.org/api/current/info_quickstart.html" });
  }
  const recipe = recipes[kind];
  const limitation = destination === "claude-code" && input.context === "mobile"
    ? `${recipe.limitation} ${t("Claude Code'un bu yerel terminal rotası masaüstü bilgisayar gerektirir.", "This local terminal route for Claude Code requires a desktop computer.", "Claude Code 的这条本地终端路线需要桌面电脑。")}`
    : recipe.limitation;
  return { kind, destination, destinationLabel, ...recipe, limitation, links };
}
