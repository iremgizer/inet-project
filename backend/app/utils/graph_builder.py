from typing import Dict, Tuple, List
from networkx import DiGraph, Graph
from app.models import NetworkInput, LinkInput

LinkKey = Tuple[str, str]

class GraphBuilder:
    @staticmethod
    def build_graph(network: NetworkInput) -> Tuple[Graph, Dict[LinkKey, LinkInput]]:
        """Builds the routing graph used by every algorithm.

        A DOWN link (see LinkInput.operationalStatus) is never added as an
        edge — this is the single place link failure is applied, so ECMP,
        Distance Vector, and Segment Routing all automatically recompute
        around a failure with no per-algorithm changes. `link_map` still maps
        a DOWN link's (source, target) key to its LinkInput, though: it
        remains part of the physical topology (same id, weight, capacity),
        it just cannot appear in any resolved route because the edge itself
        doesn't exist in `graph`. When every link is UP (the default), this
        is byte-identical to building the graph from the full link list.
        """
        if network.isDirected:
            graph = DiGraph()
        else:
            graph = Graph()

        node_ids = {node.id for node in network.nodes}
        for node in network.nodes:
            graph.add_node(node.id)

        link_map: Dict[LinkKey, LinkInput] = {}
        for link in network.links:
            if link.source not in node_ids or link.target not in node_ids:
                raise ValueError(f"Link {link.id} references unknown node")
            link_map[(link.source, link.target)] = link
            if not network.isDirected:
                link_map[(link.target, link.source)] = link
            if link.operationalStatus == "DOWN":
                continue
            graph.add_edge(link.source, link.target, weight=link.weight, capacity=link.capacity, linkId=link.id)
            if not network.isDirected:
                graph.add_edge(link.target, link.source, weight=link.weight, capacity=link.capacity, linkId=link.id)

        return graph, link_map

    @staticmethod
    def down_link_ids(network: NetworkInput) -> List[str]:
        return [link.id for link in network.links if link.operationalStatus == "DOWN"]
