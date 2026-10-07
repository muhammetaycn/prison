import type { Localized } from "@/models/common";

/**
 * Templates for the local (rule-based) fallback engine. Patterns run against folded text
 * (lowercase, Turkish letters → ASCII). Used only when no AI provider is configured.
 */

export interface SignalTemplate {
  pattern: RegExp;
  text: Localized;
}

export const PROTECTED_SIGNALS: SignalTemplate[] = [
  {
    pattern: /(bozmadan|bozulmadan|bozmasin|bozma\b|without breaking|don'?t break|do not break|keep .{0,30}working)/,
    text: { en: "Existing functionality", tr: "Mevcut işlevsellik", zh: "现有功能" },
  },
  {
    pattern: /(mimari\w*\s+(degistirme|degistirmesin|bozma|koru)|mimariyi koru|mimari\w* ayni kalsin|keep the architecture|architecture (intact|unchanged)|don'?t change the architecture)/,
    text: { en: "Existing architecture", tr: "Mevcut mimari", zh: "现有架构" },
  },
  {
    pattern: /(tasarim\w*\s+(degistirme|degistirmesin|bozma|koru)|keep the (current )?design)/,
    text: { en: "Current visual design", tr: "Mevcut görsel tasarım", zh: "当前的视觉设计" },
  },
  {
    pattern: /((url|route|link)\w*\s+(degistirme|degistirmesin|bozma|koru)|keep (the )?(urls|routes))/,
    text: { en: "Existing URLs and routes", tr: "Mevcut URL'ler ve route'lar", zh: "现有的 URL 和路由" },
  },
  {
    pattern: /((veri|data)\w*\s+(kaybet|silme|silmesin|koru)|veri kaybi|data loss)/,
    text: { en: "Existing data (no data loss)", tr: "Mevcut veriler (veri kaybı olmadan)", zh: "现有数据（不丢失数据）" },
  },
];

export interface DomainHint {
  pattern: RegExp;
  domain: Localized;
  unknowns: Localized[];
  implicitRequirements: Localized[];
}

export const DOMAIN_HINTS: DomainHint[] = [
  {
    pattern: /(odeme|payment|checkout|stripe|iyzico|paytr|abonelik|subscription|sepet|cart)/,
    domain: { en: "payments", tr: "ödeme", zh: "支付" },
    unknowns: [
      { en: "Which payment provider to use (e.g. Stripe, iyzico)", tr: "Hangi ödeme sağlayıcısının kullanılacağı (ör. Stripe, iyzico)", zh: "使用哪家支付服务商（例如 Stripe、iyzico）" },
      { en: "Currencies, payment methods and refund rules", tr: "Para birimleri, ödeme yöntemleri ve iade kuralları", zh: "币种、支付方式和退款规则" },
    ],
    implicitRequirements: [
      { en: "Handle failed, cancelled and duplicate payments safely", tr: "Başarısız, iptal edilen ve mükerrer ödemeleri güvenli şekilde ele al", zh: "安全地处理失败、取消和重复的支付" },
      { en: "Never store raw card data; rely on the provider's tokenization", tr: "Ham kart verisini asla saklama; sağlayıcının tokenizasyonunu kullan", zh: "绝不存储原始银行卡数据；依赖服务商的令牌化" },
      { en: "Keep API keys and secrets out of the client and the repository", tr: "API anahtarlarını ve gizli bilgileri istemci tarafına ve repository'ye koyma", zh: "不要把 API 密钥和机密放在客户端或代码仓库中" },
      { en: "Implement idempotency keys to prevent double charges", tr: "Mükerrer tahsilatı önlemek için idempotency key uygula", zh: "实现幂等键以防止重复扣款" },
      { en: "Log every payment event with a traceable transaction ID", tr: "Her ödeme olayını izlenebilir bir işlem ID'si ile logla", zh: "用可追踪的交易 ID 记录每一个支付事件" },
    ],
  },
  {
    pattern: /(giris yap|login|auth|kayit ol|signup|sign up|oturum|sifre|password|jwt|token|session)/,
    domain: { en: "authentication", tr: "kimlik doğrulama", zh: "身份验证" },
    unknowns: [
      { en: "Authentication method (email/password, OAuth, SSO)", tr: "Kimlik doğrulama yöntemi (e-posta/şifre, OAuth, SSO)", zh: "身份验证方式（邮箱/密码、OAuth、SSO）" },
      { en: "Session duration and refresh token policy", tr: "Oturum süresi ve yenileme token politikası", zh: "会话时长和刷新令牌策略" },
    ],
    implicitRequirements: [
      { en: "Store credentials securely (hashed, never in plain text)", tr: "Kimlik bilgilerini güvenli sakla (hash'li, asla düz metin değil)", zh: "安全地存储凭据（哈希处理，绝不使用明文）" },
      { en: "Implement rate limiting on login attempts to prevent brute force", tr: "Brute force saldırılarını önlemek için giriş denemelerine rate limiting uygula", zh: "对登录尝试进行限流以防止暴力破解" },
      { en: "Invalidate tokens on password change or explicit logout", tr: "Şifre değişikliği veya açık çıkışta token'ları geçersiz kıl", zh: "在修改密码或主动登出时使令牌失效" },
    ],
  },
  {
    pattern: /(seo|google|arama motoru|search engine|indeks|index|sitemap|robots)/,
    domain: { en: "search visibility", tr: "arama görünürlüğü", zh: "搜索可见性" },
    unknowns: [{ en: "Which pages and search queries matter most", tr: "Hangi sayfaların ve arama sorgularının en önemli olduğu", zh: "哪些页面和搜索查询最重要" }],
    implicitRequirements: [
      {
        en: "Make the relevant pages indexable with meaningful titles, descriptions and clean URLs",
        tr: "İlgili sayfaları anlamlı başlık, açıklama ve temiz URL'lerle indekslenebilir yap",
        zh: "让相关页面可被索引，并具有有意义的标题、描述和简洁的 URL",
      },
      {
        en: "Use semantic HTML elements and structured data (JSON-LD) where applicable",
        tr: "Uygun yerlerde semantik HTML elemanları ve yapılandırılmış veri (JSON-LD) kullan",
        zh: "在适用的地方使用语义化 HTML 元素和结构化数据（JSON-LD）",
      },
    ],
  },
  {
    pattern: /(veritaban|database|\bsql\b|mongo|postgres|mysql|migration|sema|schema)/,
    domain: { en: "data", tr: "veri", zh: "数据" },
    unknowns: [{ en: "Database engine and current schema", tr: "Veritabanı motoru ve mevcut şema", zh: "数据库引擎和当前的模式" }],
    implicitRequirements: [
      { en: "Keep data migrations backward compatible", tr: "Veri migration'larını geriye dönük uyumlu tut", zh: "保持数据迁移向后兼容" },
      { en: "Add appropriate indexes for query performance", tr: "Sorgu performansı için uygun indeksler ekle", zh: "为查询性能添加合适的索引" },
    ],
  },
  {
    pattern: /(instagram|tiktok|linkedin|twitter|youtube|sosyal medya|social media|icerik takv|content calendar)/,
    domain: { en: "social media", tr: "sosyal medya", zh: "社交媒体" },
    unknowns: [
      { en: "Target audience and brand voice", tr: "Hedef kitle ve marka dili", zh: "目标受众和品牌语气" },
      { en: "Posting frequency and platform-specific requirements", tr: "Paylaşım sıklığı ve platforma özgü gereksinimler", zh: "发布频率和各平台的特定要求" },
    ],
    implicitRequirements: [
      { en: "Adapt content format and length to each platform's best practices", tr: "İçerik formatını ve uzunluğunu her platformun en iyi uygulamalarına göre ayarla", zh: "根据各平台的最佳实践调整内容格式和长度" },
      { en: "Include relevant hashtags and call-to-action where appropriate", tr: "Uygun yerlerde ilgili hashtag'ler ve harekete geçirici ifadeler ekle", zh: "在合适的地方加入相关话题标签和行动号召" },
    ],
  },
  {
    pattern: /(windows|macos|linux|ubuntu)/,
    domain: { en: "operating system", tr: "işletim sistemi", zh: "操作系统" },
    unknowns: [{ en: "OS version and current configuration", tr: "İşletim sistemi sürümü ve mevcut yapılandırma", zh: "操作系统版本和当前配置" }],
    implicitRequirements: [
      { en: "Explain each step clearly and warn before any irreversible change", tr: "Her adımı net açıkla ve geri alınamaz değişikliklerden önce uyar", zh: "清楚地解释每一步，并在任何不可逆改动之前发出警告" },
    ],
  },
  {
    pattern: /(gorsel|resim|image|logo|poster|illustr|banner|thumbnail)/,
    domain: { en: "visual design", tr: "görsel tasarım", zh: "视觉设计" },
    unknowns: [{ en: "Aspect ratio, dimensions and visual style", tr: "En-boy oranı, boyutlar ve görsel stil", zh: "宽高比、尺寸和视觉风格" }],
    implicitRequirements: [
      { en: "Describe the composition, colors, lighting and mood in detail", tr: "Kompozisyonu, renkleri, aydınlatmayı ve atmosferi detaylı tanımla", zh: "详细描述构图、色彩、光线和氛围" },
    ],
  },
  {
    pattern: /(api|endpoint|rest|graphql|webhook|mikroservis|microservice)/,
    domain: { en: "API development", tr: "API geliştirme", zh: "API 开发" },
    unknowns: [
      { en: "API style (REST, GraphQL, gRPC) and versioning strategy", tr: "API stili (REST, GraphQL, gRPC) ve versiyonlama stratejisi", zh: "API 风格（REST、GraphQL、gRPC）和版本策略" },
      { en: "Authentication method for API consumers", tr: "API tüketicileri için kimlik doğrulama yöntemi", zh: "API 使用者的身份验证方式" },
    ],
    implicitRequirements: [
      { en: "Return consistent error responses with meaningful status codes and messages", tr: "Anlamlı durum kodları ve mesajlarla tutarlı hata yanıtları döndür", zh: "返回一致的错误响应，带有有意义的状态码和消息" },
      { en: "Validate and sanitize all incoming data at the API boundary", tr: "API sınırında tüm gelen veriyi doğrula ve temizle", zh: "在 API 边界验证并清理所有传入数据" },
      { en: "Document each endpoint with request/response examples", tr: "Her endpoint'i istek/yanıt örnekleriyle belgele", zh: "为每个接口编写包含请求/响应示例的文档" },
    ],
  },
  {
    pattern: /(mobil|mobile|android|ios|react native|flutter|uygulama|app store|play store)/,
    domain: { en: "mobile development", tr: "mobil geliştirme", zh: "移动开发" },
    unknowns: [
      { en: "Target platforms (iOS, Android or both)", tr: "Hedef platformlar (iOS, Android veya her ikisi)", zh: "目标平台（iOS、Android 或两者）" },
      { en: "Minimum OS version to support", tr: "Desteklenecek minimum OS sürümü", zh: "需要支持的最低系统版本" },
    ],
    implicitRequirements: [
      { en: "Handle offline scenarios and poor network conditions gracefully", tr: "Çevrimdışı senaryoları ve zayıf ağ koşullarını sorunsuz ele al", zh: "妥善处理离线场景和较差的网络状况" },
      { en: "Respect platform-specific UI conventions and guidelines", tr: "Platforma özgü arayüz kurallarına ve kılavuzlarına uy", zh: "遵循各平台特定的界面规范和指南" },
    ],
  },
  {
    pattern: /(e-?ticaret|e-?commerce|urun|product|magaza|shop|stok|inventory|siparis|order)/,
    domain: { en: "e-commerce", tr: "e-ticaret", zh: "电子商务" },
    unknowns: [
      { en: "Product catalog size and category structure", tr: "Ürün kataloğu büyüklüğü ve kategori yapısı", zh: "商品目录规模和分类结构" },
      { en: "Shipping, tax and currency rules", tr: "Kargo, vergi ve para birimi kuralları", zh: "运费、税费和币种规则" },
    ],
    implicitRequirements: [
      { en: "Keep stock counts accurate under concurrent purchases", tr: "Eşzamanlı satın alımlarda stok sayılarını doğru tut", zh: "在并发购买时保持库存数量准确" },
      { en: "Protect user data and order history from unauthorized access", tr: "Kullanıcı verilerini ve sipariş geçmişini yetkisiz erişime karşı koru", zh: "防止用户数据和订单历史被未授权访问" },
      { en: "Handle edge cases: out-of-stock, partial shipment, order cancellation", tr: "Uç durumları ele al: stokta yok, kısmi kargo, sipariş iptali", zh: "处理边界情况：缺货、部分发货、订单取消" },
    ],
  },
  {
    pattern: /(email|e-?posta|bildirim|notification|push|sms|mesaj gonder)/,
    domain: { en: "notifications", tr: "bildirimler", zh: "通知" },
    unknowns: [
      { en: "Notification channels (email, SMS, push) and providers", tr: "Bildirim kanalları (e-posta, SMS, push) ve sağlayıcılar", zh: "通知渠道（邮件、短信、推送）和服务商" },
    ],
    implicitRequirements: [
      { en: "Use templates for notification content; never hardcode text in business logic", tr: "Bildirim içeriği için şablon kullan; iş mantığına düz metin gömme", zh: "使用模板管理通知内容；绝不在业务逻辑中硬编码文本" },
      { en: "Allow users to manage their notification preferences", tr: "Kullanıcıların bildirim tercihlerini yönetmelerine izin ver", zh: "允许用户管理自己的通知偏好" },
      { en: "Implement retry logic with exponential backoff for failed deliveries", tr: "Başarısız gönderimlerde üstel geri çekilmeli yeniden deneme mantığı uygula", zh: "为发送失败的通知实现带指数退避的重试逻辑" },
    ],
  },
  {
    pattern: /(test|unit test|integration test|e2e|selenium|cypress|playwright|jest|vitest|qa)/,
    domain: { en: "testing", tr: "test", zh: "测试" },
    unknowns: [
      { en: "Test framework and runner in use", tr: "Kullanılan test framework'ü ve çalıştırıcısı", zh: "所使用的测试框架和运行器" },
      { en: "Current test coverage and CI pipeline", tr: "Mevcut test kapsamı ve CI pipeline'ı", zh: "当前的测试覆盖率和 CI 流水线" },
    ],
    implicitRequirements: [
      { en: "Write tests that are deterministic, isolated and readable", tr: "Belirleyici, izole ve okunabilir testler yaz", zh: "编写确定性、相互隔离且易读的测试" },
      { en: "Cover both happy path and error scenarios", tr: "Hem başarılı akışı hem hata senaryolarını kapsa", zh: "同时覆盖正常路径和错误场景" },
    ],
  },
  {
    pattern: /(performans|performance|hiz|speed|optimize|cache|caching|lazy|bundle size|lighthouse)/,
    domain: { en: "performance", tr: "performans", zh: "性能" },
    unknowns: [
      { en: "Current performance baseline and bottlenecks", tr: "Mevcut performans başlangıç noktası ve darboğazlar", zh: "当前的性能基线和瓶颈" },
    ],
    implicitRequirements: [
      { en: "Measure before and after each optimization to confirm improvement", tr: "Her optimizasyon öncesi ve sonrası ölçüm yaparak iyileşmeyi doğrula", zh: "每次优化前后都要测量，以确认确有改进" },
      { en: "Ensure optimizations do not break existing functionality", tr: "Optimizasyonların mevcut işlevselliği bozmadığından emin ol", zh: "确保优化不会破坏现有功能" },
    ],
  },
  {
    pattern: /(guvenlik|security|xss|csrf|injection|owasp|firewall|encrypt|sifrele)/,
    domain: { en: "security", tr: "güvenlik", zh: "安全" },
    unknowns: [
      { en: "Current security posture and known vulnerabilities", tr: "Mevcut güvenlik durumu ve bilinen güvenlik açıkları", zh: "当前的安全状况和已知漏洞" },
    ],
    implicitRequirements: [
      { en: "Follow OWASP top 10 guidelines for the relevant category", tr: "İlgili kategori için OWASP ilk 10 kurallarına uy", zh: "针对相关类别遵循 OWASP Top 10 指南" },
      { en: "Sanitize all user input and encode output to prevent injection attacks", tr: "Injection saldırılarını önlemek için tüm kullanıcı girdisini temizle ve çıktıyı kodla", zh: "清理所有用户输入并对输出进行编码，以防止注入攻击" },
      { en: "Never log sensitive data (passwords, tokens, personal information)", tr: "Hassas verileri (şifreler, token'lar, kişisel bilgiler) asla loglama", zh: "绝不记录敏感数据（密码、令牌、个人信息）" },
    ],
  },
  {
    pattern: /(otomasyon|automation|cron|zamanla|schedule|pipeline|ci\/?cd|github action|workflow)/,
    domain: { en: "automation", tr: "otomasyon", zh: "自动化" },
    unknowns: [
      { en: "Trigger conditions and execution schedule", tr: "Tetikleme koşulları ve çalışma zamanlaması", zh: "触发条件和执行计划" },
    ],
    implicitRequirements: [
      { en: "Handle failures gracefully with logging and optional retry", tr: "Hataları loglama ve isteğe bağlı yeniden deneme ile sorunsuz ele al", zh: "通过日志和可选的重试来妥善处理失败" },
      { en: "Make the automation idempotent so re-runs are safe", tr: "Otomasyonu idempotent yap, böylece tekrar çalıştırmalar güvenli olsun", zh: "让自动化具备幂等性，以便重复运行时保持安全" },
    ],
  },
];

export const STACK_PATTERN =
  /\b(react native|react|next\.?js|vue|nuxt|angular|svelte|django|flask|fastapi|laravel|symfony|rails|spring|express|nestjs|flutter|wordpress|shopify|supabase|firebase|node\.?js|typescript|python|php|golang|rust|kotlin|swift|tailwind|prisma|postgres|mysql|mongodb)\b/g;

export const LOCAL_TEXT = {
  mentionedTech: { en: "Mentioned technology: {tech}", tr: "Bahsedilen teknoloji: {tech}", zh: "提到的技术：{tech}" },
  contextExisting: {
    en: "The work concerns an existing system that must keep working while the task is done (area: {domain}).",
    tr: "İş, görev sırasında çalışmaya devam etmesi gereken mevcut bir sistem üzerinde (alan: {domain}).",
    zh: "这项工作涉及一个现有系统，在完成任务的同时它必须继续正常工作（领域：{domain}）。",
  },
  contextNew: {
    en: "The work starts a new system from scratch (area: {domain}).",
    tr: "İş, sıfırdan yeni bir sistem kuruyor (alan: {domain}).",
    zh: "这项工作从零开始构建一个新系统（领域：{domain}）。",
  },
  conflictRewrite: {
    en: "The request asks to keep the existing system intact but also mentions rewriting it from scratch",
    tr: "İstek mevcut sistemi korumayı isterken sıfırdan yeniden yazmaktan da bahsediyor",
    zh: "需求既要求保持现有系统完好，又提到要从头重写",
  },
} satisfies Record<string, Localized>;
