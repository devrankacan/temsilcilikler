# İyilik Derneği – Temsilci Takip Sistemi

## VPS Kurulum Adımları

### 1. Ön gereksinimler
```bash
# Docker ve Docker Compose kur
apt update && apt install -y docker.io docker-compose-plugin
```

### 2. Projeyi çek
```bash
git clone https://github.com/devrankacan/temsilcilikler.git
cd temsilcilikler
git checkout claude/admin-user-charity-Aqq9Q
```

### 3. Ortam değişkeni ayarla
```bash
cp .env.example .env
# .env dosyasını aç ve SECRET_KEY değerini güçlü bir şeye değiştir
nano .env
```

### 4. Başlat
```bash
docker compose up -d --build
```

### 5. Kontrol et
```bash
docker compose ps
docker compose logs -f
```

Sistem `http://SUNUCU_IP` adresinde ayakta olacak.

---

## Varsayılan Admin Hesabı
- **Kullanıcı adı:** `admin`
- **Şifre:** `Admin1234!`
- **⚠️ İlk girişte şifreyi değiştirin!**

---

## Sayfa Adresleri
| Sayfa | URL |
|-------|-----|
| Temsilci Paneli | `http://SUNUCU_IP/` |
| Admin Paneli | `http://SUNUCU_IP/admin` |

---

## Dosya Yapısı (Yüklenen Görseller)
```
uploads/
├── 2024-11-15/
│   ├── istanbul-temsilciligi/
│   │   ├── abc123def.jpg
│   │   └── xyz789ghi.png
│   └── ankara-temsilciligi/
│       └── pqr456stu.jpg
└── 2024-11-16/
    └── izmir-temsilciligi/
        └── ...
```

---

## Güncelleme
```bash
git pull origin claude/admin-user-charity-Aqq9Q
docker compose up -d --build
```

## Yedek Alma
```bash
# Görseller ve veritabanı
tar -czf yedek-$(date +%Y%m%d).tar.gz uploads/ data/
```

## Durdurma
```bash
docker compose down
```
