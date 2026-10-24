"""``wiqaya serve | prefetch | doctor``."""

from __future__ import annotations

import argparse
import datetime as dt
import ipaddress
import socket
import sys

from wiqaya.config import SETTINGS


def _lan_ip() -> str | None:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            return s.getsockname()[0]
    except OSError:
        return None


def _certificate(ip: str | None) -> tuple[str, str]:
    """A self-signed certificate for this computer, so phones on the same Wi-Fi may use the camera (browsers allow
    the camera only on HTTPS pages). Phones show a warning the first time; accept it once."""
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.x509.oid import NameOID

    SETTINGS.ensure()
    cert_path, key_path = SETTINGS.data_dir / "cert.pem", SETTINGS.data_dir / "key.pem"
    if cert_path.exists() and key_path.exists():
        return str(cert_path), str(key_path)
    key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Wiqaya on this computer")])
    alt = [x509.DNSName("localhost"), x509.IPAddress(ipaddress.ip_address("127.0.0.1"))]
    if ip:
        alt.append(x509.IPAddress(ipaddress.ip_address(ip)))
    now = dt.datetime.now(dt.timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
            .serial_number(x509.random_serial_number()).not_valid_before(now - dt.timedelta(days=1))
            .not_valid_after(now + dt.timedelta(days=825)).add_extension(x509.SubjectAlternativeName(alt), False)
            .sign(key, hashes.SHA256()))
    key_path.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                           serialization.NoEncryption()))
    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    return str(cert_path), str(key_path)


def serve(args) -> None:
    import uvicorn

    from wiqaya.app import create_app

    ip = _lan_ip()
    scheme = "https" if args.https else "http"
    kw = {}
    if args.https:
        kw["ssl_certfile"], kw["ssl_keyfile"] = _certificate(ip)
    print(f"Wiqaya on {scheme}://127.0.0.1:{args.port}/")
    if args.host == "0.0.0.0" and ip:
        print(f"Phones on the same Wi-Fi: {scheme}://{ip}:{args.port}/")
    uvicorn.run(create_app(), host=args.host, port=args.port, access_log=False, log_level="warning", **kw)


def prefetch(_args) -> None:
    from wiqaya import off

    n = off.prefetch_jordan()
    print(f"{n} products sold in Jordan cached in {SETTINGS.data_dir}")


def doctor(_args) -> None:
    import httpx

    from wiqaya.gemma import Gemma
    from wiqaya.search import web_search

    ok = True
    st = Gemma().status()
    print(f"Gemma: {'ready' if st['available'] else 'NOT ready (' + st.get('reason', '') + ')'}  model {st['model']}")
    ok &= st["available"]
    try:
        r = httpx.get(f"{SETTINGS.off_url}/api/v2/product/3017624010701.json?fields=code", timeout=10,
                      headers={"User-Agent": SETTINGS.user_agent})
        print(f"Open Food Facts: {'reachable' if r.status_code == 200 else r.status_code}")
    except httpx.HTTPError as e:
        print(f"Open Food Facts: unreachable ({type(e).__name__})")
    hits = web_search("E476 emulsifier source", 2)
    print(f"Web search: {'working' if hits else 'no results (Gemma can still use Open Food Facts)'}")
    sys.exit(0 if ok else 1)


def main() -> None:
    ap = argparse.ArgumentParser(prog="wiqaya")
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("serve", help="run the app")
    s.add_argument("--host", default="127.0.0.1", help="0.0.0.0 to let phones on the same Wi-Fi connect")
    s.add_argument("--port", type=int, default=8000)
    s.add_argument("--https", action="store_true", help="self-signed HTTPS, needed for phone cameras over Wi-Fi")
    s.set_defaults(fn=serve)
    sub.add_parser("prefetch", help="cache the products sold in Jordan from Open Food Facts").set_defaults(fn=prefetch)
    sub.add_parser("doctor", help="check Gemma, Open Food Facts and web search").set_defaults(fn=doctor)
    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
