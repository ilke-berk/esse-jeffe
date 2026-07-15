# Yönerge: GitHub'dan Güncel Hali Çekme

Bu belge, uygulamanın güncel halini GitHub'dan çekmek için izlenen adımları tanımlar.
İleride "güncel hali çek" istendiğinde sadece bu dosyayı okuyup aynı adımları uygula.

**Depo:** https://github.com/ilke-berk/esse-jeffe.git (remote adı: `origin`)
**Ana dal:** `main`

## Adımlar

### 1. Mevcut durumu kontrol et
```powershell
git status
git remote -v
```
- Çalışma ağacı **temiz değilse** (commit edilmemiş değişiklik varsa) DUR ve kullanıcıya sor
  (stash mi, commit mi, yoksa vazgeç mi).
- Hangi dalda olduğunu not et — işlem sonunda aynı dala geri dönülecek.

### 2. Uzak depodaki her şeyi getir ve karşılaştır
```powershell
git fetch --all --prune
git log --oneline main..origin/main      # yerel main'in gerisinde kalan commit'ler
git log --oneline HEAD..origin/main      # mevcut dalın görmediği main commit'leri
```
- Ayrıca mevcut dal origin'den **ileride** mi kontrol et (`git status` söyler).
  İlerideyse bu commit'ler GitHub'da YOK demektir — kullanıcıya bildir, silme/ezme yapma.

### 3. Yerel main'i güncelle (fast-forward)
```powershell
git checkout main
git pull origin main
```
- Bu normalde fast-forward olur. Çakışma/uyarı çıkarsa DUR ve kullanıcıya bildir.

### 4. Çalışma dalına dön ve güncel main'i dala al
Başta bir özellik dalındaysak (ör. `fix/...`):
```powershell
git checkout <baslangictaki-dal>
git merge origin/main -m "origin/main ile guncellendi"
```
- Çakışma çıkarsa: çakışmayı çözmeden devam etme; kullanıcıya dosya listesiyle bildir.

### 5. Sonucu raporla
Kullanıcıya şunları özetle:
- `main` hangi commit'e güncellendi (kısa hash + mesaj)
- Yerelde GitHub'a gönderilmemiş commit varsa listesi (push önerisi yap ama kendiliğinden push'lama)
- Merge yapıldıysa hangi dala

## Dikkat edilecekler
- **Asla** `git reset --hard`, `git push --force` veya `git checkout -- .` kullanma; bu işlem salt güncelleme içindir.
- Kullanıcı açıkça istemedikçe **push yapma**.
- OneDrive klasöründe çalışıldığı için nadiren dosya kilidi hatası olabilir; hata olursa komutu bir kez tekrar dene.

## Son uygulama kaydı
- 2026-07-12: `main` → `eab0963` (PR #2 merge: şifre sıfırlama akışı). `fix/sifre-sifirlama-akisi` dalına origin/main merge edildi (`703fbe6`). Dalda 3 yerel commit push bekliyor (güvenlik denetimi + UI/UX).
