from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel


class TemsilcilikOlustur(BaseModel):
    ad: str
    aciklama: Optional[str] = None


class TemsilcilikGuncelle(BaseModel):
    ad: Optional[str] = None
    aciklama: Optional[str] = None
    aktif: Optional[bool] = None


class TemsilcilikYanit(BaseModel):
    id: int
    ad: str
    aciklama: Optional[str]
    aktif: bool
    olusturma_tarihi: datetime
    model_config = {"from_attributes": True}


class KullaniciOlustur(BaseModel):
    kullanici_adi: str
    sifre: str
    ad_soyad: str
    rol: str = "temsilci"
    temsilcilik_id: Optional[int] = None


class KullaniciGuncelle(BaseModel):
    ad_soyad: Optional[str] = None
    sifre: Optional[str] = None
    temsilcilik_id: Optional[int] = None
    aktif: Optional[bool] = None


class KullaniciYanit(BaseModel):
    id: int
    kullanici_adi: str
    ad_soyad: str
    rol: str
    temsilcilik_id: Optional[int]
    temsilcilik: Optional[TemsilcilikYanit]
    aktif: bool
    olusturma_tarihi: datetime
    model_config = {"from_attributes": True}


class GorselNotGuncelle(BaseModel):
    not_metni: str


class GorselYanit(BaseModel):
    id: int
    dosya_adi: str
    dosya_yolu: str
    orijinal_ad: str
    not_metni: Optional[str]
    boyut_bytes: Optional[int]
    yuklenme_tarihi: datetime
    tarih: str
    temsilcilik_id: int
    temsilcilik: TemsilcilikYanit
    yukleyen_id: int
    yukleyen: KullaniciYanit
    model_config = {"from_attributes": True}


class TokenYanit(BaseModel):
    access_token: str
    token_type: str
    kullanici: KullaniciYanit


class GunGorselGrubu(BaseModel):
    tarih: str
    temsilcilikler: dict  # temsilcilik_adi -> List[GorselYanit]
