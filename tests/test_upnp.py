"""v0.4.7.5 qp3: hosting opens its port on the router by itself (server/upnp.py), against a fake home router: SSDP
discovery, the device description, AddPortMapping with a lease (or permanent when that's all the router takes), a port
already forwarded to someone else, a router behind another NAT, and taking the forwarding down again.

Run from the project root:  python -m unittest discover -s tests -v
"""
import http.cookiejar
import json
import socket
import tempfile
import threading
import unittest
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from server import upnp, app as server_app

DESC = """<?xml version="1.0"?>
<root xmlns="urn:schemas-upnp-org:device-1-0"><specVersion><major>1</major><minor>0</minor></specVersion>
<device><deviceType>urn:schemas-upnp-org:device:InternetGatewayDevice:1</deviceType><friendlyName>Test Router 9000</friendlyName>
<modelName>TR9000</modelName><serviceList><service><serviceType>urn:schemas-upnp-org:service:Layer3Forwarding:1</serviceType>
<controlURL>/ctl/L3F</controlURL></service></serviceList>
<deviceList><device><deviceType>urn:schemas-upnp-org:device:WANDevice:1</deviceType><deviceList><device>
<deviceType>urn:schemas-upnp-org:device:WANConnectionDevice:1</deviceType><serviceList><service>
<serviceType>urn:schemas-upnp-org:service:WANIPConnection:1</serviceType><serviceId>urn:upnp-org:serviceId:WANIPConn1</serviceId>
<controlURL>/ctl/IPConn</controlURL><eventSubURL>/evt/IPConn</eventSubURL><SCPDURL>/WANIPCn.xml</SCPDURL></service></serviceList>
</device></deviceList></device></deviceList></device></root>"""


class FakeRouter:
    def __init__(self, external="203.0.113.7", permanent_only=False):
        self.external, self.permanent_only = external, permanent_only
        self.mappings = {}   # (port, proto) -> dict
        self.calls = []
        router = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def reply(self, code, body, ctype="text/xml"):
                data = body.encode()
                self.send_response(code)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def do_GET(self):
                self.reply(200, DESC) if self.path == "/rootDesc.xml" else self.reply(404, "")

            def do_POST(self):
                body = self.rfile.read(int(self.headers.get("Content-Length", 0))).decode()
                action = self.headers.get("SOAPAction", "").strip('"').split("#")[-1]
                router.calls.append(action)
                val = lambda k: body.split(f"<{k}>")[1].split(f"</{k}>")[0] if f"<{k}>" in body else ""
                key = (val("NewExternalPort"), val("NewProtocol"))
                out = ""
                if action == "GetExternalIPAddress":
                    out = f"<NewExternalIPAddress>{router.external}</NewExternalIPAddress>"
                elif action == "GetSpecificPortMappingEntry":
                    m = router.mappings.get(key)
                    if not m:
                        return self.fault(714, "NoSuchEntryInArray")
                    out = f"<NewInternalPort>{m['port']}</NewInternalPort><NewInternalClient>{m['client']}</NewInternalClient>"
                elif action == "AddPortMapping":
                    if router.permanent_only and val("NewLeaseDuration") != "0":
                        return self.fault(725, "OnlyPermanentLeasesSupported")
                    m = router.mappings.get(key)
                    if m and m["client"] != val("NewInternalClient"):
                        return self.fault(718, "ConflictInMappingEntry")
                    router.mappings[key] = {"port": val("NewInternalPort"), "client": val("NewInternalClient"), "lease": val("NewLeaseDuration"), "desc": val("NewPortMappingDescription")}
                elif action == "DeletePortMapping":
                    router.mappings.pop(key, None)
                else:
                    return self.fault(401, "Invalid Action")
                self.reply(200, f'<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><u:{action}Response xmlns:u="urn:schemas-upnp-org:service:WANIPConnection:1">{out}</u:{action}Response></s:Body></s:Envelope>')

            def fault(self, code, desc):
                self.reply(500, f'<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><s:Fault><faultcode>s:Client</faultcode><faultstring>UPnPError</faultstring><detail><UPnPError xmlns="urn:schemas-upnp-org:control-1-0"><errorCode>{code}</errorCode><errorDescription>{desc}</errorDescription></UPnPError></detail></s:Fault></s:Body></s:Envelope>')

        self.http = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.http.daemon_threads = True
        threading.Thread(target=self.http.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True).start()
        self.location = f"http://127.0.0.1:{self.http.server_address[1]}/rootDesc.xml"

    def stop(self):
        self.http.shutdown()
        self.http.server_close()


class UPnPTests(unittest.TestCase):
    def test_opens_the_port_with_a_lease_reports_the_address_and_closes_it(self):
        r = FakeRouter()
        try:
            m = upnp.PortMapper(8765, "Afterhours 16", locations=[r.location])
            self.assertTrue(m.open())
            st = m.status()
            self.assertEqual((st["state"], st["router"], st["external_ip"], st["internal_ip"], st["lease"]), ("open", "Test Router 9000", "203.0.113.7", "127.0.0.1", 3600))
            self.assertEqual(r.mappings[("8765", "TCP")], {"port": "8765", "client": "127.0.0.1", "lease": "3600", "desc": "Afterhours 16"})
            lines = m.summary(wait=1)
            self.assertIn("PUBLIC http://203.0.113.7:8765/", lines)
            self.assertIn("OK Port 8765 opened on Test Router 9000", lines)
            self.assertTrue(lines.isascii())
            self.assertTrue(m.close())
            self.assertEqual(r.mappings, {})
            self.assertEqual(m.status()["state"], "closed")
            self.assertFalse(m.close(), "closing twice does nothing")
        finally:
            r.stop()

    def test_a_router_that_only_takes_permanent_mappings_gets_one(self):
        r = FakeRouter(permanent_only=True)
        try:
            m = upnp.PortMapper(8765, locations=[r.location])
            self.assertTrue(m.open())
            self.assertEqual(m.status()["lease"], 0)
            self.assertEqual(r.mappings[("8765", "TCP")]["lease"], "0")
            m.close()
        finally:
            r.stop()

    def test_a_port_forwarded_to_another_device_is_left_alone(self):
        r = FakeRouter()
        r.mappings[("8765", "TCP")] = {"port": "8765", "client": "192.168.1.50", "lease": "0", "desc": "someone else"}
        try:
            m = upnp.PortMapper(8765, locations=[r.location])
            self.assertFalse(m.open())
            st = m.status()
            self.assertEqual(st["state"], "failed")
            self.assertIn("another device", st["message"])
            self.assertIn("by hand", st["message"])
            self.assertNotIn("AddPortMapping", r.calls)
            self.assertEqual(r.mappings[("8765", "TCP")]["client"], "192.168.1.50")
            self.assertIn("FORWARD Forward TCP 8765 to 127.0.0.1", m.summary(wait=1))
        finally:
            r.stop()

    def test_a_router_behind_another_nat_is_called_out(self):
        for ext in ("100.72.4.9", "192.168.0.10"):
            r = FakeRouter(external=ext)
            try:
                m = upnp.PortMapper(8765, locations=[r.location])
                self.assertTrue(m.open())
                self.assertIn("in front of it", m.status()["message"])
                self.assertNotIn("PUBLIC", m.summary(wait=1), "no public address to give out")
                self.assertIn(f"SHARED {ext}", m.summary(wait=1))
                m.close()
            finally:
                r.stop()

    def test_no_router_answering(self):
        m = upnp.PortMapper(8765, locations=[])
        self.assertFalse(m.open())
        self.assertIn("UPnP is probably switched off", m.status()["message"])
        self.assertTrue(m.done.is_set())
        # an unreachable description is reported, not raised
        m2 = upnp.PortMapper(8765, locations=["http://127.0.0.1:9/rootDesc.xml"])
        self.assertFalse(m2.open())
        self.assertEqual(m2.status()["state"], "failed")

    def test_ssdp_discovery_and_parsing(self):
        self.assertEqual(upnp.parse_ssdp(b"HTTP/1.1 200 OK\r\nCACHE-CONTROL: max-age=120\r\nLocation: http://192.168.1.1:5000/rootDesc.xml\r\nST: x\r\n\r\n"), "http://192.168.1.1:5000/rootDesc.xml")
        self.assertIsNone(upnp.parse_ssdp(b"M-SEARCH * HTTP/1.1\r\n\r\n"))
        self.assertTrue(upnp.shared_ip("100.64.0.1") and upnp.shared_ip("10.0.0.2") and not upnp.shared_ip("203.0.113.7"))
        # a gateway that answers the search (unicast here, multicast on a real network)
        resp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        resp.bind(("127.0.0.1", 0))
        seen = []

        def answer():
            resp.settimeout(3)
            try:
                data, src = resp.recvfrom(4096)
                seen.append(data)
                resp.sendto(b"HTTP/1.1 200 OK\r\nST: urn:schemas-upnp-org:device:InternetGatewayDevice:1\r\nLOCATION: http://127.0.0.1:5000/rootDesc.xml\r\n\r\n", src)
                resp.sendto(b"HTTP/1.1 200 OK\r\nLOCATION: http://8.8.8.8/evil.xml\r\n\r\n", src)  # (not on this network: ignored)
            except OSError:
                pass
        t = threading.Thread(target=answer, daemon=True)
        t.start()
        found = upnp.discover(timeout=1.0, addr=resp.getsockname(), interfaces=["127.0.0.1"])
        t.join(2)
        resp.close()
        self.assertEqual(found, ["http://127.0.0.1:5000/rootDesc.xml"])
        self.assertIn(b"ssdp:discover", seen[0])

    def test_the_hosting_service_reports_it_for_host_cmd_and_the_hosts_online_tab(self):
        r = FakeRouter()
        tmp = tempfile.TemporaryDirectory()
        svc = server_app.Service(Path(tmp.name) / "h.sqlite3")
        svc.hosting = True
        handler = type("QuietHandler", (server_app.Handler,), {"log_message": lambda *a: None})
        srv = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        srv.daemon_threads = True
        srv.service = svc
        threading.Thread(target=srv.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True).start()
        base = f"http://127.0.0.1:{srv.server_address[1]}"
        try:
            svc.upnp = upnp.PortMapper(srv.server_address[1], locations=[r.location])
            threading.Thread(target=svc.upnp.open, daemon=True).start()
            with urllib.request.urlopen(base + "/api/hosting.txt", timeout=15) as resp:  # (waits for the router's answer)
                text = resp.read().decode()
            self.assertIn(f"PUBLIC http://203.0.113.7:{srv.server_address[1]}/", text)
            self.assertTrue(text.splitlines()[1].startswith("OK "))
            self.assertIn(f"BUILD {server_app.VERSION} {svc.build}", text)  # (the version friends' own copies need)
            op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
            req = lambda path, body=None: op.open(urllib.request.Request(base + path, data=None if body is None else json.dumps(body).encode(), headers={} if body is None else {"Content-Type": "application/json"}), timeout=10)
            req("/api/dev-account", {})
            on = json.loads(req("/api/online").read())
            self.assertEqual((on["port"]["state"], on["port"]["external_ip"]), ("open", "203.0.113.7"))
            svc.upnp.close()
            self.assertEqual(r.mappings, {})
        finally:
            srv.shutdown(); srv.server_close(); svc.close(); tmp.cleanup(); r.stop()


if __name__ == "__main__":
    unittest.main()
