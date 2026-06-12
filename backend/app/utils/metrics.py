from typing import List
from app.models import LinkResult, PathResult

class Metrics:
    @staticmethod
    def compute_summary(path_results: List[PathResult], link_results: List[LinkResult]):
        total_traffic = 0.0
        total_cost = 0.0
        path_count = 0
        for path in path_results:
            for share in path.paths:
                total_traffic += share.trafficShare
                total_cost += share.cost * share.trafficShare
                path_count += 1
        average_path_cost = total_cost / total_traffic if total_traffic > 0 else 0.0
        max_utilization = max((link.utilization for link in link_results), default=0.0)
        congested = sum(1 for link in link_results if link.isCongested)
        return {
            "maxUtilization": max_utilization,
            "totalDeliveredTraffic": total_traffic,
            "averagePathCost": average_path_cost,
            "congestedLinkCount": congested,
        }
