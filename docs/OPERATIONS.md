# PaperMorning — İşletim prosedürleri (v1.2)

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

> v1.2: ayrıntılı ve güncel prosedür §13–§14'tedir (`mail:verify`, `mail:test`).

1. `.env`: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` (`starttls`/587 veya `tls`/465), `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` (sağlayıcıda doğrulanmış gönderen), `MAIL_ENABLED=true`. `SCHEDULER_ENABLED=false` kalır.
2. `docker compose up -d` (yeniden başlatma), sonra `system:check` → `mail.enabled: true`, `smtpHostConfigured: true`, `security` beklenen değer.
3. Test okurunun adresini operatörün erişebildiği gerçek bir posta kutusu yapın; yalnızca o okurda günlük e-posta açık olsun.
4. `delivery:send --user <test-okuru> --date <READY-TARİH>` → `SENT` ve `providerMessageId`. Posta kutusunda ek dahil kontrol edin (spam klasörü dahil). SMTP kabulü gelen kutusuna ulaşmanın kanıtı değildir.
5. `UNKNOWN` dönerse otomatik tekrar yoktur: sağlayıcı panelini kontrol edip `delivery:resolve --delivery <id> --as SENT|RETRY`.

## 8. Zamanlayıcının kontrollü açılışı

> v1.2: son prosedür §16, durdurma/geri alma §17.

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

Sayıya yapışık harfler türüne göre okunur ve kaynakta **aynı türden** kanıt ister: Türkçe "3B" (üç boyutlu) ile "3D", "3 boyutlu", "three-dimensional" boyuttur; "7B parametre" milyardır. Türkçe "nB" bağlamla ayrılır ("parametre", "token", "$" → milyar; "poz", "görüntü", "nokta bulutu" … → boyut; aksi halde iki okuma da kendi kanıtıyla). Kaynaktaki "3D", "3 milyar"ı veya "3B parametre"yi desteklemez; "128-dimensional", "128 görev"i desteklemez. Ayrık "4 K" ve "300 kelvin" açık sıcaklıktır: yalnızca kaynaktaki kelvin kanıtıyla desteklenir (küçük sayı toleransı yok, "300 tasks" desteklemez); bitişik "4K" binlik veya kelvin olabilir, her okuma kendi kanıtını ister. Kalan, bilerek katı bırakılan belirsizlikler (molar "M", tesla/trilyon "T", "4K video") `numeric-claims.ts` başında listelenmiştir.

Bu yalnızca doğrulama kodudur; prompt ve şema sürümleri **değişmedi**, bu yüzden parmak izleri aynıdır ve başarısız kayıtlar aynı satırda yeniden denenir. (v1.2 `article-v3`/`outlook-v3`'e geçer: v2 sürümüyle başarısız olmuş bir yazı varyantı v1.2'den sonra yeniden denenmez; gerekirse v3 ile yeni bir varyant yazılır. `ops:status` bunu `retryEligible: false` olarak gösterir.) Elle veritabanı değişikliği, checkpoint sıfırlama veya kayıt silme gerekmez ve yapılmamalıdır.

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


## 11. v1.2 güncellemesi (Geveze)

v1.2 şema değiştirmez (migration yok). Prompt sürümleri `article-v3` / `outlook-v3`, PDF şablonu `issue-print-v3` olur. Yayımlanmış sayılar ve PDF'leri değişmez.

**Ne zaman:** hazırlığı süren bir sayı yokken (ör. 08:00'den sonra veya akşam). Yarım kalmış bir çalıştırma güncellemeden sonra devam ederse, yeni prompt sürümü yeni parmak izi demektir: o sayının yazıları v3 ile yeniden yazılır (ücretli). Önce kontrol edin:

```bash
cd <papermorning-dizini>
docker compose exec -T server node dist/bootstrap/cli.js publication:status --user <okur> --date "$(TZ=Europe/Istanbul date +%F)" | jq '{state, next}'
```

`state` `READY` veya `NOT_STARTED` olmalı. Sonra §2'deki adımlar (yayımlanmış sayıların listesi → `issues-before.txt`, `pg_dump` + `/data` yedeği) ve:

```bash
git fetch origin && git checkout main && git pull --ff-only
git log --oneline -1                      # beklenen: v1.2 birleştirme commit'i
docker compose build server
docker compose up -d
docker compose logs --tail=80 server | grep -E "migrations|PDF template|Nest application successfully started"
```

Beklenen: `No migrations are pending`, `PDF template issue-print-v3; Chromium sandbox OFF (explicit, runtime container)`.

Doğrulama (hiçbiri Claude çağırmaz, e-posta göndermez):

```bash
docker compose exec -T server node dist/bootstrap/cli.js system:check | jq '{scheduler, mail, llm: {dailyBudgetUsd: .llm.dailyBudgetUsd}, pdf}'
docker compose exec -T server node dist/bootstrap/cli.js pdf:smoke | jq '{outcome, template, pages}'
docker compose exec -T server node dist/bootstrap/cli.js ops:status | jq '{scheduler, mail, llm}'
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "SELECT id, issue_date, status, content_hash, pdf_storage_key, pdf_sha256, pdf_size_bytes, published_at FROM issue ORDER BY issue_date, id"' > issues-after.txt
diff issues-before.txt issues-after.txt && echo "published issues unchanged"
```

Beklenen: `scheduler.enabledInServer: false`, `mail.enabled: false`, `dailyBudgetUsd: 2`, `pdf:smoke` `OK` ve `issue-print-v3`, `diff` çıktısız. 2026-11-26 ve 2026-11-28 sayıları (`5dcbd2e7-b334-4152-80e2-2413c9596285`) aynen kalır.

## 12. Günlük durum: `ops:status`

Tek salt okunur komut; yazmaz, Claude çağırmaz, e-posta göndermez:

```bash
docker compose exec -T server node dist/bootstrap/cli.js ops:status | jq .
docker compose exec -T server node dist/bootstrap/cli.js ops:status --user <okur> | jq '.readers[0] | {issueDate, localTime, state: .today.state, next: .today.next, nextPreparationAt, nextDeliveryAt, latestReady, latestSent}'
```

| Alan | Anlamı |
|---|---|
| `scheduler.enabledInServer`, `mail.enabled` | Sunucunun gerçek ayarı (CLI kendi sürecinde zamanlayıcıyı hep kapatır; burada gösterilen sunucunun değeridir) |
| `llm` | UTC günü bütçesi: `spentUsd` (kesinleşen), `inFlightUsd` (süren çağrıların en kötü durum rezervasyonu), `remainingUsd`, `resetsAt` (UTC gece yarısı = 03:00 İstanbul) |
| `readers[].issueDate`, `localTime` | Okurun yerel "bugün"ü ve saati (sayı kimliği budur) |
| `readers[].preparationWindow` | Otomatik hazırlığın çalıştığı aralık (06:00 → 08:00 + geç pencere) |
| `readers[].nextPreparationAt`, `nextDeliveryAt` | Bir sonraki 06:00 ve 08:00'in UTC karşılığı (DST dahil) |
| `readers[].today` | `publication:status` ile aynı: `state`, `run` (deneme, hata, bir sonraki deneme), `delivery`, `next.action` (`NONE`/`PREPARE`/`WAIT`/`MANUAL`) |
| `readers[].latestReady`, `latestSent` | En son READY sayı ve en son gönderilen e-posta |
| `failures.analyses`, `articleVariants`, `outlooks` | Son başarısız üretimler: `attempts`/`maxAttempts`, `retryEligible` (yeniden denenecek mi: tekrar denenebilir, hak var, güncel prompt sürümü), hata türü ve kısaltılmış mesaj |
| `failures.deliveries` | `FAILED`/`UNKNOWN` teslimler ve sıradaki adım (`AUTOMATIC_RETRY`, `NONE`, `OPERATOR_RESOLVE`) |

Zamanlayıcı logları: `docker compose logs --since 24h server | grep -E "DailyPublicationScheduler|DeliveryService|Article variant|Outlook"` → `Issue <okur>/<tarih> READY (<id>)`, `Delivery <okur>/<tarih> SENT`, başarısızlıkta deneme numarası ve bir sonraki denemenin zamanı.

## 13. SMTP yapılandırması (Geveze)

Sağlayıcı seçimi operatöre aittir; kimlik bilgileri yalnızca Geveze'deki `.env` dosyasında durur (repo'ya, GitHub'a, sohbete veya loglara girmez). Kişisel pilot için önerilen: **Gmail + uygulama şifresi** (ücretsiz, günde yüzlerce ileti, TLS). Alan adınız varsa bir işlem e-postası sağlayıcısı (Brevo, Postmark, Amazon SES) teslim edilebilirlik için daha iyidir.

**A) Gmail (önerilen pilot):** Google hesabında 2 adımlı doğrulama açık olmalı → Hesap → Güvenlik → Uygulama şifreleri → "PaperMorning" adlı 16 karakterlik şifre. Gönderen adres o Gmail adresi olmalı (Gmail başka bir `From`'u yeniden yazar).

```dotenv
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=tls
SMTP_USER=<gmail-adresiniz>
SMTP_PASSWORD=<16 karakterlik uygulama şifresi, boşluksuz>
SMTP_FROM=PaperMorning <gmail-adresiniz>
SMTP_REPLY_TO=
SMTP_ALLOW_INSECURE=false
MAIL_ENABLED=false
```

**B) İşlem e-postası sağlayıcısı (ör. Brevo):** sağlayıcıda gönderen adresi/alan adını doğrulayın (SPF/DKIM). `SMTP_HOST=smtp-relay.brevo.com`, `SMTP_PORT=587`, `SMTP_SECURE=starttls`, `SMTP_USER`/`SMTP_PASSWORD` sağlayıcının SMTP kimlik bilgileri, `SMTP_FROM` doğrulanmış gönderen. Postmark: `smtp.postmarkapp.com`, 587, `starttls`; Amazon SES: `email-smtp.<bölge>.amazonaws.com`, 587, `starttls`.

Kurulum:

```bash
cd <papermorning-dizini>
cp .env .env.bak-$(date +%F) && chmod 600 .env .env.bak-*
nano .env                      # yukarıdaki satırları girin; şifreyi komut satırına/geçmişe yazmayın
docker compose up -d           # .env değişince sunucu konteyneri yeniden oluşturulur
docker compose exec -T server node dist/bootstrap/cli.js system:check | jq '.mail'
docker compose exec -T server node dist/bootstrap/cli.js mail:verify | jq .; echo "exit=$?"
```

- `system:check` sırları yazmaz: yalnızca `smtpHostConfigured`, `authConfigured`, `fromConfigured`, `security`.
- `mail:verify` sunucuya bağlanır, TLS'i (sertifika doğrulamalı, en az TLS 1.2) ve AUTH'u dener, **ileti göndermez**; `MAIL_ENABLED=false` iken de çalışır. `exit=0` → hazır. `exit=1` → `error` alanı (şifresiz): `EAUTH` kimlik bilgisi, `ETIMEDOUT`/`ECONNECTION` port engeli (bazı sunucular 465/587 çıkışını kapatır), `ESOCKET`/sertifika TLS ayarı.
- `docker compose config` çıktısı sırları içerir; paylaşmayın.
- Üretimde düz metin SMTP (`SMTP_SECURE=none`) ve `SMTP_ALLOW_INSECURE=true` reddedilir.

## 14. Kontrollü test e-postası

**Adım 1 — sentetik ileti (okur ve sayı yok, veritabanı yazması yok):** `MAIL_ENABLED=true` gerekir; zamanlayıcı kapalı kaldığı sürece hiçbir şey otomatik gönderilmez.

```bash
sed -i 's/^MAIL_ENABLED=.*/MAIL_ENABLED=true/' .env && grep -E '^(MAIL_ENABLED|SCHEDULER_ENABLED)=' .env
docker compose up -d
docker compose exec -T server node dist/bootstrap/cli.js mail:test --to <kendi-adresiniz> | jq .; echo "exit=$?"
```

Beklenen: `outcome: "SENT"`, `messageId`, `attachment.sha256`, `databaseWrites: 0`. Posta kutusunda (spam dahil): konu `PaperMorning SMTP testi — çğıöşü ÇĞİÖŞÜ`, gövdede aynı harfler, ekte `PaperMorning-SMTP-testi.pdf` (her sayfada "PDF duman testi" etiketi ve Türkçe harfler). `--to` tek bir düz adres kabul eder; liste veya `İsim <adres>` reddedilir.

**Adım 2 — gerçek sayı, tek okur:** kendi hesabınızda günlük e-postayı açın ve READY bir sayıyı (ör. 2026-11-28) gönderin. Sayı ve PDF değişmez; yalnızca bir `email_delivery` kaydı oluşur.

```bash
curl -fsS -c jar -H 'Content-Type: application/json' \
  -d '{"identifier":"<okur>","password":"<şifre>"}' http://127.0.0.1:3000/api/auth/login >/dev/null
curl -fsS -b jar http://127.0.0.1:3000/api/preferences > prefs.json
jq '{language: .reader.language, timezone: .reader.timezone, dailyEmailEnabled: true, topics: [.topics[] | {topicKey, priority, knowledgeLevel}]}' prefs.json > prefs-on.json
curl -fsS -b jar -X PUT -H 'Content-Type: application/json' --data @prefs-on.json http://127.0.0.1:3000/api/preferences | jq '{reader}'
rm jar
docker compose exec -T server node dist/bootstrap/cli.js delivery:send --user <okur> --date 2026-11-28 | jq .; echo "exit=$?"
docker compose exec -T server node dist/bootstrap/cli.js delivery:send --user <okur> --date 2026-11-28 | jq '{outcome}'   # ALREADY_SENT
```

`timezone` `Europe/Istanbul` olmalı (`jq '.reader.timezone' prefs.json`). Beklenen: ilk gönderim `SENT` (exit 0), ikincisi `ALREADY_SENT`; posta kutusunda tek ileti, konu `PaperMorning · 28 Kasım 2026 — <kapak başlığı>`, ek `PaperMorning-2026-11-28.pdf`. Ekin SHA-256'sı `publication:status --user <okur> --date 2026-11-28 | jq -r .issue.pdf.sha256` ile aynı olmalı (`sha256sum PaperMorning-2026-11-28.pdf`).

`UNKNOWN` (exit 1) → otomatik tekrar yok; sağlayıcının gönderilenler/aktivite panelini kontrol edip `delivery:resolve --delivery <id> --as SENT|RETRY`. Test bitince zamanlayıcıyı açana kadar `MAIL_ENABLED=false` yapabilirsiniz (§16).

## 15. Kontrollü çok makaleli yayın (gerçek üretim)

Amaç: aynı alanda en az üç farklı çalışmalı bir sayıyı, zamanlayıcıyı açmadan, elle hazırlamak. Bu, o tarihin gerçek sayısıdır (yeni metin = yeni tarih); sonraki sabah zamanlayıcı hazır sayıyı yeniden üretmez.

**Maliyet tahmini** (Sonnet 5.5, $2/M girdi, $10/M çıktı): analiz ≈ $0.02, yazı ≈ $0.04–0.05, çok makaleli Ufuk Raporu ≈ $0.05–0.07, Haiku eleme ≈ $0.003/gün. 3 yeni makaleli sayı ≈ **$0.25–0.35**, 6 makaleli ≈ **$0.45–0.60**; her `VALIDATION_FAILED` yeniden denemesi bir yazı daha (≈ $0.05). $2 günlük bütçe yeterlidir ve aşılamaz. Gerçek değeri 2026-11-28'in maliyetiyle kalibre edin: `llm:usage --date 2026-11-28`. Pilot için sayı başına makale sayısını sınırlamak isterseniz `.env`'de `PUBLICATION_MAX_ARTICLES=4`.

```bash
D=2026-11-29                       # okurun henüz sayısı olmayan bir sonraki yerel tarihi
docker compose exec -T server node dist/bootstrap/cli.js ops:status --user <okur> | jq '{llm, today: .readers[0].today.state}'
docker compose exec -T server node dist/bootstrap/cli.js research:run --topics robotics --date $D | jq '.runs[] | {status, counts}'
docker compose exec -T server node dist/bootstrap/cli.js publication:prepare --user <okur> --date $D > prepare-$D.json; echo "exit=$?"
jq '{outcome, reason, issueId, retry}' prepare-$D.json
docker compose exec -T server node dist/bootstrap/cli.js llm:usage --date "$(date -u +%F)" | jq '.usage'
```

- `research:run` önce adayları bulur ve analiz eder (`counts.candidates`, `analyzed`, `reused`); `publication:prepare` bunu zaten yapar, önden çalıştırmak yalnızca aday sayısını görmek içindir. Daha önce bu okura yayımlanmış makaleler (ve aynı başlıklı ön baskı/dergi sürümleri) seçilmez. Son 7 günde 3'ten az uygun çalışma varsa sayı daha az makale içerir; bu bir hata değildir.
- `exit=1` → `publication:status --user <okur> --date $D | jq '{run, next}'`. Bir yazı başarısızsa tamamlanan yazılar ve analizler korunur; `next.at` sonrasında aynı `publication:prepare` komutu kaldığı yerden devam eder (yalnızca eksik yazı yeniden yazılır).

İnceleme (PDF'i §5'teki gibi indirin):

```bash
docker compose exec -T server node dist/bootstrap/cli.js publication:status --user <okur> --date $D | jq '{state, issue: .issue.id, pages: .issue.pdf}'
```

PDF kontrol listesi: kapakta "Bu sayıda" içindekiler listesi; her makale ayrı başlıkla ve kaynak kartıyla; yer imleri (bookmarks) her makaleye ve Ufuk Raporu'na gidiyor; "Özette belirtilmeyenler" kutuları; Ufuk Raporu'nda **İlişki/Uyuşma/Ayrışma** maddeleri en az iki makaleye atıf yapıyor, "Boşluk:" maddeleri belirsizliklerde, "alan uzlaştı" gibi genelleme yok; her atıf (P1, P2, …) bu sayının bir makalesine karşılık geliyor; özette olmayan bir konu "bu çalışmada ele alınmıyor" değil "özette ele alınmıyor" diye yazılmış.

## 16. Zamanlayıcının üretimde açılması (son prosedür)

**Önkoşullar:** §11 doğrulaması temiz; `mail:verify` exit 0; §14 iki adım da tamam; §15 sayısı READY ve incelendi; `ops:status` → `failures` içinde `retryEligible` bekleyen kritik bir kayıt yok; okurun `timezone`'u `Europe/Istanbul`; `.env`'de `LLM_DAILY_BUDGET_USD=2`, `SCHEDULER_PREPARE_LOCAL_TIME=06:00` (teslim 08:00 sabittir), `SCHEDULER_LATE_WINDOW_MINUTES=120`.

Kurallar (kodda sabit): hazırlık her dakika denetlenir ve yerel 06:00'dan 08:00 + geç pencereye (10:00) kadar otomatik çalışır; READY sayı yeniden hazırlanmaz; e-posta yalnızca READY ve doğrulanmış PDF'li sayı için, yalnızca açık abone okura, okur/gün başına en fazla bir kez gider. 08:00'de hazır değilse gecikme kaydedilir ve 10:00'a kadar hazır olursa geç gönderilir; 10:00'dan sonra o gün için otomatik hazırlık ve e-posta yoktur (sayı CLI ile web için hazırlanabilir). Kesinti sonrası: sunucu geri geldiğinde o günün penceresi açıksa kaldığı yerden devam eder; geçmiş günler otomatik telafi edilmez. Bütçe dolarsa Claude'a istek gitmez, deneme geri çekilmeyle en fazla `PUBLICATION_MAX_ATTEMPTS` kez yapılır. `UNKNOWN` teslim asla otomatik tekrarlanmaz.

**Aşama A — yalnızca hazırlık (1–2 gün):** okurun günlük e-postası kapalı (§14 adım 2'deki `jq`'da `dailyEmailEnabled: false`).

```bash
docker compose exec -T server node dist/bootstrap/cli.js scheduler:plan --at "$(date -u -d "$(TZ=Europe/Istanbul date -d 'tomorrow 06:00' --iso-8601=seconds)" +%FT%TZ)" | jq '.readers'
sed -i 's/^SCHEDULER_ENABLED=.*/SCHEDULER_ENABLED=true/' .env && grep -E '^(SCHEDULER_ENABLED|MAIL_ENABLED|LLM_DAILY_BUDGET_USD|SCHEDULER_PREPARE_LOCAL_TIME)=' .env
docker compose up -d
docker compose exec -T server node dist/bootstrap/cli.js ops:status | jq '{scheduler, readers: [.readers[] | {user, nextPreparationAt, nextDeliveryAt}]}'
```

Ertesi sabah ~06:30 ve ~08:05: `ops:status --user <okur>` → `today.state: READY`, `llm.spentUsd` beklenen aralıkta; loglarda `Issue <id>/<tarih> READY`.

**Aşama B — e-posta:** `MAIL_ENABLED=true` (`docker compose up -d`) ve okurun günlük e-postasını açın (§14 adım 2, `dailyEmailEnabled: true`). Ertesi gün 08:00'de tek e-posta beklenir; 08:05'te `ops:status` → `latestSent.issueDate` bugünün tarihi, loglarda `Delivery <okur>/<tarih> SENT`.

Zamanlayıcı tek sunucu sürecinde çalışır. Yanlışlıkla iki sunucu çalışsa bile hazırlık, render ve e-posta PostgreSQL claim'leriyle okur/gün başına bir kez yapılır (test edildi); yine de tek sunucu çalıştırın.

## 17. Geri alma ve acil durdurma

| Amaç | Komut | Etki |
|---|---|---|
| Bir okura e-postayı hemen durdur (yeniden başlatmasız) | §14 adım 2, `dailyEmailEnabled: false` | Bir sonraki dakikadan itibaren o okura gönderim yok |
| Tüm e-postayı durdur | `sed -i 's/^MAIL_ENABLED=.*/MAIL_ENABLED=false/' .env && docker compose up -d` | Teslimler `DISABLED`; hazırlık sürer |
| Zamanlayıcıyı durdur | `sed -i 's/^SCHEDULER_ENABLED=.*/SCHEDULER_ENABLED=false/' .env && docker compose up -d` | Otomatik hazırlık/e-posta yok; CLI çalışır |
| Tüm Claude harcamasını durdur | `sed -i 's/^LLM_DAILY_BUDGET_USD=.*/LLM_DAILY_BUDGET_USD=0/' .env && docker compose up -d` | Her istek bütçe kontrolünde reddedilir (`BUDGET_EXCEEDED`), ücret yok |
| Her şeyi durdur | `docker compose stop server` | Veritabanı ve PDF'ler korunur; yarım işler kira süresi dolunca devam eder |
| Belirsiz teslim | `delivery:resolve --delivery <id> --as SENT\|RETRY` | Operatör kararı; otomatik tekrar yok |

**Kod geri dönüşü (v1.2 → v1.1.x):** şema aynı olduğu için veritabanı geri dönüşü gerekmez; v1.2 ile üretilmiş sayılar eski kodla da okunur.

```bash
git log --oneline -3                       # v1.2 birleştirmesinden önceki commit (69f965a: PR #22 birleştirmesi)
git checkout 69f965a
docker compose build server && docker compose up -d
docker compose exec -T server node dist/bootstrap/cli.js system:check | jq '{scheduler, mail}'
```

Geri dönüşten sonra yeni sayılar yine v2 promptlarıyla yazılır; v3 ile yazılmış varyantlar yeniden kullanılmaz (parmak izi farklı). Yedekten geri yükleme yalnızca veri kaybında gerekir (`pg_restore` + `/data` arşivi, §2).

## 18. Bilinen sınırlar ve sonraki kilometre taşları

Sınırlar:

- Analiz yalnızca özete dayanır; yazılar bunu açıkça belirtir. Özetin söylemediği hiçbir şey hakkında hüküm verilmez, bu da bazı sınırların "özette belirtilmiyor" olarak kalması demektir.
- "Özette yok ≠ çalışmada yok" denetimi Türkçe ve kalıp tabanlıdır: farklı bir ifadeyi kaçırabilir veya nadiren meşru bir cümleyi reddedebilir (tekrar denenebilir `VALIDATION_FAILED`, bir yazı maliyeti). İngilizce iç analiz metni bu denetimden geçmez; okura giden metin geçer.
- Aynı çalışmanın tespiti normalize başlık eşitliğine dayanır (başlığı değişmiş sürümler ayrı sayılabilir); çeşitlilik yalnızca ilk yazara bakar.
- Sayıdaki makale sayısı araştırma bulgusuna bağlıdır; üç makale garanti edilemez.
- SMTP kabulü gelen kutusuna ulaşmanın kanıtı değildir; geri dönen (bounce) ileti takibi yoktur. SPF/DKIM sağlayıcı tarafında yapılandırılır.
- Bütçe günü UTC'dir (03:00 İstanbul). Rezervasyonlar en kötü durum maliyetiyle yapılır; gün sonunda gerçek harcama bütçenin biraz altında kalsa da yeni çağrı reddedilebilir.
- Zamanlayıcı çözünürlüğü bir dakikadır; 10:00'dan sonra o gün için otomatik iş yapılmaz.
- Türkçe sayı kelimeleri sayısal denetimde okunmaz; bilerek katı bırakılan birim belirsizlikleri §10'da.

Sonraki kilometre taşları (bu sürümde yok):

1. **Tam metin analizi:** açık erişimli PDF/HTML'den tam metin, `FULL_TEXT` kapsamı (şablon ve denetimler hazır: "Makalede belirtilmeyenler", tam metinde kapsam denetimi devre dışı).
2. **Geri bildirime dayalı kişiselleştirme:** mevcut `feedback` kayıtlarını konu önceliği ve seçim sıralamasına yansıtmak.
3. Bounce/şikâyet takibi ve teslim edilebilirlik raporu.
