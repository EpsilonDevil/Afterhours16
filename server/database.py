import contextlib
import hashlib
import json
import secrets
import sqlite3
import threading
import time
import uuid
from pathlib import Path
from .builds import Invalid


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


class Database:
    def __init__(self, path, welcome_vc=1_000_000):
        self.path = str(path)
        self.welcome_vc = welcome_vc  # one-time fictional VC for each new account
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.conn = sqlite3.connect(self.path, check_same_thread=False, isolation_level=None)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys=ON")
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA synchronous=FULL")
        self.conn.execute("PRAGMA busy_timeout=5000")
        self.conn.execute("CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at REAL NOT NULL)")
        applied = {r[0] for r in self.conn.execute("SELECT version FROM schema_migrations")}
        for path in sorted((Path(__file__).parent / "migrations").glob("*.sql")):
            version = int(path.name.split("_")[0])
            if version not in applied:
                self.conn.executescript("BEGIN IMMEDIATE;\n" + path.read_text() + f"\nINSERT INTO schema_migrations VALUES({version},{time.time()});\nCOMMIT;")

    @contextlib.contextmanager
    def transaction(self):
        with self.lock:
            self.conn.execute("BEGIN IMMEDIATE")
            try:
                yield self.conn
                self.conn.execute("COMMIT")
            except BaseException:
                self.conn.execute("ROLLBACK")
                raise

    def query(self, sql, values=()):
        with self.lock:
            return self.conn.execute(sql, values).fetchall()

    def once(self, account_id, key, action, payload, mutation):
        if not isinstance(key, str) or not 8 <= len(key) <= 100 or not key.isascii():
            raise Invalid("An idempotency key of 8–100 ASCII characters is required.")
        fingerprint = hashlib.sha256(encode([action, payload]).encode()).hexdigest()
        with self.transaction() as c:
            old = c.execute("SELECT * FROM requests WHERE account_id=? AND key=?", (account_id, key)).fetchone()
            if old:
                if old["fingerprint"] != fingerprint:
                    raise Invalid("Idempotency key already used for a different request.")
                return json.loads(old["response"])
            response = mutation(c)
            c.execute("INSERT INTO requests VALUES(?,?,?,?,?)", (account_id, key, fingerprint, encode(response), time.time()))
            return response

    @staticmethod
    def change_wallet(c, account_id, delta, kind, reference):
        old = c.execute("SELECT balance_after FROM ledger WHERE account_id=? AND reference=?", (account_id, reference)).fetchone()
        if old:
            return old[0]
        row = c.execute("SELECT balance FROM wallets WHERE account_id=?", (account_id,)).fetchone()
        if not row or row[0] + delta < 0:
            raise Invalid("Not enough VC.")
        balance = row[0] + delta
        c.execute("UPDATE wallets SET balance=? WHERE account_id=?", (balance, account_id))
        c.execute("INSERT INTO ledger(account_id,delta,balance_after,kind,reference,created_at) VALUES(?,?,?,?,?,?)",
                  (account_id, delta, balance, kind, reference, time.time()))
        return balance

    def create_account(self, username, password, starter_items, local=False):
        salt = secrets.token_hex(16)
        hashed = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()
        account_id = str(uuid.uuid4())
        with self.transaction() as c:
            if local:
                old = c.execute("SELECT id FROM accounts WHERE username=?", (username,)).fetchone()
                if old:
                    return old[0]
            c.execute("INSERT INTO accounts VALUES(?,?,?,?,?)", (account_id, username, salt, hashed, time.time()))
            c.execute("INSERT INTO wallets VALUES(?,0)", (account_id,))
            if self.welcome_vc > 0:
                self.change_wallet(c, account_id, self.welcome_vc, "welcome_grant", "welcome:v1")
            for item_id in starter_items:
                c.execute("INSERT INTO inventory VALUES(?,?,?)", (account_id, item_id, time.time()))
        return account_id

    def session(self, account_id):
        token = secrets.token_urlsafe(32)
        hashed = hashlib.sha256(token.encode()).hexdigest()
        with self.transaction() as c:
            c.execute("DELETE FROM sessions WHERE expires_at < ?", (time.time(),))
            c.execute("INSERT INTO sessions VALUES(?,?,?)", (hashed, account_id, time.time() + 30 * 86400))
        return token

    def authenticate(self, token):
        if not token:
            return None
        rows = self.query("SELECT account_id FROM sessions WHERE token_hash=? AND expires_at>?", (hashlib.sha256(token.encode()).hexdigest(), time.time()))
        return rows[0][0] if rows else None
