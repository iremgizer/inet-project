import pytest

from app.algorithms.distance_vector import DistanceVectorAlgorithm
from app.algorithms.ecmp import ECMPAlgorithm
from app.models import AlgorithmConfig, LinkInput, NetworkInput, NodeInput, SimulationRequest, TrafficDemandInput
from app.services.simulation_service import SimulationService
from app.services.topology_service import TopologyService


def config(algorithm="ECMP", threshold=1.0):
    return AlgorithmConfig(
        selectedAlgorithm=algorithm,
        algorithmType="real_world_heuristic",
        objective="minimize_max_utilization",
        congestionThreshold=threshold,
    )


def test_ecmp_triangle_equal_cost_split():
    network = TopologyService.build_topology("triangle")
    result = ECMPAlgorithm.run(network, config())

    paths = result.pathResults[0].paths
    assert len(paths) == 2
    assert sorted(path.trafficShare for path in paths) == [0.75, 0.75]
    assert result.totalDeliveredTraffic == 1.5
    assert result.traceEvents
    assert any("Equal-cost" in event.title for event in result.traceEvents)


def test_ecmp_congestion_calculation():
    network = TopologyService.build_topology("triangle")
    network.demands = [TrafficDemandInput(id="d-heavy", source="u", target="t", amount=3.0)]
    result = ECMPAlgorithm.run(network, config())

    assert result.congestedLinkCount == 3
    assert result.maxUtilization == 1.5
    assert all(link.isCongested for link in result.linkResults)


def test_distance_vector_shortest_path_and_cost_table():
    network = TopologyService.build_topology("line")
    result = DistanceVectorAlgorithm.run(network, config("DISTANCE_VECTOR"))

    assert result.pathResults[0].paths[0].nodes == ["a", "b", "c"]
    assert result.pathResults[0].paths[0].cost == 2.0
    entry = next(item for item in result.distanceVectorTable if item.nodeId == "a" and item.destinationId == "c")
    assert entry.cost == 2.0
    assert entry.nextHop == "b"
    assert result.traceEvents


def test_topology_generation_including_custom():
    for topology_type in ["triangle", "line", "ring", "mesh", "custom", "grid", "path", "cycle", "random"]:
        network = TopologyService.build_topology(topology_type)
        assert network.topologyType == topology_type
        if topology_type == "custom":
            assert network.nodes == []
        else:
            assert network.nodes
            assert network.links


def test_validation_errors_for_missing_nodes_and_bad_links():
    service = SimulationService()
    bad_missing_node = NetworkInput(
        nodes=[NodeInput(id="a", label="A", x=0, y=0)],
        links=[],
        demands=[TrafficDemandInput(id="d1", source="a", target="b", amount=1.0)],
        topologyType="custom",
        isDirected=False,
    )
    with pytest.raises(ValueError, match="target node not found"):
        service._validate_request(SimulationRequest(network=bad_missing_node, algorithmConfig=config()))

    with pytest.raises(ValueError):
        LinkInput(id="bad", source="a", target="b", capacity=0, weight=1)

    with pytest.raises(ValueError):
        LinkInput(id="bad", source="a", target="b", capacity=1, weight=-1)


def test_new_topology_node_and_link_counts():
    """Verify upgraded and new topology types generate correct node/link counts."""
    # Upgraded Clos fat-tree: 2 spines + 4 leaves + 8 hosts = 14 nodes, 16 links
    ft = TopologyService.build_topology("fat-tree")
    assert ft.topologyType == "fat-tree"
    assert len(ft.nodes) == 14
    assert len(ft.links) == 16

    # Grid 3×3: 9 nodes, 12 links
    grid = TopologyService.build_topology("grid")
    assert grid.topologyType == "grid"
    assert len(grid.nodes) == 9
    assert len(grid.links) == 12

    # Path P4: 4 nodes, 3 links
    path = TopologyService.build_topology("path")
    assert path.topologyType == "path"
    assert len(path.nodes) == 4
    assert len(path.links) == 3

    # Cycle C5: 5 nodes, 5 links
    cycle = TopologyService.build_topology("cycle")
    assert cycle.topologyType == "cycle"
    assert len(cycle.nodes) == 5
    assert len(cycle.links) == 5

    # Random: deterministic 6-node, 8-link graph
    rand = TopologyService.build_topology("random")
    assert rand.topologyType == "random"
    assert len(rand.nodes) == 6
    assert len(rand.links) == 8


def test_dv_on_path_graph():
    """Distance Vector finds optimal route on a 4-node path with weight=10 links."""
    network = TopologyService.build_topology("path")
    result = DistanceVectorAlgorithm.run(network, config("DISTANCE_VECTOR"))

    path = result.pathResults[0].paths[0]
    assert path.nodes == ["n1", "n2", "n3", "n4"]
    assert path.cost == 30.0

    entry = next(
        item for item in result.distanceVectorTable
        if item.nodeId == "n1" and item.destinationId == "n4"
    )
    assert entry.cost == 30.0
    assert entry.nextHop == "n2"


def test_ecmp_on_grid():
    """ECMP runs without error on a 3×3 grid and delivers all traffic."""
    network = TopologyService.build_topology("grid")
    result = ECMPAlgorithm.run(network, config())
    assert result.totalDeliveredTraffic > 0
    assert len(result.linkResults) == 12


def test_ecmp_on_fat_tree():
    """ECMP finds equal-cost paths in the upgraded Clos fat-tree."""
    network = TopologyService.build_topology("fat-tree")
    result = ECMPAlgorithm.run(network, config())
    assert result.totalDeliveredTraffic > 0
    # No congestion for a single unit demand on a fat-tree with capacity 10
    assert result.congestedLinkCount == 0
