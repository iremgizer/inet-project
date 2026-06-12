from typing import List
from app.models import NetworkInput, NodeInput, LinkInput, TrafficDemandInput

class TopologyService:
    @staticmethod
    def get_topology_names() -> List[str]:
        return ["custom", "triangle", "line", "ring", "mesh", "fat-tree"]

    @staticmethod
    def build_topology(topology_type: str) -> NetworkInput:
        if topology_type == "triangle":
            return TopologyService._triangle_topology()
        if topology_type == "line":
            return TopologyService._line_topology()
        if topology_type == "ring":
            return TopologyService._ring_topology()
        if topology_type == "mesh":
            return TopologyService._mesh_topology()
        if topology_type == "fat-tree":
            return TopologyService._fat_tree_placeholder()
        raise ValueError(f"Topology type {topology_type} is not supported")

    @staticmethod
    def _triangle_topology() -> NetworkInput:
        nodes = [
            NodeInput(id="u", label="u", x=150, y=200),
            NodeInput(id="v", label="v", x=350, y=350),
            NodeInput(id="t", label="t", x=550, y=200),
        ]
        links = [
            LinkInput(id="u-t", source="u", target="t", capacity=1.0, weight=2.0),
            LinkInput(id="u-v", source="u", target="v", capacity=1.0, weight=1.0),
            LinkInput(id="v-t", source="v", target="t", capacity=1.0, weight=1.0),
        ]
        demands = [TrafficDemandInput(id="d1", source="u", target="t", amount=1.5)]
        return NetworkInput(nodes=nodes, links=links, demands=demands, topologyType="triangle", isDirected=False)

    @staticmethod
    def _line_topology() -> NetworkInput:
        nodes = [
            NodeInput(id="a", label="A", x=120, y=200),
            NodeInput(id="b", label="B", x=320, y=200),
            NodeInput(id="c", label="C", x=520, y=200),
        ]
        links = [
            LinkInput(id="a-b", source="a", target="b", capacity=5.0, weight=1.0),
            LinkInput(id="b-c", source="b", target="c", capacity=5.0, weight=1.0),
        ]
        demands = [TrafficDemandInput(id="d1", source="a", target="c", amount=3.0)]
        return NetworkInput(nodes=nodes, links=links, demands=demands, topologyType="line", isDirected=False)

    @staticmethod
    def _ring_topology() -> NetworkInput:
        nodes = [
            NodeInput(id="a", label="A", x=150, y=180),
            NodeInput(id="b", label="B", x=350, y=100),
            NodeInput(id="c", label="C", x=550, y=180),
            NodeInput(id="d", label="D", x=350, y=300),
        ]
        links = [
            LinkInput(id="a-b", source="a", target="b", capacity=4.0, weight=1.0),
            LinkInput(id="b-c", source="b", target="c", capacity=4.0, weight=1.0),
            LinkInput(id="c-d", source="c", target="d", capacity=4.0, weight=1.0),
            LinkInput(id="d-a", source="d", target="a", capacity=4.0, weight=1.0),
        ]
        demands = [TrafficDemandInput(id="d1", source="a", target="c", amount=2.5)]
        return NetworkInput(nodes=nodes, links=links, demands=demands, topologyType="ring", isDirected=False)

    @staticmethod
    def _mesh_topology() -> NetworkInput:
        nodes = [
            NodeInput(id="a", label="A", x=120, y=140),
            NodeInput(id="b", label="B", x=320, y=120),
            NodeInput(id="c", label="C", x=520, y=140),
            NodeInput(id="d", label="D", x=120, y=300),
            NodeInput(id="e", label="E", x=320, y=320),
            NodeInput(id="f", label="F", x=520, y=300),
        ]
        links = [
            LinkInput(id="a-b", source="a", target="b", capacity=6.0, weight=1.0),
            LinkInput(id="b-c", source="b", target="c", capacity=6.0, weight=1.0),
            LinkInput(id="a-d", source="a", target="d", capacity=6.0, weight=1.0),
            LinkInput(id="b-e", source="b", target="e", capacity=6.0, weight=1.0),
            LinkInput(id="c-f", source="c", target="f", capacity=6.0, weight=1.0),
            LinkInput(id="d-e", source="d", target="e", capacity=6.0, weight=1.0),
            LinkInput(id="e-f", source="e", target="f", capacity=6.0, weight=1.0),
        ]
        demands = [TrafficDemandInput(id="d1", source="a", target="f", amount=4.0)]
        return NetworkInput(nodes=nodes, links=links, demands=demands, topologyType="mesh", isDirected=False)

    @staticmethod
    def _fat_tree_placeholder() -> NetworkInput:
        nodes = [
            NodeInput(id="h1", label="H1", x=100, y=300),
            NodeInput(id="h2", label="H2", x=300, y=300),
            NodeInput(id="s1", label="S1", x=100, y=180),
            NodeInput(id="s2", label="S2", x=300, y=180),
            NodeInput(id="c1", label="C1", x=200, y=60),
        ]
        links = [
            LinkInput(id="h1-s1", source="h1", target="s1", capacity=10.0, weight=1.0),
            LinkInput(id="h2-s2", source="h2", target="s2", capacity=10.0, weight=1.0),
            LinkInput(id="s1-c1", source="s1", target="c1", capacity=10.0, weight=1.0),
            LinkInput(id="s2-c1", source="s2", target="c1", capacity=10.0, weight=1.0),
        ]
        demands = [TrafficDemandInput(id="d1", source="h1", target="h2", amount=5.0)]
        return NetworkInput(nodes=nodes, links=links, demands=demands, topologyType="fat-tree", isDirected=False)
