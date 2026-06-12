# Frontend for Network Algorithm Visualization Tool

This React application provides an interactive dashboard for building a network topology, assigning link parameters, creating traffic demands, and visualizing routing algorithm results.

## Run Frontend

```bash
cd frontend
npm install
npm run dev
```

Then open the local Vite URL shown in the terminal, typically `http://localhost:5173`.

## Structure

- `src/App.tsx` contains the main application state and coordinate logic.
- `src/components/GraphCanvas.tsx` renders the SVG network graph with nodes, links, arrows, and simulation labels.
- `src/components/LeftSidebar.tsx` contains the network builder controls.
- `src/components/BottomPanel.tsx` contains traffic demand and algorithm controls.
- `src/components/RightSidebar.tsx` shows selected node/link details and simulation results.
- `src/components/MetricsPanel.tsx` shows summary metrics.
- `src/components/RoutingTablePanel.tsx` displays the Distance Vector cost table.
- `src/types/network.ts` defines TypeScript types that mirror backend models.
- `src/api/simulationApi.ts` handles communication with the backend.

## Notes

- The app uses a custom SVG-based graph canvas for visibility and maintainability.
- Segment Routing and Custom Splitting are shown as planned future features.
