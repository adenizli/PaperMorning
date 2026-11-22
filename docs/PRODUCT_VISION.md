# PaperMorning — Ürün Vizyonu ve MVP Kapsamı

> Durum: Ürün beklentisi / tartışma taslağı. Teknik mimari veya uygulama planı değildir.  
> İlk demo hedefi: **Salı, 24 Kasım 2026**.  
> Ürün sahibi mimariyi ayrıca tasarlayacak, değerlendirecek ve onaylayacaktır.

## 1. Bir cümlelik ürün

**PaperMorning**, kullanıcının seçtiği bilim ve teknoloji alanlarında yeni akademik araştırmaları takip eden; öne çıkan bulguları önem ve güvenilirliğe göre seçen; bunları **her sabah kişiselleştirilmiş, kaynaklı ve dergi tasarımına sahip bir yayın** olarak okura sunan ürün fikridir.

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

Daha geniş bir kitleye açılabilme hedefi olabilir; fakat **çok kullanıcılı SaaS, satış, üyelik, ödeme** bu demodaki temel problem değildir.

## 4. Kullanıcı tercihleri — ürün düzeyi

Kullanıcı şu tercihleri tanımlayabilmelidir:

- **Konular:** Örneğin yapay zekâ, donanım mimarisi, havacılık, tıp, fizik. Yeni bir konu ekleyebilme / çıkarabilme.
- **Öncelik:** Bir konuyu ağırlıklı, diğerini ikincil görmek isteme (yüksek / orta / düşük). **Bu, kullanıcının bilgi seviyesiyle aynı şey değildir.**
- **Bilgi seviyesi:** Kullanıcı her konu için başlangıç / orta / ileri düzeyde kendi mevcut bilgisini seçer. Yazının varsaydığı ön bilgi ve terim açıklamaları buna göre ayarlanır. **Bilgi seviyesi ile ayrıca istenebilecek teknik detay miktarı karıştırılmaz.** İkinci tercih ileride bağımsız sunulabilir.
- **Dil:** İlk demoda Türkçe okuma deneyimi esas; başka diller sonraya kalabilir.
- **Yayın yoğunluğu:** Kısa veya ayrıntılı okuma tercihi; katı sayfa sayısı yerine yeterli bilimsel içerik.
- **Yayın ritmi:** Hedef, kullanıcının seçtiği yerel saatte ve zaman diliminde, her sabah yeni sayı. Pazartesi uzun haftalık özel sayı, bir sonraki ürün kararıdır.

Tercihler kaybolmamalı; okuyucu sonraki yayında tekrar seçim yapmak zorunda kalmamalıdır. Bu, belli bir kimlik sistemi seçildiği anlamına **gelmez**. İlk kurulum için bulut hesabı zorunlu değildir.

## 5. Günlük sayının ürün davranışı

1. Yeni ve ilgili çalışmaların taranmış olması beklenir. **Belirli saatli işleyiş, kaynak/metadata alma, açık kurallarla filtreleme, tekrar tespiti, durum takibi ve çıktı düzeni gibi deterministik işler LLM çağrısıyla yapılmaz.**
2. Yalnızca gündem olmuş olanlar değil, **yenilik / kanıt / ilgi / çeşitlilik** açısından değerli bulunanlar seçilir.
3. Aynı iddiayı işleyen yinelenen çalışmalar tek bir hikâyede birlikte tartışılabilir.
4. Önemli bulgu yoksa sırf sayfa doldurmak için içerik uydurulmaz.
5. Önceki sayılarda ele alınmış çalışmalar sebepsiz tekrar edilmez; anlamlı güncelleme varsa açıkça belirtilir.
6. Okur kaynak ve makale sayfasına gidebilir.
7. Ortaya **yayınlanmış, tarihli, geri dönüp okunabilen bir sayı** çıkar.
8. **Claude API, yalnızca semantik değerlendirme, bilimsel yorumlama ve okurun bilgi birikimine göre yazma gibi gerçek dil/anlam işleri için kullanılır.** Gereksiz çağrılar azaltılır; harcama ve hata davranışı görünür olur.

**Günlük sayı**: Başlangıç tasarım hedefi yaklaşık **5–8 sayfa**; bu bir kota değil.  
**Haftalık özel sayı**: Gelecekte pazartesi yaklaşık **12–15 sayfa** düşünülebilir; MVP için bloklayıcı değildir.

## 6. Yazı türleri — ürün beklentisi

- **Kapak dosyası:** En anlamlı yeni çalışma ya da aynı hikâyeyi aydınlatan bir grup çalışma; tek başına okunabilir ve güçlü bağlamı var.
- **Kısa haber:** Bir yeni sonucu 2–4 dakikada anlaşılır kılan metin.
- **Karşılaştırmalı değerlendirme:** Bu çalışma önceki yönteme göre ne değiştiriyor, neyi değiştirmiyor?
- **Temkin notu:** Ölçek, örneklem, deney ortamı, hakemlik durumu gibi sınırlar.
- **Kaynak kartı:** Başlık, yazar(lar), yayın tarihi, yayın/preprint durumu, kaynak bağlantısı.

Tek bir sayı bu türlerin tamamını bulundurmak zorunda değildir.

## 7. Kullanıcının gerçekten aldığı değer

Okuyucunun dergi sonrasında cevaplayabilmesi gereken sorular:

1. İlgi alanımda **yeni** ne olmuş?
2. Bundan önce durum neydi, bu çalışma neyi değiştirdi?
3. Hangi deney veya veri bu iddiayı destekliyor?
4. Sonuç ne kadar güçlü, ne kadar genellenebilir?
5. Merak edersem asıl çalışmayı nereden okuyabilirim?

**Başarı metriği:** Sırf kaç makaleyi özetlediğimiz değil, okurun doğru bilgiyle bilgilendirilmiş ve merak etmiş olması.

## 8. Salı demosunda zorunlu ürün kapsamı

- En az iki farklı araştırma alanı seçimi, her biri için **ayrı öncelik ve bilgi seviyesi** ve tercihlerin korunması.
- Gerçek, güncel, referanslanabilir araştırmalardan üretilmiş **bir örnek sayı**.
- Kapak, içindekiler, en az bir derin dosya, kısa bölümler, kaynaklar.
- Kaynak/makale iddialarının izlenebilirliği; preprint işaretleri.
- Okunabilir sayfa düzeni ve **PDF olarak erişilebilir yayın**.
- Yayını yeniden oluşturmayı / yeni sayı oluşturmayı gösterebilen bir kullanım yolu.
- Kullanıcının belirlediği saat/zaman diliminde her sabah yayın hedefi için **hazırlanmış ve doğrulanabilir otomatik çalışma davranışı**.
- **Tek kurulumda self-hosting deneyimi** ve **deterministik işlerde gereksiz Claude API kullanımı yapılmadığının** gösterimi.
- Kurulum sahibinin bilgisayarında veya seçtiği sunucuda çalışan, **canlı etkileşimle gösterilebilir** bir uygulama; yalnızca kayıtlı video yeterli değil.
- Kullanıcının kod yazmasını gerektirmeyen işletim / inceleme deneyimi.

Bunlar **neyle, hangi servisle veya hangi topolojiyle** yapılacağına dair talimat değildir.

## 9. Bilinçli olarak kapsam dışı

İlk demoda şart olmayanlar: herkese açık üyelik, sosyal özellikler, ödeme, mobil uygulama, karmaşık abonelik yönetimi, haftalık özel baskı, çok dilli tam destek, sınırsız araştırma alanı, makalenin PDF tam metnine erişilemediği halde tam metin analizi iddiası.

## 10. Ürün kararları — henüz kilitlenmeyenler

- Günlük yayının **varsayılan** kaçta hazır olacağı; kullanıcının saat/zaman dilimi ayarından bağımsız değerlendirilir.
- Varsayılan dergi uzunluğu ve farklı okuyucu derinliği ayarlarının UX'i.
- Türkçe dışında ilk ek dil.
- Günlük sayıların okuyucuya nasıl haber verileceği (site, e-posta, vb.).
- Kapak/görsel stratejisi: özgün çizimler, açık lisanslı görseller veya tipografik kapak.
- Daha sonra haftalık özel sayı eklenip eklenmeyeceği.

**Self-hosted çalışma ve deterministik-first, bütçe duyarlı kullanım ürün gereksinimidir. Mimari, kod tabanı, model seçimi, veri erişimi, iş zamanlama aracı ve deployment teknik kararları bu belgeyle alınmamıştır.** Ayrıntılar için [çalışma ilkeleri](OPERATING_PRINCIPLES.md).

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
