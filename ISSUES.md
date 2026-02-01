# Gumploop - Bilinen Sorunlar ve Çözümler

## Aktif Sorunlar

### ISSUE-001: Coding Phase Terminal/Tmux Race Condition
**Durum:** Çözüldü
**Öncelik:** P0 - Kritik
**Tarih:** 2026-02-01
**Çözüm Tarihi:** 2026-02-01

**Belirtiler:**
- `mcp__gumploop__code` çağrıldığında "Failed with exit code 1" hatası
- "can't find pane: pipeline-coder" hatası (tmux)
- İlk capturePane() çağrısı başarısız

**Kök Neden:**
- `spawn()` async çalışıyor, hemen return ediyor
- tmux session oluşturulmadan `capturePane()` çağrılıyor
- Race condition: spawn → immediate poll → session not ready → error

**Çözüm:**
- spawn() sonrası 1 saniye bekleme eklendi
- capturePane() hataları sessizce yakalanıyor (polling devam ediyor)

```typescript
// ISSUE-001 Fix: Wait for tmux session to be created
await Bun.sleep(1000);
```

**Test:**
- [x] manuel test başarılı
- [x] mcp__gumploop__code çalışıyor
- [x] 2 iterasyon tamamlandı

---

### ISSUE-003: Test Phase - test-results.md Yazılmıyor
**Durum:** Çözüm Uygulandı (Test Bekliyor)
**Öncelik:** P1 - Önemli
**Tarih:** 2026-02-01

**Belirtiler:**
- `mcp__gumploop__test` çalışıyor
- Agent testi tamamlıyor (Tester done)
- Ama `.gumploop/test-results.md` dosyası oluşturulmuyor
- Test sonucu her zaman "failed" dönüyor

**Kök Neden:**
- `waitForCompletion()` agent'ın gerçekten işi bitirmesini beklemiyor
- Prompt'ta tam dosya yolları yok
- Progress marker yok

**Uygulanan Çözüm:**
```typescript
// Eski
await tester.waitForCompletion();

// Yeni
await tester.waitForProgressEvent("claude", "testing_complete", 1, files.progressFile);
```

- Prompt güncellendi: tam dosya yolları eklendi
- Progress marker eklendi: `{"agent": "claude", "action": "testing_complete", ...}`
- `waitForProgressEvent()` kullanılıyor

**Test:**
- [ ] MCP sunucusu restart edilmeli (yeni kod yüklenmedi)
- [ ] Test phase tekrar çalıştırılmalı

---

### ISSUE-004: workDir Parametresi Ignore Ediliyor
**Durum:** Çözüldü
**Öncelik:** P1 - Önemli
**Tarih:** 2026-02-01
**Çözüm Tarihi:** 2026-02-01

**Belirtiler:**
- `mcp__gumploop__plan` çağrılırken `workDir` parametresi veriliyor
- Ama pipeline `/tmp/collab-mcp/project` kullanıyor
- Kullanıcının belirttiği dizin ignore ediliyor

**Kök Neden:**
- `validateWorkDir()` dizinin var olmasını gerektiriyor
- Dizin yoksa validation başarısız → default kullanılıyor
- Hata mesajı MCP çıktısında görünmüyor

**Çözüm:**
```typescript
// getProjectDir() içinde - dizin yoksa oluştur
if (!existsSync(resolved)) {
  mkdirSync(resolved, { recursive: true });
}
```

---

### ISSUE-005: Consensus Olmayınca planningComplete Flag Set Edilmiyor
**Durum:** Çözüldü
**Öncelik:** P2 - Orta
**Tarih:** 2026-02-01
**Çözüm Tarihi:** 2026-02-01

**Belirtiler:**
- Planning phase tamamlanıyor (plan.md, review dosyaları var)
- Ama `planningComplete: false` kalıyor
- Coding phase başlamıyor: "Planning not complete"

**Kök Neden:**
- Max iterations'a ulaşıldığında consensus yoksa flag set edilmiyor
- Sadece consensus olduğunda `planningComplete = true` yapılıyor

**Çözüm:**
```typescript
// executePlanning() sonunda - her durumda planningComplete = true
state.planningComplete = true;  // Consensus olsun olmasın
```

Kullanıcı consensus olmasa bile coding phase'a devam edebilir.

---

### ISSUE-002: Planning Phase Progress.jsonl Timeout
**Durum:** Kısmen Çözüldü
**Öncelik:** P1 - Önemli
**Tarih:** 2026-02-01

**Belirtiler:**
- Claude plan yazıyor ama progress.jsonl'a marker yazmıyor
- "Timeout waiting for claude/plan_written in progress.jsonl" hatası
- Plan dosyası oluşuyor ama pipeline devam edemiyor

**Uygulanan Çözümler:**
- [x] Adaptive timeout eklendi (30dk base + 15dk extension)
- [ ] Progress marker yazma güvenilirliği artırılmalı

**Kalan İşler:**
- Alternative completion detection (file watcher?)
- Claude prompt'unu daha net yap
- Fallback mekanizması ekle

---

## Çözülmüş Sorunlar

### ISSUE-S001: gumploopDir undefined crash
**Çözüm Tarihi:** 2026-02-01
**Commit:** 26c4972

**Problem:** `files.gumploopDir` property tanımlı değildi, runtime crash
**Çözüm:** `getPipelineFiles()` fonksiyonuna `gumploopDir: pipelineDir` eklendi

---

### ISSUE-S002: loadState() JSON.parse crash
**Çözüm Tarihi:** 2026-02-01
**Commit:** 26c4972

**Problem:** Bozuk state dosyası JSON.parse'ı crash ettiriyordu
**Çözüm:** try-catch + isValidState() validation eklendi

---

### ISSUE-S003: Command injection vulnerabilities
**Çözüm Tarihi:** 2026-02-01
**Commit:** 26c4972

**Problem:** projectDir ve sessionName shell injection'a açıktı
**Çözüm:**
- tmux -c ile safe directory handling
- sanitizeSessionName() helper eklendi
- Shell string interpolation kaldırıldı

---

### ISSUE-S004: Temp file TOCTOU vulnerability
**Çözüm Tarihi:** 2026-02-01
**Commit:** 26c4972

**Problem:** Predictable temp file path, race condition riski
**Çözüm:** mkdtempSync() + secure file creation (mode: 0o600, flag: "wx")

---

### ISSUE-S005: Short timeout (5 dakika)
**Çözüm Tarihi:** 2026-02-01
**Commit:** a0279c9

**Problem:** 5 dakikalık timeout karmaşık tasklar için yetersiz
**Çözüm:** Adaptive timeout - 30dk base + 15dk extension if active

---

## Sorun Şablonu

```markdown
### ISSUE-XXX: [Kısa Başlık]
**Durum:** Açık / Araştırılıyor / Çözüldü
**Öncelik:** P0/P1/P2
**Tarih:** YYYY-MM-DD

**Belirtiler:**
- ...

**Etkilenen Kod:**
- ...

**Olası Nedenler:**
1. ...

**Çözüm:**
- ...
```
