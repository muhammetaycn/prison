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
    },
    protocols: {
      EXECUTION_PROTOCOL: [
        {
          when: { existingSystem: true },
          text: {
            en: "Inspect the relevant parts of the existing system and its conventions before changing anything.",
            tr: "Herhangi bir şeyi değiştirmeden önce mevcut sistemin ilgili kısımlarını ve kurallarını incele.",
          },
        },
        {
          when: { existingSystem: false },
          text: {
            en: "Choose a simple, conventional structure that fits the requirements; avoid speculative complexity.",
            tr: "Gereksinimlere uyan sade ve yaygın bir yapı seç; spekülatif karmaşıklıktan kaçın.",
          },
        },
        {
          text: {
            en: "Plan the smallest set of changes that satisfies every requirement.",
            tr: "Tüm gereksinimleri karşılayan en küçük değişiklik setini planla.",
          },
        },
        {
          text: {
            en: "Implement following the existing code style, patterns and naming.",
            tr: "Mevcut kod stiline, kalıplarına ve isimlendirmeye uyarak uygula.",
          },
        },
        {
          text: {
            en: "Verify the result against the success criteria before finishing.",
            tr: "Bitirmeden önce sonucu başarı kriterlerine göre doğrula.",
          },
        },
      ],
      TEST_PROTOCOL: [
        {
          text: {
            en: "Run the existing build, type check and test suite before and after your changes.",
            tr: "Değişikliklerinden önce ve sonra mevcut build, tip kontrolü ve test setini çalıştır.",
          },
        },
        {
          text: {
            en: "Add or update tests for new or changed behavior.",
            tr: "Yeni veya değişen davranış için test ekle ya da güncelle.",
          },
        },
        {
          when: { existingSystem: true },
          text: {
            en: "Run a regression check confirming that protected elements still work as before.",
            tr: "Korunan unsurların önceki gibi çalıştığını doğrulayan bir regresyon kontrolü yap.",
          },
        },
      ],
      VALIDATION_PROTOCOL: [
        {
          text: {
            en: "Check the result against every requirement, constraint and protected element.",
            tr: "Sonucu her gereksinim, kısıt ve korunan unsura göre kontrol et.",
          },
        },
        {
          text: {
            en: "Confirm no unrelated files, behaviors or dependencies were changed.",
            tr: "İlgisiz dosya, davranış veya bağımlılıkların değişmediğini doğrula.",
          },
        },
      ],
    },
    agentProtocol: [
      {
        text: {
          en: "Explore before acting: map the repository structure, the modules involved and the conventions in use.",
          tr: "Harekete geçmeden önce keşfet: repository yapısını, ilgili modülleri ve kullanılan kuralları çıkar.",
        },
      },
      {
        text: {
          en: "Write a short plan mapping each requirement to concrete changes.",
          tr: "Her gereksinimi somut değişikliklere eşleyen kısa bir plan yaz.",
        },
      },
      {
        text: {
          en: "Implement in small, verifiable steps.",
          tr: "Küçük ve doğrulanabilir adımlarla uygula.",
        },
      },
      {
        text: {
          en: "After each step run the relevant build, type check and tests; fix failures before moving on.",
          tr: "Her adımdan sonra ilgili build, tip kontrolü ve testleri çalıştır; devam etmeden hataları düzelt.",
        },
      },
      {
        text: {
          en: "When blocked, take the most reasonable option consistent with the constraints and note it; ask only if a decision is irreversible or genuinely ambiguous.",
          tr: "Takıldığında kısıtlarla uyumlu en makul seçeneği uygula ve not et; yalnızca geri alınamaz ya da gerçekten belirsiz kararlarda sor.",
        },
      },
      {
        text: {
          en: "Finish with the report described in the output contract.",
          tr: "Çıktı sözleşmesinde tarif edilen raporla bitir.",
        },
      },
    ],
    defaultActions: [
      {
        when: { existingSystem: true },
        text: {
          en: "Inspect the existing code paths related to the objective",
          tr: "Amaçla ilgili mevcut kod yollarını incele",
        },
      },
      {
        text: {
          en: "Implement the required changes with minimal, focused edits",
          tr: "Gerekli değişiklikleri minimal ve odaklı düzenlemelerle uygula",
        },
      },
      {
        text: {
          en: "Test and verify the result, including regressions",
          tr: "Sonucu regresyonlar dahil test et ve doğrula",
        },
      },
    ],
    outputContract: [
      { text: { en: "A short summary of what changed and why", tr: "Neyin neden değiştiğine dair kısa bir özet" } },
      { text: { en: "The list of files created or modified", tr: "Oluşturulan veya değiştirilen dosyaların listesi" } },
      {
        text: {
          en: "Verification steps that were run and their results",
          tr: "Çalıştırılan doğrulama adımları ve sonuçları",
        },
      },
      {
        text: {
          en: "Open risks, assumptions made and recommended follow-ups",
          tr: "Açık riskler, yapılan varsayımlar ve önerilen sonraki adımlar",
        },
      },
    ],
    successCriteria: [
      {
        text: {
          en: "Every requirement is implemented and verified",
          tr: "Her gereksinim uygulanmış ve doğrulanmış",
        },
      },
      {
        text: {
          en: "Build, type check and existing tests pass",
          tr: "Build, tip kontrolü ve mevcut testler geçiyor",
        },
      },
      {
        when: { existingSystem: true },
        text: {
          en: "Protected elements behave exactly as before",
          tr: "Korunan unsurlar tam olarak eskisi gibi çalışıyor",
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
    },
    protocols: {
      RESEARCH_PROTOCOL: [
        {
          text: {
            en: "Turn the objective into explicit research questions before gathering material.",
            tr: "Materyal toplamadan önce amacı açık araştırma sorularına dönüştür.",
          },
        },
        {
          text: {
            en: "Prefer primary and recent sources; record the source and date for each key claim.",
            tr: "Birincil ve güncel kaynakları tercih et; her önemli iddia için kaynak ve tarihi kaydet.",
          },
        },
        {
          text: {
            en: "Cover opposing views and note where evidence is weak or conflicting.",
            tr: "Karşıt görüşleri de ele al; kanıtın zayıf veya çelişkili olduğu yerleri belirt.",
          },
        },
        {
          text: {
            en: "Synthesize the findings into conclusions instead of listing sources.",
            tr: "Kaynakları listelemek yerine bulguları sonuçlara dönüştür.",
          },
        },
      ],
      VALIDATION_PROTOCOL: [
        {
          text: {
            en: "Separate verified facts, inferences and assumptions explicitly.",
            tr: "Doğrulanmış gerçekleri, çıkarımları ve varsayımları açıkça ayır.",
          },
        },
        {
          text: {
            en: "Cross-check key claims against at least two independent sources.",
            tr: "Önemli iddiaları en az iki bağımsız kaynakla çapraz kontrol et.",
          },
        },
      ],
    },
    agentProtocol: [
      {
        text: {
          en: "Plan the investigation: list the questions and where the evidence is likely to be.",
          tr: "İncelemeyi planla: soruları ve kanıtın nerede olabileceğini listele.",
        },
      },
      {
        text: {
          en: "Gather evidence iteratively; refine the questions when findings change the picture.",
          tr: "Kanıtı yinelemeli topla; bulgular tabloyu değiştirdiğinde soruları güncelle.",
        },
      },
      {
        text: {
          en: "Stop when every success criterion is met or further searching stops adding information.",
          tr: "Tüm başarı kriterleri karşılandığında veya ek arama yeni bilgi getirmediğinde dur.",
        },
      },
      {
        text: {
          en: "Deliver the output in the format described in the output contract.",
          tr: "Çıktıyı çıktı sözleşmesinde tarif edilen formatta teslim et.",
        },
      },
    ],
    defaultActions: [
      { text: { en: "Define the questions to answer", tr: "Cevaplanacak soruları tanımla" } },
      { text: { en: "Collect and evaluate the relevant evidence", tr: "İlgili kanıtları topla ve değerlendir" } },
      { text: { en: "Synthesize findings into clear conclusions", tr: "Bulguları net sonuçlara dönüştür" } },
    ],
    outputContract: [
      { text: { en: "An executive summary of the findings", tr: "Bulguların yönetici özeti" } },
      {
        text: {
          en: "Detailed findings with supporting evidence and sources",
          tr: "Destekleyici kanıt ve kaynaklarla detaylı bulgular",
        },
      },
      { text: { en: "Limitations and open questions", tr: "Sınırlılıklar ve açık sorular" } },
    ],
    successCriteria: [
      {
        text: {
          en: "Every question in scope is answered with supporting evidence",
          tr: "Kapsamdaki her soru destekleyici kanıtla cevaplanmış",
        },
      },
      {
        text: {
          en: "Facts, inferences and uncertainties are clearly separated",
          tr: "Gerçekler, çıkarımlar ve belirsizlikler net biçimde ayrılmış",
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
    },
    protocols: {},
    agentProtocol: [
      {
        text: {
          en: "Draft the composition first, then refine details, lighting and style.",
          tr: "Önce kompozisyonu kur, sonra detayları, ışığı ve stili iyileştir.",
        },
      },
      {
        text: {
          en: "Check the result against every specified element and constraint, and iterate until it matches.",
          tr: "Sonucu belirtilen her unsur ve kısıtla karşılaştır; uyana kadar yinele.",
        },
      },
    ],
    defaultActions: [],
    outputContract: [
      {
        text: {
          en: "One final visual that follows every specification above",
          tr: "Yukarıdaki tüm özelliklere uyan tek bir final görsel",
        },
      },
    ],
    successCriteria: [
      {
        text: {
          en: "Every specified subject, style element and constraint is visible in the result",
          tr: "Belirtilen her konu, stil unsuru ve kısıt sonuçta görülüyor",
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
    },
    protocols: {
      VALIDATION_PROTOCOL: [
        {
          text: {
            en: "Before finishing, check the text against the audience, tone, length and every explicit requirement.",
            tr: "Bitirmeden önce metni hedef kitle, ton, uzunluk ve her açık gereksinime göre kontrol et.",
          },
        },
        {
          text: {
            en: "Do not state facts you cannot support; mark anything that needs verification.",
            tr: "Destekleyemeyeceğin bilgileri gerçekmiş gibi yazma; doğrulama gerektirenleri işaretle.",
          },
        },
      ],
    },
    agentProtocol: [
      {
        text: {
          en: "Outline the structure before writing.",
          tr: "Yazmadan önce yapıyı taslak olarak çıkar.",
        },
      },
      {
        text: {
          en: "Write a full draft, then revise it against the requirements and success criteria.",
          tr: "Tam bir taslak yaz, sonra gereksinimlere ve başarı kriterlerine göre revize et.",
        },
      },
      {
        text: {
          en: "Deliver only the final version in the requested format.",
          tr: "Yalnızca final sürümü istenen formatta teslim et.",
        },
      },
    ],
    defaultActions: [],
    outputContract: [
      { text: { en: "The final content, ready to use", tr: "Kullanıma hazır final içerik" } },
    ],
    successCriteria: [
      {
        text: {
          en: "The content fits the intended audience, tone and format",
          tr: "İçerik hedef kitleye, tona ve formata uygun",
        },
      },
      {
        text: {
          en: "Every explicit requirement is satisfied",
          tr: "Her açık gereksinim karşılanmış",
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
    },
    protocols: {
      VALIDATION_PROTOCOL: [
        {
          text: {
            en: "Check every recommendation for feasibility, cost and risk against the stated context.",
            tr: "Her öneriyi belirtilen bağlama göre uygulanabilirlik, maliyet ve risk açısından kontrol et.",
          },
        },
      ],
    },
    agentProtocol: [
      {
        text: {
          en: "Break the problem into sub-questions and address them in order.",
          tr: "Problemi alt sorulara böl ve sırayla ele al.",
        },
      },
      {
        text: {
          en: "Compare at least two options before recommending one.",
          tr: "Birini önermeden önce en az iki seçeneği karşılaştır.",
        },
      },
      {
        text: {
          en: "Close with concrete, prioritized next steps.",
          tr: "Somut ve önceliklendirilmiş sonraki adımlarla bitir.",
        },
      },
    ],
    defaultActions: [],
    outputContract: [
      {
        text: {
          en: "A structured answer with clear recommendations",
          tr: "Net önerilerle yapılandırılmış bir cevap",
        },
      },
      {
        text: {
          en: "The reasoning and trade-offs behind each recommendation",
          tr: "Her önerinin arkasındaki gerekçe ve ödünleşimler",
        },
      },
      { text: { en: "Concrete next steps", tr: "Somut sonraki adımlar" } },
    ],
    successCriteria: [
      {
        text: {
          en: "Recommendations are specific, actionable and tied to the stated goal",
          tr: "Öneriler spesifik, uygulanabilir ve belirtilen amaca bağlı",
        },
      },
    ],
  },
};
