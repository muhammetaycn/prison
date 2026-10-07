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
    label: { en: "Coding", tr: "Kodlama" },
    description: "Implement, extend or change software: features, integrations, endpoints, components.",
    role: {
      en: "a senior software engineer who ships focused, production-quality changes",
      tr: "odaklı ve production kalitesinde değişiklikler yapan kıdemli bir yazılım mühendisi",
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
    label: { en: "Software architecture", tr: "Yazılım mimarisi" },
    description: "Design or restructure the architecture of a system: modules, boundaries, data flow, scalability.",
    role: {
      en: "a software architect who balances simplicity, maintainability and scale",
      tr: "sadelik, sürdürülebilirlik ve ölçek arasında denge kuran bir yazılım mimarı",
    },
    autoTarget: "claude",
    blocks: ["VALIDATION_PROTOCOL"],
    outputContract: [
      {
        text: {
          en: "The proposed architecture with components, responsibilities and data flow",
          tr: "Bileşenler, sorumluluklar ve veri akışıyla önerilen mimari",
        },
      },
      {
        text: {
          en: "Key decisions with the alternatives considered and trade-offs",
          tr: "Değerlendirilen alternatifler ve ödünleşimlerle temel kararlar",
        },
      },
      { text: { en: "A migration or implementation path", tr: "Geçiş veya uygulama yolu" } },
    ],
    localSignals: [["mimari", 3], ["architect", 3], "olcekl", "scalab", "microservice", "mikroservis", "system design", "modul yapi"],
  },
  {
    id: "debugging",
    family: "engineering",
    label: { en: "Debugging", tr: "Hata ayıklama" },
    description: "Find and fix the root cause of a bug, crash, error or unexpected behavior.",
    role: {
      en: "a senior engineer who finds root causes instead of patching symptoms",
      tr: "semptomu yamamak yerine kök nedeni bulan kıdemli bir mühendis",
    },
    autoTarget: "codex",
    defaultActions: [
      { text: { en: "Reproduce the problem reliably", tr: "Problemi güvenilir şekilde yeniden üret" } },
      { text: { en: "Identify the root cause with evidence", tr: "Kök nedeni kanıtla tespit et" } },
      { text: { en: "Apply the smallest fix that addresses the root cause", tr: "Kök nedeni çözen en küçük düzeltmeyi uygula" } },
      { text: { en: "Add a regression test and verify the fix", tr: "Regresyon testi ekle ve düzeltmeyi doğrula" } },
    ],
    successCriteria: [
      { text: { en: "The original problem no longer reproduces", tr: "Orijinal problem artık tekrarlanmıyor" } },
      { text: { en: "A test covers the failure and passes", tr: "Hatayı kapsayan bir test var ve geçiyor" } },
      { text: { en: "No new failures were introduced", tr: "Yeni bir hata eklenmedi" } },
    ],
    localSignals: [["hata", 2], "bug", ["duzelt", 2], "fix", ["calismiyor", 3], "crash", "error", "sorun", "debug", "patliyor", "bozuk", "broken"],
  },
  {
    id: "security_analysis",
    advisoryAware: true,
    family: "engineering",
    label: { en: "Security analysis", tr: "Güvenlik analizi" },
    description: "Defensive security review: vulnerabilities, hardening, configuration audit, threat assessment.",
    role: {
      en: "a defensive security engineer performing an authorized review",
      tr: "yetkili bir inceleme yapan savunma odaklı bir güvenlik mühendisi",
    },
    autoTarget: "claude",
    blocks: ["VALIDATION_PROTOCOL"],
    protocols: {
      EXECUTION_PROTOCOL: [
        {
          text: {
            en: "Confirm the scope: only the systems named in the objective are in scope.",
            tr: "Kapsamı teyit et: yalnızca amaçta belirtilen sistemler kapsam içinde.",
          },
        },
        {
          text: {
            en: "Start with read-only inspection; collect evidence for every finding.",
            tr: "Salt okunur incelemeyle başla; her bulgu için kanıt topla.",
          },
        },
        {
          text: {
            en: "Rate each finding by severity and likelihood.",
            tr: "Her bulguyu önem ve olasılığa göre derecelendir.",
          },
        },
        {
          text: {
            en: "Recommend concrete, prioritized remediations.",
            tr: "Somut ve önceliklendirilmiş iyileştirmeler öner.",
          },
        },
      ],
    },
    disallowed: [
      {
        text: {
          en: "Take destructive or disruptive actions (deleting data, disabling protections, load testing)",
          tr: "Yıkıcı veya kesinti yaratan işlemler yapmak (veri silmek, korumaları kapatmak, yük testi)",
        },
      },
      {
        text: {
          en: "Test systems outside the stated scope",
          tr: "Belirtilen kapsam dışındaki sistemleri test etmek",
        },
      },
    ],
    outputContract: [
      {
        text: {
          en: "Findings with severity, evidence and affected component",
          tr: "Önem derecesi, kanıt ve etkilenen bileşenle bulgular",
        },
      },
      { text: { en: "Prioritized remediation steps", tr: "Önceliklendirilmiş iyileştirme adımları" } },
      { text: { en: "Residual risks and limitations of the review", tr: "Kalan riskler ve incelemenin sınırları" } },
    ],
    successCriteria: [
      {
        text: {
          en: "Every finding is backed by evidence and has a concrete remediation",
          tr: "Her bulgu kanıta dayanıyor ve somut bir iyileştirmesi var",
        },
      },
    ],
    localSignals: [["guvenlik", 3], ["security", 3], "zafiyet", "vulnerab", "pentest", "saldiri", "malware", "virus", "defender", "firewall", "guvenlik duvari", "audit", "hardening"],
  },
  {
    id: "research",
    family: "analysis",
    label: { en: "Research", tr: "Araştırma" },
    description: "Investigate a topic and answer specific questions with sources.",
    role: {
      en: "a careful researcher who separates evidence from opinion",
      tr: "kanıtı görüşten ayıran titiz bir araştırmacı",
    },
    autoTarget: "claude",
    localSignals: [["arastir", 3], ["research", 3], "kaynak", "source", "karsilastir", "compare", "nedir", "what is"],
  },
  {
    id: "deep_research",
    family: "analysis",
    label: { en: "Deep research", tr: "Derin araştırma" },
    description: "Comprehensive multi-source investigation producing a long-form, cited report.",
    role: {
      en: "a senior research analyst producing a comprehensive, well-cited report",
      tr: "kapsamlı ve iyi kaynaklandırılmış rapor hazırlayan kıdemli bir araştırma analisti",
    },
    autoTarget: "gpt",
    blocks: ["EXECUTION_PROTOCOL"],
    localSignals: [["derin arastirma", 5], ["deep research", 5], "kapsamli", "comprehensive", "literatur", "literature"],
  },
  {
    id: "data_analysis",
    family: "analysis",
    label: { en: "Data analysis", tr: "Veri analizi" },
    description: "Analyze datasets: statistics, trends, metrics, visualizations, insights.",
    role: {
      en: "a data analyst who turns data into defensible insights",
      tr: "veriyi savunulabilir içgörülere dönüştüren bir veri analisti",
    },
    autoTarget: "gpt",
    protocols: {
      RESEARCH_PROTOCOL: [
        {
          text: {
            en: "Inspect the data first: structure, types, missing values and outliers.",
            tr: "Önce veriyi incele: yapı, tipler, eksik değerler ve aykırı değerler.",
          },
        },
        {
          text: {
            en: "State the method used for every number you report.",
            tr: "Raporladığın her sayı için kullanılan yöntemi belirt.",
          },
        },
        {
          text: {
            en: "Distinguish correlation from causation.",
            tr: "Korelasyonu nedensellikten ayır.",
          },
        },
      ],
    },
    localSignals: [["veri", 2], ["data", 2], "csv", "excel", "istatistik", "statistic", "dashboard", "metrik", "metric", "grafik", "chart", "trend"],
  },
  {
    id: "image_generation",
    family: "visual",
    label: { en: "Image generation", tr: "Görsel üretimi" },
    description: "Create a new image, illustration, logo, poster or photo-realistic visual.",
    role: {
      en: "an art director who specifies visuals precisely",
      tr: "görselleri hassas biçimde tarif eden bir sanat yönetmeni",
    },
    autoTarget: "gpt",
    localSignals: [["gorsel", 3], ["resim", 3], ["image", 2], "fotograf", "photo", "illustrasyon", "illustration", "logo", "poster", "ciz", "draw", "render", "midjourney", "dall"],
  },
  {
    id: "image_editing",
    family: "visual",
    label: { en: "Image editing", tr: "Görsel düzenleme" },
    description: "Modify an existing image: retouching, background changes, adding or removing elements.",
    role: {
      en: "a retoucher who edits images without altering what should stay",
      tr: "korunması gerekeni değiştirmeden görsel düzenleyen bir rötuş uzmanı",
    },
    autoTarget: "gpt",
    successCriteria: [
      {
        text: {
          en: "Requested edits are applied and everything else in the image is unchanged",
          tr: "İstenen düzenlemeler uygulanmış, görseldeki diğer her şey değişmemiş",
        },
      },
    ],
    localSignals: [["arka plan", 3], ["background", 2], "rotus", "retouch", "photoshop", ["gorseli duzenle", 4], ["edit the image", 4], "kirp", "crop"],
  },
  {
    id: "video_generation",
    family: "visual",
    label: { en: "Video generation", tr: "Video üretimi" },
    description: "Create a video or animation: shots, motion, camera, duration, audio.",
    role: {
      en: "a director who specifies shots, motion and pacing precisely",
      tr: "çekimleri, hareketi ve ritmi hassas biçimde tarif eden bir yönetmen",
    },
    autoTarget: "gemini",
    localSignals: [["video", 3], "animasyon", "animation", "sora", "veo", "klip", "clip", "sahne", "scene"],
  },
  {
    id: "writing",
    family: "content",
    label: { en: "Writing", tr: "Yazım" },
    description: "Write prose: articles, essays, stories, emails, letters, scripts.",
    role: {
      en: "an experienced writer and editor",
      tr: "deneyimli bir yazar ve editör",
    },
    autoTarget: "claude",
    localSignals: [["yaz", 1], "write", ["makale", 3], "article", "metin", "essay", "hikaye", "story", "blog", "mektup", "letter", "e-posta", "email"],
  },
  {
    id: "content_generation",
    family: "content",
    label: { en: "Content generation", tr: "İçerik üretimi" },
    description: "Produce content assets in volume or series: posts, captions, product descriptions, newsletters.",
    role: {
      en: "a content strategist and copywriter",
      tr: "bir içerik stratejisti ve metin yazarı",
    },
    autoTarget: "gpt",
    localSignals: [["icerik", 3], ["content", 3], "gonderi", "caption", "aciklama", "description", "bulten", "newsletter", "seri", "series"],
  },
  {
    id: "social_media",
    family: "content",
    label: { en: "Social media", tr: "Sosyal medya" },
    description: "Social platform work: posts, reels, threads, hashtags, posting plans for Instagram, TikTok, LinkedIn, X.",
    role: {
      en: "a social media strategist who knows each platform's format and audience",
      tr: "her platformun formatını ve kitlesini bilen bir sosyal medya stratejisti",
    },
    autoTarget: "gpt",
    localSignals: [["instagram", 4], ["tiktok", 4], ["linkedin", 3], "twitter", "sosyal medya", "social media", "reels", "hashtag", "story", "takipci", "follower"],
  },
  {
    id: "marketing",
    family: "content",
    label: { en: "Marketing", tr: "Pazarlama" },
    description: "Campaigns, positioning, ads, funnels, brand messaging, growth experiments.",
    role: {
      en: "a performance marketer with strong positioning skills",
      tr: "konumlandırmada güçlü bir performans pazarlamacısı",
    },
    autoTarget: "gpt",
    localSignals: [["pazarlama", 4], ["marketing", 4], "kampanya", "campaign", "reklam", "advert", "funnel", "marka", "brand", "donusum", "conversion"],
  },
  {
    id: "seo",
    family: "content",
    label: { en: "SEO", tr: "SEO" },
    description: "Search visibility: indexable pages, metadata, structured data, keywords, internal linking, Google traffic.",
    role: {
      en: "a technical SEO specialist",
      tr: "teknik bir SEO uzmanı",
    },
    autoTarget: "gpt",
    blocks: ["VALIDATION_PROTOCOL"],
    successCriteria: [
      {
        text: {
          en: "Target pages are indexable with meaningful titles, descriptions and clean URLs",
          tr: "Hedef sayfalar anlamlı başlık, açıklama ve temiz URL'lerle indekslenebilir",
        },
      },
    ],
    localSignals: [["seo", 5], ["google", 3], "arama motoru", "search engine", "indeks", "index", "siralama", "ranking", "anahtar kelime", "keyword", "meta"],
  },
  {
    id: "automation",
    family: "engineering",
    label: { en: "Automation", tr: "Otomasyon" },
    description: "Automate a process: scripts, bots, scheduled jobs, integrations between tools, workflows.",
    role: {
      en: "an automation engineer who builds reliable, observable workflows",
      tr: "güvenilir ve izlenebilir iş akışları kuran bir otomasyon mühendisi",
    },
    autoTarget: "codex",
    implicitRequirements: [
      {
        text: {
          en: "Handle failures with retries or clear error reporting instead of failing silently",
          tr: "Hataları sessizce geçmek yerine yeniden deneme veya net hata raporlamayla ele al",
        },
      },
    ],
    localSignals: [["otomasyon", 4], ["automation", 4], "otomatik", "automat", ["bot", 3], "script", "cron", "zamanla", "schedule", "workflow", "n8n", "zapier"],
  },
  {
    id: "agent_task",
    family: "engineering",
    label: { en: "Agent task", tr: "Agent görevi" },
    description: "An autonomous multi-step task an AI agent should carry out end to end with tools.",
    role: {
      en: "an autonomous agent that plans, acts, verifies and reports",
      tr: "planlayan, uygulayan, doğrulayan ve raporlayan otonom bir agent",
    },
    autoTarget: "claude",
    localSignals: [["agent", 4], ["ajan", 4], "otonom", "autonomous", "uctan uca", "end to end"],
  },
  {
    id: "file_analysis",
    family: "analysis",
    label: { en: "File analysis", tr: "Dosya analizi" },
    description: "Analyze provided files or documents: PDFs, logs, contracts, spreadsheets, code files.",
    role: {
      en: "an analyst who reads documents closely and cites exact passages",
      tr: "belgeleri dikkatle okuyan ve tam pasajlara atıf yapan bir analist",
    },
    autoTarget: "claude",
    protocols: {
      RESEARCH_PROTOCOL: [
        {
          text: {
            en: "Read the provided files completely before drawing conclusions.",
            tr: "Sonuç çıkarmadan önce sağlanan dosyaları tamamen oku.",
          },
        },
        {
          text: {
            en: "Quote or reference the exact location (page, line, section) for each key finding.",
            tr: "Her önemli bulgu için tam konumu (sayfa, satır, bölüm) alıntıla veya belirt.",
          },
        },
        {
          text: {
            en: "Say explicitly when the files do not contain the answer.",
            tr: "Dosyalar cevabı içermiyorsa bunu açıkça söyle.",
          },
        },
      ],
    },
    localSignals: [["dosya", 3], ["file", 2], ["pdf", 3], "belge", "log", "docx", "xlsx", "sozlesmeyi incele", "ekteki", "attached"],
  },
  {
    id: "document_generation",
    family: "content",
    label: { en: "Document generation", tr: "Doküman üretimi" },
    description: "Produce structured documents: reports, documentation, READMEs, proposals, presentations, specs.",
    role: {
      en: "a technical writer who produces clear, well-structured documents",
      tr: "net ve iyi yapılandırılmış dokümanlar hazırlayan bir teknik yazar",
    },
    autoTarget: "claude",
    localSignals: [["dokuman", 3], ["dokumantasyon", 4], ["documentation", 4], "rapor", "report", "sunum", "presentation", "readme", "teklif", "proposal", "spec"],
  },
  {
    id: "ui_ux",
    advisoryAware: true,
    family: "engineering",
    label: { en: "UI/UX", tr: "UI/UX" },
    description: "Interface and experience design or improvement: layout, flows, visibility, usability, accessibility.",
    role: {
      en: "a product designer-engineer focused on usability and clear hierarchy",
      tr: "kullanılabilirlik ve net hiyerarşiye odaklanan bir ürün tasarımcısı-mühendisi",
    },
    autoTarget: "claude",
    protocols: {
      EXECUTION_PROTOCOL: [
        {
          when: { existingSystem: true },
          text: {
            en: "Review the current screens and user flows before proposing changes.",
            tr: "Değişiklik önermeden önce mevcut ekranları ve kullanıcı akışlarını incele.",
          },
        },
        {
          text: {
            en: "Identify the concrete usability or visibility problems that block the objective.",
            tr: "Amacı engelleyen somut kullanılabilirlik veya görünürlük sorunlarını tespit et.",
          },
        },
        {
          text: {
            en: "Design changes consistent with the existing design language and components.",
            tr: "Mevcut tasarım diline ve bileşenlerine uygun değişiklikler tasarla.",
          },
        },
        {
          text: {
            en: "Check responsiveness and accessibility (contrast, focus states, semantics).",
            tr: "Duyarlılığı ve erişilebilirliği kontrol et (kontrast, odak durumları, semantik).",
          },
        },
      ],
    },
    localSignals: [["arayuz", 3], ["ui", 2], ["ux", 3], "tasarim", "design", "kullanici deneyimi", "user experience", "gorunur", "visible", "layout", "ekran", "responsive", "akis"],
  },
  {
    id: "business_strategy",
    family: "strategy",
    label: { en: "Business strategy", tr: "İş stratejisi" },
    description: "Business decisions: strategy, pricing, market entry, competition, growth, business plans.",
    role: {
      en: "a pragmatic strategy consultant",
      tr: "pragmatik bir strateji danışmanı",
    },
    autoTarget: "claude",
    localSignals: [["strateji", 4], ["strategy", 4], ["is plani", 4], "business", "pazar", "market", "rakip", "competitor", "gelir", "revenue", "buyume", "growth", "fiyatlandirma", "pricing"],
  },
  {
    id: "education",
    family: "strategy",
    label: { en: "Education", tr: "Eğitim" },
    description: "Teach or explain: lessons, study plans, exercises, explanations adapted to a learner.",
    role: {
      en: "a patient teacher who adapts explanations to the learner's level",
      tr: "anlatımı öğrencinin seviyesine göre uyarlayan sabırlı bir öğretmen",
    },
    autoTarget: "claude",
    outputContract: [
      {
        text: {
          en: "An explanation that builds from fundamentals to the target level",
          tr: "Temelden hedef seviyeye ilerleyen bir anlatım",
        },
      },
      { text: { en: "Worked examples", tr: "Çözümlü örnekler" } },
      { text: { en: "Practice questions to check understanding", tr: "Anlamayı kontrol eden alıştırma soruları" } },
    ],
    localSignals: [["ogren", 3], ["learn", 3], "ogret", "teach", "ders", "lesson", "egitim", "sinav", "exam", "acikla", "explain", "konu anlat"],
  },
  {
    id: "general_reasoning",
    family: "strategy",
    label: { en: "General reasoning", tr: "Genel akıl yürütme" },
    description: "General questions, decisions or problem solving that fit no more specific type.",
    role: {
      en: "a clear-thinking expert assistant",
      tr: "net düşünen uzman bir asistan",
    },
    autoTarget: "gpt",
    localSignals: [],
  },
];
