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
