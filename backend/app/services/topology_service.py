import math
from typing import List
from app.models import NetworkInput, NodeInput, LinkInput, TrafficDemandInput

class TopologyService:
    @staticmethod
    def get_topology_names() -> List[str]:
        return ["custom", "triangle", "line", "ring", "mesh", "fat-tree", "grid", "path", "cycle", "random"]

    @staticmethod
    def build_topology(topology_type: str) -> NetworkInput:
        if topology_type == "custom":
            return NetworkInput(nodes=[], links=[], demands=[], topologyType="custom", isDirected=False)
        if topology_type == "triangle":
            return TopologyService._triangle_topology()
        if topology_type == "line":
            return TopologyService._line_topology()
        if topology_type == "ring":
            return TopologyService._ring_topology()
        if topology_type == "mesh":
            return TopologyService._mesh_topology()
        if topology_type == "fat-tree":
            return TopologyService._fat_tree_topology()
        if topology_type == "grid":
            return TopologyService._grid_topology()
        if topology_type == "path":
            return TopologyService._path_topology()
        if topology_type == "cycle":
            return TopologyService._cycle_topology()
        if topology_type == "random":
            return TopologyService._random_topology()
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
    def _fat_tree_topology() -> NetworkInput:
        """Proper small Clos fat-tree: 2 spines, 4 leaves, 8 hosts (14 nodes, 16 links)."""
        spines = [
            NodeInput(id="s1", label="S1", x=195, y=90),
            NodeInput(id="s2", label="S2", x=555, y=90),
        ]
        leaves = [
            NodeInput(id="l1", label="L1", x=60,  y=245),
            NodeInput(id="l2", label="L2", x=255, y=245),
            NodeInput(id="l3", label="L3", x=450, y=245),
            NodeInput(id="l4", label="L4", x=645, y=245),
        ]
        hosts = [NodeInput(id=f"h{i+1}", label=f"H{i+1}", x=60+i*90, y=400) for i in range(8)]
        nodes = spines + leaves + hosts

        links = []
        lid = 1
        hosts_per_leaf = 2
        for i, host in enumerate(hosts):
            leaf = leaves[i // hosts_per_leaf]
            links.append(LinkInput(id=f"hl{lid}", source=host.id, target=leaf.id, capacity=10.0, weight=1.0))
            lid += 1
        for leaf in leaves:
            for spine in spines:
                links.append(LinkInput(id=f"ls{lid}", source=leaf.id, target=spine.id, capacity=10.0, weight=1.0))
                lid += 1

        demands = [TrafficDemandInput(id="d1", source="h1", target="h8", amount=1.0)]
        return NetworkInput(nodes=nodes, links=links, demands=demands, topologyType="fat-tree", isDirected=False)

    @staticmethod
    def _grid_topology() -> NetworkInput:
        """3×3 grid: 9 nodes (A–I), 12 links."""
        letters = "ABCDEFGHI"
        nodes = []
        for r in range(3):
            for c in range(3):
                idx = r * 3 + c
                nodes.append(NodeInput(id=f"n{idx+1}", label=letters[idx], x=80+c*240, y=80+r*200))

        links = []
        lid = 1
        for r in range(3):
            for c in range(2):
                src, tgt = r * 3 + c, r * 3 + c + 1
                links.append(LinkInput(id=f"l{lid}", source=nodes[src].id, target=nodes[tgt].id, capacity=10.0, weight=1.0))
                lid += 1
        for r in range(2):
            for c in range(3):
                src, tgt = r * 3 + c, (r + 1) * 3 + c
                links.append(LinkInput(id=f"l{lid}", source=nodes[src].id, target=nodes[tgt].id, capacity=10.0, weight=1.0))
                lid += 1

        demands = [TrafficDemandInput(id="d1", source="n1", target="n9", amount=1.0)]
        return NetworkInput(nodes=nodes, links=links, demands=demands, topologyType="grid", isDirected=False)

    @staticmethod
    def _path_topology() -> NetworkInput:
        """P4: A–B–C–D with weight=10 (course-aligned)."""
        letters = "ABCD"
        nodes = [NodeInput(id=f"n{i+1}", label=letters[i], x=80+i*160, y=200) for i in range(4)]
        links = [
            LinkInput(id=f"l{i+1}", source=nodes[i].id, target=nodes[i+1].id, capacity=10.0, weight=10.0)
            for i in range(3)
        ]
        demands = [TrafficDemandInput(id="d1", source="n1", target="n4", amount=1.0)]
        return NetworkInput(nodes=nodes, links=links, demands=demands, topologyType="path", isDirected=False)

    @staticmethod
    def _cycle_topology() -> NetworkInput:
        """C5: 5-node odd cycle."""
        letters = "ABCDE"
        nodes = []
        for i in range(5):
            angle = (i / 5) * math.pi * 2 - math.pi / 2
            nodes.append(NodeInput(
                id=f"n{i+1}", label=letters[i],
                x=round(360 + math.cos(angle) * 150),
                y=round(260 + math.sin(angle) * 150),
            ))
        links = [
            LinkInput(id=f"l{i+1}", source=nodes[i].id, target=nodes[(i+1) % 5].id, capacity=10.0, weight=1.0)
            for i in range(5)
        ]
        demands = [TrafficDemandInput(id="d1", source="n1", target="n3", amount=1.0)]
        return NetworkInput(nodes=nodes, links=links, demands=demands, topologyType="cycle", isDirected=False)

    @staticmethod
    def _random_topology() -> NetworkInput:
        """Deterministic 6-node graph for testing (ring + two chords)."""
        nodes = []
        for i in range(6):
            angle = (i / 6) * math.pi * 2 - math.pi / 2
            nodes.append(NodeInput(
                id=f"n{i+1}", label=f"N{i+1}",
                x=round(360 + math.cos(angle) * 160),
                y=round(260 + math.sin(angle) * 160),
            ))
        links = [
            LinkInput(id="l1", source="n1", target="n2", capacity=10.0, weight=1.0),
            LinkInput(id="l2", source="n2", target="n3", capacity=10.0, weight=1.0),
            LinkInput(id="l3", source="n3", target="n4", capacity=10.0, weight=1.0),
            LinkInput(id="l4", source="n4", target="n5", capacity=10.0, weight=1.0),
            LinkInput(id="l5", source="n5", target="n6", capacity=10.0, weight=1.0),
            LinkInput(id="l6", source="n6", target="n1", capacity=10.0, weight=1.0),
            LinkInput(id="l7", source="n1", target="n4", capacity=10.0, weight=2.0),
            LinkInput(id="l8", source="n2", target="n5", capacity=10.0, weight=2.0),
        ]
        demands = [TrafficDemandInput(id="d1", source="n1", target="n4", amount=1.0)]
        return NetworkInput(nodes=nodes, links=links, demands=demands, topologyType="random", isDirected=False)
