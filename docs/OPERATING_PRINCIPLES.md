# PaperMorning — Çalışma ve Maliyet İlkeleri

> **Bu belge teknik mimari değildir.** Kullanıcı tarafından belirlenen ürün ve işletim kısıtlarını tanımlar. Somut pipeline tasarımı, servis sınırları, araçlar, modeller, veri yapıları ve deployment stratejisi proje sahibi tarafından tasarlanacaktır.
>
> Karar: 22 Kasım 2026 — Günlük, kişiselleştirilmiş, **self-hosted-first** yayın; **deterministik-first**, Claude API yalnızca gerçekten anlamlandırma ve yazma gerektiren işlerde.

## 1. Kurulum ve sahiplik

PaperMorning, merkezi olarak bizim barındırdığımız bir SaaS'a bağımlı **olmayacaktır**.

- İsteyen kendi bilgisayarında, isteyen ev sunucusunda, isteyen kiraladığı sunucuda çalıştırabilmelidir.
- Sistem her gün elle açılmadan, **her okuyucunun zaman diliminde saat 08.00'de e-posta teslim edebilecek şekilde**, kendi ortamında görevini yerine getirebilmelidir. Üretim teslimden önce tamamlanır.
- Kurulumun sahibi; kendi çalışma ortamı, tercihleri, erişim bilgileri ve API kullanım maliyetinin kontrolüne sahip olmalıdır.
- Ürünün çalışması için geliştiricinin sürekli aktif olması veya merkezi bir PaperMorning hesabı bulunması gerekmez.
- Claude API kullanımını tercih eden kullanıcı kendi API erişimini sağlamalıdır; yalnızca yerelde çalışma hedefi, üçüncü taraf API'ye ağ bağlantısı ihtiyacını ortadan kaldırmaz.
- Yerel bilgisayar uyku/kapalı durumdaysa o saatte çalışacağı **garanti edilmez**. Sonraki açılışta kaçırılmış yayınların nasıl ele alınacağı proje sahibi tarafından belirlenmeli, kullanıcıya açıkça belirtilmelidir.
- Salı demoda **bir kurulumun başarıyla çalıştığı** gösterilir; her işletim sisteminde kusursuz paketleme ayrı kabul aşamasıdır.

## 2. Kullanıcı profili: öncelik ile bilgi seviyesi farklıdır

Kullanıcı ilk kurulumda her **konu başlığı** için iki zorunlu tercih tanımlar:

1. **Öncelik (Ne kadar yer ayıralım?):** Yüksek / orta / düşük. Bu; seçki sırasını, sayıda ayrılacak dikkati ve uygun kaynak olduğunda kapsamı etkiler. Bilimsel doğruluğun veya kanıt standardının düşürülmesi anlamına gelmez.
2. **Konuya aşinalık / bilgi seviyesi (Neyi biliyorum?):** Başlangıç / orta / ileri. Bu; terminoloji, ön bilgi açıklamaları, varsayılan bağlam ve karşılaştırmaların nasıl yazılacağını etkiler.

Örnek: "Bilgisayar mimarisi = yüksek öncelik, ileri bilgi"; "Kuantum fiziği = düşük öncelik, başlangıç bilgi".

**Dikkat:** "Konuyu ne kadar iyi biliyorum?" ile "Ne kadar teknik okumak istiyorum?" aynı soru değildir. İlk sürüm için **bilgi seviyesi** esas alınır. İstenirse ileride bağımsız bir teknik derinlik/okuma tarzı tercihi eklenebilir; ikisi veride ve ürün kararında karıştırılmaz.

Tercihler **okuyucu hesabına** kaydedilir ve sonradan güncellenebilir. Çok kullanıcılı kurulumda güvenli kayıt/giriş gereklidir; geliştirici tarafından işletilen merkezi bir bulut hesabı gerekmez.

## 3. Deterministik-first çalışma ilkesi

**Claude API orkestratör değildir.** Sistem; ne zaman çalışacağına, hangi kaynakların erişilebilir olduğuna, hangi belgelerin işlendiğine, hangi aşamanın bittiğine, çıktının nereye kaydedileceğine ve ne zaman yayımlanacağına denetlenebilir uygulama mantığıyla karar vermelidir.

LLM çağrısına gerek olmayan işlerin LLM ile yapılması bir anti-pattern olarak değerlendirilir.

| İş sınıfı | LLM beklentisi |
|---|---|
| Belirli saatte işi başlatma; çalışma tarihi ve aralığını belirleme | **LLM gereksiz** |
| Akademik kaynaklardan kayıt ve metadata alma | **LLM gereksiz** |
| DOI, arXiv ID ve benzeri açık tanımlayıcılarla kimlik eşleştirme; kesin yinelenenleri çıkarma | **LLM gereksiz** |
| Açık kurallarla tarih/dil/konu/sürüm/erişilebilirlik ön elemesi | **LLM gereksiz** |
| Önceden incelenmiş aynı içerik için mevcut sonucu yeniden kullanma; durum/hatayı kaydetme | **LLM gereksiz** |
| Makalenin semantik ilgisini veya gerçek yeni katkısını tartışmalı durumda değerlendirme | **LLM faydalı / gerektiğinde** |
| Yöntem, kanıt, sınırlama ve önceki araştırmalarla ilişkiyi anlamlandırma | **LLM faydalı / gerektiğinde** |
| Okurun bilgi düzeyine uyarlanmış kaliteli haber / dosya yazımı | **LLM ana işçi** |
| PDF/sayfa yerleşimi, tarih, sayı kimliği, link ve dosya doğrulama | **LLM gereksiz** |
| Basit şema, boş alan, kaynak linki, iddia sayıları gibi doğrulanabilir kontroller | **Deterministik kontrol öncelikli** |

**Önemli ayrım:** Semantik yenilik, bilimsel kanıtın gücü ve doğal dildeki iddia doğruluğu yalnızca basit kurallarla *tam* doğrulanamaz. Ucuz deterministik ön eleme değerlidir; ama yeterli kanıt olmadan "makale iyi" veya "iddialar kesin doğru" deme yetkisi vermez.

Bu tablonun iş mantığı sınırları **gereksinimdir**; hangi algoritma, servis veya araçla hayata geçirileceği mimari karardır.

## 4. Günlük işletim beklentisi

Her okur kendi zaman dilimini ayarlar; **günlük gönderim saati 08.00'dir**. İçerik önceden hazırlanmalıdır. Çalışma ortamı kapalıysa garanti verilemez.

Günlük çalışma beklenen sonuçları:

1. Tarih aralığına giren aday araştırmaların elde edilmesi.
2. Açık kurallarla elenebileceklerin ayıklanması, tekrarlananların temizlenmesi.
3. Gerçek yorum gerektiren az sayıdaki aday için Claude API'nin devreye girmesi.
4. Doğrulanabilir kaynaklı yazıların üretilmesi.
5. Sabit yayın tasarımına yerleştirme, PDF/dijital sayı üretimi.
6. Başarılı, tarihli bir sayı olarak saklama; **çıktı metni ve PDF dosyasının kalıcı kopyasını tutma**, her kullanıcıya göre kişisel seçki oluşturma ve **08.00'de gerçek e-posta** gönderme. Gönderim tekrarları kayıt altına alınır.
7. Okuyucunun yazı başına 👍/👎 geri bildirimini kaydetme; ilk sürümde otomatik öğrenme veya karmaşık analiz yapmama.

Bunlar **mantıksal beklentiler**; fiziksel servis veya agent tasarımı değildir. Gün içindeki kaynak taramasının sıklığı, tam çalışma akışı ve zamanlamanın aracı mimari aşamasında seçilir.

Başarısızlık veya tekrarda:
- Aynı gün aynı sayı yanlışlıkla birden fazla yayımlanmamalı.
- Başarısız işlem sessizce başarılı gibi görünmemeli.
- Eski sayı o günün sayısı gibi sunulmamalı.
- Bir bölüm yeniden çalıştırıldığında tamamlanmış ve değişmemiş işleri gereksiz tekrar edip API ücreti oluşturmamalı.

## 5. Token ve maliyet disiplini

- **Ön eleme ilk, pahalı anlamsal okuma sonra:** Tüm makalelerin tam metnini bir modelle incelemek başlangıç varsayımı değildir.
- **Gerektiği kadar bağlam:** Makalenin destekleyici bölümleri okunmalı; her şeyi gerekçesiz modele aktarmak doğru değil.
- **Tekrar kullanım:** Aynı makalenin aynı sürümünün bilimsel analizi bütün okuyucular için ortak yeniden kullanılabilmeli. Aynı dil/bilgi seviyesi için üretilmiş yazı da uygunsa paylaşılmalı; kişisel seçki/dağılım ayrıca oluşturulmalı. İçerik veya analiz sözleşmesi değişirse geçerlilik kontrol edilmeli.
- **Ölçülebilir bütçe:** Bir sayıdaki çağrı sayısı, girdi/çıktı tokenları, tahmini/gerçek API maliyeti ve başarısız çağrılar denetlenebilir olmalı. Basit anlamsal işler Haiku; ana araştırma/yazım Sonnet; **Opus yalnızca konfigürasyonla açılan istisnai eskalasyon**, otomatik maliyet patlaması olmamalı.
- **Sınır aşımı:** Günlük kullanım/harcama üst sınırına yaklaşınca davranış belirli ve görünür olmalı; sınırsız retry veya sessizce yüksek maliyet kabul edilemez.
- **Kaliteden rastgele tasarruf yok:** Maliyeti azaltmak için kaynak doğrulaması veya kritik araştırma değerlendirmesi atlanmamalı.

**Hedef:** Aynı editoryal kaliteyi gereksiz API çağrısı yapmadan üretmek. En düşük token sayısı tek başına başarı değildir.

## 6. Salı demo için göstereceğimiz kanıt

- Kullanıcı iki alanda **öncelik** ve **bilgi düzeyini ayrı ayrı** ayarlayıp kaydedebiliyor.
- Aynı fikir, farklı bilgi seviyelerine yazıldığında gerekli bağlam ve teknik terimler gözle görülür biçimde farklılaşıyor (bilimsel bulgular değişmeden).
- Tek bir kurulumda **iki kayıtlı okuyucu** kendi günlük sayılarını dışarıdan kod değiştirmeden oluşturabiliyor.
- Kullanıcı zaman diliminde **08.00 e-posta teslimi** zamanlaması gösterilmiş ve gerçek test e-postasıyla doğrulanmış; yalnızca söz verilmemiş.
- Claude API çağrısı yapılmadan tamamlanabilen işlerin gerçekten API çağrısı yapmadığı ve çağrı maliyeti/adedinin görülebildiği gösteriliyor.
- Bir sayıyı tekrar çalıştırma, yanlışlıkla iki kez yayın veya aynı işi tekrar faturalandırma tehlikesini kontrol edebildiğini kanıtlıyor.
- Gerçek kaynaklı ve okunabilir bir PDF sayı üretiyor.

**Kapsam sınırı:** Demo için tüm hedef işletim sistemlerinde hazır paket, merkezi hosting platformu, kurumsal IAM veya merkezi e-posta altyapısı şart değil. **Tek kurulumda basit güvenli kayıt/giriş (3 saat, refresh yok), iki okuyucu, web/PDF arşivi, 👍/👎 ve günlük e-posta gönderimi artık şart.** Ayrıntı: **[güncel Lean MVP kapsamı](LEAN_MVP_SCOPE.md)** ve [çok kullanıcılı e-posta gereksinimleri](MULTI_USER_EMAIL_REQUIREMENTS.md).

## 7. Mimariyi tasarlayan kişinin kararına bırakılanlar

Veri kaynakları, uygulama dili ve iskeleti, depolama, kaynak toplama frekansı, görev zamanlayıcı türü, durum yönetimi, yeniden deneme, cache anahtarları, maliyet hesaplama yaklaşımı, model/araç seçimi, UI ve PDF rendering yöntemi ve deployment biçimi **proje sahibi tarafından** belirlenecektir.

**Bu doküman Claude Code'a "şu mimariyle yaz" talimatı değildir.** Mimari onaylanınca uygulama sırasında uyulacak ürün ve operasyon gereksinimidir.
