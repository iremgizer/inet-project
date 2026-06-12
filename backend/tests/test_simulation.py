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
    for topology_type in ["triangle", "line", "ring", "mesh", "custom"]:
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
