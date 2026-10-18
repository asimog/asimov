"""
Asimog: swarm graph memory (docs/24 patch M5). A fixed Pump.fun ontology, so no LLM ontology or NER call per run.

SWARM_GRAPH_FEATURES picks the store behind upstream's GraphStorage interface:
  off      in-memory graph (no Neo4j), enough for the report agent's quick tools (nano)
  minimal  Neo4j through upstream Neo4jStorage, keyword and graph-hop search; no embeddings, reranker, entity
           resolution, contradiction checks or communities (lite)
  all      Neo4j with every upstream graph feature on (embeddings from EMBEDDING_*), communities built after the seed (full)

The seed is observed data: the coin, its callers (hashed names, measured record only), recent callouts, coins that
share callers, and the BettaFish reports the run read. Simulated actions are written each round as their own edges
(source_type "simulation", simulated true, kind "observation"), never mixed with observed ones and never changing them.
Ways it fails: Neo4j is down (open_graph raises; the worker fails the run with the reason, like any engine error);
a dossier field is missing (that node or edge is skipped); a simulated row names an unknown agent (written under its id).
"""

from __future__ import annotations

import json
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

FEATURES = os.getenv("SWARM_GRAPH_FEATURES", "off").strip().lower()
if FEATURES == "minimal":  # upstream flags read at import time: everything that costs a model call or a download stays off
    for k in ("RERANKER_ENABLED", "ENTITY_RESOLUTION_ENABLED", "CONTRADICTION_DETECTION_ENABLED", "REASONING_TRACE_ENABLED"):
        os.environ[k] = "false"

ONTOLOGY: Dict[str, Any] = {
    "entity_types": [
        {"name": "Coin", "description": "A Pump.fun coin on its bonding curve", "attributes": [{"name": "mint"}, {"name": "last_price_sol"}]},
        {"name": "Caller", "description": "A wallet that posts callouts; name is a hash, record is measured", "attributes": [{"name": "calls_seen"}, {"name": "dna"}]},
        {"name": "Wallet", "description": "A trading wallet, by archetype (simulated followers, the house)", "attributes": [{"name": "archetype"}]},
        {"name": "Callout", "description": "A public call on a coin, verbatim", "attributes": [{"name": "likes"}, {"name": "replies"}]},
        {"name": "Narrative", "description": "A theme a report found in the feed", "attributes": []},
        {"name": "Report", "description": "A published BettaFish or MiroShark report", "attributes": [{"name": "producer"}]},
    ],
    "edge_types": [
        {"name": "CALLED", "source_targets": [{"source": "Caller", "target": "Coin"}, {"source": "Wallet", "target": "Coin"}]},
        {"name": "BOUGHT", "source_targets": [{"source": "Caller", "target": "Coin"}, {"source": "Wallet", "target": "Coin"}]},
        {"name": "SOLD", "source_targets": [{"source": "Caller", "target": "Coin"}, {"source": "Wallet", "target": "Coin"}]},
        {"name": "FOLLOWS", "source_targets": [{"source": "Wallet", "target": "Caller"}, {"source": "Caller", "target": "Caller"}]},
        {"name": "SHARES_CALLERS_WITH", "source_targets": [{"source": "Coin", "target": "Coin"}]},
        {"name": "CITES", "source_targets": [{"source": "Report", "target": "Callout"}, {"source": "Report", "target": "Coin"}, {"source": "Callout", "target": "Coin"}, {"source": "Report", "target": "Narrative"}]},
    ],
}
LABELS = {e["name"] for e in ONTOLOGY["entity_types"]}
EDGES = {e["name"] for e in ONTOLOGY["edge_types"]}
ACTION_EDGE = {"buy": "BOUGHT", "sell": "SOLD", "post_callout": "CALLED", "follow_caller": "FOLLOWS"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def persona_name(wallet: Optional[str]) -> str:
    """The one hashed name a caller has everywhere (personas, graph, report). Never a handle."""
    import hashlib
    return f"caller_{int(hashlib.sha256(str(wallet).encode()).hexdigest(), 16) % 10_000:04d}"


class _Facts:
    """Structured writes in upstream's node and edge shape (Entity + type label, RELATION with name and fact)."""

    def add_facts(self, graph_id: str, nodes: List[Dict[str, Any]], edges: List[Dict[str, Any]], simulated: bool = False, valid_at: Optional[str] = None) -> int:
        raise NotImplementedError

    @staticmethod
    def _edge_props(e: Dict[str, Any], simulated: bool, valid_at: Optional[str]) -> Dict[str, Any]:
        if e["name"] not in EDGES:
            raise ValueError(f"edge {e['name']} is not in the Pump.fun ontology")
        return {"uuid": str(uuid.uuid4()), "name": e["name"], "fact": ("SIMULATED: " if simulated else "") + e.get("fact", ""),
                "attributes_json": json.dumps(e.get("attributes") or {}, default=str), "created_at": _now(), "valid_at": valid_at or _now(),
                "kind": "observation" if simulated else "fact", "source_type": "simulation" if simulated else "document",
                "source_id": e.get("source_id") or "", "simulated": simulated}


class MemoryGraph(_Facts):
    """In-memory GraphStorage (nano): the abstract interface upstream defines, with keyword search."""

    def __init__(self):
        self.graphs: Dict[str, Dict[str, Any]] = {}
        self.nodes: Dict[str, Dict[str, Any]] = {}
        self.edges: Dict[str, Dict[str, Any]] = {}

    def create_graph(self, name: str, description: str = "") -> str:
        gid = str(uuid.uuid4())
        self.graphs[gid] = {"name": name, "description": description, "ontology": {}}
        return gid

    def delete_graph(self, graph_id: str) -> None:
        self.graphs.pop(graph_id, None)
        self.nodes = {k: v for k, v in self.nodes.items() if v["graph_id"] != graph_id}
        self.edges = {k: v for k, v in self.edges.items() if v["graph_id"] != graph_id}

    def set_ontology(self, graph_id: str, ontology: Dict[str, Any]) -> None:
        self.graphs[graph_id]["ontology"] = ontology

    def get_ontology(self, graph_id: str) -> Dict[str, Any]:
        return self.graphs.get(graph_id, {}).get("ontology", {})

    def add_text(self, graph_id: str, text: str, **_: Any) -> str:
        return str(uuid.uuid4())  # no NER in memory: the seed is structured (add_facts)

    def _node(self, graph_id: str, name: str) -> Optional[Dict[str, Any]]:
        return next((n for n in self.nodes.values() if n["graph_id"] == graph_id and n["name"].lower() == name.lower()), None)

    def add_facts(self, graph_id, nodes, edges, simulated=False, valid_at=None) -> int:
        for n in nodes:
            if not self._node(graph_id, n["name"]):
                u = str(uuid.uuid4())
                self.nodes[u] = {"uuid": u, "graph_id": graph_id, "name": n["name"], "labels": [n["label"]], "summary": n.get("summary", ""), "attributes": n.get("attributes") or {}, "created_at": _now()}
        written = 0
        for e in edges:
            s, t = self._node(graph_id, e["source"]), self._node(graph_id, e["target"])
            if not s or not t:
                continue
            p = self._edge_props(e, simulated, valid_at)
            p.update(graph_id=graph_id, source_node_uuid=s["uuid"], target_node_uuid=t["uuid"], attributes=json.loads(p.pop("attributes_json")), episode_ids=[], invalid_at=None, expired_at=None)
            self.edges[p["uuid"]] = p
            written += 1
        return written

    def get_all_nodes(self, graph_id: str, limit: int = 2000) -> List[Dict[str, Any]]:
        return [n for n in self.nodes.values() if n["graph_id"] == graph_id][:limit]

    def get_node(self, uuid_: str) -> Optional[Dict[str, Any]]:
        return self.nodes.get(uuid_)

    def get_node_edges(self, node_uuid: str) -> List[Dict[str, Any]]:
        return [e for e in self.edges.values() if node_uuid in (e["source_node_uuid"], e["target_node_uuid"])]

    def get_nodes_by_label(self, graph_id: str, label: str) -> List[Dict[str, Any]]:
        return [n for n in self.get_all_nodes(graph_id) if label in n["labels"]]

    def get_all_edges(self, graph_id: str) -> List[Dict[str, Any]]:
        return [e for e in self.edges.values() if e["graph_id"] == graph_id]

    def search(self, graph_id, query, limit=10, scope="edges", as_of=None, include_invalidated=False, kinds=None) -> Dict[str, Any]:
        words = [w for w in re.findall(r"\w+", (query or "").lower()) if len(w) > 1]
        score = lambda s: sum(w in s.lower() for w in words)  # noqa: E731
        out: Dict[str, Any] = {"edges": [], "nodes": [], "query": query}
        if scope in ("edges", "both"):
            es = [e for e in self.get_all_edges(graph_id) if not kinds or e["kind"] in kinds]
            out["edges"] = sorted([e for e in es if score(e["fact"] + " " + e["name"])], key=lambda e: -score(e["fact"] + " " + e["name"]))[:limit]
        if scope in ("nodes", "both"):
            ns = self.get_all_nodes(graph_id)
            out["nodes"] = sorted([n for n in ns if score(n["name"] + " " + n["summary"])], key=lambda n: -score(n["name"] + " " + n["summary"]))[:limit]
        return out

    def get_graph_info(self, graph_id: str) -> Dict[str, Any]:
        labels: Dict[str, int] = {}
        for n in self.get_all_nodes(graph_id):
            for lb in n["labels"]:
                labels[lb] = labels.get(lb, 0) + 1
        return {"graph_id": graph_id, "node_count": len(self.get_all_nodes(graph_id)), "edge_count": len(self.get_all_edges(graph_id)), "entity_types": list(labels)}

    def get_graph_data(self, graph_id: str) -> Dict[str, Any]:
        ns, es = self.get_all_nodes(graph_id), self.get_all_edges(graph_id)
        by = {n["uuid"]: n["name"] for n in ns}
        es = [{**e, "fact_type": e["name"], "source_node_name": by.get(e["source_node_uuid"], ""), "target_node_name": by.get(e["target_node_uuid"], "")} for e in es]
        return {"graph_id": graph_id, "nodes": ns, "edges": es, "node_count": len(ns), "edge_count": len(es)}


def _neo4j_class():
    from app.storage.embedding_service import EmbeddingService
    from app.storage.neo4j_storage import Neo4jStorage

    class NoEmbedding(EmbeddingService):
        """minimal: no embeddings provider; upstream vector search finds nothing and keyword plus graph-hop search carry on."""

        def embed(self, text):  # noqa: ARG002
            return []

        def embed_batch(self, texts, *a, **k):  # noqa: ARG002
            return [[] for _ in texts]

    class PumpfunNeo4j(Neo4jStorage, _Facts):
        def __init__(self):
            from app.storage.ner_extractor import NERExtractor

            class NoNER(NERExtractor):  # the seed is structured; add_text is not used under the fixed ontology
                def __init__(self):
                    self.llm = None

                def extract(self, text, ontology):  # noqa: ARG002
                    return {"entities": [], "relations": []}

            super().__init__(embedding_service=EmbeddingService() if FEATURES == "all" else NoEmbedding(), ner_extractor=NoNER())

        def add_facts(self, graph_id, nodes, edges, simulated=False, valid_at=None) -> int:
            now = _now()
            emb = self._embedding.embed_batch([n.get("summary") or n["name"] for n in nodes] + [e.get("fact", "") for e in edges]) if (nodes or edges) else []
            batch = [{"uuid": str(uuid.uuid4()), "name": n["name"], "name_lower": n["name"].lower(), "summary": n.get("summary", ""), "attrs_json": json.dumps(n.get("attributes") or {}, default=str), "embedding": emb[i] if i < len(emb) else []} for i, n in enumerate(nodes)]
            rels = []
            for j, e in enumerate(edges):
                p = self._edge_props(e, simulated, valid_at)
                p.update(src=e["source"].lower(), tgt=e["target"].lower(), fact_embedding=emb[len(nodes) + j] if len(nodes) + j < len(emb) else [])
                rels.append(p)
            with self._driver.session() as s:
                if batch:
                    s.run("""UNWIND $batch AS e MERGE (n:Entity {graph_id: $gid, name_lower: e.name_lower})
                             ON CREATE SET n.uuid = e.uuid, n.name = e.name, n.summary = e.summary, n.attributes_json = e.attrs_json, n.embedding = e.embedding, n.created_at = $now""",
                          batch=batch, gid=graph_id, now=now).consume()
                    for label in {n["label"] for n in nodes}:
                        if label not in LABELS:
                            raise ValueError(f"label {label} is not in the Pump.fun ontology")
                        s.run(f"UNWIND $names AS nl MATCH (n:Entity {{graph_id: $gid, name_lower: nl}}) SET n:`{label}`", names=[n["name"].lower() for n in nodes if n["label"] == label], gid=graph_id).consume()
                if not rels:
                    return 0
                r = s.run("""UNWIND $rels AS r MATCH (a:Entity {graph_id: $gid, name_lower: r.src}) MATCH (b:Entity {graph_id: $gid, name_lower: r.tgt})
                             CREATE (a)-[x:RELATION {uuid: r.uuid, graph_id: $gid, name: r.name, fact: r.fact, fact_embedding: r.fact_embedding, attributes_json: r.attributes_json,
                               episode_ids: [], created_at: r.created_at, valid_at: r.valid_at, invalid_at: null, expired_at: null, kind: r.kind,
                               source_type: r.source_type, source_id: r.source_id, simulated: r.simulated}]->(b) RETURN count(x) AS n""", rels=rels, gid=graph_id).single()
                return int(r["n"]) if r else 0

        def counts(self, graph_id: str) -> Dict[str, int]:
            with self._driver.session() as s:
                r = s.run("MATCH (:Entity {graph_id: $gid})-[x:RELATION {graph_id: $gid}]->() RETURN sum(CASE WHEN x.simulated THEN 1 ELSE 0 END) AS sim, sum(CASE WHEN x.simulated THEN 0 ELSE 1 END) AS obs", gid=graph_id).single()
                return {"simulated": int(r["sim"] or 0), "observed": int(r["obs"] or 0)}

    return PumpfunNeo4j


def open_graph():
    """The graph store for this run, by SWARM_GRAPH_FEATURES."""
    if FEATURES == "off":
        return MemoryGraph()
    if FEATURES not in ("minimal", "all"):
        raise SystemExit(f"SWARM_GRAPH_FEATURES must be off, minimal or all, not {FEATURES!r}")
    return _neo4j_class()()


def counts(store, graph_id: str) -> Dict[str, int]:
    if hasattr(store, "counts"):
        return store.counts(graph_id)
    es = store.get_all_edges(graph_id)
    return {"simulated": sum(1 for e in es if e.get("simulated")), "observed": sum(1 for e in es if not e.get("simulated"))}


def seed(store, graph_id: str, dossier: Dict[str, Any], parents: List[Dict[str, Any]]) -> int:
    """Observed facts from the dossier and the BettaFish reports the run read."""
    store.set_ontology(graph_id, ONTOLOGY)
    coin = dossier.get("coin") or {}
    sym = f"${coin.get('symbol') or str(coin.get('mint', ''))[:4]}"
    nodes = [{"name": sym, "label": "Coin", "summary": f"{sym} on Pump.fun", "attributes": {"mint": coin.get("mint"), "last_price_sol": dossier.get("last_price_sol")}}]
    edges: List[Dict[str, Any]] = []
    for k in dossier.get("callers") or []:
        nodes.append({"name": persona_name(k.get("wallet")), "label": "Caller", "summary": "a measured caller", "attributes": {"calls_seen": k.get("calls_seen"), "dna": k.get("dna")}})
    for c in dossier.get("callouts") or []:
        cid, who = c.get("callout_id"), persona_name(c.get("wallet"))
        if not cid:
            continue
        nodes.append({"name": cid, "label": "Callout", "summary": str(c.get("text") or "")[:500], "attributes": {"likes": c.get("likes"), "replies": c.get("replies"), "created_at": c.get("created_at")}})
        if not any(n["name"] == who for n in nodes):
            nodes.append({"name": who, "label": "Caller", "summary": "a caller", "attributes": {}})
        edges.append({"source": who, "target": sym, "name": "CALLED", "fact": f"{who} called {sym} in {cid}", "attributes": {"callout_id": cid}, "source_id": cid})
        edges.append({"source": cid, "target": sym, "name": "CITES", "fact": f"callout {cid} names {sym}", "source_id": cid})
    for o in dossier.get("shared_callers") or []:
        other = f"${o.get('symbol') or str(o.get('mint', ''))[:4]}"
        nodes.append({"name": other, "label": "Coin", "summary": f"{other} on Pump.fun", "attributes": {"mint": o.get("mint")}})
        edges.append({"source": sym, "target": other, "name": "SHARES_CALLERS_WITH", "fact": f"{sym} and {other} share {o.get('shared')} callers", "attributes": {"shared": o.get("shared")}})
    known = {n["name"] for n in nodes}
    for r in parents:
        rid = r.get("report_id")
        if not rid:
            continue
        nodes.append({"name": rid, "label": "Report", "summary": str(r.get("summary") or "")[:600], "attributes": {"producer": r.get("producer")}})
        edges.append({"source": rid, "target": sym, "name": "CITES", "fact": f"{r.get('producer')} report {rid} on {sym}: {str(r.get('summary') or '')[:300]}", "source_id": rid})
        edges += [{"source": rid, "target": cid, "name": "CITES", "fact": f"report {rid} cites {cid}", "source_id": rid} for cid in (r.get("cites") or []) if cid in known]
    n = store.add_facts(graph_id, nodes, edges)
    if FEATURES == "all" and hasattr(store, "build_communities"):
        store.build_communities(graph_id)
    return n


def simulated_round(store, graph_id: str, trace_rows: List[tuple], names: List[str], coin_name: str, branch: str, sample: int, round_num: int) -> int:
    """One round's simulated actions (rows of trace: user_id, action, info json) as SIMULATED edges."""
    edges, nodes = [], []
    name = lambda u: names[u] if 0 <= u < len(names) else f"agent_{u}"  # noqa: E731
    for u, action, info in trace_rows:
        rel = ACTION_EDGE.get(action)
        if not rel:
            continue
        a = json.loads(info) if info else {}
        target = name(int(a["caller_id"])) if rel == "FOLLOWS" and "caller_id" in a else coin_name
        nodes.append({"name": name(u), "label": "Caller" if name(u).startswith(("caller_", "Asimog")) else "Wallet", "summary": "simulated persona", "attributes": {}})
        detail = f" {a.get('sol')} SOL" if "sol" in a else (f": {str(a.get('content'))[:160]}" if a.get("content") else "")
        edges.append({"source": name(u), "target": target, "name": rel, "fact": f"{name(u)} {rel.lower()} {target}{detail} (branch {branch}, sample {sample}, round {round_num})",
                      "attributes": {"branch": branch, "sample": sample, "round": round_num}, "source_id": f"{branch}{sample}r{round_num}"})
    return store.add_facts(graph_id, nodes, edges, simulated=True) if edges else 0
