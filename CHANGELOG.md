# Changelog

Tüm önemli değişiklikler bu dosyada belgelenir.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)

## [2.4.0] - 2026-02-01

### Fixed
- ISSUE-003: Test phase `waitForProgressEvent()` kullanıyor (önceki: `waitForCompletion()`)
- ISSUE-004: workDir otomatik oluşturuluyor (dizin yoksa)
- ISSUE-005: `planningComplete` consensus olmasa bile true oluyor

### Changed
- Test phase prompt: Tam dosya yolları ve progress marker eklendi
- `getProjectDir()`: Dizin yoksa `mkdirSync()` ile oluşturuyor
- `executePlanning()`: Max iterations sonrası her zaman `planningComplete = true`

---

## [2.3.0] - 2026-02-01

### Added
- Adaptive timeout stratejisi
  - Base timeout: 30 dakika
  - Extension: 15 dakika (agent aktifse)
  - Activity threshold: 60 saniye
- Timeout sabitleri: `TIMEOUT_BASE`, `TIMEOUT_EXTENSION`, `ACTIVITY_CHECK_INTERVAL`, `ACTIVITY_THRESHOLD`

### Changed
- Tüm `waitFor*` metodları adaptive timeout kullanıyor
- `timeoutMs` parametresi kaldırıldı (sabitler kullanılıyor)

## [2.2.0] - 2026-02-01

### Added
- `gumploopDir` property to `getPipelineFiles()` return value
- `safeJsonParse<T>()` helper for safe JSON parsing
- `isValidState()` type guard for state validation
- `defaultState()` factory function
- `sanitizeSessionName()` for command injection prevention
- `I3Node` and `I3Workspace` interfaces (replaces `any`)
- `parsePlanArgs()` and `parseIterationsArg()` type-safe argument parsers
- Secure temp file creation with `mkdtempSync()`

### Changed
- `loadState()` now handles corrupt state files gracefully
- `validateWorkDir()` checks path traversal before resolve
- `TmuxAgent.start()` uses tmux `-c` flag for safe directory
- `TmuxAgent.stop()` now kills terminal process
- All JSON.parse calls wrapped with safeJsonParse

### Fixed
- ISSUE-S001: gumploopDir undefined crash
- ISSUE-S002: loadState() JSON.parse crash
- ISSUE-S003: Command injection via projectDir/sessionName
- ISSUE-S004: Temp file TOCTOU vulnerability
- ISSUE-S005: Path traversal check ineffective

### Security
- Command injection prevention (shell interpolation removed)
- Secure temp file handling (mkdtempSync + mode 0o600)
- Path traversal blocking (check before resolve)

## [2.1.1] - 2026-01-30

### Added
- Initial release with consensus-based planning
- Multi-phase pipeline: plan → code → test → debug
- Claude + Gemini + Codex agent orchestration
- workDir parameter support
- Progress tracking via progress.jsonl

---

## Version History

| Version | Date | Summary |
|---------|------|---------|
| 2.4.0 | 2026-02-01 | Bug fixes (ISSUE-003/004/005) |
| 2.3.0 | 2026-02-01 | Adaptive timeout |
| 2.2.0 | 2026-02-01 | Security hardening |
| 2.1.1 | 2026-01-30 | Initial release |
