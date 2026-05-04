import os
from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from database import get_db
import models

SECRET_KEY = os.getenv("SECRET_KEY", "iyilik-dernegi-gizli-anahtar-2024-degistir")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7 gün

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/token")


def sifre_hash_olustur(sifre: str) -> str:
    return pwd_context.hash(sifre)


def sifre_dogrula(sifre: str, hash: str) -> bool:
    return pwd_context.verify(sifre, hash)


def token_olustur(data: dict, sure: Optional[timedelta] = None) -> str:
    payload = data.copy()
    bitis = datetime.utcnow() + (sure or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    payload.update({"exp": bitis})
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def mevcut_kullanici(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> models.Kullanici:
    hata = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Geçersiz kimlik bilgileri",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        kullanici_adi: str = payload.get("sub")
        if kullanici_adi is None:
            raise hata
    except JWTError:
        raise hata

    kullanici = db.query(models.Kullanici).filter(
        models.Kullanici.kullanici_adi == kullanici_adi
    ).first()
    if kullanici is None or not kullanici.aktif:
        raise hata
    return kullanici


def admin_gerektir(kullanici: models.Kullanici = Depends(mevcut_kullanici)):
    if kullanici.rol != "admin":
        raise HTTPException(status_code=403, detail="Bu işlem için admin yetkisi gerekli")
    return kullanici
