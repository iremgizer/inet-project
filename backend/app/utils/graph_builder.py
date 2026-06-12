from typing import Dict, Tuple, List
from networkx import DiGraph, Graph
from app.models import NetworkInput, LinkInput

LinkKey = Tuple[str, str]

class GraphBuilder:
    @staticmethod
    def build_graph(network: NetworkInput) -> Tuple[Graph, Dict[LinkKey, LinkInput]]:
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
            graph.add_edge(link.source, link.target, weight=link.weight, capacity=link.capacity, linkId=link.id)
            if not network.isDirected:
                graph.add_edge(link.target, link.source, weight=link.weight, capacity=link.capacity, linkId=link.id)
            link_map[(link.source, link.target)] = link
            if not network.isDirected:
                link_map[(link.target, link.source)] = link

        return graph, link_map
