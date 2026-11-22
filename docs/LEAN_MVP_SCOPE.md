# PaperMorning — Lean MVP Scope (24 Kasım 2026)

> **Ürün sahibinin son kararları / Claude Code'a aktarılacak P0 sınırı.**  
> Mimari ve teknoloji seçiminin nihai onayı proje sahibine aittir. Bu belge kapsamı bilerek küçük tutar. Diğer belgelerde çelişki varsa bu güncel MVP sınırı önceliklidir.

## Ürünün tamamı, kısa tanım

Kullanıcı self-hosted bir PaperMorning kurulumu üzerinde **kayıt olur**, konuları için **öncelik** ve **bilgi seviyesi** seçer. Akademik makaleler deterministik ağırlıklı bir pipeline ile toplanır ve ortak olarak analiz edilir. Her kullanıcının ayrı bir günlük bilim dergisi **web arayüzünde ve PDF olarak saklanır**, her sabah kendi saat diliminde **08.00'de e-posta** ile gönderilir. Kullanıcılar yazıları **beğenebilir / beğenmeyebilir**. **Her sayının en sonundaki Ufuk Raporu**, seçilen makaleleri sentezleyip araştırılabilecek akademik sorular, denenebilecek sektörel pilotlar ve gerekçeli gelişim öngörüleri üretir.

## P0 — Yapılacaklar (yalın)

1. **Self-hosted web uygulaması.** Bir kurulumda birden fazla kullanıcı; minimum sayfalar: kayıt/giriş, ilgi alanı ayarları, bugünkü sayı, geçmiş sayılar, yazı detayı. Ayrı mobil uygulama yok. Kurulum merkezi PaperMorning hizmetini gerektirmiyor.
2. **Basit authentication.** E-posta + parola, sağlam parola hash'i, **tek 3 saat ömürlü oturum/token**, güvenli cookie; **refresh token veya token yenileme akışı YOK**. Süre bitince yeniden giriş. Çıkış oturum cookie'sini temizler. Basit hız sınırı ve kullanıcı-veri izolasyonu zorunlu. Tam IAM, OAuth, RBAC hiyerarşisi ve ayrı auth servisi yok.
3. **Minimum e-posta güvenliği.** Kullanıcı e-posta teslimi almadan önce adresinin kendisine ait olduğunu doğrular (tek kullanımlık basit doğrulama bağlantısı yeterli). P0'da kapsamlı parola sıfırlama, MFA, cihaz yönetimi şart değil. Kayıtları açıp kapatabilme veya davet sınırı, kurulum sahibini kontrolsüz API harcamasından korumak için yeterlidir.
4. **Kişiselleştirme.** Konular + her konu için birbirinden bağımsız **öncelik (düşük/orta/yüksek)** ve **bilgi seviyesi (başlangıç/orta/ileri)**. Kullanıcının saat dilimi; 08.00 varsayılan gönderim saati; e-posta açık/kapalı seçeneği.
5. **Makaleler ve Claude API.** Kaynak çekme, tekrar temizleme, basit kurallarla filtreleme, zamanlama, depolama, e-posta/PDF üretimi deterministik. Claude yalnızca anlamsal değerlendirme / bilimsel analiz / yazma gerektiren yerde.
6. **Göreve göre model yönlendirmesi (sabit ve denetlenebilir).** **Haiku**: ucuz anlamsal ön eleme, basit sınıflandırma veya kısa çıkarım. **Sonnet**: seçilen çalışmaların esas analizi ve yazarlığı. **Opus**: **varsayılan olarak kapalı / nadir**; yalnızca Sonnet sonucunun kabul edilemez olduğu açıkça işaretlenmiş güç durumlarda, kurulum sahibinin açtığı sınırlı eskalasyon. **Her aşama Opus'a otomatik yükselmez.** Model ID'leri konfigürasyonda ve güncellenebilir olmalı.
7. **Ortak maliyet tasarrufu.** Bir bilimsel makalenin aynı sürümü için analiz mümkün olduğunca **bir kez** yapılır ve tüm hesaplar kullanır; aynı dil ve bilgi düzeyindeki yazı varyantı tekrar kullanılabilir. Kullanıcının seçkisi/dizimi kişiye özeldir. Her kullanıcı için baştan sona bağımsız LLM çalıştırılmaz. Günlük çağrı/token/maliyet sayacı ve basit harcama sınırı.
8. **Arşiv.** Gönderilen günlük sayıların **oluşturulduğu son hali** saklanır: okunan web içeriği, PDF dosyası, tarih, sahip olan kullanıcı, kullanılan makale kaynakları ve e-posta gönderim durumu. Sonradan prompt/model değişti diye eski sayıyı sessizce yeniden yazmayız. Kullanıcı yalnızca **kendi özel sayısını** görür.
9. **Geri bildirim.** Her yazıda **👍 / 👎**, kullanıcı başına yazı için tek aktif oy; değiştirebilir. İsteğe bağlı sayı genel değerlendirmesi sonraya kalabilir. Oylar veritabanına kaydedilir; P0'da LLM eğitimi veya karmaşık tavsiye algoritması yok. İleride kullanıcının konu tercihlerini iyileştirmek için değerlendirilebilir.
10. **Günlük gönderim.** PDF ve yazılar 08.00'den **önce** hazırlanır. E-postanın gövdesinde haber başlıkları ve okunabilir kısa özetler, kaynaklar ve kişinin özel web/PDF bağlantısı bulunur. PDF eki küçükse gönderilebilir ama **zorunlu değil**. Gönderim kaydı tutulur; iki kez tıklama/yeniden çalıştırma çift sayı oluşturmamalı. SMTP/posta sağlayıcısı self-hosting kurulum sahibinin sorumluluğundadır.
11. **Demo.** İki hesapla farklı ilgi alanları, aynı makalenin ortak analizi, web/PDF arşivi, 👍/👎 kaydı, 3 saatlik token süresi politikası, Haiku/Sonnet ayrımı ve **gerçek test e-postası** gösterilebilmeli. Otomatik 08.00 çalışması testi manuel olarak tetiklenebilmeli.

12. **Ufuk Raporu — en değerli kapanış bölümü.** Her günlük sayının **en sonunda** (web, PDF ve arşivde) ayrı editoryal bölüm: (a) o sayıdaki araştırmaların ortak sonucu, (b) **akademik olarak araştırılabilecek** somut soru/hipotez ve ilk deney, (c) **sektörde denenebilecek** pilot/prototip ve neyi ölçmek gerektiği, (d) gelişim potansiyeli ile engeller/belirsizlikler, (e) **bir sonraki adım**. Özgün makale kanıtı, PaperMorning yorumu ve öneri **ayrı etiketlenir**. E-postada en önemli bir fikirle tam bölüme bağlantı verilir. Bölüm için 👍/👎 P0 kapsamındadır. Uydurulmuş fırsat eklenmez; kanıt yoksa dürüstçe belirtilir. Mevcut ortak analizleri kullansın, gereksiz yeniden PDF okuma ve Opus çağrısı olmasın. Ayrıntı: [OUTLOOK_AND_OPPORTUNITIES.md](OUTLOOK_AND_OPPORTUNITIES.md).

## P0 DEĞİL — Claude Code'un kendiliğinden eklememesi gerekenler

Refresh token, uzun oturum yönetimi, SSO/OAuth, MFA, kurumsal IAM, özel rol hiyerarşisi, ekip/organizasyon yapıları, çoklu servis/mikroservis, Kubernetes, Redis, mesaj kuyruğu, ayrı analitik dashboard, karmaşık feedback/ML öğrenme döngüsü, sosyal ağ, ödeme/abonelik, mobil uygulama, ileri sayfa tasarım editörü, binlerce kullanıcı optimizasyonu, ağır CI/CD/platform engineering, kapsamlı parola kurtarma akışları.

## Basitlik ≠ güvensizlik

- Token 3 saat yaşar, **refresh edilmez**; süresi dolunca yeniden giriş.
- Parola hash'i, güvenli oturum cookie'si, erişim kontrolü ve temel login rate limit **kırpılmamalıdır**.
- Stateles token tercih edilirse logout cookie'yi siler; ele geçirilmiş tokenın erken iptali garantisi yoktur. Bu MVP trade-off'u açıkça bilinmelidir.
- Kullanıcı başkasının PDF'ine veya arşivine erişemez; dosya tahmin edilebilir public URL olarak sunulamaz.
- Herkese açık kayıt kurulum sahibinin bütçesine risk yaratır; kayıt politikası veya kota şart.

## Minimal veri kavramları (lojik; DB şeması onayı değil)

- `User` / `TopicPreference`
- `Paper` / `Analysis` / gerekirse `ArticleVariant`
- `Issue` (kullanıcı, tarih, **arşivlenmiş içerik/PDF**)
- `ArticleFeedback` (user, article, +1/-1)
- `EmailDelivery` (user, issue, durum, deneme zamanı)

## Mimari sahibi için sade seçenekler (karar verilmedi)

Tek deploy edilen **modüler monolit**, tek kalıcı veri deposu, yerel/dış volume'de PDF arşivi, minimum zamanlanmış iş ve konfigüre edilebilir SMTP/Claude entegrasyonu makul bir başlangıçtır. Framework, SQLite/PostgreSQL seçimi, cron/worker modeli, PDF render yöntemi ve deployment biçimi proje sahibinin onayına bırakılmıştır.

## Kabul ölçütü

**Bir kurulum, iki kullanıcı, iki farklı kişisel sayı, ortak bilimsel analiz, güvenli üç saatlik giriş, geçmiş PDF'ler, yazı beğenme/beğenmeme, her sayının sonundaki kaynaklı akademik/sektörel Ufuk Raporu, Haiku/Sonnet çağrı kayıtları ve gerçek e-posta.** Bunları yapmadan yeni altyapı inşa etmeyelim.

---

Bu belge **kapsam ve sadelik sınırıdır**; "mimarinin tüm ayrıntılarını Claude Code seçsin" yetkisi vermez. Mimari proje sahibince onaylandıktan sonra implementation için kullanılacaktır.
