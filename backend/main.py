import os
import uuid
import re
from datetime import datetime
from typing import List, Optional
from pathlib import Path

from fastapi import (
    FastAPI, Depends, HTTPException, UploadFile, File, Form,
    status, Request
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

import models
import schemas
from database import engine, get_db, Base
from auth import (
    sifre_hash_olustur, sifre_dogrula, token_olustur,
    mevcut_kullanici, admin_gerektir
)

# Veritabanı tablolarını oluştur
Base.metadata.create_all(bind=engine)

app = FastAPI(title="İyilik Derneği Temsilci Paneli", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", "/uploads"))
UPLOAD_DIR.mkdir(exist_ok=True)

IZIN_VERILEN_UZANTILAR = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".heif"}


def guvenli_klasor_adi(isim: str) -> str:
    """Temsilcilik adını dosya sistemi için güvenli hale getirir."""
    isim = isim.lower().strip()
    isim = isim.replace(" ", "-")
    tr_map = str.maketrans("çğıöşüÇĞİÖŞÜ", "cgiosuCGIOSU")
    isim = isim.translate(tr_map)
    isim = re.sub(r"[^a-z0-9\-_]", "", isim)
    return isim or "temsilcilik"


# ───────────────────────── İlk Admin Kurulumu ─────────────────────────

@app.on_event("startup")
def ilk_kurulum():
    db = next(get_db())
    try:
        admin = db.query(models.Kullanici).filter(
            models.Kullanici.rol == "admin"
        ).first()
        if not admin:
            admin = models.Kullanici(
                kullanici_adi="admin",
                sifre_hash=sifre_hash_olustur("Admin1234!"),
                ad_soyad="Sistem Yöneticisi",
                rol="admin",
            )
            db.add(admin)
            db.commit()
            print("✅ Varsayılan admin oluşturuldu → kullanıcı: admin / şifre: Admin1234!")
    finally:
        db.close()


# ───────────────────────── Auth ─────────────────────────

@app.post("/api/auth/token", response_model=schemas.TokenYanit)
def giris_yap(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    kullanici = db.query(models.Kullanici).filter(
        models.Kullanici.kullanici_adi == form_data.username
    ).first()
    if not kullanici or not sifre_dogrula(form_data.password, kullanici.sifre_hash):
        raise HTTPException(status_code=400, detail="Kullanıcı adı veya şifre hatalı")
    if not kullanici.aktif:
        raise HTTPException(status_code=403, detail="Hesap devre dışı")

    token = token_olustur({"sub": kullanici.kullanici_adi, "rol": kullanici.rol})
    return {"access_token": token, "token_type": "bearer", "kullanici": kullanici}


@app.get("/api/auth/ben", response_model=schemas.KullaniciYanit)
def ben_kimim(kullanici: models.Kullanici = Depends(mevcut_kullanici)):
    return kullanici


# ───────────────────────── Temsilcilikler ─────────────────────────

@app.get("/api/temsilcilikler", response_model=List[schemas.TemsilcilikYanit])
def temsilcilik_listesi(
    db: Session = Depends(get_db),
    _: models.Kullanici = Depends(mevcut_kullanici),
):
    return db.query(models.Temsilcilik).order_by(models.Temsilcilik.ad).all()


@app.post("/api/temsilcilikler", response_model=schemas.TemsilcilikYanit, status_code=201)
def temsilcilik_olustur(
    veri: schemas.TemsilcilikOlustur,
    db: Session = Depends(get_db),
    _: models.Kullanici = Depends(admin_gerektir),
):
    varmi = db.query(models.Temsilcilik).filter(models.Temsilcilik.ad == veri.ad).first()
    if varmi:
        raise HTTPException(status_code=400, detail="Bu isimde temsilcilik zaten var")
    yeni = models.Temsilcilik(ad=veri.ad, aciklama=veri.aciklama)
    db.add(yeni)
    db.commit()
    db.refresh(yeni)
    return yeni


@app.put("/api/temsilcilikler/{id}", response_model=schemas.TemsilcilikYanit)
def temsilcilik_guncelle(
    id: int,
    veri: schemas.TemsilcilikGuncelle,
    db: Session = Depends(get_db),
    _: models.Kullanici = Depends(admin_gerektir),
):
    kayit = db.query(models.Temsilcilik).get(id)
    if not kayit:
        raise HTTPException(status_code=404, detail="Temsilcilik bulunamadı")
    for alan, deger in veri.model_dump(exclude_unset=True).items():
        setattr(kayit, alan, deger)
    db.commit()
    db.refresh(kayit)
    return kayit


@app.delete("/api/temsilcilikler/{id}", status_code=204)
def temsilcilik_sil(
    id: int,
    db: Session = Depends(get_db),
    _: models.Kullanici = Depends(admin_gerektir),
):
    kayit = db.query(models.Temsilcilik).get(id)
    if not kayit:
        raise HTTPException(status_code=404, detail="Temsilcilik bulunamadı")
    db.delete(kayit)
    db.commit()


# ───────────────────────── Kullanıcılar ─────────────────────────

@app.get("/api/kullanicilar", response_model=List[schemas.KullaniciYanit])
def kullanici_listesi(
    db: Session = Depends(get_db),
    _: models.Kullanici = Depends(admin_gerektir),
):
    return db.query(models.Kullanici).order_by(models.Kullanici.ad_soyad).all()


@app.post("/api/kullanicilar", response_model=schemas.KullaniciYanit, status_code=201)
def kullanici_olustur(
    veri: schemas.KullaniciOlustur,
    db: Session = Depends(get_db),
    _: models.Kullanici = Depends(admin_gerektir),
):
    varmi = db.query(models.Kullanici).filter(
        models.Kullanici.kullanici_adi == veri.kullanici_adi
    ).first()
    if varmi:
        raise HTTPException(status_code=400, detail="Bu kullanıcı adı zaten kullanılıyor")
    if veri.rol == "temsilci" and not veri.temsilcilik_id:
        raise HTTPException(status_code=400, detail="Temsilci için temsilcilik seçilmeli")
    yeni = models.Kullanici(
        kullanici_adi=veri.kullanici_adi,
        sifre_hash=sifre_hash_olustur(veri.sifre),
        ad_soyad=veri.ad_soyad,
        rol=veri.rol,
        sehir=veri.sehir,
        temsilcilik_id=veri.temsilcilik_id,
    )
    db.add(yeni)
    db.commit()
    db.refresh(yeni)
    return yeni


@app.put("/api/kullanicilar/{id}", response_model=schemas.KullaniciYanit)
def kullanici_guncelle(
    id: int,
    veri: schemas.KullaniciGuncelle,
    db: Session = Depends(get_db),
    _: models.Kullanici = Depends(admin_gerektir),
):
    kayit = db.query(models.Kullanici).get(id)
    if not kayit:
        raise HTTPException(status_code=404, detail="Kullanıcı bulunamadı")
    guncelle = veri.model_dump(exclude_unset=True)
    if "sifre" in guncelle:
        kayit.sifre_hash = sifre_hash_olustur(guncelle.pop("sifre"))
    for alan, deger in guncelle.items():
        setattr(kayit, alan, deger)
    db.commit()
    db.refresh(kayit)
    return kayit


@app.delete("/api/kullanicilar/{id}", status_code=204)
def kullanici_sil(
    id: int,
    db: Session = Depends(get_db),
    _: models.Kullanici = Depends(admin_gerektir),
):
    kayit = db.query(models.Kullanici).get(id)
    if not kayit:
        raise HTTPException(status_code=404, detail="Kullanıcı bulunamadı")
    if kayit.rol == "admin":
        raise HTTPException(status_code=400, detail="Admin silinemez")
    db.delete(kayit)
    db.commit()


# ───────────────────────── Görseller ─────────────────────────

@app.post("/api/gorseller", response_model=schemas.GorselYanit, status_code=201)
async def gorsel_yukle(
    dosya: UploadFile = File(...),
    baslik: str = Form(...),
    db: Session = Depends(get_db),
    kullanici: models.Kullanici = Depends(mevcut_kullanici),
):
    if kullanici.rol == "temsilci" and not kullanici.temsilcilik_id:
        raise HTTPException(status_code=400, detail="Temsilcilik atanmamış")

    uzanti = Path(dosya.filename).suffix.lower()
    if uzanti not in IZIN_VERILEN_UZANTILAR:
        raise HTTPException(status_code=400, detail=f"İzin verilmeyen dosya türü: {uzanti}")

    temsilcilik_id = (
        kullanici.temsilcilik_id if kullanici.rol == "temsilci"
        else kullanici.temsilcilik_id
    )
    if not temsilcilik_id:
        raise HTTPException(status_code=400, detail="Temsilcilik belirtilmeli")

    temsilcilik = db.query(models.Temsilcilik).get(temsilcilik_id)
    if not temsilcilik:
        raise HTTPException(status_code=404, detail="Temsilcilik bulunamadı")

    bugun = datetime.now().strftime("%Y-%m-%d")
    sehir_adi = guvenli_klasor_adi(kullanici.sehir or "genel")
    if not baslik or not baslik.strip():
        raise HTTPException(status_code=400, detail="Başlık zorunludur")
    baslik = baslik.strip()
    baslik_adi = guvenli_klasor_adi(baslik)
    klasor = UPLOAD_DIR / bugun / sehir_adi / baslik_adi
    klasor.mkdir(parents=True, exist_ok=True)

    benzersiz_ad = f"{uuid.uuid4().hex}{uzanti}"
    tam_yol = klasor / benzersiz_ad

    icerik = await dosya.read()
    tam_yol.write_bytes(icerik)

    gorsel = models.Gorsel(
        dosya_adi=benzersiz_ad,
        dosya_yolu=str(tam_yol.relative_to(UPLOAD_DIR)),
        orijinal_ad=dosya.filename,
        baslik=baslik,
        boyut_bytes=len(icerik),
        tarih=bugun,
        temsilcilik_id=temsilcilik_id,
        yukleyen_id=kullanici.id,
    )
    db.add(gorsel)
    db.commit()
    db.refresh(gorsel)
    return gorsel


@app.get("/api/gorseller", response_model=List[schemas.GorselYanit])
def gorsel_listesi(
    tarih: Optional[str] = None,
    temsilcilik_id: Optional[int] = None,
    db: Session = Depends(get_db),
    kullanici: models.Kullanici = Depends(mevcut_kullanici),
):
    sorgu = db.query(models.Gorsel)
    if kullanici.rol == "temsilci":
        sorgu = sorgu.filter(models.Gorsel.temsilcilik_id == kullanici.temsilcilik_id)
    elif temsilcilik_id:
        sorgu = sorgu.filter(models.Gorsel.temsilcilik_id == temsilcilik_id)
    if tarih:
        sorgu = sorgu.filter(models.Gorsel.tarih == tarih)
    return sorgu.order_by(models.Gorsel.yuklenme_tarihi.desc()).all()


@app.get("/api/istatistik/temsilcilikler")
def temsilcilik_istatistik(
    db: Session = Depends(get_db),
    _: models.Kullanici = Depends(admin_gerektir),
):
    from sqlalchemy import func
    sonuc = (
        db.query(models.Temsilcilik.ad, func.count(models.Gorsel.id).label("adet"))
        .join(models.Gorsel, models.Gorsel.temsilcilik_id == models.Temsilcilik.id, isouter=True)
        .group_by(models.Temsilcilik.id)
        .order_by(func.count(models.Gorsel.id).desc())
        .all()
    )
    return [{"temsilcilik": ad, "adet": adet} for ad, adet in sonuc]


@app.get("/api/gorseller/takvim")
def gorsel_takvim(
    db: Session = Depends(get_db),
    _: models.Kullanici = Depends(mevcut_kullanici),
):
    """Hangi tarihlerde kaç görsel olduğunu döner (takvim için)."""
    from sqlalchemy import func
    sonuc = (
        db.query(models.Gorsel.tarih, func.count(models.Gorsel.id))
        .group_by(models.Gorsel.tarih)
        .order_by(models.Gorsel.tarih.desc())
        .all()
    )
    return [{"tarih": t, "adet": a} for t, a in sonuc]


@app.put("/api/gorseller/{id}/baslik", response_model=schemas.GorselYanit)
def gorsel_baslik_guncelle(
    id: int,
    veri: schemas.GorselBaslikGuncelle,
    db: Session = Depends(get_db),
    kullanici: models.Kullanici = Depends(mevcut_kullanici),
):
    gorsel = db.query(models.Gorsel).get(id)
    if not gorsel:
        raise HTTPException(status_code=404, detail="Görsel bulunamadı")
    if kullanici.rol == "temsilci" and gorsel.yukleyen_id != kullanici.id:
        raise HTTPException(status_code=403, detail="Yetki yok")
    gorsel.baslik = veri.baslik
    db.commit()
    db.refresh(gorsel)
    return gorsel


@app.delete("/api/gorseller/{id}", status_code=204)
def gorsel_sil(
    id: int,
    db: Session = Depends(get_db),
    kullanici: models.Kullanici = Depends(mevcut_kullanici),
):
    gorsel = db.query(models.Gorsel).get(id)
    if not gorsel:
        raise HTTPException(status_code=404, detail="Görsel bulunamadı")
    if kullanici.rol == "temsilci" and gorsel.yukleyen_id != kullanici.id:
        raise HTTPException(status_code=403, detail="Yetki yok")
    tam_yol = UPLOAD_DIR / gorsel.dosya_yolu
    if tam_yol.exists():
        tam_yol.unlink()
    db.delete(gorsel)
    db.commit()


# ───────────────────────── Logo ─────────────────────────

SISTEM_DIR = UPLOAD_DIR / "_sistem"
LOGO_UZANTILARI = {".jpg", ".jpeg", ".png", ".webp", ".svg"}


@app.get("/api/logo")
def logo_getir(db: Session = Depends(get_db)):
    ayar = db.query(models.Ayar).filter(models.Ayar.anahtar == "logo_yolu").first()
    if not ayar or not ayar.deger:
        raise HTTPException(status_code=404, detail="Logo yüklenmemiş")
    logo_yol = UPLOAD_DIR / ayar.deger
    if not logo_yol.exists():
        raise HTTPException(status_code=404, detail="Logo dosyası bulunamadı")
    return FileResponse(str(logo_yol))


@app.post("/api/logo")
async def logo_yukle(
    dosya: UploadFile = File(...),
    db: Session = Depends(get_db),
    _: models.Kullanici = Depends(admin_gerektir),
):
    uzanti = Path(dosya.filename).suffix.lower()
    if uzanti not in LOGO_UZANTILARI:
        raise HTTPException(status_code=400, detail="Geçersiz dosya türü (jpg, png, webp, svg)")
    SISTEM_DIR.mkdir(parents=True, exist_ok=True)
    # Eski logoyu sil
    for eski in SISTEM_DIR.glob("logo.*"):
        eski.unlink(missing_ok=True)
    logo_dosya = SISTEM_DIR / f"logo{uzanti}"
    logo_dosya.write_bytes(await dosya.read())
    relatif = str(logo_dosya.relative_to(UPLOAD_DIR))
    ayar = db.query(models.Ayar).filter(models.Ayar.anahtar == "logo_yolu").first()
    if ayar:
        ayar.deger = relatif
    else:
        db.add(models.Ayar(anahtar="logo_yolu", deger=relatif))
    db.commit()
    return {"durum": "ok"}


# ───────────────────────── Statik Dosyalar ─────────────────────────

# Yüklenen görselleri sun
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")

# Frontend
FRONTEND_DIR = Path("/frontend")
if FRONTEND_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR / "assets")), name="static")

    @app.get("/admin", include_in_schema=False)
    @app.get("/admin/{path:path}", include_in_schema=False)
    def admin_panel(path: str = ""):
        return FileResponse(str(FRONTEND_DIR / "admin" / "index.html"))

    @app.get("/", include_in_schema=False)
    @app.get("/{path:path}", include_in_schema=False)
    def temsilci_panel(path: str = ""):
        # API rotalarını geçme
        if path.startswith("api/") or path.startswith("uploads/") or path.startswith("static/"):
            raise HTTPException(status_code=404)
        return FileResponse(str(FRONTEND_DIR / "temsilci" / "index.html"))
