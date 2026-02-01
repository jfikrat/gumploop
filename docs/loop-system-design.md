# Loop System Design - Pipeline MCP v3.0

## Özet

Pipeline MCP'ye yeni "loop" tool'ları ekliyoruz. Bu loop'lar belirli görevler için özelleşmiş agent döngüleri.

## Temel Prensipler

1. **Kod yazan her zaman Claude** - Diğer agent'lar analiz/review yapar
2. **Bağımsız çalışma** - Loop başladığında dış müdahale yok
3. **Dosyaya yazma** - Sonuçlar direkt projeye yazılır
4. **Iteratif** - Başarı veya max iterasyona kadar devam

## Mevcut Durum

Şu anki tool'lar:
- `gumploop_plan` - 3 agent consensus (Claude + Gemini + Codex)
- `gumploop_code` - Coder + Reviewer loop
- `gumploop_test` - Test yazma/çalıştırma
- `gumploop_debug` - Analyzer + Fixer loop

## Önerilen Yeni Loop'lar

### 1. loop_debug
**Amaç:** Bug çözme
**Katılımcılar:** Codex (analyzer) + Claude (fixer)
**Akış:**
```
Codex: Kodu analiz et, bug'ın root cause'unu bul
  ↓
Claude: Bug'ı düzelt
  ↓
Test: Çalıştır
  ↓
Pass? → Bitti
Fail? → Tekrar (max N iterasyon)
```

### 2. loop_review
**Amaç:** Kod kalitesi kontrolü
**Katılımcılar:** Codex (reviewer) + Claude (fixer)
**Akış:**
```
Codex: Kodu incele, sorunları listele
  ↓
Claude: Sorunları düzelt
  ↓
Codex: Tekrar incele
  ↓
Onay? → Bitti
Sorun var? → Tekrar
```

### 3. loop_design
**Amaç:** UI/UX tasarımı
**Katılımcılar:** Gemini (designer) + Claude (implementer)
**Akış:**
```
Gemini: Tasarım öner (layout, renkler, UX)
  ↓
Claude: Tasarımı kodla
  ↓
Gemini: Sonucu değerlendir
  ↓
Onay? → Bitti
Revizyon? → Tekrar
```

### 4. loop_architect
**Amaç:** Mimari kararlar
**Katılımcılar:** Codex + Gemini (advisors) + Claude (implementer)
**Akış:**
```
Codex: Teknik analiz ve öneriler
Gemini: Tasarım perspektifi
  ↓
Claude: Önerileri sentezle, uygula
  ↓
İkisi: Onay/revizyon
```

### 5. loop_refactor
**Amaç:** Kod iyileştirme
**Katılımcılar:** Codex (analyzer) + Claude (refactorer)
**Akış:**
```
Codex: Code smell'leri bul, öneriler sun
  ↓
Claude: Refactor et
  ↓
Codex: Sonucu değerlendir
  ↓
Onay? → Bitti
```

### 6. loop_optimize
**Amaç:** Performans iyileştirme
**Katılımcılar:** Codex (profiler) + Claude (optimizer)
**Akış:**
```
Codex: Bottleneck'leri bul
  ↓
Claude: Optimize et
  ↓
Benchmark çalıştır
  ↓
İyileşme var? → Bitti
Yok? → Tekrar
```

### 7. loop_security
**Amaç:** Güvenlik taraması
**Katılımcılar:** Codex (scanner) + Claude (fixer)
**Akış:**
```
Codex: Güvenlik açıklarını tara
  ↓
Claude: Açıkları kapat
  ↓
Codex: Doğrula
  ↓
Temiz? → Bitti
```

### 8. loop_research
**Amaç:** Konu araştırma
**Katılımcılar:** Gemini (researcher) + Codex (validator)
**Akış:**
```
Gemini: Konuyu araştır
  ↓
Codex: Teknik doğruluk kontrol
  ↓
Rapor oluştur
```

### 9. loop_test
**Amaç:** Test yazma
**Katılımcılar:** Codex (strategist) + Claude (writer)
**Akış:**
```
Codex: Test stratejisi belirle
  ↓
Claude: Testleri yaz
  ↓
Testleri çalıştır
  ↓
Coverage yeterli? → Bitti
```

### 10. loop_explain
**Amaç:** Kod açıklama
**Katılımcılar:** Codex (explainer)
**Akış:**
```
Codex: Kodu analiz et
  ↓
Detaylı açıklama yaz
  ↓
Rapor oluştur
```

## Tool Parametreleri

```typescript
interface LoopParams {
  target: string;        // Hedef dosya veya klasör
  description?: string;  // Opsiyonel görev açıklaması
  maxIterations?: number; // Default: 5
  workDir?: string;      // Çalışma dizini
}

interface LoopResult {
  success: boolean;
  iterations: number;
  changes: string[];     // Değiştirilen dosyalar
  summary: string;       // Özet
  details?: string;      // Detaylı rapor
}
```

## Teknik Sorular

1. **Agent instance'ları:** Her loop için yeni tmux session mı, yoksa mevcut olanı kullan mı?

2. **Çakışma yönetimi:** İki loop aynı anda çalışırsa ne olur?

3. **İptal mekanizması:** Loop çalışırken iptal edilebilir mi?

4. **Progress bildirimi:** Loop çalışırken ilerleme nasıl bildirilir?

5. **Hata yönetimi:** Agent crash olursa ne yapılır?

6. **Dosya kilitleme:** Aynı dosyayı birden fazla agent düzenlemeye çalışırsa?

## Mevcut Sistemin Sorunları (Çözülmeli)

1. Race condition - Global state
2. Silent error handling
3. File polling (event-based olmalı)
4. Test coverage yok
5. Dokümantasyon eksik

## Geri Bildirim İstenen Konular

- Loop listesi yeterli mi? Eksik var mı?
- Akışlar mantıklı mı?
- Parametre yapısı uygun mu?
- Teknik sorulara öneriler?
- Öncelik sırası ne olmalı?

---

**Tarih:** 2026-01-28
**Yazar:** Claude Code + Fekrat
