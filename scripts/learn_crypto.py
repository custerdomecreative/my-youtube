"""Encryption for the Learn tab's lessons and headlines.

The repository is public, but lessons and headline write-ups mention where
Aaron works, so they're stored encrypted:

- Anyone can *seal* a file with learn/public-key.txt (an X25519 public key).
  That's how lessons and headline digests get added, without the password.
- Only the news password can *open* them: the private key is derived from
  NEWS_PASSWORD, so no extra secret is needed. The update job opens them and
  re-encrypts the whole Learn tab the same way as the news (see encrypt()).
"""
import base64
import json
import os

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

# Same scheme and settings as scripts/fetch_news.py, so the pages' saved key opens both.
KDF_SALT = b"my-youtube-news-v1"
KDF_ITERATIONS = 250_000
SEAL_SALT = b"my-youtube-learn-x25519-v1"
SEAL_INFO = b"my-youtube-learn-seal-v1"

b64 = lambda b: base64.b64encode(b).decode()
unb64 = lambda s: base64.b64decode(s)
RAW = dict(encoding=serialization.Encoding.Raw, format=serialization.PublicFormat.Raw)


def private_key(password: str) -> X25519PrivateKey:
    seed = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=SEAL_SALT,
                      iterations=KDF_ITERATIONS).derive(password.encode())
    return X25519PrivateKey.from_private_bytes(seed)


def public_key_b64(password: str) -> str:
    return b64(private_key(password).public_key().public_bytes(**RAW))


def _aes_key(shared: bytes, epk: bytes, rpk: bytes) -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=epk + rpk, info=SEAL_INFO).derive(shared)


def seal(payload: dict, public_b64: str) -> dict:
    """Encrypt for whoever holds the news password."""
    rpk = unb64(public_b64.strip())
    eph = X25519PrivateKey.generate()
    epk = eph.public_key().public_bytes(**RAW)
    key = _aes_key(eph.exchange(X25519PublicKey.from_public_bytes(rpk)), epk, rpk)
    iv = os.urandom(12)
    data = AESGCM(key).encrypt(iv, json.dumps(payload, ensure_ascii=False).encode(), None)
    return {"v": 1, "epk": b64(epk), "iv": b64(iv), "data": b64(data)}


def open_sealed(sealed: dict, priv: X25519PrivateKey) -> dict:
    epk = unb64(sealed["epk"])
    rpk = priv.public_key().public_bytes(**RAW)
    key = _aes_key(priv.exchange(X25519PublicKey.from_public_bytes(epk)), epk, rpk)
    return json.loads(AESGCM(key).decrypt(unb64(sealed["iv"]), unb64(sealed["data"]), None))


def encrypt(payload: dict, password: str) -> dict:
    """Password encryption the pages can open (same as the news)."""
    key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=KDF_SALT,
                     iterations=KDF_ITERATIONS).derive(password.encode())
    iv = os.urandom(12)
    data = AESGCM(key).encrypt(iv, json.dumps(payload, ensure_ascii=False).encode(), None)
    return {"v": 1, "iterations": KDF_ITERATIONS, "salt": b64(KDF_SALT), "iv": b64(iv), "data": b64(data)}
