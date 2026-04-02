from datetime import datetime, timedelta
import hashlib
import secrets

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext

try:
    from backend.config import ACCESS_TOKEN_EXPIRE_MINUTES, ALGORITHM, REFRESH_TOKEN_EXPIRE_DAYS, SECRET_KEY
except ModuleNotFoundError:
    from config import ACCESS_TOKEN_EXPIRE_MINUTES, ALGORITHM, REFRESH_TOKEN_EXPIRE_DAYS, SECRET_KEY

pwd_context = CryptContext(schemes=['bcrypt'], deprecated='auto')
oauth2_scheme = OAuth2PasswordBearer(tokenUrl='auth/login')


def validate_password_strength(password: str):
    if len(password) < 8:
        raise HTTPException(status_code=400, detail='Password must be at least 8 characters long')

    checks = {
        'uppercase': any(character.isupper() for character in password),
        'lowercase': any(character.islower() for character in password),
        'digit': any(character.isdigit() for character in password),
    }
    if not all(checks.values()):
        raise HTTPException(
            status_code=400,
            detail='Password must contain at least one uppercase letter, one lowercase letter, and one number',
        )


def create_access_token(data: dict):
    to_encode = data.copy()
    issued_at = datetime.utcnow()
    expire = issued_at + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({'exp': expire, 'iat': issued_at})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def create_refresh_token(expires_in_minutes: int | None = None) -> tuple[str, datetime]:
    token = secrets.token_urlsafe(48)
    if expires_in_minutes is not None:
        expires_at = datetime.utcnow() + timedelta(minutes=expires_in_minutes)
    else:
        expires_at = datetime.utcnow() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    return token, expires_at


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode('utf-8')).hexdigest()


def get_current_user_id(token: str = Depends(oauth2_scheme)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail='Could not validate credentials',
        headers={'WWW-Authenticate': 'Bearer'},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get('sub')
        if user_id is None:
            raise credentials_exception
        return user_id
    except JWTError:
        raise credentials_exception