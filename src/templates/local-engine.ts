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
    text: { en: "Existing functionality", tr: "Mevcut işlevsellik" },
  },
  {
    pattern: /(mimari\w*\s+(degistirme|degistirmesin|bozma|koru)|mimariyi koru|mimari\w* ayni kalsin|keep the architecture|architecture (intact|unchanged)|don'?t change the architecture)/,
    text: { en: "Existing architecture", tr: "Mevcut mimari" },
  },
  {
    pattern: /(tasarim\w*\s+(degistirme|degistirmesin|bozma|koru)|keep the (current )?design)/,
    text: { en: "Current visual design", tr: "Mevcut görsel tasarım" },
  },
  {
    pattern: /((url|route|link)\w*\s+(degistirme|degistirmesin|bozma|koru)|keep (the )?(urls|routes))/,
    text: { en: "Existing URLs and routes", tr: "Mevcut URL'ler ve route'lar" },
  },
  {
    pattern: /((veri|data)\w*\s+(kaybet|silme|silmesin|koru)|veri kaybi|data loss)/,
    text: { en: "Existing data (no data loss)", tr: "Mevcut veriler (veri kaybı olmadan)" },
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
    domain: { en: "payments", tr: "ödeme" },
    unknowns: [
      { en: "Which payment provider to use (e.g. Stripe, iyzico)", tr: "Hangi ödeme sağlayıcısının kullanılacağı (ör. Stripe, iyzico)" },
      { en: "Currencies, payment methods and refund rules", tr: "Para birimleri, ödeme yöntemleri ve iade kuralları" },
    ],
    implicitRequirements: [
      { en: "Handle failed, cancelled and duplicate payments safely", tr: "Başarısız, iptal edilen ve mükerrer ödemeleri güvenli şekilde ele al" },
      { en: "Never store raw card data; rely on the provider's tokenization", tr: "Ham kart verisini asla saklama; sağlayıcının tokenizasyonunu kullan" },
      { en: "Keep API keys and secrets out of the client and the repository", tr: "API anahtarlarını ve gizli bilgileri istemci tarafına ve repository'ye koyma" },
      { en: "Implement idempotency keys to prevent double charges", tr: "Mükerrer tahsilatı önlemek için idempotency key uygula" },
      { en: "Log every payment event with a traceable transaction ID", tr: "Her ödeme olayını izlenebilir bir işlem ID'si ile logla" },
    ],
  },
  {
    pattern: /(giris yap|login|auth|kayit ol|signup|sign up|oturum|sifre|password|jwt|token|session)/,
    domain: { en: "authentication", tr: "kimlik doğrulama" },
    unknowns: [
      { en: "Authentication method (email/password, OAuth, SSO)", tr: "Kimlik doğrulama yöntemi (e-posta/şifre, OAuth, SSO)" },
      { en: "Session duration and refresh token policy", tr: "Oturum süresi ve yenileme token politikası" },
    ],
    implicitRequirements: [
      { en: "Store credentials securely (hashed, never in plain text)", tr: "Kimlik bilgilerini güvenli sakla (hash'li, asla düz metin değil)" },
      { en: "Implement rate limiting on login attempts to prevent brute force", tr: "Brute force saldırılarını önlemek için giriş denemelerine rate limiting uygula" },
      { en: "Invalidate tokens on password change or explicit logout", tr: "Şifre değişikliği veya açık çıkışta token'ları geçersiz kıl" },
    ],
  },
  {
    pattern: /(seo|google|arama motoru|search engine|indeks|index|sitemap|robots)/,
    domain: { en: "search visibility", tr: "arama görünürlüğü" },
    unknowns: [{ en: "Which pages and search queries matter most", tr: "Hangi sayfaların ve arama sorgularının en önemli olduğu" }],
    implicitRequirements: [
      {
        en: "Make the relevant pages indexable with meaningful titles, descriptions and clean URLs",
        tr: "İlgili sayfaları anlamlı başlık, açıklama ve temiz URL'lerle indekslenebilir yap",
      },
      {
        en: "Use semantic HTML elements and structured data (JSON-LD) where applicable",
        tr: "Uygun yerlerde semantik HTML elemanları ve yapılandırılmış veri (JSON-LD) kullan",
      },
    ],
  },
  {
    pattern: /(veritaban|database|\bsql\b|mongo|postgres|mysql|migration|sema|schema)/,
    domain: { en: "data", tr: "veri" },
    unknowns: [{ en: "Database engine and current schema", tr: "Veritabanı motoru ve mevcut şema" }],
    implicitRequirements: [
      { en: "Keep data migrations backward compatible", tr: "Veri migration'larını geriye dönük uyumlu tut" },
      { en: "Add appropriate indexes for query performance", tr: "Sorgu performansı için uygun indeksler ekle" },
    ],
  },
  {
    pattern: /(instagram|tiktok|linkedin|twitter|youtube|sosyal medya|social media|icerik takv|content calendar)/,
    domain: { en: "social media", tr: "sosyal medya" },
    unknowns: [
      { en: "Target audience and brand voice", tr: "Hedef kitle ve marka dili" },
      { en: "Posting frequency and platform-specific requirements", tr: "Paylaşım sıklığı ve platforma özgü gereksinimler" },
    ],
    implicitRequirements: [
      { en: "Adapt content format and length to each platform's best practices", tr: "İçerik formatını ve uzunluğunu her platformun en iyi uygulamalarına göre ayarla" },
      { en: "Include relevant hashtags and call-to-action where appropriate", tr: "Uygun yerlerde ilgili hashtag'ler ve harekete geçirici ifadeler ekle" },
    ],
  },
  {
    pattern: /(windows|macos|linux|ubuntu)/,
    domain: { en: "operating system", tr: "işletim sistemi" },
    unknowns: [{ en: "OS version and current configuration", tr: "İşletim sistemi sürümü ve mevcut yapılandırma" }],
    implicitRequirements: [
      { en: "Explain each step clearly and warn before any irreversible change", tr: "Her adımı net açıkla ve geri alınamaz değişikliklerden önce uyar" },
    ],
  },
  {
    pattern: /(gorsel|resim|image|logo|poster|illustr|banner|thumbnail)/,
    domain: { en: "visual design", tr: "görsel tasarım" },
    unknowns: [{ en: "Aspect ratio, dimensions and visual style", tr: "En-boy oranı, boyutlar ve görsel stil" }],
    implicitRequirements: [
      { en: "Describe the composition, colors, lighting and mood in detail", tr: "Kompozisyonu, renkleri, aydınlatmayı ve atmosferi detaylı tanımla" },
    ],
  },
  {
    pattern: /(api|endpoint|rest|graphql|webhook|mikroservis|microservice)/,
    domain: { en: "API development", tr: "API geliştirme" },
    unknowns: [
      { en: "API style (REST, GraphQL, gRPC) and versioning strategy", tr: "API stili (REST, GraphQL, gRPC) ve versiyonlama stratejisi" },
      { en: "Authentication method for API consumers", tr: "API tüketicileri için kimlik doğrulama yöntemi" },
    ],
    implicitRequirements: [
      { en: "Return consistent error responses with meaningful status codes and messages", tr: "Anlamlı durum kodları ve mesajlarla tutarlı hata yanıtları döndür" },
      { en: "Validate and sanitize all incoming data at the API boundary", tr: "API sınırında tüm gelen veriyi doğrula ve temizle" },
      { en: "Document each endpoint with request/response examples", tr: "Her endpoint'i istek/yanıt örnekleriyle belgele" },
    ],
  },
  {
    pattern: /(mobil|mobile|android|ios|react native|flutter|uygulama|app store|play store)/,
    domain: { en: "mobile development", tr: "mobil geliştirme" },
    unknowns: [
      { en: "Target platforms (iOS, Android or both)", tr: "Hedef platformlar (iOS, Android veya her ikisi)" },
      { en: "Minimum OS version to support", tr: "Desteklenecek minimum OS sürümü" },
    ],
    implicitRequirements: [
      { en: "Handle offline scenarios and poor network conditions gracefully", tr: "Çevrimdışı senaryoları ve zayıf ağ koşullarını sorunsuz ele al" },
      { en: "Respect platform-specific UI conventions and guidelines", tr: "Platforma özgü arayüz kurallarına ve kılavuzlarına uy" },
    ],
  },
  {
    pattern: /(e-?ticaret|e-?commerce|urun|product|magaza|shop|stok|inventory|siparis|order)/,
    domain: { en: "e-commerce", tr: "e-ticaret" },
    unknowns: [
      { en: "Product catalog size and category structure", tr: "Ürün kataloğu büyüklüğü ve kategori yapısı" },
      { en: "Shipping, tax and currency rules", tr: "Kargo, vergi ve para birimi kuralları" },
    ],
    implicitRequirements: [
      { en: "Keep stock counts accurate under concurrent purchases", tr: "Eşzamanlı satın alımlarda stok sayılarını doğru tut" },
      { en: "Protect user data and order history from unauthorized access", tr: "Kullanıcı verilerini ve sipariş geçmişini yetkisiz erişime karşı koru" },
      { en: "Handle edge cases: out-of-stock, partial shipment, order cancellation", tr: "Uç durumları ele al: stokta yok, kısmi kargo, sipariş iptali" },
    ],
  },
  {
    pattern: /(email|e-?posta|bildirim|notification|push|sms|mesaj gonder)/,
    domain: { en: "notifications", tr: "bildirimler" },
    unknowns: [
      { en: "Notification channels (email, SMS, push) and providers", tr: "Bildirim kanalları (e-posta, SMS, push) ve sağlayıcılar" },
    ],
    implicitRequirements: [
      { en: "Use templates for notification content; never hardcode text in business logic", tr: "Bildirim içeriği için şablon kullan; iş mantığına düz metin gömme" },
      { en: "Allow users to manage their notification preferences", tr: "Kullanıcıların bildirim tercihlerini yönetmelerine izin ver" },
      { en: "Implement retry logic with exponential backoff for failed deliveries", tr: "Başarısız gönderimlerde üstel geri çekilmeli yeniden deneme mantığı uygula" },
    ],
  },
  {
    pattern: /(test|unit test|integration test|e2e|selenium|cypress|playwright|jest|vitest|qa)/,
    domain: { en: "testing", tr: "test" },
    unknowns: [
      { en: "Test framework and runner in use", tr: "Kullanılan test framework'ü ve çalıştırıcısı" },
      { en: "Current test coverage and CI pipeline", tr: "Mevcut test kapsamı ve CI pipeline'ı" },
    ],
    implicitRequirements: [
      { en: "Write tests that are deterministic, isolated and readable", tr: "Belirleyici, izole ve okunabilir testler yaz" },
      { en: "Cover both happy path and error scenarios", tr: "Hem başarılı akışı hem hata senaryolarını kapsa" },
    ],
  },
  {
    pattern: /(performans|performance|hiz|speed|optimize|cache|caching|lazy|bundle size|lighthouse)/,
    domain: { en: "performance", tr: "performans" },
    unknowns: [
      { en: "Current performance baseline and bottlenecks", tr: "Mevcut performans başlangıç noktası ve darboğazlar" },
    ],
    implicitRequirements: [
      { en: "Measure before and after each optimization to confirm improvement", tr: "Her optimizasyon öncesi ve sonrası ölçüm yaparak iyileşmeyi doğrula" },
      { en: "Ensure optimizations do not break existing functionality", tr: "Optimizasyonların mevcut işlevselliği bozmadığından emin ol" },
    ],
  },
  {
    pattern: /(guvenlik|security|xss|csrf|injection|owasp|firewall|encrypt|sifrele)/,
    domain: { en: "security", tr: "güvenlik" },
    unknowns: [
      { en: "Current security posture and known vulnerabilities", tr: "Mevcut güvenlik durumu ve bilinen güvenlik açıkları" },
    ],
    implicitRequirements: [
      { en: "Follow OWASP top 10 guidelines for the relevant category", tr: "İlgili kategori için OWASP ilk 10 kurallarına uy" },
      { en: "Sanitize all user input and encode output to prevent injection attacks", tr: "Injection saldırılarını önlemek için tüm kullanıcı girdisini temizle ve çıktıyı kodla" },
      { en: "Never log sensitive data (passwords, tokens, personal information)", tr: "Hassas verileri (şifreler, token'lar, kişisel bilgiler) asla loglama" },
    ],
  },
  {
    pattern: /(otomasyon|automation|cron|zamanla|schedule|pipeline|ci\/?cd|github action|workflow)/,
    domain: { en: "automation", tr: "otomasyon" },
    unknowns: [
      { en: "Trigger conditions and execution schedule", tr: "Tetikleme koşulları ve çalışma zamanlaması" },
    ],
    implicitRequirements: [
      { en: "Handle failures gracefully with logging and optional retry", tr: "Hataları loglama ve isteğe bağlı yeniden deneme ile sorunsuz ele al" },
      { en: "Make the automation idempotent so re-runs are safe", tr: "Otomasyonu idempotent yap, böylece tekrar çalıştırmalar güvenli olsun" },
    ],
  },
];

export const STACK_PATTERN =
  /\b(react native|react|next\.?js|vue|nuxt|angular|svelte|django|flask|fastapi|laravel|symfony|rails|spring|express|nestjs|flutter|wordpress|shopify|supabase|firebase|node\.?js|typescript|python|php|golang|rust|kotlin|swift|tailwind|prisma|postgres|mysql|mongodb)\b/g;

export const LOCAL_TEXT = {
  mentionedTech: { en: "Mentioned technology: {tech}", tr: "Bahsedilen teknoloji: {tech}" },
  contextExisting: {
    en: "The work concerns an existing system that must keep working while the task is done (area: {domain}).",
    tr: "İş, görev sırasında çalışmaya devam etmesi gereken mevcut bir sistem üzerinde (alan: {domain}).",
  },
  contextNew: {
    en: "The work starts a new system from scratch (area: {domain}).",
    tr: "İş, sıfırdan yeni bir sistem kuruyor (alan: {domain}).",
  },
  conflictRewrite: {
    en: "The request asks to keep the existing system intact but also mentions rewriting it from scratch",
    tr: "İstek mevcut sistemi korumayı isterken sıfırdan yeniden yazmaktan da bahsediyor",
  },
} satisfies Record<string, Localized>;
