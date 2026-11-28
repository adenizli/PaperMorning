# PaperMorning

**Kendi bilgisayarında veya kendi seçtiğin sunucuda barındırabildiğin; birden fazla okuyucuya kişisel bilim dergilerini her sabah 08.00'de e-posta olarak ulaştıran sistem.**

PaperMorning, akademik makaleleri arka arkaya özetleyen bir liste değil; yeni bilimsel çalışmaları takip ederek okura **bu hafta/dün ne değişti, neden önemli ve kanıt ne kadar güçlü?** sorularını yanıtlayan kişisel bir dijital yayın fikridir. **Her sayının sonundaki Ufuk Raporu**, makaleleri birleştirerek akademik araştırma soruları ve sektörde denenebilir fırsatlar önerir.

> Okur, konuyu hiç bilmiyorsa merak duyarak temel fikri kavramalı; konuyu biliyorsa araştırmanın gerçek yeniliğini, delillerini ve sınırlarını anlayabilmelidir.

## İlk gösterimin hedefi

**Salı, 24 Kasım 2026:** Seçilmiş araştırma alanlarında gerçek makalelerden beslenen, okunabilir bir dergi sayısı üretebilen ve canlı bir ortamda gösterilebilen uçtan uca MVP.

İstenen kalıcı ürün, her kullanıcı için kendi zaman diliminde **sabah 08.00'de e-posta teslimini** hedefleyen, dergiyi önceden üreten sistemdir. **Merkezi SaaS zorunlu değildir; self-hosting esastır.** Claude API, deterministik yapılabilen işler için değil, gerçekten araştırma yorumlama ve yazı hazırlama gereken adımlar için kullanılmalıdır. Pazartesi gününe özel daha uzun haftalık sayı fikri daha sonra değerlendirilebilir; salı günkü demoyu geciktirmemelidir.

## Ürün belgeleri

- [Ürün vizyonu ve MVP kapsamı](docs/PRODUCT_VISION.md)
- [Editoryal ilkeler ve kalite çıtası](docs/EDITORIAL_STANDARDS.md)
- [Salı demo senaryosu ve kabul kriterleri](docs/DEMO_ACCEPTANCE.md)
- [Self-hosting, günlük çalışma ve API maliyeti ilkeleri](docs/OPERATING_PRINCIPLES.md)
- [Çok kullanıcılı kayıt ve 08.00 e-posta teslimi gereksinimleri](docs/MULTI_USER_EMAIL_REQUIREMENTS.md)
- [**Lean MVP kapsamı — güncel kararlar**](docs/LEAN_MVP_SCOPE.md)
- [**MVP mimari sözleşmesi — NestJS, PostgreSQL, React/Electron, 3 alanlı hesap**](docs/ARCHITECTURE_MVP.md)
- [**Ufuk Raporu — akademik ve sektörel öngörü**](docs/OUTLOOK_AND_OPPORTUNITIES.md)

## Yetki ve çalışma sırası

1. **Ürün vizyonu ve editoryal hedefler:** Bu belgelerde tanımlanır.
2. **Sistem mimarisi ve teknik kararlar:** Proje sahibi tarafından tasarlanır ve onaylanır. Bu repo, henüz mimari seçimi yapmaz.
3. **Uygulama:** Mimari onayından sonra Claude Code'a verilir.
4. **Review ve yayın:** Proje sahibi çıktı kalitesini, davranışı ve deploy sonucunu inceler.

**Güncel P0 ürün kapsamı için [LEAN_MVP_SCOPE.md](docs/LEAN_MVP_SCOPE.md), kesinleşmiş teknik kararlar için [ARCHITECTURE_MVP.md](docs/ARCHITECTURE_MVP.md) belirleyicidir.** NestJS, PostgreSQL, TypeORM, React/Vite/React Router ve Electron seçilmiştir; uygulama modüllerinin ayrıntılı sınırları ayrıca görüşülecektir. Self-hosted çalışma, çok kullanıcılı basit kayıt (**kullanıcı adı, e-posta, şifre; doğrulama e-postası yok**), güvenli giriş (**3 saatlik token, refresh yok**), web/PDF arşivi, yazı 👍/👎 geri bildirimi, görev bazlı Haiku/Sonnet/istisnai Opus kullanımı, 08.00 e-posta teslimi ve deterministik-first işleme ürün gereksinimleridir. Bunların *nasıl* gerçekleştirileceğine proje sahibi karar verir.

## Değişmez ürün ilkesi

**Güvenilir ve okunabilir az sayıda araştırma, hatalı veya yüzeysel çok sayıda içerikten daha değerlidir.**

Bu repo, ürün sözleşmesi belgeleriyle birlikte PaperMorning **backend** uygulamasını (NestJS + PostgreSQL + TypeORM) içerir. React/Electron istemcisi ayrı bir repodadır.

## Backend: geliştirme ve çalıştırma

Gereksinimler: Node.js 22+, Docker (PostgreSQL için) veya erişilebilir bir PostgreSQL 14+.

```bash
cp .env.example .env              # yer tutucu parolaları değiştirin
docker compose up -d postgres     # kalıcı volume ile PostgreSQL
npm ci
npx playwright install chromium   # PDF için headless Chromium (~100 MB, bir kez; Linux'ta: --with-deps)
npm run build
npm run migration:run             # şema yalnızca açık migration'larla oluşur (synchronize: false)
npm start                         # http://localhost:3000/api/health
```

| Komut | Açıklama |
|---|---|
| `npm run start:dev` | TypeScript kaynağından çalıştırır (`.env` yüklenir) |
| `npm run build` | `dist/` derlemesi |
| `npm run lint` / `npm run format:check` | ESLint + Prettier kontrolleri |
| `npm test` | Tüm testler (unit + PostgreSQL gerektiren integration/module-init/e2e) |
| `npm run test:unit` | Yalnızca veritabanı gerektirmeyen unit testler |
| `npm run migration:run` / `migration:revert` / `migration:show` | Derlenmiş `dist/` üzerinden migration yönetimi |
| `npm run migration:generate -- src/service/persistence/migrations/<Ad>` | Entity değişikliğinden migration taslağı üretir (gözden geçirilerek commit edilir) |

### Docker ile tek komutla (sunucu + PostgreSQL)

```bash
cp .env.example .env              # POSTGRES_PASSWORD, JWT_SECRET vb. doldurun
docker compose up -d --build      # migration'lar açılışta açıkça çalıştırılır, ardından sunucu başlar
curl http://127.0.0.1:3000/api/health
```

- İmaj: Node 22 + Playwright'ın kurduğu Chromium headless shell ve sistem kütüphaneleri + Türkçe karakter kapsamı için `fonts-dejavu-core` ve `fonts-noto-core` (Debian paketleri; repoda font dosyası yok). Boyut yaklaşık 1,5 GB; tarayıcı indirmesi bunun önemli bir kısmıdır.
- PDF'ler `papermorning-data` volume'ünde (`/data/private`) saklanır; web kökünden **asla** sunulmaz, yalnızca sahiplik kontrollü `GET /api/issues/:id/pdf` ile indirilir. Veritabanı ve bu volume birlikte yedeklenmelidir.
- **Chromium sandbox ve konteyner sertleştirme:** `PDF_CHROMIUM_SANDBOX=auto|true|false`, varsayılan `auto`: doğrudan bir makinede sandbox **açık**, resmî imajda (`PAPERMORNING_RUNTIME=container`) **kapalı**. Ayrıcalıksız, tüm yetkileri düşürülmüş ve `no-new-privileges` ile çalışan bir konteynerde Chromium'un kendi sandbox'ı başlatılamaz (`Chromium sandboxing failed!`). `docker-compose.yml` bu yüzden sunucu konteyneri için **sabit** `PDF_CHROMIUM_SANDBOX: 'false'` kullanır ve değeri `.env`'den almaz: daha önce host için doğru olan `.env` satırı (`true`) compose üzerinden konteynere sızıyor ve her PDF render'ını bozuyordu. Konteyner içinde açıkça `true` verilirse uygulama ilk render'da değil **açılışta** anlaşılır bir hata ile durur; açılış logu etkin modu ve nedenini yazar (`Chromium sandbox OFF (auto, runtime container)`).
  - Konteynerin kendisi sınırdır: root olmayan kullanıcı, `cap_drop: [ALL]` (etkin yetki seti boş), `no-new-privileges`, Docker'ın varsayılan seccomp profili, salt okunur kök dosya sistemi (yazılabilir yalnızca `/data` volume'u ve `noexec` 256 MB `/tmp` tmpfs), `pids_limit: 256`, 1.5 GB bellek sınırı ve yetim Chromium süreçlerini toplayan `init`. Belgede JavaScript kapalıdır, tüm ağ ve `file://` istekleri engellenir ve içerik tamamen kaçışlanmış sunucu verisidir. Ayrıcalıklı konteyner, `cap_add`, `seccomp=unconfined` veya host genelinde güvenlik ayarı değişikliği **kullanılmaz** (bir test bunu denetler).
  - **Ödünleşim:** bu önlemler Chromium sandbox'ının süreç içi izolasyonuna eşdeğer değildir; render sürecindeki bir istismar konteyner içindeki Node süreciyle aynı kullanıcıyı ve `/data`'daki PDF arşivini görebilir. Riski sınırlayan şey, Chromium'a yalnızca kendi ürettiğimiz, kaçışlanmış ve dış kaynak içermeyen HTML'in verilmesidir. Sandbox'ı konteynerde açmak isteyen operatör Chromium'a uygun bir seccomp profili (veya user namespace desteği) sağlamalıdır.
  - Konteynerde doğrulama (veritabanı ve Claude gerekmez): `docker compose exec server node dist/bootstrap/cli.js pdf:smoke`.
- Makine uyku/kapalıysa zamanlanmış işler çalışamaz; sürekli açık bir ortam gerekir.

### Günlük zamanlayıcı (08:00 yerel saat)

- **Tek sunucu süreci** dakikada bir iki tetikleme çalıştırır (hazırlık ve teslim ayrı; uzun bir hazırlık başka okurun 08:00 e-postasını geciktirmez). Kullanıcı başına cron, kuyruk veya ayrı işçi yoktur. Kalıcı otorite PostgreSQL kayıtlarıdır (`publication_run`, `issue`, `email_delivery`); bellek yalnızca aynı süreçte üst üste binmeyi engeller.
- Her okur için yerel tarih ve saat gerçek IANA saat dilimi kurallarıyla (yaz saati dahil) hesaplanır; sunucunun saat dilimi kullanılmaz.
- **06:00 yerel** (`SCHEDULER_PREPARE_LOCAL_TIME`): sayı hazırlığı başlar. Bu bir başlangıç hedefidir, bitiş garantisi değildir.
- Hazırlık **sınırlı eşzamanlılıkla** çalışır (`SCHEDULER_PREPARATION_CONCURRENCY`, varsayılan 2): yavaş bir okur yalnızca bir slotu tutar, diğer okurları ve sonraki tick'leri bekletmez; hâlâ süren bir okur ikinci kez başlatılmaz. Okur/gün tekilliği yine PostgreSQL'dedir (`publication_run`). Aynı konunun ortak araştırması başka bir okur için o an çalışıyorsa hazırlık onu (en fazla 20 dk) bekler. Claude harcaması atomik günlük bütçe rezervasyonuyla sınırlıdır. Geç pencere kuralı bir ürün tercihidir: pencere kapandıktan sonra o gün için otomatik ücretli hazırlık yapılmaz (operatör CLI ile web için yine yayımlayabilir).
- **08:00 yerel**: yalnızca açıkça abone olan okura, **bugünün** READY sayısı PDF ekiyle gönderilir. Sayı hazır değilse gecikme `publication_run.late_at` ile kaydedilir. Sayı `08:00 + SCHEDULER_LATE_WINDOW_MINUTES` içinde hazır olursa geç de olsa bir kez gönderilir. Bu pencereden sonra e-posta gönderilmez ve o gün için otomatik (ücretli) hazırlık yapılmaz; eski bir sayı asla bugünün sayısı gibi gönderilmez.
- Saat dilimi değişikliği yalnızca sonraki günleri etkiler; aynı yerel gün için ikinci sayı veya e-posta oluşmaz.
- **Makine uyku/kapalıysa** zamanlanmış işler çalışmaz; 08:00 teslimi için sürekli açık bir ortam gerekir. Sunucu tekrar açıldığında kaydedilmiş adımlardan devam eder.
- Saati beklemeden deneme: `npm run cli -- scheduler:plan --at 2026-11-24T05:00:00Z` (yalnızca plan, hiçbir şey yapmaz) ve `scheduler:tick --at … [--send]` (gerçek hazırlık; e-posta yalnızca `--send` ile).

### E-posta (SMTP)

- Kurulum sahibi kendi SMTP sağlayıcısını `SMTP_*` değişkenleriyle tanımlar. `SMTP_HOST` boşsa uygulama yine çalışır, sayılar ve PDF'ler üretilir; teslimatlar `DISABLED` görünür, asla `SENT` değil.
- Güvenlik: `starttls` (587) TLS yükseltmesini **zorunlu** kılar; `tls` (465) doğrudan TLS'tir. Sertifika doğrulaması açıktır. Düz metin veya doğrulanmamış sertifika yalnızca geliştirmede `SMTP_ALLOW_INSECURE=true` ile mümkündür; production'da açılış hatası verir. Port/güvenlik uyumsuzlukları (465 + starttls gibi) açılışta reddedilir.
- Her e-posta okunabilir metin + HTML özet, kaynak bağlantıları, Ufuk Raporu ön izlemesi, (tanımlıysa) `PUBLIC_BASE_URL` web bağlantısı ve **kişisel PDF'in kendisini ek olarak** içerir. Yalnızca bağlantı gönderimi yapılmaz. `PUBLIC_BASE_URL` yalnızca ev ağında erişilebilen bir adresse dışarıdaki okur bağlantıyı açamaz; PDF eki bu yüzden zorunludur.
- Sonuç sınıflandırması: SMTP'nin kabul etmesi `SENT`'tir ve **gelen kutusuna ulaştığının kanıtı değildir**. Kesin ret `FAILED` olur (4xx geçici, 5xx kalıcı; kimlik doğrulama ve TLS hataları yapılandırma düzeltilince yeniden denenebilir). Sunucu `354` (DATA başlat) yanıtını verdikten sonra bağlantı koparsa mesaj alınmış olabilir: durum `UNKNOWN` olur ve **otomatik yeniden gönderilmez**. Operatör sağlayıcıyı kontrol edip `delivery:resolve --as SENT|RETRY` ile karar verir.
- Abonelikten çıkma: okur Ayarlar → Günlük e-posta seçeneğini kapatır (`PUT /api/preferences`, `dailyEmailEnabled=false`). Güvensiz tek tıklık bağlantı yoktur.
- Demo için yerel posta kutusu: `docker compose --profile mail-sink up -d mailpit` (arayüz: http://127.0.0.1:8025).

### Hesap ve oturum

- Kayıt yalnızca `username`, `email`, `password` alır (`POST /api/auth/register`); fazladan alan 400 ile reddedilir. **E-posta doğrulaması yoktur.**
- Giriş: `POST /api/auth/login` (`identifier` = kullanıcı adı veya e-posta). **3 saat sabit ömürlü** erişim belirteci; refresh/yenileme yoktur, süre dolunca yeniden giriş yapılır.
- Tarayıcı: belirteç yalnızca `HttpOnly; SameSite=Strict; Path=/api` cookie'de tutulur (HTTPS'te `Secure`). Cookie ile yapılan yazma isteklerinde `Origin` aynı kaynak veya `CORS_ORIGINS` içinde olmalıdır.
- Masaüstü (Electron) istemcisi: girişte `X-PaperMorning-Client: desktop` başlığı gönderir, yanıttaki `accessToken`'ı ana süreçte güvenli depolar (ör. Electron `safeStorage`) ve `Authorization: Bearer` ile kullanır. Tarayıcı güvenliğini kapatmak veya `*` CORS gerekmez.
- Çıkış (`POST /api/auth/logout`) cookie'yi siler. Belirteç durumsuz olduğu için daha önce sızdırılmış bir belirteç 3 saat dolana kadar geçerli kalır (bilinçli MVP ödünleşimi).
- **Operatör notu:** E-posta sahipliği doğrulanmadığından biri başkasının adresiyle kayıt olabilir. Günlük e-posta bu yüzden kayıtta değil, tercihlerden **açıkça** etkinleştirilir; `REGISTRATION_ENABLED`, `MAX_USERS` ve hız sınırı ile birlikte riski azaltır ama tamamen önlemez.

### Operatör CLI (yalnızca sunucu ortamında)

Pahalı işler için herkese açık HTTP endpoint'i yoktur; operatör aynı yapılandırmayla CLI kullanır:

```bash
npm run build
npm run cli -- research:run --topics robotics,quantum-physics --days 7 --cap 3   # keşif -> eleme -> analiz
npm run cli -- llm:usage                                                         # bugünkü Haiku/Sonnet çağrıları ve maliyet
npm run cli -- publication:prepare --user <kullanıcı> --date 2026-11-24         # kişisel sayıyı hazırla (idempotent)
npm run cli -- publication:status --user <kullanıcı> --date 2026-11-24          # salt okunur: durum, deneme, bekleme, sonraki adım
npm run cli -- issue:preview --issue <id> [--out <yeni.pdf>|-]                   # salt okunur, Claude'suz QA önizlemesi
npm run cli -- delivery:send --user <kullanıcı> --date 2026-11-24               # GERÇEK gönderim: opt-in + READY + PDF eki şart
npm run cli -- delivery:resolve --delivery <id> --as SENT|RETRY                  # UNKNOWN teslimat için operatör kararı
npm run cli -- system:check                                                      # etkin anahtarlar (sırlar yazılmaz)
npm run cli -- pdf:smoke                                                         # veritabanısız gerçek Chromium render testi
```

Docker'da aynı komutlar `docker compose exec server node dist/bootstrap/cli.js <komut> …` biçimindedir. Her komut stdout'a **tek bir JSON belgesi** yazar (`command`, `outcome`, ayrıntılar, `exitCode`); loglar stderr'e gider, bu yüzden çıktı doğrudan `jq` ile okunabilir. Çıkış kodları:

| Kod | Anlam | `outcome` |
|---|---|---|
| 0 | Tamam | `READY`, `SENT`, `ALREADY_SENT`, `OK` |
| 1 | Başarısız | `FAILED`, `UNKNOWN` (belirsiz teslimat; operatör kararı gerekir), `ERROR` |
| 2 | Kullanım hatası | `USAGE_ERROR` |
| 3 | Tasarım gereği bir şey yapılmadı | `SKIPPED`, `NOT_OPTED_IN`, `NOT_READY`, `DISABLED` |
| 75 | Geçici, sonra tekrar deneyin | `IN_PROGRESS` |

Salt okunur komutlar (`publication:status`, `scheduler:plan`, `llm:usage`, `system:check`) yanıt verebildikleri sürece 0 ile çıkar; durum `outcome`/`state` alanındadır. `publication:prepare` başarısızlıkta `retry` alanında deneme sayısını, üst sınırı, hata türünü ve bir sonraki denemenin en erken zamanını (`nextAttemptAt`) gösterir; veritabanında elle değişiklik gerekmez. Yayımlanmış bir sayıyı yeni şablonla değiştirmeden incelemek, gerçek SMTP testi ve zamanlayıcının kontrollü açılışı için adım adım prosedürler: [docs/OPERATIONS.md](docs/OPERATIONS.md).

### Yayın ve teslimat davranışı

- Okur/yerel tarih başına **tek** sayı (`issue` tablosunda benzersiz). Hazırlık aşamaları (`SELECTING → WRITING → OUTLOOK → RENDERING → READY`) `publication_run` içinde kaydedilir; yeniden başlatmada tamamlanan pahalı adımlar tekrarlanmaz.
- Yayımlanan sayının içeriği **değiştirilemez**: veritabanı tetikleyicisi dondurulmuş içeriği ve READY olduktan sonra PDF referansını korur. Web API ve PDF aynı anlık görüntüden üretilir; Ufuk Raporu her zaman son bölümdür.
- **Eşzamanlılık:** Sayı hazırlama çalıştırması, yazı varyantları ve Ufuk Raporu üretimi süreli claim + fencing token ile korunur; süresi dolup devralınan bir işi eski worker artık yazamaz. Bir sayının PDF'ini aynı anda tek bir worker oluşturur (render claim); PDF anahtarı içerik adreslidir (`issues/<kullanıcı>/<sayı>-<sha256>.pdf`), bu yüzden READY sayının dosyası hiçbir yazıcı tarafından değiştirilemez. Saklanıp doğrulanmış ama READY'ye geçememiş bir PDF yeniden denemede tekrar render edilmeden kullanılır.
- **Ufuk Raporu paylaşımı:** Aynı araştırma paketi, dil, bilgi düzeyi, model ve prompt sürümü için rapor bir kez üretilir (`outlook_generation` teknik claim/önbellek tablosu). Rapor, onu üreten sayı sonradan başarısız olsa bile kalıcıdır ve diğer okurlar tarafından yeniden kullanılır; rapor modeli yine sayı içeriğinin parçasıdır.
- **Kanıta bağlılık (article-v2, outlook-v2):** Yazılar, makalenin bildirdiğini, bilinmeyeni ("özette belirtilmiyor") ve PaperMorning'in yorumunu ayırır; bildirilmeyen veriden sonuç çıkarılmaz (ör. "on kombinasyonun dokuzunda iyileşme" → onuncu hakkında hüküm yok), karşılaştırma tabanı/örneklem belirtilmemişse karşılaştırmalar nitelenir. Belirleyici bir denetim (`src/common/text/evidence-grounding.ts`) kaynak "k/n" bildirdiğinde kalan n−k durum hakkındaki belirsizlik işaretsiz cümleleri reddeder; ek Claude çağrısı yoktur. Sayısal denetim (`src/common/text/numeric-claims.ts`) sayıları yazımla değil **değerle** karşılaştırır: "Thirty-two" = "32", "470,000" = Türkçe "470.000" = "470 bin", "42.8" = "42,8"; kaynakta olmayan değer ("470" tek başına, "33", kaynak "1.2" iken "1.200") reddedilir ve hata mesajı alanı ile yakın metni gösterir. Sayıya yapışık harfler türüyle okunur ve kaynakta aynı türden kanıt ister: Türkçe "3B" (üç boyutlu) = "3D" bir boyuttur, "7B parametre" milyardır; boyut kanıtı bir miktarı, miktar kanıtı bir boyutu desteklemez. Tek makaleli sayılarda Ufuk Raporu tek çalışmanın eleştirel değerlendirmesidir (eğilim/uzlaşı iddiası yok, az ama test edilebilir fırsat); çok makaleli sayılarda çalışmalar arası sentez, uyuşma ve ayrışmalar. Prompt/şema sürümleri değiştiği için eski önbellek varyantları yeni sayılarda kullanılmaz; yayımlanmış sayılar değişmez.
- E-posta yalnızca **açıkça abone olan** okura, sayı READY ve PDF doğrulanmışsa gider; PDF **her zaman ektir**. SMTP sonucu belirsizse durum `UNKNOWN` olur ve otomatik yeniden gönderilmez.
- PDF, dondurulmuş anlık görüntüden sunucuda headless Chromium ile üretilir (LLM yok, ağ erişimi yok) ve atomik olarak özel depoya yazılır; sayı ancak PDF doğrulandıktan sonra READY olur. E-posta, operatörün SMTP sağlayıcısı üzerinden PDF ekiyle gönderilir (aşağıya bakın).

Desteklenen konu anahtarları `src/common/topic/topic-catalog.ts` içindedir. `ANTHROPIC_API_KEY` yoksa keşif ve kural tabanlı eleme yine çalışır; analiz `NOT_CONFIGURED` olarak görünür biçimde başarısız olur ve sonraki çalıştırmada kaldığı yerden devam eder.

**Bütçe ve eşzamanlılık:** Her Claude isteğinden önce en kötü durum maliyeti PostgreSQL'de atomik olarak rezerve edilir (`llm_usage`, advisory lock altında kısa bir transaction; devam eden çağrılar da sayılır), böylece eşzamanlı çağrılar birlikte `LLM_DAILY_BUDGET_USD`'yi aşamaz. Yanıt gelince rezervasyon gerçek token kullanımına göre kapatılır; zaman aşımı/kopan bağlantı gibi belirsiz sonuçlarda en kötü durum tutarı sayılmaya devam eder. Analiz ve araştırma çalıştırması kayıtları süreli bir sahiplik (lease) ve her claim'de yenilenen bir fencing token (`claim_token`) taşır: süresi dolup başka bir worker'a geçen kaydı eski worker artık güncelleyemez.

**Testler (dikkat: `npm test` test veritabanının şemasını SİLER):** Veritabanı testleri `TEST_DATABASE_URL` ile gösterilen veritabanında `public` şemasını silip tüm migration'larla yeniden kurar. Bu yüzden kurulum, hiçbir şeye bağlanmadan önce hedefi doğrular ve şüphede durur:

- `TEST_DATABASE_URL` **açıkça** verilmelidir (varsayılan yoktur); yalnızca `postgres://` URL'si, sorgu parametresi yok, veritabanı adı küçük harfli `<ad>_test` biçiminde ve `prod`/`production`/`staging`/`live` gibi sözcükler içermez.
- Sunucu yerel olmalıdır (`localhost`/`127.0.0.1`/`::1`); ayrılmış bir test sunucusu için yalnızca o host `PM_TEST_DB_ALLOW_HOST=<host>` ile açıkça izinlenebilir. `NODE_ENV=production` reddedilir.
- Uygulamanın kendi veritabanı (`DATABASE_URL`, ortamdan veya `.env` dosyasından) hedeflenemez; aynı host/port/ad farklı yazılsa bile.
- Yıkıcı SQL'den önce veritabanında kimlik işareti aranır: `COMMENT ON DATABASE … IS 'papermorning:disposable-test-database'`. Test kurulumu yalnızca **kendi oluşturduğu** veritabanını otomatik işaretler; mevcut ama işaretsiz bir veritabanı değiştirilmeden reddedilir.

- Testlerin kendi oluşturduğu yan veritabanları (Issue #18): koruma testleri yalnızca `pm_guard_<64 bit rastgele>_test|canary` adlı, **o çalıştırmada oluşturulan** veritabanlarını kullanır (`test/support/owned-test-databases.ts`). Aday ad sunucuda zaten varsa test durur; o veritabanı hiçbir şekilde değiştirilmez veya silinmez. Temizlikte yalnızca bu çalıştırmanın oluşturduğu ve OID'si ile sahiplik yorumu hâlâ eşleşen veritabanları silinir; sabit adlı (`papermorning_canary_test` gibi) hiçbir veritabanı `DROP` edilmez.
- Gerekli yetkiler: test rolü test sunucusunda `CREATEDB` yetkisine sahip olmalıdır (test veritabanını ve geçici koruma veritabanlarını oluşturmak için). Bu yüzden testleri **paylaşılan bir sunucuda (ör. üretim/Geveze PostgreSQL'i) çalıştırmayın**; yalnızca testlere ayrılmış, atılabilir bir sunucu ve rol kullanın.

Güvenli kurulum: ayrı, atılabilir bir PostgreSQL (tercihen ayrı bir konteyner ve yalnızca test için bir rol) kullanın, örn. `docker run -d --name pm-test-pg -e POSTGRES_USER=pm_test -e POSTGRES_PASSWORD=<rastgele> -p 127.0.0.1:55432:5432 postgres:16-alpine`, ardından `TEST_DATABASE_URL=postgres://pm_test:<rastgele>@localhost:55432/papermorning_test npm test` (veritabanı ilk çalıştırmada oluşturulup işaretlenir). Üretim kimlik bilgilerini asla test ortamına vermeyin. Yalnızca birim testleri: `npm run test:unit` (veritabanı gerekmez). Testler `.env` dosyasını yüklemez; yalnızca yukarıdaki karşılaştırma için okur.

**Ek test anahtarları:** Gerçek SMTP teslim testi yalnızca atılabilir bir Mailpit verildiğinde çalışır (`MAILPIT_API_URL=http://127.0.0.1:8025 MAILPIT_SMTP_PORT=1025`; CI kendi Mailpit'ini başlatır). `PM_PRINT_QA_DIR=<dizin>` ile PDF yerleşim testleri 1, 2 ve 6 makalelik örnek PDF'leri ve sayfa PNG'lerini görsel inceleme için o dizine yazar.

**Katmanlar:** `src/config` (doğrulanmış ortam yapılandırması), `src/bootstrap` (HTTP ayarları: `/api` öneki, DTO whitelist doğrulaması), `src/core` (uygulama çapı yetenekler: health), `src/service` (entegrasyon adaptörleri: persistence), `src/domain` (iş modülleri).
