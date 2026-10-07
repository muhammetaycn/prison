import type { TaskTypeProfile } from "@/core/task-types/types";

/**
 * Built-in task type profiles. To add a task type, append a profile here (or call
 * registerTaskType at runtime) — the intent schema, catalog and compiler pick it up automatically.
 *
 * localSignals are folded (lowercase, Turkish letters → ASCII) word-start stems used only
 * by the local fallback analyzer when no AI provider is configured.
 */
export const BUILTIN_TASK_TYPES: TaskTypeProfile[] = [
  {
    id: "coding",
    family: "engineering",
    label: { en: "Coding", tr: "Kodlama", zh: "编程" },
    description: "Implement, extend or change software: features, integrations, endpoints, components.",
    role: {
      en: "a senior software engineer who ships focused, production-quality changes",
      tr: "odaklı ve production kalitesinde değişiklikler yapan kıdemli bir yazılım mühendisi",
      zh: "一位交付聚焦、达到生产质量改动的资深软件工程师",
    },
    autoTarget: "codex",
    localSignals: [
      "kod", "code", "ozellik", "feature", ["ekle", 1], "implement", ["entegr", 2], "integrat", ["api", 2],
      "endpoint", "fonksiyon", "function", "component", "bilesen", "backend", "frontend", "veritaban",
      "database", ["odeme sistem", 2], "payment", "checkout", "login", "react", "next.js", "nextjs",
      "typescript", "python", ["repo", 2], "uygulama", "site", "web", "sayfa",
    ],
  },
  {
    id: "software_architecture",
    advisoryAware: true,
    family: "engineering",
    label: { en: "Software architecture", tr: "Yazılım mimarisi", zh: "软件架构" },
    description: "Design or restructure the architecture of a system: modules, boundaries, data flow, scalability.",
    role: {
      en: "a software architect who balances simplicity, maintainability and scale",
      tr: "sadelik, sürdürülebilirlik ve ölçek arasında denge kuran bir yazılım mimarı",
      zh: "一位在简洁、可维护和规模之间取得平衡的软件架构师",
    },
    autoTarget: "claude",
    blocks: ["VALIDATION_PROTOCOL"],
    outputContract: [
      {
        text: {
          en: "The proposed architecture with components, responsibilities and data flow",
          tr: "Bileşenler, sorumluluklar ve veri akışıyla önerilen mimari",
          zh: "提出的架构，包括组件、职责和数据流",
        },
      },
      {
        text: {
          en: "Key decisions with the alternatives considered and trade-offs",
          tr: "Değerlendirilen alternatifler ve ödünleşimlerle temel kararlar",
          zh: "关键决策，以及考虑过的备选方案和取舍",
        },
      },
      { text: { en: "A migration or implementation path", tr: "Geçiş veya uygulama yolu", zh: "迁移或实施路径" } },
    ],
    localSignals: [["mimari", 3], ["architect", 3], "olcekl", "scalab", "microservice", "mikroservis", "system design", "modul yapi"],
  },
  {
    id: "debugging",
    family: "engineering",
    label: { en: "Debugging", tr: "Hata ayıklama", zh: "调试" },
    description: "Find and fix the root cause of a bug, crash, error or unexpected behavior.",
    role: {
      en: "a senior engineer who finds root causes instead of patching symptoms",
      tr: "semptomu yamamak yerine kök nedeni bulan kıdemli bir mühendis",
      zh: "一位找出根本原因而不是修补表面症状的资深工程师",
    },
    autoTarget: "codex",
    defaultActions: [
      { text: { en: "Reproduce the problem reliably", tr: "Problemi güvenilir şekilde yeniden üret", zh: "稳定地复现问题" } },
      { text: { en: "Identify the root cause with evidence", tr: "Kök nedeni kanıtla tespit et", zh: "用证据确定根本原因" } },
      { text: { en: "Apply the smallest fix that addresses the root cause", tr: "Kök nedeni çözen en küçük düzeltmeyi uygula", zh: "应用能解决根本原因的最小修复" } },
      { text: { en: "Add a regression test and verify the fix", tr: "Regresyon testi ekle ve düzeltmeyi doğrula", zh: "添加回归测试并验证修复" } },
    ],
    successCriteria: [
      { text: { en: "The original problem no longer reproduces", tr: "Orijinal problem artık tekrarlanmıyor", zh: "原始问题不再出现" } },
      { text: { en: "A test covers the failure and passes", tr: "Hatayı kapsayan bir test var ve geçiyor", zh: "有测试覆盖该故障并且通过" } },
      { text: { en: "No new failures were introduced", tr: "Yeni bir hata eklenmedi", zh: "没有引入新的故障" } },
    ],
    localSignals: [["hata", 2], "bug", ["duzelt", 2], "fix", ["calismiyor", 3], "crash", "error", "sorun", "debug", "patliyor", "bozuk", "broken"],
  },
  {
    id: "security_analysis",
    advisoryAware: true,
    family: "engineering",
    label: { en: "Security analysis", tr: "Güvenlik analizi", zh: "安全分析" },
    description: "Defensive security review: vulnerabilities, hardening, configuration audit, threat assessment.",
    role: {
      en: "a defensive security engineer performing an authorized review",
      tr: "yetkili bir inceleme yapan savunma odaklı bir güvenlik mühendisi",
      zh: "一位执行授权审查的防御型安全工程师",
    },
    autoTarget: "claude",
    blocks: ["VALIDATION_PROTOCOL"],
    protocols: {
      EXECUTION_PROTOCOL: [
        {
          text: {
            en: "Confirm the scope: only the systems named in the objective are in scope.",
            tr: "Kapsamı teyit et: yalnızca amaçta belirtilen sistemler kapsam içinde.",
            zh: "确认范围：只有目标中指明的系统在范围之内。",
          },
        },
        {
          text: {
            en: "Start with read-only inspection; collect evidence for every finding.",
            tr: "Salt okunur incelemeyle başla; her bulgu için kanıt topla.",
            zh: "从只读检查开始；为每一项发现收集证据。",
          },
        },
        {
          text: {
            en: "Rate each finding by severity and likelihood.",
            tr: "Her bulguyu önem ve olasılığa göre derecelendir.",
            zh: "按严重程度和可能性为每一项发现评级。",
          },
        },
        {
          text: {
            en: "Recommend concrete, prioritized remediations.",
            tr: "Somut ve önceliklendirilmiş iyileştirmeler öner.",
            zh: "提出具体的、按优先级排序的修复建议。",
          },
        },
      ],
    },
    disallowed: [
      {
        text: {
          en: "Take destructive or disruptive actions (deleting data, disabling protections, load testing)",
          tr: "Yıkıcı veya kesinti yaratan işlemler yapmak (veri silmek, korumaları kapatmak, yük testi)",
          zh: "采取破坏性或扰乱性的操作（删除数据、关闭防护、压力测试）",
        },
      },
      {
        text: {
          en: "Test systems outside the stated scope",
          tr: "Belirtilen kapsam dışındaki sistemleri test etmek",
          zh: "测试所述范围之外的系统",
        },
      },
    ],
    outputContract: [
      {
        text: {
          en: "Findings with severity, evidence and affected component",
          tr: "Önem derecesi, kanıt ve etkilenen bileşenle bulgular",
          zh: "发现项，包括严重程度、证据和受影响的组件",
        },
      },
      { text: { en: "Prioritized remediation steps", tr: "Önceliklendirilmiş iyileştirme adımları", zh: "按优先级排序的修复步骤" } },
      { text: { en: "Residual risks and limitations of the review", tr: "Kalan riskler ve incelemenin sınırları", zh: "审查的剩余风险和局限" } },
    ],
    successCriteria: [
      {
        text: {
          en: "Every finding is backed by evidence and has a concrete remediation",
          tr: "Her bulgu kanıta dayanıyor ve somut bir iyileştirmesi var",
          zh: "每一项发现都有证据支持，并附有具体的修复方案",
        },
      },
    ],
    localSignals: [["guvenlik", 3], ["security", 3], "zafiyet", "vulnerab", "pentest", "saldiri", "malware", "virus", "defender", "firewall", "guvenlik duvari", "audit", "hardening"],
  },
  {
    id: "research",
    family: "analysis",
    label: { en: "Research", tr: "Araştırma", zh: "研究" },
    description: "Investigate a topic and answer specific questions with sources.",
    role: {
      en: "a careful researcher who separates evidence from opinion",
      tr: "kanıtı görüşten ayıran titiz bir araştırmacı",
      zh: "一位把证据与观点区分开来的严谨研究者",
    },
    autoTarget: "claude",
    localSignals: [["arastir", 3], ["research", 3], "kaynak", "source", "karsilastir", "compare", "nedir", "what is"],
  },
  {
    id: "deep_research",
    family: "analysis",
    label: { en: "Deep research", tr: "Derin araştırma", zh: "深度研究" },
    description: "Comprehensive multi-source investigation producing a long-form, cited report.",
    role: {
      en: "a senior research analyst producing a comprehensive, well-cited report",
      tr: "kapsamlı ve iyi kaynaklandırılmış rapor hazırlayan kıdemli bir araştırma analisti",
      zh: "一位撰写全面、引用充分报告的资深研究分析师",
    },
    autoTarget: "gpt",
    blocks: ["EXECUTION_PROTOCOL"],
    localSignals: [["derin arastirma", 5], ["deep research", 5], "kapsamli", "comprehensive", "literatur", "literature"],
  },
  {
    id: "data_analysis",
    family: "analysis",
    label: { en: "Data analysis", tr: "Veri analizi", zh: "数据分析" },
    description: "Analyze datasets: statistics, trends, metrics, visualizations, insights.",
    role: {
      en: "a data analyst who turns data into defensible insights",
      tr: "veriyi savunulabilir içgörülere dönüştüren bir veri analisti",
      zh: "一位把数据转化为站得住脚的洞见的数据分析师",
    },
    autoTarget: "gpt",
    protocols: {
      RESEARCH_PROTOCOL: [
        {
          text: {
            en: "Inspect the data first: structure, types, missing values and outliers.",
            tr: "Önce veriyi incele: yapı, tipler, eksik değerler ve aykırı değerler.",
            zh: "先检查数据：结构、类型、缺失值和异常值。",
          },
        },
        {
          text: {
            en: "State the method used for every number you report.",
            tr: "Raporladığın her sayı için kullanılan yöntemi belirt.",
            zh: "说明你报告的每个数字所用的方法。",
          },
        },
        {
          text: {
            en: "Distinguish correlation from causation.",
            tr: "Korelasyonu nedensellikten ayır.",
            zh: "区分相关性与因果关系。",
          },
        },
      ],
    },
    localSignals: [["veri", 2], ["data", 2], "csv", "excel", "istatistik", "statistic", "dashboard", "metrik", "metric", "grafik", "chart", "trend"],
  },
  {
    id: "image_generation",
    family: "visual",
    label: { en: "Image generation", tr: "Görsel üretimi", zh: "图像生成" },
    description: "Create a new image, illustration, logo, poster or photo-realistic visual.",
    role: {
      en: "an art director who specifies visuals precisely",
      tr: "görselleri hassas biçimde tarif eden bir sanat yönetmeni",
      zh: "一位能精确描述视觉效果的艺术总监",
    },
    autoTarget: "gpt",
    localSignals: [["gorsel", 3], ["resim", 3], ["image", 2], "fotograf", "photo", "illustrasyon", "illustration", "logo", "poster", "ciz", "draw", "render", "midjourney", "dall"],
  },
  {
    id: "image_editing",
    family: "visual",
    label: { en: "Image editing", tr: "Görsel düzenleme", zh: "图像编辑" },
    description: "Modify an existing image: retouching, background changes, adding or removing elements.",
    role: {
      en: "a retoucher who edits images without altering what should stay",
      tr: "korunması gerekeni değiştirmeden görsel düzenleyen bir rötuş uzmanı",
      zh: "一位在不改变应保留内容的前提下编辑图像的修图师",
    },
    autoTarget: "gpt",
    successCriteria: [
      {
        text: {
          en: "Requested edits are applied and everything else in the image is unchanged",
          tr: "İstenen düzenlemeler uygulanmış, görseldeki diğer her şey değişmemiş",
          zh: "要求的编辑已应用，图像中的其他一切保持不变",
        },
      },
    ],
    localSignals: [["arka plan", 3], ["background", 2], "rotus", "retouch", "photoshop", ["gorseli duzenle", 4], ["edit the image", 4], "kirp", "crop"],
  },
  {
    id: "video_generation",
    family: "visual",
    label: { en: "Video generation", tr: "Video üretimi", zh: "视频生成" },
    description: "Create a video or animation: shots, motion, camera, duration, audio.",
    role: {
      en: "a director who specifies shots, motion and pacing precisely",
      tr: "çekimleri, hareketi ve ritmi hassas biçimde tarif eden bir yönetmen",
      zh: "一位能精确描述镜头、运动和节奏的导演",
    },
    autoTarget: "gemini",
    localSignals: [["video", 3], "animasyon", "animation", "sora", "veo", "klip", "clip", "sahne", "scene"],
  },
  {
    id: "writing",
    family: "content",
    label: { en: "Writing", tr: "Yazım", zh: "写作" },
    description: "Write prose: articles, essays, stories, emails, letters, scripts.",
    role: {
      en: "an experienced writer and editor",
      tr: "deneyimli bir yazar ve editör",
      zh: "一位经验丰富的作者和编辑",
    },
    autoTarget: "claude",
    localSignals: [["yaz", 1], "write", ["makale", 3], "article", "metin", "essay", "hikaye", "story", "blog", "mektup", "letter", "e-posta", "email"],
  },
  {
    id: "content_generation",
    family: "content",
    label: { en: "Content generation", tr: "İçerik üretimi", zh: "内容生成" },
    description: "Produce content assets in volume or series: posts, captions, product descriptions, newsletters.",
    role: {
      en: "a content strategist and copywriter",
      tr: "bir içerik stratejisti ve metin yazarı",
      zh: "一位内容策略师兼文案",
    },
    autoTarget: "gpt",
    localSignals: [["icerik", 3], ["content", 3], "gonderi", "caption", "aciklama", "description", "bulten", "newsletter", "seri", "series"],
  },
  {
    id: "social_media",
    family: "content",
    label: { en: "Social media", tr: "Sosyal medya", zh: "社交媒体" },
    description: "Social platform work: posts, reels, threads, hashtags, posting plans for Instagram, TikTok, LinkedIn, X.",
    role: {
      en: "a social media strategist who knows each platform's format and audience",
      tr: "her platformun formatını ve kitlesini bilen bir sosyal medya stratejisti",
      zh: "一位了解各平台格式和受众的社交媒体策略师",
    },
    autoTarget: "gpt",
    localSignals: [["instagram", 4], ["tiktok", 4], ["linkedin", 3], "twitter", "sosyal medya", "social media", "reels", "hashtag", "story", "takipci", "follower"],
  },
  {
    id: "marketing",
    family: "content",
    label: { en: "Marketing", tr: "Pazarlama", zh: "营销" },
    description: "Campaigns, positioning, ads, funnels, brand messaging, growth experiments.",
    role: {
      en: "a performance marketer with strong positioning skills",
      tr: "konumlandırmada güçlü bir performans pazarlamacısı",
      zh: "一位擅长定位的效果营销人员",
    },
    autoTarget: "gpt",
    localSignals: [["pazarlama", 4], ["marketing", 4], "kampanya", "campaign", "reklam", "advert", "funnel", "marka", "brand", "donusum", "conversion"],
  },
  {
    id: "seo",
    family: "content",
    label: { en: "SEO", tr: "SEO", zh: "SEO" },
    description: "Search visibility: indexable pages, metadata, structured data, keywords, internal linking, Google traffic.",
    role: {
      en: "a technical SEO specialist",
      tr: "teknik bir SEO uzmanı",
      zh: "一位技术 SEO 专家",
    },
    autoTarget: "gpt",
    blocks: ["VALIDATION_PROTOCOL"],
    successCriteria: [
      {
        text: {
          en: "Target pages are indexable with meaningful titles, descriptions and clean URLs",
          tr: "Hedef sayfalar anlamlı başlık, açıklama ve temiz URL'lerle indekslenebilir",
          zh: "目标页面可被索引，并具有有意义的标题、描述和简洁的 URL",
        },
      },
    ],
    localSignals: [["seo", 5], ["google", 3], "arama motoru", "search engine", "indeks", "index", "siralama", "ranking", "anahtar kelime", "keyword", "meta"],
  },
  {
    id: "automation",
    family: "engineering",
    label: { en: "Automation", tr: "Otomasyon", zh: "自动化" },
    description: "Automate a process: scripts, bots, scheduled jobs, integrations between tools, workflows.",
    role: {
      en: "an automation engineer who builds reliable, observable workflows",
      tr: "güvenilir ve izlenebilir iş akışları kuran bir otomasyon mühendisi",
      zh: "一位构建可靠、可观测工作流的自动化工程师",
    },
    autoTarget: "codex",
    implicitRequirements: [
      {
        text: {
          en: "Handle failures with retries or clear error reporting instead of failing silently",
          tr: "Hataları sessizce geçmek yerine yeniden deneme veya net hata raporlamayla ele al",
          zh: "通过重试或清晰的错误报告来处理失败，而不是静默失败",
        },
      },
    ],
    localSignals: [["otomasyon", 4], ["automation", 4], "otomatik", "automat", ["bot", 3], "script", "cron", "zamanla", "schedule", "workflow", "n8n", "zapier"],
  },
  {
    id: "agent_task",
    family: "engineering",
    label: { en: "Agent task", tr: "Agent görevi", zh: "智能体任务" },
    description: "An autonomous multi-step task an AI agent should carry out end to end with tools.",
    role: {
      en: "an autonomous agent that plans, acts, verifies and reports",
      tr: "planlayan, uygulayan, doğrulayan ve raporlayan otonom bir agent",
      zh: "一个会规划、执行、验证和报告的自主智能体",
    },
    autoTarget: "claude",
    localSignals: [["agent", 4], ["ajan", 4], "otonom", "autonomous", "uctan uca", "end to end"],
  },
  {
    id: "file_analysis",
    family: "analysis",
    label: { en: "File analysis", tr: "Dosya analizi", zh: "文件分析" },
    description: "Analyze provided files or documents: PDFs, logs, contracts, spreadsheets, code files.",
    role: {
      en: "an analyst who reads documents closely and cites exact passages",
      tr: "belgeleri dikkatle okuyan ve tam pasajlara atıf yapan bir analist",
      zh: "一位仔细阅读文档并引用确切段落的分析师",
    },
    autoTarget: "claude",
    protocols: {
      RESEARCH_PROTOCOL: [
        {
          text: {
            en: "Read the provided files completely before drawing conclusions.",
            tr: "Sonuç çıkarmadan önce sağlanan dosyaları tamamen oku.",
            zh: "在得出结论之前完整阅读所提供的文件。",
          },
        },
        {
          text: {
            en: "Quote or reference the exact location (page, line, section) for each key finding.",
            tr: "Her önemli bulgu için tam konumu (sayfa, satır, bölüm) alıntıla veya belirt.",
            zh: "为每一项关键发现引用或标明确切位置（页码、行号、章节）。",
          },
        },
        {
          text: {
            en: "Say explicitly when the files do not contain the answer.",
            tr: "Dosyalar cevabı içermiyorsa bunu açıkça söyle.",
            zh: "当文件中没有答案时要明确说明。",
          },
        },
      ],
    },
    localSignals: [["dosya", 3], ["file", 2], ["pdf", 3], "belge", "log", "docx", "xlsx", "sozlesmeyi incele", "ekteki", "attached"],
  },
  {
    id: "document_generation",
    family: "content",
    label: { en: "Document generation", tr: "Doküman üretimi", zh: "文档生成" },
    description: "Produce structured documents: reports, documentation, READMEs, proposals, presentations, specs.",
    role: {
      en: "a technical writer who produces clear, well-structured documents",
      tr: "net ve iyi yapılandırılmış dokümanlar hazırlayan bir teknik yazar",
      zh: "一位能写出清晰、结构良好文档的技术写作者",
    },
    autoTarget: "claude",
    localSignals: [["dokuman", 3], ["dokumantasyon", 4], ["documentation", 4], "rapor", "report", "sunum", "presentation", "readme", "teklif", "proposal", "spec"],
  },
  {
    id: "ui_ux",
    advisoryAware: true,
    family: "engineering",
    label: { en: "UI/UX", tr: "UI/UX", zh: "UI/UX" },
    description: "Interface and experience design or improvement: layout, flows, visibility, usability, accessibility.",
    role: {
      en: "a product designer-engineer focused on usability and clear hierarchy",
      tr: "kullanılabilirlik ve net hiyerarşiye odaklanan bir ürün tasarımcısı-mühendisi",
      zh: "一位注重可用性和清晰层级的产品设计师兼工程师",
    },
    autoTarget: "claude",
    protocols: {
      EXECUTION_PROTOCOL: [
        {
          when: { existingSystem: true },
          text: {
            en: "Review the current screens and user flows before proposing changes.",
            tr: "Değişiklik önermeden önce mevcut ekranları ve kullanıcı akışlarını incele.",
            zh: "在提出改动之前先审视当前的界面和用户流程。",
          },
        },
        {
          text: {
            en: "Identify the concrete usability or visibility problems that block the objective.",
            tr: "Amacı engelleyen somut kullanılabilirlik veya görünürlük sorunlarını tespit et.",
            zh: "找出阻碍目标的具体可用性或可见性问题。",
          },
        },
        {
          text: {
            en: "Design changes consistent with the existing design language and components.",
            tr: "Mevcut tasarım diline ve bileşenlerine uygun değişiklikler tasarla.",
            zh: "设计与现有设计语言和组件保持一致的改动。",
          },
        },
        {
          text: {
            en: "Check responsiveness and accessibility (contrast, focus states, semantics).",
            tr: "Duyarlılığı ve erişilebilirliği kontrol et (kontrast, odak durumları, semantik).",
            zh: "检查响应式布局和无障碍（对比度、焦点状态、语义）。",
          },
        },
      ],
    },
    localSignals: [["arayuz", 3], ["ui", 2], ["ux", 3], "tasarim", "design", "kullanici deneyimi", "user experience", "gorunur", "visible", "layout", "ekran", "responsive", "akis"],
  },
  {
    id: "business_strategy",
    family: "strategy",
    label: { en: "Business strategy", tr: "İş stratejisi", zh: "商业策略" },
    description: "Business decisions: strategy, pricing, market entry, competition, growth, business plans.",
    role: {
      en: "a pragmatic strategy consultant",
      tr: "pragmatik bir strateji danışmanı",
      zh: "一位务实的战略顾问",
    },
    autoTarget: "claude",
    localSignals: [["strateji", 4], ["strategy", 4], ["is plani", 4], "business", "pazar", "market", "rakip", "competitor", "gelir", "revenue", "buyume", "growth", "fiyatlandirma", "pricing"],
  },
  {
    id: "education",
    family: "strategy",
    label: { en: "Education", tr: "Eğitim", zh: "教育" },
    description: "Teach or explain: lessons, study plans, exercises, explanations adapted to a learner.",
    role: {
      en: "a patient teacher who adapts explanations to the learner's level",
      tr: "anlatımı öğrencinin seviyesine göre uyarlayan sabırlı bir öğretmen",
      zh: "一位根据学习者水平调整讲解的耐心老师",
    },
    autoTarget: "claude",
    outputContract: [
      {
        text: {
          en: "An explanation that builds from fundamentals to the target level",
          tr: "Temelden hedef seviyeye ilerleyen bir anlatım",
          zh: "从基础逐步讲到目标水平的讲解",
        },
      },
      { text: { en: "Worked examples", tr: "Çözümlü örnekler", zh: "完整的示例" } },
      { text: { en: "Practice questions to check understanding", tr: "Anlamayı kontrol eden alıştırma soruları", zh: "用来检验理解程度的练习题" } },
    ],
    localSignals: [["ogren", 3], ["learn", 3], "ogret", "teach", "ders", "lesson", "egitim", "sinav", "exam", "acikla", "explain", "konu anlat"],
  },
  {
    id: "general_reasoning",
    family: "strategy",
    label: { en: "General reasoning", tr: "Genel akıl yürütme", zh: "通用推理" },
    description: "General questions, decisions or problem solving that fit no more specific type.",
    role: {
      en: "a clear-thinking expert assistant",
      tr: "net düşünen uzman bir asistan",
      zh: "一位思路清晰的专家助手",
    },
    autoTarget: "gpt",
    localSignals: [],
  },
];
