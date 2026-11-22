# PaperMorning — Salı Demoyu Kabul Kriterleri

> **Hedef gün:** Salı, 24 Kasım 2026.  
> Bu, **sunulacak deneyimin tanımıdır**. Teknik mimari, kod yapısı, cloud sağlayıcı, model veya araç seçimi **proje sahibine aittir**.

## A. Gösteride anlatacağımız hikâye

"PaperMorning'a kayıt olup ilgi alanlarımı söylüyorum. Her sabah saat 08.00'de, bilimsel kaynaklardan seçilmiş güncel araştırmalar hakkında bana özel bir dergi e-postası geliyor. Yalnızca başlık atmıyor; araştırmanın neden önemli olduğunu, neyi kanıtladığını ve neyi kanıtlamadığını açıklıyor. Orijinal çalışmaları açabiliyor, dergiyi PDF olarak okuyabiliyorum."

Demonun ana etkisi: **Sadece sohbet çıktısı değil; kendi editoryal mantığı olan, düzenli yayımlanan somut ürün.**

## B. Salı günü mutlaka gösterilecekler (P0)

### B1. Tercih deneyimi
- [ ] En az iki araştırma ilgi alanı belirlenebiliyor.
- [ ] Alan **önceliği** ve kullanıcının o alandaki **bilgi seviyesi** ayrı ayrı, anlaşılır biçimde seçilebiliyor.
- [ ] Tercihler kaydedilip tekrar açıldığında korunuyor.
- [ ] Aynı kurulumda **iki hesap** açılıp güvenli giriş yapılabiliyor; e-posta adresleri doğrulanabiliyor ve hesap kurtarma yolu mevcut.
- [ ] Kullanıcıların tercihleri, yayınları ve abonelik ayarları birbirinden izole.

### B2. Gerçek veriyle içerik
- [ ] Gerçek, tarihlenebilir bilimsel çalışmalardan en az **üç** özgün kaynak kullanılmış.
- [ ] Seçilen konulardan en az ikisi sayıda temsil edilmiş (uygun kaynak bulunuyorsa).
- [ ] Her haberin kaynağına giden çalışır bir bağlantısı var.
- [ ] Preprint ile hakemli yayın durumu doğru ayırt edilmiş.
- [ ] En az bir derin yazı araştırmanın *problem / yenilik / yöntem veya kanıt / sınırlamalar* boyutlarını gerçekten anlatıyor.
- [ ] İçeriği kontrol ettiğimizde kaynağa dayanmayan performans sayısı, deney veya sonuç iddiası bulunmuyor.
- [ ] Aynı kaynaktan kopyalanmış uzun pasajlar veya lisans sorunu olan görseller kullanılmıyor.

### B3. Dergi deneyimi
- [ ] Sayının adı, tarihi ve ayırt edilebilir bir kapağı var.
- [ ] İçindekiler veya net bir bölüm navigasyonu var.
- [ ] Kapak dosyası, diğer yazılar ve kaynaklar ayrışıyor.
- [ ] Sayfalar gerçekten okunur; kopan metin, taşan başlık, boş/tekrarlanan sayfa yok.
- [ ] Kullanıcı **PDF** açabiliyor / indirebiliyor.
- [ ] Daha sonra yeniden açılabilen bir sayı mevcut.

### B4. Tekrar üretilebilirlik
- [ ] Bir sayı oluşturma işlemi kullanıcı tarafından demoda başlatılabiliyor veya denetlenebiliyor.
- [ ] Oluşturulan çıktı sadece önceden elle yazılmış sabit demo içeriği değil; gerçek kaynaklardan yeniden sayı üretilebiliyor.
- [ ] Hata olursa kullanıcıya ya da operatöre başarısızlık belli oluyor; eski sayı "bugün yayımlandı" diye sunulmuyor.
- [ ] Aynı günlük sayı birden çok kez istemeden çoğaltılmıyor.
- [ ] Salı günü farklı kullanıcıların zaman dilimleri dikkate alınarak **08.00 teslim hedefi** için otomatik çalışma hazırlanmış; beklemeden test edilip gerçek e-posta alınabiliyor. Ertesi sabahı beklemeden canlı deneme veya kayıtlarla kanıt sunulmalı.

### B5. Gösterilebilir self-hosted çalışma
- [ ] Uygulama, kurulum sahibinin bilgisayarında veya onun seçtiği sunucuda çalışıyor; geliştiricinin işlettiği merkezi SaaS'a bağımlı değil.
- [ ] İki hesap farklı kişisel sayılar görüyor; paylaşılan bir kaynağın bilimsel analizi gereksiz tekrar Claude çağrısı olmadan yeniden kullanılabiliyor.
- [ ] Proje sahibi ve demo katılımcıları canlı bir kurulum üzerinden yayını görebiliyor (gerekirse sahibinin ekranından).
- [ ] Bir uygulama hatası / eksik izin demoyu tamamen durdurmuyor; en azından son başarılı sayı görülebiliyor ve tarihi açık.
- [ ] API anahtarları, gizli bilgiler veya özel kullanıcı verileri ekran görüntüsüne, repoya veya kullanıcı arayüzüne sızmıyor.
- [ ] Demo sonunda hangi parçaların gerçekten canlı, hangilerinin yalnızca hazırlanmış olduğu açıkça söylenebiliyor.
- [ ] Deterministik işlemler gereksiz Claude API çağrısı oluşturmuyor; çağrı sayısı ve maliyeti görülebiliyor.
- [ ] Yeniden deneme sırasında aynı işin gereksiz tekrar faturalandırılması ve çift sayı yayımlanması önleniyor.
- [ ] Yerel bilgisayar uyku/kapalıysa zamanlanmış işin otomatik çalışmasının garanti edilmediği kullanıcıya açık.
- [ ] Aboneliği kapalı veya doğrulanmamış hesaba günlük dergi gönderilmiyor; gönderim durumu izlenebiliyor.
- [ ] E-postanın içinde gerçekten okunabilir araştırma içeriği, kaynak linkleri ve tam sayıya güvenli erişim bulunuyor.

## C. Güçlü ama salı için bloklayıcı olmayanlar (P1)

- [ ] İsteğe bağlı SMS/push bildirimi (günlük e-posta artık P0).
- [ ] Daha uzun pazartesi özel sayısı.
- [ ] Geçmiş sayıları tarih veya konuya göre filtreleyebilme.
- [ ] Bilgi seviyesinden bağımsız **teknik detay tercihi** ve daha rafine kişiselleştirme.
- [ ] Okuma süresi, paylaşılabilir özel bağlantılar, çoklu dil.
- [ ] Sayının tercihlerini ve kaynaklarını açıklayan detaylı saydamlık raporu.

**P1 maddeleri, P0 eksikken parlatılmamalı.**

## D. Örnek salı demo akışı (5–7 dakika)

1. **30 saniye — Problem:** "Çok fazla makale var; ama hangi çalışma gerçekten yeni, bunu anlamak zor."
2. **60 saniye — Kayıt ve ilgi alanları:** İki farklı hesaba giriş yap; her biri için farklı **bilgi seviyesi/öncelik** göster.
3. **60 saniye — Bugünün sayısı:** Kapak, içindekiler ve sayfa düzenini göster.
4. **90 saniye — Bir dosyanın içine gir:** Önce bağlam, sonra yenilik, deney, sınırları oku. Kaynağı aç.
5. **60 saniye — Yeni sayı:** Oluşturma akışının gerçek kaynakla çalıştığını göster; başarısızlık durumunu gizleme.
6. **30 saniye — E-posta, PDF ve 08.00:** Gerçek test e-postasını aç, PDF'i ve arşivi göster; 08.00 teslim zamanlaması ile ortak analizde gereksiz token harcamama kanıtını göster.
7. **30 saniye — Sınırlar:** Nelerin MVP, nelerin sıradaki sürüm olduğunu söyle.

Süre örnektir; önemli olan sonucun gösterilmesidir.

## E. İleri sürüm için takip edilecek ürün metrikleri

- **Kaynak doğruluğu:** Rastgele seçilmiş iddiaların kaynakta bulunma oranı.
- **Editoryal yarar:** İnsan incelemesinde "Neyi değiştirdi?" sorusuna cevap verebilme.
- **Yenilik ve tekrar:** Güncel ama birbirinin kopyası olmayan seçki.
- **Okunabilirlik:** Meraklı ve alanı bilen iki değerlendiricinin ayrı görüşleri.
- **Operasyonel güven:** Planlanan sabahların kaçında geçerli, tarihli sayı hazır olduğu.
- **Maliyet:** Bir geçerli sayı üretmenin toplam maliyeti ve süre değişkenliği; deterministik işlemlerin LLM'e devredilmediğinin denetlenmesi.

Bunlar ürün/kalite ölçüleridir; herhangi bir izleme teknolojisi dayatmaz.

## F. Kasıtlı olarak açık bırakılan mimari konular

Bu belgenin **cevaplamadığı** sorular:

- Hangi uygulama çerçevesi, dil, veri tabanı veya hosting?
- Araştırma kaynaklarıyla nasıl entegrasyon kurulacak?
- Makaleleri ne zaman ve nerede biriktireceğiz?
- İçerik analizini tek model mi, ayrı aşamalar mı yapacak?
- Agent yaklaşımı, tool çağrıları ve insan onayı nasıl kurgulanacak?
- Dergi çıktısı hangi render mekanizmasıyla üretilecek?
- Zamanlama, tekrar deneme, idempotency ve hata geri kazanımı nasıl uygulanacak?
- Harcama sınırları, gözlemleme ve sürümleme nasıl tasarlanacak?

Bunlar **proje sahibinin ayrı mimari tasarımında** çözülür. Ürün sözleşmesi bunların hiçbirini önden kilitlemez.

**Kabul edilmiş ürün kısıtları:** Self-hosted-first; tek kurulumda çok kullanıcılı güvenli kayıt; kullanıcıya özel tercihler; yerel saat diliminde günlük 08.00 e-posta teslimi; ortak bilimsel analiz; deterministik-first; Claude API yalnızca gerekli semantik/yazınsal işler için. Ayrıntı: [Çalışma ve maliyet ilkeleri](OPERATING_PRINCIPLES.md) ve [çok kullanıcılı e-posta gereksinimleri](MULTI_USER_EMAIL_REQUIREMENTS.md).

## G. Claude Code'a devir ön şartı

**Mimari onaylanmadan kodlama emri verilmez.** Proje sahibi mimariyi tasarladıktan sonra:

1. Bu belgelerin ortaya koyduğu kullanıcı sonucuyla mimarinin uyuştuğu kontrol edilir.
2. Gerekirse teknik kapsam / P0 yeniden önceliklendirilir.
3. Claude Code'a mimari + ürün belgeleri birlikte verilir.
4. Kod, test, deployment ve son insan review süreci başlar.

## H. Demo öncesi son kapı: "Gerçekten hazır mı?"

Bir demo ancak şu dört soruya **evet** diyebildiğimizde kabul edilir:

1. "Bu sayının iddialarını özgün kaynaklarda kontrol edebiliyor muyum?"
2. "Başka biri yayını açınca onu bir dergi olarak okuyabiliyor mu?"
3. "Bugün başka kaynaklar geldiğinde yeni bir sayı üretebiliyor muyuz?"
4. "Her sabah yayımlanacağı iddiasının gerçekten çalışacağını gösteren kanıtımız var mı?"

**Özet:** Süslenmiş statik PDF, MVP'nin tamamlandığı anlamına gelmez. Çalışan makale işleme ama bozuk sayfa düzeni de tamamlanmış bir PaperMorning değildir.
