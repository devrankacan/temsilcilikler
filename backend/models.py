from datetime import datetime
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, Boolean, UniqueConstraint
from sqlalchemy.orm import relationship
from database import Base


class Ayar(Base):
    __tablename__ = "ayarlar"

    anahtar = Column(String(50), primary_key=True)
    deger = Column(Text, nullable=True)


class Temsilcilik(Base):
    __tablename__ = "temsilcilikler"

    id = Column(Integer, primary_key=True, index=True)
    ad = Column(String(100), unique=True, nullable=False)
    aciklama = Column(Text, nullable=True)
    olusturma_tarihi = Column(DateTime, default=datetime.utcnow)
    aktif = Column(Boolean, default=True)

    kullanicilar = relationship("Kullanici", back_populates="temsilcilik")
    gorseller = relationship("Gorsel", back_populates="temsilcilik")


class Kullanici(Base):
    __tablename__ = "kullanicilar"

    id = Column(Integer, primary_key=True, index=True)
    kullanici_adi = Column(String(50), unique=True, nullable=False, index=True)
    sifre_hash = Column(String(255), nullable=False)
    ad_soyad = Column(String(100), nullable=False)
    rol = Column(String(20), nullable=False, default="temsilci")  # admin | temsilci
    temsilcilik_id = Column(Integer, ForeignKey("temsilcilikler.id"), nullable=True)
    sehir = Column(String(100), nullable=True)
    aktif = Column(Boolean, default=True)
    olusturma_tarihi = Column(DateTime, default=datetime.utcnow)

    temsilcilik = relationship("Temsilcilik", back_populates="kullanicilar")
    gorseller = relationship("Gorsel", back_populates="yukleyen")


class Gorsel(Base):
    __tablename__ = "gorseller"

    id = Column(Integer, primary_key=True, index=True)
    dosya_adi = Column(String(255), nullable=False)
    dosya_yolu = Column(String(500), nullable=False)
    orijinal_ad = Column(String(255), nullable=False)
    baslik = Column(Text, nullable=True)
    boyut_bytes = Column(Integer, nullable=True)
    yuklenme_tarihi = Column(DateTime, default=datetime.utcnow)
    tarih = Column(String(10), nullable=False)  # YYYY-MM-DD

    temsilcilik_id = Column(Integer, ForeignKey("temsilcilikler.id"), nullable=False)
    yukleyen_id = Column(Integer, ForeignKey("kullanicilar.id"), nullable=False)

    temsilcilik = relationship("Temsilcilik", back_populates="gorseller")
    yukleyen = relationship("Kullanici", back_populates="gorseller")


class SosyalMedyaIstatistik(Base):
    __tablename__ = "sosyal_medya_istatistik"

    id = Column(Integer, primary_key=True, index=True)
    platform = Column(String(50), nullable=False)   # instagram | facebook | x | youtube
    ay = Column(String(7), nullable=False)           # YYYY-MM
    takipci = Column(Integer, nullable=True)
    etkilesim = Column(Integer, nullable=True)       # o ay toplam beğeni+yorum+paylaşım
    icerik_sayisi = Column(Integer, nullable=True)   # o ay paylaşılan içerik sayısı
    kayit_tarihi = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("platform", "ay", name="uq_platform_ay"),)


class SosyalMedyaIcerik(Base):
    __tablename__ = "sosyal_medya_icerik"

    id = Column(Integer, primary_key=True, index=True)
    platform = Column(String(50), nullable=False)
    ay = Column(String(7), nullable=False)           # YYYY-MM
    icerik_id = Column(String(200), nullable=True)   # platformun kendi ID'si
    baslik = Column(Text, nullable=True)             # caption / başlık
    url = Column(String(500), nullable=True)
    begeni = Column(Integer, default=0)
    yorum = Column(Integer, default=0)
    paylasim = Column(Integer, default=0)            # shares / retweets
    goruntuleme = Column(Integer, default=0)
    tarih = Column(String(30), nullable=True)        # içeriğin yayın tarihi
    kayit_tarihi = Column(DateTime, default=datetime.utcnow)
