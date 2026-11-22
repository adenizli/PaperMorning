# PaperMorning — Ürün Vizyonu ve MVP Kapsamı

> Durum: Ürün beklentisi / tartışma taslağı. Teknik mimari veya uygulama planı değildir.  
> İlk demo hedefi: **Salı, 24 Kasım 2026**.  
> Ürün sahibi mimariyi ayrıca tasarlayacak, değerlendirecek ve onaylayacaktır.

## 1. Bir cümlelik ürün

**PaperMorning**, aynı self-hosted kurulumda kayıtlı birden fazla kullanıcının seçtiği bilim ve teknoloji alanlarında yeni akademik araştırmaları takip eden; ortak makale analizini yeniden kullanarak her okuyucuya özel, kaynaklı bilim dergisini **her sabah kullanıcının yerel saat diliminde 08.00'de e-posta olarak gönderen** ürün fikridir.

Amaç makaleleri özetlemek değil; **okurun bilim dünyasında ne değiştiğini anlayabileceği bir editoryal yayın** üretmektir.

## 2. Hedef deneyim

Bir okur, ilgilendiği konuları, **her konuya verdiği önceliği** ve **o konudaki mevcut bilgi birikimini** ayrı ayrı belirtir. Sabah yayını açtığında rastgele link listesi, sohbet cevabı veya kopuk özetler yerine tamamlanmış bir **sayı** görür:

- Tanınabilir bir yayın adı, tarih, sayı kimliği ve kapak.
- Önem sırasına konmuş haberler ve araştırma dosyaları.
- Hızlı bakılabilecek bir içindekiler / öne çıkanlar bölümü.
- Her dosyada **ne bulundu, neden önemli, nasıl gösterildi, nerede sınırlı** sorularının cevabı.
- Doğrulanabilir orijinal kaynak bağlantıları; preprint/hakemli yayın ayrımı.
- Farklı konuların aynı sayı içinde editoryal bütünlükle bir araya gelmesi.
- Okumaya veya paylaşmaya uygun, gerçek sayfa tasarımı olan bir çıktı.

Okur teknik bir konunun uzmanı değilse yazıyı anlayabilmeli. Konuyu bilen bir okur ise yalnızca parlak bir başlık değil, araştırmanın **gerçek katkısını ve delilini** öğrenebilmeli.

## 3. Hedef kullanıcı

**İlk aşamada:** Birden fazla araştırma alanını merak eden, tüm makaleleri tek tek takip etmeye zamanı olmayan teknik meraklı / öğrenci / araştırmacı. PaperMorning merkezî hizmete bağlı olmak yerine, kullanıcıların kendi bilgisayarında veya kendi seçtiği sunucuda barındırabileceği bir uygulamadır.

**Bir self-hosted kurulum içinde birden fazla okuyucu hesabı ve kişisel e-posta aboneliği MVP kapsamındadır.** Merkezi olarak işletilen SaaS, ödeme ve satış MVP kapsamında değildir.

## 4. Kullanıcı tercihleri — ürün düzeyi

Kullanıcı şu tercihleri tanımlayabilmelidir:

- **Konular:** Örneğin yapay zekâ, donanım mimarisi, havacılık, tıp, fizik. Yeni bir konu ekleyebilme / çıkarabilme.
- **Öncelik:** Bir konuyu ağırlıklı, diğerini ikincil görmek isteme (yüksek / orta / düşük). **Bu, kullanıcının bilgi seviyesiyle aynı şey değildir.**
- **Bilgi seviyesi:** Kullanıcı her konu için başlangıç / orta / ileri düzeyde kendi mevcut bilgisini seçer. Yazının varsaydığı ön bilgi ve terim açıklamaları buna göre ayarlanır. **Bilgi seviyesi ile ayrıca istenebilecek teknik detay miktarı karıştırılmaz.** İkinci tercih ileride bağımsız sunulabilir.
- **Dil:** İlk demoda Türkçe okuma deneyimi esas; başka diller sonraya kalabilir.
- **Yayın yoğunluğu:** Kısa veya ayrıntılı okuma tercihi; katı sayfa sayısı yerine yeterli bilimsel içerik.
- **Yayın ritmi:** Hedef, kullanıcının seçtiği saat dilimine göre **her sabah 08.00'de** günlük derginin e-posta ile teslim edilmesi. Üretim bu saatten önce tamamlanır. Pazartesi uzun haftalık özel sayı, bir sonraki ürün kararıdır.
- **Hesap ve gönderim:** Basit e-posta/parola ile kayıt ve giriş, 3 saatlik refresh edilmeyen token, minimum e-posta doğrulama ve e-posta gönderimini açma/kapama. **Kapsamlı parola kurtarma, refresh token veya ayrı auth servisi MVP kapsamında değil.** Her kullanıcının yayın arşivi diğerinden ayrıdır.

Tercihler kullanıcı hesabına bağlı kalır ve okuyucu her defasında yeniden seçim yapmaz. **Uygulamanın kendi kullanıcı hesabı gereklidir; merkezi bir PaperMorning bulut hesabı gerekmemelidir.**

## 5. Günlük sayının ürün davranışı

1. Yeni ve ilgili çalışmaların taranmış olması beklenir. **Belirli saatli işleyiş, kaynak/metadata alma, açık kurallarla filtreleme, tekrar tespiti, durum takibi ve çıktı düzeni gibi deterministik işler LLM çağrısıyla yapılmaz.**
2. Yalnızca gündem olmuş olanlar değil, **yenilik / kanıt / ilgi / çeşitlilik** açısından değerli bulunanlar seçilir.
3. Aynı iddiayı işleyen yinelenen çalışmalar tek bir hikâyede birlikte tartışılabilir.
4. Önemli bulgu yoksa sırf sayfa doldurmak için içerik uydurulmaz.
5. Önceki sayılarda ele alınmış çalışmalar sebepsiz tekrar edilmez; anlamlı güncelleme varsa açıkça belirtilir.
6. Okur kaynak ve makale sayfasına gidebilir.
7. Ortaya **yayınlanmış, tarihli, web üzerinden okunabilen, PDF'i ve üretilmiş içerikleri kalıcı arşivlenen ve sabah 08.00'de e-posta olarak gönderilen kişiye özel bir sayı** çıkar. Aynı kaynakların akademik analizi farklı kullanıcılarda yeniden kullanılabilir.
8. **Claude API, yalnızca semantik değerlendirme, bilimsel yorumlama ve okurun bilgi birikimine göre yazma gibi gerçek dil/anlam işleri için kullanılır.** Görev bazında Haiku (basit değerlendirme), Sonnet (ana analiz/yazım), **istisnai ve varsayılan olarak kapalı Opus** seçilebilir. Gereksiz çağrılar azaltılır; harcama ve hata davranışı görünür olur.
9. **Her yazı için 👍/👎 geri bildirimi** kullanıcı hesabına kaydedilir. Bu aşamada karmaşık kişiselleştirme/öğrenme algoritması yoktur.

**Günlük sayı**: Başlangıç tasarım hedefi yaklaşık **5–8 sayfa**; bu bir kota değil.  
**Haftalık özel sayı**: Gelecekte pazartesi yaklaşık **12–15 sayfa** düşünülebilir; MVP için bloklayıcı değildir.

## 6. Yazı türleri — ürün beklentisi

- **Kapak dosyası:** En anlamlı yeni çalışma ya da aynı hikâyeyi aydınlatan bir grup çalışma; tek başına okunabilir ve güçlü bağlamı var.
- **Kısa haber:** Bir yeni sonucu 2–4 dakikada anlaşılır kılan metin.
- **Karşılaştırmalı değerlendirme:** Bu çalışma önceki yönteme göre ne değiştiriyor, neyi değiştirmiyor?
- **Temkin notu:** Ölçek, örneklem, deney ortamı, hakemlik durumu gibi sınırlar.
- **Kaynak kartı:** Başlık, yazar(lar), yayın tarihi, yayın/preprint durumu, kaynak bağlantısı.

Tek bir sayı bu türlerin tamamını bulundurmak zorunda değildir.

### En önemli kapanış: Ufuk Raporu

**Her sayının en sonunda, editoryal değeri en yüksek bölüm** bulunur: [Akademik ve Sektörel Öngörü](OUTLOOK_AND_OPPORTUNITIES.md).

Bu bölüm araştırma haberlerini bir kez daha özetlemek yerine **birlikte yorumlar**: ortak eğilimleri veya çelişkileri gösterir; açık akademik problemleri ve deney fikirlerini saptar; sektör için denenebilir pilot/prototip fırsatlarını, olgunluk düzeyini ve gelişim ihtimalini tartışır; okura **ilk somut adımı** önerir. Her fırsat hangi makaleye dayandığını gösterir; bulgu, yorum ve öngörü ayrı sunulur. Abartılı kesinlik, temelsiz pazar tahmini veya her güne zorla fikir doldurma yasaktır.

Yayın sayfasında ve arşivlenen PDF'de en sona yerleştirilir; günlük e-postada en güçlü bulgu/öneri ön izleme olarak gösterilir. Kapanış dosyasına 👍/👎 geri bildirimi de verilebilir.

## 7. Kullanıcının gerçekten aldığı değer

Okuyucunun dergi sonrasında cevaplayabilmesi gereken sorular:

1. İlgi alanımda **yeni** ne olmuş?
2. Bundan önce durum neydi, bu çalışma neyi değiştirdi?
3. Hangi deney veya veri bu iddiayı destekliyor?
4. Sonuç ne kadar güçlü, ne kadar genellenebilir?
5. Merak edersem asıl çalışmayı nereden okuyabilirim?

**Başarı metriği:** Sırf kaç makaleyi özetlediğimiz değil, okurun doğru bilgiyle bilgilendirilmiş ve merak etmiş olması.

## 8. Salı demosunda zorunlu ürün kapsamı

- **İki ayrı kullanıcı hesabıyla** kayıt, giriş ve özel tercihlerin birbirinden ayrılması; en az iki araştırma alanı seçimi, her biri için **ayrı öncelik ve bilgi seviyesi** ve tercihlerin korunması.
- Gerçek, güncel, referanslanabilir araştırmalardan üretilmiş **bir örnek sayı**.
- Kapak, içindekiler, en az bir derin dosya, kısa bölümler, kaynaklar.
- Kaynak/makale iddialarının izlenebilirliği; preprint işaretleri.
- Okunabilir sayfa düzeni, **basit front-end üzerinden okuma**, **PDF olarak erişilebilir yayın**, kullanıcıya ait geçmiş sayıların ve gönderilmiş çıktıların korunması.
- Yayını yeniden oluşturmayı / yeni sayı oluşturmayı gösterebilen bir kullanım yolu.
- Kullanıcının kendi zaman diliminde **08.00'de** gerçek e-posta teslim hedefi için **hazırlanmış ve doğrulanabilir otomatik çalışma davranışı**, manuel test gönderimi ve gönderim durumu.
- **Tek kurulumda self-hosting deneyimi** ve **deterministik işlerde gereksiz Claude API kullanımı yapılmadığının** gösterimi.
- Kurulum sahibinin bilgisayarında veya seçtiği sunucuda çalışan, **canlı etkileşimle gösterilebilir** bir uygulama; yalnızca kayıtlı video yeterli değil.
- Kullanıcının kod yazmasını gerektirmeyen işletim / inceleme deneyimi.
- Ortak makalenin analizinin kullanıcılar arasında yeniden kullanıldığının, iki farklı kişisel sayı ve gerçek e-posta gönderiminin gösterilmesi.
- Makale 👍/👎 kaydı, Haiku/Sonnet görev ayrımı ve **3 saatlik refresh'siz oturum** davranışının gösterilmesi.
- **Ufuk Raporu:** Sayının en sonunda kaynaklara bağlı **en az bir akademik araştırma sorusu/deney ve bir sektörel pilot**; mevcut kanıt elvermiyorsa gerekçeli sınırlama, somut ilk adım ve spekülasyon etiketi.

Bunlar **neyle, hangi servisle veya hangi topolojiyle** yapılacağına dair talimat değildir.

## 9. Bilinçli olarak kapsam dışı

İlk demoda şart olmayanlar: herkese **sınırsız açık kayıt**, refresh token, kapsamlı parola sıfırlama, kurumsal IAM/SSO, sosyal özellikler, ödeme, mobil uygulama, karmaşık abonelik planları, gelişmiş feedback öneri motoru, haftalık özel baskı, çok dilli tam destek, sınırsız araştırma alanı, makalenin PDF tam metnine erişilemediği halde tam metin analizi iddiası.

## 10. Ürün kararları — henüz kilitlenmeyenler

- Günlük yayın **08.00'de teslim edilir**; kaynak derleme ve yazma işlerinin ne zaman tamamlanacağı mimaride belirlenir.
- Varsayılan dergi uzunluğu ve farklı okuyucu derinliği ayarlarının UX'i.
- Türkçe dışında ilk ek dil.
- E-postada tam dergi içeriği ve PDF bağlantısının nasıl sunulacağı; varsayılan olarak okunabilir içerik ve güvenli tam sayı bağlantısı gereklidir.
- Kapak/görsel stratejisi: özgün çizimler, açık lisanslı görseller veya tipografik kapak.
- Daha sonra haftalık özel sayı eklenip eklenmeyeceği.

**Self-hosted çok kullanıcılı çalışma, basit ve güvenli 3 saatlik oturum, web/PDF arşivi, 👍/👎, model bazlı görev yönlendirmesi, 08.00 e-posta teslimi ve deterministik-first, bütçe duyarlı kullanım ürün gereksinimidir. Mimari, kod tabanı, model seçimi, veri erişimi, iş zamanlama aracı ve deployment teknik kararları bu belgeyle alınmamıştır.** Ayrıntılar için **[güncel Lean MVP kapsamı](LEAN_MVP_SCOPE.md)**, [çalışma ilkeleri](OPERATING_PRINCIPLES.md) ve [çok kullanıcılı e-posta gereksinimleri](MULTI_USER_EMAIL_REQUIREMENTS.md).

## 11. Ürün açısından taviz vermeyeceğimiz noktalar

- **Şık ama yanlış** sayı kabul edilmez.
- **Doğru ama okunamayan ham makale dökümü** de hedef değil.
- Güvenilmez kesinlik, uydurulmuş sonuç, kaynak dışı sayılar ve erişilmemiş tam metin üzerinden iddia üretmek kabul edilmez.
- Katı sayfa hedefini doldurmak için niteliği düşük içerik eklenmez.
- Otomatik yayın aksadığında önceki sayı yeniymiş gibi gösterilmez.
- Gereksiz API token tüketimi ve kullanıcının kontrol edemediği maliyet kabul edilmez.
- Kullanıcının kendi ortamında barındırma hakkı merkezi bir altyapıya bağımlı kılınmaz.

---

**Sorumluluk sınırı:** Bu belge *ne inşa etmek istediğimizi* tarif eder. *Nasıl inşa edeceğimizi* proje sahibi belirler; bu doküman doğrudan Claude Code için mimari komut sayılmamalıdır.
