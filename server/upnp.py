"""v0.4.7.5 qp3: open the hosting port on the router by itself (UPnP), so friends can reach a hosted game without
anyone setting up port forwarding by hand.

When the service runs with --online (host.cmd), `PortMapper.open()` looks for the home router on the local network
(SSDP, the way game consoles do), asks it to forward TCP <port> to this PC, and reads the router's public address for
the "friends open http://..." line. The mapping is leased for an hour and renewed every half hour while the service
runs, and removed when it stops; a router that only takes permanent mappings gets one (it's simply re-used next time).

Nothing here is required: a router with UPnP switched off, a second router in front (double NAT) or an ISP that
shares one public address between customers (CGNAT) are all reported in plain words, and port forwarding by hand
(README: "Play online with friends") still works. Standard library only.
"""
import ipaddress
import re
import socket
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

SSDP_ADDR = ("239.255.255.250", 1900)
SEARCH_TARGETS = (
    "urn:schemas-upnp-org:device:InternetGatewayDevice:1",
    "urn:schemas-upnp-org:device:InternetGatewayDevice:2",
    "urn:schemas-upnp-org:service:WANIPConnection:1",
    "urn:schemas-upnp-org:service:WANIPConnection:2",
    "urn:schemas-upnp-org:service:WANPPPConnection:1",
)
WAN_SERVICES = ("WANIPConnection", "WANPPPConnection")
LEASE = 3600                       # seconds; renewed at half time
MAX_BODY = 256 * 1024
ERRORS = {
    "606": "the router refused (UPnP is on, but it doesn't let programs change port forwarding)",
    "718": "another device on your network already has that port forwarded to it",
    "724": "the router wants the same port outside and inside",
    "725": "the router only takes permanent mappings",
    "501": "the router failed the request",
    "402": "the router didn't understand the request",
}


class UPnPError(Exception):
    def __init__(self, code, text=""):
        super().__init__(f"{code} {text}".strip())
        self.code, self.text = str(code), text


_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))  # (never through a proxy: the router is local)


def _http(url, data=None, headers=None, timeout=4.0):
    req = urllib.request.Request(url, data=data, headers=headers or {}, method="POST" if data is not None else "GET")
    try:
        with _opener.open(req, timeout=timeout) as r:
            return r.status, r.read(MAX_BODY)
    except urllib.error.HTTPError as e:
        return e.code, e.read(MAX_BODY)


def private_ip(host):
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False
    return ip.is_private or ip.is_link_local


NOT_PUBLIC = [ipaddress.ip_network(n) for n in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10", "169.254.0.0/16", "127.0.0.0/8", "0.0.0.0/8")]


def shared_ip(host):
    """A "public" address the router reports that isn't one: a second router, or the ISP's shared NAT, in front of it."""
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return True
    return ip.version != 4 or any(ip in n for n in NOT_PUBLIC)


def local_ipv4s():
    """This PC's IPv4 addresses, the one that carries internet traffic first."""
    out = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("192.0.2.1", 9))  # (a UDP connect sends nothing: it only picks the outgoing interface)
        out.append(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            out.append(info[4][0])
    except OSError:
        pass
    seen, res = set(), []
    for ip in out:
        if ip not in seen and not ip.startswith(("127.", "169.254.", "0.")):
            seen.add(ip)
            res.append(ip)
    return res


def parse_ssdp(data):
    """The LOCATION of an SSDP answer (an HTTP-style header block), or None."""
    try:
        text = data.decode("utf-8", "replace")
    except Exception:
        return None
    if not text.upper().startswith(("HTTP/1.1 200", "HTTP/1.0 200", "NOTIFY")):
        return None
    m = re.search(r"^location:\s*(\S+)\s*$", text, re.I | re.M)
    return m.group(1) if m else None


def discover(timeout=2.5, addr=SSDP_ADDR, interfaces=None):
    """Ask every local network for an internet gateway; returns the description URLs that answered (router first)."""
    found = []
    socks = []
    for ip in (interfaces if interfaces is not None else local_ipv4s()) or [None]:
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
            s.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 2)
            if ip:
                s.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_IF, socket.inet_aton(ip))
                s.bind((ip, 0))
            s.setblocking(False)
            for st in SEARCH_TARGETS:
                msg = f"M-SEARCH * HTTP/1.1\r\nHOST: {addr[0]}:{addr[1]}\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\nST: {st}\r\n\r\n".encode()
                s.sendto(msg, addr)
            socks.append(s)
        except OSError:
            continue
    end = time.monotonic() + timeout
    import select
    try:
        while socks and time.monotonic() < end:
            ready, _, _ = select.select(socks, [], [], max(0.0, end - time.monotonic()))
            for s in ready:
                try:
                    data, src = s.recvfrom(8192)
                except OSError:
                    continue
                loc = parse_ssdp(data)
                if not loc:
                    continue
                host = urllib.parse.urlsplit(loc).hostname or ""
                # (only devices on the local network: a description URL elsewhere is ignored)
                if (private_ip(host) or host == src[0]) and loc not in found:
                    found.append(loc)
    finally:
        for s in socks:
            s.close()
    return found


def _local(tag):
    return tag.rsplit("}", 1)[-1]


def _find(el, name):
    for x in el.iter():
        if _local(x.tag) == name:
            return x
    return None


def wan_services(location):
    """(router name, [(service type, control URL)]) from a device description."""
    status, body = _http(location)
    if status != 200:
        raise UPnPError(status, "no device description")
    root = ET.fromstring(body)
    def text(el, tag):
        x = _find(el, tag) if el is not None else None
        return (x.text or "").strip() if x is not None else ""
    base = text(root, "URLBase") or location
    dev = _find(root, "device")
    name = text(dev, "friendlyName") or text(dev, "modelName") or "your router"
    name = re.sub(r"[^\x20-\x7e]", "", name)[:60] or "your router"  # (shown in a console window: plain ASCII)
    out = []
    for sv in root.iter():
        if _local(sv.tag) != "service":
            continue
        st, cu = _find(sv, "serviceType"), _find(sv, "controlURL")
        if st is None or cu is None or not st.text or not cu.text:
            continue
        if any(w in st.text for w in WAN_SERVICES):
            out.append((st.text.strip(), urllib.parse.urljoin(base, cu.text.strip())))
    return name, out


def soap(control, service, action, args=(), timeout=4.0):
    body = "".join(f"<{k}>{v}</{k}>" for k, v in args)
    env = ('<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">'
           f'<s:Body><u:{action} xmlns:u="{service}">{body}</u:{action}></s:Body></s:Envelope>').encode()
    status, data = _http(control, env, {"Content-Type": 'text/xml; charset="utf-8"', "SOAPAction": f'"{service}#{action}"'}, timeout)
    try:
        root = ET.fromstring(data) if data else None
    except ET.ParseError:
        root = None
    if status != 200:
        code = _find(root, "errorCode") if root is not None else None
        desc = _find(root, "errorDescription") if root is not None else None
        raise UPnPError(code.text.strip() if code is not None and code.text else status, desc.text.strip() if desc is not None and desc.text else "")
    return {_local(x.tag): (x.text or "").strip() for x in root.iter()} if root is not None else {}


def internal_ip_for(router_host, port=80):
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect((router_host, port or 80))
        return s.getsockname()[0]
    finally:
        s.close()


class PortMapper:
    """Forward TCP `port` on the router to this PC while hosting. Thread-safe; every step is short and times out."""

    def __init__(self, port, description="Afterhours 16", locations=None, discover_timeout=2.5):
        self.port, self.description = int(port), description
        self.locations = locations              # (tests: skip discovery)
        self.discover_timeout = discover_timeout
        self.done = threading.Event()
        self.lock = threading.Lock()
        self.state = "working"                  # working | open | failed | closed
        self.message = "Opening the port on your router..."
        self.router = None; self.external_ip = None; self.internal_ip = None; self.lease = None
        self.control = self.service = None
        self.renewer = None
        self.stopped = False

    def status(self):
        return {"state": self.state, "message": self.message, "router": self.router, "external_ip": self.external_ip,
                "internal_ip": self.internal_ip, "port": self.port, "lease": self.lease}

    def _fail(self, msg):
        self.state, self.message = "failed", msg
        return False

    def open(self):
        try:
            return self._open()
        except Exception as e:  # (anything at all: hosting goes on without it)
            return self._fail(f"Couldn't open the port automatically ({e}).")
        finally:
            self.done.set()

    def _open(self):
        locs = self.locations if self.locations is not None else discover(self.discover_timeout)
        if not locs:
            return self._fail("No router answered the request to open the port (UPnP is probably switched off on your router).")
        last = None
        for loc in locs:
            try:
                name, services = wan_services(loc)
            except Exception as e:  # noqa: BLE001  (a broken description: try the next device)
                last = f"{urllib.parse.urlsplit(loc).hostname}: {e}"
                continue
            host = urllib.parse.urlsplit(loc).hostname
            for st, control in services:
                try:
                    ok = self._map(name, host, st, control)
                except UPnPError as e:
                    last = ERRORS.get(e.code, f"error {e.code}{(': ' + e.text) if e.text else ''}")
                    if e.code in ("718",):
                        return self._fail(f"Couldn't open the port automatically: {last}. Forward TCP {self.port} to {self.internal_ip} on your router by hand.")
                    continue
                except (OSError, ET.ParseError) as e:
                    last = str(e)
                    continue
                if ok:
                    return True
        return self._fail(f"Couldn't open the port automatically ({last or 'the router has no port-forwarding service'}).")

    def _map(self, name, host, st, control):
        self.internal_ip = internal_ip_for(host, urllib.parse.urlsplit(control).port or 80)
        try:
            ext = soap(control, st, "GetExternalIPAddress").get("NewExternalIPAddress") or None
        except UPnPError:
            ext = None
        # already forwarded? to us: fine (renewed below); to another device: his, not ours to take
        try:
            cur = soap(control, st, "GetSpecificPortMappingEntry", (("NewRemoteHost", ""), ("NewExternalPort", self.port), ("NewProtocol", "TCP")))
            if cur.get("NewInternalClient") and cur["NewInternalClient"] != self.internal_ip:
                raise UPnPError("718", f"forwarded to {cur['NewInternalClient']}")
        except UPnPError as e:
            if e.code == "718":
                raise
        lease = LEASE
        try:
            self._add(control, st, lease)
        except UPnPError as e:
            if e.code != "725":
                raise
            lease = 0
            self._add(control, st, 0)
        with self.lock:
            self.router, self.external_ip, self.lease = name, ext, lease
            self.control, self.service = control, st
            self.state = "open"
            if ext and shared_ip(ext):
                self.message = (f"Port {self.port} is open on {name}, but your router's own internet address is {ext}: there's another router "
                                f"or your internet provider's network in front of it, so friends outside your home probably can't reach you. "
                                f"Friends on your network can; for the rest, see README: Play online with friends (a VPN like Tailscale works).")
            else:
                self.message = f"Port {self.port} opened on {name} automatically (UPnP), for as long as you host."
        if lease and not self.renewer:
            self.renewer = threading.Thread(target=self._renew, daemon=True)
            self.renewer.start()
        return True

    def _add(self, control, st, lease):
        soap(control, st, "AddPortMapping", (("NewRemoteHost", ""), ("NewExternalPort", self.port), ("NewProtocol", "TCP"),
                                             ("NewInternalPort", self.port), ("NewInternalClient", self.internal_ip), ("NewEnabled", 1),
                                             ("NewPortMappingDescription", self.description), ("NewLeaseDuration", lease)))

    def _renew(self):
        while not self.stopped:
            time.sleep(max(60, (self.lease or LEASE) / 2))
            if self.stopped:
                return
            try:
                self._add(self.control, self.service, self.lease)
            except Exception:  # noqa: BLE001  (the next try may work; the lease still has half its time)
                pass

    def close(self):
        """Take the forwarding down (on the way out). Quick: one request, three seconds at most."""
        self.stopped = True
        with self.lock:
            if self.state != "open" or not self.control:
                return False
            control, st = self.control, self.service
            self.state, self.message = "closed", f"Port {self.port} closed on {self.router}."
        try:
            soap(control, st, "DeletePortMapping", (("NewRemoteHost", ""), ("NewExternalPort", self.port), ("NewProtocol", "TCP")), timeout=3)
            return True
        except Exception:  # noqa: BLE001
            return False

    def summary(self, wait=12.0):
        """The lines host.cmd shows (after waiting for the attempt to finish)."""
        if not self.done.wait(wait):
            return "NO The router hasn't answered yet: the service window will say when the port is open.\n"
        st = self.status()
        lines = []
        if st["external_ip"] and not shared_ip(st["external_ip"]):
            lines.append(f"PUBLIC http://{st['external_ip']}:{self.port}/")
        elif st["external_ip"]:
            lines.append(f"SHARED {st['external_ip']}")
        lines.append(("OK " if st["state"] == "open" else "NO ") + st["message"])
        if st["state"] != "open" and st["internal_ip"]:
            lines.append(f"FORWARD Forward TCP {self.port} to {st['internal_ip']} on your router.")
        return "\n".join(lines) + "\n"
