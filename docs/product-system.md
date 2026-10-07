# PRISON ürün sistemi

[English](product-system.en.md) · [简体中文](product-system.zh-CN.md) · **Türkçe**

PRISON, kişinin bir isteğini seçtiği AI'da kullanabileceği net bir görev promptuna dönüştürür.
Masa ve arena bu çalışmayı anlaşılır bir sahnede anlatır. Kullanıcının değeri, hedefinin ve
sınırlarının korunmasından, önerileri kontrol edebilmesinden ve sonucu geliştirebilmesinden gelir.

## Kullanıcı neyi yönetir?

| Müdahale | Gerçek etkisi |
| --- | --- |
| Hedef, değişmeyecek sınırlar, çıktı biçimi | Analize ve prompt sözleşmesine girer. |
| Eksik bilgi sorularına yanıt | Görev planını ve sonraki promptu günceller. |
| API bağlantısı, model, uzmanlık ve derinlik | Yeni üretimin analiz/inceleme ekibini belirler. |
| Karakter ve hareket komutu | Seçilen karakterin eklemlerini oynatır; izleme duraklar. |
| Promptu başka AI'da deneme | Promptun kullanıcı hedefi açısından işe yararlılığını sınar. |
| Alınan sonuca dair geri bildirim | Gerçek revizyon işlemiyle sonraki sürümü üretir. |

Hareketler oy, puan veya kazanan üretmez. Jüri durumu yalnızca kaydedilmiş model değerlendirmesine
dayanır. Kullanıcı talimatı ile gösteri arasındaki ayrım arayüzde kısa bir cümleyle açıklanır.

## Öğrenme ve ilgi

İstek ekranı hedef/sınır/çıktı ipuçları sunar; düğmeler görünür metni değiştirdiği için kişi
promptu nasıl şekillendirdiğini görür. Plan aşaması eksik bağlamı tamamlama fırsatı verir.
Kaydedilmiş adaylar ve eleştiriler hangi önerinin neden değiştiğini gösterir. Sonuç ekranı
tam metni kopyalama, hedef AI'da deneme ve geri bildirim verme adımını görünür kılar.

Rehberler kapatılabilir ve ilgili aşamada gösterilir. Başarısız kayıt hazır prompt olarak
tanıtılmaz; yalnızca inceleme ve yeniden deneme yolu sunulur. Yerel motor, tek model ve gerçek
çoklu model çalışması kendi kanıtına göre anlatılır. AI duyguları, düşünce izi veya başarı
garantisi uydurulmaz. Kullanıcının kontrolü ve ilerlemesi görünürdür; gizli baskı, sahte başarı
ya da devam etmediği için kayıp hissi veren ödül sistemi kullanılmaz.

## Kişisel AI ekibi

Bir bağlantı sağlayıcı türü, HTTPS adresi ve sunucuda saklanan anahtardan oluşur. Model seçimi
bağlantı kimliğiyle birlikte tutulur. Analiz modeli ile promptu kullanacak hedef AI farklı
kavramlardır. Masa 3–6 ayrı modelden oluşur; aynı modelin kopyaları bağımsız görüş sayılmaz.
Uzmanlık, o modelin inceleme bakış açısını belirler.

Destek: NVIDIA, DeepSeek, OpenAI Responses, Anthropic yapılandırılmış çıktı ve OpenAI uyumlu
Chat Completions JSON. Model erişimi ön kontrolde sınanır; yeterli katılım yoksa çalışma anlaşılır
bir hata verir. Kayıtlı ekibe kullanıcının seçmediği bir yedek model eklenmez. Ayar kaydı devam
eden işlemi değiştirmez. Revizyon çakışması formu korur ve güncel kayıt yükleme seçeneği sunar.

Anahtarlar sunucu dosyasındadır; dosya şifrelenmez. Anahtar DTO'da, tarayıcı taslağında ve hata
mesajında bulunmaz. API adresi değişince önceki anahtar otomatik aktarılmaz. Kaydetme uzaktan
üretim yapmaz; yalnızca sonraki işlemin ayarlarını değiştirir.

## Hareket ve ekipman

`gesture-library.ts`, beş grupta 50 farklı çoklu anahtar kare klibi içerir: selamlama,
düşünme jestleri, anlatım, tepki ve dinlenme. Klipler gövde, baş, kanat, bacak ve kuyruk
eklemlerine sınırlı açı/hareket uygular. Her klip nötr duruşla başlar ve biter. Oturma,
eşya taşıma ve hareket azaltma tercihleri uygulanır.

`scene.ts` gerçek olaydan sonra karaktere göre klip seçer. Seçim kayıtta tekrar edilebilir,
aynı karakterin önceki klibini hemen tekrarlamaz. Kullanıcı komutu sahnedeki `playGesture`
üzerinden çalışır; arayüz önce görsel eylemi temizleyip izlemeyi duraklatır ve sahneyi gösterir.
Kamera klipten önce seçilen karakteri kadraja alır; alt yazı bu eylemi kullanıcının hareket
isteği olarak adlandırır. Hareket azaltma tercihinde kamera değişmez. Bu sırada sunucu işlemi
sürer. `gesture-director.ts` gelecekte kuyruk/öncelik yönetiminde
kullanılabilecek test edilmiş yardımcıdır; mevcut sahneye bağlı değildir.

Ekipman kanat/elde veya sırtta taşınır; rig bağlantısını izler. Silahın anlattığı şey jüri
ölçütüdür: amaç uyumu, bağlam bütünlüğü, sınırların netliği, uygulama netliği, çıktı netliği
ve hedef AI uyumu. Sahne rozetlerinde emoji ekipman listesi yoktur. Ödül veya satın alma
işlemi uygulanmış gibi gösterilmez.

Yeni klip aynı katalogda benzersiz kimlik, kategori, süre ve anahtar karelerle eklenir;
hareket seçimi listesi otomatik büyür. Yeni klip nötr uçlar, sonlu/sınırlı eklem değerleri,
oturma ve dolu kanat kurallarından geçmelidir.
