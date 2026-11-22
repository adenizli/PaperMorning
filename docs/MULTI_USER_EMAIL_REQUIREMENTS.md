# PaperMorning — Çok Kullanıcılı Kurulum, Authentication ve 08:00 E-posta Yayını

> **Karar tarihi:** 22 Kasım 2026  
> **Durum:** Onaylanan ürün/işletim gereksinimleri; ayrıntılı yazılım mimarisi DEĞİL.  
> **Mimari sahibi:** Proje sahibi. Bu belge framework, database, SMTP sağlayıcısı, job altyapısı veya agent düzeni seçmez.

## 1. Yeni ürün kararı

Bir PaperMorning kurulumu **birden fazla okuyucuya** hizmet verebilir. Okuyucular kayıt olur, giriş yapar ve kişisel araştırma tercihlerini yönetir.

Her gün **sabah 08:00'de** her abone kendi tercihlerine göre hazırlanan bilim dergisini **e-posta olarak alır**. 08:00, yayın/teslim hedefidir; içerik işleme ve PDF hazırlama 08:00'de başlamamalıdır.

Sistem **self-hosted-first** kalır: kullanıcılar uygulamayı kendi bilgisayarına veya seçtiği sunucuya kurar. Kurulum sahibi hesap açılışını, API bütçesini ve e-posta çıkış altyapısını kontrol eder. Zorunlu merkezi PaperMorning bulutu yoktur.

## 2. Kullanıcı akışı (minimum)

1. Okur **kullanıcı adı, e-posta, şifre** ile kayıt olur; **e-posta doğrulaması olmadan** güvenli biçimde giriş yapar.
2. Her bir konu için **öncelik** (yüksek/orta/düşük) ve **mevcut bilgi seviyesi** (başlangıç/orta/ileri) ayarlar.
3. Yayın dili, saat dilimi ve e-posta alma tercihini kaydeder. **Varsayılan teslim: her gün 08:00, kullanıcının yerel saat diliminde.**
4. Uygulama makaleleri toplar, değerlendirir ve içerikleri oluşturur; gerekirse Claude API kullanır.
5. Okura kendi seçkisiyle derlenmiş bir **günlük dergi e-postası** gönderilir.
6. Okur e-postadan özgün kaynaklara, web arşivindeki kendi sayılarına ve PDF sürümüne erişebilir; dilerse e-posta gönderimini kapatır.

### E-posta deneyimi

E-posta yalnızca 'Derginiz hazır' diyen boş bildirim **olmamalıdır**. Sayının sonundaki **Ufuk Raporu** bölümünden en değerli bir akademik veya sektörel öneriyi kısa bir ön izleme olarak göstermeli ve tam bölüme bağlanmalıdır. Kullanıcı **e-postanın içinde gerçek okunabilir içerik** görebilmelidir (en azından editoryal özetler ve ana haberler, çalışmalara kaynak bağlantıları). Tam sayı ve sayfa düzenli PDF için güvenli bağlantı da sunulur. **Aynı kişisel PDF, e-postaya mutlaka dosya eki olarak eklenir.** E-posta eki boyut sınırı aşılırsa gerçek gönderim başarısız sayılır; yalnızca bağlantı gönderimi yeterli kabul edilmez.

E-postadaki tarih, konu isimleri, referanslar ve yayın durumu, gönderilen gerçek sayıyla eşleşir.

## 3. Authentication: Basit arayüz, ciddi güvenlik

İstenen MVP deneyimi **yalnızca kullanıcı adı + e-posta + şifre alanlarıyla kayıt**, e-posta veya kullanıcı adıyla giriş ve çıkıştır. **E-posta doğrulaması kesinlikle YOKTUR.** Güvenli cookie ile **3 saat ömürlü token/oturum, refresh token olmadan**; süre bitince yeniden giriş. Parola kurtarma, oturum yenileme, SSO, OAuth, MFA, ekip hiyerarşisi ve kurumsal IAM **MVP dışıdır**.

Bununla birlikte:

- Parolalar düz metin saklanamaz; olgun bir parola hash yöntemi kullanılmalıdır. Kimlik doğrulamada güvenilir bileşen/standart kütüphane tercih edilmelidir.
- Oturumlar güvenli cookie/session kurallarıyla korunmalı; hız sınırlama ve temel brute-force koruması bulunmalıdır.
- Bir kullanıcı başka kullanıcının profiline, dergisine, e-posta adresine veya teslim kayıtlarına erişememelidir.
- **Doğrulama e-postası, e-posta doğrulama tokenı, doğrulama endpoint'i ve verified-at alanı oluşturulmaz.** Günlük e-posta, yeni kullanıcıya varsayılan olarak başlamaz; kullanıcı tercihler ekranında gönderimi açıkça açar. Yanlış veya başka birine ait adrese abonelik açılması tamamen engellenemez; kayıt ve gönderime temel hız/kota sınırı ve abonelikten çıkma imkânı konur.
- Kurulum sahibi kayıt açma/kapatma veya davet kısıtı belirleyebilmelidir; aksi halde halka açık sunucuda herkes sınırsız Claude/SMTP maliyeti doğurabilir.
- Kullanıcı **abonelikten çıkma** veya gönderimi durdurma işlemini kolayca yapabilmelidir. Zorunlu hesap işlemi mesajları ve dergi aboneliği ayrı değerlendirilmelidir.
- API, SMTP ve oturum anahtarları tarayıcıya veya public repoya sızmaz.

**İşlevsel olanak**: Kayıt ve hesap sayısı için uygulama sahibinin belirlediği limitler ve yetkiler olmalıdır. Bu 'ağır authentication mimarisi' gerektirmez.

## 4. Maliyet açısından en kritik ayrım

**Bir makalenin bilimsel analizi, okuyucuya değil, makalenin belirli sürümüne aittir.**

Kurulumun tüm kullanıcıları için ortak yeniden kullanım beklenir:

1. **Ortak keşif:** Aynı akademik kaynağı 100 kullanıcı için 100 kez çekmeyiz.
2. **Ortak makale analizi:** Kaynağın aynı sürümü ve aynı analiz kuralları için bilimsel bulgular bir kez üretilebilir ve yeniden kullanılabilir.
3. **Ortak anlatım varyantları:** Aynı dil/konu/bilgi seviyesi için uygun bir yazı daha önce hazırlanmışsa, okur başına yeniden Claude'a yazdırmak **zorunlu değildir**. Bilimsel doğruluk ve gerekli farklılaştırma korunur.
4. **Kullanıcıya özel sayı:** Hangi haberlerin seçileceği, sırası, dağılımı ve PDF/e-posta derlemesi tercih profilini kullanır; uygunsa **deterministik** yapılır.
5. **Değişiklik yönetimi:** Yeni makale sürümü, yeni kanıt veya anlatım sözleşmesi değişirse ilgili önbellek girdilerinin geçerliliği yeniden değerlendirilir.

**Kaçınılacak anti-pattern:** Her kullanıcı için uçtan uca ayrı Claude araştırması ve yazımı başlatmak. Kişiselleştirme demek, birim maliyeti kullanıcı sayısıyla doğrusal büyütmek demek olmamalıdır.

Bu maddeler mantıksal ürün sınırlarıdır; fiziksel cache, storage, DB şeması ve dağıtım senin mimari kararındır.

## 5. Günlük 08:00 teslim davranışı

- Günlük e-posta **08:00'de hazır olacak şekilde** planlanır; gerekli tarama, analiz, editoryal hazırlık ve render **önceden** tamamlanır.
- Kullanıcının zaman dilimi dikkate alınır; kurulumun bulunduğu sunucunun saat dilimine körü körüne güvenilmez.
- Her kullanıcı için gün başına **tek geçerli sayı** ve **tek amaçlanan e-posta teslimi** üretilir; yeniden denemeler çift gönderim riskini mümkün olduğunca azaltır.
- Gönderim durumları (hazırlanıyor/hazır/gönderildi/başarısız/yeniden denenecek) denetlenebilir olmalıdır.
- E-posta altyapısı geçici hata verirse sınırlı yeniden deneme uygulanır ve durum kaydedilir; idempotent davranış hedeflenir. Uzak e-posta sağlayıcısının teslimi kesin olarak garantilenemez.
- 08:00'e yetişilemeyecekse, eski sayı o güne aitmiş gibi gönderilmez. Geciken yayın için görünür bir durum oluşur; gecikme mesajı veya ertelenmiş gönderim davranışı mimaride kararlaştırılır.
- Kullanıcı günlük e-posta aboneliğini **açıkça etkinleştirmemişse** veya kapatmışsa düzenli dergi e-postası gönderilmez. Kayıt olurken e-posta doğrulama kontrolü yapılmaz.
- Self-hosted makine uyku/kapalı ve çalışmıyorsa kesin 08:00 gönderimi garanti edilemez; güvenilirlik için sürekli açık ortam gerekliliği kurulum belgelerinde belirtilir.

## 6. Güvenlik, mahremiyet ve operatör maliyeti

- Bir kurulum sahibi teknik olarak **diğer kullanıcılar için API ve e-posta hesabının masrafını üstlenir**; bu yüzden kayıt erişimi, kota ve bütçe denetimi ürün gereksinimidir.
- Kullanıcı tercihleri, e-postalar, oturumlar ve kişisel dergi geçmişi başka okuyuculardan izole olmalıdır.
- Ortak makale metadata/analizi kişiye ait özel tercihleri sızdıracak şekilde paylaşılmamalıdır.
- Günlük e-posta, abonelik tercihi ve hesabı silme işlemleri ölçülü veri tutma ve şeffaflık ilkeleriyle ele alınmalıdır.
- Operatör SMTP veya başka bir e-posta sağlayıcı erişimini kendisi sağlar. Geliştirici tarafından işletilen ortak e-posta servisi zorunlu değildir.
- **Kendi dizüstüne kurup yalnızca localhost'ta kullanan kişi**, dışarıdan insanların kayıt olabilmesi için ayrıca erişilebilir sunucu/alan adı/ağ kurulumu gerekir; self-hosting bu gerçeği ortadan kaldırmaz.

## 7. Salı, 24 Kasım 2026 demosuna eklenen P0 kabul kriterleri

- [ ] Aynı kurulumda **iki farklı hesap** oluşturulabiliyor; hesaplara ayrı giriş yapılabiliyor.
- [ ] Kişi A ve B için farklı konu/öncelik/bilgi seviyesi ayarları kaydedilip yüklenebiliyor.
- [ ] A kullanıcısı B'nin tercihlerini ve özel sayılarını göremiyor.
- [ ] En az bir gerçek araştırma **ortak analizden** iki okuyucunun içeriğinde yeniden kullanılabiliyor; tekrar Claude çağrısı oluşmadığı gösterilebiliyor. **Haiku/Sonnet görev seçimi** ve düşük maliyetli kullanım görülebiliyor; Opus varsayılan kapalı.
- [ ] Kişiye özel günlük sayı **basit web arayüzünden** ve PDF olarak açılabiliyor; tüm gönderilen içerik/PDF sürümleri saklanıyor. Yazılar için tek aktif 👍/👎 geri bildirimi kaydedilebiliyor.
- [ ] 08:00 teslim düzeni konfigüre edilmiş ve saati beklemeden **manuel/deneme tetiklemesi** ile en az bir gerçek e-posta alındığı gösteriliyor.
- [ ] Gönderilen e-postanın içinde okunabilir araştırma içeriği ve kaynak bağlantıları var; **gerçek PDF dosyası ekli** ve sayının tamamına güvenli bağlantı da veriliyor.
- [ ] E-posta aboneliğini açmamış veya kapatmış hesaba günlük dergi gönderilmiyor; **e-posta doğrulama akışı bulunmuyor**.
- [ ] Kurulum sahibi anahtarlarını ve dışa açık hesap sınırlarını kontrol edebiliyor.
- [ ] E-posta API sağlayıcısı ve Claude erişimi gibi dış bağımlılıkları gösteride açıkça belirtebiliyoruz.

### İlk demo için kapsam dışında tutulanlar

Kurumsal IAM, organizasyon/rol hiyerarşisi, ödeme, merkezi kullanıcı servisi, çok sayıda kurulum arasında paylaşılan global analiz bulutu, mobil uygulama ve gelişmiş e-posta şablon editörü.

## 8. Henüz kullanıcı tarafından mimarisi belirlenmeyen kararlar

- **Kayıt yöntemi kararı:** Kullanıcı adı + e-posta + şifre; 3 saatlik refresh edilmeyen token, doğrulama e-postası yok. Kütüphane/token biçimi ve güvenli cookie uygulaması mimari sahibine bırakılır.
- Kayıt herkese açık mı, davetli mi, operatörün açıp kapattığı bir seçenek mi? (**Öneri:** operatör kontrollü)
- Veritabanı ve depolama tercihleri; kullanıcı/kaynak/analiz/sayı/teslim veri sınırları.
- E-posta çıkışı için SMTP veya sağlayıcı adapter'ı.
- 08:00 için tam çalışma planı, zaman dilimi saklama/işleme ve gecikmiş iş politikası.
- Makale analizi ve yazı varyantlarının ne zaman ortaklaştırılacağı; cache anahtarı ve invalidation.
- Web/PDF/mail şablonlarının birlikte nasıl üretileceği.
- Authentication kütüphanesi ve oturum saklama yaklaşımı.
- Operatörün API bütçesi, kota ve gözlemlenebilirlik kontrol ekranı.

**Bu açık kararlar Claude Code'a implementation emri değildir.** Proje sahibi tasarlayıp onaylayınca teknik uygulama bunlara göre yapılacaktır.
