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
```

Desteklenen konu anahtarları `src/common/topic/topic-catalog.ts` içindedir. `ANTHROPIC_API_KEY` yoksa keşif ve kural tabanlı eleme yine çalışır; analiz `NOT_CONFIGURED` olarak görünür biçimde başarısız olur ve sonraki çalıştırmada kaldığı yerden devam eder.

**Bütçe ve eşzamanlılık:** Her Claude isteğinden önce en kötü durum maliyeti PostgreSQL'de atomik olarak rezerve edilir (`llm_usage`, advisory lock altında kısa bir transaction; devam eden çağrılar da sayılır), böylece eşzamanlı çağrılar birlikte `LLM_DAILY_BUDGET_USD`'yi aşamaz. Yanıt gelince rezervasyon gerçek token kullanımına göre kapatılır; zaman aşımı/kopan bağlantı gibi belirsiz sonuçlarda en kötü durum tutarı sayılmaya devam eder. Analiz ve araştırma çalıştırması kayıtları süreli bir sahiplik (lease) ve her claim'de yenilenen bir fencing token (`claim_token`) taşır: süresi dolup başka bir worker'a geçen kaydı eski worker artık güncelleyemez.

**Testler:** `TEST_DATABASE_URL` (varsayılan `postgres://papermorning:papermorning@localhost:5432/papermorning_test`) adresindeki veritabanı yoksa oluşturulur, şeması **silinip** tüm migration'larla yeniden kurulur. Bu yüzden testleri asla gerçek verinin bulunduğu veritabanına yönlendirmeyin. Testler `.env` dosyasını okumaz.

**Katmanlar:** `src/config` (doğrulanmış ortam yapılandırması), `src/bootstrap` (HTTP ayarları: `/api` öneki, DTO whitelist doğrulaması), `src/core` (uygulama çapı yetenekler: health), `src/service` (entegrasyon adaptörleri: persistence), `src/domain` (iş modülleri).
