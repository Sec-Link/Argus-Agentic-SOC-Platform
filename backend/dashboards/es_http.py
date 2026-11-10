"""Minimal Elasticsearch access over plain HTTP.

The installed `elasticsearch` Python client may be newer than the cluster (e.g. client 9.x vs
server 8.x) and then sends a `compatible-with` media type the server rejects. Plain JSON over
HTTP works with every version, and the alerts app already falls back to it for the same reason.
"""
import base64
import logging

import requests

logger = logging.getLogger(__name__)

TIMEOUT = (5, 30)


class EsHttp:
    def __init__(self, cfg):
        self.hosts = [h.rstrip("/") for h in cfg.hosts_list()]
        self.verify = bool(cfg.verify_certs)
        self.headers = {"Content-Type": "application/json", "Accept": "application/json"}
        if cfg.username:
            token = base64.b64encode(f"{cfg.username}:{cfg.password}".encode()).decode()
            self.headers["Authorization"] = f"Basic {token}"

    def _request(self, method, path, params=None, body=None):
        last = None
        for host in self.hosts:
            url = host if host.startswith("http") else f"http://{host}"
            try:
                r = requests.request(
                    method, f"{url}{path}", params=params, json=body,
                    headers=self.headers, timeout=TIMEOUT, verify=self.verify,
                )
            except requests.RequestException as exc:
                last = exc
                continue
            if r.status_code >= 400:
                raise RuntimeError(f"Elasticsearch returned {r.status_code}: {r.text[:300]}")
            return r.json()
        raise RuntimeError(f"Elasticsearch unreachable: {last}")

    def search(self, index, body, ignore_unavailable=True, allow_no_indices=True):
        params = {
            "ignore_unavailable": str(ignore_unavailable).lower(),
            "allow_no_indices": str(allow_no_indices).lower(),
        }
        return self._request("POST", f"/{index}/_search", params=params, body=body)

    def cat_indices(self):
        return self._request("GET", "/_cat/indices", params={"format": "json", "h": "index"})

    def data_streams(self):
        return self._request("GET", "/_data_stream/*").get("data_streams", [])
