import type { FamilyTemplate, TaskFamily } from "@/core/task-types/types";

/**
 * Family-level prompt templates. Task type profiles inherit these and override where needed.
 * All template text lives under src/templates so prompt wording is never scattered through engine code.
 */
export const FAMILY_TEMPLATES: Record<TaskFamily, FamilyTemplate> = {
  engineering: {
    id: "engineering",
    blocks: ["CURRENT_SYSTEM", "EXECUTION_PROTOCOL", "TEST_PROTOCOL"],
    defaultOperation: "modify_existing",
    expectedFormat: {
      en: "Working changes in the codebase plus a short final report",
      tr: "Kod tabanında çalışan değişiklikler ve kısa bir final raporu",
      zh: "代码库中可以正常工作的改动，以及一份简短的最终报告",
    },
    protocols: {
      EXECUTION_PROTOCOL: [
        {
          when: { existingSystem: true },
          text: {
            en: "Inspect the relevant parts of the existing system and its conventions before changing anything.",
            tr: "Herhangi bir şeyi değiştirmeden önce mevcut sistemin ilgili kısımlarını ve kurallarını incele.",
            zh: "在修改任何内容之前，先检查现有系统的相关部分及其约定。",
          },
        },
        {
          when: { existingSystem: false },
          text: {
            en: "Choose a simple, conventional structure that fits the requirements; avoid speculative complexity.",
            tr: "Gereksinimlere uyan sade ve yaygın bir yapı seç; spekülatif karmaşıklıktan kaçın.",
            zh: "选择适合需求的简单、常规的结构；避免臆测性的复杂设计。",
          },
        },
        {
          text: {
            en: "Plan the smallest set of changes that satisfies every requirement.",
            tr: "Tüm gereksinimleri karşılayan en küçük değişiklik setini planla.",
            zh: "规划能满足所有需求的最小改动集合。",
          },
        },
        {
          text: {
            en: "Implement following the existing code style, patterns and naming.",
            tr: "Mevcut kod stiline, kalıplarına ve isimlendirmeye uyarak uygula.",
            zh: "按照现有的代码风格、模式和命名来实现。",
          },
        },
        {
          text: {
            en: "Verify the result against the success criteria before finishing.",
            tr: "Bitirmeden önce sonucu başarı kriterlerine göre doğrula.",
            zh: "完成之前，对照成功标准验证结果。",
          },
        },
      ],
      TEST_PROTOCOL: [
        {
          text: {
            en: "Run the existing build, type check and test suite before and after your changes.",
            tr: "Değişikliklerinden önce ve sonra mevcut build, tip kontrolü ve test setini çalıştır.",
            zh: "在改动前后运行现有的构建、类型检查和测试套件。",
          },
        },
        {
          text: {
            en: "Add or update tests for new or changed behavior.",
            tr: "Yeni veya değişen davranış için test ekle ya da güncelle.",
            zh: "为新增或改变的行为添加或更新测试。",
          },
        },
        {
          when: { existingSystem: true },
          text: {
            en: "Run a regression check confirming that protected elements still work as before.",
            tr: "Korunan unsurların önceki gibi çalıştığını doğrulayan bir regresyon kontrolü yap.",
            zh: "运行回归检查，确认受保护的元素仍和以前一样正常工作。",
          },
        },
      ],
      VALIDATION_PROTOCOL: [
        {
          text: {
            en: "Check the result against every requirement, constraint and protected element.",
            tr: "Sonucu her gereksinim, kısıt ve korunan unsura göre kontrol et.",
            zh: "对照每一项需求、约束和受保护的元素检查结果。",
          },
        },
        {
          text: {
            en: "Confirm no unrelated files, behaviors or dependencies were changed.",
            tr: "İlgisiz dosya, davranış veya bağımlılıkların değişmediğini doğrula.",
            zh: "确认没有改动无关的文件、行为或依赖。",
          },
        },
      ],
    },
    agentProtocol: [
      {
        text: {
          en: "Explore before acting: map the repository structure, the modules involved and the conventions in use.",
          tr: "Harekete geçmeden önce keşfet: repository yapısını, ilgili modülleri ve kullanılan kuralları çıkar.",
          zh: "先探索再行动：梳理代码仓库结构、涉及的模块以及正在使用的约定。",
        },
      },
      {
        text: {
          en: "Write a short plan mapping each requirement to concrete changes.",
          tr: "Her gereksinimi somut değişikliklere eşleyen kısa bir plan yaz.",
          zh: "写一个简短的计划，把每项需求对应到具体的改动。",
        },
      },
      {
        text: {
          en: "Implement in small, verifiable steps.",
          tr: "Küçük ve doğrulanabilir adımlarla uygula.",
          zh: "以可验证的小步骤来实现。",
        },
      },
      {
        text: {
          en: "After each step run the relevant build, type check and tests; fix failures before moving on.",
          tr: "Her adımdan sonra ilgili build, tip kontrolü ve testleri çalıştır; devam etmeden hataları düzelt.",
          zh: "每一步之后运行相关的构建、类型检查和测试；先修复失败再继续。",
        },
      },
      {
        text: {
          en: "When blocked, take the most reasonable option consistent with the constraints and note it; ask only if a decision is irreversible or genuinely ambiguous.",
          tr: "Takıldığında kısıtlarla uyumlu en makul seçeneği uygula ve not et; yalnızca geri alınamaz ya da gerçekten belirsiz kararlarda sor.",
          zh: "遇到阻碍时，选择与约束一致的最合理方案并记下来；只有在决定不可逆或确实存在歧义时才提问。",
        },
      },
      {
        text: {
          en: "Finish with the report described in the output contract.",
          tr: "Çıktı sözleşmesinde tarif edilen raporla bitir.",
          zh: "最后按照输出契约中描述的报告收尾。",
        },
      },
    ],
    defaultActions: [
      {
        when: { existingSystem: true },
        text: {
          en: "Inspect the existing code paths related to the objective",
          tr: "Amaçla ilgili mevcut kod yollarını incele",
          zh: "检查与目标相关的现有代码路径",
        },
      },
      {
        text: {
          en: "Implement the required changes with minimal, focused edits",
          tr: "Gerekli değişiklikleri minimal ve odaklı düzenlemelerle uygula",
          zh: "用最小、聚焦的修改实现所需的改动",
        },
      },
      {
        text: {
          en: "Test and verify the result, including regressions",
          tr: "Sonucu regresyonlar dahil test et ve doğrula",
          zh: "测试并验证结果，包括回归",
        },
      },
    ],
    outputContract: [
      { text: { en: "A short summary of what changed and why", tr: "Neyin neden değiştiğine dair kısa bir özet", zh: "简要说明改了什么以及为什么改" } },
      { text: { en: "The list of files created or modified", tr: "Oluşturulan veya değiştirilen dosyaların listesi", zh: "新建或修改的文件列表" } },
      {
        text: {
          en: "Verification steps that were run and their results",
          tr: "Çalıştırılan doğrulama adımları ve sonuçları",
          zh: "已执行的验证步骤及其结果",
        },
      },
      {
        text: {
          en: "Open risks, assumptions made and recommended follow-ups",
          tr: "Açık riskler, yapılan varsayımlar ve önerilen sonraki adımlar",
          zh: "未解决的风险、所做的假设以及建议的后续工作",
        },
      },
    ],
    successCriteria: [
      {
        text: {
          en: "Every requirement is implemented and verified",
          tr: "Her gereksinim uygulanmış ve doğrulanmış",
          zh: "每一项需求都已实现并经过验证",
        },
      },
      {
        text: {
          en: "Build, type check and existing tests pass",
          tr: "Build, tip kontrolü ve mevcut testler geçiyor",
          zh: "构建、类型检查和现有测试全部通过",
        },
      },
      {
        when: { existingSystem: true },
        text: {
          en: "Protected elements behave exactly as before",
          tr: "Korunan unsurlar tam olarak eskisi gibi çalışıyor",
          zh: "受保护的元素的行为与之前完全一致",
        },
      },
    ],
  },

  analysis: {
    id: "analysis",
    blocks: ["RESEARCH_PROTOCOL", "VALIDATION_PROTOCOL"],
    defaultOperation: "analyze",
    expectedFormat: {
      en: "A structured report",
      tr: "Yapılandırılmış bir rapor",
      zh: "一份结构化的报告",
    },
    protocols: {
      RESEARCH_PROTOCOL: [
        {
          text: {
            en: "Turn the objective into explicit research questions before gathering material.",
            tr: "Materyal toplamadan önce amacı açık araştırma sorularına dönüştür.",
            zh: "在收集资料之前，先把目标转化为明确的研究问题。",
          },
        },
        {
          text: {
            en: "Prefer primary and recent sources; record the source and date for each key claim.",
            tr: "Birincil ve güncel kaynakları tercih et; her önemli iddia için kaynak ve tarihi kaydet.",
            zh: "优先使用一手和最新的来源；为每一个关键论断记录来源和日期。",
          },
        },
        {
          text: {
            en: "Cover opposing views and note where evidence is weak or conflicting.",
            tr: "Karşıt görüşleri de ele al; kanıtın zayıf veya çelişkili olduğu yerleri belirt.",
            zh: "涵盖对立观点，并指出证据薄弱或相互矛盾之处。",
          },
        },
        {
          text: {
            en: "Synthesize the findings into conclusions instead of listing sources.",
            tr: "Kaynakları listelemek yerine bulguları sonuçlara dönüştür.",
            zh: "把研究发现综合成结论，而不是罗列来源。",
          },
        },
      ],
      VALIDATION_PROTOCOL: [
        {
          text: {
            en: "Separate verified facts, inferences and assumptions explicitly.",
            tr: "Doğrulanmış gerçekleri, çıkarımları ve varsayımları açıkça ayır.",
            zh: "明确区分已验证的事实、推论和假设。",
          },
        },
        {
          text: {
            en: "Cross-check key claims against at least two independent sources.",
            tr: "Önemli iddiaları en az iki bağımsız kaynakla çapraz kontrol et.",
            zh: "用至少两个独立来源交叉核对关键论断。",
          },
        },
      ],
    },
    agentProtocol: [
      {
        text: {
          en: "Plan the investigation: list the questions and where the evidence is likely to be.",
          tr: "İncelemeyi planla: soruları ve kanıtın nerede olabileceğini listele.",
          zh: "规划调查：列出问题以及证据可能所在的位置。",
        },
      },
      {
        text: {
          en: "Gather evidence iteratively; refine the questions when findings change the picture.",
          tr: "Kanıtı yinelemeli topla; bulgular tabloyu değiştirdiğinde soruları güncelle.",
          zh: "迭代地收集证据；当发现改变了整体认识时，调整问题。",
        },
      },
      {
        text: {
          en: "Stop when every success criterion is met or further searching stops adding information.",
          tr: "Tüm başarı kriterleri karşılandığında veya ek arama yeni bilgi getirmediğinde dur.",
          zh: "当每一条成功标准都已满足，或继续搜索不再带来新信息时停止。",
        },
      },
      {
        text: {
          en: "Deliver the output in the format described in the output contract.",
          tr: "Çıktıyı çıktı sözleşmesinde tarif edilen formatta teslim et.",
          zh: "按照输出契约中描述的格式交付结果。",
        },
      },
    ],
    defaultActions: [
      { text: { en: "Define the questions to answer", tr: "Cevaplanacak soruları tanımla", zh: "确定需要回答的问题" } },
      { text: { en: "Collect and evaluate the relevant evidence", tr: "İlgili kanıtları topla ve değerlendir", zh: "收集并评估相关证据" } },
      { text: { en: "Synthesize findings into clear conclusions", tr: "Bulguları net sonuçlara dönüştür", zh: "把发现综合成清晰的结论" } },
    ],
    outputContract: [
      { text: { en: "An executive summary of the findings", tr: "Bulguların yönetici özeti", zh: "研究发现的执行摘要" } },
      {
        text: {
          en: "Detailed findings with supporting evidence and sources",
          tr: "Destekleyici kanıt ve kaynaklarla detaylı bulgular",
          zh: "带有支持证据和来源的详细发现",
        },
      },
      { text: { en: "Limitations and open questions", tr: "Sınırlılıklar ve açık sorular", zh: "局限性和未解决的问题" } },
    ],
    successCriteria: [
      {
        text: {
          en: "Every question in scope is answered with supporting evidence",
          tr: "Kapsamdaki her soru destekleyici kanıtla cevaplanmış",
          zh: "范围内的每个问题都有证据支持的回答",
        },
      },
      {
        text: {
          en: "Facts, inferences and uncertainties are clearly separated",
          tr: "Gerçekler, çıkarımlar ve belirsizlikler net biçimde ayrılmış",
          zh: "事实、推论和不确定性被清楚地区分开",
        },
      },
    ],
  },

  visual: {
    id: "visual",
    blocks: [],
    defaultOperation: "generate_media",
    expectedFormat: {
      en: "The generated visual",
      tr: "Üretilen görsel",
      zh: "生成的视觉作品",
    },
    protocols: {},
    agentProtocol: [
      {
        text: {
          en: "Draft the composition first, then refine details, lighting and style.",
          tr: "Önce kompozisyonu kur, sonra detayları, ışığı ve stili iyileştir.",
          zh: "先确定构图，再细化细节、光线和风格。",
        },
      },
      {
        text: {
          en: "Check the result against every specified element and constraint, and iterate until it matches.",
          tr: "Sonucu belirtilen her unsur ve kısıtla karşılaştır; uyana kadar yinele.",
          zh: "对照每一个指定的元素和约束检查结果，反复迭代直到相符。",
        },
      },
    ],
    defaultActions: [],
    outputContract: [
      {
        text: {
          en: "One final visual that follows every specification above",
          tr: "Yukarıdaki tüm özelliklere uyan tek bir final görsel",
          zh: "一份遵循以上所有规格的最终视觉作品",
        },
      },
    ],
    successCriteria: [
      {
        text: {
          en: "Every specified subject, style element and constraint is visible in the result",
          tr: "Belirtilen her konu, stil unsuru ve kısıt sonuçta görülüyor",
          zh: "每一个指定的主体、风格元素和约束都在结果中可见",
        },
      },
    ],
  },

  content: {
    id: "content",
    blocks: ["VALIDATION_PROTOCOL"],
    defaultOperation: "generate_content",
    expectedFormat: {
      en: "Ready-to-use text",
      tr: "Kullanıma hazır metin",
      zh: "可直接使用的文本",
    },
    protocols: {
      VALIDATION_PROTOCOL: [
        {
          text: {
            en: "Before finishing, check the text against the audience, tone, length and every explicit requirement.",
            tr: "Bitirmeden önce metni hedef kitle, ton, uzunluk ve her açık gereksinime göre kontrol et.",
            zh: "完成之前，对照受众、语气、篇幅以及每一项明确要求检查文本。",
          },
        },
        {
          text: {
            en: "Do not state facts you cannot support; mark anything that needs verification.",
            tr: "Destekleyemeyeceğin bilgileri gerçekmiş gibi yazma; doğrulama gerektirenleri işaretle.",
            zh: "不要陈述你无法支持的事实；把需要核实的内容标注出来。",
          },
        },
      ],
    },
    agentProtocol: [
      {
        text: {
          en: "Outline the structure before writing.",
          tr: "Yazmadan önce yapıyı taslak olarak çıkar.",
          zh: "写作之前先列出结构。",
        },
      },
      {
        text: {
          en: "Write a full draft, then revise it against the requirements and success criteria.",
          tr: "Tam bir taslak yaz, sonra gereksinimlere ve başarı kriterlerine göre revize et.",
          zh: "先写出完整初稿，再对照需求和成功标准进行修改。",
        },
      },
      {
        text: {
          en: "Deliver only the final version in the requested format.",
          tr: "Yalnızca final sürümü istenen formatta teslim et.",
          zh: "只以要求的格式交付最终版本。",
        },
      },
    ],
    defaultActions: [],
    outputContract: [
      { text: { en: "The final content, ready to use", tr: "Kullanıma hazır final içerik", zh: "可直接使用的最终内容" } },
    ],
    successCriteria: [
      {
        text: {
          en: "The content fits the intended audience, tone and format",
          tr: "İçerik hedef kitleye, tona ve formata uygun",
          zh: "内容符合预期的受众、语气和格式",
        },
      },
      {
        text: {
          en: "Every explicit requirement is satisfied",
          tr: "Her açık gereksinim karşılanmış",
          zh: "每一项明确要求都已满足",
        },
      },
    ],
  },

  strategy: {
    id: "strategy",
    blocks: [],
    defaultOperation: "advise",
    expectedFormat: {
      en: "A structured answer with clear recommendations",
      tr: "Net önerilerle yapılandırılmış bir cevap",
      zh: "一份带有清晰建议的结构化回答",
    },
    protocols: {
      VALIDATION_PROTOCOL: [
        {
          text: {
            en: "Check every recommendation for feasibility, cost and risk against the stated context.",
            tr: "Her öneriyi belirtilen bağlama göre uygulanabilirlik, maliyet ve risk açısından kontrol et.",
            zh: "对照所述背景，检查每条建议的可行性、成本和风险。",
          },
        },
      ],
    },
    agentProtocol: [
      {
        text: {
          en: "Break the problem into sub-questions and address them in order.",
          tr: "Problemi alt sorulara böl ve sırayla ele al.",
          zh: "把问题拆分为子问题，并按顺序逐一处理。",
        },
      },
      {
        text: {
          en: "Compare at least two options before recommending one.",
          tr: "Birini önermeden önce en az iki seçeneği karşılaştır.",
          zh: "在推荐某个方案之前，至少比较两个选项。",
        },
      },
      {
        text: {
          en: "Close with concrete, prioritized next steps.",
          tr: "Somut ve önceliklendirilmiş sonraki adımlarla bitir.",
          zh: "最后给出具体的、按优先级排序的下一步行动。",
        },
      },
    ],
    defaultActions: [],
    outputContract: [
      {
        text: {
          en: "A structured answer with clear recommendations",
          tr: "Net önerilerle yapılandırılmış bir cevap",
          zh: "一份带有清晰建议的结构化回答",
        },
      },
      {
        text: {
          en: "The reasoning and trade-offs behind each recommendation",
          tr: "Her önerinin arkasındaki gerekçe ve ödünleşimler",
          zh: "每条建议背后的推理和取舍",
        },
      },
      { text: { en: "Concrete next steps", tr: "Somut sonraki adımlar", zh: "具体的下一步行动" } },
    ],
    successCriteria: [
      {
        text: {
          en: "Recommendations are specific, actionable and tied to the stated goal",
          tr: "Öneriler spesifik, uygulanabilir ve belirtilen amaca bağlı",
          zh: "建议具体、可执行，并与所述目标紧密相关",
        },
      },
    ],
  },
};
