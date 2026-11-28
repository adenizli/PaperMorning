# PaperMorning — İşletim prosedürleri (v1.1)

> Operatör için adım adım prosedürler: güncelleme, ücretsiz PDF önizlemesi, kontrollü gerçek yayın, Mailpit ve gerçek SMTP testi, zamanlayıcının kontrollü açılışı. Komutlar Docker Compose kurulumu içindir (`docker compose exec server node dist/bootstrap/cli.js …`); geliştirme ortamında aynı komutlar `npm run cli -- …` ile çalışır.

## 0. Değişmez kurallar

- **READY sayılar değişmez.** Dondurulmuş içerik veritabanı tetikleyicisiyle, PDF baytları içerik adresli anahtar ve SHA-256 ile korunur. Hiçbir prosedür mevcut bir sayıyı yeniden üretmez, silmez veya PDF'ini değiştirmez (2026-11-26 sayısı dahil).
- **Yeni metin = yeni sayı kimliği.** Yeni prompt sürümleriyle (article-v2, outlook-v2) yazılmış metin yalnızca **yeni bir tarih** için hazırlanan sayıda görünür. Eski bir tarihi "yeniden üretmek" için kayıt silinmez; eski önbellek kayıtları da (v1 varyantlar/raporlar) yeni sayılarda kullanılmaz, çünkü parmak izleri prompt/şema sürümünü içerir.
- **Hiçbir şey sessizce açılmaz.** `SCHEDULER_ENABLED`, `MAIL_ENABLED` ve okurun `dailyEmailEnabled` tercihi yalnızca operatörün açık kararıyla değişir. `system:check` etkin durumu sırları yazmadan gösterir.
- **Testler üretim veritabanında çalıştırılmaz.** `npm test` test veritabanının şemasını siler; yalnızca atılabilir bir PostgreSQL'de çalıştırın (README "Testler").

## 1. Çıktı ve çıkış kodları

Her komut stdout'a tek bir JSON belgesi yazar; loglar stderr'dedir. `jq` ile okunabilir:

```bash
docker compose exec -T server node dist/bootstrap/cli.js publication:status --user <u> --date 2026-11-26 | jq .
```

| Kod | Anlam |
|---|---|
| 0 | Tamam (`READY`, `SENT`, `ALREADY_SENT`, `OK`) |
| 1 | Başarısız (`FAILED`, `UNKNOWN`, `ERROR`) |
| 2 | Kullanım hatası |
| 3 | Tasarım gereği bir şey yapılmadı (`SKIPPED`, `NOT_OPTED_IN`, `NOT_READY`, `DISABLED`) |
| 75 | Geçici (`IN_PROGRESS`), sonra tekrar deneyin |

`publication:status` sonraki adımı da söyler: `NONE` (READY), `PREPARE` (şimdi denenebilir), `WAIT` + `at` (geri çekilme veya başka bir worker'ın kirası), `MANUAL` (kalıcı hata ya da deneme hakkı bitti). Geri çekilme süresi `PUBLICATION_RETRY_BACKOFF_MINUTES × 2^(deneme−1)`; deneme hakkı `PUBLICATION_MAX_ATTEMPTS`.

## 2. Güncelleme (Geveze)

Önce yayımlanmış sayıların durumunu kaydedin (salt okunur sorgu; eski sürümde `publication:status` henüz yoktur):

```bash
cd <papermorning-dizini>
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "SELECT id, issue_date, status, content_hash, pdf_storage_key, pdf_sha256, pdf_size_bytes, published_at FROM issue ORDER BY issue_date, id"' > issues-before.txt
cat issues-before.txt
```

Yedek (veritabanı + PDF arşivi birlikte):

```bash
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > ~/papermorning-$(date +%F).dump
docker run --rm --volumes-from "$(docker compose ps -q server)" -v "$HOME":/backup alpine \
  tar czf /backup/papermorning-data-$(date +%F).tgz -C /data .
```

Kod ve imaj:

```bash
git fetch origin && git checkout main && git pull --ff-only
docker compose build server
docker compose up -d
docker compose logs --tail=80 server
```

Logda beklenenler: migration adımı (`No migrations are pending` — bu sürüm şema değiştirmez) ve `PDF template issue-print-v2; Chromium sandbox OFF (explicit, runtime container)`. `.env` içindeki `PDF_CHROMIUM_SANDBOX` satırı artık konteyneri etkilemez (compose sabit `false` kullanır); host için `auto` önerilir.

Geri dönüş: önceki commit'e `git checkout <önceki-sha>` ve `docker compose build server && docker compose up -d`. Şema değişmediği için veritabanı geri dönüşü gerekmez.

## 3. Doğrulama planı (deploy sonrası)

1. **Sağlık ve yapılandırma**

   ```bash
   curl -fsS http://127.0.0.1:3000/api/health
   docker compose exec -T server node dist/bootstrap/cli.js system:check | jq .
   ```

   Beklenen: `runtime: "container"`, `pdf.sandbox` OFF, `scheduler.enabledInServer: false`, `mail.enabled: false` (şu anki üretim ayarı).

2. **Konteynerde PDF duman testi** (veritabanı ve Claude yok):

   ```bash
   docker compose exec -T server node dist/bootstrap/cli.js pdf:smoke; echo "exit=$?"
   ```

3. **Yayımlanmış sayılar değişmedi**

   ```bash
   docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "SELECT id, issue_date, status, content_hash, pdf_storage_key, pdf_sha256, pdf_size_bytes, published_at FROM issue ORDER BY issue_date, id"' > issues-after.txt
   diff issues-before.txt issues-after.txt && echo "published issues unchanged"
   docker compose exec -T server node dist/bootstrap/cli.js publication:status --user <okur> --date 2026-11-26 > status-2026-11-26.json
   jq '{state, issue, next}' status-2026-11-26.json
   ```

4. **Ücretsiz önizleme** (bölüm 4) → PDF'i indirip sayfa sayısını ve görünümü kontrol edin. `llm:usage` değişmemeli.

5. **Kontrollü gerçek yayın** (bölüm 5) → yeni tarihli sayı, Claude maliyeti `llm:usage` ile.

6. **Mailpit teslim testi** (bölüm 6) → test okuruna, PDF eki SHA-256 ile karşılaştırılarak.

7. Gerçek SMTP ve zamanlayıcı ancak bu adımlar temizse (bölüm 7–8).

## 4. Ücretsiz PDF önizlemesi (Claude yok, yazma yok)

Mevcut bir sayının **dondurulmuş içeriğini** yeni şablonla geçici bir QA PDF'ine dizer. Claude çağrısı, veritabanı yazması ve depolama yazması yapmaz; yayımlanmış PDF'in checksum'ını yeniden doğrular. PDF her sayfada "QA ÖNİZLEMESİ — yayımlanmış sayı değildir" ibaresi taşır.

```bash
ISSUE_ID=$(jq -r '.issue.id' status-2026-11-26.json)
docker compose exec -T server node dist/bootstrap/cli.js issue:preview --issue "$ISSUE_ID" --out - > ~/preview-2026-11-26.pdf
# JSON özet stderr'de: preview.sha256, published.verifiedUnchanged=true, claudeCalls=0
```

- `--out -` PDF'i stdout'a yazar (konteynerin kök dosya sistemi salt okunurdur). Dizüstüne almak için: `scp geveze:~/preview-2026-11-26.pdf .`
- `--out` hiçbir zaman `DATA_DIR` içine veya var olan bir dosyanın üzerine yazmaz.
- Önizleme yalnızca yerleşim içindir: metin, sayının yayımlandığı andaki metindir (article-v1). Yeni editoryal kurallar yalnızca yeni sayılarda görünür.
- Veritabanı olmadan, dışa aktarılmış bir anlık görüntü dosyasını dizmek için: `pdf:smoke --snapshot <issue.json> --out -` (örn. `docker compose run --rm --no-deps -T -v "$PWD/qa":/qa:ro server node dist/bootstrap/cli.js pdf:smoke --snapshot /qa/issue.json --out - > qa.pdf`).

## 5. Kontrollü gerçek yayın (yeni tarih)

```bash
docker compose exec -T server node dist/bootstrap/cli.js llm:usage | jq '.usage'
docker compose exec -T server node dist/bootstrap/cli.js publication:status --user <okur> --date <YENİ-TARİH> | jq '{state, next}'
docker compose exec -T server node dist/bootstrap/cli.js publication:prepare --user <okur> --date <YENİ-TARİH> > prepare.json; echo "exit=$?"
jq '{outcome, reason, issueId, retry}' prepare.json
docker compose exec -T server node dist/bootstrap/cli.js llm:usage | jq '.usage'
```

- `<YENİ-TARİH>` okurun yerel takvimine göre henüz sayısı olmayan bir gündür (ör. 2026-11-28). Yayımlanmış bir tarihi tekrar hazırlamak yalnızca mevcut sayıyı döndürür.
- `exit=0` → READY. PDF'i web arayüzünden veya kimlik doğrulamalı API ile indirin:

  ```bash
  curl -fsS -c jar -H 'Content-Type: application/json' \
    -d '{"identifier":"<okur>","password":"<şifre>"}' http://127.0.0.1:3000/api/auth/login >/dev/null
  curl -fsS -b jar -o issue-<YENİ-TARİH>.pdf http://127.0.0.1:3000/api/issues/<issueId>/pdf
  rm jar
  ```

- `exit=1` → `publication:status` ile `run.errorKind`, `run.errorMessage` ve `next` alanına bakın. `VALIDATION_FAILED` model çıktısının doğrulamadan geçmediğini gösterir (ör. kaynağın bildirmediği bir sonuç); geri çekilme süresi dolunca tekrar deneyin (ücretlidir, günlük bütçe sınırı geçerlidir).
- `exit=75` → başka bir worker çalışıyor; `next.at` sonrasında tekrar bakın.

## 6. Mailpit teslim testi (gerçek okura e-posta yok)

Gerçek okurun teslim kaydını kirletmemek için **ayrı bir test okuru** kullanın (gerçek okurun `dailyEmailEnabled=false` kalır). Test okuru gerçek okurla aynı konu/bilgi düzeyini seçerse hazırlık paylaşılan analiz, varyant ve raporu yeniden kullanır; ek Claude maliyeti olmaz (`llm:usage` ile doğrulayın).

1. Mailpit'i başlatın (yalnızca `127.0.0.1`'e bağlıdır): `docker compose --profile mail-sink up -d mailpit`
2. Web arayüzünden test okuru oluşturun (ör. `pm_mailtest`, `mailtest@example.org`), aynı konuları seçin ve **yalnızca bu okur için** günlük e-postayı açın.
3. Sayıyı hazırlayın ve **tek seferlik** bir CLI konteyneriyle Mailpit'e gönderin (sunucu ve `.env` değişmez):

   ```bash
   docker compose exec -T server node dist/bootstrap/cli.js publication:prepare --user pm_mailtest --date <YENİ-TARİH> | jq '{outcome, issueId}'
   docker compose run --rm --no-deps -T \
     -e NODE_ENV=development -e MAIL_ENABLED=true -e SMTP_HOST=mailpit -e SMTP_PORT=1025 \
     -e SMTP_SECURE=none -e SMTP_ALLOW_INSECURE=true -e SMTP_FROM='PaperMorning <papermorning@example.org>' \
     server node dist/bootstrap/cli.js delivery:send --user pm_mailtest --date <YENİ-TARİH> | jq .
   ```

   `NODE_ENV=development` yalnızca bu tek seferlik süreç içindir: düz metin SMTP (Mailpit) üretim modunda bilerek reddedilir.
4. Doğrulama: `ssh -L 8025:127.0.0.1:8025 geveze` ile http://127.0.0.1:8025 adresini açın. Tek mesaj, alıcı yalnızca test okuru, ek `PaperMorning-<tarih>.pdf`. Ekin SHA-256'sı `publication:status --user pm_mailtest` çıktısındaki `issue.pdf.sha256` ile aynı olmalı:

   ```bash
   ID=$(curl -s 'http://127.0.0.1:8025/api/v1/search?query=to:"mailtest@example.org"' | jq -r '.messages[0].ID')
   PART=$(curl -s "http://127.0.0.1:8025/api/v1/message/$ID" | jq -r '.Attachments[0].PartID')
   curl -s "http://127.0.0.1:8025/api/v1/message/$ID/part/$PART" | sha256sum
   ```

5. Aynı `delivery:send` komutunu tekrar çalıştırın → `ALREADY_SENT`, Mailpit'te hâlâ tek mesaj.
6. Bitince: `docker compose stop mailpit`. Test okurunun e-posta tercihini kapatın.

Bu test, otomatik testlerde de CI'da Mailpit'e karşı çalışır (`test/integration/mail/mailpit-delivery.spec.ts`).

## 7. Gerçek SMTP ile uçtan uca test (sağlayıcı seçildikten sonra)

1. `.env`: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` (`starttls`/587 veya `tls`/465), `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` (sağlayıcıda doğrulanmış gönderen), `MAIL_ENABLED=true`. `SCHEDULER_ENABLED=false` kalır.
2. `docker compose up -d` (yeniden başlatma), sonra `system:check` → `mail.enabled: true`, `smtpHostConfigured: true`, `security` beklenen değer.
3. Test okurunun adresini operatörün erişebildiği gerçek bir posta kutusu yapın; yalnızca o okurda günlük e-posta açık olsun.
4. `delivery:send --user <test-okuru> --date <READY-TARİH>` → `SENT` ve `providerMessageId`. Posta kutusunda ek dahil kontrol edin (spam klasörü dahil). SMTP kabulü gelen kutusuna ulaşmanın kanıtı değildir.
5. `UNKNOWN` dönerse otomatik tekrar yoktur: sağlayıcı panelini kontrol edip `delivery:resolve --delivery <id> --as SENT|RETRY`.

## 8. Zamanlayıcının kontrollü açılışı

1. Önce plan (hiçbir şey yapmaz): `scheduler:plan --at <yarın 06:00 yerel saatin UTC karşılığı>` → okur başına `WOULD_PREPARE`/`NOT_DUE` ve teslim kararı.
2. **Aşama A — yalnızca hazırlık:** `.env` → `SCHEDULER_ENABLED=true`, `MAIL_ENABLED=false`; `docker compose up -d`. Ertesi sabah `publication:status` ve `llm:usage` ile hazırlığı ve maliyeti kontrol edin. Okurların `dailyEmailEnabled=false` olduğu sürece e-posta gitmez.
3. **Aşama B — tek okurla e-posta:** gerçek SMTP doğrulandıktan sonra `MAIL_ENABLED=true` ve yalnızca bir okurda günlük e-postayı açın. 08:00 yerel saatte tek e-posta beklenir; `delivery:send` aynı gün için tekrar göndermez.
4. **Geri alma:** `SCHEDULER_ENABLED=false` (ve/veya `MAIL_ENABLED=false`) → `docker compose up -d`. Kayıtlar korunur; yarım kalan hazırlıklar bir sonraki çalıştırmada kaldığı yerden devam eder.

Zamanlayıcı yalnızca tek sunucu sürecinde çalışır; CLI süreçleri hiçbir zaman zamanlayıcı çalıştırmaz.

## 9. Sorun giderme

- `Chromium sandboxing failed!` → konteynerde sandbox açık kalmış. `system:check` → `pdf.sandbox`. Compose kurulumunda değer sabittir (`false`); imajı compose dışında çalıştırıyorsanız `PDF_CHROMIUM_SANDBOX`'ı kaldırın veya `auto` yapın. Konteyner içinde açık `true` açılışta reddedilir.
- `publication:prepare` → `exit=1`, `retry.errorKind=NOT_CONFIGURED` → `ANTHROPIC_API_KEY` eksik.
- `exit=1`, `retry.errorKind=BUDGET_EXCEEDED` → günlük bütçe (`LLM_DAILY_BUDGET_USD`, UTC günü) doldu; `llm:usage`.
- PDF yer imleri (bookmark) aynı başlığı iki kez gösteriyorsa: Linux'taki Chromium, sayfaya taşınan başlıkları yer imi başlığında tekrarlar. Renderer bunu bayt güvenli biçimde onarır (`src/service/pdf/pdf-outline.ts`); eski şablonla üretilmiş yayımlanmış PDF'ler değiştirilmez.

## 10. Doğrulama hatasından (`VALIDATION_FAILED`) sonra devam

Sayısal denetim (`src/common/text/numeric-claims.ts`) sayıları **değerle** karşılaştırır: kaynaktaki "Thirty-two" çıktıdaki "32"yi, "470,000" Türkçe "470.000" ve "470 bin"i karşılar; "470" tek başına, "33", "1.200" (kaynak "1.2") veya "%75" (kaynak "%15–60") yine reddedilir. Hata mesajı alanı ve yakın metni gösterir: `numbers not present in the analysis/abstract: 470 [sections[evidence].body: "…470 deneme koşusunu…"]`.

Sayıya yapışık harfler türüne göre okunur ve kaynakta **aynı türden** kanıt ister: Türkçe "3B" (üç boyutlu) ile "3D", "3 boyutlu", "three-dimensional" boyuttur; "7B parametre" milyardır. Türkçe "nB" bağlamla ayrılır ("parametre", "token", "$" → milyar; "poz", "görüntü", "nokta bulutu" … → boyut; aksi halde iki okuma da kendi kanıtıyla). Kaynaktaki "3D", "3 milyar"ı veya "3B parametre"yi desteklemez; "128-dimensional", "128 görev"i desteklemez. "4 K"/"4K" ayrıca kelvin olarak okunur. Kalan, bilerek katı bırakılan belirsizlikler (molar "M", tesla/trilyon "T", "4K video") `numeric-claims.ts` başında listelenmiştir.

Bu yalnızca doğrulama kodudur; prompt ve şema sürümleri (analiz, `article-v2`, `outlook-v2`) **değişmedi**, bu yüzden parmak izleri aynıdır ve başarısız kayıtlar aynı satırda yeniden denenir. Elle veritabanı değişikliği, checkpoint sıfırlama veya kayıt silme gerekmez ve yapılmamalıdır.

- **Yazı varyantı** (`article_variant`, `FAILED`, `retryable=true`): bir sonraki hazırlıkta aynı satır yeniden talep edilir, koşul `attempt_count < 3`. Reddedilen çıktı saklanmadığı için bu **bir** yeni Claude yazı çağrısıdır; tamamlanmış diğer varyantlar, analizler ve seçim yeniden ödenmez.
- **Sayı çalıştırması** (`publication_run`): `WRITING` checkpoint'inden devam eder, `checkpoint.selection` korunur. Koşul: `attempt_count < PUBLICATION_MAX_ATTEMPTS` (varsayılan 5) ve `next_attempt_at` geçmiş olmalı (geri çekilme `10 dk × 2^(deneme−1)`).
- **Analiz** (`paper_analysis`, `FAILED`): aynı satırda `attempt_count < 3` iken, makaleyi aday olarak yeniden içeren sonraki bir `research:run` tarafından denenir. Aynı tarih için tamamlanmış bir araştırma çalıştırması tekrar çalışmaz.

Deploy'dan sonra, hiçbir şey değiştirmeden durumu okuyun:

```bash
docker compose exec -T server node dist/bootstrap/cli.js publication:status --user <u> --date 2026-11-28 | jq .
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
  SELECT issue_date, status, stage, attempt_count, retryable, next_attempt_at, error_kind, left(error_message, 200) AS error
    FROM publication_run WHERE issue_date = '"'"'2026-11-28'"'"';
  SELECT left(generation_fingerprint, 12) AS fp, status, attempt_count, retryable, prompt_version, error_kind, left(error_message, 200) AS error
    FROM article_variant WHERE status <> '"'"'COMPLETED'"'"' ORDER BY updated_at DESC LIMIT 10;
  SELECT id, status, attempt_count, retryable, error_kind, left(error_message, 200) AS error
    FROM paper_analysis WHERE status = '"'"'FAILED'"'"' ORDER BY updated_at DESC LIMIT 10;"'
```

Karar:

| Durum | Yapılacak |
|---|---|
| Çalıştırma `attempt_count < 5`, varyant `attempt_count < 3`, `retryable=true` | `publication:status` `PREPARE` diyorsa (veya `WAIT` ise `at` zamanından sonra) `publication:prepare --user <u> --date 2026-11-28`. Beklenen: `READY`, `retry` yok; çalıştırmanın `attempt_count`'u bir artar, varyant satırı aynı kalır (`attempt_count` +1, `COMPLETED`). |
| Logdaki varyant kimliği (`Article variant c8312969b88e failed`) | `fp` sütunu logdaki 12 karakterle eşleşir. Yazılar seçim sırasıyla tek tek yazılır ve ilk hatada çalıştırma durur: bir varyantın `attempt_count`'u, çalıştırmanın değil **o varyantın** kaç kez yazıldığıdır. |
| Varyant `attempt_count = 3` (deneme hakkı bitti) | Çalıştırma her denemede aynı hatayla `WRITING`'de başarısız olur ve çalıştırma hakkını tüketir: **`publication:prepare` çalıştırmayın.** Aynı makale aynı düzey için seçildiği sürece sonraki tarihler de etkilenir. Elle SQL ile sıfırlamayın; operatör kararı gerekir (ayrı, denetimli bir değişiklik). |
| `publication:status` `MANUAL` | Çalıştırma hakkı bitmiş veya hata kalıcı: tarihi yeniden üretmeyin, yeni sayı yeni tarihtir (bkz. §0). |

